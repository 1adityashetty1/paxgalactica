import {
  ledgerFor,
  type WorldState,
} from '../../../src/domain/state.js';
import {
  blockadesOn,
  raidersOn,
  routeEarnings,
  routesTouching,
  tradeRoutes,
  type TradeRoute,
} from '../../../src/domain/trade.js';
import { ansi256ToHex } from '../color.js';

/**
 * The lane network, made visible.
 *
 * Twenty-eight routes is more than anyone can hold in their head, and an
 * economy a player cannot see reads as random numbers going up and down. This
 * panel exists to answer three questions the rest of the UI cannot: where does
 * my money actually come from, which of my lanes is somebody interfering with,
 * and what is that junction worth to whoever holds it.
 *
 * Everything here is derived from `src/domain/trade.ts` — the same functions
 * the reducer pays out from, so the panel cannot disagree with the ledger.
 */
export function TradePanel({
  state,
  onSelect,
}: {
  state: WorldState;
  onSelect: (systemId: string) => void;
}) {
  const me = state.playerFactionId;
  const ledger = ledgerFor(state, me);
  const earnings = routeEarnings(state);
  const mine = routesTouching(state, me);
  const all = tradeRoutes(state);

  const nameOf = (id: string) => state.systems.find((s) => s.id === id)?.name ?? id;
  const holderOf = (id: string) => state.systems.find((s) => s.id === id)?.controllerFactionId ?? null;
  const colorOf = (id: string | null) => {
    const f = state.factions.find((x) => x.id === id);
    return f ? ansi256ToHex(f.displayColor) : '#666';
  };

  return (
    <div className="trade">
      <section className="trade-summary">
        <div className="ledger-row">
          <span>Territory</span>
          <span>{ledger.territory}/turn</span>
        </div>
        <div className="ledger-row">
          <span>Lanes</span>
          <span className={ledger.routes >= 0 ? 'good' : 'bad'}>
            {ledger.routes >= 0 ? '+' : ''}
            {ledger.routes}/turn
          </span>
        </div>
        {ledger.tolls > 0 && (
          <div className="ledger-row sub">
            <span>…of which tolls levied</span>
            <span className="good">+{ledger.tolls}</span>
          </div>
        )}
        {ledger.raided > 0 && (
          <div className="ledger-row sub">
            <span>…of which taken by raiding</span>
            <span className="good">+{ledger.raided}</span>
          </div>
        )}
        <div className="ledger-row sub">
          <span>Galaxy lanes open</span>
          <span>{Math.round(earnings.openness * 100)}%</span>
        </div>
        {earnings.uncollected > 0 && (
          <div className="ledger-row sub">
            <span title="Trade crossing unaligned systems nobody has a fleet on.">
              Unclaimed on neutral space
            </span>
            <span>{earnings.uncollected}/turn</span>
          </div>
        )}
      </section>

      <h4>
        Your lanes <span className="muted">({mine.length} of {all.length})</span>
      </h4>
      {mine.length === 0 && (
        <p className="muted">
          You touch none of the galaxy's trade lanes. Take a hub, or park a fleet on a neutral
          junction to work the traffic crossing it.
        </p>
      )}
      <ul className="lane-list">
        {[...mine]
          .sort((a, b) => b.volume - a.volume)
          .map((route) => (
            <Lane
              key={route.id}
              route={route}
              state={state}
              me={me}
              nameOf={nameOf}
              holderOf={holderOf}
              colorOf={colorOf}
              onSelect={onSelect}
            />
          ))}
      </ul>
    </div>
  );
}

function Lane({
  route,
  state,
  me,
  nameOf,
  holderOf,
  colorOf,
  onSelect,
}: {
  route: TradeRoute;
  state: WorldState;
  me: string;
  nameOf: (id: string) => string;
  holderOf: (id: string) => string | null;
  colorOf: (id: string | null) => string;
  onSelect: (systemId: string) => void;
}) {
  const [a, b] = route.endpoints;
  const interference = route.path
    .map((id) => ({ id, blockaders: blockadesOn(state, id), raiders: raidersOn(state, id) }))
    .filter((x) => x.blockaders.length > 0 || x.raiders.length > 0);

  const nameFaction = (id: string) => state.factions.find((f) => f.id === id)?.name ?? id;

  return (
    <li className={interference.length > 0 ? 'lane cut' : 'lane'}>
      <div className="lane-head">
        <span className="lane-ends">
          <button className="linkish" style={{ color: colorOf(holderOf(a)) }} onClick={() => onSelect(a)}>
            {nameOf(a)}
          </button>
          <span className="muted"> ↔ </span>
          <button className="linkish" style={{ color: colorOf(holderOf(b)) }} onClick={() => onSelect(b)}>
            {nameOf(b)}
          </button>
        </span>
        <span className="lane-vol">{route.volume}/turn</span>
      </div>

      <div className="lane-path">
        {route.path.map((id, i) => (
          <span key={id}>
            {i > 0 && <span className="muted"> · </span>}
            <span
              style={{ color: colorOf(holderOf(id)) }}
              className={holderOf(id) === me ? 'hop mine' : 'hop'}
              title={holderOf(id) ? nameFaction(holderOf(id)!) : 'unaligned'}
            >
              {nameOf(id)}
            </span>
          </span>
        ))}
      </div>

      {interference.map((x) => (
        <div key={x.id} className="lane-warn">
          {x.blockaders.length > 0 && (
            <>Blockaded at {nameOf(x.id)} by {x.blockaders.map(nameFaction).join(', ')}. </>
          )}
          {x.raiders.length > 0 && (
            <>Raided at {nameOf(x.id)} by {x.raiders.map(nameFaction).join(', ')}.</>
          )}
        </div>
      ))}
    </li>
  );
}
