/**
 * The names of the acts the engine can see a power commit — a leaf, so the
 * world's schema can name them without importing what prices them. See
 * `acts.ts` for what each costs and `linesCrossed` for who forbids it.
 */

export const BREACH_KINDS = [
  /** Attacking a partner the attacker has sworn peace with. Breaks the pact on arrival. */
  'attack_under_pact',
  /** Attacking across a truce: the dearest public act in the game. */
  'attack_across_truce',
  /** Attacking in-laws whose marriage was the only peace between them. */
  'attack_on_inlaws',
  /** `break_treaty` on a treaty the breaker is party to. */
  'treaty_repudiated',
  /** `break_treaty` on a marriage the breaker is party to. */
  'marriage_repudiated',
  /** A treaty broken because an ultimatum the breaker conceded demanded it. */
  'treaty_conceded',
  /** A marriage ended by the court that holds its ward, questioning or executing them. */
  'match_betrayed',
  /** `repudiate_obligation`: a favour owed, refused. */
  'favour_repudiated',
  /** A loan not returned, kept or lost. */
  'loan_defaulted',
  /** `dissolve_commitment` by a party to a commitment binding two or more. */
  'commitment_walked',
] as const;
export type BreachKind = (typeof BREACH_KINDS)[number];

/**
 * The acts code can see a power commit, which a red line or a compulsion may
 * name (`docs/design-2026-10-18-code-knows.md` §1). The ten breach kinds are
 * acts already; these are the others the reducer decides and reports.
 *
 * Reported, never priced here: what an act costs is the line's business, and a
 * line is the faction sheet's.
 */
export const ACT_KINDS = [
  ...BREACH_KINDS,
  /** A fleet sent against a power the sender is at peace or under truce with, or one naming a treaty in `breaks`. */
  'pact_attack_ordered',
  /** A blockade ordered. */
  'blockade_ordered',
  /** A raid ordered, open or dark. */
  'raid_ordered',
  /** A fleet carrying lift sent against a world another power holds. */
  'invasion_launched',
  /** A treaty of any kind signed, by each party, with the other. */
  'treaty_signed',
  /** A treaty that keeps the peace, of a type in `PEACE_TREATIES`. */
  'peace_signed',
  /** A defence pact or a coalition signed, by each party: an alliance in public. */
  'alliance_signed',
  /** A marriage treaty signed, by each party. */
  'marriage_signed',
  /** Basing rights granted, by each party: the treaty runs both ways. */
  'basing_granted',
  /** A contract under which another power undertakes not to raid this one. */
  'protection_accepted',
  /** Tribute agreed or conceded, by the payer. */
  'tribute_paid',
  /** A world ceded, by the power that held it. */
  'territory_ceded',
  /** Hulls pledged to a defence pact or a coalition, by the pledger. */
  'defence_pledged',
  /** A debt written off, by the creditor. */
  'debt_forgiven',
  /** Somebody's person sold to a power that is not their own. */
  'person_trafficked',
  /** A gift of credits. */
  'gift_given',
  /** Credits taken, in an accord, beside a peace signed with the payer. Read by the engine. */
  'paid_for_peace',
  /** An accord in which this power gave something and the other gave nothing. Read by the engine. */
  'given_for_nothing',
] as const;
export type ActKind = (typeof ACT_KINDS)[number];
