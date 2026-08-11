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
 * political marriage with the Hutts on turn 3 and, having forgotten, allow a
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
  establishedTurn: z.number().int().min(0),
  status: z.enum(['active', 'dissolved']).default('active'),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

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
