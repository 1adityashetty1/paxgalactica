import { useState } from 'react';
import {
  CHEAT_ASSET_KINDS,
  CHEAT_CREDITS,
  CHEAT_DISPOSITION,
  CHEAT_SHIP_COUNTS,
  type Cheat,
} from '../../../src/domain/cheats.js';
import { archetypeFor } from '../../../src/domain/assets.js';
import { COMMANDER_ARCHETYPES } from '../../../src/domain/command.js';
import { HULL_CLASSES } from '../../../src/domain/hulls.js';
import { hullsAt, type WorldState } from '../../../src/domain/state.js';

/**
 * The cheat menu, opened with `:cheats`.
 *
 * Every control is a fixed choice — a power, a world, a class, and one of a few
 * listed amounts — because the request it sends is `CheatSchema`, which only
 * admits those. Nothing here is typed free-form, so there is nothing to argue
 * the reducer into.
 */
export function CheatPanel({
  state,
  busy,
  onCheat,
  onClose,
}: {
  state: WorldState;
  busy: boolean;
  onCheat: (cheat: Cheat) => void;
  onClose: () => void;
}) {
  const me = state.playerFactionId;
  const factions = state.factions;
  const others = (id: string) => factions.filter((f) => f.id !== id);
  const heldBy = (id: string) => state.systems.filter((s) => s.controllerFactionId === id);
  const standsAt = (id: string) =>
    state.systems.filter((s) => s.controllerFactionId === id || hullsAt(s, id) > 0);
  const held = state.systems.filter((s) => s.controllerFactionId !== null);

  const [creditsFor, setCreditsFor] = useState(me);
  const [from, setFrom] = useState(me);
  const [toward, setToward] = useState(others(me)[0]?.id ?? me);
  const [assetKind, setAssetKind] = useState(CHEAT_ASSET_KINDS[0] ?? 'ore');
  const [assetAt, setAssetAt] = useState(heldBy(me)[0]?.id ?? held[0]?.id ?? '');
  const [shipsFor, setShipsFor] = useState(me);
  const [shipsAt, setShipsAt] = useState(standsAt(me)[0]?.id ?? '');
  const [hull, setHull] = useState<(typeof HULL_CLASSES)[number]>('battleship');
  const [officerFor, setOfficerFor] = useState(me);
  const [officerAt, setOfficerAt] = useState(heldBy(me)[0]?.id ?? '');
  const [school, setSchool] = useState<(typeof COMMANDER_ARCHETYPES)[number]['kind']>('lineofbattle');

  const factionSelect = (value: string, set: (v: string) => void, list = factions) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {list.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
  const worldSelect = (value: string, set: (v: string) => void, list: WorldState['systems']) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {list.length === 0 && <option value="">(nowhere)</option>}
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
  const go = (cheat: Cheat) => () => onCheat(cheat);

  // Keep a dependent world choice valid when the power it depends on changes.
  const pickShipsFor = (id: string) => {
    setShipsFor(id);
    setShipsAt(standsAt(id)[0]?.id ?? '');
  };
  const pickOfficerFor = (id: string) => {
    setOfficerFor(id);
    setOfficerAt(heldBy(id)[0]?.id ?? '');
  };
  const pickFrom = (id: string) => {
    setFrom(id);
    if (toward === id) setToward(others(id)[0]?.id ?? id);
  };

  return (
    <div className="cheat-panel" role="dialog" aria-label="Cheat menu">
      <header>
        <strong>Cheats</strong>
        <span className="muted">
          For testing. Instant, free, costs no action and skips the arbiter — and no power is ever told.
        </span>
        <button className="endtalk" onClick={onClose}>
          close
        </button>
      </header>

      <div className="cheat-row">
        <span className="cheat-label">Credits</span>
        {factionSelect(creditsFor, setCreditsFor)}
        {CHEAT_CREDITS.map((n) => (
          <button key={n} disabled={busy} onClick={go({ kind: 'credits', factionId: creditsFor, amount: n })}>
            +{n}
          </button>
        ))}
      </div>

      <div className="cheat-row">
        <span className="cheat-label">Disposition</span>
        {factionSelect(from, pickFrom)}
        <span className="muted">toward</span>
        {factionSelect(toward, setToward, others(from))}
        {CHEAT_DISPOSITION.map((d) => (
          <button
            key={d}
            disabled={busy}
            onClick={go({ kind: 'disposition', factionId: from, towardFactionId: toward, delta: d })}
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>

      <div className="cheat-row">
        <span className="cheat-label">Asset</span>
        <select value={assetKind} onChange={(e) => setAssetKind(e.target.value)}>
          {CHEAT_ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ')}
              {archetypeFor(k)?.fixture ? ' (fixture)' : ''}
            </option>
          ))}
        </select>
        <span className="muted">at</span>
        {worldSelect(assetAt, setAssetAt, held)}
        <button disabled={busy || !assetAt} onClick={go({ kind: 'asset', archetype: assetKind, systemId: assetAt })}>
          place
        </button>
      </div>

      <div className="cheat-row">
        <span className="cheat-label">Ships</span>
        {factionSelect(shipsFor, pickShipsFor)}
        <span className="muted">at</span>
        {worldSelect(shipsAt, setShipsAt, standsAt(shipsFor))}
        <select value={hull} onChange={(e) => setHull(e.target.value as typeof hull)}>
          {HULL_CLASSES.map((h) => (
            <option key={h} value={h}>
              {h.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {CHEAT_SHIP_COUNTS.map((n) => (
          <button
            key={n}
            disabled={busy || !shipsAt}
            onClick={go({ kind: 'ships', factionId: shipsFor, systemId: shipsAt, hull, count: n })}
          >
            +{n}
          </button>
        ))}
      </div>

      <div className="cheat-row">
        <span className="cheat-label">Officer</span>
        {factionSelect(officerFor, pickOfficerFor)}
        <span className="muted">at</span>
        {worldSelect(officerAt, setOfficerAt, heldBy(officerFor))}
        <select value={school} onChange={(e) => setSchool(e.target.value as typeof school)}>
          {COMMANDER_ARCHETYPES.map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.kind}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !officerAt}
          onClick={go({ kind: 'officer', factionId: officerFor, systemId: officerAt, archetype: school })}
        >
          appoint
        </button>
      </div>
    </div>
  );
}
