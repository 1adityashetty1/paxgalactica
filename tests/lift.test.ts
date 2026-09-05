import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  HULL_SPEC,
  LIFTER_CARRY,
  drawProportional,
  hullsIn,
  tonsIn,
  trimToTons,
  type HullClass,
  type ShipStack,
} from '../src/domain/hulls.js';
import {
  addShipsAt,
  fleetTonsOf,
  hullsAt,
  setShipsAt,
  stackAt,
  type WorldState,
} from '../src/domain/state.js';

const fresh = (): WorldState => createSeedState('freeworlds');
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

/**
 * Land a composed force on slu-6 and return the settled board.
 *
 * ark-3 → ark-4 → slu-6 is two jumps, so the fleet is ticked until it lands.
 */
function land(setup: (s: WorldState) => void, force: ShipStack) {
  const state = fresh();
  const origin = sys(state, 'ark-3');
  origin.ships = {};
  for (const [hull, n] of Object.entries(force) as [HullClass, number][]) {
    addShipsAt(origin, 'freeworlds', n, hull);
  }
  setup(state);
  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-3', targetId: 'slu-6', force,
    },
  ]);
  expect(issued.rejections).toHaveLength(0);
  let r = tickTurn(issued.state);
  while (r.state.pendingOrders.some((o) => o.id === 'ord-0-0')) r = tickTurn(r.state);
  return r;
}

/** An enemy world with a garrison and nothing in orbit. */
const heldWorld = (garrison: number, garrisonMax = garrison) => (s: WorldState) => {
  const t = sys(s, 'slu-6');
  t.controllerFactionId = 'vigil';
  t.ships = {};
  t.garrison = garrison;
  t.garrisonMax = garrisonMax;
};

describe('a world is taken by the lift arm', () => {
  it('lets an all-warship fleet win the orbitals and take nothing', () => {
    // The whole point of the class: guns clear the space above a world and
    // cannot put anybody on it.
    const res = land(heldWorld(4), { battleship: 40 });
    const target = sys(res.state, 'slu-6');
    expect(target.controllerFactionId).toBe('vigil');
    expect(target.garrison).toBe(4);
    expect(res.notes.join(' ')).toMatch(/no troops aboard to land/);
    // And the fleet is intact and in orbit — it lost nothing, it simply could
    // not finish the job.
    expect(hullsAt(target, 'freeworlds')).toBe(40);
  });

  it('takes the same world once there is lift aboard', () => {
    const res = land(heldWorld(4), { battleship: 40, lifter: 2 });
    expect(sys(res.state, 'slu-6').controllerFactionId).toBe('freeworlds');
    expect(res.notes.join(' ')).toMatch(/storms/);
  });

  it('counts troops, not hulls, against the garrison', () => {
    // One lifter carries LIFTER_CARRY, so it beats a garrison below that and
    // fails against one comfortably above it — whatever else is in the fleet.
    const small = land(heldWorld(LIFTER_CARRY - 4), { battleship: 30, lifter: 1 });
    const large = land(heldWorld(LIFTER_CARRY * 4), { battleship: 30, lifter: 1 });
    expect(sys(small.state, 'slu-6').controllerFactionId).toBe('freeworlds');
    expect(sys(large.state, 'slu-6').controllerFactionId).toBe('vigil');
  });
});

describe('the landing is paid for in transports', () => {
  it('spends lifters and leaves the battle line untouched', () => {
    const res = land(heldWorld(20), { battleship: 20, lifter: 6 });
    const target = sys(res.state, 'slu-6');
    expect(target.controllerFactionId).toBe('freeworlds');
    const survivors = stackAt(target, 'freeworlds');
    // The escorting battle line was never in the ground fight.
    expect(survivors.battleship).toBe(20);
    expect(survivors.lifter!).toBeLessThan(6);
    expect(res.notes.join(' ')).toMatch(/lifters/);
  });

  it('costs more lift against a deeper garrison', () => {
    const liftLeft = (garrison: number) => {
      const res = land(heldWorld(garrison), { battleship: 20, lifter: 8 });
      return stackAt(sys(res.state, 'slu-6'), 'freeworlds').lifter ?? 0;
    };
    expect(liftLeft(40)).toBeLessThan(liftLeft(4));
  });
});

describe('the captured garrison is the force that took it', () => {
  it('is the surviving troops, not a fraction of the defenders', () => {
    const res = land(heldWorld(4, 60), { battleship: 20, lifter: 5 });
    const target = sys(res.state, 'slu-6');
    expect(target.controllerFactionId).toBe('freeworlds');
    const ashore = (stackAt(target, 'freeworlds').lifter ?? 0) * LIFTER_CARRY;
    expect(target.garrison).toBe(ashore);
  });

  it('never quarters more than the world can hold', () => {
    const res = land(heldWorld(4, 9), { battleship: 20, lifter: 8 });
    const target = sys(res.state, 'slu-6');
    expect(target.controllerFactionId).toBe('freeworlds');
    expect(target.garrison).toBe(9);
  });

  it('leaves a bigger occupation behind for a bigger landing', () => {
    const held = (lifter: number) =>
      sys(land(heldWorld(6, 60), { battleship: 20, lifter }).state, 'slu-6').garrison;
    expect(held(8)).toBeGreaterThan(held(3));
  });
});

describe('a fleet that cannot shoot cannot hold an orbit', () => {
  it('destroys unarmed squatters rather than deadlocking on them', () => {
    // A pure-lift fleet has zero combat weight, which every branch of the
    // exchange reads as "nothing to fight". Left alone it would deny a landing
    // forever; it has to be a walkover that destroys them.
    const res = land((s) => {
      const t = sys(s, 'slu-6');
      t.controllerFactionId = 'vigil';
      t.ships = {};
      addShipsAt(t, 'vigil', 9, 'lifter');
      t.garrison = 2;
      t.garrisonMax = 2;
    }, { battleship: 20, lifter: 2 });
    const target = sys(res.state, 'slu-6');
    expect(hullsAt(target, 'vigil')).toBe(0);
    expect(res.notes.join(' ')).toMatch(/nothing over .* that can fight/);
    expect(target.controllerFactionId).toBe('freeworlds');
  });

  it('annihilates an invasion that arrives as transports only', () => {
    const res = land((s) => {
      const t = sys(s, 'slu-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 12);
      t.garrison = 2;
      t.garrisonMax = 2;
    }, { lifter: 6 });
    const target = sys(res.state, 'slu-6');
    expect(target.controllerFactionId).toBe('vigil');
    expect(res.notes.join(' ')).toMatch(/nothing that can fight/);
    // Destroyed, not sent home: none of the six is anywhere on the board, and
    // none fell back down its path either.
    expect(hullsAt(target, 'freeworlds')).toBe(0);
    expect(hullsAt(sys(res.state, 'ark-4'), 'freeworlds')).toBe(
      hullsAt(sys(fresh(), 'ark-4'), 'freeworlds'),
    );
    expect(res.state.pendingOrders).toHaveLength(0);
  });
});

describe('a transport dies with the line that was covering it', () => {
  it('takes losses on the lift arm in an orbital exchange', () => {
    // Losses are counted in TONS, so a lifter's lack of guns does not make it
    // unhittable — otherwise a mixed fleet would carry its transports through
    // any battle free and strictly dominate a pure warfleet of the same size.
    const res = land((s) => {
      const t = sys(s, 'slu-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 26);
      t.garrison = 1;
      t.garrisonMax = 1;
    }, { battleship: 30, lifter: 10 });
    const text = res.notes.join(' ');
    expect(text).toMatch(/Fleets engage/);
    // Somewhere on the board, fewer Arkanis hulls than sailed.
    const left = res.state.systems.reduce((n, x) => n + hullsAt(x, 'freeworlds'), 0);
    const started = fresh().systems.reduce((n, x) => n + hullsAt(x, 'freeworlds'), 0);
    expect(left).toBeLessThan(started - hullsAt(sys(fresh(), 'ark-3'), 'freeworlds') + 40);
  });
});

describe('a bare force number keeps the squadron s shape', () => {
  it('draws proportionally rather than by class', () => {
    const drawn = drawProportional({ battleship: 8, escort: 4, lifter: 4 }, 8);
    expect(hullsIn(drawn)).toBe(8);
    expect(drawn).toEqual({ battleship: 4, escort: 2, lifter: 2 });
  });

  it('sends transports with a plainly stated force, so an invasion can be ordered in one number', () => {
    const state = fresh();
    const origin = sys(state, 'ark-3');
    origin.ships = {};
    addShipsAt(origin, 'freeworlds', 12, 'battleship');
    addShipsAt(origin, 'freeworlds', 4, 'lifter');
    const res = applyOps(state, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-3', targetId: 'slu-6', force: 8,
      },
    ]);
    expect(res.rejections).toHaveLength(0);
    const sailed = res.state.pendingOrders[0]!.force;
    expect(hullsIn(sailed)).toBe(8);
    expect(sailed.lifter).toBeGreaterThan(0);
    // The other eight stayed behind, and the input state is untouched.
    expect(hullsIn(stackAt(sys(res.state, 'ark-3'), 'freeworlds'))).toBe(8);
    expect(hullsAt(origin, 'freeworlds')).toBe(16);
  });

  it('trims a named composition per class instead of substituting', () => {
    // Asking for six lifters where two are berthed sends the two, and does not
    // make the difference up out of the battle line.
    const state = fresh();
    const origin = sys(state, 'ark-3');
    origin.ships = {};
    addShipsAt(origin, 'freeworlds', 10, 'battleship');
    addShipsAt(origin, 'freeworlds', 2, 'lifter');
    const res = applyOps(state, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-3', targetId: 'slu-6', force: { battleship: 3, lifter: 6 },
      },
    ]);
    expect(res.state.pendingOrders[0]!.force).toEqual({ battleship: 3, lifter: 2 });
    expect(res.notes.join(' ')).toMatch(/could sail/);
  });
});

describe('tonnage is the unit every fleet limit is measured in', () => {
  it('bills the yards by displacement, so a class costs what it displaces', () => {
    const price = (hull: 'battleship' | 'escort' | 'lifter', n: number) => {
      const start = fresh();
      const purse = start.factions.find((f) => f.id === 'freeworlds')!.credits;
      const res = applyOps(start, [
        { op: 'adjust_fleet', factionId: 'freeworlds', delta: n, hull },
      ]);
      expect(res.rejections).toHaveLength(0);
      return purse - res.state.factions.find((f) => f.id === 'freeworlds')!.credits;
    };
    expect(price('battleship', 2)).toBe(2 * 60);
    expect(price('lifter', 2)).toBe(2 * 45);
    expect(price('escort', 2)).toBe(2 * 30);
  });

  it('charges upkeep by displacement too', () => {
    const upkeepOf = (mutate: (s: WorldState) => void) => {
      const s = fresh();
      mutate(s);
      return fleetTonsOf(s, 'freeworlds');
    };
    const base = upkeepOf(() => {});
    expect(upkeepOf((s) => addShipsAt(sys(s, 'ark-1'), 'freeworlds', 1, 'escort'))).toBe(
      base + HULL_SPEC.escort.tonnage,
    );
    expect(upkeepOf((s) => addShipsAt(sys(s, 'ark-1'), 'freeworlds', 1, 'lifter'))).toBe(
      base + HULL_SPEC.lifter.tonnage,
    );
  });

  it('takes losses in tons, cheapest hulls first', () => {
    const stack = { battleship: 4, escort: 4, lifter: 2 };
    const { taken, left } = trimToTons(stack, tonsIn(stack) - 6);
    // Six tons is three escorts — spent before anything heavier is touched.
    expect(taken).toEqual({ escort: 3 });
    expect(left).toEqual({ battleship: 4, escort: 1, lifter: 2 });
  });
});
