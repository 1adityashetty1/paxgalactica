import { NAME_STOCKS, RIM_STOCK, type NameStock } from '../domain/command.js';
import { RIM_EVENT_KINDS } from '../domain/events.js';
import { FLEET_KINDS, fleetName, type FleetKind } from '../domain/fleets.js';
import { HULL_CLASSES } from '../domain/hulls.js';
import { WORLD_TYPES } from '../domain/state.js';
import { createSeedState } from '../seed/scenario.js';
import { RIM_ART_KINDS } from '../ui/outcomeart.js';
import { OUTCOME_ART, SkinSchema, type NameStockWords, type Skin } from './schema.js';
import { PAX_LEXICON } from './words.js';

/**
 * The Pax Galactica skin.
 *
 * Its lexicon is `PAX_LEXICON`, the words the game writes in (`words.ts`).
 * Everything else is read off the tables that still hold it — the seed's
 * names and sheets, the name stocks, each power's fleet names as `fleetName`
 * gives them — so nothing here is written out a second time and this skin
 * cannot drift from the game it describes. Those tables move into the skin in
 * phase 5, when the seed splits into a core and its words.
 */

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

  return SkinSchema.parse({
    id: 'paxgalactica',
    name: 'Pax Galactica',
    lexicon: PAX_LEXICON,
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
        RIM_EVENT_KINDS.map((k) => [k, (RIM_ART_KINDS as readonly string[]).includes(k) ? `drawn:scene/${k}` : null]),
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
