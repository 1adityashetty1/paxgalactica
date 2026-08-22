import { z } from 'zod';

/**
 * Commitments: durable facts the game has no dedicated mechanic for.
 *
 * The player can attempt anything, which means they will regularly attempt
 * things the op vocabulary cannot express — a dynastic marriage, an exclusive
 * charter, a hostage exchange, a shared succession. Those are not treaties
 * (they have no per-turn terms the reducer applies) and they are not events
 * (an event is something that happened; these are things that remain true).
 *
 * Without somewhere to put them, an arbitrator has no memory: it would allow a
 * political marriage with the Nars on turn 3 and, having forgotten, allow a
 * second one with Meridian on turn 4. The obvious-looking fix — "tell the
 * model what happened and trust it to be consistent" — is exactly the failure
 * this codebase avoids everywhere else. So the arbitrator RULES that a thing
 * is exclusive, and the reducer ENFORCES that ruling.
 *
 * The division is the same as everywhere: the prompt owns the interpretation,
 * code owns the rule.
 */

export const CommitmentSchema = z.object({
  id: z.string().min(1),
  /**
   * A slug for the kind of thing this is: `dynastic_marriage`,
   * `exclusive_charter`, `hostage_exchange`. Deliberately free-form — the
   * whole point is to hold arrangements nobody enumerated in advance — but
   * exclusivity is checked on this string, so it must be stable.
   */
  kind: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'kind must be a lower_snake_case slug'),
  /** Everyone bound by it. One party for an internal vow, two for a pact. */
  factionIds: z.array(z.string().min(1)).min(1).max(5),
  /** One sentence, written to be read back to the player verbatim. */
  text: z.string().min(1).max(240),
  /**
   * At most one live commitment of this `kind` per bound faction.
   *
   * This is the flag that makes the marriage example work: you may marry into
   * one house, and the second attempt is refused by the reducer rather than
   * by the arbitrator remembering.
   */
  exclusive: z.boolean().default(false),
  /**
   * What the arrangement is worth per turn to each faction bound by it —
   * positive for a smuggling operation or a charter, negative for a tribute or
   * a protection payment.
   *
   * Commitments were economically inert for their whole existence: a
   * `mining_operation` commitment appeared in the UI, lowered future related
   * difficulties, and paid nothing forever. `ledgerFor` now reads this, which is
   * what makes an off-mechanic arrangement worth arranging.
   *
   * Bounds are generous here and real in code (`MAX_COMMITMENT_INCOME`, and a
   * per-faction ceiling from `maxCommitmentIncomeFor`) so an over-large ask is
   * trimmed with a note rather than costing a correction round trip.
   */
  incomePerTurn: z.number().int().min(-500).max(500).default(0),
  establishedTurn: z.number().int().min(0),
  status: z.enum(['active', 'dissolved']).default('active'),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

/**
 * Most any single arrangement can be worth per turn.
 *
 * A commitment is the catch-all for things nobody enumerated, so it is the
 * easiest place in the game for a model to invent revenue. 25 a turn is
 * material against net incomes of 87–300 and cannot on its own fund a war.
 */
export const MAX_COMMITMENT_INCOME = 25;

/**
 * What binding yourself to another power is worth in standing, each way.
 *
 * A commitment with no `incomePerTurn` was mechanically inert — and a playtest
 * closed five accords that each produced one: `open_hand_pact`,
 * `imperial_recognition`, `debt_service_share`, `intelligence_notice`,
 * `intel_sharing_drajk`. A war subsidy, a tenth of all prizes and a standing
 * intelligence duty all became decoration, because any obligation without a
 * mechanical home silently becomes flavour.
 *
 * The answer is not to stop recording them — the record is the useful part, and
 * the arbiter reads it — but to make the record *bite*. Two powers that have
 * bound themselves to each other are on better terms for it, and that is true
 * whether or not money moves.
 *
 * Deliberately modest, and **only between the parties**: unlike a treaty, a
 * commitment is not public business, so onlookers have no view. It is also the
 * thing that makes a commitment costly to walk away from, since dissolving one
 * takes the goodwill back.
 */
export const COMMITMENT_GOODWILL = 5;

/**
 * Everything a faction may draw from arrangements at once.
 *
 * Derived from `influence` rather than being a flat constant, the way
 * `maxAgentsFor` derives from guile and `subornLimit` from a stat contest: the
 * work of holding a web of informal arrangements together IS influence. It puts
 * Meridian at 50 and the Iron Vigil at the 10 floor, which is where the lore
 * wants them — a trading authority runs charters, and a military remnant does
 * not. Costs (negative commitments) are deliberately uncapped: nothing needs
 * protecting from a faction agreeing to pay.
 */
export const COMMITMENT_INCOME_BASE = 20;
export const COMMITMENT_INCOME_PER_INFLUENCE = 10;
export const MIN_COMMITMENT_INCOME_CEILING = 10;

/**
 * What a faction actually collects from its live commitments, after the
 * per-faction ceiling. `ceiling` is passed in rather than computed here so this
 * module stays free of any dependency on stats.
 */
export function commitmentIncomeFor(
  commitments: Commitment[],
  factionId: string,
  ceiling: number,
): number {
  let earned = 0;
  let owed = 0;
  for (const c of commitmentsFor(commitments, factionId)) {
    if (c.incomePerTurn > 0) earned += c.incomePerTurn;
    else owed += c.incomePerTurn;
  }
  return Math.min(earned, Math.max(0, ceiling)) + owed;
}

export const isCommitmentLive = (c: Commitment): boolean => c.status === 'active';

/** Live commitments binding this faction. */
export function commitmentsFor(commitments: Commitment[], factionId: string): Commitment[] {
  return commitments.filter((c) => isCommitmentLive(c) && c.factionIds.includes(factionId));
}

/**
 * The faction that already holds an exclusive commitment of this kind, if any.
 *
 * Returns the blocking commitment rather than a boolean so the rejection can
 * quote it: "the Combine is already bound by the Ojjul marriage" is an answer
 * a player can act on, where "not allowed" is not.
 */
export function conflictingCommitment(
  commitments: Commitment[],
  kind: string,
  factionIds: string[],
): Commitment | undefined {
  return commitments.find(
    (c) =>
      isCommitmentLive(c) &&
      c.exclusive &&
      c.kind === kind &&
      c.factionIds.some((id) => factionIds.includes(id)),
  );
}
