import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SkinValue } from '../../../src/skin/studio/draft.js';
import type { ResolvedEntry } from '../../../src/skin/studio/resolve.js';
import type { SkinIssue } from '../../../src/skin/studio/check.js';
import type { SkinEntry } from '../../../src/skin/studio/surface.js';
import { ansi256ToHex } from '../color.js';

/** What every view needs to edit an entry. */
export interface EditApi {
  resolved: ReadonlyMap<string, ResolvedEntry>;
  issuesByKey: ReadonlyMap<string, SkinIssue[]>;
  notes: Readonly<Record<string, string>>;
  focus: string | null;
  set(entry: SkinEntry, value: SkinValue): void;
  reset(entry: SkinEntry): void;
  /** Keep a stale override as written, against today's base. */
  restamp(entry: SkinEntry): void;
  note(key: string, text: string): void;
  /** Go to an entry: its view, scrolled to and flashed. */
  reveal(key: string): void;
  factionColor(id: string | null): string;
  /** Every renamed term, for highlighting. */
  renamePattern: RegExp | null;
}

export function colorOf(color: number | undefined): string {
  return color === undefined ? '#6b7280' : ansi256ToHex(color);
}

export function StateBadge({ r }: { r: ResolvedEntry | undefined }) {
  if (!r) return null;
  return (
    <span className={`badge ${r.state}${r.stale ? ' stale' : ''}`} title={badgeTitle(r)}>
      {r.stale ? 'stale' : r.state}
    </span>
  );
}

function badgeTitle(r: ResolvedEntry): string {
  if (r.stale) return 'The base changed after this override was written.';
  if (r.state === 'derived') return `Rewritten by renames: ${r.terms.join(', ')}`;
  if (r.state === 'authored') return 'Written by hand in this skin; renames do not touch it.';
  return 'The default skin’s own words.';
}

/** Reset an override; for a stale one, also offer to keep it against the new base. */
export function OverrideActions({ r, entry, api }: { r: ResolvedEntry; entry: SkinEntry; api: EditApi }) {
  if (r.state !== 'authored') return null;
  return (
    <>
      {r.stale && (
        <button className="link" title="Keep this override; mark it as written against today's base" onClick={() => api.restamp(entry)}>
          keep
        </button>
      )}
      <button className="link" title="Drop this override" onClick={() => api.reset(entry)}>
        reset
      </button>
    </>
  );
}

export function IssueDots({ issues }: { issues: SkinIssue[] | undefined }) {
  if (!issues || issues.length === 0) return null;
  const worst = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warn') ? 'warn' : 'info';
  return (
    <span className={`issue-dot ${worst}`} title={issues.map((i) => i.message).join('\n')}>
      {issues.length}
    </span>
  );
}

/** Text with every match of `pattern` marked. */
export function Highlight({ text, pattern, className = 'term' }: { text: string; pattern: RegExp | null; className?: string }) {
  if (!pattern) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<mark key={at} className={className}>{m[0]}</mark>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Scroll to and flash an element when it becomes the focused entry. */
export function useFocus(key: string, focus: string | null) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focus === key && ref.current) ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, key]);
  return { ref, focused: focus === key };
}

const asText = (v: SkinValue): string => (typeof v === 'string' ? v : v.join('\n'));
const fromText = (entry: SkinEntry, s: string): SkinValue =>
  entry.kind === 'list' ? s.split('\n').map((x) => x.trim()).filter((x, i, all) => x !== '' || i < all.length - 1) : s;

/**
 * The one editor every entry uses: an input for a name, a select for a
 * choice, a textarea for prose and lists. Base on the left, this skin on the
 * right, state between — the mapping, one row at a time.
 */
export function EntryRow({ entry, api, compact = false, label }: { entry: SkinEntry; api: EditApi; compact?: boolean; label?: string }) {
  const r = api.resolved.get(entry.key);
  const { ref, focused } = useFocus(entry.key, api.focus);
  if (!r) return null;
  const changed = r.state !== 'base';
  const base = asText(entry.base);
  return (
    <div ref={ref} id={`entry-${entry.key}`} className={`entry-row${focused ? ' focused' : ''}${compact ? ' compact' : ''}`}>
      <div className="entry-label" title={entry.key}>
        {label ?? entry.label}
        <IssueDots issues={api.issuesByKey.get(entry.key)} />
      </div>
      <div className={`entry-base${changed ? ' replaced' : ''}`} title={base}>
        <Highlight text={base} pattern={api.renamePattern} />
      </div>
      <div className="entry-arrow">→</div>
      <div className="entry-value">
        <Editor entry={entry} value={r.value} onChange={(v) => api.set(entry, v)} />
      </div>
      <div className="entry-state">
        <StateBadge r={r} />
        <OverrideActions r={r} entry={entry} api={api} />
      </div>
      {entry.hint && focused && <div className="entry-hint">{entry.hint}</div>}
    </div>
  );
}

export function Editor({ entry, value, onChange, rows }: { entry: SkinEntry; value: SkinValue; onChange: (v: SkinValue) => void; rows?: number }) {
  // Lists keep their own text while typing, so a trailing newline survives
  // until the next line is written.
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => {
    if (fromTextSame(entry, draft, value)) return;
    setDraft(asText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (entry.kind === 'choice') {
    return (
      <select value={value as string} onChange={(e) => onChange(e.target.value)}>
        {entry.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (entry.kind === 'lore' || entry.kind === 'list') {
    const lines = entry.kind === 'list' ? Math.min(12, (value as string[]).length + 1) : undefined;
    return (
      <textarea
        className={entry.kind}
        rows={rows ?? lines ?? 3}
        value={draft}
        spellCheck={entry.kind === 'lore'}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(fromText(entry, e.target.value));
        }}
      />
    );
  }
  return (
    <input
      className={entry.kind}
      value={value as string}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function fromTextSame(entry: SkinEntry, draft: string, value: SkinValue): boolean {
  const parsed = fromText(entry, draft);
  if (typeof parsed === 'string' || typeof value === 'string') return parsed === value;
  const clean = parsed.filter((x) => x !== '');
  return clean.length === value.length && clean.every((x, i) => x === value[i]);
}

export function FactionChip({ id, name, color, active, onClick }: { id: string | null; name: string; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <button className={`chip${active ? ' active' : ''}`} style={{ ['--chip' as string]: color }} onClick={onClick} title={id ?? 'unaligned'}>
      <span className="chip-dot" />
      {name}
    </button>
  );
}

export function Count({ n, of }: { n: number; of: number }) {
  return (
    <span className="count">
      {n}/{of}
    </span>
  );
}
