import type { WorldState } from '../../src/domain/state.js';
import { SAY_TOKENS } from '../../src/skin/lexicon.js';
import { ORDINARY_WORDS, settingWords } from '../../src/skin/null.js';
import { hits } from './leaks.js';

/**
 * The runtime half of leak prevention (`docs/design-2026-11-15-skins.md`,
 * *"Leak prevention"* 3): what the engine, the help pages and the prompts write
 * while the null lexicon is in force, searched for the default skin's setting
 * words. Every word the lexicon gives is a sentinel there, so a setting word in
 * the output came from somewhere else — a literal, a table read at module
 * load, a prompt file — and is one a skin could not change.
 *
 * **The scenario's own words are taken out first.** Names, titles, voices,
 * doctrines, red lines and the seed's texts are the skin's too, but they move
 * into it in phase 5, with the seed; until then the world carries Pax
 * Galactica's, and "Arkane Free Worlds" says "worlds" because it is a name.
 */

/** Every string under a value, in order: a briefing's lines, a report's notes. */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsIn(v, out);
  return out;
}

/** The fields that hold a name or a sheet's prose, wherever they sit in a world. */
const SCENARIO_FIELDS = new Set(['name', 'title', 'voice', 'doctrine', 'sector', 'redLines', 'compulsions']);

/**
 * The scenario's strings in a world, longest first: every name anywhere (a
 * power's, a world's, a person's, a fleet's, an estate's), each sheet's title,
 * voice, doctrine and lines, and the texts the seed wrote on its assets,
 * commitments and treaties, which are the scenario's opening board.
 */
export function scenarioStrings(state: WorldState, seed?: WorldState): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (SCENARIO_FIELDS.has(k)) for (const s of stringsIn(v)) if (s.trim().length > 1) out.add(s);
        walk(v);
      }
    }
  };
  walk(state);
  if (seed) {
    walk(seed);
    // The opening board's texts and the sheets whole: a commodity's description,
    // a seeded asset's, the line the Rim wakes to.
    for (const s of stringsIn([seed.factions, seed.assets, seed.commitments, seed.treaties, seed.debts, seed.eventLog])) {
      if (s.trim().length > 12) out.add(s);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** `text` with every scenario string blanked, so only what the code wrote is left to search. */
export function withoutScenario(text: string, scenario: readonly string[]): string {
  let out = text;
  for (const s of scenario) if (out.includes(s)) out = out.split(s).join(' ');
  return out;
}

/** The distinct setting words in `texts`, once the scenario's are out. */
export function leakedWords(texts: readonly string[], scenario: readonly string[]): string[] {
  const found = hits(
    // An id in the output is output: a briefing's `kind: 'derelict'` reaches the client as Pax Galactica's.
    texts.map((t) => ({ file: '', line: 0, text: withoutScenario(t, scenario), say: false })),
    settingWords(),
    SAY_TOKENS,
    ORDINARY_WORDS,
  );
  return [...new Set(found.map((h) => h.word))].sort();
}
