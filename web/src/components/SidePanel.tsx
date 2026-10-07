import { WorldSprite, worldTypeLabel } from './WorldSprite.js';
import { useState } from 'react';
import { FactionAvatar } from './FactionAvatar.js';
import { FleetsPanel } from './FleetsPanel.js';
import { TradePanel } from './TradePanel.js';
import { STAT_NAMES } from '../../../src/domain/checks.js';
import { debtsFor } from '../../../src/domain/debt.js';
import { assetOnLoan, describeOutstanding, loansFor } from '../../../src/domain/loan.js';
import {
  assetWorthRangeTo,
  COMMODITY_VALUE,
  fixtureIntegrity,
  isCommodity,
  isNote,
  isTruceLive,
  TRUCE_BREAKING_REPUTATION_COST,
  truceBetween,
  workingStats,
  demandSide,
} from '../../../src/domain/diplomacy.js';
import { describeSecret, secretLive } from '../../../src/domain/leverage.js';
import { HEAT_DECAY, HEAT_NOTORIOUS } from '../../../src/domain/heat.js';
import {
  INTEL_DELIVERS,
  INTEL_DIG,
  INTEL_OPERATIVES,
  INTEL_TYPED,
  intelOn,
} from '../../../src/domain/intel-levels.js';
import { BOUNTY_PER_TON } from '../../../src/domain/diplomacy.js';
import { shortageFactor } from '../../../src/domain/events.js';
import { EFFECT_COST, describeOrderEffect } from '../../../src/domain/development.js';
import { describeEffect } from '../../../src/domain/diplomacy.js';
import { CommanderIcon } from './BattleIcons.js';
import { agentStanding, type Agent } from '../../../src/domain/diplomacy.js';
import { agentRoster } from '../../../src/ui/agentroster.js';

import {
  MAX_ACTIVE_COMMANDERS,
  activeCommanders,
  archetypeOf,
  commanderEffect,
  commanderFor,
  familyOf,
  commanderPassive,
  toNextVeterancy,
  veterancyLabel,
  type Commander,
} from '../../../src/domain/command.js';
import { worldFlavour } from '../../../src/ui/worldtext.js';
import {
  CONTENT_REGARD,
  ENVOY_PER_POINT,
  HOME_REGARD,
  JOIN_LEAD,
  JOIN_REGARD,
  OCCUPIED_HOME_REGARD,
  WANT_MEANS,
  envoyRefusal,
  holdAt,
  regardFor,
  regardRecorded,
  wantOf,
} from '../../../src/domain/regard.js';
import {
  fixtureName,
  buildableWorlds,
  fixtureOptions,
  foundingLine,
  type FixtureOptions,
} from '../../../src/ui/fixtureoptions.js';
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
  rallyBonus,
  systemIncome,
  fixturesAt,
  treatiesFor,
  warsFor,
  spanOfControl,
  TRUCE_FLOOR,
  type StarSystem,
  type WorldState,
} from '../../../src/domain/state.js';
import type { Briefing } from '../../../src/engine/briefing.js';
import type { EffectiveStats } from '../../../src/api/contract.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';
import { logWindow } from '../../../src/ui/logview.js';

type Tab =
  | 'factions'
  | 'system'
  | 'fleets'
  | 'commanders'
  | 'agents'
  | 'trade'
  | 'assets'
  | 'orders'
  | 'standing'
  | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'factions', label: 'Factions' },
  { id: 'system', label: 'System' },
  { id: 'fleets', label: 'Fleets' },
  // Beside Fleets, not beside Factions. An officer is a fact about a FLEET —
  // who takes it into its next battle — and putting the line under a faction's
  // doctrine read as a claim about the power itself, which is what the ethics
  // chips directly above it are for.
  { id: 'commanders', label: 'Command' },
  // A network, in one place: what each operative is doing, how many more you
  // can run, and who has been caught. It was a flat list under the treaties.
  { id: 'agents', label: 'Agents' },
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
  effective,
  onSelect,
  onTalk,
  onDraft,
  onOffer,
  activeChannel,
}: {
  state: WorldState;
  /** The player's stats as the server rolls them — see `EffectiveStatsSchema`. */
  effective: EffectiveStats;
  selectedId: string | null;
  briefing: Briefing | null;
  onSelect: (id: string) => void;
  onTalk: (factionId: string) => void;
  /** Puts a sentence on the command line for the player to send. */
  onDraft: (text: string) => void;
  /**
   * Opens a channel with a power and puts a line in it. For what needs the
   * other side's consent — a sale, a ransom — which a declaration cannot do.
   */
  onOffer: (factionId: string, text: string) => void;
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
          <Factions
            state={state}
            effective={effective}
            onTalk={onTalk}
            activeChannel={activeChannel}
          />
        )}
        {tab === 'system' && (
          <SystemTab
            state={state}
            selectedId={selectedId}
            onSelect={onSelect}
            onDraft={onDraft}
            holding={effective.holding}
          />
        )}
        {tab === 'fleets' && <FleetsPanel state={state} onSelect={onSelect} />}
        {tab === 'commanders' && (
          <Command state={state} onDraft={onDraft} onOffer={onOffer} activeChannel={activeChannel} />
        )}
        {tab === 'agents' && (
          <AgentsTab state={state} guile={effective.stats.guile} onSelect={onSelect} onDraft={onDraft} />
        )}
        {tab === 'trade' && <TradePanel state={state} ledger={effective.ledger} onSelect={onSelect} />}
        {tab === 'assets' && <Assets state={state} onOffer={onOffer} activeChannel={activeChannel} />}
        {tab === 'orders' && <Orders state={state} briefing={briefing} />}
        {tab === 'standing' && <Standing state={state} onSelect={onSelect} />}
        {tab === 'log' && <Log state={state} />}
      </div>
    </aside>
  );
}

function Factions({
  state,
  effective: served,
  onTalk,
  activeChannel,
}: {
  state: WorldState;
  effective: EffectiveStats;
  onTalk: (factionId: string) => void;
  activeChannel: string | null;
}) {
  return (
    <div className="factions">
      {state.factions.map((f) => {
        // The player's own row reads the SERVED figure, because the client can
        // no longer compute it: `worldAsSeenBy` redacts operatives the player
        // has not caught, so a hostile `stat_debuff` is invisible here and a
        // recomputed number would read higher than the dice allow. Every other
        // power is computed as before — from the same redacted world an NPC's
        // debuffs are missing from, which is the fog and not a discrepancy.
        const isPlayerRow = f.id === state.playerFactionId;
        const effective = isPlayerRow ? served.stats : effectiveStats(state, f.id);
        const penalty = dissentPenalty(f.dissent);
        const isPlayer = f.id === state.playerFactionId;
        const disposition = dispositionBetween(state, f.id, state.playerFactionId);
        // The player's span is served, for `effective`'s reason: it reads
        // influence, which a hidden rival debuff can lower.
        const span = isPlayerRow ? served.span : spanOfControl(state, f.id);
        const truce = isPlayer ? undefined : truceBetween(state.truces, state.turn, f.id, state.playerFactionId);
        const color = ansi256ToHex(f.displayColor);
        // The player's own is served too: a raid on it is a rumour here, so
        // a ledger computed from this view would never subtract it.
        const ledger = (isPlayerRow ? served.ledger : undefined) ?? ledgerFor(state, f.id);
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
              fleet {fleetStrengthOf(state, f.id)} · {f.credits}cr ·{' '}
              <span
                className={span.over > 0 ? 'bad' : undefined}
                title={`Worlds held against the span of control: ${span.span} can be governed, set by influence and never below the homeland. Each world past it costs a point of dissent every turn.`}
              >
                {span.held}/{span.span} worlds
              </span>
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
                    title={
                      reduced
                        ? `${s} ${live} (base ${base}, reduced by ${base - live})`
                        : live > base
                          ? `${s} ${live} (base ${base}, raised by ${live - base})`
                          : `${s} ${live}`
                    }
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
            {!isPlayer && <IntelBar level={intelOn(state, state.playerFactionId, f.id)} />}
            {(f.heat ?? 0) > 0 && (
              <div
                className={(f.heat ?? 0) >= HEAT_NOTORIOUS ? 'dissent' : 'muted'}
                title={`How notorious its covert work, unlicensed raiding and broken word have made it. It fades ${HEAT_DECAY} a turn; from ${HEAT_NOTORIOUS} the Rim answers — crackdowns, a price on its head, turned contacts, a neighbour massing on its border.`}
              >
                heat {f.heat}
                {(f.heat ?? 0) >= HEAT_NOTORIOUS ? ' · notorious' : ''}
              </div>
            )}
            {f.dissent > 0 && (
              <div
                className="dissent"
                title={`Your own institutions have been overruled once too often. Every stat is reduced by ${penalty} (up to ${MAX_DISSENT_PENALTY} at 100 dissent). It falls by 2 a turn on its own.`}
              >
                dissent {f.dissent}/100
                {penalty > 0 && <span className="bad"> · −{penalty} to every stat</span>}
              </div>
            )}
            {/* A rally lifts the bars above, and a lift nobody can read the
                cause of is the lie the dissent line exists to prevent, run the
                other way. Shown for every power: whose homeland is occupied is
                a fact on the map, not a secret. */}
            {rallyBonus(state, f.id) > 0 && (
              <div
                className="rally"
                title={`Home worlds held by others: ${state.systems
                  .filter((s) => s.homeFactionId === f.id && s.controllerFactionId !== f.id)
                  .map((s) => s.name)
                  .join(', ')}. Resolve decides how hard a people rallies; it lasts while the homeland does not.`}
              >
                rallying · <span className="good">+{rallyBonus(state, f.id)} might, guile, industry, influence</span>
              </div>
            )}
            <div className="ethics">
              {truce && (
                <span
                  className="chip good"
                  title={`A war ended between you. Neither side may attack the other until turn ${truce.untilTurn}; standing heals toward ${TRUCE_FLOOR} meanwhile. Breaking it costs 25 with them and ${TRUCE_BREAKING_REPUTATION_COST} with every other power.`}
                >
                  truce · turn {truce.untilTurn}
                </span>
              )}
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
  onDraft,
  holding,
}: {
  state: WorldState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDraft: (text: string) => void;
  /** What each of the player's warships holds down, as the server reads it. */
  holding: number;
}) {
  const sys = selectedId ? getSystem(state, selectedId) : null;
  if (!sys) return <RoomToBuild state={state} onSelect={onSelect} onDraft={onDraft} />;

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
  const officersAshore = officersHere.filter((c) => !shipRows.some(([id]) => id === c.factionId));
  /**
   * What is built on this world. A fixture is the one asset kind that cannot
   * leave, so it is a fact about the ground rather than about a warehouse —
   * and since it changes hands with the world, it is part of what taking this
   * world is worth.
   */
  const fixtures = fixturesAt(state, sys.id);
  /**
   * What the player could still build here, when they hold it. The ground rule
   * is the whole mechanism — a fixture must name the attribute the world's type
   * makes — so the panel lists the kinds that do rather than leaving a player
   * to discover the rule from a rejection.
   */
  const options = fixtureOptions(state, sys.id);

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

      <WorldPeople state={state} sys={sys} holding={holding} onDraft={onDraft} />

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
              <OfficersIn list={officersHere.filter((c) => c.factionId === id)} colour={colourOf(state, id)} />
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
      {(fixtures.length > 0 || options) && <h4>Fixtures here</h4>}
      {options && fixtures.length === 0 && <p className="empty">Nothing built yet.</p>}
      {fixtures.length > 0 && (
        <>
          <ul className="ship-list">
            {fixtures.map((w) => {
              const holder = getFaction(state, w.heldBy);
              // What it still yields after sabotage, and how hurt it is.
              const hit = w.damage ?? 0;
              const working = workingStats(w);
              const spread =
                w.yield?.kind === 'stat'
                  ? working.length === 0
                    ? 'wrecked'
                    : working.map((x) => `${x.points > 0 ? '+' : ''}${x.points} ${x.stat}`).join(' · ')
                  : null;
              return (
                <li key={w.id} className="agent-row" title={w.text}>
                  <span className="swatch" style={{ background: colourOf(state, w.heldBy) }} />
                  <span style={{ color: colourOf(state, w.heldBy) }}>
                    {/* A proper name for a building — "Power Plant", not the slug. */}
                    {fixtureName(w.kind)}
                    {' · '}
                    {holder?.name ?? w.heldBy}
                  </span>
                  {spread && <span className={hit > 0 ? 'count bad' : 'count'}>{spread}</span>}
                  {hit > 0 && (
                    <span
                      className="chip bad"
                      title="Sabotaged. Each point of damage costs a point of what it yields, and it is still charged upkeep. A repair programme (construction, conversion or retooling) puts it back at 40 a point."
                    >
                      damaged {fixtureIntegrity(w) - hit}/{fixtureIntegrity(w)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {options && <FixtureBuilder options={options} worldName={sys.name} onDraft={onDraft} />}
      {/* Officers are units of the fleet (item 122), so they sit in the row of
          the hulls they stand beside, above. Listed here only when there are no
          hulls of theirs to stand beside — ashore, with the garrison.
          Not redacted, for the reason `system.ships` is not: a fleet in orbit
          is a thing anybody with eyes can see. What stays hidden is their
          power's ORDERS, which is a different question. */}
      {officersAshore.length > 0 && (
        <>
          <h4>Officers ashore</h4>
          <ul className="ship-list">
            {officersAshore.map((c) => (
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
                  {a.mission ?? 'awaiting orders'}
                  {a.mission !== null && a.inPlaceFrom > state.turn && ` · arrives turn ${a.inPlaceFrom}`}
                </span>
                <span className="count">
                  {/* The record, then the odds. A caught face is permanent, so
                      it is worth seeing before deciding to ransom one home. */}
                  {a.operations > 0 && `${agentStanding(a.operations)} · `}
                  {a.timesCaught > 0 && `caught ${a.timesCaught}× · `}
                  {a.exposed ? 'burned' : a.mission === null ? 'ready' : `${a.successChance}%`}
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
/**
 * A channel can be opened with `factionId` from a button: nothing is open, or
 * the one that is open is already theirs. A line written into the wrong
 * conversation would be worse than no button.
 */
function canOffer(activeChannel: string | null, factionId: string): boolean {
  return activeChannel === null || activeChannel === factionId;
}

/** The player's best world: where a recruit or an appointment is drafted for. */
function homeWorld(state: WorldState): StarSystem | undefined {
  return [...state.systems]
    .filter((x) => x.controllerFactionId === state.playerFactionId)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
}

function Command({
  state,
  onDraft,
  onOffer,
  activeChannel,
}: {
  state: WorldState;
  onDraft: (text: string) => void;
  onOffer: (factionId: string, text: string) => void;
  activeChannel: string | null;
}) {
  const me = state.playerFactionId;
  const home = homeWorld(state);
  /** What a name answers to in an order: the family, unique in the campaign. */
  const callName = (c: Commander) => familyOf(c.name) ?? c.name;
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
                        const o = state.pendingOrders.find((x) =>
                          x.officers.includes(officer.id),
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
                {f.id === me && officer.atSystemId && (
                  <SailButton state={state} officer={officer} callName={callName(officer)} onDraft={onDraft} />
                )}
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
                    <span style={{ color: colour }}>
                      {c.name}
                      <span className="meta"> · {whereIs(state, c)}</span>
                    </span>
                    <span className="count">{commanderEffect(c)}</span>
                    {f.id === me && c.atSystemId && (
                      <SailButton state={state} officer={c} callName={callName(c)} onDraft={onDraft} />
                    )}
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
            {f.id === me && roster.length < MAX_ACTIVE_COMMANDERS && home && (
              <button
                className="chip"
                title="An appointment is an action of its own. This writes it on the command line; nothing is sent."
                onClick={() => onDraft(`Appoint an officer at ${home.name}.`)}
              >
                appoint an officer
              </button>
            )}
            {held.length > 0 && (
              <p className="meta command-held">
                held prisoner: {held.map((c) => c.name).join(', ')}
              </p>
            )}
            {/* Your own, in somebody else's hands: a ransom is a conversation
                with whoever holds them, so the button opens it. */}
            {f.id === me &&
              held.map((c) => {
                const holder = (state.assets ?? []).find((a) => a.commanderId === c.id && a.quantity > 0)?.heldBy;
                if (!holder || holder === me) return null;
                const who = getFaction(state, holder)?.name ?? holder;
                return (
                  <button
                    key={`ransom-${c.id}`}
                    className="chip"
                    disabled={!canOffer(activeChannel, holder)}
                    title={
                      canOffer(activeChannel, holder)
                        ? `Opens a channel with ${who} and writes the ask; nothing is sent.`
                        : 'Close the channel that is open first.'
                    }
                    onClick={() => onOffer(holder, `We want ${c.name} back. Name your price.`)}
                  >
                    ask {who} for {callName(c)}
                  </button>
                );
              })}
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

/**
 * The System tab with no world chosen: where you could build a fixture now.
 * The per-world builder is the full list; this is so its buttons are not
 * hidden behind finding the right world on the map first.
 */
function RoomToBuild({
  state,
  onSelect,
  onDraft,
}: {
  state: WorldState;
  onSelect: (id: string) => void;
  onDraft: (text: string) => void;
}) {
  const worlds = buildableWorlds(state);
  const first = worlds[0]?.options;
  return (
    <div>
      <p className="empty">Click a system on the map.</p>
      <h4>Room to build</h4>
      {worlds.length === 0 ? (
        <p className="empty">No world of yours has a free slot for anything that would help.</p>
      ) : (
        <>
          {first && (
            <p className="muted">
              A fixture costs {first.cost} and at least {first.turns} turns; your next adds {first.upkeepAdded} a
              turn to upkeep. Choose a world for every kind its ground takes.
            </p>
          )}
          <ul className="ship-list">
            {worlds.map((w) => (
              <li key={w.systemId} className="agent-row">
                <button className="link" onClick={() => onSelect(w.systemId)}>
                  {w.name}
                </button>
                <span className="count">
                  {w.options.room} free · {w.options.ground}
                </span>
                <button
                  className="chip"
                  title={`Write "${foundingLine(w.suggest.kind, w.name)}" on the command line`}
                  onClick={() => onDraft(foundingLine(w.suggest.kind, w.name))}
                >
                  build {w.suggest.name.toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * An officer goes where a fleet takes them: this writes the start of that
 * order — from where they stand, with them aboard — for the player to finish
 * with a destination. A fleet movement is the one order a channel cannot make.
 */
function SailButton({
  state,
  officer,
  callName,
  onDraft,
}: {
  state: WorldState;
  officer: Commander;
  callName: string;
  onDraft: (text: string) => void;
}) {
  const where = state.systems.find((x) => x.id === officer.atSystemId)?.name ?? officer.atSystemId;
  return (
    <button
      className="chip"
      title="Writes the start of a fleet movement with this officer aboard; add where it goes."
      onClick={() => onDraft(`Send ships from ${where}, with ${callName} aboard, to `)}
    >
      sail with a fleet
    </button>
  );
}

function Orders({ state, briefing }: { state: WorldState; briefing: Briefing | null }) {
  const remembered = briefing?.remembered ?? [];
  if (state.pendingOrders.length === 0 && remembered.length === 0) {
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
              {o.dark && (
                <span
                  className="chip"
                  title={`Run dark: nobody else is told whose it is, and it takes half the prizes. ${o.dark.turns} turn(s) unseen; if traced, the victim resents it for double what it owed and holds proof.`}
                >
                  dark
                </span>
              )}
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
            {o.officers.length > 0 && (
              <div className="meta order-officers" style={{ color }}>
                <CommanderIcon size={13} />{' '}
                {o.officers
                  .map((id) => state.commanders.find((c) => c.id === id)?.name ?? id)
                  .join(', ')}
              </div>
            )}
            {o.onComplete && (
              <div className="meta delivers">
                delivers {describeOrderEffect(o.onComplete)}
                {o.investedCredits > 0 && ` · ${o.investedCredits}cr committed`}
              </div>
            )}
          </div>
        );
      })}
      {/* What you saw once and cannot see now: kept, greyed, and dated, rather
          than dropping back to "something under way" the turn the watcher
          is lost. Whether it has finished is what you do not know unless a
          rumour of it is still about. */}
      {remembered.map((m, i) => (
        <div key={`seen-${i}`} className="order remembered" title={`Last seen in full on turn ${m.seenTurn}.`}>
          <div className="order-head" style={{ color: ansi256ToHex(m.color) }}>
            {m.label}
            <span className="chip">last seen t{m.seenTurn}</span>
            <span className="eta">{m.live ? `due t${m.dueBy}` : `t${m.dueBy} if it ran on`}</span>
          </div>
          <div className="progress">
            <span style={{ width: `${(m.progress / m.duration) * 100}%`, background: ansi256ToHex(m.color) }} />
          </div>
          <div className="meta">
            {m.factionName} · {m.kind} at {m.where} · {m.live ? 'still under way' : 'out of sight'}
          </div>
          {m.delivers && <div className="meta delivers">delivers {m.delivers}</div>}
        </div>
      ))}
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

/**
 * The officers in one row of hulls: a star-in-circle each, named on hover.
 * Inline rather than a list of their own, because an officer is part of the
 * fleet they stand beside (item 122) and the row is where that fleet is.
 */
/**
 * What the player could raise on a world they hold: every kind its ground
 * allows, what each gives, why any cannot go up here now, and what the next
 * one costs to build and to keep. Picking one writes the order on the command
 * line rather than sending it — declaring is the player's act, and costs an
 * action.
 */
function FixtureBuilder({
  options,
  worldName,
  onDraft,
}: {
  options: FixtureOptions;
  worldName: string;
  onDraft: (text: string) => void;
}) {
  const { ground, room, cost, turns, upkeepAdded, ordinal, credits, kinds } = options;
  if (room === 0) {
    return <p className="empty">No room for another: a world carries two fixtures.</p>;
  }
  const nth = ordinal === 1 ? '1st' : ordinal === 2 ? '2nd' : ordinal === 3 ? '3rd' : `${ordinal}th`;
  return (
    <>
      <h4>Can be built here</h4>
      <p className="meta fixture-terms">
        This ground makes {ground}, so anything built here must raise it. Room for {room}, no two
        alike. {cost} credits and at least {turns} turns of construction; as your {nth} fixture it
        would add {upkeepAdded} a turn to upkeep.
        {credits < cost && <span className="bad"> You have {credits}.</span>}
      </p>
      <ul className="ship-list fixture-options">
        {kinds.map((k) => (
          <li key={k.kind} className={k.refusal ? 'agent-row refused' : 'agent-row'}>
            <button
              type="button"
              className="fixture-pick"
              disabled={k.refusal !== null}
              title={k.refusal ?? `Write "${foundingLine(k.kind, worldName)}" on the command line`}
              onClick={() => onDraft(foundingLine(k.kind, worldName))}
            >
              {k.name}
            </button>
            <span className="count">
              {k.spread.map((x) => `+${x.points} ${x.stat}`).join(' · ')}
            </span>
            {k.wasted.length > 0 && (
              <span
                className="chip"
                title={`Your ${k.wasted.join(' and ')} cannot rise further from fixtures: it is at 20, or your fixtures already add the most they can to it.`}
              >
                no gain: {k.wasted.join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** What each intel threshold buys, in the words the bar's tooltip uses. */
const INTEL_STEPS: [number, string][] = [
  [INTEL_TYPED, 'their rumours say what kind of work it is'],
  [INTEL_DELIVERS, 'and what it will deliver'],
  [INTEL_OPERATIVES, 'their operatives on your worlds show, and are caught more often'],
  [INTEL_DIG, 'your watchers dig their secrets more easily, and you trace their dark raids'],
];

/**
 * How well you know a rival, and what the next step buys. Hidden at nothing,
 * so a power you have never watched does not carry an empty bar.
 */
function IntelBar({ level }: { level: number }) {
  if (level <= 0) return null;
  const reached = INTEL_STEPS.filter(([at]) => level >= at);
  const next = INTEL_STEPS.find(([at]) => level < at);
  const title = [
    'How well you know them: built by watchers and listeners on their ground, trade and war; fading a tenth of itself a turn, faster while they run counter-intelligence. One watcher or listener holds it near 50; it takes two to go higher.',
    ...reached.map(([at, what]) => `${at}: ${what}.`),
    next ? `Next, at ${next[0]}: ${next[1]}.` : 'Nothing further to learn.',
  ].join('\n');
  return (
    <div className="intel-row" title={title}>
      <span className="muted">intel</span>
      <span className="intel-bar">
        {INTEL_STEPS.map(([at]) => (
          <span key={at} className="intel-tick" style={{ left: `${at}%` }} />
        ))}
        <span className="intel-fill" style={{ width: `${level}%` }} />
      </span>
      <span className="muted">{level}</span>
    </div>
  );
}

/**
 * What a world's people think of each power, what they want, and whether the
 * power holding it keeps it by consent, by force, or not at all — see
 * `regard.ts`. Public: a world's mood is not a secret, and the race for an
 * independent world is one every power can see.
 */
function WorldPeople({
  state,
  sys,
  holding,
  onDraft,
}: {
  state: WorldState;
  sys: StarSystem;
  holding: number;
  onDraft: (text: string) => void;
}) {
  if (!regardRecorded(state)) return null;
  const me = state.playerFactionId;
  const want = wantOf(sys);
  const holder = sys.controllerFactionId;
  // Your own worlds use the factor the server reads off your true resolve;
  // a rival's is read off the view, and is an estimate the way its stats are.
  const hold = holder ? holdAt(state, sys, holder === me ? holding : undefined) : null;
  const holderName = holder ? (getFaction(state, holder)?.name ?? holder) : '';
  const rows = state.factions
    .map((f) => ({ id: f.id, name: f.name, r: regardFor(sys, f.id) }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const envoy = envoyRefusal(state, sys, me) === null;
  const be = (n: number) => n.toFixed(1);
  return (
    <>
      <h4 title={`A world's standing with each power drifts back a tenth of the way a turn toward where it rests: ${HOME_REGARD} toward its own power, ${OCCUPIED_HOME_REGARD} toward one holding somebody else's home, nothing otherwise. Meeting what it wants raises it; raiding it, fighting over it and taking it by force lower it.`}>
        Its people
      </h4>
      <p className="meta">
        Wants {want}: {WANT_MEANS[want]}.
      </p>
      {!hold ? (
        <p className="meta">
          Answers to nobody. It joins the power it regards at {JOIN_REGARD} or better, if {JOIN_LEAD} clear of the next.
        </p>
      ) : hold.content ? (
        <p className="good">
          Content with {holderName} ({hold.regard}): it needs no force to keep.
        </p>
      ) : hold.shortfall <= 0 ? (
        <p className="meta">
          Held down by {holderName}: it wants {be(hold.need)} battleship-equivalents of warships over it and has{' '}
          {be(hold.have)}. Content at {CONTENT_REGARD}; now {hold.regard}.
        </p>
      ) : (
        <p className="bad">
          Restless under {holderName}: it wants {be(hold.need)} battleship-equivalents over it and has {be(hold.have)}.
          Its garrison is deserting; with none left it answers to nobody. Content at {CONTENT_REGARD}; now {hold.regard}.
        </p>
      )}
      <ul className="ship-list">
        {rows.map((row) => (
          <li key={row.id} className="agent-row">
            <span className="swatch" style={{ background: colourOf(state, row.id) }} />
            <span style={{ color: colourOf(state, row.id) }}>{row.name}</span>
            <RegardBar regard={row.r} />
          </li>
        ))}
      </ul>
      {envoy && (
        <p className="envoy-line">
          <button
            type="button"
            className="fixture-pick"
            title={`Write "Send an envoy to ${sys.name}." on the command line`}
            onClick={() => onDraft(`Send an envoy to ${sys.name}.`)}
          >
            Send an envoy
          </button>
          <span className="meta">
            {' '}
            a political manoeuvre, {2 * EFFECT_COST.court} credits: {2 * ENVOY_PER_POINT} standing, plus your influence
          </span>
        </p>
      )}
    </>
  );
}

/** −100 to 100, from the middle: what a world thinks of one power. */
function RegardBar({ regard }: { regard: number }) {
  const left = regard >= 0 ? 50 : 50 + regard / 2;
  return (
    <span className="regard-cell">
      <span className="regard-bar">
        <span className="regard-mid" />
        <span
          className={regard >= 0 ? 'regard-fill good' : 'regard-fill bad'}
          style={{ left: `${left}%`, width: `${Math.abs(regard) / 2}%` }}
        />
      </span>
      <span className="count">{regard}</span>
    </span>
  );
}

function OfficersIn({ list, colour }: { list: Commander[]; colour: string }) {
  if (list.length === 0) return null;
  return (
    <span className="row-officers" style={{ color: colour }} title={list.map((c) => c.name).join(', ')}>
      {list.map((c) => (
        <CommanderIcon key={c.id} size={14} title={`${c.name} — ${veterancyLabel(c.battles)}`} />
      ))}
    </span>
  );
}

/** Where an officer is: a world, a voyage, or nowhere. */
function whereIs(state: WorldState, c: Commander): string {
  if (c.atSystemId) return `at ${state.systems.find((x) => x.id === c.atSystemId)?.name ?? c.atSystemId}`;
  const o = state.pendingOrders.find((x) => x.officers.includes(c.id));
  return o ? `under way to ${state.systems.find((x) => x.id === o.targetId)?.name ?? o.targetId}` : 'unposted';
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
function Assets({
  state,
  onOffer,
  activeChannel,
}: {
  state: WorldState;
  onOffer: (factionId: string, text: string) => void;
  activeChannel: string | null;
}) {
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
              .map((f) => ({ f, band: assetWorthRangeTo(a, f.id, shortageFactor(state, a.kind)) }))
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
              // The two kinds whose one rule decides what to do with them.
              // The note's own text already says what it gives; this says what
              // to DO with it, which is the opposite for issuer and holder.
              isNote(a)
                ? a.issuedBy === me
                  ? 'your own favour: give it away and the holder may call it in, unasked'
                  : `yours to call in — declare it; it then goes home to ${getFaction(state, a.issuedBy)?.name ?? a.issuedBy}`
                : null,
              a.secret
                ? secretLive(state, a.secret)
                  ? `proof that ${describeSecret(state, a.secret)} — publish it, or spend it for a hook`
                  : 'proof of something already over — old news'
                : null,
              isCommodity(a) && a.issuedBy === me
                ? `your own goods: worth nothing to you, ${COMMODITY_VALUE} a ${a.unit} to whoever you give them to`
                : null,
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
                {/* Who wants it, as a dot in each power's own colour — the
                    colour the map and the Factions panel already teach — keenest
                    first, with name and price on hover. Dots rather than a chip
                    each, for the reason above: who, without burying how much. */}
                {offers.length > 1 && (
                  <p className="muted wanted-by">
                    wanted by
                    {offers.map((o) => {
                      const price =
                        a.speculative && o.band.min !== o.band.max ? `${o.band.min}–${o.band.max}cr` : `${o.band.max}cr`;
                      return (
                        // A drawn tooltip rather than `title`: the native one
                        // waits a second and a half, and some embedded browsers
                        // never show it at all. Focusable, so it reads without
                        // a mouse too.
                        <span
                          key={o.f.id}
                          className="faction-dot"
                          style={{ background: colourOf(state, o.f.id) }}
                          data-tip={`${o.f.name} · ${price}`}
                          aria-label={`${o.f.name}, ${price}`}
                          role="img"
                          tabIndex={0}
                        />
                      );
                    })}
                  </p>
                )}
                {qualifiers.length > 0 && <p className="muted">{qualifiers.join(' · ')}</p>}
                {/* A sale needs the buyer, so it is a conversation: this opens
                    one with the keenest buyer and writes the offer at what they
                    would pay. Not for a fixture, which goes only with its
                    world, nor for a thing out on loan, which is not yours to sell. */}
                {best && a.portable && !assetOnLoan(state.loans ?? [], a.id) && (
                  <button
                    className="chip"
                    disabled={!canOffer(activeChannel, best.f.id)}
                    title={
                      canOffer(activeChannel, best.f.id)
                        ? `Opens a channel with ${best.f.name} and writes the offer; nothing is sent.`
                        : 'Close the channel that is open first.'
                    }
                    onClick={() =>
                      onOffer(
                        best.f.id,
                        `${a.text.replace(/[.\s]+$/, '')} — I will let ${a.quantity === 1 ? 'it' : 'them'} go to you for ${best.band.max} credits.`,
                      )
                    }
                  >
                    sell to {best.f.name}
                  </button>
                )}
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
                {/* What tells a coalition from a mutual defence pact: whom it is against. */}
                {(t.terms.against ?? []).length > 0 && (
                  <li className="trigger">
                    against: {(t.terms.against ?? []).map((id) => getFaction(state, id)?.name ?? id).join(', ')} — an
                    attack by them calls the other to war
                  </li>
                )}
                {/* The raider's ledger: who will not raid whom, and who is
                    paid to raid whom. */}
                {(t.terms.protection ?? []).map((shielded) => (
                  <li key={`prot-${shielded}`} className={shielded === me ? 'good' : undefined}>
                    protection: {getFaction(state, t.parties.find((p) => p !== shielded) ?? '')?.name ?? '?'} will not raid or
                    blockade {getFaction(state, shielded)?.name ?? shielded}
                  </li>
                ))}
                {t.terms.commission && (
                  <li>
                    letter of marque: {getFaction(state, t.terms.commission.raider)?.name ?? t.terms.commission.raider} raids{' '}
                    {t.terms.commission.against.map((id) => getFaction(state, id)?.name ?? id).join(', ')} on{' '}
                    {getFaction(state, t.parties.find((p) => p !== t.terms.commission!.raider) ?? '')?.name ?? '?'}'s
                    commission{t.terms.commission.share > 0 ? `, plus ${t.terms.commission.share}% of what it takes` : ''}
                  </li>
                )}
                {(t.terms.commodities ?? []).map((maker) => (
                  <li key={`goods-${maker}`} className={maker === me ? undefined : 'good'}>
                    goods: {getFaction(state, maker)?.name ?? maker} →{' '}
                    {getFaction(state, t.parties.find((p) => p !== maker) ?? '')?.name ?? '?'} every turn
                  </li>
                ))}
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

      {/* Favours, both ways. What the player can call in is leverage worth
          knowing about before a conversation; what it owes is a call that can
          come at any moment. */}
      {(state.obligations ?? []).some(
        (o) => o.status === 'open' && (o.holderFactionId === me || o.debtorFactionId === me),
      ) && (
        <>
          <h4>Favours owed</h4>
          <ul className="terms">
            {(state.obligations ?? [])
              .filter((o) => o.status === 'open' && (o.holderFactionId === me || o.debtorFactionId === me))
              .map((o) => {
                const mine = o.holderFactionId === me;
                const other = getFaction(state, mine ? o.debtorFactionId : o.holderFactionId)?.name;
                return (
                  <li
                    key={o.id}
                    className={mine ? 'good' : 'bad'}
                    title={
                      mine
                        ? 'Call it in by declaring it: they sign a non-aggression pact, a ceasefire or a trade accord with you, or back an ultimatum of yours.'
                        : 'They can call it in at any time. Walking away from it is priced like breaking a pact.'
                    }
                  >
                    {mine ? `${other} owes you` : `you owe ${other}`} · {o.strength}
                    {o.restsUntil !== null && state.turn < o.restsUntil ? ` · rests to turn ${o.restsUntil}` : ''}
                  </li>
                );
              })}
          </ul>
        </>
      )}

      {/* Every open ultimatum on the board: a threat is public, and the clock
          is the point of it. */}
      {(state.demands ?? []).some((d) => d.status === 'open') && (
        <>
          <h4>Ultimatums</h4>
          {(state.demands ?? [])
            .filter((d) => d.status === 'open')
            .map((d) => {
              const name = (id: string) => getFaction(state, id)?.name ?? id;
              const forDemand = demandSide(d, 'from').slice(1).map(name);
              const forTarget = demandSide(d, 'to').slice(1).map(name);
              return (
                <div key={d.id} className={d.toFactionId === me ? 'treaty bad' : 'treaty'}>
                  <div className="treaty-head">
                    <strong style={{ color: colourOf(state, d.fromFactionId) }}>
                      {name(d.fromFactionId)} → {name(d.toFactionId)}
                    </strong>
                    <span className="eta soon">{Math.max(0, d.deadlineTurn - state.turn)} turns left</span>
                  </div>
                  <p className="treaty-summary">{d.text}</p>
                  <p className="muted">
                    {d.kind.replace(/_/g, ' ')}
                    {forDemand.length > 0 ? ` · backing the demand: ${forDemand.join(', ')}` : ''}
                    {forTarget.length > 0 ? ` · backing ${name(d.toFactionId)}: ${forTarget.join(', ')}` : ''}
                    {d.toFactionId === me ? ' · give way before the deadline, or it is war' : ''}
                  </p>
                </div>
              );
            })}
        </>
      )}

      {/* Every open bounty: a price nobody hears of is a price nobody earns. */}
      {(state.bounties ?? []).some((b) => b.status === 'open' && b.pool > 0) && (
        <>
          <h4>Bounties</h4>
          {(state.bounties ?? [])
            .filter((b) => b.status === 'open' && b.pool > 0)
            .map((b) => {
              const name = (id: string) => getFaction(state, id)?.name ?? id;
              return (
                <div key={b.id} className={b.targetFactionId === me ? 'treaty bad' : 'treaty'}>
                  <div className="treaty-head">
                    <strong style={{ color: colourOf(state, b.targetFactionId) }}>{name(b.targetFactionId)}</strong>
                    <span className="eta">{b.pool} in escrow</span>
                  </div>
                  <p className="muted">
                    posted by {b.postedBy === null ? `the Rim's merchants (${b.note})` : name(b.postedBy)}
                    {b.paidOut > 0 ? ` · ${b.paidOut} paid out` : ''} · prizes raided pay credit for credit, hulls destroyed{' '}
                    {BOUNTY_PER_TON} a ton
                    {b.postedBy === me ? ' · yours: withdraw it to take back what is left' : ''}
                    {b.targetFactionId === me ? ' · a price on your head' : ''}
                  </p>
                </div>
              );
            })}
        </>
      )}

      {/* Every live truce, not only the player's: a truce is public, and it is
          priced with every onlooker when it is broken — so whose wars are
          paused is a fact the whole board can see. */}
      {(state.truces ?? []).some((t) => isTruceLive(t, state.turn)) && (
        <>
          <h4>Truces</h4>
          <ul className="terms">
            {(state.truces ?? [])
              .filter((t) => isTruceLive(t, state.turn))
              .map((t) => (
                <li
                  key={`${t.treatyId}-${t.parties.join('-')}`}
                  title={`Neither may attack the other until it runs out, and standing heals toward ${TRUCE_FLOOR} while it holds. Breaking it costs 25 with the victim and ${TRUCE_BREAKING_REPUTATION_COST} with every other power.`}
                >
                  {t.parties.map((id) => getFaction(state, id)?.name ?? id).join(' and ')} ·{' '}
                  {t.untilTurn - state.turn} turns left
                </li>
              ))}
          </ul>
        </>
      )}

    </div>
  );
}

/**
 * One operative, as a card: who, doing what, where, how well, and what has
 * happened to them. The name comes first because it is what a player
 * remembers about a network.
 */
function AgentCard({
  state,
  agent: a,
  onSelect,
  note,
  action,
}: {
  state: WorldState;
  agent: Agent;
  onSelect: (id: string) => void;
  /** A line under the card's head: where they are held, when they arrive. */
  note?: string;
  action?: { label: string; onClick: () => void };
}) {
  const mine = a.ownerFactionId === state.playerFactionId;
  const owner = getFaction(state, a.ownerFactionId)?.name ?? a.ownerFactionId;
  const target = a.targetCommanderId
    ? (state.commanders ?? []).find((c) => c.id === a.targetCommanderId)?.name
    : undefined;
  const record = [
    a.operations > 0 ? `${agentStanding(a.operations)}, ${a.operations} operation${a.operations === 1 ? '' : 's'}` : null,
    a.timesCaught > 0 ? `caught ${a.timesCaught}×` : null,
    mine ? `since turn ${a.deployedTurn}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <div className={a.exposed ? 'agent burned' : 'agent'}>
      <div className="treaty-head">
        <strong style={{ color: colourOf(state, a.ownerFactionId) }}>
          {a.name || (mine ? 'Yours' : owner)} · {a.mission ?? 'awaiting orders'}
        </strong>
        {a.exposed ? (
          <span className="eta">burned</span>
        ) : (
          a.mission !== null && (
            <span className={a.successChance >= 60 ? 'eta' : 'eta soon'}>{a.successChance}%/turn</span>
          )
        )}
      </div>
      <p className="meta">
        at{' '}
        <button className="link" onClick={() => onSelect(a.systemId)}>
          {getSystem(state, a.systemId)?.name ?? a.systemId}
        </button>
        {!mine && ` · ${owner}`}
        {target && ` · after ${target}`}
      </p>
      {note && <p className="meta">{note}</p>}
      {a.effect && !a.exposed && <p className="agent-effect">{describeEffect(a.effect)}</p>}
      {a.cover && <p className="meta">cover: {a.cover}</p>}
      {record.length > 0 && <p className="muted">{record.join(' · ')}</p>}
      {action && (
        <button className="chip" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Every operative you can see, by what each is doing — see `agentRoster`.
 */
function AgentsTab({
  state,
  guile,
  onSelect,
  onDraft,
}: {
  state: WorldState;
  /** Effective guile as the server reads it, for the slots figure. */
  guile: number;
  onSelect: (id: string) => void;
  onDraft: (text: string) => void;
}) {
  const me = state.playerFactionId;
  const r = agentRoster(state, me, guile);
  const home = [...state.systems]
    .filter((x) => x.controllerFactionId === me)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
  const name = (id: string | null) => (id ? (getFaction(state, id)?.name ?? id) : 'nobody');
  const place = (id: string | null) => (id ? (getSystem(state, id)?.name ?? id) : 'nowhere');
  const section = (title: string, agents: Agent[], extra?: (a: Agent) => Partial<Parameters<typeof AgentCard>[0]>) =>
    agents.length > 0 && (
      <>
        <h4>{title}</h4>
        {agents.map((a) => (
          <AgentCard key={a.id} state={state} agent={a} onSelect={onSelect} {...extra?.(a)} />
        ))}
      </>
    );

  return (
    <div className="standing agents-tab">
      <div className="agents-summary">
        <span>
          {r.inService} of {r.slots} in service
          {r.upkeep > 0 && <span className="muted"> · {r.upkeep}cr/turn</span>}
        </span>
        {r.inService < r.slots && home && (
          <button className="chip" onClick={() => onDraft(`Recruit an operative at ${home.name}.`)}>
            recruit one
          </button>
        )}
      </div>
      <p className="muted">
        How many you can run is set by your guile. Recruiting is an action, and so is sending one; they travel three
        jumps a turn. :help espionage has the missions.
      </p>

      {section('At work', r.atWork)}
      {section('On the way', r.underWay, (a) => ({ note: `at work from turn ${a.inPlaceFrom}` }))}
      {section('Awaiting orders', r.idle, (a) => ({
        action: { label: 'give orders', onClick: () => onDraft(`Send ${a.name || 'my operative'} to `) },
      }))}
      {r.caught.length > 0 && (
        <>
          <h4>Caught</h4>
          {r.caught.map(({ agent, heldBy, heldAt }) => (
            <AgentCard
              key={agent.id}
              state={state}
              agent={agent}
              onSelect={onSelect}
              note={
                heldBy && heldBy !== me
                  ? `held by ${name(heldBy)} at ${place(heldAt)} — they can be ransomed home`
                  : 'the line is closed'
              }
            />
          ))}
        </>
      )}
      {r.atWork.length + r.underWay.length + r.idle.length + r.caught.length === 0 && (
        <p className="empty">You run no operatives.</p>
      )}

      <h4>Theirs, discovered</h4>
      {r.theirs.length === 0 ? (
        <p className="empty">
          None you know of. A rival's people show once caught, or on your own worlds once you know that power well.
        </p>
      ) : (
        r.theirs.map(({ ownerId, agents }) => (
          <div key={ownerId}>
            <p className="meta" style={{ color: colourOf(state, ownerId) }}>
              {name(ownerId)}
            </p>
            {agents.map((a) => (
              <AgentCard key={a.id} state={state} agent={a} onSelect={onSelect} />
            ))}
          </div>
        ))
      )}

      <h4>Counter-intelligence</h4>
      {r.sweeps.length === 0 ? (
        <p className="empty">No sweep running. One on your own ground wears their picture of you down.</p>
      ) : (
        <ul className="war-list">
          {r.sweeps.map((w) => (
            <li key={w.systemId}>
              <button className="link" onClick={() => onSelect(w.systemId)}>
                {place(w.systemId)}
              </button>{' '}
              <span className="muted">· {w.turnsLeft} turn{w.turnsLeft === 1 ? '' : 's'} left</span>
            </li>
          ))}
        </ul>
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
