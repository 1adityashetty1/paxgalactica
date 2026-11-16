import { ASSET_ARCHETYPES } from '../domain/assets.js';
import { BATTLE_PHASES } from '../domain/battle.js';
import { COMMANDER_ARCHETYPES, NAME_STOCKS, RIM_STOCK, type NameStock } from '../domain/command.js';
import { NOTE_KINDS, NOTE_TITLE, TREATY_TYPES } from '../domain/diplomacy.js';
import { DURATION_CATEGORIES } from '../domain/duration.js';
import { RIM_EVENT_TITLE } from '../domain/events.js';
import { FLEET_KINDS, fleetName, type FleetKind } from '../domain/fleets.js';
import { HULL_CLASSES, HULL_SPEC } from '../domain/hulls.js';
import { WORLD_TYPES } from '../domain/state.js';
import { createSeedState } from '../seed/scenario.js';
import { RIM_ART_KINDS } from '../ui/outcomeart.js';
import { worldTypeLabel } from '../ui/worldtext.js';
import { OUTCOME_ART, SkinSchema, type NameStockWords, type Skin } from './schema.js';

/**
 * The Pax Galactica skin: today's words, read off the tables that hold them.
 *
 * Nothing here is written out a second time. Each word comes from the table
 * the game shows it from — a hull's `label`, a world type's on-screen name,
 * a Rim event's title, a note's title, the seed's names and sheets, the name
 * stocks, each power's fleet names as `fleetName` gives them — so this skin
 * cannot drift from the game it describes. Until phase 2 routes the game's
 * text through a skin, it is a description of today's words, checked; it is
 * not yet read by anything that draws or prompts.
 *
 * Two families have no word table today and are shown by id: the order
 * categories and treaty types (with spaces for underscores) and the officer
 * schools (as the id). Those are today's values too, and phase 2 is where they
 * become words.
 *
 * The places and units of account have no table at all, because the game
 * writes them inline. They are the one part of this skin written here.
 */

const spaced = (id: string) => id.replace(/_/g, ' ');

function stockWords(stock: Readonly<NameStock>): NameStockWords {
  return { given: [...stock.first], family: [...stock.last], titles: { ...stock.titles }, place: stock.place };
}

/** A power's fleet names as `fleetName` gives them, with the number taken out. */
function fleetTemplates(factionId: string): Record<FleetKind, string> {
  const n = 7;
  const template = (name: string) => (name.includes(`${n}th`) ? name.replace(`${n}th`, '{nth}') : name.replace(String(n), '{n}'));
  return Object.fromEntries(
    FLEET_KINDS.map((kind) => [kind, template(fleetName(factionId, { number: n, kind }))]),
  ) as Record<FleetKind, string>;
}

function build(): Skin {
  const seed = createSeedState('meridian');
  const ids = <T extends string>(keys: readonly T[], entry: (k: T) => object) =>
    Object.fromEntries(keys.map((k) => [k, { id: k, synonyms: [], ...entry(k) }]));

  return SkinSchema.parse({
    id: 'paxgalactica',
    name: 'Pax Galactica',
    lexicon: {
      units: ids(HULL_CLASSES, (h) => ({ word: HULL_SPEC[h].label, plural: `${HULL_SPEC[h].label}s` })),
      terrains: ids(WORLD_TYPES, (t) => ({ word: worldTypeLabel(t) })),
      orderCategories: ids(DURATION_CATEGORIES, (c) => ({ word: spaced(c) })),
      assetKinds: ids(
        ASSET_ARCHETYPES.map((a) => a.kind),
        (k) => ({ word: spaced(k), unit: ASSET_ARCHETYPES.find((a) => a.kind === k)!.unit }),
      ),
      rimEvents: ids(Object.keys(RIM_EVENT_TITLE) as (keyof typeof RIM_EVENT_TITLE)[], (k) => ({ word: RIM_EVENT_TITLE[k] })),
      treatyTypes: ids(TREATY_TYPES, (t) => ({ word: spaced(t) })),
      schools: ids(COMMANDER_ARCHETYPES.map((a) => a.kind), (k) => ({ word: k })),
      noteKinds: ids(NOTE_KINDS, (k) => ({ word: NOTE_TITLE[k] })),
      phases: ids(BATTLE_PHASES, (p) => ({ word: p })),
      fleetKinds: ids(FLEET_KINDS, (k) => ({ word: fleetName('', { number: 7, kind: k }).replace(/^7th |\s7$/, '') })),
      places: {
        world: { word: 'world', plural: 'worlds' },
        system: { word: 'system', plural: 'systems' },
        sector: { word: 'sector', plural: 'sectors' },
        lane: { word: 'lane', plural: 'lanes', synonyms: ['hyperlane'] },
        jump: { word: 'jump', plural: 'jumps' },
        hub: { word: 'hub', plural: 'hubs' },
        orbit: { word: 'orbit', plural: 'orbits' },
        garrison: { word: 'garrison', plural: 'garrisons' },
        yards: { word: 'yards', plural: 'yards', synonyms: ['slipways'] },
        rim: { word: 'the Rim', plural: 'the Rim' },
      },
      accounts: {
        credits: { word: 'credit', plural: 'credits' },
        tons: { word: 'ton', plural: 'tons' },
      },
    },
    powers: Object.fromEntries(
      seed.factions.map((f) => [
        f.id,
        {
          id: f.id,
          name: f.name,
          title: f.title,
          voice: f.voice,
          doctrine: f.doctrine,
          redLines: [...f.redLines],
          compulsions: f.compulsions.map((c) => c.text),
          estates: Object.fromEntries((f.estates ?? []).map((e) => [e.id, { name: e.name }])),
          names: stockWords(NAME_STOCKS[f.id]!),
          fleets: fleetTemplates(f.id),
        },
      ]),
    ),
    independents: { names: stockWords(NAME_STOCKS[RIM_STOCK]!) },
    systems: Object.fromEntries(seed.systems.map((s) => [s.id, { id: s.id, name: s.name, coords: { ...s.coords } }])),
    sectors: Object.fromEntries([...new Set(seed.systems.map((s) => s.sector))].map((name) => [name, { name }])),
    art: {
      portraits: Object.fromEntries(seed.factions.map((f) => [f.id, `file:portraits/${f.id}.jpeg`])),
      terrains: Object.fromEntries(WORLD_TYPES.map((t) => [t, `drawn:world/${t}`])),
      units: Object.fromEntries(HULL_CLASSES.map((h) => [h, `drawn:glyph/${h}`])),
      rimEvents: Object.fromEntries(
        Object.keys(RIM_EVENT_TITLE).map((k) => [k, (RIM_ART_KINDS as readonly string[]).includes(k) ? `drawn:scene/${k}` : null]),
      ),
      outcomes: Object.fromEntries(
        OUTCOME_ART.map((k) => [
          k,
          k === 'refusal' || k === 'defiance' ? `drawn:outcome/${k}` : k === 'negotiation' ? 'file:events/negotiation.jpeg' : null,
        ]),
      ),
    },
  });
}

let built: Skin | null = null;

/** The default skin. Built once, from the tables, on first use. */
export function paxGalactica(): Skin {
  return (built ??= build());
}
