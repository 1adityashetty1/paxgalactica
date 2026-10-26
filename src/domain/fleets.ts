import { z } from 'zod';
import { HULL_CLASSES, ShipStackSchema, hullsIn, mergeStacks, normaliseStack, type HullClass, type ShipStack } from './hulls.js';

/**
 * Named fleets: every power's ships organised into numbered fleets that are
 * moved, reported and remembered by identity (`docs/design-2026-10-26-fleets.md`).
 *
 * **Fleets own the hulls.** A world's fleets live on it (`StarSystem.fleets`),
 * and `system.ships` is an index of them — rewritten from the fleets on every
 * write, so the reads that were written against it (income, battles, bots,
 * prompts, the UI) read the same numbers as before. A fleet under way is a
 * `FleetTag` on its movement order, and its hulls are the order's `force`.
 *
 * A leaf beside `hulls.ts`: `state.ts` builds its schemas from this and its
 * accessors call into it, so nothing here may import from `state.ts`.
 */

export const FleetSchema = z.object({
  /** `flt-<power>-<number>`; empty until `settleFleets` numbers a fleet the accessors made. */
  id: z.string(),
  factionId: z.string().min(1),
  /** The lowest its power was not using when it was raised; 0 until settled. */
  number: z.number().int().min(0),
  /** A name the power gave it, or null for its power's default for the number. */
  name: z.string().max(60).nullable().default(null),
  stack: ShipStackSchema,
});
export type Fleet = z.infer<typeof FleetSchema>;

/** A fleet under way, on its movement order. Its hulls are the order's `force`. */
export const FleetTagSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().min(1),
  name: z.string().max(60).nullable().default(null),
  /**
   * Sent without naming a fleet. A detachment merges into the senior fleet of
   * its power where it arrives, and stands as a fleet of its own only where
   * there is none — or the bots' every massing move would raise a new fleet.
   */
  detached: z.boolean().default(false),
});
export type FleetTag = z.infer<typeof FleetTagSchema>;

/** What the accessors need of a world. Structural, so `state.ts` is not imported. */
interface Holds {
  ships: Record<string, ShipStack>;
  fleets?: Fleet[];
}

/** Whether a world keeps fleets: every world seeded from journal version 31. */
export function fleetMode(system: Holds): system is Holds & { fleets: Fleet[] } {
  return Array.isArray(system.fleets);
}

/* ---------------- whose hulls these are ---------------- */

let scope: { factionId: string; tag: FleetTag } | null = null;

/**
 * Run `fn` with one fleet's identity in force: adds within it land in that
 * fleet and removals come off it first. How a fleet keeps its name across a
 * departure, a landing, a retreat and a recall, all of which write hulls
 * through the same accessors as everything else.
 */
export function withFleet<T>(factionId: string, tag: FleetTag | null | undefined, fn: () => T): T {
  const outer = scope;
  scope = tag ? { factionId, tag } : null;
  try {
    return fn();
  } finally {
    scope = outer;
  }
}

/** Senior first: lowest number, an unnumbered fleet after every numbered one. */
const bySeniority = (a: Fleet, b: Fleet): number =>
  (a.number || Number.MAX_SAFE_INTEGER) - (b.number || Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);

export function fleetsAt(system: Holds, factionId: string): Fleet[] {
  return (system.fleets ?? []).filter((f) => f.factionId === factionId).sort(bySeniority);
}

/**
 * Put `next` in place of a power's ships at a world, through its fleets.
 *
 * The one write every accessor in fleet mode makes. Per class, what is added
 * goes to the fleet in scope, else to the senior fleet there, else to a new
 * one; what is removed comes off the fleet in scope first, then off the fleets
 * there in proportion to what each holds of that class. Empty fleets go, and
 * the index is rewritten.
 */
export function writeFleets(system: Holds & { fleets: Fleet[] }, factionId: string, next: ShipStack): void {
  const mine = fleetsAt(system, factionId);
  const current = mine.reduce<ShipStack>((s, f) => mergeStacks(s, f.stack), {});
  const own = scope && scope.factionId === factionId ? scope.tag : null;
  const scoped = own ? mine.find((f) => f.id === own.id) : undefined;

  let chosen: Fleet | undefined;
  const receiver = (): Fleet => (chosen ??= pick());
  const pick = (): Fleet => {
    if (scoped) return scoped;
    const senior = mine[0];
    if (own) {
      // A detachment rejoins the senior fleet where it lands; a named fleet
      // stands as itself.
      if (own.detached && senior) return senior;
      const raised: Fleet = { id: own.id, factionId, number: own.number, name: own.name, stack: {} };
      system.fleets.push(raised);
      mine.push(raised);
      return raised;
    }
    if (senior) return senior;
    const raised: Fleet = { id: '', factionId, number: 0, name: null, stack: {} };
    system.fleets.push(raised);
    mine.push(raised);
    return raised;
  };

  for (const hull of HULL_CLASSES) {
    const delta = (next[hull] ?? 0) - (current[hull] ?? 0);
    if (delta > 0) {
      const f = receiver();
      f.stack = normaliseStack({ ...f.stack, [hull]: (f.stack[hull] ?? 0) + delta });
    } else if (delta < 0) {
      removeClass(scoped ? [scoped, ...mine.filter((f) => f !== scoped)] : mine, hull, -delta, scoped !== undefined);
    }
  }

  system.fleets = system.fleets.filter((f) => hullsIn(f.stack) > 0);
  reindex(system, factionId);
}

/**
 * Take `count` hulls of one class off `fleets`. With `firstWhole`, the first
 * fleet gives what it can before the rest are touched; otherwise each gives in
 * proportion to what it holds, by largest remainder, ties to the senior.
 */
function removeClass(fleets: Fleet[], hull: HullClass, count: number, firstWhole: boolean): void {
  let left = count;
  const take = (f: Fleet, n: number): void => {
    const now = (f.stack[hull] ?? 0) - n;
    f.stack = normaliseStack({ ...f.stack, [hull]: now });
    left -= n;
  };
  let pool = fleets;
  if (firstWhole && pool[0]) {
    take(pool[0], Math.min(left, pool[0].stack[hull] ?? 0));
    pool = pool.slice(1);
  }
  const held = pool.map((f) => f.stack[hull] ?? 0);
  const total = held.reduce((a, b) => a + b, 0);
  if (left <= 0 || total === 0) return;
  const want = Math.min(left, total);
  const exact = held.map((h) => (h * want) / total);
  const shares = exact.map(Math.floor);
  let spare = want - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (spare <= 0) break;
    if (shares[i]! < held[i]!) {
      shares[i]! += 1;
      spare -= 1;
    }
  }
  pool.forEach((f, i) => {
    if (shares[i]! > 0) take(f, shares[i]!);
  });
}

/** Rewrite one power's entry in the index from its fleets there. */
export function reindex(system: Holds & { fleets: Fleet[] }, factionId: string): void {
  const sum = fleetsAt(system, factionId).reduce<ShipStack>((s, f) => mergeStacks(s, f.stack), {});
  if (hullsIn(sum) === 0) delete system.ships[factionId];
  else system.ships[factionId] = sum;
}

/* ---------------- numbering, names and finding one ---------------- */

/** Every number a power's fleets are using, at worlds and under way. */
export function numbersInUse(
  state: { systems: Holds[]; pendingOrders: { factionId: string; fleet?: FleetTag | undefined }[] },
  factionId: string,
): Set<number> {
  const used = new Set<number>();
  for (const s of state.systems) for (const f of s.fleets ?? []) if (f.factionId === factionId && f.number > 0) used.add(f.number);
  for (const o of state.pendingOrders) if (o.factionId === factionId && o.fleet) used.add(o.fleet.number);
  return used;
}

export function lowestFree(used: Set<number>): number {
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export const fleetIdFor = (factionId: string, number: number): string => `flt-${factionId}-${number}`;

/**
 * After every batch and tick: number what the accessors raised, drop empty
 * fleets, put each world's list in a fixed order and its stacks in canonical
 * key order — `verifyReplay` compares strings, so a fleet's shape must be a
 * function of what is in it, not of how it was assembled.
 */
export function settleFleets(state: {
  systems: (Holds & { id: string })[];
  pendingOrders: { factionId: string; fleet?: FleetTag | undefined }[];
}): void {
  const used = new Map<string, Set<number>>();
  const usedBy = (f: string) => {
    let u = used.get(f);
    if (!u) used.set(f, (u = numbersInUse(state, f)));
    return u;
  };
  for (const system of [...state.systems].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!fleetMode(system)) continue;
    system.fleets = system.fleets
      .filter((f) => hullsIn(f.stack) > 0)
      .map((f) => {
        if (f.number > 0) return FleetSchema.parse({ ...f, stack: normaliseStack(f.stack) });
        const u = usedBy(f.factionId);
        const number = lowestFree(u);
        u.add(number);
        return FleetSchema.parse({ id: fleetIdFor(f.factionId, number), factionId: f.factionId, number, name: f.name, stack: normaliseStack(f.stack) });
      })
      .sort((a, b) => a.factionId.localeCompare(b.factionId) || a.number - b.number);
    for (const f of new Set(system.fleets.map((x) => x.factionId))) reindex(system, f);
  }
}

const ORDINAL_WORDS = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
];

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * What each power calls its fleets, so five navies are told apart by name as
 * they are by everything else. A power not listed — a sandbox, a test board —
 * gets the plain form.
 */
const FLEET_STYLE: Record<string, (n: number) => string> = {
  meridian: (n) => `Operating Group ${n}`,
  vigil: (n) => `${ordinal(n)} Battle Squadron`,
  ojjul: (n) => `${ordinal(n)} House Fleet`,
  freeworlds: (n) => `${ordinal(n)} Wardfleet`,
  drajk: (n) => `${ordinal(n)} Pack`,
};

/** A fleet's name: what its power called it, or the default for its number. */
export function fleetName(factionId: string, fleet: { number: number; name: string | null }): string {
  if (fleet.name) return fleet.name;
  if (fleet.number === 0) return 'a new fleet';
  return (FLEET_STYLE[factionId] ?? ((n: number) => `${ordinal(n)} Fleet`))(fleet.number);
}

/** The number a query names, in digits or as an ordinal word, if it names one. */
function numberIn(query: string): number | null {
  const digits = /\b(\d+)(?:st|nd|rd|th)?\b/i.exec(query);
  if (digits) return Number(digits[1]);
  const words = query.toLowerCase().split(/[^a-z]+/);
  const at = ORDINAL_WORDS.findIndex((w, i) => i > 0 && words.includes(w));
  return at > 0 ? at : null;
}

/**
 * The one fleet a query names, among `fleets` (one power's), or null.
 *
 * By id, by name, then by number — *"3rd"*, *"Third Pack"*, *"3"*. The model
 * names a fleet the way a player does, and code does the lookup, as
 * `resolveCommander` does for officers. Two fleets a query fits equally is a
 * query that has named neither.
 */
export function resolveFleet<F extends { id: string; factionId: string; number: number; name: string | null }>(
  fleets: readonly F[],
  query: string,
): F | null {
  const q = query.trim();
  if (!q) return null;
  const byId = fleets.find((f) => f.id === q);
  if (byId) return byId;
  const lower = q.toLowerCase();
  const byName = fleets.filter((f) => fleetName(f.factionId, f).toLowerCase() === lower);
  if (byName.length === 1) return byName[0]!;
  const n = numberIn(q);
  if (n !== null) {
    const byNumber = fleets.filter((f) => f.number === n);
    if (byNumber.length === 1) return byNumber[0]!;
  }
  const loose = fleets.filter((f) => fleetName(f.factionId, f).toLowerCase().includes(lower));
  return loose.length === 1 ? loose[0]! : null;
}

/**
 * Bring the fleets into line with `ships`, where something wrote the index
 * directly — a test building a board, or a sandbox priming one. Run at the
 * start of every batch and tick. In play it finds nothing to do: every write
 * the engine makes goes through the fleets. What it finds is treated as the
 * truth and written through the fleets, as an accessor would have.
 */
export function adoptIndex(state: { systems: Holds[] }): void {
  for (const system of state.systems) {
    if (!fleetMode(system)) continue;
    const powers = new Set([...Object.keys(system.ships), ...system.fleets.map((f) => f.factionId)]);
    for (const factionId of powers) {
      const held = fleetsAt(system, factionId).reduce<ShipStack>((s, f) => mergeStacks(s, f.stack), {});
      const index = normaliseStack(system.ships[factionId] ?? {});
      if (HULL_CLASSES.some((h) => (held[h] ?? 0) !== (index[h] ?? 0))) writeFleets(system, factionId, index);
    }
  }
}
