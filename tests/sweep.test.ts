import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { neighboursOf } from '../src/domain/graph.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * Clearing your own orbit.
 *
 * Presence is deliberately meaningful — parked ships take a share of a world's
 * income, blockade its lanes and suborn its crews — and there was no answer to
 * it. Battles resolve only on a `fleet_movement` ARRIVAL, a holder arriving at
 * its own world was read as reinforcing, and the one power that could have been
 * bought off (`subornLimit`) is zero against a resolute faction. Measured live:
 * the Iron Vigil held a hull over the player's Vergesse for five turns and
 * nothing in the rules could remove it.
 */

/** A world `hutt` holds, with `vigil` squatting over it and a fleet next door. */
function contested(squatters = 3, relief = 9): { state: WorldState; world: string; from: string } {
  const s = createSeedState('hutt');
  const world = s.systems.find((x) => x.controllerFactionId === 'hutt')!;
  world.ships.vigil = squatters;
  const from = neighboursOf(s, world.id).find((n) => n !== world.id)!;
  const base = s.systems.find((x) => x.id === from)!;
  base.ships.hutt = relief;
  return { state: s, world: world.id, from };
}

const arrive = (s: WorldState, from: string, to: string, force: number): WorldState => {
  const issued = applyOps(s, [{
    op: 'issue_order', factionId: 'hutt', type: 'fleet_movement',
    originId: from, targetId: to, force, label: 'clear the orbit', visibility: [],
  }], 'model', 'hutt', true).state;
  return tickTurn(issued).state;
};

describe('a holder can clear rivals out of its own orbit', () => {
  it('fights them instead of simply reinforcing', () => {
    const { state, world, from } = contested(3, 12);
    const after = arrive(state, from, world, 10);
    const sys = after.systems.find((x) => x.id === world)!;

    // The squatters were engaged, not walked past.
    expect(sys.ships.vigil ?? 0).toBeLessThan(3);
    expect(after.eventLog.some((e) => /clears the orbitals/.test(e.text))).toBe(true);
  });

  it('leaves the world in the holder’s hands and the garrison untouched', () => {
    const { state, world, from } = contested(3, 12);
    const before = state.systems.find((x) => x.id === world)!.garrison;
    const after = arrive(state, from, world, 10);
    const sys = after.systems.find((x) => x.id === world)!;

    // No ground phase: the holder already holds the ground.
    expect(sys.controllerFactionId).toBe('hutt');
    expect(sys.garrison).toBe(before);
  });

  /**
   * The garrison takes no part and grants no bonus, because the squatters never
   * held the ground. Purely ship against ship.
   */
  it('does not report a ground phase', () => {
    const { state, world, from } = contested(3, 12);
    const after = arrive(state, from, world, 10);
    const cleared = after.eventLog.filter((e) => /clears the orbitals/.test(e.text));
    expect(cleared.length).toBeGreaterThan(0);
    expect(after.eventLog.some((e) => /storms|breaking a garrison|takes possession/.test(e.text))).toBe(false);
  });

  it('still just reinforces when nobody is squatting', () => {
    const { state, world, from } = contested(0, 12);
    delete state.systems.find((x) => x.id === world)!.ships.vigil;
    const after = arrive(state, from, world, 4);
    expect(after.eventLog.some((e) => /reinforces/.test(e.text))).toBe(true);
    expect(after.eventLog.some((e) => /clears the orbitals/.test(e.text))).toBe(false);
  });

  /**
   * A guest was invited. `isGuestOf` already knows the difference, and a
   * basing-rights partner must not be shot at for taking up the invitation.
   */
  it('does not sweep an ally there under basing rights', () => {
    const { state, world, from } = contested(3, 12);
    const s = applyOps(state, [{
      op: 'form_treaty', treatyType: 'basing_rights',
      parties: ['hutt', 'vigil'], terms: {}, summary: 'the Vigil may put in',
    }], 'extraction', 'hutt', true).state;

    const after = arrive(s, from, world, 10);
    const sys = after.systems.find((x) => x.id === world)!;
    expect(sys.ships.vigil).toBe(3);
    expect(after.eventLog.some((e) => /clears the orbitals/.test(e.text))).toBe(false);
  });

  /**
   * Sweeping a power you have sworn peace with is still an attack. The victim
   * of a sweep is the squatter, not the holder — which is the whole reason the
   * pact check had to be generalised.
   */
  it('breaks a non-aggression pact with the power it sweeps', () => {
    const { state, world, from } = contested(3, 12);
    const s = applyOps(state, [{
      op: 'form_treaty', treatyType: 'non_aggression',
      parties: ['hutt', 'vigil'], terms: {}, summary: 'peace',
    }], 'extraction', 'hutt', true).state;

    const after = arrive(s, from, world, 10);
    expect(after.treaties[0]!.status).toBe('broken');
    expect(after.factions.find((f) => f.id === 'vigil')!.disposition.hutt ?? 0).toBeLessThan(
      s.factions.find((f) => f.id === 'vigil')!.disposition.hutt ?? 0,
    );
  });

  it('can fail, leaving the squatters in place', () => {
    // One hull against nine: the sweep is thrown back rather than succeeding.
    const { state, world, from } = contested(9, 4);
    const after = arrive(state, from, world, 1);
    const sys = after.systems.find((x) => x.id === world)!;
    expect(sys.ships.vigil ?? 0).toBeGreaterThan(0);
    expect(sys.controllerFactionId).toBe('hutt');
  });
});
