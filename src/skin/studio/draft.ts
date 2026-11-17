import { z } from 'zod';

/**
 * A skin as the studio keeps it while it is being written: the differences
 * from the default skin, and nothing else.
 *
 * **Only the differences are stored.** The base is `paxGalactica()`, read live,
 * so a draft never holds a stale second copy of the game's words. Each override
 * is keyed by its path into a `Skin` (`powers.vigil.title`,
 * `lexicon.units.battleship.plural`) and `composeSkin` lays them over the base
 * to make the whole skin the game reads, which `SkinSchema` and
 * `skinViolations` then check like any other.
 *
 * **Each override remembers the base it replaced**, so when the default skin's
 * words move after a draft was written the studio marks the override stale
 * rather than silently keeping a rewrite of a sentence that no longer exists.
 *
 * **Renames are the cheap half.** A map of proper nouns (`Vantic → Caldor`)
 * applied whole-word to every entry not written by hand: one line re-points a
 * system's name, every voice and sentence that mentions it, and every family
 * name that carries it. Not the skin's `lexicon`, which names roles; this
 * names the setting's people and places.
 */

export const DRAFT_FORMAT = 2;

export const SkinValueSchema = z.union([z.string(), z.array(z.string())]);
export type SkinValue = z.infer<typeof SkinValueSchema>;

export const OverrideSchema = z.object({
  value: SkinValueSchema,
  /** The base this was written against; a mismatch with today's base is staleness. */
  base: SkinValueSchema,
});
export type Override = z.infer<typeof OverrideSchema>;

/**
 * A skin's id and its file's name: what `SkinSchema` holds a skin id to —
 * lowercase words joined by underscores.
 */
export const DRAFT_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const SkinDraftSchema = z.object({
  format: z.literal(DRAFT_FORMAT).default(DRAFT_FORMAT),
  name: z.string().min(1).max(80),
  description: z.string().max(600).default(''),
  /** Proper noun in the default skin → what this skin calls it. */
  renames: z.record(z.string().min(1), z.string()).default({}),
  entries: z.record(z.string().min(1), OverrideSchema).default({}),
  /** A note to yourself per entry — why it says what it says. Never read by the game. */
  notes: z.record(z.string().min(1), z.string()).default({}),
});
export type SkinDraft = z.infer<typeof SkinDraftSchema>;

export function emptyDraft(name: string): SkinDraft {
  return { format: DRAFT_FORMAT, name, description: '', renames: {}, entries: {}, notes: {} };
}

/** A skin id from a name: `Ashen Reach` → `ashen_reach`. */
export function idFor(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/, '');
  return id || 'skin';
}

export function sameValue(a: SkinValue, b: SkinValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Writes are pure and return a new draft. Setting an entry to what the skin
 * would say anyway — `free`: the base, or what renames make of it — removes
 * the override rather than storing a no-op, so "reset" and "typed the same
 * text back in" are one state and a diff of the file stays honest.
 */
export function withEntry(draft: SkinDraft, key: string, value: SkinValue, base: SkinValue, free: SkinValue = base): SkinDraft {
  const entries = { ...draft.entries };
  if (sameValue(value, free)) delete entries[key];
  else entries[key] = { value, base };
  return { ...draft, entries };
}

export function withoutEntry(draft: SkinDraft, key: string): SkinDraft {
  if (!(key in draft.entries)) return draft;
  const entries = { ...draft.entries };
  delete entries[key];
  return { ...draft, entries };
}

/** Keep a stale override as written, marked as written against today's base. */
export function restamped(draft: SkinDraft, key: string, base: SkinValue): SkinDraft {
  const o = draft.entries[key];
  return o ? { ...draft, entries: { ...draft.entries, [key]: { value: o.value, base } } } : draft;
}

export function withRename(draft: SkinDraft, term: string, replacement: string | null): SkinDraft {
  const renames = { ...draft.renames };
  if (replacement === null || replacement === term) delete renames[term];
  else renames[term] = replacement;
  return { ...draft, renames };
}

export function withNote(draft: SkinDraft, key: string, note: string): SkinDraft {
  const notes = { ...draft.notes };
  if (note.trim() === '') delete notes[key];
  else notes[key] = note;
  return { ...draft, notes };
}

/**
 * The draft as written to disk: keys sorted, two-space indent, trailing
 * newline — so it diffs line by line in review, and saving twice writes the
 * same bytes.
 */
export function serializeDraft(draft: SkinDraft): string {
  const sorted = <T>(r: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]!]));
  const out = {
    format: draft.format,
    name: draft.name,
    description: draft.description,
    renames: sorted(draft.renames),
    entries: sorted(draft.entries),
    notes: sorted(draft.notes),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}
