import { describe, expect, it } from 'vitest';
import { applyOps, DEBT_DEFAULT_DISPOSITION_COST, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  debtsOwedBy,
  debtsOwedTo,
  delinquentDebtorsOf,
  instalment,
  isDebtLive,
  MAX_DEBT_PER_TURN,
  MAX_DEBT_PRINCIPAL,
  scheduledDebtService,
  type Debt,
} from '../src/domain/debt.js';
import { ledgerFor, type WorldState } from '../src/domain/state.js';

/**
 * Debt: a balance that depletes, and a debtor who can fail to pay.
 *
 * The Ojjul Nar Combine's sheet is built on it and neither line had anything
 * behind it. The obvious home — a `Commitment` with an `incomePerTurn` — was
 * tried in the prompts first and does not work: a commitment's income is one
 * scalar every bound faction reads the same way, it has no principal, and it
 * has no default. Measured before this module existed, a debt written that way
 * paid the creditor 25 and the debtor 20. Both sides earned; nobody paid.
 */

const fresh = (player = 'hutt'): WorldState => createSeedState(player);
const fac = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!;
const debt = (s: WorldState, id: string) => s.debts.find((d) => d.id === id)!;
const rich = (s: WorldState, id: string, credits: number): WorldState => {
  fac(s, id).credits = credits;
  return s;
};

describe('an instalment is priced against what the debtor can find', () => {
  const owed = (over: Partial<Debt> = {}): Debt => ({
    id: 'd', creditorFactionId: 'hutt', debtorFactionId: 'krayt',
    principal: 400, balance: 400, perTurn: 25, status: 'current',
    missedPayments: 0, establishedTurn: 0, text: 'owed', ...over,
  });

  it('pays the instalment when the money is there', () => {
    expect(instalment(owed(), 1000)).toEqual({ paid: 25, due: 25, missed: false });
  });

  it('never asks for more than the balance', () => {
    expect(instalment(owed({ balance: 10 }), 1000)).toEqual({ paid: 10, due: 10, missed: false });
  });

  it('pays what it can and records the rest as missed', () => {
    expect(instalment(owed(), 9)).toEqual({ paid: 9, due: 25, missed: true });
  });

  it('pays nothing from an empty treasury', () => {
    expect(instalment(owed(), 0)).toEqual({ paid: 0, due: 25, missed: true });
  });
});

describe('servicing a debt is conserved', () => {
  it('moves exactly what the debtor lost into the creditor, and off the balance', () => {
    // The whole reason this is a transfer in the tick and not a ledger rate.
    const state = rich(fresh(), 'meridian', 5000);
    const before = { hutt: fac(state, 'hutt').credits, meridian: fac(state, 'meridian').credits };
    const owedBefore = debt(state, 'debt-1').balance;

    const after = tickTurn(state).state;

    const moved = owedBefore - debt(after, 'debt-1').balance;
    expect(moved).toBe(25);
    // Income lands in the same tick, so compare the delta attributable to debt
    // by re-running with the debt already settled.
    const control = rich(fresh(), 'meridian', 5000);
    control.debts = control.debts.filter((d) => d.id !== 'debt-1');
    const controlAfter = tickTurn(control).state;

    expect(fac(after, 'meridian').credits).toBe(fac(controlAfter, 'meridian').credits - moved);
    expect(fac(after, 'hutt').credits).toBe(fac(controlAfter, 'hutt').credits + moved);
    expect(before.hutt).toBeGreaterThan(0);
  });

  it('never pays the creditor money the debtor did not have', () => {
    // A ledger rate would: `credits` floors at zero, so a broke debtor would
    // "pay" and the creditor would receive. This is the bug the commitment
    // encoding had, in its purest form.
    const state = fresh();
    state.debts = [
      {
        id: 'debt-x', creditorFactionId: 'hutt', debtorFactionId: 'krayt',
        principal: 400, balance: 400, perTurn: 40, status: 'current',
        missedPayments: 0, establishedTurn: 0, text: 'owed',
      },
    ];
    // Strip Drajk's income to nothing so it genuinely cannot pay.
    for (const sys of state.systems) if (sys.controllerFactionId === 'krayt') sys.controllerFactionId = null;
    fac(state, 'krayt').credits = 0;
    const creditorBefore = fac(state, 'hutt').credits;

    const after = tickTurn(state).state;
    const control = tickTurn({ ...state, debts: [] }).state;

    // Whatever it scraped together — it holds a lane share even with no
    // worlds — is all that moved, and it moved once.
    const paid = 400 - debt(after, 'debt-x').balance;
    expect(paid).toBeLessThan(40);
    expect(fac(after, 'hutt').credits).toBe(fac(control, 'hutt').credits + paid);
    expect(fac(after, 'krayt').credits).toBe(fac(control, 'krayt').credits - paid);
    expect(fac(after, 'krayt').credits).toBeGreaterThanOrEqual(0);
    // Short is short: the shortfall is a default, not a smaller schedule.
    expect(debt(after, 'debt-x').status).toBe('delinquent');
    expect(debt(after, 'debt-x').missedPayments).toBe(1);
    expect(creditorBefore).toBeGreaterThan(0);
  });

  it('settles when the balance reaches zero, and stops charging', () => {
    const state = rich(fresh(), 'meridian', 5000);
    state.debts = [
      {
        id: 'debt-last', creditorFactionId: 'hutt', debtorFactionId: 'meridian',
        principal: 400, balance: 20, perTurn: 25, status: 'current',
        missedPayments: 0, establishedTurn: 0, text: 'nearly done',
      },
    ];

    const after = tickTurn(state).state;
    expect(debt(after, 'debt-last').balance).toBe(0);
    expect(debt(after, 'debt-last').status).toBe('settled');
    expect(isDebtLive(debt(after, 'debt-last'))).toBe(false);

    // A settled debt is inert: nothing further moves.
    const later = tickTurn(after).state;
    expect(debt(later, 'debt-last').balance).toBe(0);
  });
});

describe('default is a state, because both of the Combine’s lines turn on "unpaid"', () => {
  const broke = (): WorldState => {
    const state = fresh();
    state.debts = [
      {
        id: 'debt-d', creditorFactionId: 'hutt', debtorFactionId: 'krayt',
        principal: 400, balance: 400, perTurn: 40, status: 'current',
        missedPayments: 0, establishedTurn: 0, text: 'owed',
      },
    ];
    for (const sys of state.systems) if (sys.controllerFactionId === 'krayt') sys.controllerFactionId = null;
    fac(state, 'krayt').credits = 0;
    return state;
  };

  it('counts each missed instalment', () => {
    let state = broke();
    state = tickTurn(state).state;
    expect(debt(state, 'debt-d').missedPayments).toBe(1);
    state = tickTurn(state).state;
    expect(debt(state, 'debt-d').missedPayments).toBe(2);
  });

  it('costs the debtor standing with the creditor, every turn it continues', () => {
    const state = broke();
    const before = fac(state, 'hutt').disposition['krayt'] ?? 0;
    const after = tickTurn(state).state;
    expect(fac(after, 'hutt').disposition['krayt']).toBe(before - DEBT_DEFAULT_DISPOSITION_COST);
  });

  it('clears the status when payments resume but never the memory', () => {
    let state = broke();
    state = tickTurn(state).state;
    expect(debt(state, 'debt-d').status).toBe('delinquent');

    fac(state, 'krayt').credits = 5000;
    state = tickTurn(state).state;
    expect(debt(state, 'debt-d').status).toBe('current');
    // The relationship remembers. This is what the Combine's compulsion is about.
    expect(debt(state, 'debt-d').missedPayments).toBe(1);
  });

  it('names defaulters for the compulsion to read', () => {
    const state = tickTurn(broke()).state;
    expect(delinquentDebtorsOf(state.debts, 'hutt')).toEqual(['krayt']);
  });
});

describe('lending needs consent; forgiving does not', () => {
  const lend = {
    op: 'establish_debt',
    creditorFactionId: 'hutt',
    debtorFactionId: 'meridian',
    principal: 300,
    perTurn: 20,
    text: 'Meridian takes 300 of Combine paper.',
  };

  it('is rejected from a declared action, with somewhere to go instead', () => {
    const out = applyOps(fresh(), [lend], 'model', 'hutt');
    expect(out.rejections.map((r) => r.code)).toEqual(['needs_consent']);
    expect(out.rejections[0]!.message).toMatch(/\/talk/);
  });

  it('is accepted from the pass that read a transcript', () => {
    const out = applyOps(fresh(), [lend], 'extraction', 'hutt');
    expect(out.rejections).toHaveLength(0);
    const made = out.state.debts.at(-1)!;
    expect(made.balance).toBe(300);
    expect(made.principal).toBe(300);
    expect(made.status).toBe('current');
  });

  it('trims an over-large loan rather than refusing it', () => {
    const out = applyOps(
      fresh(),
      [{ ...lend, principal: 99999, perTurn: 9999 }],
      'extraction',
      'hutt',
    );
    expect(out.rejections).toHaveLength(0);
    const made = out.state.debts.at(-1)!;
    expect(made.principal).toBe(MAX_DEBT_PRINCIPAL);
    expect(made.perTurn).toBe(MAX_DEBT_PER_TURN);
    expect(out.notes.join(' ')).toMatch(/trimmed/i);
  });

  it('refuses a power lending to itself', () => {
    const out = applyOps(
      fresh(),
      [{ ...lend, debtorFactionId: 'hutt' }],
      'extraction',
      'hutt',
    );
    expect(out.rejections.map((r) => r.code)).toEqual(['illegal_value']);
  });

  it('lets the creditor write one off, and pays them in goodwill', () => {
    const state = fresh();
    const before = fac(state, 'krayt').disposition['hutt'] ?? 0;
    const out = applyOps(state, [{ op: 'forgive_debt', debtId: 'debt-0' }], 'model', 'hutt');
    expect(out.rejections).toHaveLength(0);
    expect(debt(out.state, 'debt-0').status).toBe('forgiven');
    expect(fac(out.state, 'krayt').disposition['hutt']).toBeGreaterThan(before);
  });

  it('does not let a debtor write off what it owes', () => {
    // The cheapest possible exploit, and the same actor-shaped hazard that
    // `deploy_agent` and `set_doctrine` are guarded against.
    const out = applyOps(fresh(), [{ op: 'forgive_debt', debtId: 'debt-0' }], 'model', 'krayt');
    expect(out.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(debt(out.state, 'debt-0').status).toBe('delinquent');
  });

  it('stops collecting once forgiven', () => {
    const forgiven = applyOps(
      rich(fresh(), 'krayt', 5000),
      [{ op: 'forgive_debt', debtId: 'debt-0' }],
      'model',
      'hutt',
    ).state;
    const balanceBefore = debt(forgiven, 'debt-0').balance;
    const after = tickTurn(forgiven).state;
    expect(debt(after, 'debt-0').balance).toBe(balanceBefore);
  });
});

describe('the ledger reports debt service without charging for it', () => {
  it('shows what is scheduled, on both sides', () => {
    const state = fresh();
    // 40 from Drajk plus 25 from Meridian, both owed to the Combine.
    expect(ledgerFor(state, 'hutt').debtService).toBe(65);
    expect(ledgerFor(state, 'meridian').debtService).toBe(-25);
    expect(ledgerFor(state, 'krayt').debtService).toBe(-40);
  });

  it('keeps it out of net, because the tick is what moves it', () => {
    // Otherwise a debtor pays twice: once as a rate and once as a transfer.
    const withDebt = fresh();
    const without = { ...fresh(), debts: [] };
    expect(ledgerFor(withDebt, 'meridian').net).toBe(ledgerFor(without, 'meridian').net);
  });

  it('never schedules more than the balance', () => {
    const state = fresh();
    state.debts = [
      {
        id: 'debt-e', creditorFactionId: 'hutt', debtorFactionId: 'krayt',
        principal: 400, balance: 5, perTurn: 40, status: 'current',
        missedPayments: 0, establishedTurn: 0, text: 'nearly done',
      },
    ];
    expect(scheduledDebtService(state.debts, 'hutt')).toBe(5);
  });
});

describe('the seed makes the Combine’s sheet live from turn 0', () => {
  it('gives it a debtor in default and one paying on schedule', () => {
    const state = fresh();
    expect(debtsOwedTo(state.debts, 'hutt')).toHaveLength(2);
    expect(delinquentDebtorsOf(state.debts, 'hutt')).toEqual(['krayt']);
  });

  it('leaves Arkanis owing nobody, because stone-debt is the point', () => {
    // "What is owed for taking help, never paid off, which is why you take
    // none." A power that counts its dead rather than accept grain does not
    // carry a Nar loan.
    expect(debtsOwedBy(fresh().debts, 'freeworlds')).toEqual([]);
  });
});

describe('ids are unique even within one batch', () => {
  /**
   * Found by an adversarial playtest: a negotiated debt restructuring emitted
   * two `establish_debt` ops in one extraction batch and both came out
   * `debt-0-0`, because `mintId`'s pool listed treaties, agents and commitments
   * and never debts. Both ledger entries were real and both ticked correctly,
   * so nothing looked wrong — until an op tried to address one by id.
   */
  const lend = (principal: number) => ({
    op: 'establish_debt',
    creditorFactionId: 'hutt',
    debtorFactionId: 'krayt',
    principal,
    perTurn: 10,
    text: `a note for ${principal}`,
  });

  it('gives two debts minted in the same batch different ids', () => {
    const out = applyOps(fresh(), [lend(200), lend(150)], 'extraction', 'hutt');
    expect(out.rejections).toHaveLength(0);
    const ids = out.state.debts.map((d) => d.id);
    expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
  });

  it('keeps them distinct across turns too', () => {
    let state = applyOps(fresh(), [lend(200)], 'extraction', 'hutt').state;
    state = tickTurn(state).state;
    state = applyOps(state, [lend(150), lend(120)], 'extraction', 'hutt').state;
    const ids = state.debts.map((d) => d.id);
    expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
  });

  it('so a later op addresses exactly one of them', () => {
    const made = applyOps(fresh(), [lend(200), lend(150)], 'extraction', 'hutt').state;
    const target = made.debts.at(-1)!;
    const out = applyOps(made, [{ op: 'forgive_debt', debtId: target.id }], 'model', 'hutt');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.debts.filter((d) => d.status === 'forgiven')).toHaveLength(1);
  });
});
