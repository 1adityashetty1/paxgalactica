import { describe, expect, it } from 'vitest';
import { WORLD_SIZE, worldPixels, worldRuns } from '../src/ui/worlds.js';
import { WORLD_TYPES, WorldTypeSchema } from '../src/domain/state.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * The face of a world is pure geometry, so it is tested the way `layout.ts` and
 * `portrait.ts` are — there is no DOM in this suite, and art that lives inside a
 * component is art nothing checks.
 */
describe('a world has a face', () => {
  it('draws every type in the vocabulary', () => {
    for (const type of WORLD_TYPES) {
      const px = worldPixels(type);
      expect(px, type).toHaveLength(WORLD_SIZE);
      expect(px[0], type).toHaveLength(WORLD_SIZE);
      // A type with no entry in the table would silently fall back to a rock,
      // which is exactly the kind of quiet wrong this pins.
      expect(px.flat().filter(Boolean).length, type).toBeGreaterThan(200);
    }
  });

  it('is the same picture every time', () => {
    // The noise is a hash, never Math.random — the same discipline `rollD20`
    // follows. A planet that reshuffled itself on each render would read as the
    // panel being broken rather than as variety.
    for (const type of WORLD_TYPES) {
      expect(JSON.stringify(worldPixels(type))).toBe(JSON.stringify(worldPixels(type)));
    }
  });

  it('leaves the corners empty, because a world is round', () => {
    for (const type of WORLD_TYPES) {
      const px = worldPixels(type);
      expect(px[0]![0], type).toBeNull();
      expect(px[0]![WORLD_SIZE - 1], type).toBeNull();
      expect(px[WORLD_SIZE - 1]![0], type).toBeNull();
    }
  });

  it('runs reconstruct the grid exactly', () => {
    // The renderer draws runs, not pixels, so a bug here is a bug nobody would
    // see until a sprite came out striped.
    for (const type of WORLD_TYPES) {
      const px = worldPixels(type);
      const rebuilt: (string | null)[][] = px.map(() => new Array(WORLD_SIZE).fill(null));
      for (const r of worldRuns(type)) {
        for (let i = 0; i < r.width; i++) rebuilt[r.y]![r.x + i] = r.colour;
      }
      expect(rebuilt, type).toEqual(px);
    }
  });

  it('merges runs rather than emitting a rect per pixel', () => {
    // A planet is mostly bands of one colour; if this ever regressed to one
    // rect per pixel the panel would still look right and cost 3x the DOM.
    const runs = worldRuns('earthlike').length;
    expect(runs).toBeLessThan(WORLD_SIZE * WORLD_SIZE * 0.5);
  });

  it('draws the same world differently by day and by night', () => {
    // `earthnight` shares EARTH's grid, so the only thing separating them is
    // the night treatment actually firing.
    expect(JSON.stringify(worldPixels('earthlike')))
      .not.toBe(JSON.stringify(worldPixels('earthnight')));
  });
});

describe('the seed gives every world a face', () => {
  const state = createSeedState('meridian');

  it('types all 25 systems, and validly', () => {
    expect(state.systems).toHaveLength(25);
    for (const sys of state.systems) {
      expect(WorldTypeSchema.safeParse(sys.worldType).success, sys.id).toBe(true);
    }
  });

  it('uses the whole vocabulary', () => {
    // A type nobody holds is a type nobody has looked at — the same argument
    // that gave `monopolist` an owner after it sat implemented and dead.
    const used = new Set(state.systems.map((s) => s.worldType));
    for (const type of WORLD_TYPES) expect(used.has(type), type).toBe(true);
  });

  it('is not merely strategicValue wearing a costume', () => {
    // The tempting derivation, and the reason it is stored instead: a backwater
    // is allowed to be an ocean world and a great market to sit on a rock.
    const byValue = new Map<number, Set<string>>();
    for (const s of state.systems) {
      byValue.set(s.strategicValue, (byValue.get(s.strategicValue) ?? new Set()).add(s.worldType));
    }
    const spread = [...byValue.values()].filter((set) => set.size > 1);
    expect(spread.length).toBeGreaterThan(2);
  });
});
