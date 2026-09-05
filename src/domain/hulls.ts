import { z } from 'zod';

/**
 * Ship classes, and the one number every fleet limit is measured in.
 *
 * A fleet used to be a count. That made every hull identical, so composition
 * was not a decision and "build ships" was the whole of naval strategy. It also
 * meant *fleet size* was expressed five different ways — a hull count for
 * upkeep, the same count for presence and income contest, another for
 * `subornLimit`, a fraction of it for insolvency attrition, and a flat
 * `SHIP_COST` for buying and for suborned crews — five conventions that could
 * drift apart and had no reason to agree.
 *
 * **Tonnage is the single primitive.** Cost and upkeep are derived from it, so
 * they cannot disagree about how big a ship is, and everything that imposes a
 * limit based on fleet size is denominated in tons.
 *
 * The rates are chosen so a battleship is **exactly what a ship was before this
 * existed**: 4 tons at `CREDITS_PER_TON` is 60, the old `SHIP_COST`, and 4 tons
 * at `UPKEEP_PER_TON` is 4, the old `UPKEEP_PER_FLEET_POINT`. A galaxy of
 * nothing but battleships therefore plays identically, which is what makes the
 * migration to a typed record a change with no balance argument in it.
 *
 * ## Tonnage is not combat weight, and conflating them is the trap
 *
 * Tonnage is how much ship there is. `orbitalWeight` is what it does in a
 * fight. A lifter is a real vessel that takes up space, costs upkeep, contests
 * a world's income and can be suborned — and is worth nothing in an exchange of
 * fire. One number cannot say both.
 *
 * Keeping cost strictly per-ton also closes an exploit by construction: cheap
 * hulls cannot become the efficient way to skim a rival's income, because every
 * class buys exactly the same presence per credit.
 *
 * ## A class must have a job, not a discount
 *
 * The first draft of this table gave escorts the same `orbitalWeight` as a line
 * hull at half the tonnage, which made them **twice** as efficient per ton, per
 * credit and per point of upkeep — escort spam, with the only downside being
 * that they die first, which barely matters when you are winning. Weight is now
 * superlinear in tonnage for warships, so a battleship is the better fighter on
 * every axis and an escort's compensation is entirely that it is *spent first*.
 *
 * That is the same lesson `tradeEthic` and `warEthic` both taught: a difference
 * expressed only as a number gets solved once and then ignored.
 */

export const HULL_CLASSES = ['battleship', 'escort', 'torpedo_boat', 'lifter'] as const;
export const HullClassSchema = z.enum(HULL_CLASSES);
export type HullClass = (typeof HULL_CLASSES)[number];

/** Credits per ton of hull. `line` is 4 tons, so a battleship costs 60. */
export const CREDITS_PER_TON = 15;
/** Upkeep per ton per turn. `line` is 4 tons, so a battleship costs 4 a turn. */
export const UPKEEP_PER_TON = 1;

/** Ground troops one lifter puts on a world. */
export const LIFTER_CARRY = 6;

export interface HullSpec {
  /** How much ship there is. The unit every fleet-size limit is measured in. */
  tonnage: number;
  /**
   * What it contributes to an orbital exchange.
   *
   * Zero means it cannot fight at all: it is carried, it is counted, and it
   * dies with whatever was protecting it.
   */
  orbitalWeight: number;
  /** Ground troops it lands. Only the lift arm has any. */
  carry: number;
  /**
   * Where it sits in the loss order — lower is spent first.
   *
   * This is an escort's entire reason to exist. It is the same weight per ton
   * as nothing else in particular; what it does is stand in front of the line
   * hulls and the lift arm, which is why a fleet without escorts arrives at a
   * contested world with its transports already dead.
   */
  lossOrder: number;
  /** For the UI and the order of battle. */
  label: string;
}

export const HULL_SPEC: Record<HullClass, HullSpec> = {
  escort: { tonnage: 2, orbitalWeight: 1, carry: 0, lossOrder: 0, label: 'escort' },
  // Cheap, fragile, and built to kill things far above its weight — the Jeune
  // École boat, and the reason destroyers were originally called "torpedo boat
  // destroyers". It strikes past the screen rather than adding to the line.
  torpedo_boat: { tonnage: 2, orbitalWeight: 1, carry: 0, lossOrder: 1, label: 'torpedo boat' },
  battleship: { tonnage: 4, orbitalWeight: 3, carry: 0, lossOrder: 2, label: 'battleship' },
  // Useless in orbit and the only way to take ground. High carry is what pays
  // for that uselessness.
  lifter: { tonnage: 3, orbitalWeight: 0, carry: LIFTER_CARRY, lossOrder: 3, label: 'lifter' },
};

/** What a hull of this class costs to lay down. */
export const hullCost = (hull: HullClass): number => HULL_SPEC[hull].tonnage * CREDITS_PER_TON;
/** What it costs to keep, per turn. */
export const hullUpkeep = (hull: HullClass): number => HULL_SPEC[hull].tonnage * UPKEEP_PER_TON;

/**
 * A faction's ships at one place, by class.
 *
 * Accepts the **bare number** every save and journal written before classes
 * existed carries, and normalises it to a stack of battleships — so an old
 * campaign replays as the game it was played as rather than being refused.
 */
const count = z.number().int().min(0).optional();

/**
 * Written out rather than `z.record(HullClassSchema, …)` because a record keyed
 * by an enum is exhaustive in Zod 4 — it demands every class on every stack,
 * which would put four keys on every faction at every system in every save. A
 * test pins these keys against `HULL_CLASSES` so the two cannot drift.
 */
export const TypedStackSchema = z.object({
  battleship: count,
  escort: count,
  torpedo_boat: count,
  lifter: count,
});

export const ShipStackSchema = z
  .union([z.number().int().min(0), TypedStackSchema])
  .transform((v): Partial<Record<HullClass, number>> =>
    normaliseStack(typeof v === 'number' ? { battleship: v } : v),
  );

/**
 * Drop empty classes, so a stack never carries a zero.
 *
 * The invariant is what lets `presentAt` and the income split trust that a key
 * means a fleet. Enforced here as well as in the accessors because a stack can
 * also arrive from a save file or a journal, where nothing went through them —
 * `force: 0` on an old movement order parses to `{ battleship: 0 }` otherwise,
 * which reads as a fleet of nothing rather than as no fleet.
 */
export function normaliseStack(stack: Partial<Record<HullClass, number>>): ShipStack {
  const out: ShipStack = {};
  for (const hull of HULL_CLASSES) {
    const n = stack[hull] ?? 0;
    if (n > 0) out[hull] = n;
  }
  return out;
}

/** The keys `ShipStackSchema` accepts. Exported so a test can hold it to `HULL_CLASSES`. */
export const STACK_KEYS = Object.keys(TypedStackSchema.shape) as HullClass[];

export type ShipStack = Partial<Record<HullClass, number>>;

/** Hulls in a stack, of every class. What a player counts. */
export function hullsIn(stack: ShipStack | undefined): number {
  if (!stack) return 0;
  return Object.values(stack).reduce((n, v) => n + (v ?? 0), 0);
}

/** Tons in a stack. What every rule counts. */
export function tonsIn(stack: ShipStack | undefined): number {
  if (!stack) return 0;
  return HULL_CLASSES.reduce((n, hull) => n + (stack[hull] ?? 0) * HULL_SPEC[hull].tonnage, 0);
}

/** What a stack is worth in an orbital exchange. */
export function orbitalWeightOf(stack: ShipStack | undefined): number {
  if (!stack) return 0;
  return HULL_CLASSES.reduce((n, hull) => n + (stack[hull] ?? 0) * HULL_SPEC[hull].orbitalWeight, 0);
}

/** Ground troops a stack can land. */
export function carryOf(stack: ShipStack | undefined): number {
  if (!stack) return 0;
  return HULL_CLASSES.reduce((n, hull) => n + (stack[hull] ?? 0) * HULL_SPEC[hull].carry, 0);
}

/** What a stack cost to build, used to price suborned crews. */
export function stackCost(stack: ShipStack | undefined): number {
  if (!stack) return 0;
  return HULL_CLASSES.reduce((n, hull) => n + (stack[hull] ?? 0) * hullCost(hull), 0);
}

/** Classes present, spent-first order. Deterministic, so replay holds. */
export function inLossOrder(stack: ShipStack): HullClass[] {
  return HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0).sort(
    (a, b) => HULL_SPEC[a].lossOrder - HULL_SPEC[b].lossOrder || a.localeCompare(b),
  );
}

/** Two stacks added together. Neither input is mutated. */
export function mergeStacks(a: ShipStack | undefined, b: ShipStack | undefined): ShipStack {
  const out: ShipStack = {};
  for (const hull of HULL_CLASSES) {
    const n = (a?.[hull] ?? 0) + (b?.[hull] ?? 0);
    if (n > 0) out[hull] = n;
  }
  return out;
}

/**
 * Spend `hulls` ships out of a stack, cheapest-first, and say what went.
 *
 * Returns `{ taken, left }` rather than mutating, so a caller can put the
 * losses in a report and the survivors on the board without recounting.
 */
export function takeHulls(stack: ShipStack, hulls: number): { taken: ShipStack; left: ShipStack } {
  const left = normaliseStack(stack);
  const taken: ShipStack = {};
  let want = Math.max(0, Math.floor(hulls));
  for (const cls of inLossOrder(left)) {
    if (want <= 0) break;
    const n = Math.min(want, left[cls] ?? 0);
    if (n <= 0) continue;
    taken[cls] = n;
    const rest = (left[cls] ?? 0) - n;
    if (rest === 0) delete left[cls];
    else left[cls] = rest;
    want -= n;
  }
  return { taken, left };
}

/**
 * Cut a stack down until it displaces no more than `tons`, spending in loss
 * order.
 *
 * **Losses are counted in tons, not in combat weight**, and that distinction is
 * load-bearing. Weight decides who wins the exchange; tonnage decides how much
 * is destroyed by it. Were losses counted in weight, a lifter — which has none
 * — could never be hit, so a fleet that packed transports behind its line would
 * carry them through any battle for free, and a mixed fleet would strictly
 * dominate a pure warfleet of the same size.
 */
export function trimToTons(stack: ShipStack, tons: number): { taken: ShipStack; left: ShipStack } {
  const left = normaliseStack(stack);
  const taken: ShipStack = {};
  let over = tonsIn(left) - Math.max(0, tons);
  for (const cls of inLossOrder(left)) {
    if (over <= 0) break;
    const each = HULL_SPEC[cls].tonnage;
    const n = Math.min(left[cls] ?? 0, Math.ceil(over / each));
    if (n <= 0) continue;
    taken[cls] = n;
    const rest = (left[cls] ?? 0) - n;
    if (rest === 0) delete left[cls];
    else left[cls] = rest;
    over -= n * each;
  }
  return { taken, left };
}

/**
 * Take a slice of a fleet, keeping its shape.
 *
 * A bare `force: 20` on a movement order says how many ships to send and
 * nothing about which, so the draw is **proportional** — twenty ships out of a
 * mixed squadron leaves the same squadron, smaller. The alternatives are both
 * worse: drawing in loss order sends the escorts and keeps the battleships at
 * home, and drawing best-first means a plain number can never carry the lift
 * arm, so an invasion ordered as "send 30 ships" arrives unable to take
 * ground. Neither is guessable from the order the player wrote.
 *
 * Largest-remainder on a deterministic class order, so replay is exact.
 */
export function drawProportional(stack: ShipStack, hulls: number): ShipStack {
  const have = hullsIn(stack);
  const want = Math.min(Math.max(0, Math.floor(hulls)), have);
  if (want <= 0) return {};
  if (want === have) return normaliseStack(stack);

  const out: ShipStack = {};
  const classes = HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0);
  let assigned = 0;
  const remainders: { hull: HullClass; frac: number }[] = [];
  for (const hull of classes) {
    const exact = ((stack[hull] ?? 0) * want) / have;
    const whole = Math.floor(exact);
    if (whole > 0) out[hull] = whole;
    assigned += whole;
    remainders.push({ hull, frac: exact - whole });
  }
  remainders.sort((a, b) => b.frac - a.frac || a.hull.localeCompare(b.hull));
  for (const { hull } of remainders) {
    if (assigned >= want) break;
    if ((out[hull] ?? 0) >= (stack[hull] ?? 0)) continue;
    out[hull] = (out[hull] ?? 0) + 1;
    assigned += 1;
  }
  return out;
}

/** Every class in a stack, in a stable order, for a report or a label. */
export function describeStack(stack: ShipStack | undefined): string {
  if (!stack) return '';
  const parts = HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0).map(
    (h) => `${stack[h]} ${HULL_SPEC[h].label}${(stack[h] ?? 0) === 1 ? '' : 's'}`,
  );
  return parts.join(', ');
}

/** What `a` has that `b` does not — the ships that went missing. */
export function subtractStack(a: ShipStack, b: ShipStack): ShipStack {
  const out: ShipStack = {};
  for (const hull of HULL_CLASSES) {
    const n = (a[hull] ?? 0) - (b[hull] ?? 0);
    if (n > 0) out[hull] = n;
  }
  return out;
}
