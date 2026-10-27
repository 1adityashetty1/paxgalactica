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

/**
 * What a fleet is for, fixed when it is numbered. Every hull is in a fleet, as
 * in Stellaris, and the single-vessel jobs stand as fleets of their own rather
 * than riding in the line: a listener or a freighter is a one-ship fleet unless
 * its power merges it into another, and an officer with no fleet to command
 * keeps a courier. Each kind is numbered on its own, so a power's 3rd Battle
 * Squadron is its third warfleet whatever its listeners are called.
 */
export const FLEET_KINDS = ['line', 'listener', 'freighter', 'courier'] as const;
export const FleetKindSchema = z.enum(FLEET_KINDS);
export type FleetKind = z.infer<typeof FleetKindSchema>;

/** Hull classes that stand as one-ship fleets of their own, each its kind. */
export const SOLO_CLASSES = ['listener', 'freighter'] as const satisfies readonly HullClass[];
const isSolo = (hull: HullClass): hull is (typeof SOLO_CLASSES)[number] => (SOLO_CLASSES as readonly HullClass[]).includes(hull);

/** The kind a fleet of this stack is: one job alone names it, anything mixed is the line. */
export function kindOf(stack: ShipStack): FleetKind {
  const held = HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0);
  if (held.length === 1) {
    const only = held[0]!;
    if (only === 'courier' || isSolo(only)) return only;
  }
  return 'line';
}

export const FleetSchema = z.object({
  /** `flt-<power>-<number>`, or `flt-<power>-<kind>-<number>` off the line; empty until `settleFleets` numbers it. */
  id: z.string(),
  factionId: z.string().min(1),
  kind: FleetKindSchema.default('line'),
  /** The lowest its power was not using for its kind when it was raised; 0 until settled. */
  number: z.number().int().min(0),
  /** A name the power gave it, or null for its power's default for the number. */
  name: z.string().max(60).nullable().default(null),
  stack: ShipStackSchema,
  /**
   * The officer who commands it: one of its power's, standing at its world.
   * An officer commands one fleet at most, and stays a unit of their own — they
   * may stand at a world without commanding, or ride a fleet another commands.
   * Cleared when that stops being true (`settleCommand` in the reducer).
   */
  commanderId: z.string().nullable().default(null),
});
export type Fleet = z.infer<typeof FleetSchema>;

/** A fleet under way, on its movement order. Its hulls are the order's `force`. */
export const FleetTagSchema = z.object({
  id: z.string().min(1),
  kind: FleetKindSchema.default('line'),
  number: z.number().int().min(1),
  name: z.string().max(60).nullable().default(null),
  /**
   * Sent without naming a fleet. A detachment merges into the senior fleet of
   * its power where it arrives, and stands as a fleet of its own only where
   * there is none — or the bots' every massing move would raise a new fleet.
   */
  detached: z.boolean().default(false),
  /** Its commander, aboard the same voyage; they command it again where it lands. */
  commanderId: z.string().nullable().default(null),
});
export type FleetTag = z.infer<typeof FleetTagSchema>;
/** A tag as written by hand, before its defaults are filled. */
export type FleetTagInput = z.input<typeof FleetTagSchema>;

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

let scope: { factionId: string; tag: FleetTagInput } | null = null;

/**
 * Run `fn` with one fleet's identity in force: adds within it land in that
 * fleet and removals come off it first. How a fleet keeps its name across a
 * departure, a landing, a retreat and a recall, all of which write hulls
 * through the same accessors as everything else.
 */
export function withFleet<T>(factionId: string, tag: FleetTagInput | null | undefined, fn: () => T): T {
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
 * goes to the fleet in scope, else — a listener or a freighter — to a one-ship
 * fleet of its own each, else to the senior warfleet there, else to a new one;
 * what is removed comes off the fleet in scope first, then off the fleets there
 * in proportion to what each holds of that class. Empty fleets go, and the
 * index is rewritten.
 *
 * A courier is never written here: at rest it lives only in its officer's
 * fleet and never in the index (`settleCouriers`), so a courier that lands with
 * its officer is set aside, and the officer's courier is raised again where
 * they stand if they command nothing.
 */
export function writeFleets(system: Holds & { fleets: Fleet[] }, factionId: string, next: ShipStack): void {
  const mine = fleetsAt(system, factionId);
  const current = mine.reduce<ShipStack>((s, f) => mergeStacks(s, f.stack), {});
  const own = scope && scope.factionId === factionId ? scope.tag : null;
  const scoped = own ? mine.find((f) => f.id === own.id) : undefined;

  let chosen: Fleet | undefined;
  const receiver = (): Fleet => (chosen ??= pick());
  const named = own !== null && !own.detached;
  const pick = (): Fleet => {
    if (scoped) return scoped;
    const senior = mine.find((f) => f.kind === 'line');
    if (own) {
      // A detachment rejoins the senior fleet where it lands; a named fleet
      // stands as itself.
      if (own.detached && senior) return senior;
      const raised: Fleet = { id: own.id, factionId, kind: own.kind ?? 'line', number: own.number, name: own.name ?? null, stack: {}, commanderId: own.commanderId ?? null };
      system.fleets.push(raised);
      mine.push(raised);
      return raised;
    }
    if (senior) return senior;
    const raised: Fleet = { id: '', factionId, kind: 'line', number: 0, name: null, stack: {}, commanderId: null };
    system.fleets.push(raised);
    mine.push(raised);
    return raised;
  };

  for (const hull of HULL_CLASSES) {
    if (hull === 'courier') continue;
    const delta = (next[hull] ?? 0) - (current[hull] ?? 0);
    if (delta > 0 && isSolo(hull) && !scoped && !named) {
      // Built, or come in unnamed: each stands as a fleet of its own.
      for (let i = 0; i < delta; i++) {
        const solo: Fleet = { id: '', factionId, kind: hull, number: 0, name: null, stack: { [hull]: 1 }, commanderId: null };
        system.fleets.push(solo);
        mine.push(solo);
      }
    } else if (delta > 0) {
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

/** What a power's fleets at a world hold, couriers aside: the navy the index counts. */
function navyAt(system: Holds, factionId: string): ShipStack {
  const sum = fleetsAt(system, factionId).reduce<ShipStack>((s, f) => mergeStacks(s, f.stack), {});
  return normaliseStack({ ...sum, courier: 0 });
}

/** Rewrite one power's entry in the index from its fleets there. Couriers are not in it. */
export function reindex(system: Holds & { fleets: Fleet[] }, factionId: string): void {
  const sum = navyAt(system, factionId);
  if (hullsIn(sum) === 0) delete system.ships[factionId];
  else system.ships[factionId] = sum;
}

/* ---------------- numbering, names and finding one ---------------- */

/** Every number a power's fleets of one kind are using, at worlds and under way. */
export function numbersInUse(
  state: { systems: Holds[]; pendingOrders: { factionId: string; fleet?: FleetTagInput | undefined }[] },
  factionId: string,
  kind: FleetKind = 'line',
): Set<number> {
  const used = new Set<number>();
  for (const s of state.systems) for (const f of s.fleets ?? []) if (f.factionId === factionId && f.number > 0 && f.kind === kind) used.add(f.number);
  for (const o of state.pendingOrders) if (o.factionId === factionId && o.fleet && (o.fleet.kind ?? 'line') === kind) used.add(o.fleet.number);
  return used;
}

export function lowestFree(used: Set<number>): number {
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export const fleetIdFor = (factionId: string, number: number, kind: FleetKind = 'line'): string =>
  kind === 'line' ? `flt-${factionId}-${number}` : `flt-${factionId}-${kind}-${number}`;

/**
 * After every batch and tick: number what the accessors raised, drop empty
 * fleets, put each world's list in a fixed order and its stacks in canonical
 * key order — `verifyReplay` compares strings, so a fleet's shape must be a
 * function of what is in it, not of how it was assembled.
 */
export function settleFleets(state: {
  systems: (Holds & { id: string })[];
  pendingOrders: { factionId: string; fleet?: FleetTagInput | undefined }[];
}): void {
  const used = new Map<string, Set<number>>();
  const usedBy = (f: string, kind: FleetKind) => {
    let u = used.get(`${f}:${kind}`);
    if (!u) used.set(`${f}:${kind}`, (u = numbersInUse(state, f, kind)));
    return u;
  };
  for (const system of [...state.systems].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!fleetMode(system)) continue;
    system.fleets = system.fleets
      .filter((f) => hullsIn(f.stack) > 0)
      .map((f) => {
        if (f.number > 0) return FleetSchema.parse({ ...f, stack: normaliseStack(f.stack) });
        // A fleet is numbered as what it is when it is first numbered: a split
        // that takes only listeners is a listener.
        const kind = kindOf(f.stack);
        const u = usedBy(f.factionId, kind);
        const number = lowestFree(u);
        u.add(number);
        return FleetSchema.parse({ ...f, id: fleetIdFor(f.factionId, number, kind), kind, number, stack: normaliseStack(f.stack) });
      })
      .sort(
        (a, b) =>
          a.factionId.localeCompare(b.factionId) || FLEET_KINDS.indexOf(a.kind) - FLEET_KINDS.indexOf(b.kind) || a.number - b.number,
      );
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

/**
 * What a single-vessel fleet is called by default, in its power's own voice as
 * its warfleets are: the Authority's analysts and contract haulers, the
 * Remnant's pickets and tenders, the Family's ears and spice runs, the Drift's
 * lanewatch and stonehaulers, and the Confederacy's hounds and prize crews. A
 * power not listed takes the plain form.
 */
const KIND_STYLE: Record<string, Partial<Record<Exclude<FleetKind, 'line'>, string>>> = {
  meridian: { listener: 'Market Watch', freighter: 'Contract Hauler' },
  vigil: { listener: 'Signals Picket', freighter: 'Fleet Tender' },
  ojjul: { listener: 'Ear of the Family', freighter: 'Spice Hauler' },
  freeworlds: { listener: 'Lanewatch', freighter: 'Stonehauler' },
  drajk: { listener: 'Scenthound', freighter: 'Prize Hauler' },
};
const PLAIN_KIND: Record<Exclude<FleetKind, 'line'>, string> = {
  listener: 'Listener',
  freighter: 'Freighter',
  courier: 'Courier',
};

/** A fleet's name: what its power called it, or the default for its kind and number. */
export function fleetName(factionId: string, fleet: { number: number; name?: string | null; kind?: FleetKind }): string {
  if (fleet.name) return fleet.name;
  if (fleet.number === 0) return 'a new fleet';
  const kind = fleet.kind ?? 'line';
  if (kind !== 'line') return `${KIND_STYLE[factionId]?.[kind] ?? PLAIN_KIND[kind]} ${fleet.number}`;
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
export function resolveFleet<F extends { id: string; factionId: string; number: number; name?: string | null; kind?: FleetKind }>(
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
    // A bare number names a warfleet first: "the 3rd" is the 3rd Battle
    // Squadron, not Ear of the Family 3, which is named by its kind.
    const line = fleets.filter((f) => f.number === n && (f.kind ?? 'line') === 'line');
    if (line.length === 1) return line[0]!;
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
      const held = navyAt(system, factionId);
      const index = normaliseStack({ ...(system.ships[factionId] ?? {}), courier: 0 });
      if (HULL_CLASSES.some((h) => (held[h] ?? 0) !== (index[h] ?? 0))) writeFleets(system, factionId, index);
    }
  }
}

/**
 * Every officer standing at a world who commands no fleet there keeps a
 * courier: a one-ship fleet of nominal weight that they command, which carries
 * them when they travel alone (`move_officer`). It is raised where they stand
 * and goes when they take command of a fleet, sail, fall or are taken; it is
 * the officer's passage rather than the navy's, so it is never in the index —
 * it contests no income, holds no orbit, is billed nothing and draws no upkeep
 * (`navyTons`). Under way it is the order's `force`, and is fought on arrival
 * like any fleet. Run after `settleCommand`, before `settleFleets` numbers it.
 */
export function settleCouriers(state: {
  systems: (Holds & { id: string })[];
  commanders?: { id: string; factionId: string; status: string; atSystemId: string | null; name: string }[] | undefined;
}): void {
  const standing = (state.commanders ?? []).filter((c) => c.status === 'active' && c.atSystemId !== null);
  for (const system of state.systems) {
    if (!fleetMode(system)) continue;
    const here = standing.filter((c) => c.atSystemId === system.id);
    const commanding = new Set(system.fleets.filter((f) => f.kind !== 'courier' && f.commanderId).map((f) => f.commanderId!));
    const owed = new Map(here.filter((c) => !commanding.has(c.id)).map((c) => [c.id, c] as const));
    const kept = new Set<string>();
    system.fleets = system.fleets.filter((f) => {
      if (f.kind !== 'courier') return true;
      const officer = f.commanderId ? owed.get(f.commanderId) : undefined;
      if (!officer || officer.factionId !== f.factionId || kept.has(officer.id)) return false;
      kept.add(officer.id);
      f.stack = { courier: 1 };
      return true;
    });
    for (const officer of owed.values()) {
      if (kept.has(officer.id)) continue;
      system.fleets.push({
        id: '',
        factionId: officer.factionId,
        kind: 'courier',
        number: 0,
        name: `courier of ${officer.name}`.slice(0, 60),
        stack: { courier: 1 },
        commanderId: officer.id,
      });
    }
  }
}
