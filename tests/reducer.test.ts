import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { fleetStrengthOf, SHIP_COST, type WorldState } from '../src/domain/state.js';

const fresh = (): WorldState => createSeedState('freeworlds');

const codes = (r: ReturnType<typeof applyOps>): string[] => r.rejections.map((x) => x.code);

describe('purity', () => {
  it('never mutates the input state', () => {
    const state = fresh();
    const snapshot = JSON.stringify(state);
    applyOps(state, [
      { op: 'adjust_credits', factionId: 'freeworlds', delta: -500 },
      { op: 'set_doctrine', factionId: 'freeworlds', doctrine: 'Burn the lanes.' },
    ]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('is deterministic for the same input', () => {
    const ops = [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fortification', originId: 'ark-1', targetId: 'ark-1', durationTurns: 5 },
      { op: 'adjust_fleet', factionId: 'freeworlds', delta: 3 },
    ];
    const a = applyOps(fresh(), ops);
    const b = applyOps(fresh(), ops);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

describe('transfer_control is reducer-only', () => {
  it('rejects the op when it comes from the model', () => {
    const res = applyOps(fresh(), [
      { op: 'transfer_control', systemId: 'tio-3', toFactionId: 'freeworlds' },
    ]);
    expect(codes(res)).toEqual(['reducer_only']);
    expect(res.state.systems.find((s) => s.id === 'tio-3')?.controllerFactionId).toBe('vigil');
  });

  it('allows it from the engine', () => {
    const res = applyOps(
      fresh(),
      [{ op: 'transfer_control', systemId: 'tio-3', toFactionId: 'freeworlds' }],
      'engine',
    );
    expect(res.rejections).toHaveLength(0);
    expect(res.state.systems.find((s) => s.id === 'tio-3')?.controllerFactionId).toBe('freeworlds');
  });

  it('rejects an unknown system even from the engine', () => {
    const res = applyOps(
      fresh(),
      [{ op: 'transfer_control', systemId: 'nowhere', toFactionId: 'freeworlds' }],
      'engine',
    );
    expect(codes(res)).toEqual(['unknown_system']);
  });
});

describe('adjust_disposition', () => {
  it('applies and clamps to the -100..100 range', () => {
    const res = applyOps(fresh(), [
      { op: 'adjust_disposition', factionId: 'freeworlds', towardFactionId: 'vigil', delta: -100 },
    ]);
    expect(res.rejections).toHaveLength(0);
    expect(res.state.factions.find((f) => f.id === 'freeworlds')?.disposition['vigil']).toBe(-100);
  });

  it('rejects a disposition toward itself', () => {
    const res = applyOps(fresh(), [
      { op: 'adjust_disposition', factionId: 'hutt', towardFactionId: 'hutt', delta: 10 },
    ]);
    expect(codes(res)).toEqual(['illegal_value']);
  });

  it('rejects unknown factions', () => {
    const res = applyOps(fresh(), [
      { op: 'adjust_disposition', factionId: 'ghosts', towardFactionId: 'vigil', delta: 10 },
      { op: 'adjust_disposition', factionId: 'vigil', towardFactionId: 'ghosts', delta: 10 },
    ]);
    expect(codes(res)).toEqual(['unknown_faction', 'unknown_faction']);
  });
});

describe('adjust_fleet and adjust_credits', () => {
  it('never goes below zero', () => {
    const res = applyOps(fresh(), [
      { op: 'adjust_fleet', factionId: 'krayt', delta: -9999 },
      { op: 'adjust_credits', factionId: 'krayt', delta: -9999 },
    ]);
    // adjust_fleet now drains actual ships from actual systems, largest first.
    expect(fleetStrengthOf(res.state, 'krayt')).toBe(0);
    expect(res.state.factions.find((f) => f.id === 'krayt')!.credits).toBe(0);
  });

  it('commissions new ships somewhere real, and charges for them', () => {
    const start = fresh();
    const before = fleetStrengthOf(start, 'krayt');
    const purse = start.factions.find((f) => f.id === 'krayt')!.credits;
    // Drajk holds 700 credits, so 10 hulls at 60 apiece is affordable and 12
    // would not be — the yards are the binding constraint, not the order.
    const res = applyOps(start, [{ op: 'adjust_fleet', factionId: 'krayt', delta: 10 }]);
    expect(fleetStrengthOf(res.state, 'krayt')).toBe(before + 10);
    // They must exist in a system, not in an abstract pool.
    const total = res.state.systems.reduce((n, s) => n + (s.ships['krayt'] ?? 0), 0);
    expect(total).toBe(before + 10);
    expect(res.state.factions.find((f) => f.id === 'krayt')!.credits).toBe(purse - 10 * SHIP_COST);
  });

  it('rejects unknown factions', () => {
    expect(codes(applyOps(fresh(), [{ op: 'adjust_fleet', factionId: 'nope', delta: 1 }]))).toEqual([
      'unknown_faction',
    ]);
    expect(
      codes(applyOps(fresh(), [{ op: 'adjust_credits', factionId: 'nope', delta: 1 }])),
    ).toEqual(['unknown_faction']);
  });
});

describe('set_doctrine', () => {
  it('replaces the doctrine text', () => {
    const res = applyOps(fresh(), [
      { op: 'set_doctrine', factionId: 'hutt', doctrine: 'Sell to whoever is winning.' },
    ]);
    expect(res.state.factions.find((f) => f.id === 'hutt')?.doctrine).toBe(
      'Sell to whoever is winning.',
    );
  });

  it('rejects an empty doctrine', () => {
    expect(
      codes(applyOps(fresh(), [{ op: 'set_doctrine', factionId: 'hutt', doctrine: '' }])),
    ).toEqual(['schema_invalid']);
  });
});

describe('issue_order — deterministic movement', () => {
  it('computes duration from the hyperlane graph', () => {
    const res = applyOps(fresh(), [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-1', targetId: 'ark-4' },
    ]);
    expect(res.rejections).toHaveLength(0);
    const order = res.state.pendingOrders[0]!;
    expect(order.durationTurns).toBe(2);
    expect(order.path).toEqual(['ark-1', expect.any(String), 'ark-4']);
  });

  it('DISCARDS a model-supplied duration and logs the discard', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'ark-4', durationTurns: 1,
      },
    ]);
    expect(res.state.pendingOrders[0]!.durationTurns).toBe(2);
    expect(res.notes.join(' ')).toMatch(/Discarded model duration 1/);
    expect(res.state.eventLog.some((e) => e.kind === 'system' && /Discarded/.test(e.text))).toBe(true);
  });

  it('rejects an unreachable target', () => {
    const state = fresh();
    // Sever every lane into Hollow Star, then try to reach it.
    for (const s of state.systems) {
      s.hyperlaneEdges = s.hyperlaneEdges.filter((e) => e !== 'kes-7');
      if (s.id === 'kes-7') s.hyperlaneEdges = [];
    }
    const res = applyOps(state, [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-1', targetId: 'kes-7' },
    ]);
    expect(codes(res)).toEqual(['unreachable_target']);
  });

  it('rejects unknown origin or target', () => {
    const res = applyOps(fresh(), [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'void', targetId: 'ark-4' },
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-1', targetId: 'void' },
    ]);
    expect(codes(res)).toEqual(['unknown_system', 'unknown_system']);
  });
});

describe('issue_order — estimated work', () => {
  it('requires a duration', () => {
    const res = applyOps(fresh(), [
      { op: 'issue_order', factionId: 'freeworlds', type: 'garrison_raising', originId: 'ark-1', targetId: 'ark-3' },
    ]);
    expect(codes(res)).toEqual(['missing_duration']);
  });

  it('rejects a duration off the Fibonacci scale', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'garrison_raising',
        originId: 'ark-1', targetId: 'ark-3', durationTurns: 4,
      },
    ]);
    expect(codes(res)).toEqual(['schema_invalid']);
  });

  it('clamps upward to the category floor and logs it', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'capital_ship_construction',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 1,
        label: 'crash dreadnought programme',
      },
    ]);
    expect(res.rejections).toHaveLength(0);
    expect(res.state.pendingOrders[0]!.durationTurns).toBe(5);
    expect(res.notes.join(' ')).toMatch(/Clamped capital_ship_construction duration 1 -> 5/);
    expect(res.state.eventLog.some((e) => e.kind === 'clamp')).toBe(true);
  });

  it('leaves a duration at or above the floor alone', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'espionage',
        originId: 'ark-1', targetId: 'tio-3', durationTurns: 5,
      },
    ]);
    expect(res.state.pendingOrders[0]!.durationTurns).toBe(5);
    expect(res.notes).toHaveLength(0);
  });

  it('drops visibility entries for factions that do not exist', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fortification',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 3,
        visibility: ['vigil', 'phantom', 'vigil'],
      },
    ]);
    expect(res.state.pendingOrders[0]!.visibility).toEqual(['vigil']);
  });

  it('mints deterministic ids', () => {
    const ops = [
      { op: 'issue_order', factionId: 'freeworlds', type: 'decree', originId: 'ark-1', targetId: 'ark-1', durationTurns: 1 },
      { op: 'issue_order', factionId: 'freeworlds', type: 'decree', originId: 'ark-3', targetId: 'ark-3', durationTurns: 1 },
    ];
    const a = applyOps(fresh(), ops).state.pendingOrders.map((o) => o.id);
    const b = applyOps(fresh(), ops).state.pendingOrders.map((o) => o.id);
    expect(a).toEqual(['ord-0-0', 'ord-0-1']);
    expect(a).toEqual(b);
  });
});

describe('order lifecycle ops', () => {
  const withOrder = (extra: Record<string, unknown> = {}) =>
    applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 5, label: 'shipyard',
        ...extra,
      },
    ]).state;

  it('cancels an order', () => {
    const state = withOrder();
    const res = applyOps(state, [{ op: 'cancel_order', orderId: 'ord-0-0' }]);
    expect(res.state.pendingOrders).toHaveLength(0);
  });

  it('rejects cancelling an unknown order', () => {
    expect(codes(applyOps(fresh(), [{ op: 'cancel_order', orderId: 'nope' }]))).toEqual([
      'unknown_order',
    ]);
  });

  it('rejects interrupting an order flagged not interruptible', () => {
    const state = withOrder({ interruptible: false });
    expect(codes(applyOps(state, [{ op: 'interrupt_order', orderId: 'ord-0-0' }]))).toEqual([
      'not_interruptible',
    ]);
  });

  it('interrupt with onInterrupt=cancel destroys the work', () => {
    const state = withOrder({ onInterrupt: 'cancel' });
    const res = applyOps(state, [{ op: 'interrupt_order', orderId: 'ord-0-0' }]);
    expect(res.state.pendingOrders).toHaveLength(0);
    expect(res.notes.join(' ')).toMatch(/all progress lost/);
  });

  it('interrupt with onInterrupt=persist keeps the order', () => {
    const state = withOrder({ onInterrupt: 'persist' });
    const res = applyOps(state, [{ op: 'interrupt_order', orderId: 'ord-0-0' }]);
    expect(res.state.pendingOrders).toHaveLength(1);
    expect(res.notes.join(' ')).toMatch(/weathered an interruption/);
  });

  it('interrupt with onInterrupt=partial refunds the unspent portion', () => {
    const state = withOrder({ onInterrupt: 'partial' });
    const before = state.factions.find((f) => f.id === 'freeworlds')!.credits;
    const res = applyOps(state, [{ op: 'interrupt_order', orderId: 'ord-0-0' }]);
    expect(res.state.pendingOrders).toHaveLength(0);
    expect(res.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBeGreaterThan(before);
  });

  it('extends an estimated order but not a movement', () => {
    const ok = applyOps(withOrder(), [
      { op: 'extend_order', orderId: 'ord-0-0', additionalTurns: 3 },
    ]);
    expect(ok.state.pendingOrders[0]!.durationTurns).toBe(8);

    const moving = applyOps(fresh(), [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-1', targetId: 'ark-4' },
    ]).state;
    expect(
      codes(applyOps(moving, [{ op: 'extend_order', orderId: 'ord-0-0', additionalTurns: 2 }])),
    ).toEqual(['illegal_value']);
  });
});

describe('accelerate_order', () => {
  const shipyard = (): WorldState =>
    applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 5, label: 'shipyard',
      },
    ]).state;

  it('drops exactly one Fibonacci bucket and charges for it', () => {
    const state = shipyard();
    const before = state.factions.find((f) => f.id === 'freeworlds')!.credits;
    const res = applyOps(state, [{ op: 'accelerate_order', orderId: 'ord-0-0' }]);
    expect(res.rejections).toHaveLength(0);
    // 5 is the ceiling; one bucket down is 3.
    expect(res.state.pendingOrders[0]!.durationTurns).toBe(3);
    expect(res.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBeLessThan(before);
  });

  it('rejects when the faction cannot pay', () => {
    const state = shipyard();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 10;
    expect(codes(applyOps(state, [{ op: 'accelerate_order', orderId: 'ord-0-0' }]))).toEqual([
      'insufficient_credits',
    ]);
  });

  it('never goes below one turn', () => {
    let state = shipyard();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 100_000;
    for (let i = 0; i < 6; i++) {
      state = applyOps(state, [{ op: 'accelerate_order', orderId: 'ord-0-0' }]).state;
    }
    expect(state.pendingOrders[0]!.durationTurns).toBe(1);
  });

  it('refuses to accelerate movement', () => {
    const moving = applyOps(fresh(), [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-1', targetId: 'ark-6' },
    ]).state;
    expect(codes(applyOps(moving, [{ op: 'accelerate_order', orderId: 'ord-0-0' }]))).toEqual([
      'illegal_value',
    ]);
  });
});

describe('spawn_event and log_narrative', () => {
  it('appends to the event log', () => {
    const res = applyOps(fresh(), [
      { op: 'spawn_event', text: 'A freighter goes missing in the Drift.' },
      { op: 'log_narrative', text: 'You order a search.' },
    ]);
    expect(res.rejections).toHaveLength(0);
    const texts = res.state.eventLog.map((e) => e.text);
    expect(texts).toContain('A freighter goes missing in the Drift.');
    expect(texts).toContain('You order a search.');
  });

  it('rejects an event attributed to an unknown faction', () => {
    expect(
      codes(applyOps(fresh(), [{ op: 'spawn_event', factionId: 'nope', text: 'hi' }])),
    ).toEqual(['unknown_faction']);
  });
});

describe('malformed input', () => {
  it('reports unknown ops rather than dropping them', () => {
    const res = applyOps(fresh(), [{ op: 'nuke_everything', target: 'all' }]);
    expect(codes(res)).toEqual(['unknown_op']);
    expect(res.rejections[0]!.message).toMatch(/Valid ops:/);
  });

  it('reports schema failures with the offending path', () => {
    const res = applyOps(fresh(), [{ op: 'adjust_fleet', factionId: 'freeworlds' }]);
    expect(codes(res)).toEqual(['schema_invalid']);
    expect(res.rejections[0]!.message).toMatch(/delta/);
  });

  it('records every rejection in the event log', () => {
    const res = applyOps(fresh(), [{ op: 'garbage' }, { op: 'also_garbage' }]);
    expect(res.state.eventLog.filter((e) => e.kind === 'rejection')).toHaveLength(2);
  });

  it('applies the valid ops in a batch alongside the invalid ones', () => {
    const res = applyOps(fresh(), [
      { op: 'garbage' },
      { op: 'adjust_credits', factionId: 'freeworlds', delta: 100 },
    ]);
    expect(res.rejections).toHaveLength(1);
    expect(res.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(1200);
  });
});

describe('tickTurn', () => {
  it('advances the turn counter and order progress', () => {
    const state = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 5,
      },
    ]).state;
    const res = tickTurn(state);
    expect(res.state.turn).toBe(1);
    expect(res.state.pendingOrders[0]!.progress).toBe(1);
  });

  it('completes estimated work when its duration elapses', () => {
    let state = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'decree',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 1, label: 'a decree',
      },
    ]).state;
    const res = tickTurn(state);
    expect(res.state.pendingOrders).toHaveLength(0);
    expect(res.notes.join(' ')).toMatch(/a decree completed/);
  });

  it('transfers control only when a movement order arrives', () => {
    // slu-6 is unaligned and two jumps from ark-3, via ark-4. Its garrison is
    // cleared so this test is about arrival, not about a ground assault.
    const base = fresh();
    base.systems.find((s) => s.id === 'slu-6')!.garrison = 0;
    let state = applyOps(base, [
      { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-3', targetId: 'slu-6' },
    ]).state;
    expect(state.pendingOrders[0]!.durationTurns).toBe(2);
    expect(state.systems.find((s) => s.id === 'slu-6')!.controllerFactionId).toBeNull();

    state = tickTurn(state).state; // one jump: not there yet
    expect(state.systems.find((s) => s.id === 'slu-6')!.controllerFactionId).toBeNull();

    const arrived = tickTurn(state);
    expect(arrived.state.systems.find((s) => s.id === 'slu-6')!.controllerFactionId).toBe(
      'freeworlds',
    );
    expect(arrived.notes.join(' ')).toMatch(/unopposed/);
  });

  it('throws back a landing the attacker is too weak to make', () => {
    const base = fresh();
    // Send a token force at a heavily dug-in world with no defending fleet, so
    // phase 1 is skipped and the garrison decides it.
    base.systems.find((s) => s.id === 'ark-3')!.ships['freeworlds'] = 2;
    let state = applyOps(base, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-3', targetId: 'slu-6', force: 2,
      },
    ]).state;
    const target = state.systems.find((s) => s.id === 'slu-6')!;
    target.controllerFactionId = 'vigil';
    target.garrison = 50;
    target.garrisonMax = 50;

    state = tickTurn(state).state;
    const res = tickTurn(state);
    expect(res.state.systems.find((s) => s.id === 'slu-6')!.controllerFactionId).toBe('vigil');
    expect(res.notes.join(' ')).toMatch(/thrown back/);
  });
});

/**
 * An action lands whole or not at all.
 *
 * The reducer treats a batch as a flat list of independent ops, which is right
 * when they are independent and wrong for the common case where they are one
 * action's parts and some are only justified by the others. Measured live: a
 * `develop_system` order rejected for `insufficient_credits` left its sibling
 * `adjust_credits +120` — "surplus conversion materiel" from a conversion that
 * never happened — applied. Free money as a byproduct of a rejected op.
 *
 * Nothing expresses which ops depend on which, so the only dependency unit
 * available is the batch, and a batch is one declared action.
 */
describe('a batch is atomic when asked to be', () => {
  const good = { op: 'adjust_credits', factionId: 'meridian', delta: 120, reason: 'surplus' };
  const bad = { op: 'adjust_credits', factionId: 'nobody-at-all', delta: -10, reason: 'x' };

  const creditsOf = (s: WorldState) => s.factions.find((f) => f.id === 'meridian')!.credits;

  it('applies nothing when any op is rejected', () => {
    const state = createSeedState('meridian');
    const before = creditsOf(state);
    const out = applyOps(state, [good, bad], 'model', 'meridian', true);

    expect(out.rejections).toHaveLength(1);
    // The sibling that would otherwise have been free money.
    expect(creditsOf(out.state)).toBe(before);
    expect(out.notes.join(' ')).toMatch(/Nothing in this batch was applied/);
  });

  it('applies everything when nothing is rejected', () => {
    const state = createSeedState('meridian');
    const before = creditsOf(state);
    const out = applyOps(state, [good], 'model', 'meridian', true);
    expect(out.rejections).toHaveLength(0);
    expect(creditsOf(out.state)).toBe(before + 120);
  });

  it('still applies partially when not atomic, which is how old journals replay', () => {
    const state = createSeedState('meridian');
    const before = creditsOf(state);
    const out = applyOps(state, [good, bad], 'model', 'meridian');
    expect(out.rejections).toHaveLength(1);
    expect(creditsOf(out.state)).toBe(before + 120);
  });
});
