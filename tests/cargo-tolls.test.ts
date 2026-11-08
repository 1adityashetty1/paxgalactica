import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { routeEarnings, tradeRoutes, TOLL_RATE, BASE_TOLL_RATE } from '../src/domain/trade.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * A toll is a cut of the cargo (journal version 38). It was a cut of a crossed
 * world's slice of the lane, which made it 1–4% of what a payer earned there:
 * the Combine collected 12 a turn on the opening board against a net of 265.
 */
describe('a toll is a cut of the cargo', () => {
  const seed = () => createSeedState('meridian');
  const legacy = () => createSeedState('meridian', { cargoTolls: false });
  const free = (s: WorldState): WorldState => {
    for (const f of s.factions) f.tollTargets = [];
    return s;
  };

  it('takes the rate of what each paying end received, once per lane per collector', () => {
    const s = seed();
    const open = routeEarnings(free(seed()));
    const charged = routeEarnings(s);
    // Everything the Combine collects, somebody paid, and nobody else collects.
    const collected = Object.values(charged.tolls).reduce((n, v) => n + v, 0);
    const paid = Object.values(charged.tollsPaid).reduce((n, v) => n + v, 0);
    expect(Math.abs(collected - paid)).toBeLessThanOrEqual(2);
    expect(Object.keys(charged.tolls)).toEqual(['ojjul']);
    // What a payer loses is a real share of its lanes: at most the higher rate
    // of what those lanes paid it, and far more than the old basis took.
    for (const id of ['meridian', 'vigil']) {
      const lost = (open.shares[id] ?? 0) - (charged.shares[id] ?? 0);
      expect(lost).toBe(charged.tollsPaid[id]);
      expect(lost).toBeLessThanOrEqual(Math.ceil((open.shares[id] ?? 0) * TOLL_RATE));
      expect(lost).toBeGreaterThan(3 * (routeEarnings(legacy()).tollsPaid[id] ?? 0));
    }
  });

  it('charges a lane the collector ends at, and crosses nothing of, at the base rate', () => {
    const s = seed();
    const e = routeEarnings(s);
    // Some lane must end at a Combine hub and cross none of its worlds, and the
    // tolls placed at those hubs are at the base rate — at most a quarter.
    const ends = tradeRoutes(s).some((r) => {
      const held = (id: string) => s.systems.find((x) => x.id === id)?.controllerFactionId === 'ojjul';
      return (held(r.endpoints[0]) || held(r.endpoints[1])) && !r.path.slice(1, -1).some(held);
    });
    expect(ends).toBe(true);
    expect(BASE_TOLL_RATE).toBe(TOLL_RATE / 2);
    expect(e.tolls.ojjul).toBeGreaterThan(30);
  });

  it('spares the Confederacy, which opens on Vosk Marker', () => {
    const s = seed();
    expect(s.factions.find((f) => f.id === 'ojjul')!.tollTargets).not.toContain('drajk');
    expect(s.systems.find((x) => x.id === 'ilv-4')!.controllerFactionId).toBe('drajk');
    expect(s.systems.find((x) => x.id === 'ilv-4')!.homeFactionId).toBe('drajk');
    expect(routeEarnings(s).tollsPaid.drajk ?? 0).toBe(0);
  });

  it('rebuilds the old board and the old basis for a journal before version 38', () => {
    const s = legacy();
    expect(s.tollBasis).toBe('hop');
    expect(s.systems.find((x) => x.id === 'ilv-4')!.controllerFactionId).toBeNull();
    expect(s.factions.find((f) => f.id === 'ojjul')!.tollTargets).toContain('drajk');
    expect(routeEarnings(s).tolls.ojjul).toBe(12);
  });
});
