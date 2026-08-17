import { z } from 'zod';

/**
 * Debt: a balance that depletes, and a debtor who can fail to pay.
 *
 * ## Why this is not a commitment
 *
 * The Ojjul Nar Combine's sheet is built on debt — *"will not forgive an unpaid
 * debt — the debt is the whole instrument of control"*, *"an unpaid debt must be
 * pursued"* — and for the whole life of the project neither line had anything
 * behind it. The obvious home looked like a `Commitment` with an
 * `incomePerTurn`, and that was tried in the prompts first. It does not work,
 * for three reasons, and each one is a thing this module has to supply:
 *
 * 1. **A commitment's `incomePerTurn` is not directional.** It is one scalar
 *    that every bound faction reads the same way, unlike a treaty's, which is a
 *    record keyed by faction. Measured on the seed: a debt written as one
 *    two-party commitment at 25 paid the creditor 25 **and the debtor 20**.
 *    Both sides earned; nobody paid.
 * 2. **A commitment has no principal.** It is a perpetual flow, so "owe 400"
 *    becomes "pay 25 a turn forever" — nothing counts down, nothing settles,
 *    and repaying in full is indistinguishable from paying tribute.
 * 3. **A commitment has no default.** It is `active` or `dissolved`, and both
 *    of the Combine's lines turn on the word *unpaid*. A debtor who stops
 *    paying was unrepresentable, which left `debt_unpursued` with nothing to
 *    measure.
 *
 * ## Conservation is the point
 *
 * A debt is settled as an explicit transfer in `tickTurn` rather than as a rate
 * in `ledgerFor`, and that is deliberate. A ledger rate cannot know whether the
 * debtor could actually afford the payment: `credits` floors at zero, so a
 * broke debtor would "pay" money it never had and the creditor would receive
 * it. The transfer moves exactly what was there, the balance falls by exactly
 * what moved, and a shortfall is recorded as a missed payment rather than
 * quietly conjured.
 */

export const DebtStatusSchema = z.enum([
  /** Being serviced on schedule. */
  'current',
  /** A payment was missed. The balance stands and the creditor has a grievance. */
  'delinquent',
  /** Paid off in full. */
  'settled',
  /** Written off by the creditor — the act the Combine's red line forbids. */
  'forgiven',
]);
export type DebtStatus = z.infer<typeof DebtStatusSchema>;

export const DebtSchema = z.object({
  id: z.string().min(1),
  creditorFactionId: z.string().min(1),
  debtorFactionId: z.string().min(1),
  /** What was originally owed, kept so a part-paid debt reads as part-paid. */
  principal: z.number().int().min(1),
  /** What is still owed. Falls by exactly what is actually transferred. */
  balance: z.number().int().min(0),
  /** Scheduled repayment. The last instalment is trimmed to the balance. */
  perTurn: z.number().int().min(1),
  status: DebtStatusSchema.default('current'),
  /**
   * How many instalments went unpaid. Never reset by catching up: a creditor's
   * grievance is a fact about the relationship's history, and the Combine's
   * compulsion is about pursuing a debtor who *has* defaulted.
   */
  missedPayments: z.number().int().min(0).default(0),
  establishedTurn: z.number().int().min(0),
  /** One sentence, read back to the player verbatim. */
  text: z.string().min(1).max(240),
});
export type Debt = z.infer<typeof DebtSchema>;

/**
 * Most that can be owed under one arrangement, and the most it can demand a
 * turn.
 *
 * Bounded for the same reason `MAX_COMMITMENT_INCOME` is: a debt is negotiated
 * in a channel, and a model writing both sides of a conversation is the easiest
 * place in the game to invent a number. 1,200 is twenty hulls — enough to fund a
 * war, not enough to end one. Over-asking is trimmed rather than rejected.
 */
export const MAX_DEBT_PRINCIPAL = 1200;
export const MAX_DEBT_PER_TURN = 60;

/** A debt that is still owed: being serviced, or in default. */
export const isDebtLive = (d: Debt): boolean =>
  d.status === 'current' || d.status === 'delinquent';

export function debtsFor(debts: Debt[], factionId: string): Debt[] {
  return debts.filter(
    (d) => isDebtLive(d) && (d.creditorFactionId === factionId || d.debtorFactionId === factionId),
  );
}

/** Live debts this faction is owed. */
export function debtsOwedTo(debts: Debt[], creditorId: string): Debt[] {
  return debts.filter((d) => isDebtLive(d) && d.creditorFactionId === creditorId);
}

/** Live debts this faction owes. */
export function debtsOwedBy(debts: Debt[], debtorId: string): Debt[] {
  return debts.filter((d) => isDebtLive(d) && d.debtorFactionId === debtorId);
}

/** Debtors who have defaulted on this creditor and are still in default. */
export function delinquentDebtorsOf(debts: Debt[], creditorId: string): string[] {
  return [
    ...new Set(
      debts
        .filter((d) => d.status === 'delinquent' && d.creditorFactionId === creditorId)
        .map((d) => d.debtorFactionId),
    ),
  ];
}

/**
 * What this faction is scheduled to move this turn: positive receives, negative
 * pays.
 *
 * Reported by `ledgerFor` and **not** summed into `net`, because it is settled
 * as a transfer during the tick rather than accrued as a rate. Showing it keeps
 * the briefing honest about the drain without charging for it twice.
 */
export function scheduledDebtService(debts: Debt[], factionId: string): number {
  let flow = 0;
  for (const d of debts) {
    if (!isDebtLive(d)) continue;
    const due = Math.min(d.perTurn, d.balance);
    if (d.creditorFactionId === factionId) flow += due;
    if (d.debtorFactionId === factionId) flow -= due;
  }
  return flow;
}

export interface DebtPayment {
  /** What actually moved, which is never more than the debtor had. */
  paid: number;
  /** What was owed this turn. */
  due: number;
  missed: boolean;
}

/**
 * One instalment, priced against what the debtor can actually find.
 *
 * Pure, and returns the payment rather than applying it, so the reducer keeps
 * the only mutation and the arithmetic stays testable on its own.
 */
export function instalment(debt: Debt, debtorCredits: number): DebtPayment {
  const due = Math.min(debt.perTurn, debt.balance);
  const paid = Math.max(0, Math.min(due, debtorCredits));
  return { paid, due, missed: paid < due };
}
