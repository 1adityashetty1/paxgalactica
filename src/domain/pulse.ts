import { rollD20 } from './checks.js';
import {
  ENVOYS_QUIET_TURNS,
  MUTINY_DISSENT,
  RIM_EVENT_KINDS,
  RIM_EVENT_RATE,
  RIM_EVENT_WEIGHT,
  RIM_KIND_COOLDOWN,
  RIM_POWER_COOLDOWN,
  SHORTAGE_KINDS,
  STORM_MAX_TURNS,
  shortageFactor,
  stormbound,
  type RimEventKind,
} from './events.js';
import { buildAdjacency } from './graph.js';
import {
  dispositionBetween,
  fleetBases,
  fleetTonsOf,
  hullsAt,
  ledgersFor,
  systemIncome,
  tonsAt,
  warsFor,
  type WorldState,
} from './state.js';
import { tradeRoutes } from './trade.js';

/**
 * The pulse: whether the Rim does something this turn, and what (item 124).
 *
 * The EU4/CK3 shape — a weighted pool of events whose conditions are true right
 * now, with cooldowns — built from the same parts the compulsion triggers are:
 * pure predicates on state, plus a seeded pick. Nothing here changes the world.
 * It returns a plan, and the reducer carries it out, because doing it IS
 * changing the world and that has one home.
 *
 * Two draws, never ten independent chances. A d20 decides WHETHER (11 or better
 * at a rate of 0.5 — exactly one in two, since the die is uniform), and a
 * 400-value draw decides WHICH among the kinds currently eligible, by weight,
 * renormalised over that set. Independent chances would allow two events in one
 * turn and let the rate drift as eligibility moved.
 */

/** What an event will do, settled before anything is done. */
export type RimEventPlan =
  | { kind: 'ion_storm'; systemId: string; turns: number }
  | {
      kind: 'derelict';
      factionId: string;
      systemId: string;
      find: 'salvage' | 'blueprints' | 'crew';
      /** Whose crew is aboard, when it is a crew. */
      crewOf: string | null;
    }
  | { kind: 'unrest'; factionId: string; systemId: string }
  | { kind: 'border_incident'; factionIds: [string, string]; systemId: string }
  | { kind: 'shortage'; assetKind: string }
  | { kind: 'mutiny'; factionId: string }
  | { kind: 'rich_seam'; factionId: string; systemId: string }
  | { kind: 'volunteers'; factionId: string; systemId: string }
  | { kind: 'free_captains'; factionId: string; systemId: string }
  | { kind: 'envoys_of_peace'; factionIds: [string, string]; quietFor: number };

interface Candidate {
  /** Relative, within its kind. */
  weight: number;
  /** Who it would single out, for the per-power cooldown. */
  subjects: string[];
  plan: RimEventPlan;
}

/** 0–399, off two rolls — the granularity `commanderArchetype` uses. */
function draw400(turn: number, salt: string): number {
  return (rollD20(turn, `${salt}:hi`) - 1) * 20 + (rollD20(turn, `${salt}:lo`) - 1);
}

/** Pick in proportion to weight. Order is the caller's, and must be stable. */
function weighted<T>(items: readonly T[], weightOf: (t: T) => number, draw: number): T | undefined {
  const total = items.reduce((n, t) => n + weightOf(t), 0);
  if (total <= 0) return undefined;
  let x = (draw / 400) * total;
  for (const t of items) {
    const w = weightOf(t);
    if (x < w) return t;
    x -= w;
  }
  return items[items.length - 1];
}

/** The key `lastClash` is written under. */
export function clashKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Worlds in id order, so every walk below is the same walk on replay. */
function worlds(state: WorldState) {
  return [...state.systems].sort((a, b) => a.id.localeCompare(b.id));
}
function powers(state: WorldState) {
  return [...state.factions].sort((a, b) => a.id.localeCompare(b.id));
}

/** Every candidate for one kind, before cooldowns. */
function candidatesFor(state: WorldState, kind: RimEventKind): Candidate[] {
  const turn = state.turn;
  switch (kind) {
    case 'ion_storm': {
      // Toward high-traffic lanes: a world is weighted by the volume of every
      // route that crosses it, endpoints included.
      const traffic = new Map<string, number>();
      for (const route of tradeRoutes(state)) {
        for (const id of route.path) traffic.set(id, (traffic.get(id) ?? 0) + route.volume);
      }
      const r = rollD20(turn, 'rim:storm-length');
      const turns = 1 + ((r - 1) % STORM_MAX_TURNS);
      return worlds(state)
        .filter((s) => (traffic.get(s.id) ?? 0) > 0 && !stormbound(state, s.id))
        .map((s) => ({
          weight: traffic.get(s.id)!,
          subjects: [],
          plan: { kind, systemId: s.id, turns },
        }));
    }

    case 'derelict': {
      // Whoever is out in the lawless middle: ships over a world nobody holds,
      // weighted by how much of them is there to go looking.
      const r = rollD20(turn, 'rim:derelict-find');
      const find = r <= 8 ? 'salvage' : r <= 14 ? 'blueprints' : 'crew';
      const out: Candidate[] = [];
      for (const s of worlds(state)) {
        if (s.controllerFactionId !== null) continue;
        for (const f of powers(state)) {
          const tons = tonsAt(s, f.id);
          if (tons <= 0) continue;
          const others = powers(state).filter((o) => o.id !== f.id);
          const crewOf =
            find === 'crew' && others.length > 0
              ? others[(rollD20(turn, `rim:derelict-crew:${f.id}`) - 1) % others.length]!.id
              : null;
          out.push({
            weight: tons,
            subjects: [f.id],
            plan: { kind, factionId: f.id, systemId: s.id, find, crewOf },
          });
        }
      }
      return out;
    }

    case 'unrest': {
      // A world held that was never the holder's, weighted by the occupation it
      // is paying for — `OCCUPATION_COST` is a fraction of what the world pays
      // its holder, so weighting by that income is weighting by the cost.
      return worlds(state)
        .filter(
          (s) =>
            s.controllerFactionId !== null &&
            s.homeFactionId !== null &&
            s.homeFactionId !== s.controllerFactionId,
        )
        .map((s) => ({
          weight: Math.max(1, systemIncome(state, s).shares[s.controllerFactionId!] ?? 0),
          subjects: [s.controllerFactionId!],
          plan: { kind, factionId: s.controllerFactionId!, systemId: s.id },
        }));
    }

    case 'border_incident': {
      // Two powers with ships within a jump of each other, weighted toward
      // pairs already cool: a friendly pair's weight bottoms out at 1 and a pair
      // at war weighs over a hundred times as much.
      const adj = buildAdjacency(state.systems);
      const out: Candidate[] = [];
      const ps = powers(state);
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i]!.id;
          const b = ps[j]!.id;
          const near = worlds(state).find(
            (x) =>
              hullsAt(x, a) > 0 &&
              (hullsAt(x, b) > 0 ||
                [...(adj.get(x.id) ?? [])].some((y) => {
                  const other = state.systems.find((s) => s.id === y);
                  return other !== undefined && hullsAt(other, b) > 0;
                })),
          );
          if (!near) continue;
          const cool = (dispositionBetween(state, a, b) + dispositionBetween(state, b, a)) / 2;
          out.push({
            weight: Math.max(1, 60 - cool),
            subjects: [a, b],
            plan: { kind, factionIds: [a, b], systemId: near.id },
          });
        }
      }
      return out;
    }

    case 'shortage': {
      // A kind of goods somebody holds and somebody else wants, weighted by how
      // many powers want it — a shortage with one buyer is a haggle, not a
      // market.
      const out: Candidate[] = [];
      for (const kindOf of SHORTAGE_KINDS) {
        if (shortageFactor(state, kindOf) !== 1) continue;
        const held = (state.assets ?? []).filter((a) => a.kind === kindOf && a.quantity > 0);
        if (held.length === 0) continue;
        const buyers = new Set<string>();
        for (const a of held) {
          for (const [id, v] of Object.entries(a.valuePerUnit)) if (v > 0 && id !== a.heldBy) buyers.add(id);
          for (const [id, band] of Object.entries(a.valueRange)) if (band.max > 0 && id !== a.heldBy) buyers.add(id);
        }
        if (buyers.size === 0) continue;
        out.push({ weight: buyers.size, subjects: [], plan: { kind, assetKind: kindOf } });
      }
      return out;
    }

    case 'mutiny':
      return powers(state)
        .filter((f) => f.dissent >= MUTINY_DISSENT && fleetTonsOf(state, f.id) > 0)
        .map((f) => ({ weight: f.dissent, subjects: [f.id], plan: { kind, factionId: f.id } }));

    case 'rich_seam': {
      // Toward the poorest net. The richest power keeps a floor of weight so it
      // is not impossible, only unlikely; each world within a power is weighted
      // by what it pays, so the flat list is (power × share of its income).
      const ledgers = ledgersFor(state);
      const nets = powers(state).map((f) => ledgers[f.id]?.net ?? 0);
      const top = Math.max(...nets);
      const out: Candidate[] = [];
      for (const f of powers(state)) {
        const held = worlds(state)
          .filter((s) => s.controllerFactionId === f.id)
          .map((s) => ({ s, pays: systemIncome(state, s).shares[f.id] ?? 0 }))
          .filter((w) => w.pays > 0);
        const total = held.reduce((n, w) => n + w.pays, 0);
        if (total <= 0) continue;
        const need = Math.max(1, top - (ledgers[f.id]?.net ?? 0) + 25);
        for (const w of held) {
          out.push({
            weight: (need * w.pays) / total,
            subjects: [f.id],
            plan: { kind, factionId: f.id, systemId: w.s.id },
          });
        }
      }
      return out;
    }

    case 'volunteers': {
      // A garrison below its ceiling, weighted toward a world with a rival in
      // orbit or one jump out — people come forward when they can see why.
      const adj = buildAdjacency(state.systems);
      return worlds(state)
        .filter((s) => s.controllerFactionId !== null && s.garrison < s.garrisonMax)
        .map((s) => {
          const holder = s.controllerFactionId!;
          const around = [s.id, ...(adj.get(s.id) ?? [])];
          const threatened = around.some((id) => {
            const x = state.systems.find((y) => y.id === id);
            return x !== undefined && Object.keys(x.ships).some((f) => f !== holder && hullsAt(x, f) > 0);
          });
          return {
            weight: threatened ? 5 : 1,
            subjects: [holder],
            plan: { kind, factionId: holder, systemId: s.id },
          };
        });
    }

    case 'free_captains': {
      // Toward the smallest fleet, with a floor so the largest can still be
      // joined. They sign on at the power's best world, the one `fleetBases`
      // would base a new squadron at.
      const tons = powers(state).map((f) => fleetTonsOf(state, f.id));
      const top = Math.max(...tons);
      const out: Candidate[] = [];
      for (const f of powers(state)) {
        const home = fleetBases(state, f.id).find((s) => s.controllerFactionId === f.id);
        if (!home) continue;
        out.push({
          weight: Math.max(1, top - fleetTonsOf(state, f.id) + 20),
          subjects: [f.id],
          plan: { kind, factionId: f.id, systemId: home.id },
        });
      }
      return out;
    }

    case 'envoys_of_peace': {
      // A war that has gone quiet: no battle between the pair for a while,
      // weighted by how long. `lastClash` absent means they never fought.
      const out: Candidate[] = [];
      const ps = powers(state);
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i]!.id;
          const b = ps[j]!.id;
          if (!warsFor(state, a).includes(b)) continue;
          const quietFor = turn - (state.lastClash?.[clashKey(a, b)] ?? 0);
          if (quietFor < ENVOYS_QUIET_TURNS) continue;
          out.push({
            weight: quietFor,
            subjects: [a, b],
            plan: { kind, factionIds: [a, b], quietFor },
          });
        }
      }
      return out;
    }
  }
}

/**
 * The kinds eligible right now, each with its candidates, after both
 * cooldowns. Exported so a test can see the pool without rolling.
 */
export function eligibleRimEvents(state: WorldState): { kind: RimEventKind; candidates: Candidate[] }[] {
  const history = state.rimEvents ?? [];
  const recentKinds = new Set(
    history.filter((e) => e.turn > state.turn - RIM_KIND_COOLDOWN).map((e) => e.kind),
  );
  const recentPowers = new Set(
    history.filter((e) => e.turn > state.turn - RIM_POWER_COOLDOWN).flatMap((e) => e.factionIds),
  );
  return RIM_EVENT_KINDS.filter((k) => !recentKinds.has(k))
    .map((kind) => ({
      kind,
      candidates: candidatesFor(state, kind).filter(
        (c) => c.weight > 0 && c.subjects.every((id) => !recentPowers.has(id)),
      ),
    }))
    .filter((e) => e.candidates.length > 0);
}

/** Whether this turn's d20 calls for an event: 11+ at a rate of 0.5. */
export function rimEventFires(turn: number): boolean {
  return rollD20(turn, 'rim:fires') > 20 - Math.round(20 * RIM_EVENT_RATE);
}

/**
 * This turn's event, or null. Pure: the same board on the same turn draws the
 * same event, which is all replay needs.
 */
export function drawRimEvent(state: WorldState): RimEventPlan | null {
  if (!rimEventFires(state.turn)) return null;
  const pool = eligibleRimEvents(state);
  const chosen = weighted(pool, (e) => RIM_EVENT_WEIGHT[e.kind], draw400(state.turn, 'rim:which'));
  if (!chosen) return null;
  const target = weighted(chosen.candidates, (c) => c.weight, draw400(state.turn, 'rim:where'));
  return target?.plan ?? null;
}
