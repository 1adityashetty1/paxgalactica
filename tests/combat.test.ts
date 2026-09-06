import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, GARRISON_REGROWTH, DISSENT_DECAY } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { STAT_NAMES } from '../src/domain/checks.js';
import { LIFTER_CARRY, hullsIn } from '../src/domain/hulls.js';
import {
  addShipsAt,
  hullsAt,
  setShipsAt,
  dissentPenalty,
  DISSENT_PER_PENALTY_POINT,
  effectiveStats,
  fleetStrengthOf,
  MAX_DISSENT_PENALTY,
  shipsInTransit,
  type WorldState,
} from '../src/domain/state.js';

const fresh = (): WorldState => createSeedState('freeworlds');
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const shipsOf = (s: WorldState, sysId: string, f: string) => hullsAt(sys(s, sysId), f);

/**
 * Send `force` battleships and `lift` lifters from ark-3 to sek-6 and tick
 * until they arrive.
 *
 * That route is TWO jumps (ark-3 → ark-4 → sek-6), so a single tick lands
 * nothing — the fleet is still in transit.
 *
 * `lift` defaults to none, so an orbital test sends a pure battle fleet and
 * gets the arithmetic it always did. **A ground test must ask for lift**: a
 * world is taken by the troops the lift arm lands, and a fleet of pure
 * warships wins the orbitals and takes nothing.
 */
function attack(setup: (s: WorldState) => void, force = 8, lift = 0) {
  const state = fresh();
  setShipsAt(sys(state, 'ark-3'), 'freeworlds', force);
  if (lift > 0) addShipsAt(sys(state, 'ark-3'), 'freeworlds', lift, 'lifter');
  setup(state);
  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-3', targetId: 'sek-6',
      force: { battleship: force, lifter: lift },
    },
  ]);
  expect(issued.rejections).toHaveLength(0);

  let result = tickTurn(issued.state);
  while (result.state.pendingOrders.some((o) => o.id === 'ord-0-0')) {
    result = tickTurn(result.state);
  }
  return result;
}

describe('the fleet is the ships', () => {
  it('derives fleet strength from what is on the board', () => {
    const state = fresh();
    const counted = state.systems.reduce((n, s) => n + (hullsAt(s, 'freeworlds')), 0);
    expect(fleetStrengthOf(state, 'freeworlds')).toBe(counted);
    expect(counted).toBeGreaterThan(0);
  });

  it('keeps ships in transit inside the total, so a fleet cannot vanish en route', () => {
    const before = fleetStrengthOf(fresh(), 'freeworlds');
    const moving = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'tor-3', force: 5,
      },
    ]).state;
    expect(shipsInTransit(moving, 'freeworlds')).toBe(5);
    expect(fleetStrengthOf(moving, 'freeworlds')).toBe(before);
    // ...and they have physically left the origin.
    expect(shipsOf(moving, 'ark-1', 'freeworlds')).toBe(
      shipsOf(fresh(), 'ark-1', 'freeworlds') - 5,
    );
  });

  it('commits only the stated force, not the whole navy', () => {
    const moving = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'ark-4', force: 3,
      },
    ]).state;
    expect(hullsIn(moving.pendingOrders[0]!.force)).toBe(3);
  });

  it('clamps a request to what is actually at the origin, and says so', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'ark-4', force: 9999,
      },
    ]);
    expect(res.notes.join(' ')).toMatch(/only .+ could sail/);
    expect(hullsIn(res.state.pendingOrders[0]!.force)).toBe(shipsOf(fresh(), 'ark-1', 'freeworlds'));
  });

  it('refuses a movement from a system with no ships', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'sek-3', targetId: 'sek-6', force: 4,
      },
    ]);
    expect(res.rejections.map((r) => r.code)).toEqual(['illegal_value']);
  });

  it('returns the ships when a movement is cancelled or interrupted', () => {
    const before = fleetStrengthOf(fresh(), 'freeworlds');
    const moving = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'tor-3', force: 6, onInterrupt: 'partial',
      },
    ]).state;

    const cancelled = applyOps(moving, [{ op: 'cancel_order', orderId: 'ord-0-0' }]).state;
    expect(fleetStrengthOf(cancelled, 'freeworlds')).toBe(before);

    const halted = applyOps(moving, [{ op: 'interrupt_order', orderId: 'ord-0-0' }]).state;
    expect(fleetStrengthOf(halted, 'freeworlds')).toBe(before);
  });
});

describe('phase 1 — the fleet battle', () => {
  it('lands unopposed on a system with nobody in orbit AND nobody on the ground', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      setShipsAt(t, 'freeworlds', 0);
      // Unaligned is not the same as undefended: the garrison has to be gone
      // too, or this is a ground assault.
      t.garrison = 0;
      t.garrisonMax = 0;
    }, 6);
    expect(res.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBe('freeworlds');
    expect(shipsOf(res.state, 'sek-6', 'freeworlds')).toBe(6);
    expect(res.notes.join(' ')).toMatch(/unopposed/);
  });

  it('is fought before the ground: a defending fleet blocks any landing', () => {
    // A large defending fleet and a token garrison. The garrison must survive
    // untouched, because ground forces are never reached while ships hold.
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 40);
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 4);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('vigil');
    expect(target.garrison).toBe(1);
    expect(res.notes.join(' ')).toMatch(/driven off|still holds the orbitals/);
  });

  // These two use the Nars rather than the Iron Vigil, which used to defend
  // here: the Vigil is `crusading` now and does not break off at all, so it can
  // no longer demonstrate a retreat. The Nars are `profiteer`, which carries no
  // battlefield doctrine, making them the neutral subject these want.
  it('lets an outmatched defender retreat rather than be annihilated', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'ojjul';
      setShipsAt(t, 'ojjul', 2);
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 40);
    const text = res.notes.join(' ');
    expect(text).toMatch(/breaks off|scattered/);
    // Survivors fall back to another Nar world rather than evaporating.
    expect(res.state.systems.find((x) => x.id === 'sek-6')!.ships['ojjul']).toBeUndefined();
  });

  it('costs a retreating force 10–35% of its strength', () => {
    const before = 20;
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'ojjul';
      setShipsAt(t, 'ojjul', before);
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 200);
    const escaped = res.state.systems
      .filter((x) => x.id !== 'sek-6')
      .reduce((n, x) => n + (hullsAt(x, 'ojjul')), 0);
    const baseline = fresh().systems.reduce((n, x) => n + (hullsAt(x, 'ojjul')), 0);
    const survivors = escaped - baseline;
    expect(survivors).toBeGreaterThanOrEqual(Math.ceil(before * 0.65));
    expect(survivors).toBeLessThanOrEqual(Math.ceil(before * 0.9));
  });

  it('lets an outmatched attacker withdraw one jump back down its path', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 60);
    }, 3);
    expect(res.notes.join(' ')).toMatch(/driven off/);
    // The route is ark-3 → ark-4 → sek-6, so survivors fall back to ark-4 —
    // the hop they came from, not all the way home.
    expect(shipsOf(res.state, 'ark-4', 'freeworlds')).toBeGreaterThan(
      shipsOf(fresh(), 'ark-4', 'freeworlds'),
    );
  });
});

describe('phase 2 — the ground assault', () => {
  it('takes the world when the landing beats the garrison', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 3;
      t.garrisonMax = 3;
      setShipsAt(t, 'vigil', 0);
    }, 30, 2);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('freeworlds');
    expect(res.notes.join(' ')).toMatch(/storms/);
    // The victor's surviving ships are in orbit.
    expect(hullsAt(target, 'freeworlds')).toBeGreaterThan(0);
  });

  it('is thrown back by a garrison too strong to land against', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 90;
      t.garrisonMax = 90;
      setShipsAt(t, 'vigil', 0);
    }, 3, 2);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('vigil');
    expect(res.notes.join(' ')).toMatch(/thrown back/);
  });

  it('never lets a garrison retreat — it fights where it stands', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 90;
      t.garrisonMax = 90;
      setShipsAt(t, 'vigil', 0);
    }, 3, 2);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    // Damaged, but still in place and still Vigil's.
    expect(target.garrison).toBeGreaterThan(0);
    expect(target.garrison).toBeLessThan(90);
  });
});

describe('garrisons regrow', () => {
  it('rebuilds toward the ceiling, free of fleet and treasury', () => {
    const state = fresh();
    const target = sys(state, 'ark-1');
    target.garrison = 2;
    const creditsBefore = state.factions.find((f) => f.id === 'freeworlds')!.credits;
    const fleetBefore = fleetStrengthOf(state, 'freeworlds');

    const after = tickTurn(state).state;
    const grown = after.systems.find((s) => s.id === 'ark-1')!;
    expect(grown.garrison).toBe(2 + GARRISON_REGROWTH);
    // Ground forces are raised locally — they cost neither hulls nor money.
    expect(fleetStrengthOf(after, 'freeworlds')).toBe(fleetBefore);
    expect(after.factions.find((f) => f.id === 'freeworlds')!.credits).toBeGreaterThan(
      creditsBefore - 1,
    );
  });

  it('stops at the ceiling', () => {
    let state = fresh();
    sys(state, 'ark-1').garrison = sys(state, 'ark-1').garrisonMax;
    const cap = sys(state, 'ark-1').garrisonMax;
    for (let i = 0; i < 4; i++) state = tickTurn(state).state;
    expect(sys(state, 'ark-1').garrison).toBe(cap);
  });

  it('leaves unaligned worlds to fend for themselves', () => {
    const state = fresh();
    const neutral = sys(state, 'sek-3');
    neutral.garrison = 1;
    const after = tickTurn(state).state;
    expect(after.systems.find((s) => s.id === 'sek-3')!.garrison).toBe(1);
  });

  it('lets a captured world slowly re-arm under its new owner', () => {
    let state = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 3;
      t.garrisonMax = 12;
      setShipsAt(t, 'vigil', 0);
    }, 30, 2).state;
    expect(sys(state, 'sek-6').controllerFactionId).toBe('freeworlds');
    const justTaken = sys(state, 'sek-6').garrison;
    for (let i = 0; i < 3; i++) state = tickTurn(state).state;
    expect(sys(state, 'sek-6').garrison).toBe(justTaken + 3 * GARRISON_REGROWTH);
  });
});

describe('retreat costs ships only when opposed', () => {
  it('lands with the whole force intact when nothing is there to fight', () => {
    // No opposing ships means no battle, so no retreat and no bleed.
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = null;
      t.ships = {};
      t.garrison = 0;
      t.garrisonMax = 0;
    }, 9);
    expect(shipsOf(res.state, 'sek-6', 'freeworlds')).toBe(9);
    expect(res.notes.join(' ')).not.toMatch(/breaks off|driven off|scattered/);
  });

  it('makes an unaligned world fight with its garrison, like any other', () => {
    // The seed gives neutral worlds garrisons of 2–5. Treating "nobody owns
    // it" as "nobody defends it" made every neutral in the galaxy free, and
    // handed the conqueror the militia it never fought.
    const repulsed = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = null;
      t.ships = {};
      t.garrison = 8;
      t.garrisonMax = 8;
    }, 3, 1);
    expect(repulsed.notes.join(' ')).toMatch(/thrown back/);
    expect(repulsed.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBeNull();

    const taken = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = null;
      t.ships = {};
      t.garrison = 4;
      t.garrisonMax = 4;
    }, 20, 2);
    const world = taken.state.systems.find((x) => x.id === 'sek-6')!;
    expect(taken.notes.join(' ')).toMatch(/storms/);
    expect(world.controllerFactionId).toBe('freeworlds');
    // The garrison it inherits is its OWN landing force, capped by what the
    // world can quarter — not a fraction of the militia it just destroyed.
    expect(world.garrison).toBeLessThanOrEqual(world.garrisonMax);
    expect(world.garrison).toBeGreaterThan(0);
  });

  it('loses nothing walking into an undefended enemy world it cannot take', () => {
    // A garrison it cannot beat still costs ships — but to the GROUND assault,
    // never to a retreat, because no fleet opposed it in orbit.
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 99;
      t.garrisonMax = 99;
      t.ships = {};
    }, 9, 2);
    const text = res.notes.join(' ');
    expect(text).toMatch(/thrown back/);
    expect(text).not.toMatch(/breaks off|driven off|withdrawing/);
  });

  it('only bleeds a withdrawal when opposing ships were present', () => {
    const opposed = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 80);
    }, 4);
    expect(opposed.notes.join(' ')).toMatch(/driven off/);

    const unopposed = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.ships = {};
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 4, 1);
    // Same force, no defending fleet: it arrives whole and takes the world.
    expect(unopposed.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBe(
      'freeworlds',
    );
  });

  it('treats any non-attacker ships in system as defenders', () => {
    // A third power parked in a rival's orbit used to be walked straight past,
    // while still drawing a share of the system's income.
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 0);
      setShipsAt(t, 'drajk', 70); // Vigil holds it; Drajk is squatting in orbit
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 3);
    expect(res.notes.join(' ')).toMatch(/driven off/);
    expect(res.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBe('vigil');
  });
});

describe('a garrison under attack does not grow', () => {
  it('stays put while hostile ships sit in orbit', () => {
    const state = fresh();
    const besieged = sys(state, 'ark-1');
    besieged.garrison = 4;
    setShipsAt(besieged, 'vigil', 6); // blockade
    const after = tickTurn(state).state;
    expect(after.systems.find((s) => s.id === 'ark-1')!.garrison).toBe(4);
  });

  it('resumes growing the moment the siege lifts', () => {
    const state = fresh();
    const besieged = sys(state, 'ark-1');
    besieged.garrison = 4;
    setShipsAt(besieged, 'vigil', 6);

    const stillBesieged = tickTurn(state).state;
    expect(sys(stillBesieged, 'ark-1').garrison).toBe(4);

    setShipsAt(sys(stillBesieged, 'ark-1'), 'vigil', 0);
    const relieved = tickTurn(stillBesieged).state;
    expect(sys(relieved, 'ark-1').garrison).toBe(4 + GARRISON_REGROWTH);
  });

  it('does not grow on the turn it is stormed', () => {
    // Regrowth runs after combat and skips anything that saw a landing, so a
    // world cannot reinforce itself on the way to being captured.
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 3;
      t.garrisonMax = 30;
      t.ships = {};
    }, 40, 2);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('freeworlds');
    // The garrison is the landing force that survived — two lifters, one lost
    // to a garrison of 3 — and nothing is tacked on for regrowth.
    expect(target.garrison).toBe(LIFTER_CARRY);
  });

  it('does not grow on the turn an assault is thrown back', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      t.garrison = 40;
      t.garrisonMax = 40;
      t.ships = {};
    }, 4, 2);
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('vigil');
    // Damaged by the landing, and NOT topped back up in the same turn.
    expect(target.garrison).toBeLessThan(40);
  });

  it('still grows on a quiet world elsewhere in the same turn', () => {
    const state = fresh();
    sys(state, 'ark-1').garrison = 4;
    sys(state, 'ark-3').garrison = 4;
    setShipsAt(sys(state, 'ark-1'), 'vigil', 5); // only ark-1 is besieged
    const after = tickTurn(state).state;
    expect(sys(after, 'ark-1').garrison).toBe(4);
    expect(sys(after, 'ark-3').garrison).toBe(4 + GARRISON_REGROWTH);
  });
});

describe('coalitions', () => {
  /**
   * Two powers landing on sek-6 in the same turn.
   *
   * Each contingent is a real invasion force — a screen, a line and a lift arm
   * — rather than a number of identical hulls. A quarter is lift, because a
   * coalition that brings no troops cannot take the world it is fighting over
   * and the spoils go to whoever puts the most ashore; a quarter is screen,
   * because the lift arm is soft and an unescorted convoy arrives dead.
   */
  function joint(setup: (s: WorldState) => void, forces: Record<string, number>) {
    const state = fresh();
    setup(state);
    const ops = Object.entries(forces).map(([factionId, force]) => {
      const lifter = Math.max(1, Math.round(force / 4));
      const escort = Math.max(1, Math.round(force / 4));
      const battleship = Math.max(0, force - lifter - escort);
      setShipsAt(sys(state, 'ark-3'), factionId, battleship);
      addShipsAt(sys(state, 'ark-3'), factionId, lifter, 'lifter');
      addShipsAt(sys(state, 'ark-3'), factionId, escort, 'escort');
      return {
        op: 'issue_order', factionId, type: 'fleet_movement',
        originId: 'ark-3', targetId: 'sek-6',
        force: { battleship, lifter, escort }, label: `${factionId} squadron`,
      };
    });
    const issued = applyOps(state, ops);
    expect(issued.rejections).toHaveLength(0);
    let r = tickTurn(issued.state);
    while (r.state.pendingOrders.length > 0) r = tickTurn(r.state);
    return r;
  }

  it('adds two attackers into one battle rather than two duels', () => {
    // Defended by the Nars rather than the Vigil: the Vigil is `crusading` and
    // never breaks off, so against it there is no 2:1 threshold to cross and
    // the test would be measuring the exchange formula instead of the addition.
    const defended = (s: WorldState) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'ojjul';
      setShipsAt(t, 'ojjul', 8);
      t.garrison = 2;
      t.garrisonMax = 2;
    };
    // **Swept rather than fought once.** One battle turns on one seeded roll,
    // so pinning a single force size measures that roll as much as it measures
    // the addition — and it broke the moment the combat seed changed while the
    // mechanic was untouched, which is the failure `combat.test.ts` already
    // learned about for dissent. Counting the cases where the pair take a world
    // neither could measures the thing itself.
    const holds = (s: WorldState) => s.systems.find((x) => x.id === 'sek-6')!.controllerFactionId;
    let addedUp = 0;
    for (const n of [20, 24, 28]) {
      const together = joint(defended, { freeworlds: n, drajk: n });
      const alone = joint(defended, { freeworlds: n });
      if (holds(together.state) !== 'ojjul' && holds(alone.state) === 'ojjul') addedUp += 1;
      // Never the other way round: two contingents must never do worse than one.
      expect(holds(alone.state) === 'ojjul' || holds(together.state) !== 'ojjul').toBe(true);
    }
    expect(addedUp, 'a coalition never took a world one contingent could not').toBeGreaterThan(0);
    expect(joint(defended, { freeworlds: 28, drajk: 28 }).notes.join(' ')).toMatch(/and/);
  });

  it('gives the captured world to whoever brought the most', () => {
    const res = joint(
      (s) => {
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        t.garrison = 2;
        t.garrisonMax = 2;
        setShipsAt(t, 'vigil', 0);
      },
      { freeworlds: 6, drajk: 24 },
    );
    const target = res.state.systems.find((x) => x.id === 'sek-6')!;
    expect(target.controllerFactionId).toBe('drajk');
    expect(res.notes.join(' ')).toMatch(/takes possession/);
    // The junior partner's survivors are still in orbit, contesting income.
    expect(hullsAt(target, 'freeworlds')).toBeGreaterThan(0);
  });

  it('breaks a tie deterministically rather than by luck', () => {
    const a = joint(
      (s) => {
        const t = sys(s, 'sek-6');
        t.controllerFactionId = null;
        t.ships = {};
        t.garrison = 0;
        t.garrisonMax = 0;
      },
      { freeworlds: 10, drajk: 10 },
    );
    const b = joint(
      (s) => {
        const t = sys(s, 'sek-6');
        t.controllerFactionId = null;
        t.ships = {};
        t.garrison = 0;
        t.garrisonMax = 0;
      },
      { freeworlds: 10, drajk: 10 },
    );
    const owner = a.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId;
    expect(owner).toBe(b.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId);
    expect(['freeworlds', 'drajk']).toContain(owner);
  });

  it('treats an uncommitted third party as a defender, the safe default', () => {
    const res = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 8);
      setShipsAt(t, 'ojjul', 40); // not attacking, so it defends
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 6);
    expect(res.notes.join(' ')).toMatch(/driven off/);
    expect(res.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBe('vigil');
  });

  it('counts arrivals for the holder as reinforcement, not invasion', () => {
    const state = fresh();
    setShipsAt(sys(state, 'ark-1'), 'freeworlds', 20);
    const before = shipsOf(state, 'ark-3', 'freeworlds');
    const issued = applyOps(state, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-1', targetId: 'ark-3', force: 9, label: 'relief',
      },
    ]);
    let r = tickTurn(issued.state);
    while (r.state.pendingOrders.length > 0) r = tickTurn(r.state);
    expect(r.notes.join(' ')).toMatch(/reinforces/);
    expect(shipsOf(r.state, 'ark-3', 'freeworlds')).toBe(before + 9);
  });
});

describe('dissent has teeth', () => {
  it('subtracts from every stat as it rises', () => {
    const state = fresh();
    const me = state.factions.find((f) => f.id === 'freeworlds')!;
    const base = effectiveStats(state, 'freeworlds');
    me.dissent = 50;
    const worse = effectiveStats(state, 'freeworlds');
    // Derived rather than restated, so retuning the curve does not need a test
    // edit to agree with it.
    const expected = dissentPenalty(50);
    expect(expected).toBeGreaterThan(0);
    for (const stat of STAT_NAMES) {
      expect(worse[stat], stat).toBe(Math.max(1, base[stat] - expected));
    }
  });

  it('cripples a power whose institutions have entirely given up on it', () => {
    // Stats run 1-20, so the ceiling has to be a large fraction of the scale
    // for "nobody follows you any more" to mean anything.
    const state = fresh();
    const me = state.factions.find((f) => f.id === 'freeworlds')!;
    const base = { ...me.stats };
    me.dissent = 100;
    expect(dissentPenalty(100)).toBe(MAX_DISSENT_PENALTY);
    const worst = effectiveStats(state, 'freeworlds');
    for (const stat of STAT_NAMES) {
      expect(worst[stat], stat).toBe(Math.max(1, base[stat] - MAX_DISSENT_PENALTY));
    }
  });

  it('does nothing below the first threshold', () => {
    const state = fresh();
    const under = Math.ceil(DISSENT_PER_PENALTY_POINT) - 1;
    state.factions.find((f) => f.id === 'freeworlds')!.dissent = under;
    expect(dissentPenalty(under)).toBe(0);
    expect(effectiveStats(state, 'freeworlds')).toEqual(fresh().factions.find((f) => f.id === 'freeworlds')!.stats);
  });

  it('decays a little every turn, so one refusal fades', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.dissent = 8;
    let after = tickTurn(state).state;
    expect(after.factions.find((f) => f.id === 'freeworlds')!.dissent).toBe(8 - DISSENT_DECAY);
    for (let i = 0; i < 5; i++) after = tickTurn(after).state;
    expect(after.factions.find((f) => f.id === 'freeworlds')!.dissent).toBe(0);
  });

  it('weakens a faction in an actual battle', () => {
    // A restive power fights worse, which is the whole point of the penalty.
    //
    // Asserted by SEARCHING for a garrison the penalty flips, rather than
    // hard-coding one. A fixed pair of numbers here only ever tested one
    // particular die roll, so it broke the moment the hash changed while the
    // mechanic itself was untouched — a test that fails for the wrong reason.
    const takenWith = (dissent: number, garrison: number, lift: number) =>
      attack((s) => {
        s.factions.find((f) => f.id === 'freeworlds')!.dissent = dissent;
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        t.garrison = garrison;
        t.garrisonMax = garrison;
        t.ships = {};
      }, 12, lift).state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId ===
      'freeworlds';

    // Searched over force AND garrison. Dissent is worth roughly 5% of assault
    // strength per modifier point, so at a single force it often fails to
    // cross an integer garrison — the effect is real but marginal in combat,
    // and its sharper bite is on d20 ability checks. Scanning one dimension
    // found no flip at all and looked like a broken mechanic.
    // Scanned along the diagonal where the assault roughly matches the
    // garrison, which is where a 5% swing can change the answer. A full grid
    // is a thousand battle simulations and times the suite out for no extra
    // signal.
    // Scanned over LIFT rather than over the whole fleet, because the ground
    // phase counts the troops the lift arm puts down and nothing else. The
    // battle line is held constant at a size that clears an empty orbit.
    const flipped: string[] = [];
    let everHelped = 0;
    for (let lift = 2; lift <= 8; lift++) {
      const troops = lift * LIFTER_CARRY;
      for (let garrison = troops - 5; garrison <= troops + 2; garrison++) {
        if (garrison < 1) continue;
        const calm = takenWith(0, garrison, lift);
        const restive = takenWith(100, garrison, lift);
        if (calm && !restive) flipped.push(`${lift}x${LIFTER_CARRY}v${garrison}`);
        if (restive && !calm) everHelped++;
      }
    }
    expect(flipped.length, 'dissent never decided an assault').toBeGreaterThan(0);
    // The direction matters more than the magnitude: being restive must never
    // win you a world your confident self could not take.
    expect(everHelped, 'dissent helped the attacker').toBe(0);
  });

  it('can be adjusted deliberately, in both directions', () => {
    const up = applyOps(fresh(), [
      { op: 'adjust_dissent', factionId: 'freeworlds', delta: 30 },
    ]).state;
    expect(up.factions.find((f) => f.id === 'freeworlds')!.dissent).toBe(30);
    const down = applyOps(up, [
      { op: 'adjust_dissent', factionId: 'freeworlds', delta: -100 },
    ]).state;
    expect(down.factions.find((f) => f.id === 'freeworlds')!.dissent).toBe(0);
  });
});

describe('combat is deterministic', () => {
  it('resolves identically on repeated runs, so replay holds', () => {
    const build = () =>
      attack((s) => {
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        setShipsAt(t, 'vigil', 9);
        t.garrison = 6;
        t.garrisonMax = 6;
      }, 14);
    expect(JSON.stringify(build().state)).toBe(JSON.stringify(build().state));
  });
});

describe('dissent is a mechanic, not a message', () => {
  it('actually persists when your own faction refuses you', async () => {
    // This is the regression that matters. `submitAction` computed the new
    // dissent total, put it in a note telling the player it had risen, and
    // never staged an op — so dissent never accumulated from a refusal and
    // the mechanic had been inert since it was written.
    const { Campaign } = await import('../src/engine/campaign.js');
    const { MemoryCampaignStore } = await import('../src/engine/store.js');
    const { REFUSAL_DISSENT } = await import('../src/domain/state.js');

    const campaign = Campaign.start('meridian', 'refusals', new MemoryCampaignStore());
    const dissentOf = () => campaign.state.factions.find((f) => f.id === 'meridian')!.dissent;
    expect(dissentOf()).toBe(0);

    // Exactly the ops a refusal stages.
    campaign.stage(
      [
        { op: 'log_narrative', text: '[refused by the Trade Council] no.' },
        { op: 'adjust_dissent', factionId: 'meridian', delta: REFUSAL_DISSENT, reason: 'red line' },
      ],
      'refused',
      '',
    );
    campaign.commitTurn();
    expect(dissentOf()).toBe(REFUSAL_DISSENT);
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('needs repeated defiance to cost a stat point, and forgives one lapse', async () => {
    const { REFUSAL_DISSENT, DISSENT_PER_PENALTY_POINT, dissentPenalty } = await import(
      '../src/domain/state.js'
    );
    // One refusal must not visibly weaken a power; a pattern of them must.
    expect(dissentPenalty(REFUSAL_DISSENT)).toBe(0);
    expect(dissentPenalty(REFUSAL_DISSENT * 4)).toBeGreaterThan(0);
    // And decay has to be slower than a run of refusals can accumulate.
    expect(REFUSAL_DISSENT).toBeGreaterThan(DISSENT_DECAY);
    expect(DISSENT_PER_PENALTY_POINT).toBeGreaterThan(REFUSAL_DISSENT);
  });

  it('shows the player the number the game actually rolls against', () => {
    // The panel renders effectiveStats, so this asserts the value it reads is
    // the one `resolveCheck` uses — not the undegraded base.
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.dissent = 50;
    const shown = effectiveStats(state, 'freeworlds');
    const base = fresh().factions.find((f) => f.id === 'freeworlds')!.stats;
    for (const stat of STAT_NAMES) {
      expect(shown[stat], stat).toBeLessThan(base[stat]);
    }
  });
});

describe('a declared action cannot resolve its own battle', () => {
  const total = (s: WorldState, f: string) => fleetStrengthOf(s, f);

  it('caps how much of its own fleet one declaration can destroy', () => {
    // Five playtest reproductions: a bad `might` roll on an attack had the
    // resolution call narrate the battle as already lost and emit ops
    // deleting 88-100% of the acting fleet, with no fleet_movement anywhere
    // and the defender untouched. Real losses come from resolveBattle during
    // the tick, which never routes through applyOps and is unaffected here.
    const state = fresh();
    const before = total(state, 'freeworlds');
    const res = applyOps(
      state,
      [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: -before, reason: 'the raid went badly' }],
      'model',
      'freeworlds',
    );
    const after = total(res.state, 'freeworlds');
    expect(after).toBeGreaterThan(0);
    expect(before - after).toBeLessThanOrEqual(Math.max(1, Math.floor(before * 0.25)));
    expect(res.notes.join(' ')).toMatch(/cannot lose \d+ tons of shipping to a single declaration/);
  });

  it('leaves a modest narrative loss alone', () => {
    // Scuttling, accidents and disasters are legitimate; only wholesale
    // deletion is the bug.
    const state = fresh();
    const before = total(state, 'freeworlds');
    const res = applyOps(
      state,
      [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: -2, reason: 'a hangar fire' }],
      'model',
      'freeworlds',
    );
    expect(total(res.state, 'freeworlds')).toBe(before - 2);
    expect(res.notes.join(' ')).not.toMatch(/cannot lose/);
  });

  it('refuses to destroy another faction’s fleet outright', () => {
    // `adjust_ships` has been guarded since the suborn work; `adjust_fleet`
    // was not, and being untargeted it is worse — it draws from the victim's
    // largest concentrations anywhere in the galaxy.
    const state = fresh();
    const before = total(state, 'vigil');
    const res = applyOps(
      state,
      [{ op: 'adjust_fleet', factionId: 'vigil', delta: -30, reason: 'we crushed them' }],
      'model',
      'freeworlds',
    );
    expect(res.rejections.map((r) => r.code)).toContain('reducer_only');
    expect(total(res.state, 'vigil')).toBe(before);
  });

  it('still lets a faction build ships for itself', () => {
    const state = fresh();
    const before = total(state, 'freeworlds');
    const res = applyOps(
      state,
      [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: 3 }],
      'model',
      'freeworlds',
    );
    expect(res.rejections).toHaveLength(0);
    expect(total(res.state, 'freeworlds')).toBe(before + 3);
  });

  it('does not touch engine ops or journals written before actors existed', () => {
    // Replay must reproduce what happened, not retroactively re-judge it.
    const state = fresh();
    const before = total(state, 'freeworlds');
    const res = applyOps(
      state,
      [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: -(before - 1) }],
      'model',
    );
    expect(res.rejections).toHaveLength(0);
    expect(total(res.state, 'freeworlds')).toBe(1);
  });
});
