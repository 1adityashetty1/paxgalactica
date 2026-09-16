import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, GARRISON_REGROWTH, DISSENT_DECAY } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { STAT_NAMES } from '../src/domain/checks.js';
import { HULL_CLASSES, HULL_SPEC, LIFTER_CARRY, hullsIn, strikeStack } from '../src/domain/hulls.js';
import {
  addShipsAt,
  hullsAt,
  setShipsAt,
  setStackAt,
  stackAt,
  dissentPenalty,
  DISSENT_PER_PENALTY_POINT,
  effectiveStats,
  ledgerFor,
  subornLimit,
  fleetStrengthOf,
  MAX_DISSENT_PENALTY,
  shipsInTransit,
  type WorldState,
} from '../src/domain/state.js';
import {
  COMMANDER_ARCHETYPES,
  COMMANDER_MIGHT,
  COMMANDER_STRIKE_BONUS,
  COMMANDER_WITHDRAW_RELIEF,
  MAX_VETERANCY,
  VETERAN_THRESHOLDS,
  archetypeOf,
  commanderEffect,
  commanderFor,
  commanderIndustry,
  commanderResolve,
  commanderPassive,
  commanderUpkeepRelief,
  toNextVeterancy,
  veterancyLabel,
  veterancyOf,
  type CommanderArchetype,
} from '../src/domain/command.js';

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
  // Set the origin's squadron EXPLICITLY by class. A bare number trims a mixed
  // stack to that many hulls while keeping its shape — so once the seed opened
  // each power with a real composition, `setShipsAt(..., 6)` left three
  // battleships and three of everything else, and an order for six battleships
  // could only draw the three that existed.
  setShipsAt(sys(state, 'ark-3'), 'freeworlds', 0);
  addShipsAt(sys(state, 'ark-3'), 'freeworlds', force, 'battleship');
  if (lift > 0) addShipsAt(sys(state, 'ark-3'), 'freeworlds', lift, 'lifter');
  setup(state);
  // The officer sails WITH the fleet, which is the only way she reaches the
  // battle now that she has a location — before, a power's commander fought
  // every engagement it had, simultaneously, wherever they were. `setup` runs
  // first so a test that names a different archetype still gets the right
  // person aboard.
  const aboard = state.commanders.find(
    (c) => c.factionId === 'freeworlds' && c.status === 'active',
  );
  if (aboard) aboard.atSystemId = 'ark-3';
  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-3', targetId: 'sek-6',
      force: { battleship: force, lifter: lift },
      commanderId: aboard?.id ?? null,
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
      // Deep enough that the property survives a point either way. At 8 this
      // was decided by a single modifier, and a commander with +1 might flipped
      // it — the test was pinning an outcome while claiming to pin a rule.
      t.garrison = 16;
      t.garrisonMax = 16;
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
    // No officer: `effectiveStats` composes terrain, the commander's passive
    // and dissent, and a test asserting all three at once fails without saying
    // which one moved. The passive is pinned in the commander suite.
    state.commanders = [];
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
    state.commanders = [];
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

/**
 * A FLEET IN ORBIT TAKES THE GROUND BY MOVING TO WHERE IT IS.
 *
 * A playtester cleared an orbit, could not see how to land, and shuttled 34
 * battleships to a neighbour and back — two turns for one assault. The
 * capability was there all along: `originId === targetId` is a legal
 * `fleet_movement`, costs one turn, and fights a real battle. Nothing said so,
 * so the model reached for the round trip.
 *
 * `prompts/resolution.md` now says it explicitly, which is what makes this a
 * behaviour worth pinning: a prompt instructing an order that stopped working
 * would be worse than the silence it replaced.
 */
describe('an assault from the orbit you already hold', () => {
  it('is one turn, and it storms the world', () => {
    const s = createSeedState('meridian');
    const target = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    target.garrison = 4;
    setStackAt(target, 'drajk', {});
    setStackAt(target, 'meridian', { battleship: 10, lifter: 6 });

    const res = applyOps(
      s,
      [
        {
          op: 'issue_order',
          factionId: 'meridian',
          type: 'fleet_movement',
          originId: target.id,
          targetId: target.id,
          label: 'take the ground',
          force: { battleship: 10, lifter: 6 },
        },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections).toEqual([]);

    // One turn: the path is the system itself, not a hop out and back.
    const order = res.state.pendingOrders.at(-1)!;
    expect(order.durationTurns).toBe(1);
    expect(order.path).toEqual([target.id]);

    const after = tickTurn(res.state).state;
    const taken = after.systems.find((x) => x.id === target.id)!;
    expect(taken.controllerFactionId).toBe('meridian');
    // The garrison is the troops that landed, and the lift that carried them
    // was spent doing it — conquest costs the lift arm either way.
    expect(taken.garrison).toBeGreaterThan(0);
    expect(stackAt(taken, 'meridian').lifter!).toBeLessThan(6);
  });
});

/**
 * WHAT ACTUALLY DIES, AND IN WHAT ORDER.
 *
 * `HULL_SPEC.lossOrder` reads escort -> lifter -> torpedo boat -> battleship,
 * and for the life of the strike phase no battle has used it: every combat loss
 * is spent through `strikeStack`, whose `strikeOrder` moves boats to the very
 * end. A playtest measured a defending `{battleship: 6, torpedo_boat: 6}` losing
 * twenty tons as five battleships and no boats, where the table predicts six
 * boats and two battleships.
 *
 * Boats-last is the deliberate half — a boat has fired by the strike phase, and
 * leaving it higher makes it a shield for the escorts and transports that still
 * have work. The table was the stale half. This pins the real order so the two
 * cannot drift apart again without a test saying so.
 */
describe('the order hulls are spent in a battle', () => {
  it('spends escorts first and torpedo boats last', () => {
    const order = HULL_CLASSES.map((h) => ({ h, n: HULL_SPEC[h].lossOrder })).sort(
      (a, b) => a.n - b.n,
    );
    // Documented order, still true of a NON-combat removal. The two hulls that
    // do not fight sit where their softness puts them: a freighter is the
    // biggest unarmoured target in any fleet and goes before the lift arm, and
    // a listener is small enough to be picked out late.
    expect(order.map((x) => x.h)).toEqual([
      'escort',
      'freighter',
      'lifter',
      'listener',
      'torpedo_boat',
      'battleship',
    ]);

    // Combat order, which is what a battle actually uses.
    const stack = { escort: 4, lifter: 4, torpedo_boat: 4, battleship: 4 };
    const spentFirst = strikeStack(stack, HULL_SPEC.escort.tonnage * 4).taken;
    expect(spentFirst).toEqual({ escort: 4 });

    // Everything except the boats goes before a single boat does.
    const upToBoats = strikeStack(stack, 2 * 4 + 3 * 4 + 4 * 4).taken;
    expect(upToBoats.torpedo_boat ?? 0).toBe(0);
    expect(upToBoats).toEqual({ escort: 4, lifter: 4, battleship: 4 });

    // And a fleet carrying auxiliaries spends them before its battle line: a
    // freighter ahead of the transports, a listener behind them, both ahead of
    // anything that can shoot back.
    const mixed = { escort: 2, freighter: 2, lifter: 2, listener: 2, battleship: 4 };
    const soft = strikeStack(mixed, 2 * 2 + 3 * 2 + 3 * 2 + 3 * 2).taken;
    expect(soft).toEqual({ escort: 2, freighter: 2, lifter: 2, listener: 2 });
    expect(soft.battleship ?? 0).toBe(0);

    // And the screen still stands in front of the lift arm, which is the whole
    // of the argument the table was carrying.
    expect(HULL_SPEC.escort.lossOrder).toBeLessThan(HULL_SPEC.lifter.lossOrder);
  });
});

/**
 * Commanders: a named officer on one side of one battle.
 *
 * The mechanic exists because a battle between two rival powers reads as
 * arithmetic, and a name on it is the cheapest thing that makes it a story.
 * What these pin is that the name is the ONLY generated part.
 */
describe('the officer on the field', () => {
  const setArchetype = (s: WorldState, factionId: string, kind: CommanderArchetype) => {
    s.commanders.find((c) => c.factionId === factionId)!.archetype = kind;
  };

  it('gives every power one from the opening board', () => {
    const s = fresh();
    for (const f of s.factions) {
      expect(commanderFor(s.commanders, f.id), f.id).toBeDefined();
    }
  });

  it('generates the name and never the effect', () => {
    // The whole design. A hundred campaigns produce a hundred different
    // officers and not one new rule.
    const s = fresh();
    for (const c of s.commanders) {
      expect(COMMANDER_ARCHETYPES.map((a) => a.kind)).toContain(c.archetype);
      expect(c.name.length).toBeGreaterThan(3);
    }
  });

  it('names the same officers on a replay, because the seed is a hash', () => {
    const a = createSeedState('drajk').commanders.map((c) => `${c.name}/${c.archetype}`);
    const b = createSeedState('drajk').commanders.map((c) => `${c.name}/${c.archetype}`);
    expect(a).toEqual(b);
    // And a different power gets different people.
    expect(new Set(a).size).toBe(a.length);
  });

  it('reports only what actually changed something', () => {
    // Same convention as `doctrinesFired`: an officer whose speciality never
    // came up does not appear.
    const out = attack((s) => {
      setArchetype(s, 'freeworlds', 'convoy');
      const t = sys(s, 'sek-6');
      t.controllerFactionId = null;
      t.ships = {};
      t.garrison = 1;
      t.garrisonMax = 1;
    }, 20, 4);
    const fired = out.report?.battles?.[0]?.commandersFired ?? [];
    // Nobody withdrew, so the convoy officer did nothing worth telling anyone.
    expect(fired.join(' ')).not.toMatch(/withdrawal/);
  });

  it('fights a point harder, and says so', () => {
    const out = attack((s) => {
      setArchetype(s, 'freeworlds', 'lineofbattle');
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setStackAt(t, 'vigil', { battleship: 6 });
    }, 10, 2);
    const report = out.report?.battles?.[0];
    expect(report?.commandersFired.join(' ')).toMatch(/might in the exchange/);
  });

  it('brings more of a beaten fleet home', () => {
    // The only thing in the game that touches the retreat loss. A screen
    // changes WHICH hulls are spent getting clear, not how many.
    const survivors = (kind: CommanderArchetype) => {
      const out = attack((s) => {
        setArchetype(s, 'freeworlds', kind);
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        setStackAt(t, 'vigil', { battleship: 400 });
      }, 40, 0);
      return out.state.systems.reduce((n, x) => n + hullsAt(x, 'freeworlds'), 0);
    };
    expect(survivors('convoy')).toBeGreaterThan(survivors('lineofbattle'));
  });

  it('is worth nothing to a fleet with no boats, and something to one with them', () => {
    // `gunnery` multiplies the salvo rather than adding to it, so it cannot
    // conjure one out of a fleet that brought no torpedo boats.
    const out = attack((s) => {
      setArchetype(s, 'freeworlds', 'gunnery');
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setStackAt(t, 'vigil', { battleship: 6 });
    }, 10, 2);
    expect(out.report?.battles?.[0]?.commandersFired.join(' ') ?? '').not.toMatch(/salvo/);
  });

  it('counts the engagement, so seniority is earned', () => {
    const out = attack((s) => {
      const t = sys(s, 'sek-6');
      t.controllerFactionId = 'vigil';
      setStackAt(t, 'vigil', { battleship: 4 });
    }, 12, 3);
    expect(commanderFor(out.state.commanders, 'freeworlds')!.battles).toBeGreaterThan(0);
  });

  it('replaces one that is lost, with a different person', () => {
    const s = fresh();
    const was = commanderFor(s.commanders, 'drajk')!;
    was.status = 'lost';
    const after = tickTurn(s).state;
    const now = commanderFor(after.commanders, 'drajk')!;
    expect(now.id).not.toBe(was.id);
    expect(now.battles).toBe(0);
    // The dead stay on the roster — a power's history of commanders is worth
    // more than the bytes of removing them.
    expect(after.commanders.some((c) => c.id === was.id && c.status === 'lost')).toBe(true);
  });

  it('is inert in a campaign saved before commanders existed', () => {
    const s = fresh();
    s.commanders = [];
    const out = attack(() => {}, 8, 0);
    expect(out.state).toBeDefined();
    expect(commanderFor([], 'drajk')).toBeUndefined();
  });

  /**
   * Veterancy: the reason a death costs anything.
   *
   * Before it, losing an officer was free and, two times in three, an UPGRADE —
   * the replacement arrived on the next tick with a freshly rolled archetype,
   * so a power whose fleet had no use for the officer it was dealt profited
   * from her defeat. What these pin is that the record is worth something, and
   * that a successor inherits the speciality and none of it.
   */
  describe('and what her record is worth', () => {
    const veteran = (s: WorldState, factionId: string, battles: number) => {
      const c = s.commanders.find((x) => x.factionId === factionId)!;
      c.battles = battles;
      return c;
    };

    it('puts an officer on a step her engagements actually reach', () => {
      // Swept against the harness rather than guessed: `pnpm balance 30` fights
      // four battles in the whole galaxy, so a ladder denominated in tens would
      // never leave step 0 and the harness would report that as a clean pass.
      expect(veterancyOf(0)).toBe(0);
      expect(veterancyOf(VETERAN_THRESHOLDS[0] - 1)).toBe(0);
      expect(veterancyOf(VETERAN_THRESHOLDS[0])).toBe(1);
      expect(veterancyOf(VETERAN_THRESHOLDS[1])).toBe(MAX_VETERANCY);
      // It is a CAP, not a rate: nothing past the last threshold buys anything.
      expect(veterancyOf(VETERAN_THRESHOLDS[1] * 10)).toBe(MAX_VETERANCY);
    });

    it('keeps every ladder the same length as the ladder itself', () => {
      // The same pinning `STACK_KEYS` does against `HULL_CLASSES`. Adding a
      // threshold without extending all three ladders would put `undefined`
      // behind a non-null assertion, which reads as a missing bonus and throws
      // nothing — so the drift has to fail here rather than in a battle.
      for (const ladder of [COMMANDER_MIGHT, COMMANDER_WITHDRAW_RELIEF, COMMANDER_STRIKE_BONUS]) {
        expect(ladder).toHaveLength(MAX_VETERANCY + 1);
      }
    });

    it('has a name for every step, so a report can never say undefined', () => {
      for (let b = 0; b <= VETERAN_THRESHOLDS[1] + 1; b++) {
        expect(veterancyLabel(b), `${b}`).toMatch(/^[a-z]+$/);
      }
    });

    it('fights harder for having fought before', () => {
      const might = (battles: number) => {
        const out = attack((s) => {
          setArchetype(s, 'freeworlds', 'lineofbattle');
          veteran(s, 'freeworlds', battles);
          const t = sys(s, 'sek-6');
          t.controllerFactionId = 'vigil';
          setStackAt(t, 'vigil', { battleship: 6 });
        }, 10, 2);
        return out.report?.battles?.[0]?.attackMod ?? 0;
      };
      // The same officer, the same fleet, the same roll — and a record behind
      // her. This is the whole mechanic: it is the only thing on the field a
      // power builds by winning rather than by being.
      expect(might(VETERAN_THRESHOLDS[0])).toBeGreaterThan(might(0));
      expect(might(VETERAN_THRESHOLDS[1])).toBeGreaterThan(might(VETERAN_THRESHOLDS[0]));
    });

    it('says which standing it was fought at', () => {
      const out = attack((s) => {
        setArchetype(s, 'freeworlds', 'lineofbattle');
        veteran(s, 'freeworlds', VETERAN_THRESHOLDS[1]);
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        setStackAt(t, 'vigil', { battleship: 6 });
      }, 10, 2);
      expect(out.report?.battles?.[0]?.commandersFired.join(' ')).toMatch(/veteran/);
    });

    it('never lets even the best officer retreat for free', () => {
      // The relief is floored at 5% in `bleed`, and the top of the ladder would
      // otherwise clear the bottom of the 10-35% band outright.
      const home = (battles: number) => {
        const out = attack((s) => {
          setArchetype(s, 'freeworlds', 'convoy');
          veteran(s, 'freeworlds', battles);
          const t = sys(s, 'sek-6');
          t.controllerFactionId = 'vigil';
          setStackAt(t, 'vigil', { battleship: 400 });
        }, 40, 0);
        return out.state.systems.reduce((n, x) => n + hullsAt(x, 'freeworlds'), 0);
      };
      // The control is the fleet as it stood when the order went out — `attack`
      // reinforces ark-3, so the seed's own total is not it.
      const before = (() => {
        const s = fresh();
        setShipsAt(sys(s, 'ark-3'), 'freeworlds', 0);
        addShipsAt(sys(s, 'ark-3'), 'freeworlds', 40, 'battleship');
        return s.systems.reduce((n, x) => n + hullsAt(x, 'freeworlds'), 0);
      })();
      expect(home(VETERAN_THRESHOLDS[1])).toBeGreaterThan(home(0));
      expect(home(VETERAN_THRESHOLDS[1])).toBeLessThan(before);
    });

    it('quotes the number this officer is actually worth', () => {
      // `COMMANDER_ARCHETYPES[].effect` describes the SHAPE and quotes no
      // number, because the number moves. A panel that says what a kind of
      // officer does is a different thing from one that says what this one does.
      const s = fresh();
      setArchetype(s, 'drajk', 'lineofbattle');
      const c = veteran(s, 'drajk', VETERAN_THRESHOLDS[1]);
      expect(commanderEffect(c)).toContain(String(COMMANDER_MIGHT[MAX_VETERANCY]));
      expect(archetypeOf('lineofbattle').effect).not.toMatch(/\d/);
    });

    it('promotes a successor of the same school', () => {
      // The speciality is the institution and survives; the record is the
      // person and does not. Re-rolling it made a defeat a free lottery ticket.
      const s = fresh();
      const was = commanderFor(s.commanders, 'drajk')!;
      was.archetype = 'gunnery';
      was.battles = VETERAN_THRESHOLDS[1];
      was.status = 'lost';
      const now = commanderFor(tickTurn(s).state.commanders, 'drajk')!;
      expect(now.archetype).toBe('gunnery');
      expect(now.battles).toBe(0);
      expect(veterancyOf(now.battles)).toBe(0);
    });

    it('rolls a speciality only when there is no predecessor at all', () => {
      // A save written before commanders existed, or a faction added later.
      const s = fresh();
      s.commanders = [];
      const after = tickTurn(s).state;
      for (const f of after.factions) {
        expect(commanderFor(after.commanders, f.id), f.id).toBeDefined();
      }
    });

    it('counts the record she brought to the battle, not the one she leaves with', () => {
      const out = attack((s) => {
        setArchetype(s, 'freeworlds', 'lineofbattle');
        veteran(s, 'freeworlds', VETERAN_THRESHOLDS[0] - 1);
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        setStackAt(t, 'vigil', { battleship: 6 });
      }, 10, 2);
      // She crosses the threshold BY fighting this one, and fights it untested.
      expect(out.report?.battles?.[0]?.commandersFired.join(' ')).toMatch(/untested/);
      expect(veterancyOf(commanderFor(out.state.commanders, 'freeworlds')!.battles)).toBe(1);
    });

    /**
     * Passives: what an officer is worth on a turn with no battle.
     *
     * The sizes run OPPOSITE to how conditional each battle effect is, which is
     * the whole design — `convoy` is worth nothing in a fight until the day you
     * run, so it needs the largest counterweight or nobody would ever take it.
     */
    describe('and what she is worth on a quiet turn', () => {
      it('runs the fleet cheaper, and more cheaply the longer she has served', () => {
        const upkeep = (kind: CommanderArchetype, battles: number) => {
          const s = fresh();
          setArchetype(s, 'freeworlds', kind);
          veteran(s, 'freeworlds', battles);
          return ledgerFor(s, 'freeworlds').upkeep;
        };
        expect(upkeep('convoy', 0)).toBeLessThan(upkeep('lineofbattle', 0));
        expect(upkeep('convoy', VETERAN_THRESHOLDS[1])).toBeLessThan(upkeep('convoy', 0));
      });

      it('is read where it is used, so it recurs instead of compounding', () => {
        // The rule `commitmentFlow`, `assetYield` and the agent effects all
        // follow. A passive applied on the tick would take the same relief off
        // an already-relieved figure every turn.
        const s = fresh();
        setArchetype(s, 'freeworlds', 'convoy');
        veteran(s, 'freeworlds', VETERAN_THRESHOLDS[1]);
        const once = ledgerFor(s, 'freeworlds').upkeep;
        expect(ledgerFor(s, 'freeworlds').upkeep).toBe(once);
        expect(tickTurn(s).state.factions).toBeDefined();
        expect(ledgerFor(s, 'freeworlds').upkeep).toBe(once);
      });

      it('builds better under a gunner, and fights no better for it', () => {
        const s = fresh();
        const base = effectiveStats(s, 'freeworlds');
        setArchetype(s, 'freeworlds', 'gunnery');
        veteran(s, 'freeworlds', VETERAN_THRESHOLDS[1]);
        const withHer = effectiveStats(s, 'freeworlds');
        expect(withHer.industry).toBeGreaterThan(base.industry);
        // Industry and never might: `bestMod` reads `effectiveStats().might`,
        // so a might passive would pay her twice for the same battle.
        expect(withHer.might).toBe(base.might);
      });

      it('cannot push a stat off the top of the curve', () => {
        const s = fresh();
        setArchetype(s, 'freeworlds', 'gunnery');
        veteran(s, 'freeworlds', VETERAN_THRESHOLDS[1]);
        s.factions.find((f) => f.id === 'freeworlds')!.stats.industry = 20;
        expect(effectiveStats(s, 'freeworlds').industry).toBe(20);
      });

      it('keeps crews from being turned under a line officer', () => {
        // `subornLimit` is the suborner's guile modifier against the target's
        // resolve, so an officer known for holding formation under fire makes
        // a power's ships harder to buy. Meridian's resolve of 9 is the seed's
        // stated vulnerability, and this is what patches it.
        const s = fresh();
        setArchetype(s, 'meridian', 'lineofbattle');
        const before = subornLimit(s, 'ojjul', 'meridian');
        veteran(s, 'meridian', VETERAN_THRESHOLDS[1]);
        expect(subornLimit(s, 'ojjul', 'meridian')).toBeLessThan(before);
      });

      it('is worth something to every power that has one, conquest or not', () => {
        // The first version of this was occupation relief, and it measured at
        // zero credits for every power holding a line officer over thirty
        // harness turns — three of the four occupy no foreign ground at all. A
        // passive conditional on conquest is not a passive.
        const s = fresh();
        for (const sys of s.systems) sys.homeFactionId = sys.controllerFactionId;
        setArchetype(s, 'freeworlds', 'lineofbattle');
        const base = effectiveStats({ ...s, commanders: [] }, 'freeworlds');
        expect(effectiveStats(s, 'freeworlds').resolve).toBeGreaterThan(base.resolve);
      });

      it('gives each school exactly one of the three', () => {
        // A passive that fired for the wrong archetype would make the choice
        // between officers no choice at all.
        const s = fresh();
        for (const kind of COMMANDER_ARCHETYPES.map((a) => a.kind)) {
          setArchetype(s, 'drajk', kind);
          const c = commanderFor(s.commanders, 'drajk')!;
          const live = [
            commanderResolve(c),
            commanderIndustry(c),
            commanderUpkeepRelief(c),
          ].filter((n) => n > 0);
          expect(live, kind).toHaveLength(1);
          expect(commanderPassive(c)).toMatch(/\d/);
        }
      });
    });

    /**
     * An officer is IN a fleet without being tonnage: she rides the order, has
     * a location, and the only thing that can kill her is the death roll. What
     * these pin is the edges of naming her to one.
     */
    describe('and where she actually is', () => {
      const sail = (
        s: WorldState,
        commanderId: string | null,
        originId = 'ark-3',
        force: Record<string, number> | undefined = { battleship: 5 },
      ) =>
        applyOps(
          s,
          [
            {
              op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
              originId, targetId: 'sek-6', force, commanderId,
            },
          ],
          'model',
          'freeworlds',
        );

      const ours = (s: WorldState) =>
        s.commanders.find((c) => c.factionId === 'freeworlds' && c.status === 'active')!;

      it('takes her off the board while she is under way', () => {
        // In transit she belongs to the ORDER, exactly as her ships do: a fleet
        // under way is in `order.force` and not in `system.ships`.
        const s = fresh();
        const c = ours(s);
        c.atSystemId = 'ark-3';
        const out = sail(s, c.id);
        expect(out.rejections).toHaveLength(0);
        expect(out.state.pendingOrders[0]!.commanderId).toBe(c.id);
        expect(ours(out.state).atSystemId).toBeNull();
      });

      it('cannot be aboard two fleets at once', () => {
        // Closed by the location model rather than by a guard: the first order
        // takes her off the board, so the second cannot find her at the origin.
        const s = fresh();
        const c = ours(s);
        c.atSystemId = 'ark-3';
        addShipsAt(sys(s, 'ark-3'), 'freeworlds', 20, 'battleship');
        const out = applyOps(
          s,
          [
            { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
              originId: 'ark-3', targetId: 'sek-6', force: { battleship: 5 }, commanderId: c.id },
            { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
              originId: 'ark-3', targetId: 'ark-4', force: { battleship: 5 }, commanderId: c.id },
          ],
          'model',
          'freeworlds',
        );
        const carrying = out.state.pendingOrders.filter((o) => o.commanderId === c.id);
        expect(carrying).toHaveLength(1);
        expect(out.notes.join(' ')).toMatch(/without a named officer/);
      });

      it('cannot sail with no ships at all', () => {
        // A bodiless voyage is unrepresentable: an explicit empty force is an
        // `illegal_value`, and omitting it draws a real squadron from the
        // origin. There is no third way to put an officer alone in space.
        const s = fresh();
        const c = ours(s);
        c.atSystemId = 'ark-3';
        const empty = sail(s, c.id, 'ark-3', { battleship: 0 });
        expect(empty.rejections.map((r) => r.code)).toContain('illegal_value');
        expect(ours(empty.state).atSystemId).toBe('ark-3');

        const drawn = sail(fresh(), null, 'ark-3', undefined);
        expect(hullsIn(drawn.state.pendingOrders[0]!.force)).toBeGreaterThan(0);
      });

      it('refuses a name that is not hers to give', () => {
        for (const [why, mutate] of [
          ['another power', (s: WorldState) => {
            const theirs = s.commanders.find((c) => c.factionId === 'drajk')!;
            theirs.atSystemId = 'ark-3';
            return theirs.id;
          }],
          ['somebody who is lost', (s: WorldState) => {
            const c = ours(s);
            c.atSystemId = 'ark-3';
            c.status = 'lost';
            return c.id;
          }],
          ['somebody who is elsewhere', (s: WorldState) => {
            const c = ours(s);
            c.atSystemId = 'ark-4';
            return c.id;
          }],
          ['nobody at all', () => 'cmd-invented'],
        ] as const) {
          const s = fresh();
          const id = mutate(s);
          const out = sail(s, id);
          expect(out.state.pendingOrders[0]!.commanderId, why).toBeNull();
          expect(out.notes.join(' '), why).toMatch(/without a named officer/);
        }
      });

      it('commands the battle she is at, and no other', () => {
        // Before she had a location a power's officer fought every engagement
        // it had, simultaneously, wherever they were.
        const s = fresh();
        ours(s).atSystemId = 'ark-4';
        setArchetype(s, 'freeworlds', 'lineofbattle');
        const t = sys(s, 'sek-6');
        t.controllerFactionId = 'vigil';
        setStackAt(t, 'vigil', { battleship: 6 });
        const out = sail(s, null);
        let res = tickTurn(out.state);
        while (res.state.pendingOrders.some((o) => o.id === 'ord-0-0')) res = tickTurn(res.state);
        const fired = res.report.battles[0]?.commandersFired.join(' ') ?? '';
        expect(fired).not.toMatch(/might in the exchange/);
        // And she never left home.
        expect(ours(res.state).atSystemId).toBe('ark-4');
      });

      it('comes home with a fleet that is recalled', () => {
        const s = fresh();
        const c = ours(s);
        c.atSystemId = 'ark-3';
        const out = sail(s, c.id);
        expect(ours(out.state).atSystemId).toBeNull();
        const back = applyOps(
          out.state,
          [{ op: 'cancel_order', orderId: out.state.pendingOrders[0]!.id }],
          'model',
          'freeworlds',
        );
        // The ships were never destroyed and neither was she — an officer left
        // in transit on an order that no longer exists is an officer nowhere.
        expect(ours(back.state).atSystemId).toBe('ark-3');
      });

      it('stands where the fighting left her', () => {
        const s = fresh();
        const c = ours(s);
        c.atSystemId = 'ark-3';
        const t = sys(s, 'sek-6');
        t.controllerFactionId = null;
        t.ships = {};
        t.garrison = 0;
        const out = sail(s, c.id);
        let res = tickTurn(out.state);
        while (res.state.pendingOrders.some((o) => o.id === 'ord-0-0')) res = tickTurn(res.state);
        expect(ours(res.state).atSystemId).toBe('sek-6');
      });
    });

    it('tells a power what it would be losing', () => {
      // A cost a player cannot read coming is a cost they cannot weigh.
      expect(toNextVeterancy(0)).toBe(VETERAN_THRESHOLDS[0]);
      expect(toNextVeterancy(VETERAN_THRESHOLDS[1])).toBeNull();
    });
  });
});
