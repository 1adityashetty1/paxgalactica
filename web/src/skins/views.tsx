import { useMemo, useState } from 'react';
import { HULL_CLASSES, describeStack } from '../../../src/domain/hulls.js';
import { RIM_EVENT_KINDS } from '../../../src/domain/events.js';
import { NOTE_KINDS } from '../../../src/domain/diplomacy.js';
import { WORLD_TYPES } from '../../../src/domain/state.js';
import { countUnits, noteTitle, rimEventTitle, terrainName, withLexicon, type Words } from '../../../src/skin/lexicon.js';
import type { Skin } from '../../../src/skin/schema.js';
import { helpPage } from '../../../src/ui/help.js';
import type { SkinDraft } from '../../../src/skin/studio/draft.js';
import { entriesReachedBy, renamePattern, textOf, type ResolvedEntry, type TermSuggestion } from '../../../src/skin/studio/resolve.js';
import type { SkinIssue } from '../../../src/skin/studio/check.js';
import type { LoreFacet, SkinEntry, SkinSurface } from '../../../src/skin/studio/surface.js';
import { FAMILY_ROLES, SOURCE_LABEL, familyLabel, grouped, roleOf } from '../../../src/skin/studio/roles.js';
import { Count, Editor, EntryRow, FactionChip, Highlight, IssueDots, OverrideActions, StateBadge, useFocus, type EditApi } from './parts.js';

interface ViewProps {
  surface: SkinSurface;
  api: EditApi;
}

const changedIn = (entries: SkinEntry[], api: EditApi): number =>
  entries.filter((e) => api.resolved.get(e.key)?.state !== 'base').length;
const str = (r: ResolvedEntry | undefined): string => (r && typeof r.value === 'string' ? r.value : '');
const list = (r: ResolvedEntry | undefined): string[] => (r && Array.isArray(r.value) ? r.value : []);
const powerName = (api: EditApi, id: string): string => str(api.resolved.get(`powers.${id}.name`)) || id;

/* ------------------------------------------------------------------ */
/* Renames                                                             */
/* ------------------------------------------------------------------ */

interface Mention {
  file: string;
  line: number;
  text: string;
  comment: boolean;
}

export function RenamesView({
  surface,
  api,
  draft,
  suggestions,
  setRename,
}: ViewProps & { draft: SkinDraft; suggestions: TermSuggestion[]; setRename: (term: string, to: string | null) => void }) {
  const [filter, setFilter] = useState('');
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  // Terms added by hand, held here until they are renamed and the draft carries them.
  const [added, setAdded] = useState<string[]>([]);

  const rows = useMemo(() => {
    const known = new Set(suggestions.map((s) => s.term));
    const extra = [...new Set([...added, ...Object.keys(draft.renames)])]
      .filter((t) => !known.has(t))
      .map((term): TermSuggestion => ({ term, count: entriesReachedBy(term, surface).length, source: 'family' }));
    return [...extra.map((e) => ({ ...e, custom: true })), ...suggestions.map((s) => ({ ...s, custom: false }))];
  }, [suggestions, draft.renames, surface, added]);

  const shown = rows.filter(
    (r) => (!onlyMapped || r.term in draft.renames) && (filter === '' || r.term.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="view">
      <header className="view-head">
        <h2>Renames</h2>
        <p className="dim">
          The setting’s proper nouns. Rename one and every entry you have not written by hand follows it — a power’s name,
          its voice, the sentences that mention it, the families that carry it — whole-word and case-sensitive. Longer terms
          win, so rename <code>Iron Vigil Remnant</code> before <code>Vigil</code> if they should differ. The words for
          roles — units, ground, events — are under <strong>Words</strong>.
        </p>
        <div className="toolbar">
          <input placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} /> renamed only
          </label>
          <span className="dim">{Object.keys(draft.renames).length} renamed</span>
          <span className="spacer" />
          <input placeholder="add a term" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button
            disabled={custom.trim() === ''}
            onClick={() => {
              const t = custom.trim();
              setAdded((a) => (a.includes(t) ? a : [t, ...a]));
              setOpen(t);
              setCustom('');
            }}
          >
            add
          </button>
        </div>
      </header>
      <table className="lexicon">
        <thead>
          <tr>
            <th>term</th>
            <th>from</th>
            <th>reaches</th>
            <th />
            <th>this skin calls it</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <RenameRow
              key={r.term}
              row={r}
              to={draft.renames[r.term]}
              open={open === r.term}
              toggle={() => setOpen(open === r.term ? null : r.term)}
              setRename={setRename}
              surface={surface}
              api={api}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenameRow({
  row,
  to,
  open,
  toggle,
  setRename,
  surface,
  api,
}: {
  row: TermSuggestion & { custom: boolean };
  to: string | undefined;
  open: boolean;
  toggle: () => void;
  setRename: (term: string, to: string | null) => void;
  surface: SkinSurface;
  api: EditApi;
}) {
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const reached = useMemo(() => (open ? entriesReachedBy(row.term, surface) : []), [open, row.term, surface]);
  const pattern = useMemo(() => renamePattern([row.term]), [row.term]);

  const loadMentions = async () => {
    const res = await fetch('/__skins/mentions', { method: 'POST', body: JSON.stringify({ terms: [row.term] }) });
    const body = (await res.json()) as { mentions: Record<string, Mention[]> };
    setMentions(body.mentions[row.term] ?? []);
  };
  const authoredStill = reached.filter((e) => {
    const r = api.resolved.get(e.key);
    return r?.state === 'authored' && r.terms.includes(row.term);
  }).length;

  return (
    <>
      <tr className={`${to !== undefined ? 'mapped' : ''}${open ? ' open' : ''}`}>
        <td className="term-cell">
          <button className="link" onClick={toggle}>
            {open ? '▾' : '▸'} {row.term}
          </button>
        </td>
        <td className="dim">{row.custom ? 'custom' : SOURCE_LABEL[row.source] ?? row.source}</td>
        <td className="num">{row.count}</td>
        <td className="entry-arrow">→</td>
        <td>
          <input value={to ?? ''} placeholder={row.term} onChange={(e) => setRename(row.term, e.target.value === '' ? null : e.target.value)} />
        </td>
        <td>
          {authoredStill > 0 && (
            <span className="issue-dot warn" title="Entries written by hand that still use the old name">
              {authoredStill}
            </span>
          )}
          {to !== undefined && (
            <button className="link" onClick={() => setRename(row.term, null)}>
              clear
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="reach">
          <td colSpan={6}>
            <div className="reach-list">
              {reached.map((e) => {
                const r = api.resolved.get(e.key);
                const base = typeof e.base === 'string' ? e.base : e.base.join(', ');
                return (
                  <button key={e.key} className="reach-item" onClick={() => api.reveal(e.key)}>
                    <span className="reach-where">
                      {e.group} · {e.owner ?? e.section} · {e.label} <StateBadge r={r} />
                    </span>
                    <span className="reach-text">
                      <Highlight text={excerpt(base, row.term)} pattern={pattern} />
                    </span>
                    {r && r.state !== 'base' && (
                      <span className="reach-text now">
                        <Highlight text={excerpt(textOf(r), to ?? row.term)} pattern={renamePattern([to ?? row.term])} className="term new" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mentions">
              {mentions === null ? (
                <button onClick={() => void loadMentions()}>Find hardcoded mentions in code</button>
              ) : (
                <>
                  <div className="dim">
                    Written in code, where no skin reaches: {mentions.filter((m) => !m.comment).length} in strings,{' '}
                    {mentions.filter((m) => m.comment).length} in comments.{' '}
                    <label className="check">
                      <input type="checkbox" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} /> show comments
                    </label>
                  </div>
                  {mentions
                    .filter((m) => showComments || !m.comment)
                    .map((m) => (
                      <div key={`${m.file}:${m.line}`} className={`mention${m.comment ? ' comment' : ''}`}>
                        <span className="mention-at">
                          {m.file}:{m.line}
                        </span>
                        <Highlight text={m.text} pattern={pattern} />
                      </div>
                    ))}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function excerpt(text: string, term: string, span = 70): string {
  const at = text.indexOf(term);
  if (at < 0 || text.length <= span * 2) return text;
  const start = Math.max(0, at - span);
  const end = Math.min(text.length, at + term.length + span);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Powers: one card each, and what hangs off it                        */
/* ------------------------------------------------------------------ */

export function PowersView({ surface, api, goTo }: ViewProps & { goTo: (view: 'lore' | 'officers' | 'map', power: string) => void }) {
  return (
    <div className="view">
      <header className="view-head">
        <h2>Powers</h2>
        <p className="dim">
          Each power and what hangs off it — the places it founded, the officers it appoints, the lore that speaks for it —
          so a rename can be read across every part of the skin it touches at once.
        </p>
      </header>
      <div className="faction-grid">
        {surface.powers.map((f) => {
          const own = surface.entries.filter((e) => e.owner === f.id && e.section === f.id);
          const identity = own.filter((e) => e.group === 'powers');
          const lore = own.filter((e) => e.group === 'lore');
          const homes = surface.places.filter((s) => s.home === f.id);
          return (
            <section key={f.id} className="faction-card" style={{ ['--fc' as string]: api.factionColor(f.id) }}>
              <div className="faction-name">
                <span className="chip-dot" />
                <span>{powerName(api, f.id)}</span>
                <code className="dim">{str(api.resolved.get(`powers.${f.id}.id`))}</code>
              </div>
              {identity.map((e) => (
                <EntryRow key={e.key} entry={e} api={api} compact />
              ))}
              <div className="links">
                <div className="link-block">
                  <button className="link-head" onClick={() => goTo('map', f.id)}>
                    Home ground
                  </button>
                  {homes.map((s) => (
                    <div key={s.id} className="link-line">
                      <code>{str(api.resolved.get(`systems.${s.id}.id`))}</code> {str(api.resolved.get(`systems.${s.id}.name`))}
                    </div>
                  ))}
                </div>
                <div className="link-block">
                  <button className="link-head" onClick={() => goTo('officers', f.id)}>
                    Officers
                  </button>
                  {Object.keys(surface.base.powers[f.id]!.names.titles).map((school) => (
                    <div key={school} className="link-line">
                      <span className="dim">{school}</span> {str(api.resolved.get(`powers.${f.id}.names.titles.${school}`))}
                    </div>
                  ))}
                  <div className="link-line sample">{sampleOfficers(`powers.${f.id}.names`, api, 1)[0]}</div>
                </div>
                <div className="link-block">
                  <button className="link-head" onClick={() => goTo('lore', f.id)}>
                    Lore
                  </button>
                  <div className="link-line">
                    <Count n={changedIn(lore, api)} of={lore.length} /> rewritten
                  </div>
                  {(['voice', 'doctrine', 'redLine', 'compulsion'] as LoreFacet[]).map((facet) => {
                    const es = lore.filter((e) => e.facet === facet);
                    if (es.length === 0) return null;
                    return (
                      <div key={facet} className="link-line">
                        <span className="dim">{FACET_LABEL[facet]}</span> <Count n={changedIn(es, api)} of={es.length} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A few officers as this skin would name them. Deterministic, so they do not flicker. */
function sampleOfficers(prefix: string, api: EditApi, n: number): string[] {
  const given = list(api.resolved.get(`${prefix}.given`));
  const family = list(api.resolved.get(`${prefix}.family`));
  const suffix = str(api.resolved.get(`${prefix}.place`)) === 'suffix';
  const schools = [...api.resolved.keys()].filter((k) => k.startsWith(`${prefix}.titles.`));
  if (given.length === 0 || family.length === 0 || schools.length === 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const title = str(api.resolved.get(schools[i % schools.length]!));
    const person = `${given[(i * 3) % given.length]} ${family[(i * 7) % family.length]}`;
    return suffix ? `${person}, ${title}` : `${title} ${person}`;
  });
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

export function MapView({ surface, api, power }: ViewProps & { power: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map(surface.places.map((s) => [s.id, s]));
  const xs = surface.places.map((s) => s.x);
  const ys = surface.places.map((s) => s.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  return (
    <div className="view map-view">
      <header className="view-head">
        <h2>Map</h2>
        <p className="dim">
          The map with this skin’s names. Click a place to edit it. A place’s id is what a model writes for it under this
          skin; the core keeps its own and translates at the boundary.
        </p>
      </header>
      <div className="map-split">
        <svg className="skin-map" viewBox={`${x0 - 5} ${y0 - 4} ${x1 - x0 + 10} ${y1 - y0 + 8}`}>
          {surface.places.flatMap((s) =>
            s.routes
              .filter((t) => t > s.id)
              .map((t) => {
                const o = byId.get(t);
                return o ? <line key={`${s.id}-${t}`} x1={s.x} y1={s.y} x2={o.x} y2={o.y} className="route" /> : null;
              }),
          )}
          {surface.regions.map((sec) => {
            const in_ = surface.places.filter((s) => s.region === sec);
            if (in_.length === 0) return null;
            const x = in_.reduce((a, s) => a + s.x, 0) / in_.length;
            const y = Math.min(...in_.map((s) => s.y)) - 2;
            return (
              <text key={sec} x={x} y={y} className="sector-label" textAnchor="middle">
                {str(api.resolved.get(`sectors.${sec}.name`)).toUpperCase()}
              </text>
            );
          })}
          {surface.places.map((s) => {
            const r = api.resolved.get(`systems.${s.id}.name`);
            const dim = power !== null && s.controller !== power && s.home !== power;
            return (
              <g
                key={s.id}
                className={`node ${r?.state ?? 'base'}${selected === s.id ? ' selected' : ''}${dim ? ' dimmed' : ''}`}
                onClick={() => {
                  setSelected(s.id);
                  api.reveal(`systems.${s.id}.name`);
                }}
              >
                <circle cx={s.x} cy={s.y} r={1.1} fill={api.factionColor(s.controller)} />
                <text x={s.x} y={s.y + 2.6} textAnchor="middle">
                  {str(r)}
                </text>
                <title>
                  {str(api.resolved.get(`systems.${s.id}.id`))} · {roleOf('terrains', s.ground)} ground · founded by {s.home ? powerName(api, s.home) : 'nobody'}
                </title>
              </g>
            );
          })}
        </svg>
        <div className="map-side">
          {surface.regions.map((sec) => {
            const entries = surface.entries.filter((e) => e.group === 'map' && e.section === sec);
            return (
              <section key={sec} className="sector-block">
                {entries.map((e) => (
                  <EntryRow key={e.key} entry={e} api={api} compact />
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Officers                                                            */
/* ------------------------------------------------------------------ */

export function OfficersView({ surface, api, power }: ViewProps & { power: string | null }) {
  const stocks = [
    ...surface.powers.filter((f) => power === null || f.id === power).map((f) => ({ id: f.id, prefix: `powers.${f.id}.names`, name: powerName(api, f.id) })),
    ...(power === null ? [{ id: 'independents', prefix: 'independents.names', name: 'Independents — the notables of unaligned places' }] : []),
  ];
  return (
    <div className="view">
      <header className="view-head">
        <h2>Officers</h2>
        <p className="dim">
          A title is a school said out loud; a family name is one person for a whole campaign. Stocks are a fixed size so
          every skin draws the same people at the same places. One name per line.
        </p>
      </header>
      {stocks.map((s) => {
        const entries = surface.entries.filter((e) => e.group === 'officers' && e.section === s.id);
        return (
          <section key={s.id} className="officer-block" style={{ ['--fc' as string]: api.factionColor(s.id === 'independents' ? null : s.id) }}>
            <h3>
              <span className="chip-dot" /> {s.name}
            </h3>
            {entries.filter((e) => e.kind !== 'list').map((e) => (
              <EntryRow key={e.key} entry={e} api={api} compact />
            ))}
            <div className="stock-lists">
              {entries.filter((e) => e.kind === 'list').map((e) => (
                <ListBlock key={e.key} entry={e} api={api} />
              ))}
              <div className="samples">
                <div className="dim">as this skin names them</div>
                {sampleOfficers(s.prefix, api, 6).map((x) => (
                  <div key={x}>{x}</div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ListBlock({ entry, api }: { entry: SkinEntry; api: EditApi }) {
  const r = api.resolved.get(entry.key);
  const { ref, focused } = useFocus(entry.key, api.focus);
  if (!r) return null;
  const n = list(r).length;
  return (
    <div ref={ref} className={`list-block${focused ? ' focused' : ''}`}>
      <div className="list-head">
        {entry.label}{' '}
        <span className={entry.size !== undefined && n !== entry.size ? 'over' : 'dim'}>
          {n}
          {entry.size !== undefined ? `/${entry.size}` : ''}
        </span>{' '}
        <StateBadge r={r} /> <IssueDots issues={api.issuesByKey.get(entry.key)} />
        <OverrideActions r={r} entry={entry} api={api} />
      </div>
      <Editor entry={entry} value={r.value} onChange={(v) => api.set(entry, v)} rows={14} />
      {entry.hint && <div className="dim small">{entry.hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Words: the lexicon, one family at a time                            */
/* ------------------------------------------------------------------ */

export function WordsView({ surface, api }: ViewProps) {
  const [family, setFamily] = useState(surface.families[0] ?? '');
  const entries = surface.entries.filter((e) => e.group === 'words' && e.section === family);
  const rows = [...new Set(entries.map((e) => e.row!))];
  const fields = [...new Set(entries.map((e) => e.field!))];
  const at = new Map(entries.map((e) => [`${e.row}|${e.field}`, e]));
  return (
    <div className="view">
      <header className="view-head">
        <h2>Words</h2>
        <p className="dim">
          The skin’s lexicon: a word for every slot the core has, organised by what each slot does. Each row is a role; the
          core id beside it is the key the skin is written against. Synonyms are comma-separated.
        </p>
        <div className="toolbar wrap">
          {surface.families.map((f) => {
            const es = surface.entries.filter((e) => e.group === 'words' && e.section === f);
            const bad = es.some((e) => api.issuesByKey.has(e.key));
            return (
              <button key={f} className={`chip${family === f ? ' active' : ''}`} onClick={() => setFamily(f)}>
                {familyLabel(f)} <span className="dim">{changedIn(es, api)}/{es.length}</span>
                {bad && <span className="issue-dot error">!</span>}
              </button>
            );
          })}
        </div>
        <p className="dim small">{FAMILY_ROLES[family]?.says ?? ''}</p>
      </header>
      <div className="family-scroll">
        <table className="family">
          <thead>
            <tr>
              <th>role</th>
              <th>core</th>
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped(family, rows).map((grp) =>
              grp.rows.map((row, n) => (
                <tr key={row} className={n === 0 ? 'role-first' : ''}>
                  {n === 0 && (
                    <td className="role" rowSpan={grp.rows.length} title={grp.says}>
                      <strong>{grp.role}</strong>
                      {grp.says && <div className="dim small">{grp.says}</div>}
                    </td>
                  )}
                  <td className="core-id">
                    <code>{row}</code>
                  </td>
                  {fields.map((f) => {
                    const e = at.get(`${row}|${f}`);
                    return <td key={f}>{e && <Cell entry={e} api={api} />}</td>;
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ entry, api }: { entry: SkinEntry; api: EditApi }) {
  const r = api.resolved.get(entry.key);
  const { ref, focused } = useFocus(entry.key, api.focus);
  if (!r) return null;
  const base = typeof entry.base === 'string' ? entry.base : entry.base.join(', ');
  const issues = api.issuesByKey.get(entry.key);
  return (
    <div
      ref={ref}
      id={`entry-${entry.key}`}
      className={`cell ${r.state}${r.stale ? ' stale' : ''}${focused ? ' focused' : ''}${issues ? ' has-issue' : ''}`}
      title={`${entry.key}\nbase: ${base}${issues ? `\n${issues.map((i) => i.message).join('\n')}` : ''}`}
    >
      {entry.kind === 'list' ? (
        <input
          value={(r.value as string[]).join(', ')}
          placeholder="—"
          onChange={(e) => api.set(entry, e.target.value.split(',').map((x) => x.trim()).filter((x) => x !== ''))}
        />
      ) : (
        <input className={entry.kind} value={r.value as string} onChange={(e) => api.set(entry, e.target.value)} />
      )}
      {r.state === 'authored' && (
        <button className="link" title="Drop this override" onClick={() => api.reset(entry)}>
          ↺
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lore: every piece on its own card                                   */
/* ------------------------------------------------------------------ */

const FACET_LABEL: Record<LoreFacet, string> = {
  voice: 'voice',
  doctrine: 'doctrine',
  redLine: 'red lines',
  compulsion: 'compulsions',
  sentence: 'sentences',
};

export function LoreView({
  surface,
  api,
  power,
  setPower,
}: ViewProps & { power: string | null; setPower: (f: string | null) => void }) {
  const [facet, setFacet] = useState<LoreFacet | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [state, setState] = useState<'all' | 'base' | 'derived' | 'authored' | 'issues'>('all');
  const [query, setQuery] = useState('');
  const lore = surface.entries.filter((e) => e.group === 'lore');
  const tables = [...new Set(lore.filter((e) => e.facet === 'sentence').map((e) => e.section))];
  const shown = lore.filter((e) => {
    const r = api.resolved.get(e.key);
    if (power === 'sentences' ? e.owner !== null : power !== null && e.owner !== power) return false;
    if (facet && e.facet !== facet) return false;
    if (facet === 'sentence' && table && e.section !== table) return false;
    if (state === 'issues' ? !api.issuesByKey.has(e.key) : state !== 'all' && r?.state !== state) return false;
    if (query) {
      const hay = `${e.label} ${typeof e.base === 'string' ? e.base : ''} ${textOf(r)}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  });
  return (
    <div className="view">
      <header className="view-head">
        <h2>Lore</h2>
        <p className="dim">
          Every piece the skin speaks with, on its own card: each power’s voice, doctrine and lines, and the sentences that
          say what each of the core’s ids means. Derived text is the renames’ draft — edit it and it becomes yours.
        </p>
        <div className="toolbar wrap">
          <FactionChip id={null} name="everything" color="#4b5563" active={power === null} onClick={() => setPower(null)} />
          {surface.powers.map((f) => (
            <FactionChip key={f.id} id={f.id} name={powerName(api, f.id)} color={api.factionColor(f.id)} active={power === f.id} onClick={() => setPower(f.id)} />
          ))}
          <FactionChip id="sentences" name="no power" color="#6b7280" active={power === 'sentences'} onClick={() => setPower('sentences')} />
        </div>
        <div className="toolbar wrap">
          <button className={`chip${facet === null ? ' active' : ''}`} onClick={() => setFacet(null)}>
            all kinds
          </button>
          {(Object.keys(FACET_LABEL) as LoreFacet[]).map((f) => (
            <button key={f} className={`chip${facet === f ? ' active' : ''}`} onClick={() => setFacet(f)}>
              {FACET_LABEL[f]}
            </button>
          ))}
          {facet === 'sentence' && (
            <select value={table ?? ''} onChange={(e) => setTable(e.target.value || null)}>
              <option value="">every table</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
            <option value="all">any state</option>
            <option value="base">base</option>
            <option value="derived">derived</option>
            <option value="authored">authored</option>
            <option value="issues">has issues</option>
          </select>
          <input placeholder="search lore" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="dim">
            {shown.length} of {lore.length}
          </span>
        </div>
      </header>
      <div className="lore-list">
        {shown.map((e) => (
          <LoreCard key={e.key} entry={e} api={api} />
        ))}
      </div>
    </div>
  );
}

function LoreCard({ entry, api }: { entry: SkinEntry; api: EditApi }) {
  const r = api.resolved.get(entry.key);
  const { ref, focused } = useFocus(entry.key, api.focus);
  const base = typeof entry.base === 'string' ? entry.base : '';
  const long = base.length > 700;
  const [showBase, setShowBase] = useState(!long);
  if (!r) return null;
  const value = str(r);
  const rows = Math.min(22, Math.max(2, Math.ceil(value.length / 95) + 1));
  return (
    <section ref={ref} id={`entry-${entry.key}`} className={`lore-card${focused ? ' focused' : ''} ${r.state}`} style={{ ['--fc' as string]: api.factionColor(entry.owner) }}>
      <header>
        <span className="chip-dot" />
        <strong>{entry.label}</strong>
        <span className="dim">{entry.owner ? powerName(api, entry.owner) : entry.facet === 'sentence' ? 'sentence' : ''}</span>
        <span className="spacer" />
        <IssueDots issues={api.issuesByKey.get(entry.key)} />
        <span className="dim small">{value.length}</span>
        <StateBadge r={r} />
        <OverrideActions r={r} entry={entry} api={api} />
      </header>
      <div className="lore-body">
        <div className="lore-base">
          <div className="dim small">
            base{' '}
            {long && (
              <button className="link" onClick={() => setShowBase(!showBase)}>
                {showBase ? 'hide' : `show ${base.length} chars`}
              </button>
            )}
          </div>
          {showBase && (
            <div className="lore-text">
              <Highlight text={base} pattern={api.renamePattern} />
            </div>
          )}
        </div>
        <div className="lore-skin">
          <div className="dim small">
            this skin
            {r.state === 'derived' && <> — renames’ draft ({r.terms.join(', ')})</>}
          </div>
          <Editor entry={entry} value={r.value} onChange={(v) => api.set(entry, v)} rows={rows} />
          <input
            className="note"
            placeholder="note to yourself (kept in the draft, never read by the game)"
            value={api.notes[entry.key] ?? ''}
            onChange={(e) => api.note(entry.key, e.target.value)}
          />
        </div>
      </div>
      {entry.hint && <div className="dim small">{entry.hint}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Preview: the game's own producers, in this skin's words             */
/* ------------------------------------------------------------------ */

export function PreviewView({ skin }: { skin: Skin }) {
  const [query, setQuery] = useState('');
  const words = skin.lexicon as unknown as Words;
  const out = useMemo(() => {
    try {
      return withLexicon(words, () => ({
        ok: true as const,
        // One of every unit, a few of some, so plurals show.
        stack: describeStack(Object.fromEntries(HULL_CLASSES.map((h, i) => [h, (i % 3) + 1]))),
        units: HULL_CLASSES.map((h) => [roleOf('units', h), countUnits(h, 1), countUnits(h, 3)] as const),
        terrains: WORLD_TYPES.map((t) => [roleOf('terrains', t), terrainName(t)] as const),
        events: RIM_EVENT_KINDS.map((k) => [k, rimEventTitle(k)] as const),
        notes: NOTE_KINDS.map((k) => [k, noteTitle(k)] as const),
        help: helpPage(null, query),
      }));
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [words, query]);

  return (
    <div className="view">
      <header className="view-head">
        <h2>Preview</h2>
        <p className="dim">
          The game’s own text, produced by the real code running in this skin’s words (<code>withLexicon</code>). Names of
          powers and places still come from the core until it translates them at the boundary.
        </p>
      </header>
      {!out.ok ? (
        <p className="over">The skin cannot be previewed: {out.error}</p>
      ) : (
        <div className="preview-grid">
          <section>
            <h3>A force</h3>
            <p>{out.stack}</p>
            <h3>Units, by role</h3>
            {out.units.map(([h, one, three]) => (
              <div key={h} className="pv-row">
                <code>{h}</code> {one} · {three}
              </div>
            ))}
            <h3>Ground, by the stat it gives</h3>
            {out.terrains.map(([t, w]) => (
              <div key={`${t}-${w}`} className="pv-row">
                <code>{t}</code> {w}
              </div>
            ))}
          </section>
          <section>
            <h3>Events</h3>
            {out.events.map(([k, w]) => (
              <div key={k} className="pv-row">
                <code>{k}</code> {w}
              </div>
            ))}
            <h3>Favours</h3>
            {out.notes.map(([k, w]) => (
              <div key={k} className="pv-row">
                <code>{k}</code> {w}
              </div>
            ))}
          </section>
          <section className="pv-help">
            <h3>
              Help <input placeholder=":help topic — empty for the index, all for everything" value={query} onChange={(e) => setQuery(e.target.value)} />
            </h3>
            <pre>{out.help.lines.join('\n')}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

export function IssuesView({ issues, api, surface }: { issues: SkinIssue[]; api: EditApi; surface: SkinSurface }) {
  return (
    <div className="view">
      <header className="view-head">
        <h2>Issues</h2>
        <p className="dim">
          {issues.length === 0
            ? 'Nothing to fix: the composed skin passes SkinSchema and skinViolations, and the studio’s own checks.'
            : 'The game’s own checks (SkinSchema, skinViolations) on the composed skin, then the studio’s. Click one to go to the entry.'}
        </p>
      </header>
      <div className="issues">
        {issues.map((i, n) => {
          const e = i.key ? surface.byKey.get(i.key) : undefined;
          return (
            <button key={n} className={`issue ${i.level}`} disabled={!e} onClick={() => i.key && api.reveal(i.key)}>
              <span className={`issue-level ${i.level}`}>{i.level}</span>
              <span className="issue-where">{e ? `${e.group} · ${e.owner ?? e.section} · ${e.label}` : i.code}</span>
              <span className="issue-msg">{i.message}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
