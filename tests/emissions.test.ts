import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { EMISSION_RANGE, EMITTING_CATEGORIES, COVERT_CATEGORIES, observeOrders, visibilityOf } from '../src/domain/intel.js';
import { jumpsBetween } from '../src/domain/graph.js';
import { setShipsAt, setStackAt, type OrderType, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Emissions: a listener hears loud work — a raid, a secret yard programme —
 * `EMISSION_RANGE` jumps out, and nothing done by people in rooms. Borrowed from
 * HighFleet's ELINT. Fleet movements are public already, so they are not what a
 * listener is for.
 */

const ME = 'ojjul';
/** Free Worlds space, where the Combine has nobody. */
const FOREIGN = 'ark-1';

/** The Combine with no ears anywhere, so each test places exactly the ones it means. */
function deaf(): WorldState {
  const s = createSeedState(ME);
  for (const sys of s.systems) {
    const st = sys.ships[ME];
    if (st?.listener) setStackAt(sys, ME, { ...st, listener: 0 });
  }
  return s;
}

/** A listener `jumps` from FOREIGN, on a world that is not the Combine's own space at FOREIGN. */
function earsAt(s: WorldState, jumps: number): WorldState {
  const post = s.systems
    // `jumpsBetween` floors at one, so a world counts as one jump from itself.
    .filter((x) => x.id !== FOREIGN && jumpsBetween(s.systems, x.id, FOREIGN) === jumps)
    .sort((a, b) => a.id.localeCompare(b.id))[0]!;
  setStackAt(post, ME, { listener: 1 });
  return s;
}

function withOrder(s: WorldState, type: OrderType, faction = 'freeworlds'): WorldState {
  const out = applyOps(s, [
    {
      op: 'issue_order',
      factionId: faction,
      type,
      originId: FOREIGN,
      targetId: FOREIGN,
      durationTurns: 3,
      label: 'loud work',
    } as OpInput,
  ]);
  expect(out.rejections).toEqual([]);
  return out.state;
}

const seen = (s: WorldState) => visibilityOf(s, ME, s.pendingOrders[0]!);

describe('a listener hears loud work past the world it guards', () => {
  it('hears a secret yard programme within range', () => {
    for (let jumps = 1; jumps <= EMISSION_RANGE; jumps++) {
      expect(seen(withOrder(earsAt(deaf(), jumps), 'refit')), `${jumps} jump(s)`).toBe('full');
    }
  });

  it('hears a raid, which is covert and is exactly what a listener on a lane is for', () => {
    const s = earsAt(deaf(), EMISSION_RANGE);
    setShipsAt(s.systems.find((x) => x.id === FOREIGN)!, 'drajk', 4);
    expect(seen(withOrder(s, 'commerce_raiding', 'drajk'))).toBe('full');
  });

  it('hears nothing past its range', () => {
    expect(seen(withOrder(earsAt(deaf(), EMISSION_RANGE + 1), 'refit'))).toBe('rumour');
  });

  it('hears nothing done by people in rooms', () => {
    for (const type of COVERT_CATEGORIES) {
      if (EMITTING_CATEGORIES.has(type)) continue;
      expect(seen(withOrder(earsAt(deaf(), 1), type as OrderType)), type).toBe('rumour');
    }
  });

  it('reaches the briefing and the payload, which read the same split', () => {
    const s = withOrder(earsAt(deaf(), EMISSION_RANGE), 'capital_ship_construction');
    expect(observeOrders(s, ME).orders).toHaveLength(1);
    expect(observeOrders(s, ME).rumours).toHaveLength(0);
  });

  it('is nothing without a listener: a deaf power still hears a rumour', () => {
    expect(seen(withOrder(deaf(), 'refit'))).toBe('rumour');
  });
});
