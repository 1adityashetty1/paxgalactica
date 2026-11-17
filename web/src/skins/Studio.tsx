import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DRAFT_ID,
  SkinDraftSchema,
  emptyDraft,
  idFor,
  restamped,
  serializeDraft,
  withEntry,
  withNote,
  withRename,
  withoutEntry,
  type SkinDraft,
  type SkinValue,
} from '../../../src/skin/studio/draft.js';
import { checkDraft, type SkinIssue } from '../../../src/skin/studio/check.js';
import { composeSkin, renamePattern, resolveDraft, suggestTerms } from '../../../src/skin/studio/resolve.js';
import { buildSurface, type SkinEntry, type SkinGroup } from '../../../src/skin/studio/surface.js';
import { NEUTRAL } from '../color.js';
import { colorOf, type EditApi } from './parts.js';
import { IssuesView, LoreView, MapView, OfficersView, PowersView, PreviewView, RenamesView, WordsView } from './views.js';

/**
 * The skin studio: a dev-only page for writing a skin.
 *
 * Its base is the default skin, `paxGalactica()`, read live; it holds one
 * draft — the differences from that — in memory and writes it to
 * `skins/<id>.json` through the Vite plugin in `scripts/skin-studio-plugin.ts`.
 * Every view edits the same draft through one `EditApi`, and every keystroke
 * recomposes the whole `Skin` and runs the game's own checks over it, so the
 * Issues count is what the game would refuse, now.
 */

type View = 'renames' | SkinGroup | 'preview' | 'issues';

const VIEWS: { id: View; label: string }[] = [
  { id: 'renames', label: 'Renames' },
  { id: 'powers', label: 'Powers' },
  { id: 'map', label: 'Map' },
  { id: 'officers', label: 'Officers' },
  { id: 'words', label: 'Words' },
  { id: 'lore', label: 'Lore' },
  { id: 'preview', label: 'Preview' },
  { id: 'issues', label: 'Issues' },
];

interface Listed {
  slug: string;
  name: string;
  entries: number;
  terms: number;
}

function readHash(): { skin: string | null; view: View } {
  const p = new URLSearchParams(location.hash.slice(1));
  const view = p.get('view') as View | null;
  return { skin: p.get('skin'), view: VIEWS.some((v) => v.id === view) ? view! : 'renames' };
}

export function Studio() {
  const surface = useMemo(() => buildSurface(), []);
  const suggestions = useMemo(() => suggestTerms(surface), [surface]);
  const initial = useMemo(readHash, []);

  const [skins, setSkins] = useState<Listed[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkinDraft>(() => emptyDraft('Untitled skin'));
  const [saved, setSaved] = useState<string>(() => serializeDraft(emptyDraft('Untitled skin')));
  const [status, setStatus] = useState<string>('');
  const [view, setView] = useState<View>(initial.view);
  const [focus, setFocus] = useState<string | null>(null);
  const [power, setPower] = useState<string | null>(null);

  const resolved = useMemo(() => resolveDraft(draft, surface), [draft, surface]);
  const skin = useMemo(() => composeSkin(draft, surface, resolved, slug ?? idFor(draft.name)), [draft, surface, resolved, slug]);
  const issues = useMemo(() => checkDraft(draft, surface, resolved, skin), [draft, surface, resolved, skin]);
  const issuesByKey = useMemo(() => {
    const m = new Map<string, SkinIssue[]>();
    for (const i of issues) if (i.key) m.set(i.key, [...(m.get(i.key) ?? []), i]);
    return m;
  }, [issues]);
  const pattern = useMemo(() => renamePattern(Object.keys(draft.renames)), [draft.renames]);
  const dirty = serializeDraft(draft) !== saved;

  /* --- files --------------------------------------------------------- */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/__skins');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSkins(((await res.json()) as { skins: Listed[] }).skins);
    } catch {
      setStatus('No skin store: open this page through `pnpm skins` (the Vite dev server).');
    }
  }, []);

  const open = useCallback(async (next: string) => {
    const res = await fetch(`/__skins/${encodeURIComponent(next)}`);
    if (!res.ok) {
      setStatus(((await res.json()) as { error: string }).error);
      return;
    }
    const file = SkinDraftSchema.parse(await res.json());
    setDraft(file);
    setSaved(serializeDraft(file));
    setSlug(next);
    setStatus(`Opened skins/${next}.json`);
  }, []);

  useEffect(() => {
    void refresh();
    if (initial.skin && DRAFT_ID.test(initial.skin)) void open(initial.skin);
  }, [refresh, open, initial.skin]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (slug) p.set('skin', slug);
    p.set('view', view);
    history.replaceState(null, '', `#${p.toString()}`);
  }, [slug, view]);

  const save = useCallback(async () => {
    let target = slug;
    if (!target) {
      const id = prompt('Save as (the skin id, also its file name under skins/):', idFor(draft.name));
      if (!id) return;
      target = idFor(id);
    }
    const res = await fetch(`/__skins/${encodeURIComponent(target)}`, { method: 'PUT', body: serializeDraft(draft) });
    const body = (await res.json()) as { ok?: boolean; path?: string; error?: string };
    if (!res.ok) {
      setStatus(`Not saved: ${body.error}`);
      return;
    }
    setSlug(target);
    setSaved(serializeDraft(draft));
    setStatus(`Saved ${body.path}`);
    void refresh();
  }, [slug, draft, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [save, dirty]);

  const choose = (value: string) => {
    if (dirty && !confirm('Discard unsaved changes to this skin?')) return;
    if (value === '__new') {
      const name = prompt('Name the new skin:', 'Untitled skin');
      if (!name) return;
      setDraft(emptyDraft(name));
      setSaved('');
      setSlug(null);
      setStatus('New skin — not saved yet.');
      return;
    }
    void open(value);
  };

  const copySkin = async () => {
    await navigator.clipboard.writeText(`${JSON.stringify(skin, null, 2)}\n`);
    setStatus(issues.some((i) => i.level === 'error') ? 'Copied the composed skin — it does not pass the game’s checks yet.' : 'Copied the composed skin.');
  };

  /* --- editing -------------------------------------------------------- */
  const api: EditApi = {
    resolved,
    issuesByKey,
    notes: draft.notes,
    focus,
    renamePattern: pattern,
    set(entry: SkinEntry, value: SkinValue) {
      setDraft((d) => {
        const free = resolveDraft(withoutEntry(d, entry.key), surface).get(entry.key)?.value ?? entry.base;
        return withEntry(d, entry.key, value, entry.base, free);
      });
    },
    reset(entry: SkinEntry) {
      setDraft((d) => withoutEntry(d, entry.key));
    },
    restamp(entry: SkinEntry) {
      setDraft((d) => restamped(d, entry.key, entry.base));
    },
    note(key: string, text: string) {
      setDraft((d) => withNote(d, key, text));
    },
    reveal(key: string) {
      const e = surface.byKey.get(key);
      if (!e) return;
      setView(e.group);
      setPower(null);
      setFocus(null);
      requestAnimationFrame(() => setFocus(key));
    },
    factionColor(id: string | null) {
      if (id === null) return NEUTRAL;
      return colorOf(surface.powers.find((f) => f.id === id)?.color);
    },
  };

  const setRename = (term: string, to: string | null) => setDraft((d) => withRename(d, term, to));

  /* --- coverage ------------------------------------------------------ */
  const coverage = (group: SkinGroup) => {
    const es = surface.entries.filter((e) => e.group === group);
    return { n: es.filter((e) => resolved.get(e.key)?.state !== 'base').length, of: es.length };
  };
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const touched = [...resolved.values()].filter((r) => r.state !== 'base').length;
  const groups = new Set<string>(['powers', 'map', 'officers', 'words', 'lore']);

  return (
    <div className="studio">
      <header className="topbar">
        <span className="title">SKIN STUDIO</span>
        <select value={slug ?? ''} onChange={(e) => choose(e.target.value)}>
          {!slug && <option value="">{draft.name} (unsaved)</option>}
          {skins.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name} — {s.slug}.json
            </option>
          ))}
          <option value="__new">New skin…</option>
        </select>
        <span className="dim">
          {touched}/{surface.entries.length} differ from Pax Galactica
        </span>
        <span className="spacer" />
        <span className="dim status">{status}</span>
        <button onClick={() => void copySkin()} title="The whole Skin this draft composes, as the game reads it">
          Copy skin JSON
        </button>
        <button className={`save${dirty ? ' dirty' : ''}`} onClick={() => void save()} title="⌘S">
          {slug === null ? 'Save as…' : dirty ? 'Save ●' : 'Saved'}
        </button>
      </header>
      <div className="studio-grid">
        <nav className="studio-nav">
          <label className="meta">
            <span className="dim small">name</span>
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <label className="meta">
            <span className="dim small">id</span>
            <code className="dim">{slug ?? idFor(draft.name)}</code>
          </label>
          <label className="meta">
            <span className="dim small">premise</span>
            <textarea
              rows={4}
              value={draft.description}
              placeholder="What is this setting? One paragraph, for whoever opens the file next."
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </label>
          {VIEWS.map((v) => {
            const c = groups.has(v.id) ? coverage(v.id as SkinGroup) : null;
            return (
              <button
                key={v.id}
                className={`nav-item${view === v.id ? ' active' : ''}`}
                onClick={() => {
                  setView(v.id);
                  setPower(null);
                }}
              >
                <span>{v.label}</span>
                {v.id === 'renames' && <span className="dim">{Object.keys(draft.renames).length}</span>}
                {c && (
                  <span className="meter" title={`${c.n} of ${c.of} differ from Pax Galactica`}>
                    <span style={{ width: `${(100 * c.n) / Math.max(1, c.of)}%` }} />
                  </span>
                )}
                {v.id === 'issues' && (
                  <span>
                    {errors > 0 && <span className="issue-dot error">{errors}</span>}
                    {warns > 0 && <span className="issue-dot warn">{warns}</span>}
                    {errors + warns === 0 && <span className="dim">✓</span>}
                  </span>
                )}
              </button>
            );
          })}
          <div className="legend">
            <div><span className="badge base">base</span> Pax Galactica’s words</div>
            <div><span className="badge derived">derived</span> rewritten by renames</div>
            <div><span className="badge authored">authored</span> written in this skin</div>
            <div><span className="badge stale">stale</span> base moved since</div>
          </div>
        </nav>
        <main className="studio-main">
          {view === 'renames' && <RenamesView surface={surface} api={api} draft={draft} suggestions={suggestions} setRename={setRename} />}
          {view === 'powers' && (
            <PowersView
              surface={surface}
              api={api}
              goTo={(v, f) => {
                setPower(f);
                setView(v);
              }}
            />
          )}
          {view === 'map' && <MapView surface={surface} api={api} power={power} />}
          {view === 'officers' && <OfficersView surface={surface} api={api} power={power} />}
          {view === 'words' && <WordsView surface={surface} api={api} />}
          {view === 'lore' && <LoreView surface={surface} api={api} power={power} setPower={setPower} />}
          {view === 'preview' && <PreviewView skin={skin} />}
          {view === 'issues' && <IssuesView issues={issues} api={api} surface={surface} />}
        </main>
      </div>
    </div>
  );
}
