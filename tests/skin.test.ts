import { describe, expect, it } from 'vitest';
import { NAME_STOCKS } from '../src/domain/command.js';
import { FLEET_KINDS, fleetName, ordinal } from '../src/domain/fleets.js';
import { HULL_CLASSES, HULL_SPEC } from '../src/domain/hulls.js';
import { PAX_LEXICON } from '../src/skin/words.js';
import { createSeedState } from '../src/seed/scenario.js';
import { paxGalactica } from '../src/skin/paxgalactica.js';
import {
  checkSkin,
  coreSlotsOf,
  fleetNameFrom,
  lexiconIndex,
  MARKED_ID,
  ORDINAL_ID,
  SkinSchema,
  skinViolations,
  STOCK_FAMILIES,
  STOCK_GIVEN,
  type Skin,
} from '../src/skin/schema.js';

const core = () => coreSlotsOf(createSeedState('meridian'));
const copy = (): Skin => structuredClone(paxGalactica());

describe('the Pax Galactica skin', () => {
  it('parses, and names every slot the core has and no other', () => {
    expect(() => SkinSchema.parse(paxGalactica())).not.toThrow();
    expect(skinViolations(paxGalactica(), core())).toEqual([]);
    expect(Object.keys(paxGalactica().powers)).toHaveLength(5);
    expect(Object.keys(paxGalactica().systems)).toHaveLength(25);
    expect(Object.keys(paxGalactica().sectors)).toHaveLength(4);
  });

  it('is read off the game\'s own tables', () => {
    const skin = paxGalactica();
    expect(skin.lexicon).toEqual(PAX_LEXICON);
    for (const f of createSeedState('meridian').factions) {
      expect(skin.powers[f.id]!.name).toBe(f.name);
      expect(skin.powers[f.id]!.compulsions).toEqual(f.compulsions.map((c) => c.text));
      for (const kind of FLEET_KINDS) {
        for (let n = 1; n <= 25; n++) {
          expect(fleetNameFrom(skin.powers[f.id]!.fleets[kind]!, n, ordinal)).toBe(fleetName(f.id, { number: n, kind }));
        }
      }
    }
  });

  it('keeps every stock at the sizes the draw is indexed by', () => {
    for (const stock of Object.values(NAME_STOCKS)) {
      expect(stock.first).toHaveLength(STOCK_GIVEN);
      expect(stock.last).toHaveLength(STOCK_FAMILIES);
    }
  });

  it('maps every id out and back in every family', () => {
    const { toSkin, toCore } = lexiconIndex(paxGalactica().lexicon, 'units');
    for (const h of HULL_CLASSES) expect(toCore.get(toSkin.get(h)!)).toBe(h);
    expect(toCore.get('torpedo boat')).toBe('torpedo_boat');
  });
});

describe('what the schema refuses', () => {
  it('a family with a role left unnamed', () => {
    const skin = copy();
    delete (skin.lexicon.units as Record<string, unknown>)['lifter'];
    expect(() => SkinSchema.parse(skin)).toThrow();
  });

  it('a stock of the wrong size', () => {
    const skin = copy();
    skin.powers.vigil!.names.family.pop();
    expect(() => SkinSchema.parse(skin)).toThrow();
  });
});

describe('what skinViolations catches', () => {
  it('a world added, a power dropped, an estate the core does not have', () => {
    const skin = copy();
    skin.systems['ark-99'] = { id: 'ark-99', name: 'Nowhere', coords: { x: 0, y: 0 } };
    delete skin.powers.drajk;
    delete skin.art.portraits.drajk;
    skin.powers.vigil!.estates['vigil:navy'] = { name: 'the Navy' };
    expect(skinViolations(skin, core())).toEqual(
      expect.arrayContaining([
        'powers: no words for drajk',
        'systems: words for ark-99, which the core does not have',
        'portraits: no words for drajk',
        "vigil's estates: words for vigil:navy, which the core does not have",
      ]),
    );
  });

  it('a red line worded twice, or left out', () => {
    const skin = copy();
    skin.powers.ojjul!.redLines.pop();
    expect(skinViolations(skin, core()).some((v) => v.startsWith('ojjul words'))).toBe(true);
  });

  it('two roles sharing an id or a word', () => {
    const skin = copy();
    skin.lexicon.units.escort!.id = 'battleship';
    skin.lexicon.terrains.ice!.synonyms = ['Arid'];
    const found = skinViolations(skin, core());
    expect(found).toContain('units: battleship and escort share the id battleship');
    expect(found).toContain('terrains: arid and ice share the word "arid"');
  });

  it('two schools under one title', () => {
    const skin = copy();
    skin.powers.vigil!.names.titles.gunnery = skin.powers.vigil!.names.titles.lineofbattle!;
    expect(skinViolations(skin, core())).toContain('vigil gives two schools one title');
  });

  it('a family name in two stocks', () => {
    const skin = copy();
    skin.powers.vigil!.names.family[0] = skin.powers.meridian!.names.family[0]!;
    expect(skinViolations(skin, core()).some((v) => v.startsWith(`the family ${skin.powers.meridian!.names.family[0]} is in both`))).toBe(true);
  });

  it('a word that could pass for a core id, and an id that could', () => {
    const skin = copy();
    skin.systems['ark-1']!.name = 'Arkane_Prime';
    skin.sectors['Arkane Drift']!.name = 's01';
    skin.lexicon.units.battleship!.id = 'u_line';
    const found = skinViolations(skin, core());
    expect(found).toContain('"Arkane_Prime" carries an underscore');
    expect(found).toContain('"s01" carries what reads as a core id');
    expect(found).toContain('the skin id u_line could pass for a core id');
  });
});

describe('the marks', () => {
  it('tell a core id from today\'s ids', () => {
    for (const id of ['u_line', 'ev_uprising', 'k_plans', 'sch_steady', 'tt_passage']) expect(MARKED_ID.test(id)).toBe(true);
    for (const id of ['torpedo_boat', 'ion_storm', 'trade_accord', 'basing_rights', 'stock_exchange']) expect(MARKED_ID.test(id)).toBe(false);
    for (const id of ['f0', 's24', 'r3']) expect(ORDINAL_ID.test(id)).toBe(true);
    for (const id of ['ark-1', 'meridian', 'Sekkar Gate']) expect(ORDINAL_ID.test(id)).toBe(false);
  });
});

describe('a skin as it arrives', () => {
  it('is parsed before it is checked, so a malformed one is a finding and not a crash', () => {
    const core = coreSlotsOf(createSeedState('meridian'));
    const broken = structuredClone(paxGalactica()) as unknown as { lexicon: { places: { node: { alt: { word: string; plural?: string } } } } };
    delete broken.lexicon.places.node.alt.plural;
    const { skin, issues } = checkSkin(broken, core);
    expect(skin).toBeNull();
    expect(issues.some((i) => i.startsWith('lexicon.places.node.alt.plural'))).toBe(true);
    expect(checkSkin(paxGalactica(), core)).toEqual({ skin: paxGalactica(), issues: [] });
  });
});

