import { ASSET_ARCHETYPES } from '../../domain/assets.js';
import { STAT_NAMES } from '../../domain/checks.js';
import { RIM_BOONS, RIM_HAZARDS, RIM_NOTORIETY } from '../../domain/events.js';
import { WORLD_TYPE_STAT, WORLD_TYPES } from '../../domain/state.js';

/**
 * How the studio organises the lexicon: by what each slot DOES in the core,
 * never by what Pax Galactica calls it.
 *
 * A skin for an army on roads has to be writable without filling in a slot
 * called "torpedo" or "hyperlane", so the studio never shows one by that name:
 * every family is presented under a mechanical label, and every row under the
 * role it plays — a unit as line, screen, strike, lift, trade, sigint or
 * dispatch (`docs/design-2026-11-15-skins.md`, appendix A); ground by the stat
 * it gives; a place as node, route, region, hub or presence. The core id is
 * shown beside it as data, because that is the key the skin is written
 * against and it changes in phase 3.
 *
 * In `src/skin` because this is where the setting's ids may be named: the
 * table maps them to roles so nothing outside it has to.
 */

export interface RoleGroup {
  role: string;
  /** What the mechanics need a member of this role to be. */
  says: string;
  /** Core ids in the family that play it. */
  members: readonly string[];
}

export interface FamilyRoles {
  /** The family under a mechanical name. */
  label: string;
  says: string;
  groups: readonly RoleGroup[];
}

const g = (role: string, says: string, members: readonly string[]): RoleGroup => ({ role, says, members });

/** Ground by the stat it gives, read off the core rather than listed. */
const groundByStat: RoleGroup[] = STAT_NAMES.map((stat) =>
  g(stat, `ground that gives ${stat}`, WORLD_TYPES.filter((t) => WORLD_TYPE_STAT[t] === stat)),
).filter((x) => x.members.length > 0);

const fixtures = ASSET_ARCHETYPES.filter((a) => a.fixture).map((a) => a.kind);
const portable = ASSET_ARCHETYPES.filter((a) => !a.fixture).map((a) => a.kind);

export const FAMILY_ROLES: Readonly<Record<string, FamilyRoles>> = {
  units: {
    label: 'Units',
    says: 'Each kind of unit a power fields, by the role it plays in a fight. The word, its plural, and the id a model writes.',
    groups: [
      g('line', 'wins the exchange; dear; dies last', ['battleship']),
      g('screen', 'cheap; dies first; turns a strike aside, size for size', ['escort']),
      g('strike', 'hits before the lines close, past the screen at the heaviest; cannot hold the field', ['torpedo_boat']),
      g('lift', 'carries troops; the only way to take ground', ['lifter']),
      g('trade', 'earns where nobody owns the ground; cannot fight', ['freighter']),
      g('sigint', 'sees what is under way where it stands, and hears raids two steps out; can be cut down', ['listener']),
      g('dispatch', 'carries an officer; holds nothing', ['courier']),
    ],
  },
  terrains: {
    label: 'Ground',
    says: 'Kinds of ground, by the stat each gives the power holding it. Its line is under Lore › sentences › terrainLines.',
    groups: groundByStat,
  },
  orderCategories: {
    label: 'Work',
    says: 'The kinds of work an order can be.',
    groups: [
      g('movement', 'a force going somewhere', ['fleet_movement']),
      g('word', 'a message, a ruling, a signature', ['courier', 'decree', 'treaty_ratification']),
      g('intrigue', 'work done in rooms', ['political_maneuver', 'espionage', 'counter_intelligence']),
      g('interdiction', 'closing or robbing a route', ['blockade', 'commerce_raiding']),
      g('defence', 'raising and walling a garrison', ['garrison_raising', 'fortification']),
      g('building', 'making and remaking', ['refit', 'retooling', 'construction_infrastructure', 'capital_ship_construction', 'industrial_conversion']),
    ],
  },
  assetKinds: {
    label: 'Holdings',
    says: 'Things that can be held: what one is called, what produces one, and who wants it.',
    groups: [g('portable', 'carried, traded, ransomed or spent', portable), g('fixture', 'built on the ground and taken with it', fixtures)],
  },
  rimEvents: {
    label: 'Events',
    says: 'What happens on its own.',
    groups: [
      g('hazard', 'leans on the strong', RIM_HAZARDS),
      g('boon', 'leans toward whoever is behind', RIM_BOONS),
      g('notoriety', 'the answer to a power that has made itself notorious', RIM_NOTORIETY),
    ],
  },
  treatyTypes: { label: 'Agreements', says: 'The kinds of paper two powers can sign.', groups: [] },
  schools: {
    label: 'Officer schools',
    says: 'Where in a battle each school helps, how a report says it, and what a prompt says its officers are known for.',
    groups: [],
  },
  noteKinds: { label: 'Favours', says: 'The favours a power signs in advance.', groups: [] },
  phases: {
    label: 'Battle phases',
    says: 'The parts of a battle, in order.',
    groups: [g('first volley', 'both sides fire once before the lines close', ['strike']), g('the field', 'force against force', ['orbital']), g('the assault', 'troops against the garrison', ['ground'])],
  },
  fleetKinds: {
    label: 'Formations',
    says: 'The kinds of body a power musters, named by the unit role they are built around.',
    groups: [g('line', 'the main body', ['line']), g('sigint', 'eyes and ears', ['listener']), g('trade', 'a trading body', ['freighter']), g('dispatch', 'an officer’s passage', ['courier'])],
  },
  places: {
    label: 'Places',
    says: 'Words for where things are. No op names them.',
    groups: [
      g('node', 'a place on the map', ['world', 'system']),
      g('route', 'what joins two places, and a turn spent on one', ['lane', 'hyperlane', 'jump']),
      g('region', 'a stretch of the map, up to the whole of it', ['sector', 'rim', 'space', 'galaxy']),
      g('hub', 'a place worth more than the rest', ['hub']),
      g('presence', 'being somewhere without holding it, and holding it', ['orbit', 'garrison']),
      g('works', 'where units are made', ['yards', 'shipyard', 'berth']),
    ],
  },
  forces: {
    label: 'Forces',
    says: 'Words for armed force in general, by what each does.',
    groups: [
      g('one unit', 'a single unit, of any role', ['hull', 'ship', 'warship']),
      g('a body', 'units together', ['fleet', 'squadron', 'navy']),
      g('its people', 'who serves in it', ['crew']),
      g('its load', 'what it carries', ['cargo']),
      g('its strike', 'what the strike role fires', ['salvo', 'torpedo']),
      g('its passage', 'a force on the move', ['voyage']),
    ],
  },
  people: { label: 'People', says: 'The people the game keeps on rosters.', groups: [] },
  verbs: {
    label: 'Movement',
    says: 'What a force does, in the four forms a sentence needs.',
    groups: [g('move', 'go along a route', ['sail']), g('take ground', 'put troops on it', ['land'])],
  },
  accounts: {
    label: 'Money and measure',
    says: 'What every price is paid in, and what every force is measured in.',
    groups: [g('money', 'what a price is paid in', ['credits']), g('size', 'what a force is measured in', ['tons'])],
  },
};

/** A family's rows grouped by role, in the table's order; ids the table does not know go last, under "other". */
export function grouped(family: string, rows: readonly string[]): { role: string; says: string; rows: string[] }[] {
  const roles = FAMILY_ROLES[family];
  if (!roles || roles.groups.length === 0) return [{ role: '', says: '', rows: [...rows] }];
  const placed = new Set<string>();
  const out = roles.groups
    .map((grp) => {
      const members = grp.members.filter((m) => rows.includes(m));
      members.forEach((m) => placed.add(m));
      return { role: grp.role, says: grp.says, rows: members };
    })
    .filter((x) => x.rows.length > 0);
  const rest = rows.filter((r) => !placed.has(r));
  if (rest.length > 0) out.push({ role: 'other', says: 'not yet given a role in the studio', rows: rest });
  return out;
}

/** The role a core id plays in a family, or the id itself where the family has none. */
export function roleOf(family: string, id: string): string {
  return FAMILY_ROLES[family]?.groups.find((grp) => grp.members.includes(id))?.role ?? id;
}

/** A family's mechanical name. */
export const familyLabel = (family: string): string => FAMILY_ROLES[family]?.label ?? family;

/** Where a renamed term comes from, said without the setting's nouns. */
export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  power: 'power',
  sector: 'region',
  system: 'place',
  family: 'house',
};
