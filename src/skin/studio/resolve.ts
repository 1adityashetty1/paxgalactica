import type { Skin } from '../schema.js';
import { sameValue, type SkinDraft, type SkinValue } from './draft.js';
import { pathOf, type SkinEntry, type SkinSurface } from './surface.js';

/**
 * What a draft actually says, entry by entry, and the whole skin it makes.
 *
 * Three states, and the distinction is what the studio is for:
 *
 * - **base** — nothing in the draft reaches it; the default skin's words.
 * - **derived** — a rename rewrote it. Free, and usually most of a reskin.
 * - **authored** — written by hand in this draft. Renames never touch an
 *   authored entry: once you have written it, it is yours.
 */
export type EntryState = 'base' | 'derived' | 'authored';

export interface ResolvedEntry {
  entry: SkinEntry;
  value: SkinValue;
  state: EntryState;
  /** Authored against a base that has since changed. */
  stale: boolean;
  /** Renamed terms that rewrote it (derived) or that it still contains (authored). */
  terms: string[];
}

export type Resolved = ReadonlyMap<string, ResolvedEntry>;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regex over every term, longest first, so `Iron Vigil Remnant` is
 * replaced whole before `Vigil` gets a chance at its middle. Whole-word by
 * letters and digits rather than `\b`, which has no idea what a letter is
 * outside ASCII.
 */
export function renamePattern(terms: readonly string[]): RegExp | null {
  const list = [...new Set(terms.filter((t) => t.trim() !== ''))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(${list.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}

export function applyRenames(
  text: string,
  renames: Readonly<Record<string, string>>,
  pattern: RegExp | null = renamePattern(Object.keys(renames)),
): { text: string; terms: string[] } {
  if (!pattern) return { text, terms: [] };
  const terms = new Set<string>();
  const out = text.replace(pattern, (m) => {
    terms.add(m);
    return renames[m] ?? m;
  });
  return { text: out, terms: [...terms] };
}

/** Whole-word occurrences of each term in a text, for counts and leak checks. */
export function termsIn(text: string, pattern: RegExp | null): string[] {
  if (!pattern) return [];
  return [...new Set([...text.matchAll(pattern)].map((m) => m[1]!))];
}

const textsOf = (v: SkinValue): readonly string[] => (typeof v === 'string' ? [v] : v);

export function resolveDraft(draft: SkinDraft, surface: SkinSurface): Resolved {
  const pattern = renamePattern(Object.keys(draft.renames));
  const out = new Map<string, ResolvedEntry>();
  for (const entry of surface.entries) {
    const override = draft.entries[entry.key];
    if (override) {
      out.set(entry.key, {
        entry,
        value: override.value,
        state: 'authored',
        stale: !sameValue(override.base, entry.base),
        terms: textsOf(override.value).flatMap((t) => termsIn(t, pattern)),
      });
      continue;
    }
    if (!entry.lexical) {
      out.set(entry.key, { entry, value: entry.base, state: 'base', stale: false, terms: [] });
      continue;
    }
    const terms = new Set<string>();
    const map = (t: string): string => {
      const r = applyRenames(t, draft.renames, pattern);
      r.terms.forEach((x) => terms.add(x));
      return r.text;
    };
    const value = typeof entry.base === 'string' ? map(entry.base) : entry.base.map(map);
    out.set(entry.key, { entry, value, state: terms.size > 0 ? 'derived' : 'base', stale: false, terms: [...terms] });
  }
  return out;
}

export const textOf = (r: ResolvedEntry | undefined): string =>
  r === undefined ? '' : typeof r.value === 'string' ? r.value : r.value.join(', ');

/**
 * The whole skin a draft makes: the default skin with every resolved entry
 * laid over it at its path. Not checked here — `checkDraft` runs
 * `SkinSchema` and `skinViolations` over the result, so the studio reports
 * exactly what the game would refuse.
 */
export function composeSkin(draft: SkinDraft, surface: SkinSurface, resolved: Resolved, id: string): Skin {
  const skin = structuredClone(surface.base) as unknown as Record<string, unknown>;
  skin['id'] = id;
  skin['name'] = draft.name;
  for (const [key, r] of resolved) {
    if (r.state === 'base') continue;
    const path = pathOf(key);
    let at = skin as Record<string, unknown>;
    for (const part of path.slice(0, -1)) {
      const next = Array.isArray(at) ? (at as unknown[])[Number(part)] : at[part];
      if (next === undefined || next === null || typeof next !== 'object') break;
      at = next as Record<string, unknown>;
    }
    const last = path.at(-1)!;
    const value = Array.isArray(r.value) ? [...r.value] : r.value;
    if (Array.isArray(at)) (at as unknown[])[Number(last)] = value;
    else at[last] = value;
  }
  return skin as unknown as Skin;
}

/* ------------------------------------------------------------------ */
/* Rename suggestions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Words too ordinary to rename everywhere they appear. "Gate" is in a system
 * name and in a hundred sentences that are not about it.
 */
const ORDINARY = new Set([
  'The', 'Of', 'And', 'Gate', 'Deep', 'Star', 'Hollow', 'Reach', 'Approach',
  'Anchorage', 'Marker', 'Prime', 'Free', 'Trade', 'Iron',
]);

export interface TermSuggestion {
  term: string;
  /** Entries whose base text carries it, whole-word. */
  count: number;
  source: 'power' | 'sector' | 'system' | 'family';
}

/**
 * Proper nouns worth renaming, with how far each reaches: every name the
 * default skin gives a power, a sector or a system, every distinctive word in
 * one, and any house word a stock's families share ("Nar").
 */
export function suggestTerms(surface: SkinSurface): TermSuggestion[] {
  const sources = new Map<string, TermSuggestion['source']>();
  const offer = (name: string, source: TermSuggestion['source']): void => {
    if (!sources.has(name)) sources.set(name, source);
    for (const w of name.split(/\s+/)) {
      if (w.length >= 3 && /^\p{Lu}/u.test(w) && !ORDINARY.has(w) && !sources.has(w)) sources.set(w, source);
    }
  };
  for (const p of Object.values(surface.base.powers)) offer(p.name, 'power');
  for (const s of Object.values(surface.base.sectors)) offer(s.name, 'sector');
  for (const s of Object.values(surface.base.systems)) offer(s.name, 'system');
  for (const p of Object.values(surface.base.powers)) {
    const houses = new Map<string, number>();
    for (const fam of p.names.family) if (fam.includes(' ')) houses.set(fam.split(' ')[0]!, (houses.get(fam.split(' ')[0]!) ?? 0) + 1);
    for (const [house, n] of houses) if (n >= 3 && !sources.has(house)) sources.set(house, 'family');
  }

  const counts = new Map<string, number>();
  const pattern = renamePattern([...sources.keys()]);
  for (const e of surface.entries) {
    if (!e.lexical) continue;
    for (const t of new Set(textsOf(e.base).flatMap((x) => termsIn(x, pattern)))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...sources.entries()]
    .map(([term, source]) => ({ term, source, count: counts.get(term) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

/** Every entry whose base a term reaches, for the renames' "where" view. */
export function entriesReachedBy(term: string, surface: SkinSurface): SkinEntry[] {
  const pattern = renamePattern([term]);
  return surface.entries.filter((e) => e.lexical && textsOf(e.base).some((t) => termsIn(t, pattern).length > 0));
}
