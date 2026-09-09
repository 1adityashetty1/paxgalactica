import { z } from 'zod';
import { HULL_CLASSES, TypedStackSchema, hullsIn, type HullClass, type ShipStack } from './hulls.js';

/**
 * Loan: a thing lent out, which comes back.
 *
 * ## Why this is not a `Debt`
 *
 * Twelve hulls offered under another power's flag and command landed as
 * `basing_rights` — permission for the *lender's* fleet to visit the borrower's
 * space, which is close to the opposite of a hire. The commonest arrangement in
 * the genre had no representation at all.
 *
 * Restated, a hired squadron is a loan whose principal is hulls, and once it is
 * put that way credits stop being special: a loan could be of money, of ships,
 * or of a thing. That framing is right, and it is exactly why this is a second
 * module rather than four new fields on `Debt`.
 *
 * **The obligation machinery generalises. The balance arithmetic does not.**
 * Default, arrears that catching up never erases, a per-turn disposition cost
 * while the thing is overdue — none of that cares what was lent, and all of it
 * is shared with `debt.ts` down to the constant. But a debt's balance *depletes
 * through its flow*: you pay it down and it is gone. A loan is the opposite
 * shape — what went out comes **back whole**, and the per-turn flow is rent
 * running the other way, borrower to lender. Modelling that as a `Debt` would
 * make the hire fee look like repayment and the squadron's return look like a
 * write-off.
 *
 * That is the shape of the `contract`/`tribute` mistake one file over:
 * `tribute` became the sink for every recurring commercial flow because it was
 * the only type carrying `incomePerTurn`, and it put a power that refuses
 * tribute outright on the paying end of one. **A loan-for-repayment and a
 * loan-for-hire are two instruments, and one of them existing is not a reason
 * to file the other under it.**
 *
 * ## What can be lent, and what cannot
 *
 * Three kinds, and the boundary is *"can it be handed over at all"*:
 *
 * - **credits** — a bullet advance. Rent while it is out, principal back at the
 *   end, which is a different instrument from a `Debt`'s amortising schedule.
 * - **hulls** — the case the whole item exists for. The stack changes flag: the
 *   borrower commands it, the borrower's `fleetStrengthOf` counts it, the
 *   borrower feeds it, and it fights when the borrower says. That is the whole
 *   content of a hire and it comes free, because a fleet in this game is
 *   `system.ships[factionId]` and nothing else.
 * - **an asset** — but only a **portable** one. A mine, an exchange or a
 *   theatre changes hands with its world and by no other route, so lending one
 *   is unrepresentable rather than merely unwise.
 *
 * **A world cannot be lent.** The instrument for a world changing hands is a
 * `cession`, and the instrument for somebody else's fleet sitting on one is
 * `basing_rights`; a lease would be a third answer to a question that already
 * has two, and it would need control, garrison and income to disagree with each
 * other for a while. There is no `systemId` in the union, so this is closed by
 * construction rather than by a guard somebody can forget.
 */

export const LoanStatusSchema = z.enum([
  /** Out on loan, rent current, not yet overdue. */
  'current',
  /** Rent missed, or past due with something still out. */
  'delinquent',
  /** Everything came back. */
  'returned',
  /** The lender stopped asking. What was lent is the borrower's now. */
  'forgiven',
]);
export type LoanStatus = z.infer<typeof LoanStatusSchema>;

export const LentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('credits'),
    /** Trimmed to `MAX_LOAN_CREDITS`, and to what the lender actually holds. */
    amount: z.number().int().min(0).max(100000),
  }),
  z.object({
    kind: z.literal('hulls'),
    /** The squadron. Trimmed to what the lender actually has at `atSystemId`. */
    stack: TypedStackSchema,
    /** Where it stood when it changed flag. */
    atSystemId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('asset'),
    assetId: z.string().min(1),
  }),
]);
export type Lent = z.infer<typeof LentSchema>;

export const LoanSchema = z.object({
  id: z.string().min(1),
  lenderFactionId: z.string().min(1),
  borrowerFactionId: z.string().min(1),
  /** What went out. Never edited, so a part-returned loan reads as part-returned. */
  lent: LentSchema,
  /**
   * What has still to come back, in the same currency as `lent`.
   *
   * `null` once nothing is outstanding. Shrinking a copy of the union rather
   * than keeping an integer beside it is what lets a squadron come back two
   * hulls at a time and still say *which two are still missing*.
   */
  outstanding: LentSchema.nullable().default(null),
  /**
   * The hire fee, borrower to lender, every turn.
   *
   * Zero is legal and means a favour — which is a real arrangement, and one the
   * disposition machinery already prices.
   */
  rentPerTurn: z.number().int().min(0).max(10000),
  /** When it must be back. `null` is "until somebody says otherwise". */
  dueTurn: z.number().int().min(0).nullable().default(null),
  status: LoanStatusSchema.default('current'),
  /**
   * Rent instalments that went unpaid. Never reset by catching up, exactly as
   * `Debt.missedPayments` is not: the grievance is a fact about the history.
   */
  missedPayments: z.number().int().min(0).default(0),
  establishedTurn: z.number().int().min(0),
  /** One sentence, read back to the player verbatim. */
  text: z.string().min(1).max(240),
});
export type Loan = z.infer<typeof LoanSchema>;

/**
 * Bounds on the two figures a model invents.
 *
 * Set at `MAX_DEBT_PRINCIPAL` and `MAX_DEBT_PER_TURN`, because a loan is
 * negotiated in the same channel by the same model writing both sides of the
 * conversation — the easiest place in the game to write down a number nobody
 * argued for. A **hull** loan needs no ceiling of its own: the lender has to
 * actually own the squadron and have it standing where it says, which is a
 * better bound than a constant and one the board enforces.
 */
export const MAX_LOAN_CREDITS = 1200;
export const MAX_LOAN_RENT = 60;

/** Still out: being paid on, or overdue. */
export const isLoanLive = (l: Loan): boolean =>
  l.status === 'current' || l.status === 'delinquent';

export function loansFor(loans: Loan[], factionId: string): Loan[] {
  return loans.filter(
    (l) =>
      isLoanLive(l) &&
      (l.lenderFactionId === factionId || l.borrowerFactionId === factionId),
  );
}

/** Live loans this faction has lent out. */
export const loansOut = (loans: Loan[], lenderId: string): Loan[] =>
  loans.filter((l) => isLoanLive(l) && l.lenderFactionId === lenderId);

/** Live loans this faction is holding somebody else's property under. */
export const loansIn = (loans: Loan[], borrowerId: string): Loan[] =>
  loans.filter((l) => isLoanLive(l) && l.borrowerFactionId === borrowerId);

/**
 * Whether an asset is out on loan right now.
 *
 * The borrower **holds** it — that is what a loan of a thing means — so every
 * guard that keys on `heldBy` waves them through, and a borrower could sell,
 * split or re-lend property it has to give back. This is the one question those
 * guards have to ask.
 */
export function assetOnLoan(loans: Loan[], assetId: string): Loan | undefined {
  return loans.find(
    (l) => isLoanLive(l) && l.outstanding?.kind === 'asset' && l.outstanding.assetId === assetId,
  );
}

/**
 * Rent scheduled to move this turn: positive receives, negative pays.
 *
 * Reported by `ledgerFor` and **not** summed into `net`, for the same reason
 * `debtService` is not: it is settled as a transfer during the tick, against
 * what the borrower can actually find, rather than accrued as a rate. Showing
 * it keeps the briefing honest about the drain without charging for it twice.
 */
export function scheduledRent(loans: Loan[], factionId: string): number {
  let flow = 0;
  for (const l of loans) {
    if (!isLoanLive(l) || l.rentPerTurn === 0) continue;
    if (l.lenderFactionId === factionId) flow += l.rentPerTurn;
    if (l.borrowerFactionId === factionId) flow -= l.rentPerTurn;
  }
  return flow;
}

/**
 * Take as much of `want` out of `have` as the classes allow.
 *
 * A squadron is fungible the moment it merges into the borrower's stack, so
 * *these* hulls can never come back — only their like. Matching class by class
 * is what keeps the return honest anyway: a lender who sent four battleships is
 * not made whole by four lifters, and `takeHulls` would have handed back the
 * cheapest thing on the books.
 */
export function drawMatching(
  have: ShipStack,
  want: ShipStack,
): { taken: ShipStack; short: ShipStack } {
  const taken: ShipStack = {};
  const short: ShipStack = {};
  for (const cls of HULL_CLASSES as readonly HullClass[]) {
    const owed = want[cls] ?? 0;
    if (owed <= 0) continue;
    const here = Math.min(owed, have[cls] ?? 0);
    if (here > 0) taken[cls] = here;
    if (owed - here > 0) short[cls] = owed - here;
  }
  return { taken, short };
}

/** What is still out, said in a sentence. */
export function describeOutstanding(loan: Loan): string {
  const out = loan.outstanding;
  if (out === null) return 'nothing';
  if (out.kind === 'credits') return `${out.amount} credits`;
  if (out.kind === 'asset') return 'the article';
  return `${hullsIn(out.stack)} hulls`;
}
