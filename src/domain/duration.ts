import { z } from 'zod';

/**
 * The only legal durations for an ESTIMATED (non-movement) order.
 *
 * Capped at 5 turns deliberately. A campaign is played in tens of turns, so a
 * 21-turn programme was a decision whose consequence the player would never
 * live to see — it read as a dead end rather than a long game. Everything now
 * lands within five turns, which keeps every declaration answerable inside the
 * horizon the player is actually thinking on.
 *
 * The scale stays Fibonacci-shaped because buckets should coarsen as they
 * lengthen: estimate uncertainty grows with scope, and there is deliberately
 * no 4.
 */
export const FIB_BUCKETS = [1, 2, 3, 5] as const;
export type FibScale = (typeof FIB_BUCKETS)[number];

export const MAX_DURATION: FibScale = 5;

export const FibScaleSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
]);

/**
 * Duration categories for estimated work. Fleet movement is intentionally
 * absent: its cost is computed from the hyperlane graph, never estimated.
 */
export const DURATION_CATEGORIES = [
  'courier',
  'decree',
  'political_maneuver',
  'espionage',
  'counter_intelligence',
  'blockade',
  'commerce_raiding',
  'treaty_ratification',
  'garrison_raising',
  'fortification',
  'refit',
  'retooling',
  'construction_infrastructure',
  'capital_ship_construction',
  'industrial_conversion',
] as const;

export type DurationCategory = (typeof DURATION_CATEGORIES)[number];
export const DurationCategorySchema = z.enum(DURATION_CATEGORIES);

/**
 * Per-category minimums, enforced HERE rather than in the prompt.
 *
 * A prompt can be talked out of its own rules — "an emergency crash programme
 * to lay down a dreadnought THIS WEEK" is exactly the phrasing that argues a
 * model down to 1. Code cannot be argued with. Every clamp is recorded so the
 * rubric can be corrected from real cases rather than guesses.
 */
export const CATEGORY_FLOORS: Record<DurationCategory, FibScale> = {
  courier: 1,
  decree: 1,
  political_maneuver: 1,
  espionage: 2,
  counter_intelligence: 2,
  blockade: 2,
  // A raid is a raid: you arrive, you take what is moving, you leave. Making
  // it slower would turn commerce raiding into a second kind of blockade.
  commerce_raiding: 1,
  treaty_ratification: 2,
  garrison_raising: 2,
  refit: 2,
  fortification: 3,
  retooling: 3,
  construction_infrastructure: 3,
  capital_ship_construction: 5,
  industrial_conversion: 5,
};

/** Round any positive number UP to the nearest legal bucket (caps at 5). */
export function toFibBucket(n: number): FibScale {
  for (const bucket of FIB_BUCKETS) {
    if (n <= bucket) return bucket;
  }
  return MAX_DURATION;
}

export function isFibScale(n: unknown): n is FibScale {
  return typeof n === 'number' && (FIB_BUCKETS as readonly number[]).includes(n);
}

export interface ClampResult {
  duration: FibScale;
  clamped: boolean;
  /** Present only when clamped, so the rubric can be tuned from real cases. */
  from?: FibScale;
  floor?: FibScale;
}

/**
 * Apply the category floor, clamping UPWARD only. Never shortens an estimate
 * the model made deliberately long.
 */
export function applyCategoryFloor(
  category: DurationCategory,
  proposed: FibScale,
): ClampResult {
  const floor = CATEGORY_FLOORS[category];
  if (proposed >= floor) return { duration: proposed, clamped: false };
  return { duration: floor, clamped: true, from: proposed, floor };
}

/**
 * Drop exactly one bucket, never below 1. Used by `accelerate_order`, where a
 * faction spends credits to buy back time.
 */
export function dropOneBucket(current: FibScale): FibScale {
  const i = FIB_BUCKETS.indexOf(current);
  if (i <= 0) return 1;
  return FIB_BUCKETS[i - 1]!;
}

/**
 * Credit cost of accelerating, proportional to the time bought. Buying a
 * bucket off a long programme costs more than off a short one.
 */
export function accelerationCost(current: FibScale): number {
  const next = dropOneBucket(current);
  const turnsSaved = current - next;
  return Math.max(40, turnsSaved * 180);
}
