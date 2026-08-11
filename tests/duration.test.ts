import { describe, expect, it } from 'vitest';
import {
  accelerationCost,
  applyCategoryFloor,
  CATEGORY_FLOORS,
  DURATION_CATEGORIES,
  dropOneBucket,
  FIB_BUCKETS,
  FibScaleSchema,
  isFibScale,
  MAX_DURATION,
  toFibBucket,
} from '../src/domain/duration.js';

describe('the duration scale', () => {
  it('tops out at 5 turns, so nothing outlives the player’s interest', () => {
    expect(MAX_DURATION).toBe(5);
    expect(Math.max(...FIB_BUCKETS)).toBe(5);
  });

  it('accepts only the four legal buckets', () => {
    for (const n of FIB_BUCKETS) expect(FibScaleSchema.safeParse(n).success).toBe(true);
    for (const n of [0, 4, 6, 7, 8, 13, 21, -1, 1.5]) {
      expect(FibScaleSchema.safeParse(n).success, `${n} must be rejected`).toBe(false);
    }
  });

  it('rounds up to the nearest bucket, capping at 5', () => {
    expect(toFibBucket(1)).toBe(1);
    expect(toFibBucket(4)).toBe(5);
    expect(toFibBucket(5)).toBe(5);
    expect(toFibBucket(9)).toBe(5);
    expect(toFibBucket(99)).toBe(5);
  });

  it('recognises legal values', () => {
    expect(isFibScale(5)).toBe(true);
    expect(isFibScale(3)).toBe(true);
    expect(isFibScale(8)).toBe(false);
    expect(isFibScale('5')).toBe(false);
  });
});

describe('category floors', () => {
  it('defines a floor for every category, all legal and none above the cap', () => {
    for (const category of DURATION_CATEGORIES) {
      const floor = CATEGORY_FLOORS[category];
      expect(floor, category).toBeDefined();
      expect(isFibScale(floor), `${category} floor ${floor}`).toBe(true);
      expect(floor).toBeLessThanOrEqual(MAX_DURATION);
    }
  });

  it('clamps a capital ship programme upward no matter the phrasing', () => {
    const result = applyCategoryFloor('capital_ship_construction', 1);
    expect(result.duration).toBe(5);
    expect(result.clamped).toBe(true);
    expect(result.from).toBe(1);
    expect(result.floor).toBe(5);
  });

  it('leaves an estimate at or above the floor untouched', () => {
    expect(applyCategoryFloor('construction_infrastructure', 3)).toEqual({
      duration: 3,
      clamped: false,
    });
    expect(applyCategoryFloor('construction_infrastructure', 5)).toEqual({
      duration: 5,
      clamped: false,
    });
  });

  it('never clamps downward', () => {
    for (const category of DURATION_CATEGORIES) {
      for (const proposed of FIB_BUCKETS) {
        expect(applyCategoryFloor(category, proposed).duration).toBeGreaterThanOrEqual(proposed);
      }
    }
  });
});

describe('acceleration', () => {
  it('drops exactly one bucket and bottoms out at 1', () => {
    expect(dropOneBucket(5)).toBe(3);
    expect(dropOneBucket(3)).toBe(2);
    expect(dropOneBucket(2)).toBe(1);
    expect(dropOneBucket(1)).toBe(1);
  });

  it('costs more to buy time off a longer programme', () => {
    expect(accelerationCost(5)).toBeGreaterThan(accelerationCost(3));
    expect(accelerationCost(3)).toBeGreaterThan(0);
  });
});
