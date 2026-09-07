import { z } from 'zod';
import { isTreatyLive } from '../domain/diplomacy.js';
import type { ControlChange } from './journal.js';
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

/**
 * One power's ending, as facts.
 *
 * Inferred from `FactionOutcomeSchema` rather than declared beside it. It was
 * declared twice — a hand-written interface here and a Zod restatement two
 * hundred lines down — and the two duly disagreed the first time a field
 * changed type. Same defect as the `Ledger` copy in `api/contract.ts`, and the
 * same fix: one definition, and the other side imports it.
 */
export type FactionOutcome = z.infer<typeof FactionOutcomeSchema>;

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
  /**
   * How many times any world changed hands, across the whole campaign.
   *
   * Zero is a real and narratable answer — a cold war nobody won — and it is
   * one an endpoint difference could never distinguish from a war fought to a
   * draw over the same four worlds.
   */
  upheavals: number;
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
  /**
   * Every change of control across the campaign, from `controlHistory`.
   *
   * Optional, so `campaignOutcome` stays callable from a pair of states — the
   * endpoint facts do not need it, and a caller without a journal should get a
   * dossier that is thinner rather than one that throws. When it is absent
   * `took`, `ceded` and `contested` are empty and the prompt says so, rather
   * than the narration being free to guess.
   */
  history: readonly ControlChange[] = [],
): CampaignOutcome {
  const nameOf = (id: string): string => getFaction(state, id)?.name ?? id;
  const me = state.playerFactionId;

  // How often each world changed hands, so "contested" is a fact about the
  // campaign rather than an impression from the last turn of it.
  const turnovers = new Map<string, number>();
  for (const c of history) turnovers.set(c.systemId, (turnovers.get(c.systemId) ?? 0) + 1);

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
    // `drajk` regarded nobody below -46 while `meridian` and `vigil` both
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
      // In the order they happened, and NOT sorted or deduplicated: taking a
      // world back is a second taking, and the sequence is the story.
      took: history.filter((c) => c.to === f.id).map((c) => c.systemName),
      ceded: history.filter((c) => c.from === f.id).map((c) => c.systemName),
      contested: [
        ...new Set(
          history
            .filter(
              (c) => (c.to === f.id || c.from === f.id) && (turnovers.get(c.systemId) ?? 0) > 1,
            )
            .map((c) => c.systemName),
        ),
      ].sort(),
      fleet: fleetStrengthOf(state, f.id),
      credits: f.credits,
      net: ledger.net,
      dissent: f.dissent,
      // `null`, not 100. A faction holds no disposition toward itself — the
      // reducer rejects the op that would set one — so a synthesised 100 was a
      // fact invented inside the one document whose whole selling point is
      // "settled; do not overturn". Absent is the honest value, and typing it
      // as nullable is what forces every reader to say so rather than print a
      // number nothing stands behind.
      towardPlayer: f.id === me ? null : (f.disposition[me] ?? 0),
      playerToward: f.id === me ? null : (getFaction(state, me)?.disposition[f.id] ?? 0),
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
  // Arkane Free Worlds". A tie-break is a way of picking a value, not a
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
    upheavals: history.length,
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
    `After ${outcome.turn} turns the Rim settled into the shape you left it. ` +
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
  /** Worlds held at the end, and the change from where they started. */
  systems: z.number().int(),
  systemsDelta: z.number().int(),
  /**
   * Worlds taken and lost by name, comparing the opening board to the closing
   * one. Right about where things ended, and silent about how they got there —
   * a world taken and lost again cancels out of both lists. See `took`/`ceded`.
   */
  gained: z.array(z.string()),
  lost: z.array(z.string()),
  /**
   * Every world this power took, and every world it lost, **as it happened**.
   *
   * A campaign's only conquest changed hands three times and appeared in
   * neither `gained` nor `lost`, so the ending reported that no flag was
   * planted or struck after three battles were fought over it. A set difference
   * cannot see a war that ended where it began, which is most of them.
   *
   * In the order they happened, and names may repeat: taking a world back is a
   * second taking, and saying so is the point.
   *
   * Defaulted, so an epilogue written before this existed still loads — a
   * finished campaign is read back from disk, and it must open with the ending
   * the player was given rather than fail to open at all.
   */
  took: z.array(z.string()).default([]),
  ceded: z.array(z.string()).default([]),
  /** Worlds this power fought over that changed hands more than once. */
  contested: z.array(z.string()).default([]),
  fleet: z.number().int(),
  credits: z.number().int(),
  net: z.number().int(),
  dissent: z.number().int(),
  /**
   * How this power ended up regarding the player, and vice versa.
   *
   * `null` on the player's own slide: nobody holds a disposition toward
   * themselves, and the reducer rejects the op that would set one. It was
   * synthesised as 100, which put an invented fact in the one document sold to
   * the narration as "settled; do not overturn".
   */
  towardPlayer: z.number().int().nullable(),
  playerToward: z.number().int().nullable(),
  /** Powers it is at war with — either party at or below -75. */
  wars: z.array(z.string()),
  liveTreaties: z.array(z.string()),
  /** Debts still owed to and by this power at the final bell. */
  owes: z.number().int(),
  owed: z.number().int(),
  /** A one-word verdict computed from the above, never chosen by a model. */
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
  /** How many times any world changed hands across the campaign. */
  upheavals: z.number().int().default(0),
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
    outcome.upheavals === 0
      ? '**No world changed hands in the whole campaign.** Whatever else happened, the map is where it started — do not write a conquest.'
      : `${outcome.upheavals} changes of control across the campaign. Where a power took a world and lost it again, both are listed below and BOTH ARE TRUE: the net position and the fight over it are different facts, and a war that ended where it began is still a war that was fought.`,
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
      // Endpoints AND history, said as two different things, because they
      // answer different questions and can disagree honestly: a world taken and
      // taken back is in `took` twice and in `gained` not at all. Naming the
      // net position "on balance" is what stops the two reading as a
      // contradiction.
      f.gained.length > 0
        ? `- holds, that it did not start with: ${f.gained.join(', ')}`
        : '- ends holding nothing it did not start with',
      f.lost.length > 0
        ? `- started with, and no longer holds: ${f.lost.join(', ')}`
        : '- kept everything it started with',
      f.took.length > 0
        ? `- **worlds it took, in the order it took them**: ${f.took.join(', ')} — a name twice means it was taken back`
        : '',
      f.ceded.length > 0
        ? `- **worlds it lost, in the order it lost them**: ${f.ceded.join(', ')}`
        : '',
      f.contested.length > 0
        ? `- **fought over more than once**: ${f.contested.join(', ')}. This is the ground that mattered; reach for it before anything else.`
        : '',
      f.took.length === 0 && f.ceded.length === 0
        ? '- no world ever changed hands with this power, in either direction'
        : '',
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
      f.towardPlayer === null
        ? ''
        : `- toward the player: ${f.towardPlayer <= -75 ? 'open hostility' : f.towardPlayer < 0 ? 'cool' : f.towardPlayer > 50 ? 'warm' : 'correct, no more'}`,
      // The campaign's own history, which is what an endpoint difference
      // cannot supply — a world taken and taken back appears in neither
      // `gained` nor `lost`, and three battles read as "nothing happened".
      f.took.length > 0 ? `- worlds taken, in order: ${f.took.join(', ')}` : '',
      f.ceded.length > 0 ? `- worlds lost, in order: ${f.ceded.join(', ')}` : '',
      f.contested.length > 0
        ? `- fought over more than once: ${f.contested.join(', ')}`
        : '',
      '',
    );
  }
  return lines.filter((l) => l !== '').join('\n');
}

