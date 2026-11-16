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
    out[family] = Object.fromEntries(
      Object.entries(entries as Record<string, Record<string, unknown>>).map(([key, entry], i) => {
        const id = `qx${family.toLowerCase()}${i}`;
        const w = `${tag}${i}`;
        const swapped: Record<string, unknown> = { ...entry, word: w, synonyms: [] };
        if ('id' in entry) swapped.id = id;
        if ('plural' in entry) swapped.plural = `${w}s`;
        if ('unit' in entry) swapped.unit = `${w}u`;
        return [key, swapped];
      }),
    );
  }
  return out as unknown as Words;
}

/** Every word and phrase the default lexicon gives, for a scan to look for. */
export function paxWords(): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(PAX_LEXICON)) {
    for (const entry of Object.values(entries as Record<string, Record<string, unknown>>)) {
      for (const k of ['word', 'plural', 'unit'] as const) if (typeof entry[k] === 'string') found.add(entry[k] as string);
      for (const s of (entry.synonyms as string[] | undefined) ?? []) found.add(s);
    }
  }
  return [...found];
}
