import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { yardCapacityFor, yardRoomFor, stackAt, type WorldState } from '../src/domain/state.js';
import { CREDITS_PER_TON, HULL_SPEC } from '../src/domain/hulls.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * One way to build ships (journal version 36): what this turn's yards have
 * room for is laid down at once, and the rest is paid for and waits in the
 * yards' queue, delivered at the run rate and aborted if the world is lost.
 */
const BS = HULL_SPEC.battleship.tonnage * CREDITS_PER_TON;
const build = (state: WorldState, count: number, systemId = 'sek-4', hull = 'battleship') =>
  applyOps(state, [{ op: 'build_ships', factionId: 'meridian', hull, count, systemId } as OpInput], 'model', 'meridian', false, {}, 'declared');
const credits = (s: WorldState) => s.factions.find((f) => f.id === 'meridian')!.credits;
const battleships = (s: WorldState, id = 'sek-4') => stackAt(s.systems.find((x) => x.id === id)!, 'meridian').battleship ?? 0;
const queue = (s: WorldState) => s.pendingOrders.filter((o) => o.queued);

function rich(): WorldState {
  const s = createSeedState('meridian');
  s.factions.find((f) => f.id === 'meridian')!.credits = 5000;
  return s;
}

describe('the yards lay down what fits and queue the rest', () => {
  it('lays down a turn of capacity now, and pays for the whole order now', () => {
    const s = rich();
    const cap = yardCapacityFor(s, 'meridian');
    const fits = Math.floor(cap / 4);
    const out = build(s, fits + 9);
    expect(battleships(out.state) - battleships(s)).toBe(fits);
    expect(credits(s) - credits(out.state)).toBe((fits + 9) * BS);
    const [q] = queue(out.state);
    expect(q!.onComplete).toMatchObject({ kind: 'commission_ships', magnitude: 9, hull: 'battleship' });
    expect(q!.investedCredits).toBe(9 * BS);
    expect(q!.durationTurns).toBe(Math.ceil(36 / cap));
    expect(yardRoomFor(out.state, 'meridian')).toBe(cap - fits * 4);
    expect(out.notes.join(' ')).toMatch(/9 battleships wait in the yards' queue/);
  });

  it('is a cap per turn: a second build in the same turn gets what is left', () => {
    const s = rich();
    const cap = yardCapacityFor(s, 'meridian');
    const first = build(s, Math.floor(cap / 4)).state;
    const second = build(first, 2);
    expect(battleships(second.state)).toBe(battleships(first));
    expect(queue(second.state)[0]!.onComplete!.magnitude).toBe(2);
  });

  it('delivers the queue at the run rate, ahead of anything declared the next turn', () => {
    const s = rich();
    const cap = yardCapacityFor(s, 'meridian');
    const fits = Math.floor(cap / 4);
    const ordered = build(s, fits * 2 + 3).state;
    const t1 = tickTurn(ordered).state;
    expect(battleships(t1) - battleships(ordered)).toBe(fits);
    expect(yardRoomFor(t1, 'meridian')).toBe(cap - fits * 4);
    expect(queue(t1)[0]!.onComplete!.magnitude).toBe(3);
    expect(queue(t1)[0]!.durationTurns - queue(t1)[0]!.progress).toBe(1);
    const t2 = tickTurn(t1).state;
    expect(battleships(t2) - battleships(t1)).toBe(3);
    expect(queue(t2)).toHaveLength(0);
  });

  it('aborts the queue and refunds it when the world is lost', () => {
    const s = rich();
    const ordered = build(s, 20).state;
    const left = queue(ordered)[0]!;
    ordered.systems.find((x) => x.id === 'sek-4')!.controllerFactionId = 'vigil';
    const before = credits(ordered);
    const t = tickTurn(ordered);
    expect(queue(t.state)).toHaveLength(0);
    expect(credits(t.state) - before).toBeGreaterThanOrEqual(left.investedCredits);
    expect(t.notes.join(' ')).toMatch(/aborted, the world is lost/);
  });

  it('refunds what is not laid down when the player cancels it', () => {
    const ordered = build(rich(), 20).state;
    const q = queue(ordered)[0]!;
    const out = applyOps(ordered, [{ op: 'cancel_order', orderId: q.id, reason: 'not needed' } as OpInput], 'model', 'meridian');
    expect(credits(out.state) - credits(ordered)).toBe(q.investedCredits);
  });

  it('trims to the treasury, and queues nothing from an orbit it does not hold', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'meridian')!.credits = 3 * BS + 10;
    const poor = build(s, 30);
    expect(credits(s) - credits(poor.state)).toBe(3 * BS);
    expect(poor.notes.join(' ')).toMatch(/can pay for 3 battleships of the 30/);

    const t = rich();
    const orbit = t.systems.find((x) => x.controllerFactionId === 'vigil')!;
    orbit.ships = { ...orbit.ships, meridian: { escort: 1 } };
    const out = build(t, 40, orbit.id);
    expect(queue(out.state)).toHaveLength(0);
    expect(out.notes.join(' ')).toMatch(/an orbit, not ground it holds/);
  });

  it('takes no programme: a model asking for one gets an ordinary build', () => {
    const s = rich();
    const out = applyOps(
      s,
      [{ op: 'build_ships', factionId: 'meridian', hull: 'escort', count: 2, systemId: 'sek-4', programme: true } as OpInput],
      'model', 'meridian', false, {}, 'declared',
    );
    expect(queue(out.state)).toHaveLength(0);
    expect(stackAt(out.state.systems.find((x) => x.id === 'sek-4')!, 'meridian').escort ?? 0).toBeGreaterThan(
      stackAt(s.systems.find((x) => x.id === 'sek-4')!, 'meridian').escort ?? 0,
    );
  });
});
