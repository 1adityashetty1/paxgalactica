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

/**
 * Tons destroyed per ton of torpedo boat, in the strike before the fleets meet.
 *
 * The boat's entire output: it adds nothing to the line, and spends everything
 * it has in one salvo. That keeps it from being a cheaper battleship — a fleet
 * of nothing but boats fires once and is then annihilated, since it has no
 * weight with which to hold an orbit — while making it genuinely worth mixing,
 * because a hit landed before the exchange lowers what the enemy brings to it.
 */
export const TORPEDO_STRIKE = 0.3;

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
   * **The lift arm is soft.** A transport is unarmoured and unarmed, so it dies
   * before the battle line does; the only thing that keeps it alive is a screen
   * standing in front of it. That is an escort's entire reason to exist, and
   * for a while the table said so while ordering the classes the other way —
   * lifters last, which made transports the *safest* thing in a fleet and left
   * escorts with nothing to protect.
   *
   * So a fleet without a screen wins the orbital battle and arrives with its
   * transports already dead, which is the sentence this field was always meant
   * to be enforcing.
   */
  lossOrder: number;
  /** For the UI and the order of battle. */
  label: string;
}

export const HULL_SPEC: Record<HullClass, HullSpec> = {
  escort: { tonnage: 2, orbitalWeight: 1, carry: 0, lossOrder: 0, label: 'escort' },
  // Useless in orbit and the only way to take ground. High carry is what pays
  // for that uselessness — and being second in the loss order is what it pays
  // in return: unarmed, unarmoured, and dead the moment the screen is gone.
  lifter: { tonnage: 3, orbitalWeight: 0, carry: LIFTER_CARRY, lossOrder: 1, label: 'lifter' },
  // Cheap, fragile, and built to kill things far above its weight — the Jeune
  // École boat, and the reason destroyers were originally called "torpedo boat
  // destroyers".
  //
  // **It carries no weight into the line at all.** Its whole contribution is
  // the opening strike, delivered before the fleets close, at the heaviest
  // hulls it can reach. That is what makes a mixed fleet worth more than the
  // sum of its hulls: damage dealt BEFORE the exchange compounds, because the
  // enemy brings less into the trade and your own losses fall with it.
  //
  // Repricing could never have produced that. Combat weight is a sum over
  // hulls, so weight-per-credit of any mix is a weighted average of the
  // per-class figures and can never beat the best single class — every
  // reweighting just moves which PURE fleet wins. A mixed optimum needs an
  // effect that is superadditive, and firing first is one.
  torpedo_boat: { tonnage: 2, orbitalWeight: 0, carry: 0, lossOrder: 2, label: 'torpedo boat' },
  battleship: { tonnage: 4, orbitalWeight: 3, carry: 0, lossOrder: 3, label: 'battleship' },
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

/** A battleship's weight, the unit combat strength is stated in. */
export const BATTLESHIP_EQUIVALENT = HULL_SPEC.battleship.orbitalWeight;

/**
 * What a stack is worth in a fight, in **battleship-equivalents**.
 *
 * The unit exists so that a strength threshold means the same thing whatever
 * classes exist. A hull count does not: an escort is a whole hull for half a
 * battleship's tonnage and a third of its weight, so a fleet counted in hulls
 * crosses its own thresholds faster the more cheap hulls it buys — which is the
 * units-drift this design exists to remove, and it has now bitten twice, once
 * for the lift arm and once for the screen.
 *
 * A galaxy of nothing but battleships reads exactly as it did when strength was
 * a hull count, which is what makes this safe to substitute everywhere.
 */
export function battleshipEquivalents(stack: ShipStack | undefined): number {
  return orbitalWeightOf(stack) / BATTLESHIP_EQUIVALENT;
}

/**
 * The smallest proportional slice of a fleet worth `be` battleship-equivalents.
 *
 * Proportional for the same reason `drawProportional` is: the squadron that
 * sails should be the squadron that was standing. Returns the whole stack when
 * it is not enough, so a caller that has already checked strength gets what it
 * asked for and one that has not gets everything there is.
 */
export function drawToWeight(stack: ShipStack, be: number): ShipStack {
  const total = hullsIn(stack);
  if (total === 0 || be <= 0) return {};
  for (let k = 1; k <= total; k++) {
    const slice = drawProportional(stack, k);
    if (battleshipEquivalents(slice) >= be) return slice;
  }
  return normaliseStack(stack);
}

/** What one side's torpedo strike destroys, in tons. */
export function torpedoStrike(stacks: Iterable<ShipStack>): number {
  return tonsOfClass(stacks, 'torpedo_boat') * TORPEDO_STRIKE;
}

/** Tons of one class across a side. */
export function tonsOfClass(stacks: Iterable<ShipStack>, hull: HullClass): number {
  let n = 0;
  for (const st of stacks) n += (st[hull] ?? 0) * HULL_SPEC[hull].tonnage;
  return n;
}

/**
 * Losses applied to a fleet, some of them past the screen.
 *
 * `deep` is the fraction of `tons` that ignores the loss order and comes off
 * the **heaviest hulls first** — a torpedo boat striking through the screen at
 * the battle line. Whatever the heavy classes cannot absorb falls back into the
 * ordinary pass, so a fleet that is all escorts loses escorts either way.
 *
 * This is the whole of the class triangle, and it is a redistribution rather
 * than extra damage: the tonnage destroyed is the same, and only *which* ships
 * are destroyed changes. A torpedo boat that dealt bonus damage would just be a
 * better battleship.
 */
export function strikeStack(
  stack: ShipStack,
  tons: number,
  deep = 0,
): { taken: ShipStack; left: ShipStack } {
  const want = Math.max(0, tons);
  if (want <= 0) return { taken: {}, left: normaliseStack(stack) };

  const deepTons = want * Math.max(0, Math.min(1, deep));
  let left = normaliseStack(stack);
  let taken: ShipStack = {};

  if (deepTons > 0) {
    // Heaviest first — the reverse of the loss order, which is what "past the
    // screen" means: the screen is the cheapest thing there.
    const heavy = inLossOrder(left).reverse();
    let owed = deepTons;
    for (const cls of heavy) {
      if (owed <= 0) break;
      const each = HULL_SPEC[cls].tonnage;
      const n = Math.min(left[cls] ?? 0, Math.ceil(owed / each));
      if (n <= 0) continue;
      taken = mergeStacks(taken, { [cls]: n });
      const rest = (left[cls] ?? 0) - n;
      if (rest === 0) delete left[cls];
      else left[cls] = rest;
      owed -= n * each;
    }
  }

  const rest = trimToTons(left, Math.max(0, tonsIn(left) - (want - tonsIn(taken))));
  return { taken: mergeStacks(taken, rest.taken), left: rest.left };
}
