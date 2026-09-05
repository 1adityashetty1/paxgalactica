import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { addShipsAt, setShipsAt } from '../src/domain/state.js';
import {
  CREDITS_PER_TON,
  HULL_CLASSES,
  HULL_SPEC,
  STACK_KEYS,
  ShipStackSchema,
  UPKEEP_PER_TON,
  carryOf,
  hullCost,
  hullUpkeep,
  hullsIn,
  inLossOrder,
  orbitalWeightOf,
  tonsIn,
} from '../src/domain/hulls.js';

/**
 * Tonnage is the single primitive: cost and upkeep derive from it, and every
 * rule that limits a fleet by size is denominated in it.
 */
describe('tonnage prices everything', () => {
  it('reproduces the old flat ship cost and upkeep for a battleship', () => {
    // The migration is behaviour-neutral only if this holds.
    expect(hullCost('battleship')).toBe(60);
    expect(hullUpkeep('battleship')).toBe(4);
  });

  it('charges every class the same per ton, so presence cannot be arbitraged', () => {
    for (const hull of HULL_CLASSES) {
      expect(hullCost(hull) / HULL_SPEC[hull].tonnage, hull).toBe(CREDITS_PER_TON);
      expect(hullUpkeep(hull) / HULL_SPEC[hull].tonnage, hull).toBe(UPKEEP_PER_TON);
    }
  });
});

/**
 * The escort-spam bug: escorts once had a battleship's weight at half the
 * tonnage, making them twice as efficient on every axis.
 */
describe('a battleship is the better fighter on every axis', () => {
  const perTon = (h: 'battleship' | 'escort' | 'torpedo_boat') =>
    HULL_SPEC[h].orbitalWeight / HULL_SPEC[h].tonnage;
  const perCredit = (h: 'battleship' | 'escort' | 'torpedo_boat') =>
    HULL_SPEC[h].orbitalWeight / hullCost(h);

  it('beats an escort per ton and per credit', () => {
    expect(perTon('battleship')).toBeGreaterThan(perTon('escort'));
    expect(perCredit('battleship')).toBeGreaterThan(perCredit('escort'));
  });

  it('beats a torpedo boat in a straight exchange too', () => {
    expect(perTon('battleship')).toBeGreaterThan(perTon('torpedo_boat'));
  });

  it('leaves the lift arm worth nothing in orbit', () => {
    expect(HULL_SPEC.lifter.orbitalWeight).toBe(0);
    expect(HULL_SPEC.lifter.carry).toBeGreaterThan(0);
  });

  it('gives ground troops to the lift arm and nobody else', () => {
    for (const hull of HULL_CLASSES) {
      if (hull === 'lifter') continue;
      expect(HULL_SPEC[hull].carry, hull).toBe(0);
    }
  });
});

describe('a stack', () => {
  const mixed = { battleship: 3, escort: 2, lifter: 1 };

  it('counts hulls for a player and tons for the rules', () => {
    expect(hullsIn(mixed)).toBe(6);
    expect(tonsIn(mixed)).toBe(3 * 4 + 2 * 2 + 1 * 3);
  });

  it('weighs only what can fight', () => {
    expect(orbitalWeightOf(mixed)).toBe(3 * 3 + 2 * 1);
    expect(carryOf(mixed)).toBe(6);
  });

  it('spends the screen first, then the lift arm, and the battle line last', () => {
    // The lift arm is SOFT: unarmed and unarmoured, so it dies before the
    // battleships do, and the only thing keeping it alive is a screen standing
    // in front of it. Ordering it last made transports the safest thing in a
    // fleet and left escorts with nothing to protect.
    expect(inLossOrder(mixed)).toEqual(['escort', 'lifter', 'battleship']);
    expect(
      inLossOrder({ escort: 1, lifter: 1, torpedo_boat: 1, battleship: 1 }),
    ).toEqual(['escort', 'lifter', 'torpedo_boat', 'battleship']);
  });

  it('is empty-safe', () => {
    for (const f of [hullsIn, tonsIn, orbitalWeightOf, carryOf]) expect(f(undefined)).toBe(0);
  });
});

/**
 * Every save and journal written before classes existed carries a bare number.
 * Refusing them would mean a campaign could not be replayed as the game it was
 * actually played as.
 */
describe('the old shape still loads', () => {
  it('reads a bare number as a stack of battleships', () => {
    expect(ShipStackSchema.parse(7)).toEqual({ battleship: 7 });
  });

  it('reads a typed stack unchanged', () => {
    expect(ShipStackSchema.parse({ battleship: 2, lifter: 1 })).toEqual({ battleship: 2, lifter: 1 });
  });

  it('gives a legacy stack exactly its old tonnage and weight', () => {
    const legacy = ShipStackSchema.parse(5);
    expect(tonsIn(legacy)).toBe(5 * HULL_SPEC.battleship.tonnage);
    expect(hullsIn(legacy)).toBe(5);
  });
});

describe('the schema and the class list cannot drift', () => {
  it('accepts exactly the classes that exist', () => {
    expect([...STACK_KEYS].sort()).toEqual([...HULL_CLASSES].sort());
  });

  it('gives every class a spec', () => {
    for (const hull of HULL_CLASSES) expect(HULL_SPEC[hull], hull).toBeDefined();
  });

  it('gives every class a distinct place in the loss order', () => {
    const orders = HULL_CLASSES.map((h) => HULL_SPEC[h].lossOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

/**
 * A stack's key order must be a function of its contents, never of its history.
 *
 * `verifyReplay` compares `JSON.stringify` of live state against replayed
 * state, and JSON preserves insertion order — so a fleet assembled as
 * battleships-then-escorts and one assembled the other way round compared as
 * DIFFERENT worlds while holding identical ships. It surfaced when the doctrine
 * bots began buying three classes in varying order, and every value on both
 * sides matched, which is exactly the kind of divergence nobody can explain
 * from the failure message.
 */
describe('key order is canonical, so replay can compare by string', () => {
  const sys = () => createSeedState('freeworlds').systems.find((s) => s.id === 'ark-2')!;

  it('does not depend on the order classes were added', () => {
    const a = sys();
    addShipsAt(a, 'freeworlds', 3, 'battleship');
    addShipsAt(a, 'freeworlds', 2, 'escort');
    addShipsAt(a, 'freeworlds', 1, 'lifter');

    const b = sys();
    addShipsAt(b, 'freeworlds', 1, 'lifter');
    addShipsAt(b, 'freeworlds', 2, 'escort');
    addShipsAt(b, 'freeworlds', 3, 'battleship');

    expect(JSON.stringify(a.ships)).toBe(JSON.stringify(b.ships));
  });

  it('survives a removal that empties a class in the middle', () => {
    const a = sys();
    addShipsAt(a, 'freeworlds', 3, 'battleship');
    addShipsAt(a, 'freeworlds', 2, 'escort');
    addShipsAt(a, 'freeworlds', 1, 'lifter');
    setShipsAt(a, 'freeworlds', 4); // spends the screen first

    const b = sys();
    addShipsAt(b, 'freeworlds', 3, 'battleship');
    addShipsAt(b, 'freeworlds', 1, 'lifter');

    expect(JSON.stringify(a.ships)).toBe(JSON.stringify(b.ships));
  });

  it('orders every class the way HULL_CLASSES does', () => {
    const s = sys();
    for (const hull of [...HULL_CLASSES].reverse()) addShipsAt(s, 'freeworlds', 1, hull);
    expect(Object.keys(s.ships['freeworlds']!)).toEqual([...HULL_CLASSES]);
  });
});
