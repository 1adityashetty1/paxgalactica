import { RIM_EVENT_KINDS, RIM_EVENT_TITLE, type RimEventKind } from '../../../src/domain/events.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SaveSummary } from '../../../src/api/contract.js';
import { api } from '../api.js';
import { ansi256ToHex } from '../color.js';

interface Playable {
  id: string;
  name: string;
  color: number;
  doctrine: string;
}

export function FactionPicker({
  onStart,
  onResume,
  onImport,
  onBack,
}: {
  onStart: (factionId: string, maxTurns: number, sandboxEvent?: RimEventKind) => void;
  onResume: (name: string) => void;
  onImport: (file: File) => void | Promise<void>;
  /** Present only when a campaign is still loaded behind this screen. */
  onBack?: () => void;
}) {
  const [factions, setFactions] = useState<Playable[]>([]);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 30 is the default because it is long enough for two development programmes
  // to pay for themselves and a war to be fought and lost, and short enough
  // that the ending is a horizon rather than a rumour.
  const [maxTurns, setMaxTurns] = useState(30);
  // For looking at one random event, not for playing: see `primeRimSandbox`.
  const [sandbox, setSandbox] = useState<RimEventKind | ''>('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .factions()
      .then((r) => {
        setFactions(r.factions);
        setSaves(r.saveDetails);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="picker">
      <h1>PAX GALACTICA</h1>
      <p className="tagline">
        Four sectors of the Rim. Five powers. No authority worth the name.
      </p>

      {error && <p className="error">{error}</p>}

      {/* Only when there is something to go back TO. On a cold start this
          screen is the whole app and a Back button would lead nowhere. */}
      {onBack && (
        <p className="picker-back">
          <button className="endtalk" onClick={onBack}>
            ← Back to the campaign in progress
          </button>
        </p>
      )}

      {saves.length > 0 && (
        <SaveList
          saves={saves}
          factions={factions}
          filter={filter}
          onFilter={setFilter}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          onResume={onResume}
          onDelete={(name) => {
            if (!window.confirm(`Delete the save "${name}"? This cannot be undone.`)) return;
            void api
              .deleteSave(name)
              .then((r) => setSaves(r.saveDetails))
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
          }}
        />
      )}

      <div className="resume">
        <h2>Load a save file</h2>
        <p className="hint">
          A <code>.tar.gz</code> saved with the <strong>Save</strong> button, from any machine. It is
          verified by replaying its whole journal before it is loaded, and a game saved mid-turn
          opens mid-turn.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".gz,.tgz,.tar.gz,application/gzip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear the input so re-picking the same file fires onChange again.
            e.target.value = '';
            if (file) void onImport(file);
          }}
        />
        <button className="resume-btn" onClick={() => fileRef.current?.click()}>
          Choose file…
        </button>
      </div>

      <h2>Campaign length</h2>
      <div className="length-picker">
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={maxTurns}
          onChange={(e) => setMaxTurns(Number(e.target.value))}
          aria-label="Campaign length in turns"
        />
        <span className="length-value">{maxTurns} turns</span>
      </div>
      <p className="hint">
        When the last turn is played the campaign ends and the Rim is summed up. Long enough to
        matter, short enough to finish — a shipyard takes five turns, and a war rather longer.
      </p>

      <h2>Sandbox</h2>
      <div className="length-picker">
        <select
          value={sandbox}
          onChange={(e) => setSandbox(e.target.value as RimEventKind | '')}
          aria-label="Sandbox event"
        >
          <option value="">Off — a real campaign</option>
          {RIM_EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              Only {RIM_EVENT_TITLE[k].toLowerCase()}, every turn
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        For looking at one random event: it fires every turn, aimed at you, on a board set up so it
        can. Saved on its own as <code>sandbox_…</code>, so it never touches a campaign you are
        playing.
      </p>

      <h2>Choose your faction</h2>
      <div className="faction-cards">
        {factions.map((f) => (
          <button
            key={f.id}
            className="faction-card"
            style={{ borderColor: ansi256ToHex(f.color) }}
            onClick={() => onStart(f.id, maxTurns, sandbox === '' ? undefined : sandbox)}
          >
            <strong style={{ color: ansi256ToHex(f.color) }}>{f.name}</strong>
            <span>{f.doctrine}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Saves shown before "show all": enough for the ones a player is likely to want. */
const SAVES_SHOWN = 12;

/**
 * The server's saves, newest first, each with whose campaign it is, how far it
 * got and when it was written — a wall of bare names was all there was, and
 * playtests had left hundreds of them.
 */
function SaveList({
  saves,
  factions,
  filter,
  onFilter,
  showAll,
  onShowAll,
  onResume,
  onDelete,
}: {
  saves: SaveSummary[];
  factions: Playable[];
  filter: string;
  onFilter: (v: string) => void;
  showAll: boolean;
  onShowAll: () => void;
  onResume: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const faction = (id: string | null) => factions.find((f) => f.id === id);
  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return saves.filter((s) => {
      const hay = `${s.name} ${faction(s.playerFactionId)?.name ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [saves, filter, factions]);
  const visible = showAll || filter.trim() ? shown : shown.slice(0, SAVES_SHOWN);
  return (
    <div className="resume">
      <h2>Resume a saved campaign</h2>
      {saves.length > SAVES_SHOWN && (
        <input
          className="save-filter"
          type="search"
          value={filter}
          placeholder={`Search ${saves.length} saves by name or faction`}
          onChange={(e) => onFilter(e.target.value)}
          aria-label="Search saves"
        />
      )}
      <ul className="save-list">
        {visible.map((s) => {
          const f = faction(s.playerFactionId);
          return (
            <li key={s.name} className="save-row">
              <button className="save-open" onClick={() => onResume(s.name)} title={`Resume ${s.name}`}>
                <span className="save-name">{s.name}</span>
                <span className="save-meta">
                  {f ? <span style={{ color: ansi256ToHex(f.color) }}>{f.name}</span> : <span>unknown power</span>}
                  {' · '}turn {s.turn}
                  {s.maxTurns !== null ? ` of ${s.maxTurns}` : ''}
                  {s.finished ? ' · finished' : ''}
                  {s.savedAt ? ` · ${savedWhen(s.savedAt)}` : ''}
                </span>
              </button>
              <button className="save-delete" onClick={() => onDelete(s.name)} aria-label={`Delete ${s.name}`} title="Delete this save">
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="hint">No save matches.</p>}
      {!showAll && !filter.trim() && shown.length > SAVES_SHOWN && (
        <button className="endtalk" onClick={onShowAll}>
          Show all {shown.length}
        </button>
      )}
    </div>
  );
}

/** "today 14:02", "yesterday", or a date — how long ago a save was written. */
function savedWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
