import { WorldSprite, worldTypeLabel } from './WorldSprite.js';
import { useState } from 'react';
import { FactionAvatar } from './FactionAvatar.js';
import { FleetsPanel } from './FleetsPanel.js';
import { TradePanel } from './TradePanel.js';
import { STAT_NAMES } from '../../../src/domain/checks.js';
import { debtsFor } from '../../../src/domain/debt.js';
import { describeOutstanding, loansFor } from '../../../src/domain/loan.js';
import { assetWorthRangeTo } from '../../../src/domain/diplomacy.js';
import { describeOrderEffect } from '../../../src/domain/development.js';
import { describeEffect } from '../../../src/domain/diplomacy.js';
import { CommanderIcon } from './BattleIcons.js';
import { agentStanding } from '../../../src/domain/diplomacy.js';

import {
  MAX_ACTIVE_COMMANDERS,
  activeCommanders,
  archetypeOf,
  commanderEffect,
  commanderFor,
  commanderPassive,
  toNextVeterancy,
  veterancyLabel,
} from '../../../src/domain/command.js';
import { worldFlavour } from '../../../src/ui/worldtext.js';
import {
  presentAt,
  agentsVisibleTo,
  dispositionBetween,
  fleetStrengthOf,
  getFaction,
  getSystem,
  ledgerFor,
  WORLD_TYPE_STAT,
  commitmentsOf,
  dissentPenalty,
  MAX_DISSENT_PENALTY,
  effectiveStats,
  systemIncome,
  fixturesAt,
  statFixtureAt,
  treatiesFor,
  warsFor,
  type WorldState,
} from '../../../src/domain/state.js';
import type { Briefing } from '../../../src/engine/briefing.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';
import { logWindow } from '../../../src/ui/logview.js';

type Tab = 'factions' | 'system' | 'fleets' | 'commanders' | 'trade' | 'assets' | 'orders' | 'standing' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'factions', label: 'Factions' },
  { id: 'system', label: 'System' },
  { id: 'fleets', label: 'Fleets' },
  // Beside Fleets, not beside Factions. An officer is a fact about a FLEET —
  // who takes it into its next battle — and putting the line under a faction's
  // doctrine read as a claim about the power itself, which is what the ethics
  // chips directly above it are for.
  { id: 'commanders', label: 'Command' },
  { id: 'trade', label: 'Trade' },
  // Its own tab rather than a section of Treaties. A treaty is an arrangement
  // you negotiated and so already know about; an asset ARRIVES — a prisoner
  // off a won battle, an operative your people caught, a dossier out of an
  // accord — unasked and unannounced, and one scroll down inside another panel
  // a thing that appears on its own is a thing nobody sees appear.
  { id: 'assets', label: 'Assets' },
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
  const heldCount = heldAssets(state).length;

  return (
    <aside className="panel">
      <nav className="tabs">
        {TABS.map((t) => {
          // Only Assets carries a count, because it is the only tab whose
          // contents arrive without the player doing anything. Every other tab
          // is somewhere a player goes on purpose.
          const count = t.id === 'assets' ? heldCount : 0;
          return (
            <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </nav>
      <div className="panel-body">
        {tab === 'factions' && (
          <Factions state={state} onTalk={onTalk} activeChannel={activeChannel} />
        )}
        {tab === 'system' && <SystemTab state={state} selectedId={selectedId} onSelect={onSelect} />}
        {tab === 'fleets' && <FleetsPanel state={state} onSelect={onSelect} />}
        {tab === 'commanders' && <Command state={state} />}
        {tab === 'trade' && <TradePanel state={state} onSelect={onSelect} />}
        {tab === 'assets' && <Assets state={state} />}
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
              <FactionAvatar faction={f} />
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
                title={`Your own institutions have been overruled once too often. Every stat is reduced by ${penalty} (up to ${MAX_DISSENT_PENALTY} at 100 dissent). It falls by 2 a turn on its own.`}
              >
                dissent {f.dissent}/100
                {penalty > 0 && <span className="bad"> · −{penalty} to every stat</span>}
              </div>
            )}
            <div className="ethics">
              <span className="chip">{f.warEthic}</span>
              <span className="chip">{f.tradeEthic.replace('_', ' ')}</span>
              {/* Who this power charges for passage. Shown as a chip beside the
                  ethics because that is where it used to live — tolling was a
                  property of `extortionist` and is now a policy any power can
                  set, so the ethic alone no longer answers "does this power
                  tax me". The one that matters most to the reader is the toll
                  charged to THEM, so it is called out separately. */}
              {f.tollTargets.includes(state.playerFactionId) && f.id !== state.playerFactionId && (
                <span className="chip bad" title="You pay this power to cross its space. Lifting it is something to negotiate for.">
                  tolls you
                </span>
              )}
              {f.tollTargets.length > 0 && (
                <span
                  className="chip"
                  title={`Charges for passage: ${f.tollTargets
                    .map((id) => state.factions.find((x) => x.id === id)?.name ?? id)
                    .join(', ')}`}
                >
                  tolls {f.tollTargets.length}
                </span>
              )}
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
  const shipRows = presentAt(sys);
  const incomeRows = Object.entries(income.shares).filter(([, v]) => v > 0);
  /**
   * Operatives working this world — yours, plus any rival's that has been
   * burned. `agentsVisibleTo` is already exactly that rule, so "discovered"
   * needs no second definition.
   *
   * It rendered only under Treaties, which is backwards for a mechanic whose
   * whole nature is that it is SOMEWHERE: an operative has an `atSystemId`, its
   * effects are read per system, and the question a player asks is *who is
   * working on this world*. Answering it only in a global list meant reading a
   * treaty panel to learn something about a planet.
   */
  const operatives = agentsVisibleTo(state, state.playerFactionId).filter(
    (a) => a.systemId === sys.id,
  );
  const officersHere = (state.commanders ?? []).filter(
    (c) => c.status === 'active' && c.atSystemId === sys.id,
  );
  /**
   * What is built on this world. A fixture is the one asset kind that cannot
   * leave, so it is a fact about the ground rather than about a warehouse —
   * and since it changes hands with the world, it is part of what taking this
   * world is worth.
   */
  const fixtures = fixturesAt(state, sys.id);
  /**
   * What this world could carry, when the player holds it and it carries
   * nothing yet. The ground rule is the whole mechanism — a fixture must name
   * the attribute the world's type makes — so the panel says which one rather
   * than leaving a player to discover it from a rejection.
   */
  const ground = WORLD_TYPE_STAT[sys.worldType];
  const slotFree =
    sys.controllerFactionId === state.playerFactionId && statFixtureAt(state, sys.id) === undefined;

  return (
    <div className="system-detail">
      <div className="world-head">
        <WorldSprite type={sys.worldType} size={84} />
        <div>
          <h3 style={{ color }}>{sys.name}</h3>
          <p className="meta">{sys.sector}</p>
          <p className="meta">{worldTypeLabel(sys.worldType)}</p>
        </div>
      </div>
      {/* The line that joins the type to the modifier. Without it the panel
          said "Arid" and "counts toward: might" and left the player to take on
          faith that one produced the other.

          Below the head rather than beside the sprite: the head is a flex row
          about 190px wide once the 84px sprite has its share, which wrapped
          three sentences to twenty-odd characters a line. This is the only
          prose on the panel and it should get the panel's width. */}
      <p className="world-flavour">
        {worldFlavour(sys.id, sys.worldType, sys.homeFactionId)}
      </p>
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
        <dt title="Worlds of a kind count together: two buy a point of that stat, four buy two, six buy three. Concentration pays — a single world of a kind buys nothing.">
          Ground counts toward
        </dt>
        <dd>{WORLD_TYPE_STAT[sys.worldType]}</dd>
        {sys.homeFactionId !== null && sys.homeFactionId !== sys.controllerFactionId && (
          <>
            <dt title="A share of what this world pays its holder, charged every turn. Institutions built for another state do not administer themselves.">
              Occupied
            </dt>
            <dd className="bad">
              taken from {getFaction(state, sys.homeFactionId)?.name ?? sys.homeFactionId}
            </dd>
          </>
        )}
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
      {/* Built on this world, and taken with it.

          Shown whoever holds it, because a plant or a base is a structure on a
          surface: `system.ships` is not redacted either. The holder is named
          rather than assumed, since a fixture pays whoever stands over the world
          and that need not be the power that built it. */}
      {(fixtures.length > 0 || slotFree) && <h4>Fixtures here</h4>}
      {slotFree && (
        <p className="muted">
          Nothing built yet. This ground makes {ground}: it can carry one fixture that names{' '}
          {ground}.
        </p>
      )}
      {fixtures.length > 0 && (
        <>
          <ul className="ship-list">
            {fixtures.map((w) => {
              const holder = getFaction(state, w.heldBy);
              const spread =
                w.yield?.kind === 'stat'
                  ? w.yield.stats
                      .map((x) => `${x.points > 0 ? '+' : ''}${x.points} ${x.stat}`)
                      .join(' · ')
                  : null;
              return (
                <li key={w.id} className="agent-row" title={w.text}>
                  <span className="swatch" style={{ background: colourOf(state, w.heldBy) }} />
                  <span style={{ color: colourOf(state, w.heldBy) }}>
                    {/* A proper name for a building — "Power Plant", not the slug. */}
                    {w.kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    {' · '}
                    {holder?.name ?? w.heldBy}
                  </span>
                  {spread && <span className="count">{spread}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {/* Officers standing on this world.
          Not redacted, for the reason `system.ships` is not: they are aboard a
          fleet, and a fleet in orbit is a thing anybody with eyes can see. What
          stays hidden is their power's ORDERS, which is a different question. */}
      {officersHere.length > 0 && (
        <>
          <h4>Officers here</h4>
          <ul className="ship-list">
            {officersHere.map((c) => (
              <li key={c.id} className="agent-row">
                <span style={{ color: colourOf(state, c.factionId), display: 'flex' }}>
                  <CommanderIcon title={archetypeOf(c.archetype).effect} />
                </span>
                <span style={{ color: colourOf(state, c.factionId) }}>{c.name}</span>
                <span className="count">{veterancyLabel(c.battles)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Operatives here</h4>
      {operatives.length === 0 ? (
        <p className="empty">None of yours, and nobody else's has been caught.</p>
      ) : (
        <ul className="ship-list">
          {operatives.map((a) => {
            const mine = a.ownerFactionId === state.playerFactionId;
            return (
              <li key={a.id} className={a.exposed ? 'agent-row burned' : 'agent-row'}>
                <span className="swatch" style={{ background: colourOf(state, a.ownerFactionId) }} />
                <span style={{ color: colourOf(state, a.ownerFactionId) }}>
                  {/* The name first, because that is what a player remembers
                      about a network — and a burned line reads as somebody
                      caught rather than a row going grey. Falls back to the
                      cover and then the owner, so an operative from a campaign
                      saved before they had names still renders. */}
                  {a.name || a.cover || (mine ? 'Yours' : (getFaction(state, a.ownerFactionId)?.name ?? a.ownerFactionId))}
                  {' · '}
                  {mine ? 'yours' : (getFaction(state, a.ownerFactionId)?.name ?? a.ownerFactionId)}
                  {' · '}
                  {a.mission}
                </span>
                <span className="count">
                  {/* The record, then the odds. A caught face is permanent, so
                      it is worth seeing before deciding to ransom one home. */}
                  {a.operations > 0 && `${agentStanding(a.operations)} · `}
                  {a.timesCaught > 0 && `caught ${a.timesCaught}× · `}
                  {a.exposed ? 'burned' : `${a.successChance}%`}
                </span>
              </li>
            );
          })}
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

/**
 * Who takes each power's next battle, and who took the last ones.
 *
 * It began as a line under each faction's ethics chips and read as a claim
 * about the POWER — which is exactly what the chips immediately above it are
 * for, so a reader arriving at "fights a point harder, everywhere" had every
 * reason to think it was another doctrine. It is not: it is a fact about a
 * fleet, and about a specific person who may not be there next turn.
 *
 * The roster is the other half of why this wants its own surface. A faction row
 * has space for one line, and the interesting thing about a commander is the
 * record — how many engagements, and who came before.
 */
function Command({ state }: { state: WorldState }) {
  return (
    <div className="command-panel">
      {state.factions.map((f) => {
        const colour = colourOf(state, f.id);
        // The whole roster, senior first — the same order `commanderFor` picks
        // by, so the officer at the top is the one running the establishment.
        const roster = activeCommanders(state.commanders, f.id).sort(
          (a, b) => b.battles - a.battles || a.id.localeCompare(b.id),
        );
        const officer = roster[0];
        const fallen = (state.commanders ?? [])
          .filter((c) => c.factionId === f.id && c.status === 'lost')
          .reverse();
        // Alive, and in somebody else's hands. Worth its own line rather than
        // being run in with the dead: one of these can be bought back.
        const held = (state.commanders ?? []).filter(
          (c) => c.factionId === f.id && c.status === 'captured',
        );
        return (
          <section key={f.id} className="command-faction">
            <h4 style={{ color: colour }}>{f.name}</h4>
            {officer !== undefined ? (
              <>
                <p className="command-name" style={{ color: colour }}>
                  {officer.name}
                </p>
                <p className="command-effect">{commanderEffect(officer)}</p>
                {/* What they are worth on a turn with nobody fighting. Shown
                    beside the battle effect rather than under the record,
                    because the two together are the officer — and for `convoy`
                    this line is the whole reason to want them. */}
                <p className="command-effect">{commanderPassive(officer)}</p>
                <p className="meta">
                  known for {archetypeOf(officer.archetype).known}
                </p>
                <p className="meta">
                  {veterancyLabel(officer.battles)}
                  {officer.battles > 0 &&
                    ` · ${officer.battles} engagement${officer.battles === 1 ? '' : 's'}`}
                  {' · appointed turn '}
                  {officer.appointedTurn}
                </p>
                {/* Where they stand on the ladder, because a cost a player
                    cannot read coming is a cost they cannot weigh — and this
                    one is paid by losing them, not by spending credits. */}
                {/* Where they are standing, or the fleet they are aboard — the
                    thing that decides which battles they command at all. */}
                <p className="meta command-where">
                  {officer.atSystemId
                    ? `at ${state.systems.find((x) => x.id === officer.atSystemId)?.name ?? officer.atSystemId}`
                    : (() => {
                        const o = state.pendingOrders.find(
                          (x) => x.commanderId === officer.id,
                        );
                        return o
                          ? `under way to ${state.systems.find((x) => x.id === o.targetId)?.name ?? o.targetId}`
                          : 'unposted';
                      })()}
                </p>
                <p className="meta command-ladder">
                  {toNextVeterancy(officer.battles) === null
                    ? 'as good as an officer gets'
                    : `${toNextVeterancy(officer.battles)} more to improve again`}
                </p>
              </>
            ) : (
              <p className="empty">No officer. The fleet answers to nobody in particular.</p>
            )}
            {roster.length > 1 && (
              <ul className="ship-list command-roster">
                {roster.slice(1).map((c) => (
                  <li key={c.id} className="agent-row">
                    <span style={{ color: colour, display: 'flex' }}>
                      <CommanderIcon title={archetypeOf(c.archetype).effect} />
                    </span>
                    <span style={{ color: colour }}>{c.name}</span>
                    <span className="count">{commanderEffect(c)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="meta">
              {roster.length} of {MAX_ACTIVE_COMMANDERS} in post
              {/* Only the senior officer's passive applies: one person runs the
                  establishment, and the rest command battles. */}
              {roster.length > 1 && ' · the senior officer’s passive is the one that applies'}
            </p>
            {held.length > 0 && (
              <p className="meta command-held">
                held prisoner: {held.map((c) => c.name).join(', ')}
              </p>
            )}
            {fallen.length > 0 && (
              <p className="meta command-fallen">
                lost:{' '}
                {fallen
                  .map((c) => `${c.name} (${veterancyLabel(c.battles)})`)
                  .join(', ')}
              </p>
            )}
          </section>
        );
      })}
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
            {/*
              What the work will actually deliver, and what has been sunk into
              it. A programme whose payoff is invisible until it lands is a
              programme the player cannot weigh against defending it.
            */}
            {o.onComplete && (
              <div className="meta delivers">
                delivers {describeOrderEffect(o.onComplete)}
                {o.investedCredits > 0 && ` · ${o.investedCredits}cr committed`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A void condition in words. The shapes are closed, so this is a lookup. */
function voidText(state: WorldState, v: { kind: string; by: string; target: string }): string {
  const who = getFaction(state, v.by)?.name ?? v.by;
  const them = getFaction(state, v.target)?.name ?? v.target;
  switch (v.kind) {
    case 'treaty_with':
      return `${who} signs with ${them}`;
    case 'attacks':
      return `${who} attacks ${them}`;
    case 'insolvent':
      return `${who} is running at a loss`;
    case 'world_lost':
      return `${who} loses ${getSystem(state, v.target)?.name ?? v.target}`;
    case 'asset_lost':
      return `${who} no longer holds what this was written against`;
    default:
      return `${v.kind}: ${who}`;
  }
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
/**
 * What this power holds that it could trade: never a fixture. A fixture cannot
 * be traded, cannot be pledged and changes hands only with the ground under it,
 * so listing it among things a power is *holding* invites exactly the bargain
 * the reducer refuses; it is drawn on the System panel, beside the garrison it
 * is really a property of.
 */
function heldAssets(state: WorldState) {
  return (state.assets ?? []).filter((a) => a.heldBy === state.playerFactionId && a.portable);
}

/**
 * The Assets tab. The count on its label is the point of it — see `TABS`.
 */
function Assets({ state }: { state: WorldState }) {
  const me = state.playerFactionId;
  const assets = heldAssets(state);

  if (assets.length === 0) {
    // Not a blank panel: an empty shelf is an ordinary state, and a blank tab
    // reads as a broken one. Say what would fill it.
    return (
      <p className="muted">
        You are holding nothing but credits, ships and the fixtures on your worlds (those are on the
        System tab). Prisoners taken in battle, operatives your people catch, salvage, and anything
        bargained for across a table are held here.
      </p>
    );
  }

  return (
    <div className="standing">
      {/* What this power is holding.

          Deliberately ONE line of qualifiers rather than a chip per interested
          power. The first version rendered a chip for every faction that valued
          a thing, which on a four-way item was four chips of near-identical text
          and buried the only number a player acts on — the best price on offer,
          and who is offering it. Everything else about the thing is either in
          its own sentence or is a qualifier that only matters when it is true. */}
      {assets.length > 0 && (
        <>
          <h4>Held</h4>
          {assets.map((a) => {
            const offers = state.factions
              .filter((f) => f.id !== me)
              .map((f) => ({ f, band: assetWorthRangeTo(a, f.id) }))
              .filter((o) => o.band.max > 0)
              .sort((x, y) => y.band.max - x.band.max);
            const best = offers[0];
            const qualifiers = [
              !a.portable && a.atSystemId
                ? `fixed at ${getSystem(state, a.atSystemId)?.name ?? a.atSystemId}`
                : a.atSystemId
                  ? `at ${getSystem(state, a.atSystemId)?.name ?? a.atSystemId} — lost with the world`
                  : null,
              a.uses !== null ? (a.uses === 1 ? 'one play left' : `${a.uses} plays left`) : null,
              !a.divisible && a.quantity > 1 ? 'does not divide' : null,
              a.yield?.kind === 'credits' ? `pays ${a.yield.perTurn}/turn` : null,
              a.yield?.kind === 'dissent' ? `settles the population` : null,
              a.yield?.kind === 'asset' ? `yields ${a.yield.perTurn} ${a.yield.unit}/turn` : null,
              offers.length > 1 ? `${offers.length} powers want it` : null,
            ].filter((x): x is string => x !== null);
            return (
              <div key={a.id} className="commitment">
                <div className="commitment-head">
                  <span>
                    {a.quantity} {a.unit}
                    {a.quantity === 1 ? '' : 's'}
                  </span>
                  {best && (
                    <span
                      className="chip good"
                      title={
                        a.speculative
                          ? 'Nobody has settled what this is worth. Both ends of the band are arguable.'
                          : 'What the keenest buyer would pay for the whole holding.'
                      }
                    >
                      {best.f.name} ·{' '}
                      {a.speculative && best.band.min !== best.band.max
                        ? `${best.band.min}–${best.band.max}cr`
                        : `${best.band.max}cr`}
                    </span>
                  )}
                </div>
                <p className="commitment-text">{a.text}</p>
                {qualifiers.length > 0 && <p className="muted">{qualifiers.join(' · ')}</p>}
              </div>
            );
          })}
        </>
      )}

    </div>
  );
}

function Standing({ state, onSelect }: { state: WorldState; onSelect: (id: string) => void }) {
  const me = state.playerFactionId;
  const treaties = treatiesFor(state, me);
  const wars = warsFor(state, me);
  const agents = agentsVisibleTo(state, me);
  const commitments = commitmentsOf(state, me);
  const debts = debtsFor(state.debts ?? [], me);
  const loans = loansFor(state.loans ?? [], me);

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
                {/* An arrangement that pays is worth defending; one that costs
                    is worth renegotiating. Either way the number belongs here
                    rather than buried in the net income figure. */}
                {c.incomePerTurn !== 0 && (
                  <span className={c.incomePerTurn > 0 ? 'chip good' : 'chip bad'}>
                    {c.incomePerTurn > 0 ? '+' : ''}
                    {c.incomePerTurn}cr/turn
                  </span>
                )}
                {/* A proportional term has no fixed figure, so the chip names
                    the rate and the direction rather than a number that would
                    be wrong by the next turn. */}
                {c.share !== undefined && (
                  <span className={c.share.to === me ? 'chip good' : 'chip bad'}>
                    {c.share.to === me ? '+' : '-'}
                    {c.share.percent}% {c.share.of}
                  </span>
                )}
              </div>
              <p className="commitment-text">{c.text}</p>
              {/* What this pays out and on what. A claim standing against a
                  world you hold is a fact about your position, not a footnote —
                  and one already paid is what the arrangement was for. */}
              {(c.contingencies ?? []).map((k, i) => (
                <p key={i} className={k.firedTurn === null ? 'muted' : 'commitment-text'}>
                  {k.firedTurn === null ? '◇' : '◆'} {k.text}
                  {k.firedTurn !== null && (
                    <span className="muted"> — paid, turn {k.firedTurn}</span>
                  )}
                </p>
              ))}
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

      {/* Debts sit with commitments and treaties because they are the same
          kind of fact: a standing obligation that costs money every turn and
          constrains what you can do. A defaulted debt is also the one thing on
          this panel that another power can be *pursued* over, so the player
          needs to see whose it is and how far behind they are. */}
      {debts.length > 0 && (
        <>
          <h4>Debts</h4>
          {debts.map((d) => {
            const owed = d.creditorFactionId === me;
            const other = owed ? d.debtorFactionId : d.creditorFactionId;
            const name = state.factions.find((f) => f.id === other)?.name ?? other;
            const paid = d.principal - d.balance;
            return (
              <div key={d.id} className="treaty">
                <div className="treaty-head">
                  <button className="linkish" onClick={() => onSelect(other)}>
                    {owed ? `${name} owes you` : `you owe ${name}`}
                  </button>
                  <span className={owed ? 'chip good' : 'chip bad'}>
                    {owed ? '+' : '-'}
                    {Math.min(d.perTurn, d.balance)}cr/turn
                  </span>
                  {d.status === 'delinquent' && (
                    <span
                      className="chip bad"
                      title={`${d.missedPayments} missed payment(s).`}
                    >
                      in default
                    </span>
                  )}
                </div>
                <p className="commitment-text">{d.text}</p>
                <p className="muted">
                  {d.balance} of {d.principal} outstanding · {paid} repaid
                  {d.missedPayments > 0 ? ` · ${d.missedPayments} missed` : ''}
                </p>
              </div>
            );
          })}
        </>
      )}

      {/* Beside the debts, and separate from them, because the two read
          oppositely: a debt is money going out until it is gone, and a loan is
          a thing that has to come back. The line a player needs here is which
          it is, what is still out, and whether the term has run. */}
      {loans.length > 0 && (
        <>
          <h4>Lent and borrowed</h4>
          {loans.map((l) => {
            const lending = l.lenderFactionId === me;
            const other = lending ? l.borrowerFactionId : l.lenderFactionId;
            const name = state.factions.find((f) => f.id === other)?.name ?? other;
            const kept = l.status === 'defaulted';
            return (
              <div key={l.id} className="treaty">
                <div className="treaty-head">
                  <button className="linkish" onClick={() => onSelect(other)}>
                    {lending ? `${name} holds yours` : `you hold ${name}'s`}
                  </button>
                  {l.rentPerTurn > 0 && (
                    <span className={lending ? 'chip good' : 'chip bad'}>
                      {lending ? '+' : '-'}
                      {l.rentPerTurn}cr/turn
                    </span>
                  )}
                  {kept && (
                    <span
                      className="chip bad"
                      title="It did not come back. Whether that was refusal or bad luck is not a distinction the lender makes."
                    >
                      not returned
                    </span>
                  )}
                  {l.status === 'delinquent' && (
                    <span className="chip bad" title="Behind on the hire fee.">
                      in arrears
                    </span>
                  )}
                </div>
                <p className="commitment-text">{l.text}</p>
                <p className="muted">
                  {describeOutstanding(l)} outstanding
                  {kept
                    ? ' · being kept'
                    : l.dueTurn === null
                      ? ' · no term'
                      : ` · due turn ${l.dueTurn}`}
                  {l.missedPayments > 0 ? ` · ${l.missedPayments} missed` : ''}
                </p>
              </div>
            );
          })}
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
                {/* Exclusivity is the actionable half: it is the reason the next
                    arrangement of this type will be refused at signature, and a
                    player who cannot see it reads that refusal as the game
                    being arbitrary. The same gap tolls had — legible in the
                    Factions panel, invisible where it cost you something. */}
                {t.exclusive && (
                  <span
                    className="chip"
                    title={`Exclusive: no other ${t.type.replace(/_/g, ' ')} can be entered with anyone else while this stands. Breaking it costs 25 with ${getFaction(state, other)?.name ?? other} and standing with every onlooker.`}
                  >
                    exclusive
                  </span>
                )}
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
                {/*
                  A sale's two halves, shown together or not at all.
                  `terms.payment` was never rendered either, so a cession's
                  price was invisible on screen exactly as an asset's transfer
                  was invisible in the reducer — and showing what moves without
                  what was paid for it is the same half-a-transaction the term
                  itself exists to prevent.
                */}
                {(t.terms.assets ?? []).map((a) => {
                  const asset = (state.assets ?? []).find((x) => x.id === a.assetId);
                  return (
                    <li key={a.assetId}>
                      hands over:{' '}
                      {asset ? `${asset.quantity} ${asset.unit} of ${asset.kind}` : a.assetId} →{' '}
                      {getFaction(state, a.toFactionId)?.name ?? a.toFactionId}
                    </li>
                  );
                })}
                {Object.entries(t.terms.payment ?? {})
                  .filter(([, n]) => n !== 0)
                  .map(([id, n]) => (
                    <li key={`pay-${id}`} className={id === me ? (n > 0 ? 'good' : 'bad') : undefined}>
                      paid once: {getFaction(state, id)?.name ?? id} {n > 0 ? 'receives' : 'pays'}{' '}
                      {Math.abs(n)}
                    </li>
                  ))}
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
                {/*
                  What ENDS the paper. A treaty carrying a condition it can die
                  of is a treaty the player should be able to read, and this was
                  the last term with real force that the panel did not show —
                  the reducer voids on these every tick, and a deal that
                  evaporated for a reason nobody could see on screen is the same
                  class of surprise as an unpriced concession.
                */}
                {(t.terms.voidsOn ?? []).map((v, i) => (
                  <li key={`void-${i}`} className="trigger">
                    ends if {voidText(state, v)}
                  </li>
                ))}
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

/**
 * How many log entries are drawn at once.
 *
 * The list used to render `state.eventLog` in full and rebuild it on every
 * state push — and a push happens on every action, every end-turn and every
 * message in a channel. A real campaign writes ~37 entries a turn, so a
 * 30-turn game reconciled ~1,100 nodes several times a turn and a 60-turn one
 * twice that, for a panel showing perhaps twenty of them.
 *
 * A window rather than virtualisation: the newest entries are the ones being
 * read, older ones are reached by asking, and a button is a great deal less
 * machinery than a windowing library for a list nobody scrolls to the end of.
 */
const LOG_PAGE = 200;

function Log({ state }: { state: WorldState }) {
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(LOG_PAGE);
  const all = [...new Set(state.eventLog.map((e) => e.kind))];
  const { shown, hidden, firstIndex } = logWindow(state.eventLog, kinds, limit);

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
        {shown.map((e, i) => (
          <li key={firstIndex + shown.length - i} className={`log-${e.kind}`}>
            <span className="turn">[{e.turn}]</span> {e.text}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button className="chip" onClick={() => setLimit((n) => n + LOG_PAGE)}>
          {hidden} older {hidden === 1 ? 'entry' : 'entries'}
        </button>
      )}
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
