import type { WorldType } from '../../domain/state.js';
import { createSeedState } from '../../seed/scenario.js';
import { paxGalactica } from '../paxgalactica.js';
import { STOCK_FAMILIES, STOCK_GIVEN, type Skin } from '../schema.js';
import { roleOf } from './roles.js';
import type { SkinValue } from './draft.js';

/**
 * Everything the studio can edit: every word a `Skin` carries, read off the
 * default skin.
 *
 * The base is `paxGalactica()` — the game's own words, built from the tables
 * that hold them — so the studio always shows what the game says today and
 * copies none of it. Each entry is a **path into a `Skin`**
 * (`powers.vigil.redLines.1`, `lexicon.units.battleship.plural`,
 * `lexicon.meanings.stats.might`), so an edit lands on exactly the field the
 * game reads, and `composeSkin` can build a whole skin from a draft.
 *
 * Found by walking the skin rather than listed, so a role added to the
 * lexicon or a sentence table added to `meanings` is editable the moment it
 * exists. Art is left out: it is files and drawings, not words. A world's
 * coordinates are left out too: a skin may move a world, but not by typing.
 */

/**
 * A path's segments joined by dots, with any dot inside a segment escaped —
 * some sentence keys carry one (`regard.war`). `pathOf` reads it back.
 */
const enc = (seg: string | number): string => String(seg).replace(/%/g, '%25').replace(/\./g, '%2E');
export const pathKey = (...segs: (string | number)[]): string => segs.map(enc).join('.');
export const pathOf = (key: string): string[] => key.split('.').map((seg) => seg.replace(/%2E/g, '.').replace(/%25/g, '%'));

export const SKIN_GROUPS = ['powers', 'map', 'officers', 'words', 'lore'] as const;
export type SkinGroup = (typeof SKIN_GROUPS)[number];

/**
 * - `id`: what a model writes in an op under this skin. Never reached by renames.
 * - `name` / `title` / `term`: short display text.
 * - `lore`: prose.
 * - `list`: one value per line (name stocks, synonyms).
 * - `choice`: one of `options`.
 */
export type EntryKind = 'id' | 'name' | 'title' | 'term' | 'lore' | 'list' | 'choice';

export type LoreFacet = 'voice' | 'doctrine' | 'redLine' | 'compulsion' | 'sentence';

export interface SkinEntry {
  /** A path into a `Skin`. */
  key: string;
  group: SkinGroup;
  /** What it is grouped under: a power id, a sector, a lexicon family, a sentence table. */
  section: string;
  label: string;
  kind: EntryKind;
  base: SkinValue;
  /** For a list the schema holds to a size. */
  size?: number;
  options?: readonly string[];
  /** The power it belongs to, for colour and filtering. */
  owner: string | null;
  facet?: LoreFacet;
  /** Within a lexicon family: the core id this row names, and which of its fields this is. */
  row?: string;
  field?: string;
  /** Do renames reach it? Ids are not prose. */
  lexical: boolean;
  hint?: string;
}

export interface SurfacePower {
  id: string;
  name: string;
  color: number;
}

/** A place on the map: a node, the region it is in, and the routes out of it. */
export interface SurfacePlace {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  controller: string | null;
  home: string | null;
  ground: WorldType;
  routes: string[];
}

export interface SkinSurface {
  base: Skin;
  entries: SkinEntry[];
  byKey: ReadonlyMap<string, SkinEntry>;
  powers: SurfacePower[];
  /** The skin's regions, keyed as `Skin.sectors` keys them. */
  regions: string[];
  places: SurfacePlace[];
  /** The lexicon's families, in the skin's own order. */
  families: string[];
}

const HINTS: Record<string, string> = {
  id: 'What a model writes in an op under this skin, translated to the core at the boundary. Lowercase words joined by underscores; never like a core id.',
  given: `Exactly ${STOCK_GIVEN}: the draw indexes a stock by the die, so every skin's stocks are one size.`,
  family: `Exactly ${STOCK_FAMILIES}, none shared with another stock and none hyphenated: a family names one person for a whole campaign.`,
  formations: 'A formation’s name with its number left out: {n} is the number, {nth} the ordinal.',
  voice: 'Fed verbatim to the diplomacy persona. A reply that could be pasted into another power’s mouth has failed.',
  synonyms: 'Other words a model or a player may use for it. Each must find its way back to this one role.',
};

export function buildSurface(base: Skin = paxGalactica()): SkinSurface {
  const seed = createSeedState(Object.keys(base.powers)[0] ?? 'meridian');
  const entries: SkinEntry[] = [];
  const add = (e: Omit<SkinEntry, 'lexical'>): void => {
    entries.push({ ...e, lexical: e.kind !== 'id' && e.kind !== 'choice' });
  };
  const stock = (prefix: string, owner: string | null, section: string, names: Skin['independents']['names']): void => {
    for (const [school, title] of Object.entries(names.titles)) {
      add({ key: `${prefix}.${pathKey('titles', school)}`, group: 'officers', section, owner, label: `${school} title`, kind: 'title', base: title });
    }
    add({
      key: `${prefix}.place`, group: 'officers', section, owner, label: 'Title sits', kind: 'choice', base: names.place,
      options: ['prefix', 'suffix'], hint: 'prefix: "Iron Marshal Marcia Galba". suffix: "Miral Nar Halq, Hand of the Family".',
    });
    add({ key: `${prefix}.given`, group: 'officers', section, owner, label: 'Given names', kind: 'list', base: [...names.given], size: STOCK_GIVEN, hint: HINTS.given });
    add({ key: `${prefix}.family`, group: 'officers', section, owner, label: 'Family names', kind: 'list', base: [...names.family], size: STOCK_FAMILIES, hint: HINTS.family });
  };

  /* --- Powers ---------------------------------------------------------- */
  for (const [pid, p] of Object.entries(base.powers)) {
    const own = { section: pid, owner: pid };
    const k = `powers.${pid}`;
    add({ ...own, key: `${k}.id`, group: 'powers', label: 'Id', kind: 'id', base: p.id, hint: HINTS.id });
    add({ ...own, key: `${k}.name`, group: 'powers', label: 'Name', kind: 'name', base: p.name });
    add({ ...own, key: `${k}.title`, group: 'powers', label: 'Leader title', kind: 'title', base: p.title, hint: 'What the counsellor calls the player.' });
    for (const [eid, e] of Object.entries(p.estates)) {
      add({ ...own, key: `${k}.${pathKey('estates', eid, 'name')}`, group: 'powers', label: `Estate · ${eid.split(':').pop()}`, kind: 'name', base: e.name });
    }
    for (const [kind, template] of Object.entries(p.fleets)) {
      add({ ...own, key: `${k}.${pathKey('fleets', kind)}`, group: 'powers', label: `Formation · ${roleOf('fleetKinds', kind)}`, kind: 'term', base: template, hint: HINTS.formations });
    }
    add({ ...own, key: `${k}.doctrine`, group: 'lore', facet: 'doctrine', label: 'Doctrine', kind: 'lore', base: p.doctrine });
    add({ ...own, key: `${k}.voice`, group: 'lore', facet: 'voice', label: 'Voice', kind: 'lore', base: p.voice, hint: HINTS.voice });
    p.redLines.forEach((line, i) =>
      add({ ...own, key: `${k}.redLines.${i}`, group: 'lore', facet: 'redLine', label: `Red line ${i + 1}`, kind: 'lore', base: line }),
    );
    p.compulsions.forEach((line, i) =>
      add({
        ...own, key: `${k}.compulsions.${i}`, group: 'lore', facet: 'compulsion', label: `Compulsion ${i + 1}`, kind: 'lore', base: line,
        hint: 'The core keeps what it demands and when it fires; a skin words it.',
      }),
    );
    stock(`${k}.names`, pid, pid, p.names);
  }
  stock('independents.names', null, 'independents', base.independents.names);

  /* --- Map --------------------------------------------------------------- */
  const corePlaces = new Map(seed.systems.map((s) => [s.id, s]));
  const regions = Object.keys(base.sectors);
  for (const [region, s] of Object.entries(base.sectors)) {
    add({ key: pathKey('sectors', region, 'name'), group: 'map', section: region, owner: null, label: 'Region', kind: 'name', base: s.name });
  }
  const places: SurfacePlace[] = [];
  for (const [sid, s] of Object.entries(base.systems)) {
    const core = corePlaces.get(sid);
    const region = core?.sector ?? regions[0] ?? '';
    places.push({
      id: sid, name: s.name, region, x: s.coords.x, y: s.coords.y,
      controller: core?.controllerFactionId ?? null, home: core?.homeFactionId ?? null,
      ground: core?.worldType ?? 'arid', routes: core?.hyperlaneEdges ?? [],
    });
    add({ key: `systems.${sid}.id`, group: 'map', section: region, owner: core?.controllerFactionId ?? null, label: `${sid} · id`, kind: 'id', base: s.id, row: sid, field: 'id', hint: HINTS.id });
    add({ key: `systems.${sid}.name`, group: 'map', section: region, owner: core?.controllerFactionId ?? null, label: `${sid} · name`, kind: 'name', base: s.name, row: sid, field: 'name' });
  }

  /* --- Words: every role the lexicon names ------------------------------ */
  const families: string[] = [];
  for (const [fam, rows] of Object.entries(base.lexicon)) {
    if (fam === 'meanings') continue;
    families.push(fam);
    for (const [row, entry] of Object.entries(rows as Record<string, Record<string, unknown>>)) {
      for (const [field, v] of Object.entries(entry)) {
        const key = pathKey('lexicon', fam, row, field);
        const common = { key, group: 'words' as const, section: fam, owner: null, label: `${row} · ${field}`, row, field };
        if (Array.isArray(v)) add({ ...common, kind: 'list', base: v as string[], hint: field === 'synonyms' ? HINTS.synonyms : undefined });
        else if (typeof v === 'string') add({ ...common, kind: field === 'id' ? 'id' : 'term', base: v, hint: field === 'id' ? HINTS.id : undefined });
      }
    }
  }

  /* --- Sentences: what each id means, said in the skin's voice ----------- */
  for (const [table, rows] of Object.entries(base.lexicon.meanings)) {
    for (const [row, text] of Object.entries(rows as Record<string, string>)) {
      add({
        key: pathKey('lexicon', 'meanings', table, row), group: 'lore', facet: 'sentence', section: table, owner: null,
        label: `${table} · ${row}`, kind: 'lore', base: text, row, field: table,
        hint: text.includes('{') ? 'A {name} in braces is a number the game fills in; keep it.' : undefined,
      });
    }
  }

  return {
    base,
    entries,
    byKey: new Map(entries.map((e) => [e.key, e])),
    powers: seed.factions.map((f) => ({ id: f.id, name: base.powers[f.id]?.name ?? f.name, color: f.displayColor })),
    regions,
    places,
    families,
  };
}
