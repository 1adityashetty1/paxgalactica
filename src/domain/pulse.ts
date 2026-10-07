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
  isNotoriety,
  luckWeight,
  shortageFactor,
  stormbound,
  type RimEventKind,
} from './events.js';
import { AgentSchema, BOUNTY_MIN, atWork } from './diplomacy.js';
import { HEAT_MAX, HEAT_NOTORIOUS, NOTORIETY_WEIGHT } from './heat.js';
import { buildAdjacency } from './graph.js';
import {
  dispositionBetween,
  liveAgentsOf,
  maxAgentsFor,
  fleetBases,
  fleetTonsOf,
  hullsAt,
  ledgersFor,
  systemIncome,
  tonsAt,
  warsFor,
  type WorldState,
} from './state.js';
import { routeLegs, tradeRoutes } from './trade.js';
import { CONTENT_REGARD, regardFor, regardRecorded } from './regard.js';

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
  | { kind: 'envoys_of_peace'; factionIds: [string, string]; quietFor: number }
  /** The host of one of the notorious power's operatives takes them. */
  | { kind: 'crackdown'; factionId: string; agentId: string; byFactionId: string; systemId: string }
  /** The merchants of the power that likes it least put a price on it. */
  | { kind: 'bounty_posted'; factionId: string; byFactionId: string; pool: number }
  /** One of its operatives goes over to the power it was working against. */
  | { kind: 'turned_contact'; factionId: string; agentId: string; byFactionId: string; systemId: string }
  /** A power that dislikes it masses ships on the border facing it. */
  | { kind: 'show_of_force'; factionId: string; byFactionId: string; systemId: string; tons: number };

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
      for (const leg of tradeRoutes(state).flatMap(routeLegs)) {
        for (const id of leg.path) traffic.set(id, (traffic.get(id) ?? 0) + leg.volume);
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
      // Where worlds keep a regard (journal version 18), any world not content
      // with its holder can rise — the spark of the rising `regard.ts` drives
      // steadily. Before it, only ground that was never the holder's own.
      const keeps = regardRecorded(state);
      return worlds(state)
        .filter((s) =>
          s.controllerFactionId === null
            ? false
            : keeps
              ? regardFor(s, s.controllerFactionId) < CONTENT_REGARD
              : s.homeFactionId !== null && s.homeFactionId !== s.controllerFactionId,
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

    // --- Notoriety: the Rim answering a power's heat (`heat.ts`). Each
    // candidate is weighted by that heat, and only a power at or past
    // `HEAT_NOTORIOUS` is one.
    case 'crackdown':
    case 'turned_contact': {
      // Its operative at work on the best world somebody else holds.
      const out: Candidate[] = [];
      for (const f of notorious(state)) {
        const exposed = state.agents
          .filter((a) => a.ownerFactionId === f.id && !a.exposed && atWork(a, turn))
          .map((a) => ({ a, host: state.systems.find((x) => x.id === a.systemId) }))
          .filter(({ host }) => host?.controllerFactionId && host.controllerFactionId !== f.id)
          // A contact only turns to a power with room to run them.
          .filter(
            ({ host }) =>
              kind === 'crackdown' ||
              liveAgentsOf(state, host!.controllerFactionId!).length < maxAgentsFor(state, host!.controllerFactionId!),
          )
          .sort((x, y) => y.host!.strategicValue - x.host!.strategicValue || x.a.id.localeCompare(y.a.id))[0];
        if (!exposed) continue;
        out.push({
          weight: f.heat,
          subjects: [f.id],
          plan: {
            kind,
            factionId: f.id,
            agentId: exposed.a.id,
            byFactionId: exposed.host!.controllerFactionId!,
            systemId: exposed.host!.id,
          },
        });
      }
      return out;
    }

    case 'bounty_posted': {
      // Posted by the merchants of whoever likes it least, and sized off what
      // it earns: the price on a rich pirate is a rich price.
      const ledgers = ledgersFor(state);
      const out: Candidate[] = [];
      for (const f of notorious(state)) {
        const by = powers(state)
          .filter((o) => o.id !== f.id)
          .sort((a, b) => dispositionBetween(state, a.id, f.id) - dispositionBetween(state, b.id, f.id) || a.id.localeCompare(b.id))[0];
        if (!by) continue;
        const pool = Math.max(BOUNTY_MIN * 2, Math.round((ledgers[f.id]?.gross ?? 0) * NOTORIETY_BOUNTY_TURNS));
        out.push({ weight: f.heat, subjects: [f.id], plan: { kind, factionId: f.id, byFactionId: by.id, pool } });
      }
      return out;
    }

    case 'show_of_force': {
      // A neighbour that thinks ill of it, with hulls elsewhere to bring up.
      const adj = buildAdjacency(state.systems);
      const out: Candidate[] = [];
      for (const f of notorious(state)) {
        const theirs = new Set(worlds(state).filter((w) => w.controllerFactionId === f.id).map((w) => w.id));
        const border = worlds(state).filter(
          (w) =>
            w.controllerFactionId !== null &&
            w.controllerFactionId !== f.id &&
            [...(adj.get(w.id) ?? [])].some((n) => theirs.has(n)),
        );
        const by = [...new Set(border.map((w) => w.controllerFactionId!))]
          .filter((id) => dispositionBetween(state, id, f.id) <= 0)
          .sort((a, b) => dispositionBetween(state, a, f.id) - dispositionBetween(state, b, f.id) || a.localeCompare(b))
          .find((id) => worlds(state).some((w) => w.controllerFactionId === id && !border.includes(w) && tonsAt(w, id) > 0));
        if (!by) continue;
        const at = border
          .filter((w) => w.controllerFactionId === by)
          .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0]!;
        out.push({ weight: f.heat, subjects: [f.id], plan: { kind, factionId: f.id, byFactionId: by, systemId: at.id, tons: SHOW_OF_FORCE_TONS } });
      }
      return out;
    }
  }
}

/** A bounty the merchants post is this many turns of the notorious power's gross. */
export const NOTORIETY_BOUNTY_TURNS = 1;
/** The most a show of force brings up to the border, in tons — four battleships. */
export const SHOW_OF_FORCE_TONS = 16;

/** Powers hot enough for the Rim to answer, in id order. */
function notorious(state: WorldState) {
  return powers(state).filter((f) => (f.heat ?? 0) >= HEAT_NOTORIOUS);
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
 *
 * `sandbox` is a testing campaign's rule (see `primeRimSandbox`): that one kind,
 * every turn, with no d20 and no cooldowns — and aimed at the player whenever a
 * candidate is, so a power's private event lands where the player can see it.
 */
export function drawRimEvent(state: WorldState, sandbox?: RimEventKind): RimEventPlan | null {
  if (sandbox !== undefined) {
    const all = candidatesFor(state, sandbox).filter((c) => c.weight > 0);
    const mine = all.filter((c) => c.subjects.includes(state.playerFactionId));
    const pool = mine.length > 0 ? mine : all;
    return weighted(pool, (c) => c.weight, draw400(state.turn, 'rim:where'))?.plan ?? null;
  }
  if (!rimEventFires(state.turn)) return null;
  const pool = eligibleRimEvents(state);
  // **Luck reshapes WHICH, never WHETHER.** A candidate counts at its subject's
  // own weight for the kind rather than the galaxy's: `lean` is that ratio,
  // averaged over the powers an event names and 1 for one that names nobody.
  // A kind's weight is the galaxy's scaled by how its candidates lean, and the
  // target is drawn the same way — so a lucky power's favoured event is both
  // likelier to be the turn's event and likelier to land on it.
  //
  // With no luck on the board every lean is exactly 1, the kind weight is
  // exactly `RIM_EVENT_WEIGHT` and the target weight exactly `c.weight`, so the
  // draw is bit-for-bit the one before luck existed.
  const lean = (kind: RimEventKind, c: Candidate): number => {
    // Notoriety is no fortune, so nobody's luck reaches it.
    if (c.subjects.length === 0 || isNotoriety(kind)) return 1;
    const each = c.subjects.map(
      (id) => luckWeight(state.factions.find((f) => f.id === id)?.luck, kind) / RIM_EVENT_WEIGHT[kind],
    );
    return each.reduce((n, x) => n + x, 0) / each.length;
  };
  const kindWeight = (e: { kind: RimEventKind; candidates: Candidate[] }): number => {
    // A notoriety kind weighs `NOTORIETY_WEIGHT` at the threshold, and more
    // the hotter its hottest candidate runs.
    if (isNotoriety(e.kind)) {
      return NOTORIETY_WEIGHT * (Math.max(...e.candidates.map((c) => c.weight)) / HEAT_NOTORIOUS);
    }
    const total = e.candidates.reduce((n, c) => n + c.weight, 0);
    const leaned = e.candidates.reduce((n, c) => n + c.weight * lean(e.kind, c), 0);
    return RIM_EVENT_WEIGHT[e.kind] * (leaned / total);
  };
  const chosen = weighted(pool, kindWeight, draw400(state.turn, 'rim:which'));
  if (!chosen) return null;
  const target = weighted(
    chosen.candidates,
    (c) => c.weight * lean(chosen.kind, c),
    draw400(state.turn, 'rim:where'),
  );
  return target?.plan ?? null;
}

/**
 * Set a fresh board up so one kind of event can happen to the player at once —
 * the other half of a sandbox campaign, which fires only that kind, every
 * turn, for looking at it.
 *
 * Changes to the opening board, not to the rules: an event still has to be
 * eligible, so this makes it eligible. Applied to the seed in `Campaign.start`
 * and again in `replay`, off the journal's seed entry, so a sandbox rebuilds
 * exactly. Some kinds run dry after a few turns — a garrison raised to its
 * ceiling, an occupied world that has slipped — which is the mechanic working.
 */
export function primeRimSandbox(state: WorldState, kind: RimEventKind): WorldState {
  const me = state.playerFactionId;
  const player = state.factions.find((f) => f.id === me)!;
  const adj = buildAdjacency(state.systems);
  const mine = worlds(state).filter((s) => s.controllerFactionId === me);
  const nextToMine = (s: { id: string }) => mine.some((m) => adj.get(m.id)?.has(s.id));
  switch (kind) {
    case 'derelict': {
      // Ships over the nearest ground nobody holds.
      const empty =
        worlds(state).find((s) => s.controllerFactionId === null && nextToMine(s)) ??
        worlds(state).find((s) => s.controllerFactionId === null);
      if (empty) empty.ships[me] = { ...(empty.ships[me] ?? {}), escort: (empty.ships[me]?.escort ?? 0) + 2 };
      break;
    }
    case 'unrest': {
      // Two of a neighbour's home worlds, taken before the campaign began.
      const taken = worlds(state)
        .filter((s) => s.homeFactionId !== null && s.homeFactionId !== me && nextToMine(s))
        .slice(0, 2);
      for (const s of taken) {
        for (const id of Object.keys(s.ships)) if (id !== me) delete s.ships[id];
        s.controllerFactionId = me;
      }
      break;
    }
    case 'mutiny':
      player.dissent = Math.max(player.dissent, 60);
      break;
    case 'volunteers':
      for (const s of mine) s.garrison = 1;
      break;
    case 'shortage': {
      // Every kind of goods on the shelf, so a shortage is always eligible for
      // one while the others run their three turns.
      const at = mine[0];
      if (!at) break;
      const others = Object.fromEntries(state.factions.filter((f) => f.id !== me).map((f) => [f.id, 3]));
      for (const k of ['ore', 'relic'] as const) {
        state.assets.push({
          id: `ast-sandbox-${k}`, kind: k, text: `Sandbox ${k}`, heldBy: me, quantity: 10,
          unit: k === 'ore' ? 'ton' : 'relic', divisible: k === 'ore', valuePerUnit: others,
          speculative: false, valueRange: {}, uses: null, atSystemId: at.id, portable: true,
          yield: null, acquiredTurn: 0, commanderId: null, agentId: null,
        });
      }
      break;
    }
    case 'envoys_of_peace': {
      // A war with a power the player shares no border with, deep enough for
      // several envoys, quiet since before the campaign began.
      const reach = new Set(mine.flatMap((m) => [...(adj.get(m.id) ?? [])]));
      const far =
        powers(state).find(
          (f) => f.id !== me && !worlds(state).some((s) => s.controllerFactionId === f.id && reach.has(s.id)),
        ) ?? powers(state).find((f) => f.id !== me)!;
      player.disposition[far.id] = -95;
      far.disposition[me] = -95;
      state.treaties = state.treaties.filter((t) => !(t.parties.includes(me) && t.parties.includes(far.id)));
      state.lastClash[clashKey(me, far.id)] = -ENVOYS_QUIET_TURNS;
      break;
    }
    case 'crackdown':
    case 'turned_contact':
    case 'bounty_posted':
    case 'show_of_force': {
      // As notorious as a power can be, so the Rim answers every turn until
      // the answers have cooled it.
      player.heat = HEAT_MAX;
      if (kind === 'crackdown' || kind === 'turned_contact') {
        // Operatives already at work on rival worlds, one for each turn the
        // heat lasts, on as many different powers as there are near.
        const rivals = worlds(state)
          .filter((s) => s.controllerFactionId !== null && s.controllerFactionId !== me)
          .sort((a, b) => Number(nextToMine(b)) - Number(nextToMine(a)) || a.id.localeCompare(b.id));
        const hosts = [...new Map(rivals.map((r) => [r.controllerFactionId, r])).values()];
        for (let i = 0; i < 4; i++) {
          const rival = hosts[i % hosts.length];
          if (!rival) break;
          state.agents.push(
            AgentSchema.parse({
              id: `agt-sandbox-${i}`,
              ownerFactionId: me,
              systemId: rival.id,
              mission: 'surveillance',
              effect: { kind: 'intel', revealsOrders: true },
              successChance: 50,
              deployedTurn: 0,
              cover: `a clerk at ${rival.name}`,
            }),
          );
        }
      }
      if (kind === 'show_of_force') {
        // Every neighbour at least cool toward the player.
        for (const f of powers(state)) {
          if (f.id === me) continue;
          if (worlds(state).some((s) => s.controllerFactionId === f.id && nextToMine(s))) {
            f.disposition[me] = Math.min(f.disposition[me] ?? 0, -20);
          }
        }
      }
      break;
    }
    default:
      // A storm, a border incident, a windfall and free captains need nothing.
      break;
  }
  return state;
}
