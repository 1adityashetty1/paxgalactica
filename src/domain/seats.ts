import { OFFICER_LEVERAGE, RIM_STOCK, drawPerson, familiesInUse, resolvePerson } from './command.js';
import { AssetSchema, atWork, isTreatyLive, type Asset, type Treaty } from './diplomacy.js';
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
  NOTABLE_RANSOM,
  RESENTFUL,
  SEAT_FAVOUR,
  SEAT_VACATED_FAVOUR,
  seatOffice,
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
 * Every world has a seat, a hub two — the governor's and the chancellor's. A
 * seat on a power's world is filled from that power's **Lists**, the notables
 * it has waiting, and stays empty until somebody is appointed; an independent
 * world's seats are always filled, with notables of its own. A notable belongs
 * to one of its power's estates, or to none on a world nobody holds, and does
 * on its world what that estate's favour says. Favour drifts toward a baseline
 * of seats held against a fair share and grants paid.
 *
 * A notable is in exactly one place (`whereabouts`): seated, listed, held at
 * another court as an asset, or living on an independent world it married into.
 *
 * Nothing here mutates but the helpers that say so; the tick and the reducer
 * call them.
 */

/** Whether this campaign keeps estates at all — false for a journal from before version 20. */
export function courtRecorded(state: { factions: readonly Faction[] }): boolean {
  return state.factions.some((f) => (f.estates?.length ?? 0) > 0);
}

/** How many seats a world carries: two on a hub, one elsewhere. */
export function seatsFor(system: StarSystem): number {
  return system.strategicValue >= HUB_THRESHOLD ? HUB_SEATS : 1;
}

/** The notables seated on a world, in the order they were seated — not seat order; sort by `seat` to show them. */
export function seatedAt(state: WorldState, systemId: string): Notable[] {
  return (state.notables ?? []).filter((n) => n.systemId === systemId);
}

/** The lowest seat at a world nobody is sitting. */
export function freeSeat(state: WorldState, systemId: string): number {
  const taken = new Set(seatedAt(state, systemId).map((n) => n.seat));
  let k = 0;
  while (taken.has(k)) k += 1;
  return k;
}

export function notableById(state: WorldState, id: string | null | undefined): Notable | undefined {
  return id ? (state.notables ?? []).find((n) => n.id === id) : undefined;
}

export type Whereabouts = 'seated' | 'listed' | 'held' | 'abroad';

/** Where a notable is. Only a seated notable, or one held at a court, is anybody's mark. */
export function whereabouts(state: WorldState, notable: Notable): Whereabouts {
  if (notable.systemId !== null) return 'seated';
  if (heldAs(state, notable.id)) return 'held';
  if (notable.livesAt !== null) return 'abroad';
  return 'listed';
}

/** A power's Lists: its estates' notables waiting for a seat, in the order they were listed. */
export function listsOf(state: WorldState, factionId: string): Notable[] {
  return (state.notables ?? []).filter(
    (n) => n.estateId !== null && estateOwner(n.estateId) === factionId && whereabouts(state, n) === 'listed',
  );
}

/** An estate's notables on the Lists. */
export function listedFor(state: WorldState, estateId: string): Notable[] {
  return (state.notables ?? []).filter((n) => n.estateId === estateId && whereabouts(state, n) === 'listed');
}

/** The seats on a world nobody sits, lowest first: a governor's is 0, a hub's chancellor's 1. */
export function emptySeats(state: WorldState, world: StarSystem): number[] {
  const taken = new Set(seatedAt(state, world.id).map((n) => n.seat));
  const empty: number[] = [];
  for (let k = 0; k < seatsFor(world); k++) if (!taken.has(k)) empty.push(k);
  return empty;
}

/**
 * Seat someone off the Lists, in a given seat. The caller has cleared it. A
 * notable on the Lists sits nowhere, so this only places them.
 */
export function appoint(notable: Notable, world: StarSystem, seat: number): void {
  notable.systemId = world.id;
  notable.livesAt = null;
  notable.seat = seat;
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
  const favour = estateById(state, notable.estateId)?.estate.favour ?? 0;
  // A rival's subversion turns this one notable, whatever the estate thinks:
  // a local threat, not a lever on the whole estate.
  return isTurned(state, notable) ? Math.min(favour, RESENTFUL) : favour;
}

/** Whether a rival's operative is at work turning this notable against their holder. */
export function isTurned(state: WorldState, notable: Notable): boolean {
  const holder = state.systems.find((s) => s.id === notable.systemId)?.controllerFactionId ?? null;
  return (state.agents ?? []).some(
    (a) =>
      atWork(a, state.turn) &&
      a.effect.kind === 'turn_notable' &&
      a.targetNotableId === notable.id &&
      a.systemId === notable.systemId &&
      a.ownerFactionId !== holder,
  );
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
    withheld += (share * WITHHOLD_SHARE * sour) / seatsFor(world);
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
  seat?: number,
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
    seat: seat ?? (systemId ? freeSeat(state, systemId) : 0),
  });
  (state.notables ??= []).push(notable);
  return notable;
}

/**
 * Fill empty seats, world by world in board order: an independent world's
 * always, with a notable of its own — nobody appoints for it — and, with
 * `everyWorld`, a held world's for its holder's default estate, which only the
 * opening board does. After that a power's empty seat waits for an
 * appointment off its Lists. Returns the notables seated.
 */
export function fillSeats(state: WorldState, opts: { everyWorld?: boolean } = {}): Notable[] {
  const seated: Notable[] = [];
  for (const world of state.systems) {
    const holder = world.controllerFactionId;
    if (holder !== null && !opts.everyWorld) continue;
    for (const k of emptySeats(state, world)) {
      const estate = holder ? defaultEstate(state, holder, world) : null;
      if (holder && !estate) break;
      seated.push(seatNotable(state, estate?.id ?? null, world.id, `${world.id}:${state.turn}:${k}`, k));
    }
  }
  return seated;
}

/**
 * Keep every estate on the Lists: an estate with nobody waiting has a notable
 * of its own put forward. Run after every batch and every tick, so an
 * appointment is always possible. Returns those listed.
 */
export function stockLists(state: WorldState): Notable[] {
  const listed: Notable[] = [];
  // One pass: which estates have somebody waiting.
  const held = new Set((state.assets ?? []).filter((a) => a.notableId && a.quantity > 0).map((a) => a.notableId!));
  const waiting = new Set<string>();
  for (const n of state.notables ?? []) {
    if (n.estateId !== null && n.systemId === null && n.livesAt === null && !held.has(n.id)) waiting.add(n.estateId);
  }
  for (const faction of state.factions) {
    for (const estate of faction.estates ?? []) {
      if (waiting.has(estate.id)) continue;
      listed.push(seatNotable(state, estate.id, null, `list:${estate.id}:${state.turn}`));
    }
  }
  return listed;
}

/**
 * What every batch and tick ends on, so the court is always in a legal shape:
 * a power holding one of its own people — a ward or prisoner come home by
 * ransom, trade or conquest — puts them back on its Lists; one living on a
 * world that is no longer independent, or no longer married, comes home; and
 * every estate has someone listed.
 */
export function settleCourt(state: WorldState): void {
  if (!courtRecorded(state)) return;
  const home = new Set<string>();
  for (const asset of state.assets ?? []) {
    const n = notableById(state, asset.notableId);
    if (n && n.estateId !== null && estateOwner(n.estateId) === asset.heldBy) home.add(asset.id);
  }
  if (home.size > 0) state.assets = state.assets.filter((a) => !home.has(a.id));
  for (const n of state.notables ?? []) {
    if (n.livesAt === null) continue;
    const world = state.systems.find((w) => w.id === n.livesAt);
    if (!world || world.controllerFactionId !== null || !notableById(state, n.spouseId)) {
      unmarry(state, n);
      n.livesAt = null;
    }
  }
  stockLists(state);
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
 * changed, with who held it before, and a minter for the assets it makes.
 *
 * - **conquest of a power's world**: whoever sits it is taken prisoner, held
 *   there by the conqueror, and the seats stand empty for it to fill off its
 *   own Lists. A marriage whose seated spouse is taken is over, and its ward
 *   — held on the same world — is the conqueror's now too.
 * - **cession**: nobody fought, so the ceder's notables go home to its Lists
 *   and any ward of theirs with them; the seats stand empty.
 * - **an independent world taken**: its notables have no power behind them and
 *   are turned out; a power's notable who married in and lives there is the
 *   conqueror's prisoner. The seats stand empty.
 * - **secession**: the notables stay and speak for the world alone; a
 *   marriage of theirs is over, its ward sent home.
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
  mint: () => string,
): string | null {
  if (!courtRecorded(state)) return null;
  const seated = seatedAt(state, world.id);
  const after = world.controllerFactionId;
  const parts: string[] = [];
  if (how === 'secession') {
    for (const n of seated) {
      const m = marriageOf(state, n.id);
      if (m) parts.push(endMarriage(state, m, 'home', 'voided'));
      n.estateId = null;
    }
    if (seated.length > 0) {
      parts.unshift(`${seated.map((n) => n.name).join(' and ')} now speak${seated.length > 1 ? '' : 's'} for ${world.name} alone.`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (how === 'joining' && after) {
    for (const n of seated) {
      if (n.estateId !== null) continue;
      const spouse = notableById(state, n.spouseId);
      const viaMarriage = spouse && spouse.estateId && estateOwner(spouse.estateId) === after ? spouse.estateId : null;
      // Off the board while the default is chosen, so it does not count itself.
      n.systemId = null;
      const estate = viaMarriage ? estateById(state, viaMarriage)?.estate : defaultEstate(state, after, world);
      n.systemId = world.id;
      n.estateId = estate?.id ?? null;
      if (estate) parts.push(`${n.name} takes ${world.name}'s seat for ${estate.name}.`);
    }
    // Whoever married in comes home; `settleCourt` finishes the match if it
    // was with another power's people.
    for (const n of state.notables ?? []) if (n.livesAt === world.id) n.livesAt = null;
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (how === 'conquest' || how === 'cession') {
    const turnedOut: Notable[] = [];
    const taken: Notable[] = [];
    const sentHome: Notable[] = [];
    for (const n of seated) {
      if (n.estateId === null) {
        turnedOut.push(n);
        continue;
      }
      if (estateOwner(n.estateId) === after) continue;
      const m = marriageOf(state, n.id);
      if (how === 'cession') {
        if (m) parts.push(endMarriage(state, m, 'home', 'voided'));
        n.systemId = null;
        sentHome.push(n);
      } else {
        if (m) parts.push(endMarriage(state, m, after ? { prisonerOf: after } : 'home', 'voided'));
        if (after) {
          holdNotable(state, n, after, world.id, mint(), 'prisoner');
          taken.push(n);
        } else {
          n.systemId = null;
        }
      }
    }
    for (const n of turnedOut) removeNotable(state, n);
    // Whoever is held on the world — a prisoner, or a ward whose match just
    // ended — is the new holder's now, whichever path took the world; one of
    // its own goes home to its Lists in `settleCourt`.
    if (how === 'conquest' && after) {
      for (const asset of state.assets ?? []) {
        if (asset.notableId && asset.atSystemId === world.id) asset.heldBy = after;
      }
    }
    // A power's notable who married into an independent world, living there.
    for (const n of state.notables ?? []) {
      if (n.livesAt !== world.id) continue;
      unmarry(state, n);
      n.livesAt = null;
      if (after && powerOf(n) !== after) {
        holdNotable(state, n, after, world.id, mint(), 'prisoner');
        taken.push(n);
      }
    }
    const names = (ns: Notable[]) => ns.map((n) => n.name).join(' and ');
    if (turnedOut.length > 0) parts.unshift(`${names(turnedOut)} ${turnedOut.length > 1 ? 'are' : 'is'} turned out of ${world.name}.`);
    if (taken.length > 0 && after) parts.push(`${names(taken)} ${taken.length > 1 ? 'are' : 'is'} held at ${world.name} by ${nameOf(state, after)}.`);
    if (sentHome.length > 0) parts.push(`${names(sentHome)} ${sentHome.length > 1 ? 'go' : 'goes'} home.`);
    if (after && seated.length > 0) parts.push(`${world.name}'s seats stand empty for ${nameOf(state, after)} to fill.`);
    return parts.length > 0 ? parts.join(' ') : null;
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
 * What the seated do this turn, read before the estates' favour moves: fill an
 * independent world's empty seat, let each notable lift or sour its world —
 * an empty seat does nothing either way — and name the worlds
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
      if (lifts(f)) push += NOTABLE_REGARD / seatsFor(world);
      else if (withholds(f)) push -= NOTABLE_REGARD / seatsFor(world);
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

/**
 * A notable by id or by name, matched as officers are: every word of the
 * query answered, an initial answers a given name, a tie is nobody.
 */
export function resolveNotable(
  state: WorldState,
  query: string,
  eligible: (n: Notable) => boolean = () => true,
): Notable | null {
  return resolvePerson(state.notables, query, eligible);
}

/** The asset a held notable is, if they are held. */
export function heldAs(state: WorldState, notableId: string): Asset | undefined {
  return (state.assets ?? []).find((a) => a.notableId === notableId && a.quantity > 0);
}

/**
 * Put a notable into somebody's keeping — a ward handed over by a marriage, or
 * a prisoner taken with a world. Out of any seat they sat. Returns the asset
 * they now are, held at `atSystemId`, worth most to the power whose they are.
 * The caller mints the id, since only the reducer keeps the pool.
 */
export function holdNotable(
  state: WorldState,
  notable: Notable,
  heldBy: string,
  atSystemId: string,
  id: string,
  as: 'ward' | 'prisoner',
): Asset {
  const theirs = powerOf(notable);
  const estate = estateById(state, notable.estateId)?.estate.name;
  const where = state.systems.find((w) => w.id === (notable.systemId ?? notable.livesAt))?.name;
  const spouse = notableById(state, notable.spouseId);
  notable.systemId = null;
  notable.livesAt = null;
  const worth: Record<string, number> = {};
  for (const f of state.factions) worth[f.id] = f.id === theirs ? NOTABLE_RANSOM : OFFICER_LEVERAGE;
  const asset = AssetSchema.parse({
    id,
    kind: 'notable',
    text:
      as === 'ward'
        ? `${notable.name}${estate ? ` of ${estate}` : ''}, wed to ${spouse?.name ?? 'a notable'} and living at ${nameOf(state, heldBy)}'s court as a ward`
        : `${notable.name}${estate ? ` of ${estate}` : ''}, taken at ${where ?? 'their seat'} and held`,
    heldBy,
    quantity: 1,
    unit: 'person',
    commanderId: null,
    agentId: null,
    notableId: notable.id,
    divisible: false,
    valuePerUnit: worth,
    atSystemId,
    portable: true,
    yield: null,
    acquiredTurn: state.turn,
  });
  (state.assets ??= []).push(asset);
  return asset;
}

/**
 * Which powers each world counts as kin: a notable seated there married to
 * someone of another power. A ward or a notable on the Lists sits nowhere, so
 * only the seated side of a marriage draws its world. Each world adds
 * `MARRIAGE_REGARD` to its baseline toward its in-laws; read by the tick and
 * handed to `accrueRegard`.
 */
export function inLawsByWorld(state: WorldState): Map<string, Set<string>> {
  const kin = new Map<string, Set<string>>();
  for (const n of state.notables ?? []) {
    const world = n.systemId;
    const spouse = notableById(state, n.spouseId);
    const them = spouse ? powerOf(spouse) : null;
    if (!world || them === null || them === powerOf(n)) continue;
    (kin.get(world) ?? kin.set(world, new Set()).get(world)!).add(them);
  }
  return kin;
}

/** The live `marriage` treaty that weds this notable, if one does. */
export function marriageOf(state: WorldState, notableId: string): Treaty | undefined {
  return (state.treaties ?? []).find(
    (t) => t.type === 'marriage' && isTreatyLive(t, state.turn) && (t.terms.spouses ?? []).includes(notableId),
  );
}

/**
 * What becomes of a marriage's ward when it ends: sent home to their power's
 * Lists, kept as a prisoner (by the court that held them, or by `prisonerOf`
 * when a conqueror has taken them with the world), or gone from play.
 */
export type WardFate = 'home' | 'prisoner' | { prisonerOf: string } | 'gone';

/**
 * End a marriage treaty — the bond from both sides, and its ward to `fate`;
 * `status` marks the treaty, left as it is when it already ended (lapsed).
 * Regard and favour costs are the caller's: they depend on who ended it.
 * Returns the line saying so.
 */
export function endMarriage(state: WorldState, treaty: Treaty, fate: WardFate, status?: 'broken' | 'voided'): string {
  if (status) treaty.status = status;
  const [a, b] = (treaty.terms.spouses ?? []).map((id) => notableById(state, id));
  if (a) unmarry(state, a);
  if (b) unmarry(state, b);
  const ward = notableById(state, treaty.terms.ward);
  const asset = ward ? heldAs(state, ward.id) : undefined;
  let after = '';
  if (ward && asset) {
    if (fate === 'home') {
      state.assets = state.assets.filter((x) => x.id !== asset.id);
      after = ` ${ward.name} goes home.`;
    } else if (fate === 'gone') {
      state.assets = state.assets.filter((x) => x.id !== asset.id);
      removeNotable(state, ward);
      after = ` ${ward.name} is not seen again.`;
    } else {
      const keeper = fate === 'prisoner' ? asset.heldBy : fate.prisonerOf;
      asset.heldBy = keeper;
      asset.text = `${ward.name}${estateById(state, ward.estateId) ? ` of ${estateById(state, ward.estateId)!.estate.name}` : ''}, a ward no longer, held by ${nameOf(state, keeper)}`.slice(0, 240);
      after = ` ${ward.name} stays, a prisoner of ${nameOf(state, keeper)}.`;
    }
  }
  return `The marriage of ${a?.name ?? 'one'} and ${b?.name ?? 'another'} is over.${after}`;
}

/**
 * Who broke a marriage decides the ward's fate: the power that gave the ward
 * leaves them a prisoner of the court that held them — that is what a hostage
 * is for — and the power that held them, breaking faith with its own guest,
 * loses them from play.
 */
export function fateWhenBrokenBy(state: WorldState, treaty: Treaty, breaker: string): WardFate {
  const ward = notableById(state, treaty.terms.ward);
  if (!ward) return 'home';
  return powerOf(ward) === breaker ? 'prisoner' : 'gone';
}

/** One of a power's notables in office: seated on a world that power holds. */
export interface InOffice {
  name: string;
  estateId: string;
  systemId: string;
  office: string;
}

/**
 * Every notable in office: seated, belonging to an estate, on a world their
 * own power holds. Read before a batch or a tick and again after, by
 * `vacatedSeats`, so every way a seat can empty is charged by one rule instead
 * of at each of the dozen places one does.
 */
export function inOffice(state: WorldState): Map<string, InOffice> {
  const out = new Map<string, InOffice>();
  for (const n of state.notables ?? []) {
    if (n.estateId === null || n.systemId === null) continue;
    const world = state.systems.find((w) => w.id === n.systemId);
    if (!world || world.controllerFactionId !== estateOwner(n.estateId)) continue;
    out.set(n.id, { name: n.name, estateId: n.estateId, systemId: n.systemId, office: seatOffice(n) });
  }
  return out;
}

/**
 * Charge each estate `SEAT_VACATED_FAVOUR` for every notable of its that was
 * in office before and is not in that seat now — replaced, taken prisoner,
 * sent home, dead, carried off, or on a world that is no longer its power's.
 * Returns a line for each, addressed to the power that owns the estate.
 */
export function vacatedSeats(
  state: WorldState,
  before: ReadonlyMap<string, InOffice>,
): { factionId: string; text: string }[] {
  const now = inOffice(state);
  const lines: { factionId: string; text: string }[] = [];
  for (const [id, was] of before) {
    const still = now.get(id);
    if (still && still.systemId === was.systemId) continue;
    const owner = estateById(state, was.estateId);
    if (!owner) continue;
    owner.estate.favour = Math.max(-100, owner.estate.favour - SEAT_VACATED_FAVOUR);
    const world = state.systems.find((w) => w.id === was.systemId)?.name ?? was.systemId;
    lines.push({
      factionId: owner.faction.id,
      text: `${owner.estate.name.charAt(0).toUpperCase()}${owner.estate.name.slice(1)} lose a seat: ${was.name} is no longer ${was.office} of ${world}. Their favour falls ${SEAT_VACATED_FAVOUR}.`,
    });
  }
  return lines;
}
