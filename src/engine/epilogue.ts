import { z } from 'zod';
import { isTreatyLive } from '../domain/diplomacy.js';
import { isDebtLive } from '../domain/debt.js';
import {
  fleetStrengthOf,
  getFaction,
  ledgerFor,
  systemsOf,
  type WorldState,
} from '../domain/state.js';

/**
 * How a campaign ends, and why the facts are computed before anything is
 * written.
 *
 * A campaign had no ending at all: it ran until the player stopped playing,
 * which meant every session trailed off rather than finishing. A turn limit
 * gives it a shape, and the shape needs a last page.
 *
 * The narration is the one place in this project where a model call is
 * unambiguously the right tool — it happens once per campaign, and "narrate
 * what became of these five powers" is exactly what it is good at. So it gets
 * the same discipline as everything else: **code establishes what is true and
 * the prose interprets it.** An epilogue that invents a war nobody fought is
 * worse than no epilogue, because it is the last thing the player reads and
 * they have no turn left in which to catch it.
 *
 * Every figure here is derived from the final state and the seed, so the whole
 * dossier is reproducible from the journal.
 */

export interface FactionOutcome {
  factionId: string;
  name: string;
  color: number;
  /** Worlds held at the end, and the change from where they started. */
  systems: number;
  systemsDelta: number;
  /** Worlds taken and lost by name, so the narration has specifics to use. */
  gained: string[];
  lost: string[];
  fleet: number;
  credits: number;
  net: number;
  dissent: number;
  /** How this power ended up regarding the player, and vice versa. */
  towardPlayer: number;
  playerToward: number;
  /** Powers it is at war with (disposition at or below −75). */
  wars: string[];
  liveTreaties: string[];
  /** Debts still owed to and by this power at the final bell. */
  owes: number;
  owed: number;
  /** A one-word verdict computed from the above, never chosen by a model. */
  arc: 'ascendant' | 'diminished' | 'holding' | 'broken';
}

export interface CampaignOutcome {
  turn: number;
  maxTurns: number;
  playerFactionId: string;
  factions: FactionOutcome[];
  /** Worlds nobody ever claimed. */
  unaligned: number;
  /** The power holding the most worlds at the end; ties break on faction id. */
  foremost: string;
  /**
   * Everyone level on that count, `foremost` included. When it has more than
   * one entry nobody is foremost, and the narration must not say otherwise.
   */
  leaders: string[];
}

const WAR = -75;

/**
 * The final dossier: everything true about the galaxy at the last bell.
 *
 * `arc` is decided here rather than in the prompt because it is the one
 * judgement the narration must not be free to make — a power that lost half
 * its territory should not be able to narrate itself as triumphant merely
 * because its voice is confident.
 */
export function campaignOutcome(
  state: WorldState,
  /**
   * The board this campaign began from, so "gained" and "lost" are real
   * differences rather than a guess.
   *
   * Passed in rather than rebuilt with `createSeedState` here: that hidden
   * dependency would drag the whole scenario module into anything that imports
   * these schemas, including the browser, for a value the caller already has.
   */
  start: WorldState,
  maxTurns: number,
): CampaignOutcome {
  const nameOf = (id: string): string => getFaction(state, id)?.name ?? id;
  const me = state.playerFactionId;

  const factions: FactionOutcome[] = state.factions.map((f) => {
    const held = systemsOf(state, f.id);
    const heldStart = systemsOf(start, f.id);
    const endIds = new Set(held.map((s) => s.id));
    const startIds = new Set(heldStart.map((s) => s.id));

    const ledger = ledgerFor(state, f.id);
    const systemsDelta = held.length - heldStart.length;
    // A war is not one power's opinion. This read only the subject's OUTWARD
    // disposition, and disposition is asymmetric everywhere else in the game —
    // so a power nobody's own sheet hated ended up with `wars: []` while two
    // other slides in the same epilogue named it as an enemy. Measured live:
    // `krayt` regarded nobody below -46 while `meridian` and `vigil` both
    // regarded it at -100, and the ending said "no war stands open against it"
    // one slide after "the war with the Drajk Confederacy sits open".
    //
    // The last thing a player reads must not contradict itself, and the whole
    // argument for settling these facts in code is that the prose then cannot.
    // Either party at or below the threshold is a war.
    const wars = state.factions
      .filter(
        (other) =>
          other.id !== f.id &&
          ((f.disposition[other.id] ?? 0) <= WAR || (other.disposition[f.id] ?? 0) <= WAR),
      )
      .map((other) => other.name)
      .sort();

    // A verdict from the board, not from the prose. Territory first because it
    // is what a reader of an ending actually means by winning; income breaks
    // the tie for a power that neither gained nor lost ground.
    const arc: FactionOutcome['arc'] =
      held.length === 0
        ? 'broken'
        : systemsDelta > 0
          ? 'ascendant'
          : systemsDelta < 0
            ? 'diminished'
            : ledger.net > 0
              ? 'holding'
              : 'diminished';

    return {
      factionId: f.id,
      name: f.name,
      color: f.displayColor,
      systems: held.length,
      systemsDelta,
      gained: held.filter((s) => !startIds.has(s.id)).map((s) => s.name).sort(),
      lost: heldStart.filter((s) => !endIds.has(s.id)).map((s) => s.name).sort(),
      fleet: fleetStrengthOf(state, f.id),
      credits: f.credits,
      net: ledger.net,
      dissent: f.dissent,
      towardPlayer: f.id === me ? 100 : (f.disposition[me] ?? 0),
      playerToward: f.id === me ? 100 : (getFaction(state, me)?.disposition[f.id] ?? 0),
      wars,
      liveTreaties: state.treaties
        .filter((t) => isTreatyLive(t, state.turn) && t.parties.includes(f.id))
        .map((t) => `${t.type} with ${t.parties.filter((p) => p !== f.id).map(nameOf).join(', ')}`)
        .sort(),
      owes: (state.debts ?? [])
        .filter((d) => isDebtLive(d) && d.debtorFactionId === f.id)
        .reduce((n, d) => n + d.balance, 0),
      owed: (state.debts ?? [])
        .filter((d) => isDebtLive(d) && d.creditorFactionId === f.id)
        .reduce((n, d) => n + d.balance, 0),
      arc,
    };
  });

  // Who ended holding the most — and whether that means anything.
  //
  // This used to be a plain sort with an id tie-break, and the narration duly
  // promoted an arbitrary tie into a stated fact: with all five powers holding
  // four worlds each, the ending announced "the largest single holding, the
  // Arkanis Free Worlds". A tie-break is a way of picking a value, not a
  // finding, so the dossier now reports the tie and the prompt is told what to
  // do with it.
  const most = Math.max(...factions.map((f) => f.systems));
  const leaders = factions.filter((f) => f.systems === most).map((f) => f.factionId).sort();
  const foremost = leaders[0]!;

  return {
    turn: state.turn,
    maxTurns,
    playerFactionId: me,
    factions,
    unaligned: state.systems.filter((s) => s.controllerFactionId === null).length,
    foremost,
    leaders,
  };
}

/**
 * The ending when the model cannot write one.
 *
 * Not a placeholder. The last thing a campaign does must never be an error
 * message, and a call can fail for reasons that have nothing to do with the
 * player — a dropped stream, an overloaded tier, an expired token. This is
 * plain, accurate, and made only of numbers already on the board.
 */
/** Plural agreement, because "1 worlds" in the last line the player reads is a shame. */
const worlds = (n: number): string => `${n} ${n === 1 ? 'world' : 'worlds'}`;

export function fallbackEpilogue(outcome: CampaignOutcome): { closing: string; slides: { factionId: string; text: string }[] } {
  const slides = outcome.factions.map((f) => {
    const ground =
      f.systems === 0
        ? `held nothing at the last, its banner struck from every world it once ruled`
        : f.systemsDelta > 0
          ? `ended holding ${worlds(f.systems)}, ${f.systemsDelta} more than it began with — ${f.gained.join(', ')} among them`
          : f.systemsDelta < 0
            ? `ended holding ${worlds(f.systems)}, having lost ${f.lost.join(', ')}`
            : `ended holding the same ${worlds(f.systems)} it began with`;
    const purse =
      f.net > 0 ? `Its books closed in credit, at ${f.net} a turn.` : `Its books closed in deficit.`;
    const war =
      f.wars.length > 0 ? ` It ended at war with ${f.wars.join(' and ')}.` : ' It ended at peace.';
    return { factionId: f.factionId, text: `The ${f.name} ${ground}. ${purse}${war}` };
  });

  const me = outcome.factions.find((f) => f.factionId === outcome.playerFactionId)!;
  const first = outcome.factions.find((f) => f.factionId === outcome.foremost)!;
  const tied = outcome.leaders.length > 1;
  const standing = tied
    ? `${me.name} finished ${me.arc}, level with every other power at ${worlds(me.systems)}`
    : me.factionId === first.factionId
      ? `${me.name} finished ${me.arc} and foremost, with ${worlds(me.systems)}`
      : `${me.name} finished ${me.arc}, with ${worlds(me.systems)} against the ${first.name}'s ${first.systems}`;

  const closing =
    `After ${outcome.turn} turns the Outer Rim settled into the shape you left it. ` +
    `${standing}. ` +
    (outcome.unaligned === 0
      ? 'Every world answered to somebody.'
      : `${worlds(outcome.unaligned)} still answered to nobody.`);

  return { closing, slides };
}

/* ------------------------------------------------------------------ */
/* Wire shapes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Defined here rather than restated in `api/contract.ts` because this module
 * is the producer, and a second hand-written copy is a drift waiting to
 * happen. `store.ts` reads it too, which is why it does not live in the
 * contract: the engine does not depend on the API layer.
 */
export const FactionOutcomeSchema = z.object({
  factionId: z.string(),
  name: z.string(),
  color: z.number().int(),
  systems: z.number().int(),
  systemsDelta: z.number().int(),
  gained: z.array(z.string()),
  lost: z.array(z.string()),
  fleet: z.number().int(),
  credits: z.number().int(),
  net: z.number().int(),
  dissent: z.number().int(),
  towardPlayer: z.number().int(),
  playerToward: z.number().int(),
  wars: z.array(z.string()),
  liveTreaties: z.array(z.string()),
  owes: z.number().int(),
  owed: z.number().int(),
  arc: z.enum(['ascendant', 'diminished', 'holding', 'broken']),
});

/**
 * How the campaign ended: the facts, and the narration written over them.
 *
 * The split matters most here of anywhere in the game — this is the last thing
 * the player reads, and there is no turn left in which to catch an invented
 * war.
 */
export const EpilogueViewSchema = z.object({
  turn: z.number().int(),
  maxTurns: z.number().int(),
  playerFactionId: z.string(),
  unaligned: z.number().int(),
  foremost: z.string(),
  /** Everyone level on the largest holding. More than one means nobody leads. */
  leaders: z.array(z.string()).default([]),
  factions: z.array(FactionOutcomeSchema),
  slides: z.array(z.object({ factionId: z.string(), text: z.string() })),
  closing: z.string(),
  /** True when the narration call failed and the deterministic ending was used. */
  fallback: z.boolean(),
});
export type EpilogueView = z.infer<typeof EpilogueViewSchema>;

/* ------------------------------------------------------------------ */
/* Writing it                                                          */
/* ------------------------------------------------------------------ */

/** The dossier as prose the narrator can read, one block per power. */
/**
 * Rank one power against the other four on some measure, as a phrase.
 *
 * The narrator is handed comparatives rather than figures, and that is a fix
 * for a measured problem rather than a stylistic preference. Told "treasury
 * 6936" it writes "a treasury of six thousand"; told "the heaviest purse in the
 * Rim" it writes what that meant. Two live runs against a real finished
 * campaign confirmed the instruction alone does not hold — the second produced
 * MORE raw figures than the first — because a dossier that is a table of
 * numbers will be narrated as a table of numbers.
 *
 * Every figure is already rendered on screen beside the prose, so nothing is
 * lost by keeping it out of the text: the reader gets the numbers from the
 * facts row and the meaning from the paragraph.
 */
function standing(value: number, all: number[], words: [string, string, string]): string {
  const sorted = [...all].sort((a, b) => b - a);
  const rank = sorted.indexOf(value);
  const tiedAtTop = sorted.filter((v) => v === sorted[0]).length > 1;
  if (rank === 0 && !tiedAtTop) return words[0];
  if (rank === 0) return `level at the top for ${words[0].replace(/^the /, '')}`;
  if (value === sorted[sorted.length - 1]) return words[2];
  return words[1];
}

export function serializeOutcome(outcome: CampaignOutcome): string {
  const fleets = outcome.factions.map((f) => f.fleet);
  const purses = outcome.factions.map((f) => f.credits);
  const incomes = outcome.factions.map((f) => f.net);

  const lines = [
    `The campaign ran ${outcome.turn} of ${outcome.maxTurns} turns.`,
    `The player commanded \`${outcome.playerFactionId}\`.`,
    outcome.leaders.length > 1
      ? `${outcome.unaligned} worlds ended unaligned. **Nobody ended foremost**: ${outcome.leaders.length} powers finished level on the largest holding (\`${outcome.leaders.join('`, `')}\`). Do not name any of them the largest — say they finished level, or do not raise it.`
      : `${outcome.unaligned} worlds ended unaligned. The largest holding is \`${outcome.foremost}\`.`,
    '',
    '_Standings below are given as comparisons, not counts. The figures are',
    'already on screen beside your prose — write what they meant._',
    '',
  ];

  for (const f of outcome.factions) {
    const dissent =
      f.dissent >= 60
        ? 'its own people have largely stopped following it'
        : f.dissent >= 30
          ? 'its institutions are restive and have been overruled once too often'
          : f.dissent > 0
            ? 'a little grumbling at home, nothing that bites'
            : 'its own institutions stood behind it throughout';

    lines.push(
      `## ${f.name} (\`${f.factionId}\`)${f.factionId === outcome.playerFactionId ? ' — THE PLAYER' : ''}`,
      `- arc: **${f.arc}** (settled; do not overturn)`,
      `- ended holding ${f.systems === 1 ? 'one world' : `${f.systems} worlds`}, ${
        f.systemsDelta > 0
          ? `${f.systemsDelta} more than it began with`
          : f.systemsDelta < 0
            ? `${-f.systemsDelta} fewer than it began with`
            : 'the same number it began with'
      }`,
      f.gained.length > 0 ? `- took: ${f.gained.join(', ')}` : '- took nothing from anyone',
      f.lost.length > 0 ? `- lost: ${f.lost.join(', ')}` : '- lost nothing to anyone',
      `- fleet: ${standing(f.fleet, fleets, ['the largest navy in the Rim', 'a middling navy', 'the thinnest navy of any power still standing'])}`,
      `- treasury: ${standing(f.credits, purses, ['the heaviest purse in the Rim', 'comfortable enough', 'the emptiest treasury of any power still standing'])}`,
      f.net > 0
        ? `- income: in credit — ${standing(f.net, incomes, ['the richest flow in the Rim', 'steady', 'thin, and thinner than anyone else'])}`
        : '- income: running at a loss, and paying for itself out of savings',
      `- at home: ${dissent}`,
      f.wars.length > 0 ? `- at war with: ${f.wars.join(', ')}` : '- at war with nobody',
      f.liveTreaties.length > 0
        ? `- standing agreements: ${f.liveTreaties.join('; ')}`
        : '- no agreement still stands',
      f.owes > 0 ? '- still owes money it has not repaid' : '',
      f.owed > 0 ? '- still owed money nobody has made good' : '',
      f.factionId === outcome.playerFactionId
        ? ''
        : `- toward the player: ${f.towardPlayer <= -75 ? 'open hostility' : f.towardPlayer < 0 ? 'cool' : f.towardPlayer > 50 ? 'warm' : 'correct, no more'}`,
      '',
    );
  }
  return lines.filter((l) => l !== '').join('\n');
}

