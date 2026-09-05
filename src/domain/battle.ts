import { z } from 'zod';
import { ShipStackSchema } from './hulls.js';

/**
 * A battle, as a record rather than a sentence.
 *
 * `resolveBattle` computes the seeded roll, both might modifiers, the powers
 * the 2:1 break-off test compares, the retreat loss percentage, proportional
 * per-contingent losses, the dug-in garrison value and the assault total — and
 * for the whole life of the project it flattened all of that into one line of
 * prose and threw the rest away. The player saw *"Fleets engage over Kalzir:
 * Meridian loses 24, defenders lose 20."* and had no way to learn which phase
 * decided it, what the roll was, or what was left standing.
 *
 * That got worse the moment war ethics gained mechanical force: a crusading
 * power refusing to break off, a defensive garrison fighting at 1.5x, an
 * opportunist's bonus against a distracted holder and an expansionist's
 * consolidated occupation are all invisible in play. We built mechanics nobody
 * could observe. `doctrinesFired` exists to answer exactly that.
 *
 * ## Built for a combat model that does not exist yet
 *
 * Combat resolves in a single tick today, and whether it should stay that way
 * is deliberately unsettled. So this is shaped as an **engagement made of
 * rounds**, each stamped with the turn it happened on, rather than as a flat
 * record of one exchange. Today an engagement opens and closes in one turn with
 * one or two rounds. If combat later spans turns, rounds append and `status`
 * stays `'ongoing'` — the schema and the renderer do not change. A richer
 * resolver changes the *producer*, not this.
 *
 * Nothing here is stored on `WorldState`. A report is derived from a battle
 * that already happened, it rides out on the turn report, and it is
 * reproducible by replaying the tick that made it — so persisting it would be a
 * second source of truth for something the journal can already regenerate.
 */

export const BATTLE_OUTCOMES = [
  /** Nobody in orbit, nobody on the ground. Walked in. */
  'unopposed',
  /** Outmatched 2:1, the defending fleet scattered to another holding. */
  'defender_broke_off',
  /** Outmatched 2:1 the other way; the coalition fell back down its path. */
  'attacker_driven_off',
  /** Neither side broke: both traded losses proportionally. */
  'exchange',
  /** A defending fleet survived, so no landing was attempted at all. */
  'no_landing',
    /**
     * A holder cleared rivals out of its own orbit. Ship against ship only —
     * the garrison takes no part, because the squatters never held the ground
     * and there is none to take.
     */
    'orbit_cleared',
  /** The attackers won the orbitals and had nothing left to land. */
  'force_spent',
  /** The garrison broke and the world changed hands. */
  'world_taken',
  /** The garrison held and threw the landing back. */
  'landing_thrown_back',
  /**
   * Torpedo boats fired before the fleets closed.
   *
   * The one exchange in the battle that is superadditive: what it destroys is
   * not brought to the trade that follows, so it lowers both sides' losses
   * there as well.
   */
  'torpedo_strike',
  /**
   * The orbitals were won and there was nothing aboard to put ashore.
   *
   * A world is taken by the lift arm, so an all-warship fleet can sterilise a
   * system and take nothing. Distinct from `force_spent`, where there were
   * troops and they were destroyed getting there.
   */
  'no_lift',
] as const;
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

/** One faction's ships in this battle, before and after. */
export const ContingentSchema = z.object({
  factionId: z.string(),
  factionName: z.string(),
  before: z.number().int().min(0),
  after: z.number().int().min(0),
  /**
   * What it was made of, before and after.
   *
   * Two hull counts stopped being the whole story the moment a fleet could be
   * composed: a coalition that arrives with twelve ships and leaves with eight
   * has lost a very different battle depending on whether the four were escorts
   * or the entire lift arm. Optional, so a report from before classes existed
   * still parses; the renderer falls back to the totals.
   */
  stackBefore: ShipStackSchema.default({}),
  stackAfter: ShipStackSchema.default({}),
});
export type Contingent = z.infer<typeof ContingentSchema>;

export const BattleRoundSchema = z.object({
  /** Stamped per round so rounds can span turns without a schema change. */
  turn: z.number().int().min(0),
  phase: z.enum(['strike', 'orbital', 'ground']),
  outcome: z.enum(BATTLE_OUTCOMES),
  /**
   * The two numbers the break-off test actually compared, rounded for display.
   * Zero on the ground phase, which compares an assault total to a garrison.
   */
  attackPower: z.number().int(),
  defendPower: z.number().int(),
  /** Ground phase only: the assault total against the garrison it faced. */
  assault: z.number().int().default(0),
  garrison: z.number().int().default(0),
  /** What the garrison fought as, after a defensive power's dug-in bonus. */
  garrisonEffective: z.number().int().default(0),
  attackers: z.array(ContingentSchema).default([]),
  defenders: z.array(ContingentSchema).default([]),
  /** The prose this round produced, kept so the log and the panel agree. */
  note: z.string().default(''),
});
export type BattleRound = z.infer<typeof BattleRoundSchema>;

export const BattleReportSchema = z.object({
  /** `${systemId}:${turn}` — stable and derivable, so it replays identically. */
  id: z.string(),
  systemId: z.string(),
  systemName: z.string(),
  turn: z.number().int().min(0),
  /**
   * The seeded d20 this battle turned on. Shown deliberately: the salt is
   * `combat:${systemId}:${turn}`, so it was always derivable, and the project
   * already writes every ability check to the log so a campaign's luck is
   * auditable. A battle should be no different.
   */
  roll: z.number().int(),
  attackMod: z.number().int(),
  defendMod: z.number().int(),
  /**
   * Which war ethics actually changed this battle, in plain words. Empty when
   * no doctrine altered the outcome — a crusading power that was never asked to
   * retreat does not appear here.
   */
  doctrinesFired: z.array(z.string()).default([]),
  holderBefore: z.string().nullable(),
  holderAfter: z.string().nullable(),
  garrisonBefore: z.number().int().min(0),
  garrisonAfter: z.number().int().min(0),
  rounds: z.array(BattleRoundSchema).default([]),
  /** `'ongoing'` is unreachable today and is the multi-turn hook. */
  status: z.enum(['resolved', 'ongoing']).default('resolved'),
  /** The whole engagement in one line, as the event log records it. */
  note: z.string().default(''),
});
export type BattleReport = z.infer<typeof BattleReportSchema>;

/** Did this battle change who holds the world? */
export function changedHands(report: BattleReport): boolean {
  return report.holderBefore !== report.holderAfter;
}

/** Total hulls destroyed on both sides, for a one-line summary. */
export function totalLosses(report: BattleReport): { attackers: number; defenders: number } {
  let attackers = 0;
  let defenders = 0;
  for (const round of report.rounds) {
    for (const c of round.attackers) attackers += Math.max(0, c.before - c.after);
    for (const c of round.defenders) defenders += Math.max(0, c.before - c.after);
  }
  return { attackers, defenders };
}
