import { favourModifier, MARRIAGE_CONSENT_REGARD, MAX_GRANTS, estateOwner, seatOffice, type Notable } from '../domain/estates.js';
import { regardFor } from '../domain/regard.js';
import {
  actingFavour,
  courtRecorded,
  defaultEstate,
  emptySeats,
  estateById,
  favourBaseline,
  heldAs,
  listedFor,
  marriageOf,
  notableById,
  powerOf,
  seatedAt,
  withholds,
} from '../domain/seats.js';
import type { WorldState } from '../domain/state.js';

/**
 * The Court tab, as data: a power's estates and what their favour does, its
 * marriages, who of its people is held and whom it holds, and what a world
 * would take. `docs/design-2026-10-07-seats.md`.
 *
 * Pure and DOM-free, beside `agentroster.ts`, so the sorting is tested. It
 * reads the served view: the player's own estates are whole there, a rival's
 * favour only in bands.
 */

export interface CourtEstate {
  id: string;
  name: string;
  stat: string;
  favour: number;
  /** What favour does to the stat now: −2..+2. */
  modifier: number;
  seats: number;
  fairShare: number;
  grants: number;
  stipends: number;
  /** Seats on worlds that resent their holder. */
  hated: number;
  /** Where favour is drifting. */
  baseline: number;
  /** Whether another stipend would count — grants are capped. */
  canGrant: boolean;
}

export interface CourtMarriage {
  mine: Notable;
  spouse: Notable;
  /** The other side: a power's name, or the independent world the spouse speaks for. */
  side: string;
  /** Who of the two lives away from home, and where: the ward, or yours living on an independent world. */
  away: { who: Notable; where: string } | null;
}

/** One estate's notables waiting for a seat. */
export interface ListedEstate {
  id: string;
  name: string;
  stat: string;
  notables: Notable[];
}

/** A seat on one of your worlds that nobody sits. */
export interface Vacancy {
  systemId: string;
  world: string;
  seat: number;
  office: string;
  /** The estate the game would send by default: the ground's, else the fewest seats. */
  suggested: string | null;
}

export interface CourtSeatIssue {
  notable: Notable;
  systemId: string;
  world: string;
  /** Why it is listed. */
  why: 'foreign' | 'withholding';
}

export interface CourtView {
  estates: CourtEstate[];
  marriages: CourtMarriage[];
  /** Your notables held by another power: { notable, by, assetId }. */
  heldAbroad: { notable: Notable; by: string; assetId: string }[];
  /** Notables you hold: { notable, assetId, theirs }. */
  holding: { notable: Notable; assetId: string; theirs: string | null }[];
  /** Seats on your worlds that are costing you. */
  trouble: CourtSeatIssue[];
  /** Independent worlds that would accept a match from you now. */
  matches: { systemId: string; world: string; regard: number }[];
  /** Your Lists, estate by estate. */
  lists: ListedEstate[];
  /** Seats on your worlds standing empty. */
  vacancies: Vacancy[];
}

export function courtView(state: WorldState, me: string): CourtView | null {
  if (!courtRecorded(state)) return null;
  const faction = state.factions.find((f) => f.id === me);
  if (!faction) return null;
  const name = (id: string) => state.factions.find((f) => f.id === id)?.name ?? id;
  const worldName = (id: string | null) => state.systems.find((w) => w.id === id)?.name ?? id ?? 'nowhere';

  const estates = (faction.estates ?? []).map((e) => {
    const b = favourBaseline(state, e);
    return {
      id: e.id,
      name: e.name,
      stat: e.stat,
      favour: e.favour,
      modifier: favourModifier(e.favour),
      seats: b.seats,
      fairShare: b.fairShare,
      grants: b.grants,
      stipends: e.stipends,
      hated: b.hated,
      baseline: b.baseline,
      canGrant: b.grants < MAX_GRANTS,
    };
  });

  const mine = (state.notables ?? []).filter((n) => n.estateId !== null && estateOwner(n.estateId) === me);
  const marriages: CourtMarriage[] = [];
  for (const n of mine) {
    const spouse = notableById(state, n.spouseId);
    if (!spouse) continue;
    const theirs = powerOf(spouse);
    if (theirs === me) continue;
    const ward = marriageOf(state, n.id)?.terms.ward;
    const wardOne = ward === n.id ? n : ward === spouse.id ? spouse : null;
    const heldAt = wardOne ? heldAs(state, wardOne.id) : undefined;
    marriages.push({
      mine: n,
      spouse,
      side: theirs ? name(theirs) : worldName(spouse.systemId ?? spouse.livesAt),
      away: wardOne && heldAt
        ? { who: wardOne, where: `${name(heldAt.heldBy)}'s court at ${worldName(heldAt.atSystemId)}` }
        : n.livesAt
          ? { who: n, where: worldName(n.livesAt) }
          : null,
    });
  }

  const isWard = (n: Notable) => marriageOf(state, n.id)?.terms.ward === n.id;
  const heldAbroad = mine
    .filter((n) => n.systemId === null && !isWard(n))
    .map((n) => ({ n, a: heldAs(state, n.id) }))
    .filter((x) => x.a !== undefined && x.a.heldBy !== me)
    .map((x) => ({ notable: x.n, by: x.a!.heldBy, assetId: x.a!.id }));

  const holding = (state.assets ?? [])
    .filter((a) => a.heldBy === me && a.notableId && !isWard(notableById(state, a.notableId)!))
    .map((a) => ({ a, n: notableById(state, a.notableId) }))
    .filter((x) => x.n !== undefined)
    .map((x) => ({ notable: x.n!, assetId: x.a.id, theirs: powerOf(x.n!) }));

  const trouble: CourtSeatIssue[] = [];
  for (const world of state.systems) {
    if (world.controllerFactionId !== me) continue;
    for (const n of seatedAt(state, world.id)) {
      const foreign = n.estateId !== null && estateOwner(n.estateId) !== me;
      if (foreign && withholds(actingFavour(state, n))) {
        trouble.push({ notable: n, systemId: world.id, world: world.name, why: 'foreign' });
      } else if (withholds(actingFavour(state, n))) {
        trouble.push({ notable: n, systemId: world.id, world: world.name, why: 'withholding' });
      }
    }
  }

  const matches = state.systems
    .filter((w) => w.controllerFactionId === null)
    .map((w) => ({ systemId: w.id, world: w.name, regard: regardFor(w, me) }))
    .filter(
      (m) =>
        m.regard >= MARRIAGE_CONSENT_REGARD &&
        seatedAt(state, m.systemId).some((n) => n.estateId === null && n.spouseId === null),
    )
    .sort((a, b) => b.regard - a.regard || a.world.localeCompare(b.world));

  const lists = (faction.estates ?? []).map((e) => ({ id: e.id, name: e.name, stat: e.stat, notables: listedFor(state, e.id) }));

  const vacancies: Vacancy[] = [];
  for (const world of state.systems) {
    if (world.controllerFactionId !== me) continue;
    for (const seat of emptySeats(state, world)) {
      vacancies.push({
        systemId: world.id,
        world: world.name,
        seat,
        office: seatOffice({ seat }),
        suggested: defaultEstate(state, me, world)?.name ?? null,
      });
    }
  }

  return { estates, marriages, heldAbroad, holding, trouble, matches, lists, vacancies };
}

/** The estate a seat belongs to, in words, for the System tab. */
export function seatLabel(state: WorldState, n: Notable): string {
  const e = estateById(state, n.estateId);
  return e ? `${e.estate.name}, ${e.faction.name}` : 'speaks for the world itself';
}

/** What a notable is doing to their world for its holder, in a phrase; `null` when nothing. */
export function seatDoing(state: WorldState, n: Notable): string | null {
  const f = actingFavour(state, n);
  if (f === null) return null;
  const world = state.systems.find((w) => w.id === n.systemId);
  const holder = world?.controllerFactionId;
  const foreign = n.estateId !== null && holder !== null && holder !== undefined && estateOwner(n.estateId) !== holder;
  if (foreign && f < 0) return 'foreign: keeps back half its share and sours it, until reseated';
  if (f <= -40) return 'resentful: keeps back half its share and sours it';
  if (f >= 40) return 'favoured: wins the world over a little each turn';
  return null;
}

/** The briefing's court lines: what the court is doing to you, standing. */
export function courtLines(state: WorldState, me: string): { text: string; tone: 'good' | 'bad' | 'info' }[] {
  const view = courtView(state, me);
  if (!view) return [];
  const out: { text: string; tone: 'good' | 'bad' | 'info' }[] = [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const e of view.estates) {
    if (e.modifier > 0) out.push({ text: `${cap(e.name)} favour you: ${e.stat} +${e.modifier}.`, tone: 'good' });
    if (e.modifier < 0) out.push({ text: `${cap(e.name)} resent you: ${e.stat} ${e.modifier}.`, tone: 'bad' });
  }
  for (const t of view.trouble) {
    out.push({
      text:
        t.why === 'foreign'
          ? `${t.notable.name} still sits ${t.world} for its old power and keeps back half of what it pays you. Reseat the seat.`
          : `${t.notable.name} keeps back half of what ${t.world} pays you.`,
      tone: 'bad',
    });
  }
  for (const h of view.heldAbroad) {
    const name = state.factions.find((f) => f.id === h.by)?.name ?? h.by;
    out.push({ text: `${h.notable.name} is held by ${name}.`, tone: 'info' });
  }
  if (view.vacancies.length > 0) {
    const seats = view.vacancies.map((v) => `${v.world}'s ${v.office.toLowerCase()}`).join(', ');
    out.push({
      text: `${view.vacancies.length === 1 ? 'A seat stands' : `${view.vacancies.length} seats stand`} empty: ${seats}. Appoint from the Lists.`,
      tone: 'bad',
    });
  }
  return out;
}
