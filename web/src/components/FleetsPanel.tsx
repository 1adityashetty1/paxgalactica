import {
  fleetStrengthOf,
  shipsInTransit,
  systemIncome,
  type WorldState,
} from '../../../src/domain/state.js';
import { ansi256ToHex } from '../color.js';

/**
 * Every hull in the galaxy, by system.
 *
 * The map shows who *controls* a world and the System tab shows one world at a
 * time, so there was nowhere to answer "where are my ships, and whose ships are
 * sitting on mine". That question matters more here than in most strategy
 * games, because presence is not the same as ownership: a fleet parked in a
 * neutral or rival system collects income, contests it, blockades lanes and
 * can suborn crews — all without owning anything.
 */
export function FleetsPanel({
  state,
  onSelect,
}: {
  state: WorldState;
  onSelect: (systemId: string) => void;
}) {
  const me = state.playerFactionId;
  const colorOf = (id: string) => {
    const f = state.factions.find((x) => x.id === id);
    return f ? ansi256ToHex(f.displayColor) : '#888';
  };
  const nameOf = (id: string) => state.factions.find((f) => f.id === id)?.name ?? id;

  const occupied = state.systems
    .map((s) => ({
      system: s,
      crews: Object.entries(s.ships)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    }))
    .filter((row) => row.crews.length > 0);

  // Somewhere you have ships but do not own the ground, or somebody else does
  // the same to you. These are the rows a player actually needs to find.
  const notable = occupied.filter(
    ({ system, crews }) =>
      crews.some(([id]) => id !== system.controllerFactionId) &&
      (crews.some(([id]) => id === me) || system.controllerFactionId === me),
  );

  const inTransit = state.pendingOrders.filter(
    (o) => o.type === 'fleet_movement' && o.force > 0,
  );

  return (
    <div className="fleet-panel">
      <div className="fleet-totals">
        {state.factions.map((f) => {
          const transit = shipsInTransit(state, f.id);
          return (
            <div key={f.id} className="fleet-total">
              <span style={{ color: colorOf(f.id) }}>{f.name}</span>
              <span>
                {fleetStrengthOf(state, f.id)}
                {transit > 0 && <span className="muted"> ({transit} under way)</span>}
              </span>
            </div>
          );
        })}
      </div>

      {notable.length > 0 && (
        <>
          <h4>
            Where presence and ownership differ{' '}
            <span className="muted">({notable.length})</span>
          </h4>
          <p className="hint">
            Ships in a system you do not own still take a share of its income, and
            can blockade, raid or suborn from there.
          </p>
          <ul className="fleet-list">
            {notable.map(({ system, crews }) => (
              <Row
                key={system.id}
                system={system}
                crews={crews}
                state={state}
                me={me}
                colorOf={colorOf}
                nameOf={nameOf}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </>
      )}

      <h4>
        All hulls by system <span className="muted">({occupied.length} systems)</span>
      </h4>
      <ul className="fleet-list">
        {occupied.map(({ system, crews }) => (
          <Row
            key={system.id}
            system={system}
            crews={crews}
            state={state}
            me={me}
            colorOf={colorOf}
            nameOf={nameOf}
            onSelect={onSelect}
          />
        ))}
      </ul>

      <h4>
        Under way <span className="muted">({inTransit.length})</span>
      </h4>
      {inTransit.length === 0 ? (
        <p className="empty">Nothing is moving.</p>
      ) : (
        <ul className="fleet-list">
          {inTransit.map((o) => (
            <li key={o.id} className="fleet-row">
              <span style={{ color: colorOf(o.factionId) }}>{o.force} hulls</span>
              <span className="muted">
                {' '}
                → {state.systems.find((s) => s.id === o.targetId)?.name ?? o.targetId} ·{' '}
                {Math.max(0, o.durationTurns - o.progress)} turn
                {o.durationTurns - o.progress === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  system,
  crews,
  state,
  me,
  colorOf,
  nameOf,
  onSelect,
}: {
  system: WorldState['systems'][number];
  crews: [string, number][];
  state: WorldState;
  me: string;
  colorOf: (id: string) => string;
  nameOf: (id: string) => string;
  onSelect: (systemId: string) => void;
}) {
  const income = systemIncome(state, system);
  const holder = system.controllerFactionId;

  return (
    <li className={income.contested ? 'fleet-row contested' : 'fleet-row'}>
      <button className="linkish" onClick={() => onSelect(system.id)}>
        <span style={{ color: holder ? colorOf(holder) : '#888' }}>{system.name}</span>
      </button>
      <span className="muted">
        {' '}
        {holder ? nameOf(holder) : 'unaligned'} · garrison {system.garrison}/{system.garrisonMax}
        {income.contested && <span className="warn-text"> · contested</span>}
      </span>
      <div className="crews">
        {crews.map(([id, n]) => (
          <span
            key={id}
            className={id === me ? 'crew mine' : 'crew'}
            style={{ color: colorOf(id) }}
            title={`${nameOf(id)} — ${n} hull${n === 1 ? '' : 's'}${
              id === holder ? ' (holds this world)' : ' (present, does not hold it)'
            }`}
          >
            {n}
            {id !== holder && '*'}
          </span>
        ))}
      </div>
    </li>
  );
}
