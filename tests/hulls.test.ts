import { describe, expect, it } from 'vitest';
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
  it('reproduces the old flat ship cost and upkeep for a line hull', () => {
    // The migration is behaviour-neutral only if this holds.
    expect(hullCost('line')).toBe(60);
    expect(hullUpkeep('line')).toBe(4);
  });

  it('charges every class the same per ton, so presence cannot be arbitraged', () => {
    for (const hull of HULL_CLASSES) {
      expect(hullCost(hull) / HULL_SPEC[hull].tonnage, hull).toBe(CREDITS_PER_TON);
      expect(hullUpkeep(hull) / HULL_SPEC[hull].tonnage, hull).toBe(UPKEEP_PER_TON);
    }
  });
});

/**
 * The escort-spam bug: escorts once had a line hull's weight at half the
 * tonnage, making them twice as efficient on every axis.
 */
describe('a line hull is the better fighter on every axis', () => {
  const perTon = (h: 'line' | 'escort' | 'torpedo_boat') =>
    HULL_SPEC[h].orbitalWeight / HULL_SPEC[h].tonnage;
  const perCredit = (h: 'line' | 'escort' | 'torpedo_boat') =>
    HULL_SPEC[h].orbitalWeight / hullCost(h);

  it('beats an escort per ton and per credit', () => {
    expect(perTon('line')).toBeGreaterThan(perTon('escort'));
    expect(perCredit('line')).toBeGreaterThan(perCredit('escort'));
  });

  it('beats a torpedo boat in a straight exchange too', () => {
    expect(perTon('line')).toBeGreaterThan(perTon('torpedo_boat'));
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
  const mixed = { line: 3, escort: 2, lifter: 1 };

  it('counts hulls for a player and tons for the rules', () => {
    expect(hullsIn(mixed)).toBe(6);
    expect(tonsIn(mixed)).toBe(3 * 4 + 2 * 2 + 1 * 3);
  });

  it('weighs only what can fight', () => {
    expect(orbitalWeightOf(mixed)).toBe(3 * 3 + 2 * 1);
    expect(carryOf(mixed)).toBe(6);
  });

  it('spends escorts before line hulls, and line hulls before the lift arm', () => {
    expect(inLossOrder(mixed)).toEqual(['escort', 'line', 'lifter']);
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
  it('reads a bare number as a stack of line hulls', () => {
    expect(ShipStackSchema.parse(7)).toEqual({ line: 7 });
  });

  it('reads a typed stack unchanged', () => {
    expect(ShipStackSchema.parse({ line: 2, lifter: 1 })).toEqual({ line: 2, lifter: 1 });
  });

  it('gives a legacy stack exactly its old tonnage and weight', () => {
    const legacy = ShipStackSchema.parse(5);
    expect(tonsIn(legacy)).toBe(5 * HULL_SPEC.line.tonnage);
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
