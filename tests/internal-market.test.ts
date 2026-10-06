import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { INTERNAL_MARKET_SHARE, internalLanes, routeEarnings } from '../src/domain/trade.js';
import { ledgerFor, setShipsAt, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Autarky as self-sufficiency: an autarkist's own connected worlds trade with
 * each other, paid to it alone, closed only by trouble on its own ground.
 */
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const name = (s: WorldState, id: string) => sys(s, id).name;

describe('the internal market', () => {
  it('pairs every two connected worlds of an autarkist, and nobody else', () => {
    const s = createSeedState('freeworlds');
    const lanes = internalLanes(s, 'freeworlds');
    // Arkane Prime, Delvane, Vashka and Pell Reach are one chain: six pairs.
    expect(lanes).toHaveLength(6);
    for (const lane of lanes) {
      expect(lane.path.every((id) => sys(s, id).controllerFactionId === 'freeworlds')).toBe(true);
    }
    expect(internalLanes(s, 'meridian')).toEqual([]);
  });

  it('pays the autarkist at a share of the network rate, outside the network pot', () => {
    const s = createSeedState('freeworlds');
    const e = routeEarnings(s);
    const full = internalLanes(s, 'freeworlds').reduce((n, l) => n + l.volume / INTERNAL_MARKET_SHARE, 0);
    expect(e.internal.freeworlds).toBe(Math.round(full * INTERNAL_MARKET_SHARE));
    const l = ledgerFor(s, 'freeworlds', e);
    expect(l.internalMarket).toBe(e.internal.freeworlds);
    expect(l.routes).toBe((e.shares.freeworlds ?? 0) + e.internal.freeworlds!);
  });

  it('trades only over its own ground: a world cut off trades with nobody', () => {
    const s = createSeedState('freeworlds');
    // Hand Delvane and Vashka away and Arkane Prime is cut off from Pell Reach.
    sys(s, 'ark-3').controllerFactionId = 'meridian';
    sys(s, 'ark-4').controllerFactionId = 'meridian';
    const lanes = internalLanes(s, 'freeworlds');
    const pairs = lanes.map((l) => l.endpoints.map((id) => name(s, id)).join('–'));
    expect(pairs).not.toContain('Arkane Prime–Pell Reach');
  });

  it('cannot be strangled from elsewhere, only on its own ground', () => {
    const s = createSeedState('freeworlds');
    const before = routeEarnings(s).internal.freeworlds!;
    // A blockade on somebody else's world closes network lanes, not this.
    setShipsAt(sys(s, 'sek-1'), 'vigil', 6);
    const far = tickTurn(
      applyOps(s, [{ op: 'issue_order', factionId: 'vigil', type: 'blockade', originId: 'sek-1', targetId: 'sek-1', durationTurns: 3 } as OpInput], 'model', 'vigil').state,
      { randomEvents: false },
    ).state;
    expect(routeEarnings(far).internal.freeworlds).toBe(before);
    // One on Delvane, in the middle of the chain, closes every lane through it.
    setShipsAt(sys(s, 'ark-3'), 'vigil', 6);
    const near = tickTurn(
      applyOps(s, [{ op: 'issue_order', factionId: 'vigil', type: 'blockade', originId: 'ark-3', targetId: 'ark-3', durationTurns: 3 } as OpInput], 'model', 'vigil').state,
      { randomEvents: false },
    ).state;
    expect(routeEarnings(near).internal.freeworlds!).toBeLessThan(before);
  });

  it('can be raided on its own worlds, and the raider is paid what it took', () => {
    const s = createSeedState('freeworlds');
    const before = routeEarnings(s).internal.freeworlds!;
    setShipsAt(sys(s, 'ark-3'), 'drajk', 6);
    const raided = tickTurn(
      applyOps(s, [{ op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding', originId: 'ark-3', targetId: 'ark-3', durationTurns: 3 } as OpInput], 'model', 'drajk').state,
      { randomEvents: false },
    ).state;
    const e = routeEarnings(raided);
    expect(e.internal.freeworlds!).toBeLessThan(before);
    expect(e.internalTaken.drajk!).toBeGreaterThan(0);
    expect(e.raidedFrom.drajk?.freeworlds ?? 0).toBeGreaterThanOrEqual(e.internalTaken.drajk!);
  });
});
