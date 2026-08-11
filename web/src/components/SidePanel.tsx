import { useState } from 'react';
import { FleetsPanel } from './FleetsPanel.js';
import { TradePanel } from './TradePanel.js';
import { STAT_NAMES } from '../../../src/domain/checks.js';
import { describeEffect } from '../../../src/domain/diplomacy.js';
import {
  agentsVisibleTo,
  dispositionBetween,
  fleetStrengthOf,
  getFaction,
  getSystem,
  ledgerFor,
  commitmentsOf,
  dissentPenalty,
  effectiveStats,
  systemIncome,
  treatiesFor,
  warsFor,
  type WorldState,
} from '../../../src/domain/state.js';
import type { Briefing } from '../../../src/engine/briefing.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';

type Tab = 'factions' | 'system' | 'fleets' | 'trade' | 'orders' | 'standing' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'factions', label: 'Factions' },
  { id: 'system', label: 'System' },
  { id: 'fleets', label: 'Fleets' },
  { id: 'trade', label: 'Trade' },
  { id: 'orders', label: 'Orders' },
  { id: 'standing', label: 'Treaties' },
  { id: 'log', label: 'Log' },
];

export function SidePanel({
  state,
  selectedId,
  briefing,
  onSelect,
  onTalk,
  activeChannel,
}: {
  state: WorldState;
  selectedId: string | null;
  briefing: Briefing | null;
  onSelect: (id: string) => void;
  onTalk: (factionId: string) => void;
  activeChannel: string | null;
}) {
  const [tab, setTab] = useState<Tab>('factions');

  return (
    <aside className="panel">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'factions' && (
          <Factions state={state} onTalk={onTalk} activeChannel={activeChannel} />
        )}
        {tab === 'system' && <SystemTab state={state} selectedId={selectedId} onSelect={onSelect} />}
        {tab === 'fleets' && <FleetsPanel state={state} onSelect={onSelect} />}
        {tab === 'trade' && <TradePanel state={state} onSelect={onSelect} />}
        {tab === 'orders' && <Orders state={state} briefing={briefing} />}
        {tab === 'standing' && <Standing state={state} onSelect={onSelect} />}
        {tab === 'log' && <Log state={state} />}
      </div>
    </aside>
  );
}

function Factions({
  state,
  onTalk,
  activeChannel,
}: {
  state: WorldState;
  onTalk: (factionId: string) => void;
  activeChannel: string | null;
}) {
  return (
    <div className="factions">
      {state.factions.map((f) => {
        const effective = effectiveStats(state, f.id);
        const penalty = dissentPenalty(f.dissent);
        const isPlayer = f.id === state.playerFactionId;
        const disposition = dispositionBetween(state, f.id, state.playerFactionId);
        const held = state.systems.filter((s) => s.controllerFactionId === f.id).length;
        const color = ansi256ToHex(f.displayColor);
        const ledger = ledgerFor(state, f.id);
        return (
          <section key={f.id} className={isPlayer ? 'faction you' : 'faction'}>
            <header>
              <span className="swatch" style={{ background: color }} />
              <strong style={{ color }}>{f.name}</strong>
              {isPlayer ? (
                <span className="badge">you</span>
              ) : (
                <>
                  <span className={`disp ${dispClass(disposition)}`}>
                    {disposition >= 0 ? '+' : ''}
                    {disposition}
                  </span>
                  <button
                    className="talk-btn"
                    onClick={() => onTalk(f.id)}
                    disabled={activeChannel !== null}
                    title={
                      activeChannel
                        ? 'Close the open channel first'
                        : `Open a channel with ${f.name}`
                    }
                  >
                    talk
                  </button>
                </>
              )}
            </header>
            <div className="meta">
              fleet {fleetStrengthOf(state, f.id)} · {f.credits}cr · {held} systems
              {isPlayer && (
                <>
                  {' '}
                  · <span className={ledger.net >= 0 ? 'good' : 'bad'}>
                    {ledger.net >= 0 ? '+' : ''}
                    {ledger.net}/turn
                  </span>
                </>
              )}
            </div>
            {/* Bars rather than five bare numbers: stats only matter as a
                comparison, and a row of digits does not read as one.

                These are EFFECTIVE stats — what a check actually rolls
                against. Showing the base value here was a quiet lie: dissent
                and hostile stat_debuffs both reduce it, so the number on
                screen was not the number the game used, and a player could
                not tell why their odds had worsened. The base is kept
                alongside whenever the two differ. */}
            <div className="stats">
              {STAT_NAMES.map((s) => {
                const live = effective[s];
                const base = f.stats[s];
                const reduced = live < base;
                return (
                  <div
                    key={s}
                    className="stat"
                    title={reduced ? `${s} ${live} (base ${base}, reduced by ${base - live})` : `${s} ${live}`}
                  >
                    <span className="stat-name">{s.slice(0, 3)}</span>
                    <span className="stat-bar">
                      {reduced && (
                        <span className="stat-lost" style={{ width: `${(base / 20) * 100}%` }} />
                      )}
                      <span style={{ width: `${(live / 20) * 100}%`, background: color }} />
                    </span>
                    <span className={reduced ? 'stat-value bad' : 'stat-value'}>{live}</span>
                  </div>
                );
              })}
            </div>
            {f.dissent > 0 && (
              <div
                className="dissent"
                title="Your own institutions have been overruled once too often. Every stat drops one point per 25 dissent. It falls by 2 a turn on its own."
              >
                dissent {f.dissent}/100
                {penalty > 0 && <span className="bad"> · −{penalty} to every stat</span>}
              </div>
            )}
            <div className="ethics">
              <span className="chip">{f.warEthic}</span>
              <span className="chip">{f.tradeEthic.replace('_', ' ')}</span>
            </div>
            <p className="doctrine">{f.doctrine}</p>
          </section>
        );
      })}
    </div>
  );
}

function SystemTab({
  state,
  selectedId,
  onSelect,
}: {
  state: WorldState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sys = selectedId ? getSystem(state, selectedId) : null;
  if (!sys) return <p className="empty">Click a system on the map.</p>;

  const controller = sys.controllerFactionId ? getFaction(state, sys.controllerFactionId) : null;
  const color = controller ? ansi256ToHex(controller.displayColor) : NEUTRAL;
  const here = state.pendingOrders.filter((o) => o.targetId === sys.id || o.originId === sys.id);
  const income = systemIncome(state, sys);
  const shipRows = Object.entries(sys.ships ?? {}).filter(([, n]) => n > 0);
  const incomeRows = Object.entries(income.shares).filter(([, v]) => v > 0);

  return (
    <div className="system-detail">
      <h3 style={{ color }}>{sys.name}</h3>
      <p className="meta">{sys.sector}</p>
      <dl>
        <dt>Held by</dt>
        <dd style={{ color }}>{controller?.name ?? 'unaligned'}</dd>
        <dt>Garrison</dt>
        <dd>
          {sys.garrison}
          {sys.garrisonMax > 0 && (
            <span className="meta"> / {sys.garrisonMax} max</span>
          )}
        </dd>
        <dt>Strategic value</dt>
        <dd>{sys.strategicValue}/10</dd>
        <dt>Base income</dt>
        <dd>{income.base}/turn</dd>
      </dl>

      {income.contested && <p className="contested-note">Contested — income is being split.</p>}

      <h4>Ships present</h4>
      {shipRows.length === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <ul className="ship-list">
          {shipRows.map(([id, n]) => (
            <li key={id}>
              <span className="swatch" style={{ background: colourOf(state, id) }} />
              <span style={{ color: colourOf(state, id) }}>{getFaction(state, id)?.name ?? id}</span>
              <span className="count">{n}</span>
            </li>
          ))}
        </ul>
      )}

      <h4>Income per turn</h4>
      {incomeRows.length === 0 ? (
        <p className="empty">Pays nobody. An unaligned world owes no one until a treaty says so.</p>
      ) : (
        <ul className="ship-list">
          {incomeRows.map(([id, v]) => (
            <li key={id}>
              <span className="swatch" style={{ background: colourOf(state, id) }} />
              <span style={{ color: colourOf(state, id) }}>{getFaction(state, id)?.name ?? id}</span>
              <span className={income.byTreaty.includes(id) ? 'count treaty' : 'count'}>
                {v}
                {income.byTreaty.includes(id) ? ' (treaty)' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h4>Hyperlanes</h4>
      <ul className="lanes-list">
        {sys.hyperlaneEdges.map((id) => (
          <li key={id}>
            <button className="link" onClick={() => onSelect(id)}>
              {getSystem(state, id)?.name ?? id}
            </button>
          </li>
        ))}
      </ul>
      <h4>Orders here</h4>
      {here.length === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <ul className="orders-list">
          {here.map((o) => (
            <li key={o.id}>
              {o.label} · {o.durationTurns - o.progress} left
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Orders({ state, briefing }: { state: WorldState; briefing: Briefing | null }) {
  if (state.pendingOrders.length === 0) {
    return <p className="empty">Nothing under way. Time advances when you end the turn.</p>;
  }
  const sorted = [...state.pendingOrders].sort(
    (a, b) => a.durationTurns - a.progress - (b.durationTurns - b.progress),
  );
  return (
    <div className="orders">
      {briefing && (
        <p className="ledger">
          Treasury {briefing.treasury}cr ·{' '}
          <span className={briefing.ledger.net >= 0 ? 'good' : 'bad'}>
            {briefing.ledger.net >= 0 ? '+' : ''}
            {briefing.ledger.net}/turn
          </span>
        </p>
      )}
      {sorted.map((o) => {
        const owner = getFaction(state, o.factionId);
        const color = owner ? ansi256ToHex(owner.displayColor) : NEUTRAL;
        const remaining = o.durationTurns - o.progress;
        return (
          <div key={o.id} className="order">
            <div className="order-head" style={{ color }}>
              {o.label}
              <span className={remaining === 1 ? 'eta soon' : 'eta'}>
                {remaining === 1 ? 'next turn' : `${remaining} turns`}
              </span>
            </div>
            <div className="progress">
              <span style={{ width: `${(o.progress / o.durationTurns) * 100}%`, background: color }} />
            </div>
            <div className="meta">
              {o.factionId === state.playerFactionId ? 'yours' : owner?.name} ·{' '}
              {o.type.replace(/_/g, ' ')} · {o.interruptible ? 'raidable' : 'locked'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function colourOf(state: WorldState, factionId: string): string {
  const f = getFaction(state, factionId);
  return f ? ansi256ToHex(f.displayColor) : NEUTRAL;
}

/**
 * Treaties, wars and agents in one place.
 *
 * All three are standing commitments the player has to reason about between
 * turns, and none of them were visible anywhere before — a treaty with real
 * mechanical terms is useless if you cannot read the terms.
 */
function Standing({ state, onSelect }: { state: WorldState; onSelect: (id: string) => void }) {
  const me = state.playerFactionId;
  const treaties = treatiesFor(state, me);
  const wars = warsFor(state, me);
  const agents = agentsVisibleTo(state, me);
  const commitments = commitmentsOf(state, me);

  return (
    <div className="standing">
      {/* Commitments first: they are the things most likely to block an
          action the player is about to try, and a ruling of "you are already
          bound" only reads as fair if the binding was visible beforehand. */}
      {commitments.length > 0 && (
        <>
          <h4>Standing commitments</h4>
          {commitments.map((c) => (
            <div key={c.id} className="commitment">
              <div className="commitment-head">
                <span>{c.kind.replace(/_/g, ' ')}</span>
                {c.exclusive && (
                  <span className="chip" title="You may hold only one of these at a time.">
                    exclusive
                  </span>
                )}
              </div>
              <p className="commitment-text">{c.text}</p>
              <p className="muted">
                since turn {c.establishedTurn} ·{' '}
                {c.factionIds
                  .filter((id) => id !== me)
                  .map((id) => state.factions.find((f) => f.id === id)?.name ?? id)
                  .join(', ') || 'internal'}
              </p>
            </div>
          ))}
        </>
      )}

      <h4>Treaties</h4>
      {treaties.length === 0 ? (
        <p className="empty">No agreements in force.</p>
      ) : (
        treaties.map((t) => {
          const other = t.parties.find((p) => p !== me) ?? '?';
          const flow = t.terms.incomePerTurn[me] ?? 0;
          return (
            <div key={t.id} className="treaty">
              <div className="treaty-head">
                <strong style={{ color: colourOf(state, other) }}>
                  {t.type.replace(/_/g, ' ')}
                </strong>
                <span className="eta">
                  {t.expiresTurn === null
                    ? 'indefinite'
                    : `${Math.max(0, t.expiresTurn - state.turn)} turns left`}
                </span>
              </div>
              <p className="meta">with {getFaction(state, other)?.name ?? other}</p>
              {t.summary && <p className="treaty-summary">{t.summary}</p>}
              <ul className="terms">
                {t.terms.territory.length > 0 && (
                  <li>
                    territory:{' '}
                    {t.terms.territory.map((id) => (
                      <button key={id} className="link" onClick={() => onSelect(id)}>
                        {getSystem(state, id)?.name ?? id}
                      </button>
                    ))}
                  </li>
                )}
                {Object.entries(t.terms.shipsPledged).map(([id, n]) => (
                  <li key={id}>ships pledged: {getFaction(state, id)?.name ?? id} — {n}</li>
                ))}
                {flow !== 0 && (
                  <li className={flow > 0 ? 'good' : 'bad'}>
                    income: {flow > 0 ? '+' : ''}
                    {flow}/turn
                  </li>
                )}
                {t.terms.incomeShares.map((share, i) => (
                  <li key={i}>
                    {Math.round(share.share * 100)}% of{' '}
                    <button className="link" onClick={() => onSelect(share.systemId)}>
                      {getSystem(state, share.systemId)?.name ?? share.systemId}
                    </button>{' '}
                    → {getFaction(state, share.factionId)?.name ?? share.factionId}
                  </li>
                ))}
                {t.terms.mutualDefenseTrigger && (
                  <li className="trigger">triggers on: {t.terms.mutualDefenseTrigger}</li>
                )}
              </ul>
            </div>
          );
        })
      )}

      <h4>At war with</h4>
      {wars.length === 0 ? (
        <p className="empty">Nobody, formally.</p>
      ) : (
        <ul className="war-list">
          {wars.map((id) => (
            <li key={id} style={{ color: colourOf(state, id) }}>
              {getFaction(state, id)?.name ?? id}
            </li>
          ))}
        </ul>
      )}

      <h4>Agents</h4>
      {agents.length === 0 ? (
        <p className="empty">None deployed, none discovered.</p>
      ) : (
        agents.map((a) => {
          const mine = a.ownerFactionId === me;
          return (
            <div key={a.id} className={a.exposed ? 'agent burned' : 'agent'}>
              <div className="treaty-head">
                <strong style={{ color: colourOf(state, a.ownerFactionId) }}>
                  {mine ? 'Yours' : getFaction(state, a.ownerFactionId)?.name} · {a.mission}
                </strong>
                <span className={a.successChance >= 60 ? 'eta' : 'eta soon'}>
                  {a.successChance}%/turn
                </span>
              </div>
              <p className="meta">
                on{' '}
                <button className="link" onClick={() => onSelect(a.systemId)}>
                  {getSystem(state, a.systemId)?.name ?? a.systemId}
                </button>
                {a.exposed && ' — BURNED, no longer effective'}
              </p>
              <p className="agent-effect">{describeEffect(a.effect)}</p>
              {a.cover && <p className="meta">cover: {a.cover}</p>}
            </div>
          );
        })
      )}
    </div>
  );
}

function Log({ state }: { state: WorldState }) {
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const all = [...new Set(state.eventLog.map((e) => e.kind))];
  const shown = kinds.size === 0 ? state.eventLog : state.eventLog.filter((e) => kinds.has(e.kind));

  const toggle = (k: string) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="log">
      {/* rejection and clamp entries are debugging gold — filterable, not hidden */}
      <div className="filters">
        {all.map((k) => (
          <button key={k} className={kinds.has(k) ? 'chip on' : 'chip'} onClick={() => toggle(k)}>
            {k}
          </button>
        ))}
      </div>
      <ul>
        {[...shown].reverse().map((e, i) => (
          <li key={i} className={`log-${e.kind}`}>
            <span className="turn">[{e.turn}]</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function dispClass(n: number): string {
  if (n >= 40) return 'ally';
  if (n >= 10) return 'warm';
  if (n > -10) return 'neutral';
  if (n > -50) return 'cool';
  return 'hostile';
}
