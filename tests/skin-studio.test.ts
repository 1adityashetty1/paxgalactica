import { describe, expect, it } from 'vitest';
import { paxGalactica } from '../src/skin/paxgalactica.js';
import { SkinSchema } from '../src/skin/schema.js';
import { checkDraft } from '../src/skin/studio/check.js';
import {
  SkinDraftSchema,
  emptyDraft,
  idFor,
  restamped,
  serializeDraft,
  withEntry,
  withRename,
  withoutEntry,
  type SkinDraft,
} from '../src/skin/studio/draft.js';
import { applyRenames, composeSkin, resolveDraft, suggestTerms } from '../src/skin/studio/resolve.js';
import { buildSurface, pathKey, pathOf } from '../src/skin/studio/surface.js';

const surface = buildSurface();
const base = (key: string) => surface.byKey.get(key)!.base;
const compose = (d: SkinDraft) => {
  const r = resolveDraft(d, surface);
  return { resolved: r, skin: composeSkin(d, surface, r, idFor(d.name)) };
};
const issues = (d: SkinDraft) => {
  const { resolved, skin } = compose(d);
  return checkDraft(d, surface, resolved, skin);
};
const codes = (d: SkinDraft) => issues(d).map((i) => i.code);

/** Read a path into a skin the way `composeSkin` writes one. */
const at = (skin: unknown, key: string): unknown =>
  pathOf(key).reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], skin);

/**
 * The studio's base is the default skin, read live. These pin that every
 * entry is a real path into a `Skin` holding exactly the base it shows, and
 * that the studio reaches what a skin is made of.
 */
describe('the surface is the default skin', () => {
  it('every entry is a path into the skin, holding its base', () => {
    const pax = paxGalactica();
    for (const e of surface.entries) expect(at(pax, e.key), e.key).toEqual(e.base);
    expect(surface.byKey.size).toBe(surface.entries.length);
  });

  it('reaches every power, system, sector, stock, lexicon family and sentence table', () => {
    const pax = paxGalactica();
    for (const [id, p] of Object.entries(pax.powers)) {
      for (const k of ['id', 'name', 'title', 'voice', 'doctrine', 'names.given', 'names.family']) {
        expect(surface.byKey.has(`powers.${id}.${k}`), `${id}.${k}`).toBe(true);
      }
      p.redLines.forEach((_, i) => expect(surface.byKey.has(`powers.${id}.redLines.${i}`)).toBe(true));
    }
    for (const id of Object.keys(pax.systems)) expect(surface.byKey.has(`systems.${id}.name`)).toBe(true);
    for (const sec of Object.keys(pax.sectors)) expect(surface.byKey.has(`sectors.${sec}.name`)).toBe(true);
    for (const fam of Object.keys(pax.lexicon).filter((f) => f !== 'meanings')) expect(surface.families).toContain(fam);
    for (const [table, rows] of Object.entries(pax.lexicon.meanings)) {
      for (const row of Object.keys(rows)) expect(surface.byKey.has(pathKey('lexicon', 'meanings', table, row)), row).toBe(true);
    }
  });

  it('an empty draft composes to Pax Galactica, which passes the game’s checks', () => {
    const { skin } = compose(emptyDraft('Pax Galactica'));
    expect(skin).toEqual({ ...paxGalactica(), name: 'Pax Galactica', id: 'pax_galactica' });
    expect(SkinSchema.safeParse(skin).success).toBe(true);
    expect(issues(emptyDraft('Pax Galactica'))).toEqual([]);
  });
});

describe('renames', () => {
  it('rewrite whole words only, longest first', () => {
    const r = { Vigil: 'Concord', 'Iron Vigil Remnant': 'Ashen Throne', Nar: 'Ves' };
    expect(applyRenames('The Iron Vigil Remnant and the Vigil.', r).text).toBe('The Ashen Throne and the Concord.');
    expect(applyRenames('Narrow Nar houses, Vigilant.', r).text).toBe('Narrow Ves houses, Vigilant.');
  });

  it('reach every unwritten entry and never an id or an authored one', () => {
    let d = withRename(emptyDraft('t'), 'Vigil', 'Concord');
    let r = resolveDraft(d, surface);
    expect(r.get('powers.vigil.name')).toMatchObject({ value: 'Iron Concord Remnant', state: 'derived' });
    expect(r.get('powers.vigil.id')).toMatchObject({ value: 'vigil', state: 'base' });
    d = withEntry(d, 'powers.vigil.name', 'The Vigil Eternal', base('powers.vigil.name'));
    r = resolveDraft(d, surface);
    expect(r.get('powers.vigil.name')).toMatchObject({ value: 'The Vigil Eternal', state: 'authored' });
  });

  it('carry a house through its family names', () => {
    const r = resolveDraft(withRename(emptyDraft('t'), 'Nar', 'Ves'), surface);
    const fam = r.get('powers.ojjul.names.family')!.value as string[];
    expect(fam.some((f) => f.startsWith('Ves '))).toBe(true);
    expect(fam.some((f) => f.startsWith('Nar '))).toBe(false);
  });

  it('are suggested from the skin’s own names, with their reach', () => {
    const terms = suggestTerms(surface).map((s) => s.term);
    for (const t of ['Vantic', 'Torrek', 'Nar']) expect(terms).toContain(t);
    expect(terms).not.toContain('Gate');
  });
});

describe('a draft is held to the game’s rules', () => {
  it('a word with an underscore is refused, pinned to its cell', () => {
    const key = 'lexicon.units.battleship.word';
    const found = issues(withEntry(emptyDraft('t'), key, 'ship_of_line', base(key)));
    expect(found.find((i) => i.code === 'violation')?.key).toBe(key);
  });

  it('a stock must keep its size', () => {
    const key = 'powers.vigil.names.given';
    const given = base(key) as string[];
    const found = issues(withEntry(emptyDraft('t'), key, given.slice(1), given));
    expect(found.find((i) => i.code === 'schema')?.key).toBe(key);
  });

  it('two roles in one family cannot share a word', () => {
    const key = 'lexicon.units.escort.word';
    expect(codes(withEntry(emptyDraft('t'), key, 'battleship', base(key)))).toContain('violation');
  });

  it('a fleet name keeps its number', () => {
    const key = Object.keys(paxGalactica().powers.vigil!.fleets).map((k) => `powers.vigil.fleets.${k}`)[0]!;
    expect(codes(withEntry(emptyDraft('t'), key, 'The Home Fleet', base(key)))).toContain('schema');
  });

  it('a family name may not be hyphenated, nor shared between powers', () => {
    const key = 'powers.vigil.names.family';
    const fam = base(key) as string[];
    expect(codes(withEntry(emptyDraft('t'), key, ['Galba-Varro', ...fam.slice(1)], fam))).toContain('hyphen');
    const meridian = base('powers.meridian.names.family') as string[];
    expect(codes(withEntry(emptyDraft('t'), key, [meridian[0]!, ...fam.slice(1)], fam))).toContain('violation');
  });

  it('an old name left in hand-written text is a leak', () => {
    let d = withRename(emptyDraft('t'), 'Vigil', 'Concord');
    d = withEntry(d, 'powers.vigil.doctrine', 'The Vigil endures.', base('powers.vigil.doctrine'));
    expect(issues(d).find((i) => i.code === 'leak')?.key).toBe('powers.vigil.doctrine');
  });

  it('an override written against an old base is stale until kept', () => {
    const d: SkinDraft = { ...emptyDraft('t'), entries: { 'powers.vigil.title': { value: 'Lord Protector', base: 'Grand Marshal' } } };
    expect(issues(d).find((i) => i.code === 'stale')?.key).toBe('powers.vigil.title');
    expect(codes(restamped(d, 'powers.vigil.title', base('powers.vigil.title')))).not.toContain('stale');
  });
});

describe('the draft file', () => {
  it('stores only differences, and setting a value back drops the override', () => {
    const b = base('powers.vigil.title');
    let d = withEntry(emptyDraft('t'), 'powers.vigil.title', 'Lord Protector', b);
    expect(Object.keys(d.entries)).toEqual(['powers.vigil.title']);
    d = withEntry(d, 'powers.vigil.title', b, b);
    expect(d.entries).toEqual({});
    expect(withoutEntry(d, 'nothing')).toBe(d);
  });

  it('serialises with sorted keys and round-trips', () => {
    let d = withRename(withRename(emptyDraft('t'), 'Vigil', 'Concord'), 'Arkane', 'Halde');
    d = withEntry(d, 'systems.tor-3.name', 'Caldor', 'Vantic');
    const text = serializeDraft(d);
    expect(text.indexOf('"Arkane"')).toBeLessThan(text.indexOf('"Vigil"'));
    expect(serializeDraft(SkinDraftSchema.parse(JSON.parse(text)))).toBe(text);
  });

  it('names a skin with an id the schema accepts', () => {
    expect(idFor('Ashen Reach')).toBe('ashen_reach');
    expect(idFor('  The 2nd Rim! ')).toBe('the_2nd_rim');
  });
});
