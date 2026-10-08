import { RIM_STOCK, drawPerson, familiesInUse } from './command.js';
import {
  BITTER,
  ESTATE_SHEETS,
  FAVOURED,
  NOTABLE_REGARD,
  driftToward,
  favourModifier,
  GRANT_COST,
  GRANT_FAVOUR,
  HATED_SEAT_FAVOUR,
  HUB_SEATS,
  MAX_GRANTS,
  RESENTFUL,
  SEAT_FAVOUR,
  WITHHOLD_SHARE,
  NotableSchema,
  estateOwner,
  type Estate,
  type Notable,
} from './estates.js';
import { CONTENT_REGARD, regardFor, regardRecorded } from './regard.js';
import { HUB_THRESHOLD } from './trade.js';
import { WORLD_TYPE_STAT, systemIncome, type Faction, type StarSystem, type WorldState } from './state.js';

/**
 * Seats, notables and estates read off the whole world.
 * `docs/design-2026-10-07-seats.md`.
 *
 * Every world has a seat, a hub two, and every seat a notable. A notable
 * belongs to one of its holder's estates — or to an old holder's, while the
 * world is a conquest nobody has reseated, or to none on a world nobody holds —
 * and does on its world what that estate's favour says. Favour drifts toward a
 * baseline of seats held against a fair share and grants paid.
 *
 * Nothing here mutates but the three helpers that say so (`seatNotable`,
 * `fillSeats`, `onWorldChangesHands`); the tick and the reducer call them.
 */

/** Whether this campaign keeps estates at all — false for a journal from before version 20. */
export function courtRecorded(state: { factions: readonly Faction[] }): boolean {
  return state.factions.some((f) => (f.estates?.length ?? 0) > 0);
}

/** How many seats a world carries: two on a hub, one elsewhere. */
export function seatsFor(system: StarSystem): number {
  return system.strategicValue >= HUB_THRESHOLD ? HUB_SEATS : 1;
}

/** The notables seated on a world, in the order they were seated. */
export function seatedAt(state: WorldState, systemId: string): Notable[] {
  return (state.notables ?? []).filter((n) => n.systemId === systemId);
}

export function notableById(state: WorldState, id: string | null | undefined): Notable | undefined {
  return id ? (state.notables ?? []).find((n) => n.id === id) : undefined;
}

/** An estate and the power it belongs to. */
export function estateById(state: WorldState, estateId: string | null | undefined): { faction: Faction; estate: Estate } | null {
  if (!estateId) return null;
  const faction = state.factions.find((f) => f.id === estateOwner(estateId));
  const estate = faction?.estates?.find((e) => e.id === estateId);
  return faction && estate ? { faction, estate } : null;
}

/** The power a notable serves: its estate's, or nobody's. */
export function powerOf(notable: Notable): string | null {
  return notable.estateId ? estateOwner(notable.estateId) : null;
}

/**
 * One of a power's estates by its id or by what a person would call it —
 * *"the Blue Bloods"*, *"blue bloods"*, *"Standards and Practices"*.
 */
export function findEstate(faction: Faction, query: string): Estate | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]+/g, '');
  const q = norm(query);
  return (faction.estates ?? []).find((e) => e.id === query || norm(e.name) === q || norm(e.id.split(':')[1] ?? '') === q);
}

/** Seats an estate holds anywhere — a foreign seat on a world it lost included. Held notables sit nowhere. */
export function seatsOf(state: WorldState, estateId: string): number {
  return (state.notables ?? []).filter((n) => n.estateId === estateId && n.systemId !== null).length;
}

/** Every seat a power's estates hold. A third of it is each estate's fair share. */
export function powerSeats(state: WorldState, factionId: string): number {
  return (state.notables ?? []).filter((n) => n.systemId !== null && n.estateId !== null && estateOwner(n.estateId) === factionId)
    .length;
}

/**
 * Seats of this estate on worlds its own power holds that are not content with
 * it. An estate does not enjoy holding a world down for you. A foreign seat is
 * not one: that estate is not the one holding the world down.
 */
export function hatedSeats(state: WorldState, estateId: string): number {
  if (!regardRecorded(state)) return 0;
  const owner = estateOwner(estateId);
  let n = 0;
  for (const notable of state.notables ?? []) {
    if (notable.estateId !== estateId || notable.systemId === null) continue;
    const world = state.systems.find((s) => s.id === notable.systemId);
    if (!world || world.controllerFactionId !== owner) continue;
    if (regardFor(world, owner) < CONTENT_REGARD) n += 1;
  }
  return n;
}

/** Notables of this estate married to someone outside their own power — a grant paid in alliance. */
export function marriagesAbroad(state: WorldState, estateId: string): number {
  const owner = estateOwner(estateId);
  let n = 0;
  for (const notable of state.notables ?? []) {
    if (notable.estateId !== estateId || !notable.spouseId) continue;
    const spouse = notableById(state, notable.spouseId);
    if (spouse && powerOf(spouse) !== owner) n += 1;
  }
  return n;
}

/** Grants an estate holds, stipends and marriages together, capped at `MAX_GRANTS`. */
export function grantsOf(state: WorldState, estate: Estate): number {
  return Math.min(MAX_GRANTS, estate.stipends + marriagesAbroad(state, estate.id));
}

export interface FavourBaseline {
  seats: number;
  fairShare: number;
  grants: number;
  hated: number;
  /** Where favour is drifting. */
  baseline: number;
}

/** Where an estate's favour drifts, and why. */
export function favourBaseline(state: WorldState, estate: Estate): FavourBaseline {
  const owner = estateOwner(estate.id);
  const faction = state.factions.find((f) => f.id === owner);
  const estates = Math.max(1, faction?.estates?.length ?? 3);
  const seats = seatsOf(state, estate.id);
  const fairShare = powerSeats(state, owner) / estates;
  const grants = grantsOf(state, estate);
  const hated = hatedSeats(state, estate.id);
  const raw = SEAT_FAVOUR * (seats - fairShare) + GRANT_FAVOUR * grants - HATED_SEAT_FAVOUR * hated;
  return { seats, fairShare, grants, hated, baseline: Math.max(-100, Math.min(100, Math.round(raw))) };
}

/** What a power pays its estates in stipends, a turn. */
export function stipendCostFor(state: WorldState, factionId: string): number {
  const faction = state.factions.find((f) => f.id === factionId);
  return (faction?.estates ?? []).reduce((n, e) => n + e.stipends, 0) * GRANT_COST;
}

/**
 * The favour a seated notable acts on, for whoever holds its world — or `null`
 * where it does nothing: a notable held abroad, or one on a world nobody holds.
 *
 * - its own power's notable acts on its estate's favour;
 * - a **foreign** notable, of an estate whose power lost the world, acts as an
 *   estate at `RESENTFUL` does — unless it is married to the holder's people,
 *   when it acts at 0: a spouse never works against the in-laws.
 */
export function actingFavour(state: WorldState, notable: Notable): number | null {
  if (notable.systemId === null || notable.estateId === null) return null;
  const world = state.systems.find((s) => s.id === notable.systemId);
  const holder = world?.controllerFactionId ?? null;
  if (holder === null) return null;
  const owner = estateOwner(notable.estateId);
  if (owner !== holder) {
    const spouse = notableById(state, notable.spouseId);
    return spouse && powerOf(spouse) === holder ? 0 : RESENTFUL;
  }
  return estateById(state, notable.estateId)?.estate.favour ?? 0;
}

/** Whether a notable lifts its world this turn. */
export const lifts = (favour: number | null): boolean => favour !== null && favour >= FAVOURED;
/** Whether a notable withholds and sours. */
export const withholds = (favour: number | null): boolean => favour !== null && favour <= RESENTFUL;

/**
 * The income a power's resentful notables keep back from it, a turn: half a
 * world's share for a world with one seat, a quarter for each of a hub's two.
 * Lost to everyone — a notable who will not collect for you is not collecting
 * for themselves.
 */
export function withheldFor(state: WorldState, factionId: string): number {
  if (!courtRecorded(state)) return 0;
  let withheld = 0;
  for (const world of state.systems) {
    if (world.controllerFactionId !== factionId) continue;
    const seated = seatedAt(state, world.id);
    if (seated.length === 0) continue;
    const sour = seated.filter((n) => withholds(actingFavour(state, n))).length;
    if (sour === 0) continue;
    const share = systemIncome(state, world).shares[factionId] ?? 0;
    withheld += (share * WITHHOLD_SHARE * sour) / seated.length;
  }
  return Math.round(withheld);
}

/**
 * The estate a seat goes to when nobody chooses: the one whose stat is the
 * world's ground stat, legible from the map; otherwise — ground of one of the
 * power's peaks, which no estate stands behind, or a hub whose ground estate
 * already sits it — the estate with the fewest seats, the first on the sheet
 * breaking a tie.
 */
export function defaultEstate(state: WorldState, factionId: string, world: StarSystem): Estate | null {
  const estates = state.factions.find((f) => f.id === factionId)?.estates ?? [];
  if (estates.length === 0) return null;
  const ground = WORLD_TYPE_STAT[world.worldType];
  const here = new Set(seatedAt(state, world.id).map((n) => n.estateId));
  const byGround = estates.find((e) => e.stat === ground);
  if (byGround && !here.has(byGround.id)) return byGround;
  let best: Estate | null = null;
  let fewest = Infinity;
  for (const e of estates) {
    const n = seatsOf(state, e.id);
    if (n < fewest) {
      fewest = n;
      best = e;
    }
  }
  return best;
}

/**
 * Seat a new notable — of an estate, or of nobody on an independent world.
 * Named as officers and operatives are, with a family name nobody else in the
 * campaign has carried, and given an id off that name so it can never recur.
 */
export function seatNotable(
  state: WorldState,
  estateId: string | null,
  systemId: string | null,
  salt: string,
): Notable {
  const owner = estateId ? estateOwner(estateId) : RIM_STOCK;
  const { name, family } = drawPerson({
    factionId: ESTATE_SHEETS[owner] ? owner : RIM_STOCK,
    turn: state.turn,
    salt: `notable:${salt}`,
    archetype: null,
    taken: familiesInUse(state),
  });
  (state.familiesUsed ??= []).push(family);
  const notable = NotableSchema.parse({
    id: `nob-${family.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
    name,
    estateId,
    systemId,
  });
  (state.notables ??= []).push(notable);
  return notable;
}

/**
 * Fill every empty seat, world by world in board order: a held world's for
 * its holder's default estate, an independent world's with a notable of its
 * own. A world that has become a hub gains its second seat here; one that has
 * fallen below keeps the seats it has. Returns the notables seated.
 */
export function fillSeats(state: WorldState): Notable[] {
  const seated: Notable[] = [];
  for (const world of state.systems) {
    let k = seatedAt(state, world.id).length;
    while (k < seatsFor(world)) {
      const holder = world.controllerFactionId;
      const estate = holder ? defaultEstate(state, holder, world) : null;
      if (holder && !estate) break;
      seated.push(seatNotable(state, estate?.id ?? null, world.id, `${world.id}:${state.turn}:${k}`));
      k += 1;
    }
  }
  return seated;
}

/** Undo a marriage from both sides. */
export function unmarry(state: WorldState, notable: Notable): void {
  const spouse = notableById(state, notable.spouseId);
  if (spouse) spouse.spouseId = null;
  notable.spouseId = null;
}

/** Take a notable off the board entirely: dismissed, released or killed. */
export function removeNotable(state: WorldState, notable: Notable): void {
  unmarry(state, notable);
  state.notables = (state.notables ?? []).filter((n) => n.id !== notable.id);
}

export type HandsChange = 'conquest' | 'cession' | 'secession' | 'joining';

/**
 * What a world changing hands does to its seats. Called after the holder has
 * changed, with who held it before.
 *
 * - **conquest or cession of a power's world**: nothing moves. Its notable is
 *   now a foreign notable, read off the mismatch between its estate and the
 *   holder — and a liberation undoes that the same way.
 * - **conquest or cession of an independent world**: its notable has no power
 *   behind it, so it is released, and the seat filled for the new holder.
 * - **secession**: the notables stay and belong to no estate.
 * - **joining**: the independent notable takes the seat for its spouse's
 *   estate if it married into the power, otherwise for the default.
 *
 * Returns a line for the log, or nothing.
 */
export function onWorldChangesHands(
  state: WorldState,
  world: StarSystem,
  before: string | null,
  how: HandsChange,
): string | null {
  if (!courtRecorded(state)) return null;
  const seated = seatedAt(state, world.id);
  const after = world.controllerFactionId;
  if (how === 'secession') {
    for (const n of seated) n.estateId = null;
    return seated.length > 0 ? `${seated.map((n) => n.name).join(' and ')} now speak${seated.length > 1 ? '' : 's'} for ${world.name} alone.` : null;
  }
  if (how === 'joining' && after) {
    const parts: string[] = [];
    for (const n of seated) {
      if (n.estateId !== null) continue;
      const spouse = notableById(state, n.spouseId);
      const viaMarriage = spouse && spouse.estateId && estateOwner(spouse.estateId) === after ? spouse.estateId : null;
      // Off the board while the default is chosen, so it does not count itself.
      n.systemId = null;
      const estate = viaMarriage ? estateById(state, viaMarriage)?.estate : defaultEstate(state, after, world);
      n.systemId = world.id;
      n.estateId = estate?.id ?? null;
      if (estate) parts.push(`${n.name} takes ${world.name}'s seat for ${estate.name}`);
    }
    return parts.length > 0 ? `${parts.join('; ')}.` : null;
  }
  if (before === null && after !== null) {
    const released = seated.filter((n) => n.estateId === null);
    for (const n of released) removeNotable(state, n);
    fillSeats(state);
    return released.length > 0
      ? `${released.map((n) => n.name).join(' and ')} ${released.length > 1 ? 'are' : 'is'} turned out of ${world.name}'s seat; ${nameOf(state, after)} seats its own.`
      : null;
  }
  return null;
}

function nameOf(state: WorldState, factionId: string): string {
  return state.factions.find((f) => f.id === factionId)?.name ?? factionId;
}

/** A line the tick logs: the text, who it is about, and who may read it (`null` is everyone). */
export interface CourtLine {
  text: string;
  factionId: string | null;
  visibleTo: string[] | null;
}

/**
 * What the seated do this turn, read before the estates' favour moves: fill
 * any empty seat, let each notable lift or sour its world, and name the worlds
 * a bitter estate's notable lets go — the caller secedes them, through the
 * rising that exists. Mutates regard in place, as `accrueRegard` does.
 */
export function notablesAct(state: WorldState): { lines: CourtLine[]; letGo: { world: StarSystem; notable: Notable }[] } {
  const lines: CourtLine[] = [];
  const letGo: { world: StarSystem; notable: Notable }[] = [];
  for (const n of fillSeats(state)) {
    const world = state.systems.find((w) => w.id === n.systemId);
    const estate = estateById(state, n.estateId);
    if (world && estate && state.turn > 0) {
      lines.push({
        text: `${n.name} takes a new seat at ${world.name} for ${estate.estate.name}.`,
        factionId: estate.faction.id,
        visibleTo: null,
      });
    }
  }
  if (!regardRecorded(state)) return { lines, letGo };
  for (const world of state.systems) {
    const holder = world.controllerFactionId;
    if (holder === null) continue;
    const seated = seatedAt(state, world.id);
    if (seated.length === 0) continue;
    let push = 0;
    let bitter: Notable | null = null;
    for (const n of seated) {
      const f = actingFavour(state, n);
      if (lifts(f)) push += NOTABLE_REGARD / seated.length;
      else if (withholds(f)) push -= NOTABLE_REGARD / seated.length;
      if (f !== null && f <= BITTER && n.estateId !== null && estateOwner(n.estateId) === holder) bitter ??= n;
    }
    if (push !== 0) {
      const before = regardFor(world, holder);
      world.regard = { ...world.regard, [holder]: Math.max(-100, Math.min(100, Math.round(before + push))) };
    }
    if (bitter && regardFor(world, holder) < CONTENT_REGARD) letGo.push({ world, notable: bitter });
  }
  return { lines, letGo };
}

/**
 * Every estate's favour takes a turn's step toward its baseline. Returns a
 * line, for its own power only, whenever an estate crosses into a new band —
 * the moment its stat moves.
 */
export function driftFavour(state: WorldState): CourtLine[] {
  const lines: CourtLine[] = [];
  const baselines = new Map<string, number>();
  // Every baseline read off the same board before any favour moves, so the
  // order estates are visited in cannot matter.
  for (const faction of state.factions) {
    for (const estate of faction.estates ?? []) baselines.set(estate.id, favourBaseline(state, estate).baseline);
  }
  for (const faction of state.factions) {
    for (const estate of faction.estates ?? []) {
      const was = estate.favour;
      estate.favour = driftToward(was, baselines.get(estate.id) ?? 0);
      const before = favourModifier(was);
      const after = favourModifier(estate.favour);
      if (before === after) continue;
      const sign = (m: number) => (m > 0 ? `+${m}` : `${m}`);
      lines.push({
        text:
          after > before
            ? `${capitalise(estate.name)} warm to ${faction.name}: ${estate.stat} ${sign(after)} (favour ${estate.favour}).`
            : `${capitalise(estate.name)} cool on ${faction.name}: ${estate.stat} ${after === 0 ? 'back to its own' : sign(after)} (favour ${estate.favour}).`,
        factionId: faction.id,
        visibleTo: [faction.id],
      });
    }
  }
  return lines;
}

/** "the Blue Bloods" to "The Blue Bloods", for the start of a sentence. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
