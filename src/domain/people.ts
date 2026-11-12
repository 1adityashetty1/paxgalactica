import { atWork } from './diplomacy.js';
import { heldAs, whereabouts } from './seats.js';
import { getFaction, type WorldState } from './state.js';

/**
 * Where a person is, for all three kinds of person, in one union.
 *
 * Officers, operatives and notables live the same life — on the Lists, in
 * post, under way, at work, held by somebody, home again or gone — and each
 * kind stores it differently:
 *
 * - an **officer** is one record: `status`, `atSystemId`, the `officers` of
 *   the order carrying them, and an `officer` asset with their `commanderId`
 *   while captured;
 * - an **operative** is a `ListedAgent` on the Lists or an `Agent` on the
 *   books — `mission`, `effect`, `inPlaceFrom` and `exposed` — and an
 *   `operative` asset with their `agentId` while held;
 * - a **notable** is one record read in priority order by `whereabouts`:
 *   `systemId`, an asset with their `notableId`, `livesAt`.
 *
 * Nothing here is stored. It reads those fields, so the tabs, the prompts and
 * the invariant below say one thing about one person, and a save replays
 * exactly as it did.
 */

export type PersonKind = 'officer' | 'operative' | 'notable';

export interface PersonRef {
  kind: PersonKind;
  id: string;
  name: string;
  /** The power they serve; `null` for an independent world's notable. */
  factionId: string | null;
}

export type Place =
  | { at: 'listed' }
  /** Standing at a world: an officer in post, an operative awaiting orders, a notable in a seat. */
  | { at: 'post'; systemId: string }
  /** On the way: an officer aboard a voyage, an operative travelling to their mission. */
  | { at: 'under_way'; toSystemId: string; arrives: number }
  /** An operative at work on their mission. */
  | { at: 'working'; systemId: string; mission: string }
  | { at: 'held'; byFactionId: string; systemId: string | null; assetId: string }
  /** A notable living on an independent world they married into. */
  | { at: 'abroad'; systemId: string }
  /** Fallen, spent, executed, or burned before the caught were held. */
  | { at: 'gone' };

/** Everyone in the campaign, of every kind, or one power's people. */
export function peopleOf(state: WorldState, factionId?: string): PersonRef[] {
  const out: PersonRef[] = [
    ...(state.commanders ?? []).map((c) => ({ kind: 'officer' as const, id: c.id, name: c.name, factionId: c.factionId })),
    ...(state.listedAgents ?? []).map((a) => ({ kind: 'operative' as const, id: a.id, name: a.name, factionId: a.ownerFactionId })),
    ...(state.agents ?? []).map((a) => ({ kind: 'operative' as const, id: a.id, name: a.name || a.cover || a.id, factionId: a.ownerFactionId })),
    ...(state.notables ?? []).map((n) => ({
      kind: 'notable' as const,
      id: n.id,
      name: n.name,
      factionId: n.estateId ? (state.factions.find((f) => f.estates?.some((e) => e.id === n.estateId))?.id ?? null) : null,
    })),
  ];
  return factionId === undefined ? out : out.filter((p) => p.factionId === factionId);
}

function heldAt(state: WorldState, field: 'commanderId' | 'agentId', id: string): Place | null {
  const asset = (state.assets ?? []).find((a) => a[field] === id && a.quantity > 0);
  return asset ? { at: 'held', byFactionId: asset.heldBy, systemId: asset.atSystemId, assetId: asset.id } : null;
}

export function whereaboutsOf(state: WorldState, person: Pick<PersonRef, 'kind' | 'id'>): Place {
  if (person.kind === 'officer') {
    const c = (state.commanders ?? []).find((x) => x.id === person.id);
    if (!c) return { at: 'gone' };
    if (c.status === 'listed') return { at: 'listed' };
    if (c.status === 'lost') return { at: 'gone' };
    if (c.status === 'captured') return heldAt(state, 'commanderId', c.id) ?? { at: 'gone' };
    if (c.atSystemId) return { at: 'post', systemId: c.atSystemId };
    const voyage = state.pendingOrders.find((o) => o.officers?.includes(c.id));
    if (voyage) {
      return { at: 'under_way', toSystemId: voyage.targetId, arrives: state.turn + Math.max(0, voyage.durationTurns - voyage.progress) };
    }
    return { at: 'gone' };
  }
  if (person.kind === 'operative') {
    if ((state.listedAgents ?? []).some((a) => a.id === person.id)) return { at: 'listed' };
    const a = (state.agents ?? []).find((x) => x.id === person.id);
    if (!a) return { at: 'gone' };
    if (a.exposed) return heldAt(state, 'agentId', a.id) ?? { at: 'gone' };
    if (a.mission === null) return { at: 'post', systemId: a.systemId };
    if (atWork(a, state.turn)) return { at: 'working', systemId: a.systemId, mission: a.mission };
    return { at: 'under_way', toSystemId: a.systemId, arrives: a.inPlaceFrom ?? state.turn };
  }
  const n = (state.notables ?? []).find((x) => x.id === person.id);
  if (!n) return { at: 'gone' };
  switch (whereabouts(state, n)) {
    case 'seated':
      return { at: 'post', systemId: n.systemId! };
    case 'held': {
      const asset = heldAs(state, n.id)!;
      return { at: 'held', byFactionId: asset.heldBy, systemId: asset.atSystemId, assetId: asset.id };
    }
    case 'abroad':
      return { at: 'abroad', systemId: n.livesAt! };
    case 'listed':
      return { at: 'listed' };
  }
}

/** "held by the Iron Vigil Remnant at Threx", "under way to Vantic, there on turn 6". */
export function describePlace(state: WorldState, place: Place): string {
  const world = (id: string | null) => (id ? (state.systems.find((s) => s.id === id)?.name ?? id) : 'nowhere');
  switch (place.at) {
    case 'listed':
      return 'on the Lists';
    case 'post':
      return `at ${world(place.systemId)}`;
    case 'under_way':
      return place.arrives <= state.turn
        ? `under way to ${world(place.toSystemId)}`
        : `under way to ${world(place.toSystemId)}, there on turn ${place.arrives}`;
    case 'working':
      return `at work at ${world(place.systemId)} (${place.mission})`;
    case 'held':
      return `held by ${getFaction(state, place.byFactionId)?.name ?? place.byFactionId}${place.systemId ? ` at ${world(place.systemId)}` : ''}`;
    case 'abroad':
      return `living at ${world(place.systemId)}`;
    case 'gone':
      return 'gone';
  }
}

/**
 * The rules every person keeps: each is in exactly one place, and every record
 * that points at a person points at somebody who exists. Returns what is
 * broken, empty when nothing is; the suite and the bug-hunt gate run it.
 */
export function personViolations(state: WorldState): string[] {
  const out: string[] = [];
  const holders = (field: 'commanderId' | 'agentId' | 'notableId', id: string) =>
    (state.assets ?? []).filter((a) => a[field] === id && a.quantity > 0);

  for (const c of state.commanders ?? []) {
    const voyages = state.pendingOrders.filter((o) => o.officers?.includes(c.id)).length;
    const held = holders('commanderId', c.id).length;
    if (c.status === 'active') {
      if ((c.atSystemId ? 1 : 0) + voyages !== 1) {
        out.push(`officer ${c.id} is active and ${c.atSystemId ? 'standing somewhere' : 'standing nowhere'} on ${voyages} voyage(s)`);
      }
      if (held > 0) out.push(`officer ${c.id} is active and held as an asset`);
    } else {
      if (c.atSystemId || voyages > 0) out.push(`officer ${c.id} is ${c.status} and still placed`);
      if (c.status === 'captured' ? held > 1 : held > 0) out.push(`officer ${c.id} is ${c.status} and held ${held} time(s)`);
    }
  }

  const listed = new Set((state.listedAgents ?? []).map((a) => a.id));
  const seen = new Set<string>();
  for (const a of state.agents ?? []) {
    if (seen.has(a.id)) out.push(`operative ${a.id} is on the books twice`);
    seen.add(a.id);
    if (listed.has(a.id)) out.push(`operative ${a.id} is on the books and on the Lists`);
    const held = holders('agentId', a.id).length;
    if (!a.exposed && held > 0) out.push(`operative ${a.id} is at large and held as an asset`);
    if (held > 1) out.push(`operative ${a.id} is held ${held} times`);
  }
  for (const id of listed) if (holders('agentId', id).length > 0) out.push(`operative ${id} is on the Lists and held as an asset`);

  for (const n of state.notables ?? []) {
    const places = (n.systemId ? 1 : 0) + (n.livesAt ? 1 : 0) + holders('notableId', n.id).length;
    if (places > 1) out.push(`notable ${n.id} is in ${places} places at once`);
  }

  const commanders = new Set((state.commanders ?? []).map((c) => c.id));
  const notables = new Set((state.notables ?? []).map((n) => n.id));
  for (const asset of state.assets ?? []) {
    if (asset.quantity <= 0) continue;
    if (asset.commanderId && !commanders.has(asset.commanderId)) out.push(`asset ${asset.id} holds an officer who does not exist`);
    if (asset.agentId && !seen.has(asset.agentId)) out.push(`asset ${asset.id} holds an operative who is not on the books`);
    if (asset.notableId && !notables.has(asset.notableId)) out.push(`asset ${asset.id} holds a notable who does not exist`);
  }
  return out;
}
