import type { Words } from './lexicon.js';
import { PAX_LEXICON } from './words.js';

/**
 * The null lexicon: every word a sentinel no English sentence contains.
 *
 * `docs/design-2026-11-15-skins.md`, *"Leak prevention"* 3. The engine run
 * under it writes `Qxunits0` where it would have written "battleship", so any
 * Pax Galactica word still in its output did not come from the lexicon, and is
 * a word a skin could not change. The sentinels are built from the default
 * lexicon's shape, so a role added there is covered here with no edit.
 *
 * Each sentinel is letters and digits only — no underscore, no ordinal — so
 * it is a word `skinViolations` accepts, and the null lexicon is a lexicon any
 * skin could have.
 */
export function nullLexicon(): Words {
  const out: Record<string, Record<string, object>> = {};
  for (const [family, entries] of Object.entries(PAX_LEXICON)) {
    const tag = `Qx${family}`;
    if (family === 'meanings') {
      out[family] = Object.fromEntries(
        Object.entries(entries as Record<string, Record<string, string>>).map(([table, rows]) => [
          table,
          Object.fromEntries(Object.keys(rows).map((key, i) => [key, `Qx${table}${i}`])),
        ]),
      );
      continue;
    }
    out[family] = Object.fromEntries(
      Object.entries(entries as Record<string, Record<string, unknown>>).map(([key, entry], i) => {
        const id = `qx${family.toLowerCase()}${i}`;
        const w = `${tag}${i}`;
        if ('base' in entry) return [key, { base: w, s: `${w}s`, past: `${w}ed`, ing: `${w}ing`, synonyms: [] }];
        const swapped: Record<string, unknown> = { ...entry, word: w, synonyms: [] };
        if ('id' in entry) swapped.id = id;
        if ('plural' in entry) swapped.plural = `${w}s`;
        if ('unit' in entry) swapped.unit = `${w}u`;
        if ('from' in entry) swapped.from = `${w}from`;
        if ('wanted' in entry) swapped.wanted = `${w}wanted`;
        for (const k of ['phase', 'effect', 'known'] as const) if (k in entry) swapped[k] = `${w}${k}`;
        return [key, swapped];
      }),
    );
  }
  return out as unknown as Words;
}

/**
 * Every word and phrase the default lexicon gives, for a scan to look for.
 *
 * An asset kind's `unit` ("set", "key", "person") is left out unless asked
 * for: it is copied onto each asset as it is made and shown from there, so a
 * literal "set" in the source is almost never that unit.
 */
export function paxWords(options: { units?: boolean } = {}): string[] {
  const found = new Set<string>();
  const fields = options.units === false ? (['word', 'plural', 'base', 's', 'past', 'ing'] as const) : (['word', 'plural', 'unit', 'base', 's', 'past', 'ing'] as const);
  for (const entries of Object.values(PAX_LEXICON)) {
    for (const entry of Object.values(entries as Record<string, Record<string, unknown>>)) {
      for (const k of fields) if (typeof entry[k] === 'string') found.add(entry[k] as string);
      for (const s of (entry.synonyms as string[] | undefined) ?? []) found.add(s);
    }
  }
  return [...found];
}

/**
 * The default lexicon's words that are neutral in any setting, so a scan for
 * leaks does not police them.
 *
 * **The test is four periods and the thing itself** (audit of 2026-11-16): a
 * word is neutral when a modern show about Three Kingdoms China, the Middle
 * Byzantine Empire, the Seven Years' War and the First World War could all
 * use it without losing the viewer — because the thing it names existed
 * there, whenever the word was coined. A black market passes, since illicit
 * goods were sold in Byzantium; a torpedo fails, since the device did not
 * exist.
 *
 * **And it may not presume ships.** A skin can be landlocked, its forces an
 * army on roads, so every naval word is setting even though all four periods
 * had navies: ship, hull, fleet, crew, sail, yards, voyage, a capital ship.
 * Hull classes, terrains and Rim events are setting in every form (see
 * `settingIds`), and so is anything too modern: a factory, a chamber of
 * commerce, a power plant, a research lab.
 *
 * The words below pass. "Land" is here for another reason: an action "lands"
 * when the turn ends, which no scan can tell from troops landing.
 */
export const ORDINARY_WORDS: readonly string[] = [
  // people
  'prisoners', 'officer', 'officers', 'operative', 'operatives', 'notable', 'notables', 'hostage', 'defector',
  // treaties
  'non aggression', 'mutual defense', 'mutual defence', 'trade accord', 'tribute', 'basing rights', 'ceasefire', 'cession',
  'contract', 'coalition', 'marriage',
  // orders
  'decree', 'political maneuver', 'espionage', 'counter intelligence', 'blockade', 'commerce raiding', 'treaty ratification',
  'garrison raising', 'fortification', 'construction infrastructure',
  // notes
  'Most-favoured terms', 'Line of credit', 'Sanctuary', 'Safe passage',
  // things held, and fixtures that existed in all four
  'dossier', 'charts', 'writ', 'surety', 'ciphers', 'ore', 'salvage', 'contraband', 'relic', 'cargo',
  'military base', 'university', 'arsenal', 'black market', 'security bureau', 'civil service',
  // places, phases and schools
  'garrison', 'garrisons', 'hub', 'hubs', 'sector', 'sectors', 'ground', 'strike', 'assault', 'convoy', 'lineofbattle',
  // an action lands
  'land', 'lands', 'landed',
];

/**
 * Words Pax Galactica writes that no role in the lexicon names yet. The scan
 * looks for them so they cannot hide by being absent from the lexicon; each
 * leaves this list when it is given a role or reworded away. `lift` is not
 * here because it is also the verb a toll is lifted by, and `land` is a verb
 * the lexicon has, whose noun ("land changes hands") a scan cannot tell apart.
 */
export const UNROLED_WORDS: readonly string[] = [
  'admiral', 'admirals', 'dock', 'docks', 'boarding', 'pilot', 'pilots', 'galactic', 'starship', 'starships',
];

/**
 * The core ids that are themselves setting: every hull class, terrain and Rim
 * event. `torpedo_boat`, `earthnight` and `ion_storm` are this skin's words in
 * id form, and a model or player shown one is shown Pax Galactica whatever the
 * lexicon says. Phase 3 gives them marked ids (`u_strike`, `t_guile`,
 * `ev_lane_closure`); until then a scan counts every one it finds.
 */
export function settingIds(): string[] {
  return [...Object.keys(PAX_LEXICON.units), ...Object.keys(PAX_LEXICON.terrains), ...Object.keys(PAX_LEXICON.rimEvents)];
}

/**
 * The words a leak scan looks for: the default lexicon's, less its units and
 * the ordinary ones; the unroled ones; and the setting ids, which no list of
 * ordinary words can excuse.
 */
export function settingWords(): string[] {
  const ordinary = new Set(ORDINARY_WORDS.map((w) => w.toLowerCase()));
  return [...paxWords({ units: false }).filter((w) => !ordinary.has(w.toLowerCase())), ...UNROLED_WORDS, ...settingIds()];
}
