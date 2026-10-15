import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { addShipsAt, setShipsAt, type WorldState } from '../src/domain/state.js';

/**
 * What stands on a world changes hands with it — "anything with that
 * `atSystemId` goes with it". For most of the game's life only
 * `transfer_control` moved anything, so a world stormed in a real battle, or
 * ceded under a treaty, left its fixtures, cargo and prisoners with the power
 * that lost it. Journal version 21 (`LegacyRules.assetsGoWithWorld`).
 *
 * The Rim is held still and worlds keep no regard, so a taken world does not
 * rise on the same tick and nothing else moves the ground under the test.
 */
const fresh = (): WorldState => createSeedState('freeworlds', { regard: false });
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

/** Put one seeded fixture and one seeded cargo on `systemId`, held by `holder`. */
function plant(s: WorldState, systemId: string, holder: string): { fixture: string; cargo: string } {
  const fixture = s.assets.find((a) => !a.portable)!;
  const cargo = s.assets.find((a) => a.portable && a.note === undefined && a.atSystemId !== null)!;
  for (const a of [fixture, cargo]) {
    a.atSystemId = systemId;
    a.heldBy = holder;
  }
  return { fixture: fixture.id, cargo: cargo.id };
}

/** Storm sek-6 from ark-3 through a real `fleet_movement` arrival. */
function storm(legacy: LegacyRules = {}) {
  const state = fresh();
  const target = sys(state, 'sek-6');
  target.controllerFactionId = 'vigil';
  target.garrison = 2;
  target.garrisonMax = 2;
  setShipsAt(target, 'vigil', 0);
  const ids = plant(state, 'sek-6', 'vigil');

  setShipsAt(sys(state, 'ark-3'), 'freeworlds', 0);
  addShipsAt(sys(state, 'ark-3'), 'freeworlds', 8, 'battleship');
  addShipsAt(sys(state, 'ark-3'), 'freeworlds', 2, 'lifter');
  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-3', targetId: 'sek-6', force: { battleship: 8, lifter: 2 },
    },
  ]);
  expect(issued.rejections).toHaveLength(0);
  const orderId = issued.state.pendingOrders.find((o) => o.type === 'fleet_movement')!.id;

  let result = tickTurn(issued.state, { randomEvents: false, ...legacy });
  while (result.state.pendingOrders.some((o) => o.id === orderId)) {
    result = tickTurn(result.state, { randomEvents: false, ...legacy });
  }
  return { state: result.state, ...ids };
}

describe('a world taken takes what stands on it', () => {
  it('hands a stormed world’s fixture and cargo to the conqueror', () => {
    const { state, fixture, cargo } = storm();
    expect(sys(state, 'sek-6').controllerFactionId).toBe('freeworlds');
    const held = (id: string) => state.assets.find((a) => a.id === id)!;
    expect(held(fixture).heldBy).toBe('freeworlds');
    expect(held(cargo).heldBy).toBe('freeworlds');
    // Still standing where they stood: the world moved, not the things on it.
    expect(held(fixture).atSystemId).toBe('sek-6');
    expect(held(cargo).atSystemId).toBe('sek-6');
  });

  it('leaves them with the loser under a journal written before the rule', () => {
    const { state, fixture, cargo } = storm({ assetsGoWithWorld: false });
    expect(sys(state, 'sek-6').controllerFactionId).toBe('freeworlds');
    expect(state.assets.find((a) => a.id === fixture)!.heldBy).toBe('vigil');
    expect(state.assets.find((a) => a.id === cargo)!.heldBy).toBe('vigil');
  });

  it('hands a ceded world’s fixture and cargo to the receiver', () => {
    const state = fresh();
    expect(sys(state, 'ark-6').controllerFactionId).toBe('freeworlds');
    const { fixture, cargo } = plant(state, 'ark-6', 'freeworlds');
    const cede = {
      op: 'form_treaty',
      treatyType: 'cession' as const,
      parties: ['freeworlds', 'ojjul'],
      terms: { territory: ['ark-6'] },
      summary: 'a negotiated withdrawal',
    };
    const out = applyOps(state, [cede], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    expect(sys(out.state, 'ark-6').controllerFactionId).toBe('ojjul');
    expect(out.state.assets.find((a) => a.id === fixture)!.heldBy).toBe('ojjul');
    expect(out.state.assets.find((a) => a.id === cargo)!.heldBy).toBe('ojjul');

    const legacy = applyOps(state, [cede], 'extraction', 'freeworlds', false, { assetsGoWithWorld: false });
    expect(legacy.state.assets.find((a) => a.id === fixture)!.heldBy).toBe('freeworlds');
  });
});
