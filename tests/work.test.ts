import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { ModelOpSchema, orderFor, type OpInput } from '../src/domain/ops.js';
import { boundPayloadsToOutcome } from '../src/domain/development.js';
import { CATEGORY_FLOORS } from '../src/domain/duration.js';
import { HULL_SPEC } from '../src/domain/hulls.js';
import { yardCapacityFor, type WorldState } from '../src/domain/state.js';

/**
 * Work is written as its own op, and the reducer files it under its category
 * (`docs/design-2026-10-17-intent-ops.md` §1). `issue_order` carried fourteen
 * categories and an optional payload, and 31 of 111 work orders in the saved
 * campaigns carried no payload and completed doing nothing.
 */

const seed = (): WorldState => createSeedState('meridian');
const declare = (s: WorldState, ops: OpInput[], actor = 'meridian') =>
  applyOps(s, ops, 'model', actor, true, {}, 'declared');

describe('one conversion from work to the order it means', () => {
  it('files each kind under its category, with its payload', () => {
    const cases: [OpInput, string, string | undefined][] = [
      [{ op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 }, 'fortification', 'fortify'],
      [{ op: 'raise_garrison', factionId: 'meridian', systemId: 'sek-4', magnitude: 2 }, 'garrison_raising', 'raise_garrison'],
      [{ op: 'develop', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 }, 'construction_infrastructure', 'develop_system'],
      [{ op: 'found_fixture', factionId: 'meridian', systemId: 'sek-4', kind: 'stock_exchange' }, 'construction_infrastructure', 'found_fixture'],
      [{ op: 'send_envoy', factionId: 'meridian', systemId: 'sek-6' }, 'political_maneuver', 'court'],
      [{ op: 'raid', factionId: 'meridian', systemId: 'sek-6' }, 'commerce_raiding', undefined],
      [{ op: 'sweep', factionId: 'meridian', systemId: 'sek-4' }, 'counter_intelligence', undefined],
      [{ op: 'move', factionId: 'meridian', originId: 'sek-4', targetId: 'sek-3' }, 'fleet_movement', undefined],
    ];
    for (const [op, type, payload] of cases) {
      const order = orderFor(ModelOpSchema.parse(op))!;
      expect(order.type, op.op).toBe(type);
      expect((order.onComplete as { kind?: string } | undefined)?.kind, op.op).toBe(payload);
    }
  });

  it('times work by its kind when nobody says, and an envoy at two turns', () => {
    expect(orderFor({ op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 })!.durationTurns).toBe(CATEGORY_FLOORS.fortification);
    expect(orderFor({ op: 'send_envoy', factionId: 'meridian', systemId: 'sek-6', magnitude: 2 })!.durationTurns).toBe(2);
    expect(orderFor({ op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1, durationTurns: 5 })!.durationTurns).toBe(5);
  });

  it('is not offered `issue_order` at all', () => {
    expect(ModelOpSchema.safeParse({ op: 'issue_order', factionId: 'meridian', type: 'decree', originId: 'sek-4', targetId: 'sek-4', durationTurns: 1 }).success).toBe(false);
  });
});

describe('the reducer runs work as the order it means', () => {
  it('starts a fortification with its payload paid', () => {
    const s = seed();
    const r = declare(s, [{ op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1, label: 'walls' }]);
    expect(r.rejections).toEqual([]);
    const order = r.state.pendingOrders.find((o) => o.factionId === 'meridian' && o.type === 'fortification')!;
    expect(order.onComplete?.kind).toBe('fortify');
    expect(order.label).toBe('walls');
    expect(r.state.factions.find((f) => f.id === 'meridian')!.credits).toBeLessThan(s.factions.find((f) => f.id === 'meridian')!.credits);
  });

  it('refuses a bare issue_order from a declaration, and takes it from the engine', () => {
    const s = seed();
    const order: OpInput = { op: 'issue_order', factionId: 'meridian', type: 'decree', originId: 'sek-4', targetId: 'sek-4', durationTurns: 1 };
    expect(declare(s, [order]).rejections.map((x) => x.code)).toEqual(['wrong_path']);
    expect(applyOps(s, [order], 'engine', undefined, true, {}, 'engine').rejections).toEqual([]);
  });

  it('refuses work from an accord', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 }], 'extraction', 'meridian', true, {}, 'accord');
    expect(r.rejections.map((x) => x.code)).toEqual(['declared_only']);
  });
});

describe('work is bounded by the attempt', () => {
  const fortify: OpInput = { op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 3, label: 'walls' };

  it('a failure starts nothing', () => {
    const r = boundPayloadsToOutcome([fortify], 'failure');
    expect(r.ops).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/never started/);
  });

  it('a partial delivers half', () => {
    const r = boundPayloadsToOutcome([fortify], 'partial');
    expect((r.ops[0] as { magnitude: number }).magnitude).toBe(1);
  });

  it('a failed attack still sails', () => {
    const move: OpInput = { op: 'move', factionId: 'meridian', originId: 'sek-4', targetId: 'tor-1' };
    expect(boundPayloadsToOutcome([move], 'critical_failure').ops).toEqual([move]);
  });

  it('a fixture attempted on the wrong attribute founds nothing and starts nothing', () => {
    const found: OpInput = { op: 'found_fixture', factionId: 'meridian', systemId: 'sek-4', kind: 'stock_exchange' };
    expect(boundPayloadsToOutcome([found], 'success', 'might').ops).toEqual([]);
    expect(boundPayloadsToOutcome([found], 'success', 'influence').ops).toEqual([found]);
  });
});

describe('a yard programme', () => {
  it('is laid down at a named world', () => {
    const r = declare(seed(), [{ op: 'build_ships', factionId: 'meridian', hull: 'escort', count: 2, programme: true }]);
    expect(r.rejections.map((x) => x.code)).toEqual(['illegal_value']);
  });

  it('takes berths, so an open build in the same declaration gets only what is left', () => {
    const s = seed();
    s.factions.find((f) => f.id === 'meridian')!.credits = 100_000;
    const berths = yardCapacityFor(s, 'meridian');
    const perShip = HULL_SPEC.battleship.tonnage;
    const programme = Math.floor(berths / perShip) - 1;
    const r = declare(s, [
      { op: 'build_ships', factionId: 'meridian', hull: 'battleship', count: programme, systemId: 'sek-4', programme: true },
      { op: 'build_ships', factionId: 'meridian', hull: 'battleship', count: 20, systemId: 'sek-4' },
    ]);
    expect(r.rejections).toEqual([]);
    const order = r.state.pendingOrders.find((o) => o.factionId === 'meridian' && o.onComplete?.kind === 'commission_ships')!;
    expect(order.onComplete!.magnitude).toBe(programme);
    const before = s.systems.find((x) => x.id === 'sek-4')!.ships.meridian?.battleship ?? 0;
    const after = r.state.systems.find((x) => x.id === 'sek-4')!.ships.meridian?.battleship ?? 0;
    expect((after - before) * perShip).toBeLessThanOrEqual(berths - programme * perShip);
  });

  it('beyond the berths, is trimmed to what fits', () => {
    const s = seed();
    s.factions.find((f) => f.id === 'meridian')!.credits = 100_000;
    const fits = Math.floor(yardCapacityFor(s, 'meridian') / HULL_SPEC.escort.tonnage);
    const r = declare(s, [
      { op: 'build_ships', factionId: 'meridian', hull: 'escort', count: fits + 5, systemId: 'sek-4', programme: true },
    ]);
    const order = r.state.pendingOrders.find((o) => o.factionId === 'meridian' && o.onComplete?.kind === 'commission_ships')!;
    expect(order.onComplete!.magnitude).toBe(Math.min(fits, 12));
  });
});
