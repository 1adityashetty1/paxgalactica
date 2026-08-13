import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  DEVELOPMENT_PAYBACK_TURNS,
  developmentCost,
  EFFECT_CAPS,
  EFFECT_COST,
  effectsAllowedFor,
  MIN_DEVELOPMENT_COST,
  priceOrderEffect,
  trimOrderEffect,
} from '../src/domain/development.js';
import { DURATION_CATEGORIES } from '../src/domain/duration.js';
import {
  ledgerFor,
  maxCommitmentIncomeFor,
  SHIP_COST,
  type Op,
  type WorldState,
} from '../src/domain/state.js';
import {
  MAX_COMMITMENT_INCOME,
  MIN_COMMITMENT_INCOME_CEILING,
} from '../src/domain/arbitration.js';
import { HUB_THRESHOLD, tradeHubs, tradeRoutes } from '../src/domain/trade.js';

/**
 * Completed orders used to change nothing at all.
 *
 * The probe that opened this gap ran four kinds of work to completion and
 * watched strategic value, income and garrison come out identical to a world
 * where no order had ever been issued — the garrison movement it did see was
 * passive regrowth, which is why every test below that touches a garrison
 * compares against the *same order without a payload* rather than against the
 * starting state. That is the only comparison that can tell a programme apart
 * from the world simply ticking on.
 */

const fresh = (player = 'meridian'): WorldState => createSeedState(player);
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;

/** Tick until every pending order has resolved. */
function runOut(state: WorldState, limit = 12): WorldState {
  let out = state;
  for (let i = 0; i < limit && out.pendingOrders.length > 0; i++) out = tickTurn(out).state;
  return out;
}

/** Issue one order and tick it to completion, asserting it was accepted. */
function programme(ops: Op[], player = 'meridian') {
  const state = fresh(player);
  const issued = applyOps(state, ops, 'model', player);
  expect(issued.rejections).toHaveLength(0);
  return { issued, finished: runOut(issued.state) };
}

/**
 * A development on tio-1 (Meridian, value 7). Deliberately an *ordinary* point
 * rather than one that crosses into hub status: those are priced from what they
 * unlock and cost an order of magnitude more, which the hub tests below assert
 * directly.
 */
const develop = (targetId: string, magnitude = 1, factionId = 'meridian'): Op => ({
  op: 'issue_order',
  factionId,
  type: 'construction_infrastructure',
  originId: targetId,
  targetId,
  durationTurns: 3,
  label: 'orbital works',
  onComplete: { kind: 'develop_system', magnitude, summary: 'yards and refineries' },
});

describe('a completed programme changes the world', () => {
  it('raises strategic value, which was previously immutable at runtime', () => {
    const before = sys(fresh(), 'tio-1').strategicValue;
    const { finished } = programme([develop('tio-1', 2)]);
    expect(sys(finished, 'tio-1').strategicValue).toBe(before + 2);
  });

  it('raises the income that strategic value pays, so the investment returns', () => {
    const plain = runOut(fresh());
    const { finished } = programme([develop('tio-1', 2)]);
    expect(ledgerFor(finished, 'meridian').territory).toBeGreaterThan(
      ledgerFor(plain, 'meridian').territory,
    );
  });

  it('says what it delivered, in the note the player actually reads', () => {
    const state = fresh();
    const issued = applyOps(state, [develop('tio-1', 1)], 'model', 'meridian');
    let out = issued.state;
    let notes: string[] = [];
    for (let i = 0; i < 4 && out.pendingOrders.length > 0; i++) {
      const tick = tickTurn(out);
      out = tick.state;
      notes = tick.notes;
    }
    expect(notes.join(' ')).toMatch(/strategic value 7 -> 8/);
  });

  it('leaves an order with no payload changing nothing, which is right for a decree', () => {
    const state = fresh();
    const issued = applyOps(
      state,
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'construction_infrastructure',
          originId: 'slu-2', targetId: 'slu-2', durationTurns: 3, label: 'surveys',
        },
      ],
      'model',
      'meridian',
    );
    const finished = runOut(issued.state);
    expect(sys(finished, 'slu-2').strategicValue).toBe(sys(state, 'slu-2').strategicValue);
    expect(finished.pendingOrders).toHaveLength(0);
  });

  it('stops at the ceiling and says so rather than silently overshooting', () => {
    const state = fresh();
    sys(state, 'tio-1').strategicValue = 10;
    const issued = applyOps(state, [develop('tio-1', 2)], 'model', 'meridian');
    expect(issued.rejections).toHaveLength(0);
    let out = issued.state;
    let notes: string[] = [];
    for (let i = 0; i < 4 && out.pendingOrders.length > 0; i++) {
      const tick = tickTurn(out);
      out = tick.state;
      notes = tick.notes;
    }
    expect(sys(out, 'tio-1').strategicValue).toBe(10);
    expect(notes.join(' ')).toMatch(/as far as it can be/);
  });
});

describe('garrison work, told apart from passive regrowth', () => {
  it('raises a garrison by the amount bought, on top of what regrowth gives', () => {
    const withPayload = fresh();
    sys(withPayload, 'slu-2').garrison = 2;
    const without = structuredClone(withPayload);

    const raised = runOut(
      applyOps(
        withPayload,
        [
          {
            op: 'issue_order', factionId: 'meridian', type: 'garrison_raising',
            originId: 'slu-2', targetId: 'slu-2', durationTurns: 3, label: 'levy',
            onComplete: { kind: 'raise_garrison', magnitude: 4 },
          },
        ],
        'model',
        'meridian',
      ).state,
    );
    const idle = runOut(
      applyOps(
        without,
        [
          {
            op: 'issue_order', factionId: 'meridian', type: 'garrison_raising',
            originId: 'slu-2', targetId: 'slu-2', durationTurns: 3, label: 'levy',
          },
        ],
        'model',
        'meridian',
      ).state,
    );

    expect(sys(raised, 'slu-2').garrison - sys(idle, 'slu-2').garrison).toBe(4);
  });

  it('fortifies by raising the ceiling, which regrowth can never do', () => {
    const state = fresh();
    const before = sys(state, 'slu-2').garrisonMax;
    const finished = runOut(
      applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'meridian', type: 'fortification',
            originId: 'slu-2', targetId: 'slu-2', durationTurns: 3, label: 'bastion',
            onComplete: { kind: 'fortify', magnitude: 2 },
          },
        ],
        'model',
        'meridian',
      ).state,
    );
    expect(sys(finished, 'slu-2').garrisonMax).toBe(before + 2);
  });
});

describe('hulls from a construction programme', () => {
  it('delivers them at the target, and bills them exactly once', () => {
    const state = fresh();
    const before = sys(state, 'slu-2').ships['meridian'] ?? 0;
    const issued = applyOps(
      state,
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'capital_ship_construction',
          originId: 'slu-2', targetId: 'slu-2', durationTurns: 5, label: 'battle line',
          onComplete: { kind: 'commission_ships', magnitude: 3 },
        },
      ],
      'model',
      'meridian',
    );
    expect(issued.rejections).toHaveLength(0);

    // Charged at issue, not at delivery.
    const paid = fac(state, 'meridian').credits - fac(issued.state, 'meridian').credits;
    expect(paid).toBe(3 * SHIP_COST);

    const atIssue = fac(issued.state, 'meridian').credits;
    const finished = runOut(issued.state);
    expect(sys(finished, 'slu-2').ships['meridian']).toBe(before + 3);
    // Income and upkeep move credits over five turns, so the assertion that
    // matters is that DELIVERY did not charge again: the hulls arrived without
    // a second SHIP_COST debit landing on the completion turn.
    expect(fac(finished, 'meridian').credits).toBeGreaterThan(atIssue - 3 * SHIP_COST);
  });

  it('prices hulls exactly as the yards price them, so a programme is no cheaper', () => {
    expect(EFFECT_COST.commission_ships).toBe(SHIP_COST);
  });
});

describe('the payload is bounded in code, not in a prompt', () => {
  it('refuses a kind the order category cannot plausibly deliver', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'garrison_raising',
          originId: 'slu-2', targetId: 'slu-2', durationTurns: 3,
          onComplete: { kind: 'develop_system', magnitude: 2 },
        },
      ],
      'model',
      'meridian',
    );
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0]!.code).toBe('illegal_value');
    // The message names what this category CAN do, so a correction pass has
    // something to aim at rather than only being told no.
    expect(out.rejections[0]!.message).toMatch(/raise_garrison/);
    expect(out.state.pendingOrders).toHaveLength(0);
  });

  it('refuses a payload on a category that carries none, and says why', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'courier',
          originId: 'slu-2', targetId: 'slu-1', durationTurns: 1,
          onComplete: { kind: 'develop_system', magnitude: 1 },
        },
      ],
      'model',
      'meridian',
    );
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(out.rejections[0]!.message).toMatch(/different op|read while it runs/);
  });

  it('refuses a payload on a movement order without stripping the origin of ships', () => {
    const state = fresh();
    sys(state, 'slu-2').ships['meridian'] = 6;
    const before = sys(state, 'slu-2').ships['meridian'];
    const out = applyOps(
      state,
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'fleet_movement',
          originId: 'slu-2', targetId: 'slu-1', force: 4,
          onComplete: { kind: 'commission_ships', magnitude: 2 },
        },
      ],
      'model',
      'meridian',
    );
    expect(out.rejections[0]!.code).toBe('illegal_value');
    // The rejection has to happen BEFORE the movement branch draws ships off
    // the origin, or a refused order would quietly delete a fleet.
    expect(sys(out.state, 'slu-2').ships['meridian']).toBe(before);
    expect(out.state.pendingOrders).toHaveLength(0);
  });

  it('refuses works on a world the faction neither holds nor has ships over', () => {
    // Priced from the ACTOR's marginal income, a development on a rival's world
    // costs the floor and hands the rival the improvement. Presence is the fix.
    const out = applyOps(fresh(), [develop('tio-3', 2)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('no_presence');
    expect(out.state.pendingOrders).toHaveLength(0);
  });

  it('allows works on an unaligned world a fleet is sitting on', () => {
    const state = fresh();
    const neutral = state.systems.find((s) => s.controllerFactionId === null)!;
    neutral.ships['meridian'] = 4;
    fac(state, 'meridian').credits = 6000;
    const out = applyOps(state, [develop(neutral.id, 1)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.pendingOrders[0]!.onComplete!.kind).toBe('develop_system');
  });

  it('trims an over-large ask to the cap and logs the clamp', () => {
    const out = applyOps(fresh(), [develop('tio-1', 9)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    const order = out.state.pendingOrders[0]!;
    expect(order.onComplete!.magnitude).toBe(EFFECT_CAPS.develop_system);
    expect(out.notes.join(' ')).toMatch(/Trimmed develop_system from 9/);
    expect(out.state.eventLog.some((e) => e.kind === 'clamp')).toBe(true);
  });

  it('trims to what the treasury can cover rather than refusing outright', () => {
    const state = fresh();
    const one = developmentCost(state, sys(state, 'tio-1'), 'meridian', 1);
    const two = developmentCost(state, sys(state, 'tio-1'), 'meridian', 2);
    expect(two).toBeGreaterThan(one);
    fac(state, 'meridian').credits = one + 10;

    const out = applyOps(state, [develop('tio-1', 2)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.pendingOrders[0]!.onComplete!.magnitude).toBe(1);
    expect(fac(out.state, 'meridian').credits).toBe(10);
  });

  it('refuses only when not even one unit can be paid for, and quotes the price', () => {
    const state = fresh();
    fac(state, 'meridian').credits = 5;
    const out = applyOps(state, [develop('tio-1', 1)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('insufficient_credits');
    expect(out.rejections[0]!.message).toMatch(/would cost \d+ credits/);
    expect(out.state.pendingOrders).toHaveLength(0);
    expect(fac(out.state, 'meridian').credits).toBe(5);
  });

  it('charges the treasury when the order goes out, not when it lands', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const price = developmentCost(state, sys(state, 'tio-1'), 'meridian', 2);
    const out = applyOps(state, [develop('tio-1', 2)], 'model', 'meridian');
    expect(fac(out.state, 'meridian').credits).toBe(before - price);
    expect(out.state.pendingOrders[0]!.investedCredits).toBe(price);
  });

  it('caps every kind, so a kind added later cannot be unbounded', () => {
    const state = fresh();
    const site = sys(state, 'tio-1');
    for (const kind of Object.keys(EFFECT_CAPS) as (keyof typeof EFFECT_CAPS)[]) {
      expect(EFFECT_CAPS[kind]).toBeGreaterThan(0);
      const trimmed = trimOrderEffect(
        state,
        site,
        'meridian',
        { kind, magnitude: 99, summary: '' },
        10_000_000,
      );
      expect(trimmed!.effect.magnitude).toBe(EFFECT_CAPS[kind]);
      expect(trimmed!.cost).toBeGreaterThan(0);
      expect(trimmed!.cost).toBe(priceOrderEffect(state, site, 'meridian', trimmed!.effect));
    }
  });

  it('leaves the eight non-delivering categories deliberately empty', () => {
    const hollow = DURATION_CATEGORIES.filter((c) => effectsAllowedFor(c).length === 0);
    expect(hollow).toEqual([
      'courier',
      'decree',
      'political_maneuver',
      'espionage',
      'counter_intelligence',
      'blockade',
      'commerce_raiding',
      'treaty_ratification',
    ]);
  });
});

describe('a world that changes hands mid-programme', () => {
  it('still gets its infrastructure, because concrete does not pick sides', () => {
    const state = fresh();
    const issued = applyOps(state, [develop('tio-1', 2)], 'model', 'meridian');
    sys(issued.state, 'tio-1').controllerFactionId = 'vigil';
    const finished = runOut(issued.state);
    expect(sys(finished, 'tio-1').strategicValue).toBe(sys(state, 'tio-1').strategicValue + 2);
    expect(finished.eventLog.some((e) => /now serve vigil/.test(e.text))).toBe(true);
  });

  it('loses the levy and the hulls, because those were people answering a summons', () => {
    const state = fresh();
    const issued = applyOps(
      state,
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'capital_ship_construction',
          originId: 'slu-2', targetId: 'slu-2', durationTurns: 5, label: 'battle line',
          onComplete: { kind: 'commission_ships', magnitude: 3 },
        },
      ],
      'model',
      'meridian',
    );
    const before = sys(issued.state, 'slu-2').ships['meridian'] ?? 0;
    sys(issued.state, 'slu-2').controllerFactionId = 'vigil';
    const finished = runOut(issued.state);
    expect(sys(finished, 'slu-2').ships['meridian'] ?? 0).toBe(before);
    expect(finished.eventLog.some((e) => /yards were lost with the world/.test(e.text))).toBe(true);
  });
});

describe('money sunk into works', () => {
  it('is refunded pro-rata when a programme is suspended part-built', () => {
    const state = fresh();
    const issued = applyOps(
      state,
      // `partial` is the bank-what-you-achieved case. The default is `cancel`,
      // which is the test below.
      [{ ...develop('tio-1', 2), onInterrupt: 'partial' } as Op],
      'model',
      'meridian',
    );
    const order = issued.state.pendingOrders[0]!;
    const invested = order.investedCredits;
    const ticked = tickTurn(issued.state).state; // progress 1 of 3
    const afterTick = fac(ticked, 'meridian').credits;

    const out = applyOps(
      ticked,
      [{ op: 'interrupt_order', orderId: order.id, reason: 'unrest at the yards.' }],
      'model',
      'meridian',
    );
    // 2 of 3 turns unspent.
    const expected = Math.round(invested * (2 / 3)) + 2 * 20;
    expect(fac(out.state, 'meridian').credits).toBe(afterTick + expected);
  });

  it('is sunk when the work is destroyed rather than stood down, and says so', () => {
    const state = fresh();
    const issued = applyOps(
      state,
      [{ ...develop('tio-1', 2), onInterrupt: 'cancel' } as Op],
      'model',
      'meridian',
    );
    const order = issued.state.pendingOrders[0]!;
    const invested = order.investedCredits;
    expect(invested).toBeGreaterThan(0);
    const before = fac(issued.state, 'meridian').credits;
    const out = applyOps(
      issued.state,
      [{ op: 'interrupt_order', orderId: order.id, reason: 'the yards burned.' }],
      'model',
      'meridian',
    );
    expect(fac(out.state, 'meridian').credits).toBe(before);
    expect(out.notes.join(' ')).toMatch(new RegExp(`${invested} credits sunk with it`));
  });

  it('comes back when the faction recalls its own order', () => {
    const state = fresh();
    const issued = applyOps(state, [develop('tio-1', 2)], 'model', 'meridian');
    const order = issued.state.pendingOrders[0]!;
    const before = fac(issued.state, 'meridian').credits;
    const out = applyOps(
      issued.state,
      [{ op: 'cancel_order', orderId: order.id, reason: 'priorities changed.' }],
      'model',
      'meridian',
    );
    expect(fac(out.state, 'meridian').credits).toBe(before + order.investedCredits);
  });
});

/**
 * The second half of the same gap: a commitment could be established, shown in
 * the UI and used to lower a later difficulty, and still pay nothing forever,
 * because `ledgerFor` never read commitments at all.
 */
describe('standing arrangements pay', () => {
  const arrangement = (
    kind: string,
    incomePerTurn: number,
    factionIds = ['meridian'],
  ): Op => ({
    op: 'establish_commitment',
    kind,
    factionIds,
    text: `${kind.replace(/_/g, ' ')} running out of Corvid`,
    incomePerTurn,
  });

  it('reaches the ledger, which never read commitments before', () => {
    const state = fresh();
    const before = ledgerFor(state, 'meridian').net;
    const out = applyOps(state, [arrangement('mining_operation', 20)], 'model', 'meridian');
    const after = ledgerFor(out.state, 'meridian');
    expect(after.commitmentFlow).toBe(20);
    expect(after.net).toBe(before + 20);
  });

  it('actually accrues credits when the turn lands', () => {
    const plain = tickTurn(fresh()).state;
    const withIt = tickTurn(
      applyOps(fresh(), [arrangement('mining_operation', 20)], 'model', 'meridian').state,
    ).state;
    expect(fac(withIt, 'meridian').credits - fac(plain, 'meridian').credits).toBe(20);
  });

  it('trims one over-large arrangement to the ceiling and logs it', () => {
    const out = applyOps(fresh(), [arrangement('spice_monopoly', 400)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.commitments[0]!.incomePerTurn).toBe(MAX_COMMITMENT_INCOME);
    expect(out.notes.join(' ')).toMatch(/Trimmed spice_monopoly yield from 400/);
    expect(out.state.eventLog.some((e) => e.kind === 'clamp')).toBe(true);
  });

  it('caps the total a faction can draw, so arrangements cannot be stacked forever', () => {
    const ceiling = maxCommitmentIncomeFor(fresh(), 'meridian');
    const out = applyOps(
      fresh(),
      [
        arrangement('mining_operation', 25),
        arrangement('spice_route', 25),
        arrangement('shipping_charter', 25),
        arrangement('salvage_rights', 25),
      ],
      'model',
      'meridian',
    );
    expect(out.state.commitments).toHaveLength(4);
    expect(ledgerFor(out.state, 'meridian').commitmentFlow).toBe(ceiling);
    expect(ceiling).toBeLessThan(4 * MAX_COMMITMENT_INCOME);
  });

  it('derives the ceiling from influence, putting the trading house above the remnant', () => {
    const state = fresh();
    expect(maxCommitmentIncomeFor(state, 'meridian')).toBe(50);
    expect(maxCommitmentIncomeFor(state, 'hutt')).toBe(40);
    expect(maxCommitmentIncomeFor(state, 'vigil')).toBe(MIN_COMMITMENT_INCOME_CEILING);
  });

  it('does not cap what a faction agrees to pay', () => {
    const out = applyOps(
      fresh(),
      [arrangement('protection_tribute', -25), arrangement('salvage_tithe', -25)],
      'model',
      'meridian',
    );
    expect(ledgerFor(out.state, 'meridian').commitmentFlow).toBe(-50);
  });

  it('stops paying once dissolved', () => {
    const out = applyOps(fresh(), [arrangement('mining_operation', 20)], 'model', 'meridian');
    const ended = applyOps(
      out.state,
      [{ op: 'dissolve_commitment', commitmentId: out.state.commitments[0]!.id, reason: 'seam ran dry.' }],
      'model',
      'meridian',
    );
    expect(ledgerFor(ended.state, 'meridian').commitmentFlow).toBe(0);
  });

  it('pays nothing for a purely political arrangement', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'establish_commitment', kind: 'dynastic_marriage',
          factionIds: ['meridian', 'hutt'], text: 'A marriage binds the houses.', exclusive: true,
        },
      ],
      'model',
      'meridian',
    );
    expect(out.state.commitments[0]!.incomePerTurn).toBe(0);
    expect(ledgerFor(out.state, 'meridian').commitmentFlow).toBe(0);
  });
});

/**
 * The scenario option (C) — "make `strategicValue` mutable" — was going to
 * address. It was not built as its own mechanism, so this asserts the payload
 * reaches the same place: development that crosses `HUB_THRESHOLD` turns a
 * world into a trade hub and puts new lanes on the map.
 */
describe('development reaches the trade network (the option-C scenario)', () => {
  /** A treasury deep enough to found a hub, which is deliberately expensive. */
  const funded = (): WorldState => {
    const state = fresh();
    fac(state, 'meridian').credits = 6000;
    return state;
  };

  it('turns a developed world into a hub and creates lanes that did not exist', () => {
    const state = funded();
    expect(sys(state, 'slu-2').strategicValue).toBe(HUB_THRESHOLD - 1);
    const hubsBefore = tradeHubs(state.systems).length;
    const routesBefore = tradeRoutes(state).length;

    const issued = applyOps(state, [develop('slu-2', 1)], 'model', 'meridian');
    expect(issued.rejections).toHaveLength(0);
    const finished = runOut(issued.state);

    expect(sys(finished, 'slu-2').strategicValue).toBe(HUB_THRESHOLD);
    expect(tradeHubs(finished.systems).map((h) => h.id)).toContain('slu-2');
    expect(tradeHubs(finished.systems).length).toBe(hubsBefore + 1);
    expect(tradeRoutes(finished).length).toBeGreaterThan(routesBefore);
  });

  it('pays the developer more from the network once the hub exists', () => {
    const plain = runOut(funded());
    const finished = runOut(
      applyOps(funded(), [develop('slu-2', 1)], 'model', 'meridian').state,
    );
    expect(ledgerFor(finished, 'meridian').routes).toBeGreaterThan(
      ledgerFor(plain, 'meridian').routes,
    );
  });

  /**
   * The pricing model, which is the part that was wrong first time round.
   *
   * A flat per-point price made founding a hub the single most profitable move
   * in the game by a factor of twenty-five: a 30-turn reinvestment run tripled
   * Meridian's net income for 1,120 credits. The cost is now twelve turns of the
   * income the specific development would actually create, so a point is priced
   * by what it unlocks rather than by being a point.
   */
  it('prices a hub crossing far above an ordinary point, from what each is worth', () => {
    const state = funded();
    const ordinary = developmentCost(state, sys(state, 'tio-1'), 'meridian', 1);
    const founding = developmentCost(state, sys(state, 'slu-2'), 'meridian', 1);
    expect(founding).toBeGreaterThan(10 * ordinary);
  });

  it('charges twelve turns of exactly the income it creates', () => {
    const state = funded();
    const site = sys(state, 'slu-2');
    const before = ledgerFor(state, 'meridian');

    const raised: WorldState = {
      ...state,
      systems: state.systems.map((s) =>
        s.id === site.id ? { ...s, strategicValue: s.strategicValue + 1 } : s,
      ),
    };
    const after = ledgerFor(raised, 'meridian');
    const gain = after.territory + after.routes - (before.territory + before.routes);

    expect(developmentCost(state, site, 'meridian', 1)).toBe(gain * DEVELOPMENT_PAYBACK_TURNS);
  });

  it('never gives a development away, however worthless the world', () => {
    const state = fresh('krayt');
    // Drajk's backwaters sit off the lane network entirely, so the marginal
    // return is small — but never zero-cost.
    for (const s of state.systems.filter((x) => x.controllerFactionId === 'krayt')) {
      expect(developmentCost(state, s, 'krayt', 1)).toBeGreaterThanOrEqual(MIN_DEVELOPMENT_COST);
    }
  });
});
