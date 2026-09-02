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
    const wars = Object.entries(f.disposition)
      .filter(([, v]) => v <= WAR)
      .map(([id]) => nameOf(id))
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

  const foremost = [...factions]
    .sort((a, b) => b.systems - a.systems || a.factionId.localeCompare(b.factionId))[0]!.factionId;

  return {
    turn: state.turn,
    maxTurns,
    playerFactionId: me,
    factions,
    unaligned: state.systems.filter((s) => s.controllerFactionId === null).length,
    foremost,
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
  const standing =
    me.factionId === first.factionId
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
export function serializeOutcome(outcome: CampaignOutcome): string {
  const lines = [
    `The campaign ran ${outcome.turn} of ${outcome.maxTurns} turns.`,
    `The player commanded \`${outcome.playerFactionId}\`.`,
    `${outcome.unaligned} worlds ended unaligned. The largest holding is \`${outcome.foremost}\`.`,
    '',
  ];
  for (const f of outcome.factions) {
    lines.push(
      `## ${f.name} (\`${f.factionId}\`)${f.factionId === outcome.playerFactionId ? ' — THE PLAYER' : ''}`,
      `- arc: **${f.arc}** (settled; do not overturn)`,
      `- worlds: ${f.systems} (${f.systemsDelta >= 0 ? '+' : ''}${f.systemsDelta} from the start)`,
      f.gained.length > 0 ? `- took: ${f.gained.join(', ')}` : '- took: nothing',
      f.lost.length > 0 ? `- lost: ${f.lost.join(', ')}` : '- lost: nothing',
      `- fleet ${f.fleet} hulls, treasury ${f.credits}, net income ${f.net}/turn`,
      f.dissent > 0 ? `- internal dissent: ${f.dissent}/100` : '- its own institutions stood behind it',
      f.wars.length > 0 ? `- at war with: ${f.wars.join(', ')}` : '- at war with nobody',
      f.liveTreaties.length > 0
        ? `- standing agreements: ${f.liveTreaties.join('; ')}`
        : '- no agreement still stands',
      f.owes > 0 ? `- still owes ${f.owes}` : '',
      f.owed > 0 ? `- still owed ${f.owed}` : '',
      f.factionId === outcome.playerFactionId
        ? ''
        : `- regards the player at ${f.towardPlayer}; the player regards it at ${f.playerToward}`,
      '',
    );
  }
  return lines.filter((l) => l !== '').join('\n');
}
