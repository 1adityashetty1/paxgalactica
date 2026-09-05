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
const TypedStackSchema = z.object({
  battleship: count,
  escort: count,
  torpedo_boat: count,
  lifter: count,
});

export const ShipStackSchema = z
  .union([z.number().int().min(0), TypedStackSchema])
  .transform((v): Partial<Record<HullClass, number>> => (typeof v === 'number' ? { battleship: v } : v));

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
