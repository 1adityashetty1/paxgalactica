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
 * The default lexicon's words that are ordinary English in any setting, so a
 * scan for leaks cannot police them.
 *
 * The test is appendix A's low-fantasy skin: a word it would keep unchanged —
 * a garrison, a blockade, a marriage, a ceasefire, unrest, a writ — names a
 * thing both settings have, and a literal using it is not evidence that the
 * lexicon was bypassed. A word it would change — a hull, a lane, an orbit, a
 * factory, an ion storm — is setting, and every literal carrying it is a
 * leak. The people's kinds are here because `officer` and `operative` are
 * also the game's own words for its rosters, which no lexicon family yet
 * names.
 */
export const ORDINARY_WORDS: readonly string[] = [
  // places and phases; and an action "lands" when the turn ends, which no scan can tell from a fleet landing
  'garrison', 'garrisons', 'ground', 'strike', 'assault', 'land', 'lands', 'landed',
  // the people a power keeps or holds
  'prisoners', 'officer', 'operative', 'hostage', 'defector',
  // paper and stuff
  'writ', 'surety', 'relic', 'contraband', 'ore', 'ciphers', 'arsenal', 'black market',
  // treaties
  'non aggression', 'mutual defense', 'trade accord', 'tribute', 'ceasefire', 'cession', 'contract', 'coalition', 'marriage',
  // orders
  'decree', 'political maneuver', 'espionage', 'counter intelligence', 'blockade', 'treaty ratification', 'garrison raising', 'fortification',
  // events
  'Unrest', 'Border incident', 'Shortage', 'Mutiny', 'Volunteers', 'Envoys of peace', 'Crackdown', 'A price on your head', 'Turned contact', 'Show of force',
  // notes
  'Most-favoured terms', 'Line of credit', 'Sanctuary', 'Safe passage',
];

/**
 * Words Pax Galactica writes that no role in the lexicon names yet. The scan
 * looks for them so they cannot hide by being absent from the lexicon; each
 * leaves this list when it is given a role or reworded away. `lift` is not
 * here because it is also the verb a toll is lifted by, and `land` is a verb
 * the lexicon has, whose noun ("land changes hands") a scan cannot tell apart.
 */
export const UNROLED_WORDS: readonly string[] = [
  'admiral', 'admirals', 'captain', 'captains', 'dock', 'docks',
  'convoy', 'convoys', 'boarding', 'pilot', 'pilots', 'galactic', 'starship', 'starships',
];

/** The words a leak scan looks for: the default lexicon's, less its units and the ordinary ones, and the unroled ones. */
export function settingWords(): string[] {
  const ordinary = new Set(ORDINARY_WORDS.map((w) => w.toLowerCase()));
  return [...paxWords({ units: false }).filter((w) => !ordinary.has(w.toLowerCase())), ...UNROLED_WORDS];
}
