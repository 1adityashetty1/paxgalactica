import { SkinSchema, coreSlotsOf, skinViolations, type Skin } from '../schema.js';
import { createSeedState } from '../../seed/scenario.js';
import { flatten } from './keys.js';
import type { SkinDraft } from './draft.js';
import { renamePattern, termsIn, type Resolved, type ResolvedEntry } from './resolve.js';
import type { SkinSurface } from './surface.js';

/**
 * What a draft gets wrong, stated where it can be fixed.
 *
 * **The game's own rules first.** The composed skin goes through `SkinSchema`
 * and `skinViolations` against the core's slots — exactly what the game would
 * refuse — and each finding is pinned to the entry it is about where that can
 * be told. The studio adds only what those cannot see because they read a
 * finished skin rather than a draft: overrides gone stale, renamed names left
 * in hand-written text, and two worlds or powers a player could not tell
 * apart.
 *
 * - `error` — the game would refuse the skin.
 * - `warn` — it would load and something would read wrong.
 * - `info` — a consequence worth knowing, nothing to fix.
 */
export type IssueLevel = 'error' | 'warn' | 'info';

export interface SkinIssue {
  level: IssueLevel;
  code: string;
  /** The entry to jump to, when there is one. */
  key: string | null;
  message: string;
}

let slots: ReturnType<typeof coreSlotsOf> | null = null;
const coreSlots = () => (slots ??= coreSlotsOf(createSeedState('meridian')));

const textsOf = (r: ResolvedEntry): readonly string[] => (typeof r.value === 'string' ? [r.value] : r.value);

export function checkDraft(draft: SkinDraft, surface: SkinSurface, resolved: Resolved, skin: Skin): SkinIssue[] {
  const issues: SkinIssue[] = [];
  const push = (level: IssueLevel, code: string, key: string | null, message: string): void => {
    issues.push({ level, code, key, message });
  };
  const val = (key: string): string => {
    const v = resolved.get(key)?.value;
    return typeof v === 'string' ? v : '';
  };

  /* --- The game's rules ---------------------------------------------- */
  const parsed = SkinSchema.safeParse(skin);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String);
      // The deepest path that is an entry, so a bad item in a list lands on the list.
      let key: string | null = null;
      for (let n = path.length; n > 0 && key === null; n--) {
        const k = path.slice(0, n).join('.');
        if (surface.byKey.has(k)) key = k;
      }
      const label = key ? surface.byKey.get(key)!.label : path.join('.');
      push('error', 'schema', key, `${label}: ${issue.message}`);
    }
  }
  for (const v of skinViolations(skin, coreSlots())) {
    push('error', 'violation', keyForViolation(v, surface, resolved), v);
  }

  /* --- Shape the schema reads as fine but a player would not ---------- */
  for (const r of resolved.values()) {
    if (typeof r.value === 'string' && r.value.trim() === '' && r.entry.kind !== 'choice') {
      push('error', 'empty', r.entry.key, `${r.entry.label} is empty.`);
    }
    if (Array.isArray(r.value) && r.entry.key.endsWith('.family')) {
      for (const fam of r.value.filter((f) => f.includes('-'))) {
        push('error', 'hyphen', r.entry.key, `"${fam}": the name matcher splits on hyphens, so "${fam.split('-')[0]}" would tie between two people.`);
      }
    }
    if (r.stale) {
      push('warn', 'stale', r.entry.key, `${r.entry.label}: the default skin's words changed after this was written. Re-read the base, then keep or redo the override.`);
    }
  }

  const unique = (label: string, pairs: [string, string][]): void => {
    const seen = new Map<string, string>();
    for (const [value, key] of pairs) {
      if (seen.has(value)) push('error', 'duplicate', key, `${label} "${value}" is used twice; a player could not tell them apart.`);
      else seen.set(value, key);
    }
  };
  unique('The power name', Object.keys(surface.base.powers).map((p) => [val(`powers.${p}.name`), `powers.${p}.name`]));
  unique('The place name', Object.keys(surface.base.systems).map((s) => [val(`systems.${s}.name`), `systems.${s}.name`]));
  unique('The region name', surface.regions.map((s) => [val(`sectors.${s}.name`), `sectors.${s}.name`]));

  for (const pid of Object.keys(surface.base.powers)) {
    const id = val(`powers.${pid}.id`);
    const name = val(`powers.${pid}.name`);
    if (id && name && !flatten(name).includes(flatten(id).replace(/_/g, ''))) {
      push('warn', 'id_not_in_name', `powers.${pid}.id`, `A model writes "${id}" for "${name}". An id that disagrees with its name invites the model to keep using the old one.`);
    }
  }

  /* --- Leaks: renamed names left in new text ------------------------- */
  const retired = new Set(Object.keys(draft.renames));
  for (const r of resolved.values()) {
    const k = r.entry.key;
    const isName = (k.startsWith('powers.') || k.startsWith('systems.') || k.startsWith('sectors.')) && k.endsWith('.name');
    if (isName && r.entry.kind === 'name' && typeof r.entry.base === 'string' && r.value !== r.entry.base) retired.add(r.entry.base);
  }
  const pattern = renamePattern([...retired]);
  for (const r of resolved.values()) {
    if (!r.entry.lexical) continue;
    const found = textsOf(r).flatMap((t) => termsIn(t, pattern));
    if (found.length > 0) {
      push('warn', 'leak', r.entry.key, `${r.entry.label} still says ${[...new Set(found)].map((t) => `"${t}"`).join(', ')}, which this skin renames.`);
    }
  }

  /* --- Housekeeping ---------------------------------------------------- */
  for (const key of Object.keys(draft.entries)) {
    if (!surface.byKey.has(key)) push('warn', 'orphan', key, `"${key}" is no longer in the default skin; the override does nothing.`);
  }
  for (const term of Object.keys(draft.renames)) {
    const p = renamePattern([term]);
    const reaches = surface.entries.some((e) => e.lexical && (typeof e.base === 'string' ? [e.base] : e.base).some((t) => termsIn(t, p).length > 0));
    if (!reaches) push('info', 'unused_rename', null, `Rename "${term}" appears in nothing the skin holds.`);
  }

  const rank: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * Which entry a `skinViolations` sentence is about. They name a power and a
 * stock, a family and two roles, or quote a word; the studio finds the entry
 * that says it, or leaves the finding unpinned.
 */
function keyForViolation(message: string, surface: SkinSurface, resolved: Resolved): string | null {
  const stock = message.match(/^(\S+)'s stock repeats a (given|family) name/);
  if (stock) return stock[1] === 'independents' ? `independents.names.${stock[2]}` : `powers.${stock[1]}.names.${stock[2]}`;
  const titles = message.match(/^(\S+) gives two schools one title/);
  if (titles) return surface.byKey.has(`powers.${titles[1]}.names.titles.lineofbattle`) ? `powers.${titles[1]}.names.titles.lineofbattle` : null;
  const fam = message.match(/^(\w+): (\w+) and (\w+) share the (?:id|word)/);
  if (fam) {
    const field = message.includes('share the id') ? 'id' : 'word';
    const key = `lexicon.${fam[1]}.${fam[3]}.${field}`;
    if (surface.byKey.has(key)) return key;
  }
  const familyName = message.match(/^the family (.+) is in both/);
  const quoted = familyName?.[1] ?? message.match(/"([^"]+)"/)?.[1] ?? message.match(/the skin id (\S+)/)?.[1];
  if (quoted) {
    for (const r of resolved.values()) {
      if (textsOf(r).some((t) => t === quoted || t.startsWith(quoted))) return r.entry.key;
    }
  }
  return null;
}
