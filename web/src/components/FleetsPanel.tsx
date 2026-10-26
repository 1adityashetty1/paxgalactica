import {
  presentAt,
  stackAt,
  fleetStrengthOf,
  fleetTonsOf,
  shipsInTransit,
  systemIncome,
  type WorldState,
} from '../../../src/domain/state.js';
import { ansi256ToHex } from '../color.js';
import { describeStack, hullsIn } from '../../../src/domain/hulls.js';
import { CommanderIcon, StackGlyphs } from './BattleIcons.js';
import { archetypeOf, commandingAboard, commandingAt, veterancyLabel } from '../../../src/domain/command.js';
import { fleetName, fleetsAt, type Fleet } from '../../../src/domain/fleets.js';
import { HULL_CLASSES, HULL_SPEC, type HullClass } from '../../../src/domain/hulls.js';
import type { OrganiseRequest } from '../../../src/api/contract.js';
import { useState } from 'react';

/**
 * Officers, drawn as a hull class is — an icon and a count — with every name,
 * school and record on hover. An
 * officer is a unit of the fleet (item 122), so they are drawn beside the
 * hulls they stand with, here as on the System panel and the map.
 */
function Officers({ state, ids }: { state: WorldState; ids: string[] }) {
  const people = ids
    .map((id) => (state.commanders ?? []).find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (people.length === 0) return null;
  // Drawn like a hull class: one icon and a count, so two officers in one
  // place are never one icon that hides the second. Every one is on hover.
  const names = people.map((c) => `${c.name} — ${archetypeOf(c.archetype).effect}, ${veterancyLabel(c.battles)}`);
  return (
    <span className="ob-strength" title={names.join('\n')}>
      <CommanderIcon size={12} title={names.join('\n')} />
      <span className="ob-count">×{people.length}</span>
    </span>
  );
}

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
  onDraft,
  onOrganise,
}: {
  state: WorldState;
  onSelect: (systemId: string) => void;
  /** Puts an order on the command line: moving a fleet is a declaration. */
  onDraft: (text: string) => void;
  /** Rename, split or merge — free, and staged with the turn. */
  onOrganise: (request: OrganiseRequest) => void;
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
      crews: presentAt(s).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
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
    (o) => o.type === 'fleet_movement' && hullsIn(o.force) > 0,
  );

  const mine = state.systems.flatMap((system) => fleetsAt(system, me).filter((f) => f.number > 0).map((fleet) => ({ fleet, system })));
  const mineUnderWay = state.pendingOrders.filter((o) => o.factionId === me && o.fleet && !o.fleet.detached);

  return (
    <div className="fleet-panel">
      {(mine.length > 0 || mineUnderWay.length > 0) && (
        <>
          <h4>
            Your fleets <span className="muted">({mine.length + mineUnderWay.length})</span>
          </h4>
          <p className="hint">
            Move one by name. Renaming, splitting and merging are free and land with the turn.
          </p>
          <ul className="fleet-list">
            {mine.map(({ fleet, system }) => (
              <OwnFleet
                key={fleet.id}
                state={state}
                fleet={fleet}
                system={system}
                others={mine.filter((x) => x.system === system && x.fleet !== fleet).map((x) => x.fleet)}
                onSelect={onSelect}
                onDraft={onDraft}
                onOrganise={onOrganise}
              />
            ))}
            {mineUnderWay.map((o) => (
              <li key={o.id} className="fleet-row own-fleet">
                <strong>{fleetName(me, o.fleet!)}</strong>
                <span className="muted">
                  {' '}
                  under way → {state.systems.find((s) => s.id === o.targetId)?.name ?? o.targetId} ·{' '}
                  {Math.max(0, o.durationTurns - o.progress)} turn{o.durationTurns - o.progress === 1 ? '' : 's'}
                </span>
                <div className="crews">
                  <StackGlyphs stack={o.force} size={12} />
                </div>
                <Commanding
                  state={state}
                  assigned={o.fleet!.commanderId}
                  fallback={commandingAboard(state.commanders, o.officers ?? [])}
                  aboard={(o.officers ?? []).filter((id) => id !== o.fleet!.commanderId)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="fleet-totals">
        {state.factions.map((f) => {
          const transit = shipsInTransit(state, f.id);
          return (
            <div key={f.id} className="fleet-total">
              <span style={{ color: colorOf(f.id) }}>{f.name}</span>
              <span>
                {/* Both, because a player thinks in ships and the rules count
                    tons: upkeep, the yards' bill, insolvency attrition and the
                    contest for a world's income are all denominated in
                    displacement. Showing only hulls would hide why a fleet of
                    escorts costs less to keep than the same number of
                    battleships. */}
                {fleetStrengthOf(state, f.id)}
                <span className="muted"> · {fleetTonsOf(state, f.id)}t</span>
                {transit > 0 && <span className="muted"> ({transit} under way)</span>}
                {/* The standing order a losing defence follows. Crusading
                    overrides it, so that is what is shown for the Vigil. */}
                <span
                  className="muted"
                  title="One standing order for its whole navy, every fleet at once: what they do when a defence goes badly. Hold never breaks off, stand breaks off at two to one, withdraw leaves the moment it is outmatched. Changed by declaring it."
                >
                  {' · '}
                  {f.warEthic === 'crusading' ? 'never runs' : f.stance}
                </span>
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
              <span style={{ color: colorOf(o.factionId) }} title={describeStack(o.force)}>
                {o.fleet && !o.fleet.detached && <span className="fleet-tag">{fleetName(o.factionId, o.fleet)} </span>}
                <StackGlyphs stack={o.force} />
                <Officers state={state} ids={o.officers ?? []} />
              </span>
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
            title={`${nameOf(id)} — ${
              fleetsAt(system, id).filter((f) => f.number > 0).length > 0
                ? fleetsAt(system, id).filter((f) => f.number > 0).map((f) => `${fleetName(id, f)}: ${describeStack(f.stack)}`).join('; ')
                : describeStack(stackAt(system, id))
            }${id === holder ? ' (holds this world)' : ' (present, does not hold it)'}`}
          >
            {/* Total first, because that is what the eye counts down the
                column; the composition follows it, because a squadron of
                twelve is a different thing depending on whether any of them
                can put troops on the ground. */}
            {n}
            {id !== holder && '*'}
            <span className="crew-mix">
              <StackGlyphs stack={stackAt(system, id)} size={12} />
            </span>
            <Officers
              state={state}
              ids={(state.commanders ?? [])
                .filter((c) => c.status === 'active' && c.factionId === id && c.atSystemId === system.id)
                .map((c) => c.id)}
            />
          </span>
        ))}
      </div>
    </li>
  );
}

/**
 * One of the player's fleets: where it stands and what it holds, with the
 * three things done to a fleet — move it (a declaration, so it goes on the
 * command line), and rename, split or merge it (free, staged with the turn).
 */
function OwnFleet({
  state,
  fleet,
  system,
  others,
  onSelect,
  onDraft,
  onOrganise,
}: {
  state: WorldState;
  fleet: Fleet;
  system: WorldState['systems'][number];
  others: Fleet[];
  onSelect: (systemId: string) => void;
  onDraft: (text: string) => void;
  onOrganise: (request: OrganiseRequest) => void;
}) {
  const me = state.playerFactionId;
  const name = fleetName(me, fleet);
  const [mode, setMode] = useState<'idle' | 'rename' | 'split'>('idle');
  const [newName, setNewName] = useState(fleet.name ?? '');
  const [split, setSplit] = useState<Partial<Record<HullClass, number>>>({});
  const classes = HULL_CLASSES.filter((h) => (fleet.stack[h] ?? 0) > 0);
  const officers = (state.commanders ?? [])
    .filter((c) => c.status === 'active' && c.factionId === me && c.atSystemId === system.id)
    .map((c) => c.id);
  // Officers standing here who could take this fleet — any but its own
  // commander, with the fleet each already commands said, since taking this
  // one gives that one up.
  const commandOf = new Map(
    [fleet, ...others].filter((f) => f.commanderId).map((f) => [f.commanderId!, fleetName(me, f)] as const),
  );
  const candidates = (state.commanders ?? []).filter(
    (c) => c.status === 'active' && c.factionId === me && c.atSystemId === system.id && c.id !== fleet.commanderId,
  );

  return (
    <li className="fleet-row own-fleet">
      <strong>{name}</strong>{' '}
      <button className="linkish" onClick={() => onSelect(system.id)}>
        at {system.name}
      </button>
      <div className="crews">
        <StackGlyphs stack={fleet.stack} size={12} />
        <Officers state={state} ids={officers} />
      </div>
      <Commanding
        state={state}
        assigned={fleet.commanderId}
        fallback={commandingAt(state.commanders, me, system.id)}
        aboard={[]}
      />
      <div className="fleet-actions">
        <button className="chip" onClick={() => onDraft(`Move ${name} to `)} title="Write the order on the command line">
          move
        </button>
        <button className={mode === 'rename' ? 'chip on' : 'chip'} onClick={() => setMode(mode === 'rename' ? 'idle' : 'rename')}>
          rename
        </button>
        {hullsIn(fleet.stack) > 1 && (
          <button className={mode === 'split' ? 'chip on' : 'chip'} onClick={() => setMode(mode === 'split' ? 'idle' : 'split')}>
            split
          </button>
        )}
        {fleet.commanderId && (
          <button className="chip" onClick={() => onOrganise({ op: 'relieve_command', fleet: fleet.id })} title="The officer stays at this world, without a command">
            relieve
          </button>
        )}
        {candidates.length > 0 && (
          <select
            className="chip"
            value=""
            onChange={(e) => e.target.value && onOrganise({ op: 'assign_command', fleet: fleet.id, officer: e.target.value })}
            aria-label={`Put an officer in command of ${name}`}
          >
            <option value="">{fleet.commanderId ? 'give command to…' : 'assign commander…'}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {commandOf.get(c.id) ? ` (now commands ${commandOf.get(c.id)})` : ''}
              </option>
            ))}
          </select>
        )}
        {others.map((o) => (
          <button
            key={o.id}
            className="chip"
            onClick={() => onOrganise({ op: 'merge_fleets', into: o.id, from: [fleet.id] })}
            title={`Fold ${name} into ${fleetName(me, o)}, here at ${system.name}`}
          >
            merge into {fleetName(me, o)}
          </button>
        ))}
      </div>
      {mode === 'rename' && (
        <form
          className="fleet-form"
          onSubmit={(e) => {
            e.preventDefault();
            onOrganise({ op: 'rename_fleet', fleet: fleet.id, name: newName });
            setMode('idle');
          }}
        >
          <input value={newName} maxLength={60} placeholder={fleetName(me, { number: fleet.number, name: null })} onChange={(e) => setNewName(e.target.value)} aria-label="Fleet name" />
          <button type="submit" className="chip">save</button>
        </form>
      )}
      {mode === 'split' && (
        <form
          className="fleet-form"
          onSubmit={(e) => {
            e.preventDefault();
            onOrganise({ op: 'split_fleet', fleet: fleet.id, force: split });
            setSplit({});
            setMode('idle');
          }}
        >
          {classes.map((h) => (
            <label key={h} className="split-class">
              {HULL_SPEC[h].label}
              <input
                type="number"
                min={0}
                max={fleet.stack[h] ?? 0}
                value={split[h] ?? 0}
                onChange={(e) => setSplit((v) => ({ ...v, [h]: Math.max(0, Math.min(fleet.stack[h] ?? 0, Number(e.target.value) || 0)) }))}
              />
              <span className="muted">/ {fleet.stack[h]}</span>
            </label>
          ))}
          <button type="submit" className="chip" disabled={hullsIn(split) === 0 || hullsIn(split) === hullsIn(fleet.stack)}>
            split off
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * A fleet's commander, assigned (`Fleet.commanderId`), and who else is aboard.
 * With none assigned, the battle falls back on seniority among the officers
 * present, and that officer is named so the player knows who would lead.
 */
function Commanding({
  state,
  assigned,
  fallback,
  aboard,
}: {
  state: WorldState;
  assigned: string | null;
  fallback: { name: string } | undefined;
  aboard: string[];
}) {
  const chief = assigned ? (state.commanders ?? []).find((c) => c.id === assigned) : undefined;
  const riders = aboard
    .map((id) => (state.commanders ?? []).find((c) => c.id === id)?.name)
    .filter((n): n is string => n !== undefined);
  return (
    <div className="fleet-command">
      {chief ? (
        <span title={`${archetypeOf(chief.archetype).effect}, ${veterancyLabel(chief.battles)}`}>
          <span className="muted">Commander </span>
          {chief.name}
          <span className="muted"> · {veterancyLabel(chief.battles)}</span>
        </span>
      ) : (
        <span className="muted">
          No commander{fallback ? ` — in battle the senior officer present, ${fallback.name}, would lead` : ' — it fights without one'}
        </span>
      )}
      {riders.length > 0 && <span className="muted"> · aboard: {riders.join(', ')}</span>}
    </div>
  );
}
