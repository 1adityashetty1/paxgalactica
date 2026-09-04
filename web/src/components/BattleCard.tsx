import { useState } from 'react';
import {
  changedHands,
  totalLosses,
  type BattleReport,
  type BattleRound,
} from '../../../src/domain/battle.js';
import type { WorldState } from '../../../src/domain/state.js';
import { getFaction } from '../../../src/domain/state.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';
import { GarrisonIcon, ShipIcon } from './BattleIcons.js';

/**
 * A battle, shown as the arithmetic that produced it.
 *
 * Before this, a whole engagement reached the player as one sentence in the
 * Completed list — no phases, no roll, no idea what was left standing. The
 * numbers were always there; `resolveBattle` just threw them away.
 *
 * Collapsed by default because most turns have a battle the player only needs
 * the headline of, and expanded on click when they want to know why they lost.
 */

const OUTCOME_LABEL: Record<BattleRound['outcome'], string> = {
  unopposed: 'walked in unopposed',
  defender_broke_off: 'defenders broke off',
  attacker_driven_off: 'attack driven off',
  exchange: 'both sides traded losses',
  no_landing: 'defenders held the orbitals — no landing',
  force_spent: 'attacking force spent',
  world_taken: 'garrison broken, world taken',
  landing_thrown_back: 'landing thrown back',
  orbit_cleared: 'orbit cleared of rival ships',
};

function Side({
  title,
  contingents,
  state,
}: {
  title: string;
  contingents: BattleRound['attackers'];
  state: WorldState;
}) {
  if (contingents.length === 0) return null;
  return (
    <div className="battle-side">
      <span className="battle-side-label">{title}</span>
      {contingents.map((c) => {
        const lost = Math.max(0, c.before - c.after);
        const colour = ansi256ToHex(getFaction(state, c.factionId)?.displayColor ?? 0) || NEUTRAL;
        return (
          <span key={c.factionId} className="battle-contingent" style={{ color: colour }}>
            {c.factionName} {c.before}
            {lost > 0 ? <span className="battle-lost"> −{lost}</span> : null} → {c.after}
          </span>
        );
      })}
    </div>
  );
}

/** One `<icon> x N` pair. The unit of the order of battle. */
function Strength({
  kind,
  count,
  label,
}: {
  kind: 'ship' | 'garrison';
  count: number;
  label: string;
}) {
  return (
    <span className="ob-strength" title={`${count} ${label}`}>
      {kind === 'ship' ? <ShipIcon /> : <GarrisonIcon />}
      <span className="ob-count">×{count}</span>
    </span>
  );
}

/** One row of the order of battle: who, and what they brought. */
function ObRow({
  name,
  colour,
  ships,
  garrison,
}: {
  name: string;
  colour: string;
  ships: number;
  garrison?: number;
}) {
  if (ships <= 0 && !garrison) return null;
  return (
    <div className="ob-row" style={{ color: colour }}>
      <span className="ob-name">{name}</span>
      <span className="ob-units">
        {ships > 0 && <Strength kind="ship" count={ships} label="warships" />}
        {garrison !== undefined && garrison > 0 && (
          <Strength kind="garrison" count={garrison} label="garrison batteries" />
        )}
      </span>
    </div>
  );
}

/**
 * Who brought what, and what did not go home.
 *
 * The numbers were already on the card, spread across the phase breakdown as
 * before/after pairs. This is the same information as a *shape*: two columns
 * you can compare at a glance without doing subtraction in your head, which is
 * what tells you whether a landing failed because the fleet was spent or
 * because the garrison was simply too deep.
 *
 * Committed strength comes from the first round — that is the engagement as it
 * opened — and the garrison from the report, because a garrison never appears
 * in a contingent list; it is dug-in ground troops, not hulls.
 */
function OrderOfBattle({ report, state }: { report: BattleReport; state: WorldState }) {
  const opening = report.rounds[0];
  if (!opening) return null;

  const losses = totalLosses(report);
  const garrisonLost = Math.max(0, report.garrisonBefore - report.garrisonAfter);
  const colourOf = (id: string) =>
    ansi256ToHex(getFaction(state, id)?.displayColor ?? 0) || NEUTRAL;

  // Defenders can be absent entirely (an unopposed walk-in), and a defending
  // *fleet* can be absent while a garrison is not.
  const defenders = opening.defenders;
  const defenderName =
    defenders[0]?.factionName ??
    (report.holderBefore ? getFaction(state, report.holderBefore)?.name ?? 'the holder' : 'nobody');
  const defenderColour = report.holderBefore ? colourOf(report.holderBefore) : NEUTRAL;

  return (
    <div className="order-of-battle">
      <div className="ob-col">
        <span className="ob-heading">Order of battle</span>
        {opening.attackers.map((c) => (
          <ObRow
            key={c.factionId}
            name={c.factionName}
            colour={colourOf(c.factionId)}
            ships={c.before}
          />
        ))}
        {defenders.length > 0 ? (
          defenders.map((c, i) => (
            <ObRow
              key={c.factionId}
              name={c.factionName}
              colour={colourOf(c.factionId)}
              ships={c.before}
              garrison={i === 0 ? report.garrisonBefore : undefined}
            />
          ))
        ) : (
          <ObRow
            name={defenderName}
            colour={defenderColour}
            ships={0}
            garrison={report.garrisonBefore}
          />
        )}
      </div>

      <div className="ob-col">
        <span className="ob-heading">Losses</span>
        <ObRow name="attacking" colour={NEUTRAL} ships={losses.attackers} />
        <ObRow
          name="defending"
          colour={NEUTRAL}
          ships={losses.defenders}
          garrison={garrisonLost}
        />
        {losses.attackers === 0 && losses.defenders === 0 && garrisonLost === 0 && (
          <span className="muted">nothing was fired</span>
        )}
      </div>
    </div>
  );
}

export function BattleCard({ report, state }: { report: BattleReport; state: WorldState }) {
  const [open, setOpen] = useState(false);
  const losses = totalLosses(report);
  const took = changedHands(report);
  const holder = report.holderAfter ? getFaction(state, report.holderAfter) : null;
  const colour = holder ? ansi256ToHex(holder.displayColor) : NEUTRAL;

  return (
    <div className={`battle-card${took ? ' battle-taken' : ''}`}>
      <button className="battle-head" onClick={() => setOpen((v) => !v)} type="button">
        <span className="battle-where" style={{ color: colour }}>
          {report.systemName}
        </span>
        <span className="battle-summary">
          {took
            ? `${holder?.name ?? 'nobody'} takes possession`
            : report.holderBefore
              ? `${getFaction(state, report.holderBefore)?.name ?? 'the holder'} holds`
              : 'unclaimed'}
        </span>
        {/* The roll is shown deliberately: its salt is combat:<system>:<turn>,
            so it was always derivable, and every ability check is already
            written to the log so a campaign's luck can be audited. */}
        <span className="battle-roll">d20 {report.roll}</span>
        <span className="battle-losses">
          −{losses.attackers} / −{losses.defenders}
        </span>
        <span className="battle-toggle">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="battle-body">
          <p className="muted battle-mods">
            attacker might {report.attackMod >= 0 ? '+' : ''}
            {report.attackMod} · defender might {report.defendMod >= 0 ? '+' : ''}
            {report.defendMod} · garrison {report.garrisonBefore} → {report.garrisonAfter}
          </p>

          <OrderOfBattle report={report} state={state} />

          {report.doctrinesFired.length > 0 && (
            <ul className="battle-doctrines">
              {report.doctrinesFired.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}

          {report.rounds.map((round, i) => (
            <div key={i} className="battle-round">
              <div className="battle-round-head">
                <span className="battle-phase">
                  {round.phase === 'orbital' ? 'Orbitals' : 'Ground'}
                </span>
                <span className="battle-outcome">{OUTCOME_LABEL[round.outcome]}</span>
                {round.phase === 'orbital' && round.defendPower > 0 && (
                  <span className="battle-power">
                    {round.attackPower} vs {round.defendPower}
                  </span>
                )}
                {round.phase === 'ground' && round.garrison > 0 && (
                  <span className="battle-power">
                    assault {round.assault} vs garrison{' '}
                    {round.garrisonEffective !== round.garrison
                      ? `${round.garrison} (fighting as ${round.garrisonEffective})`
                      : round.garrison}
                  </span>
                )}
              </div>
              <Side title="attacking" contingents={round.attackers} state={state} />
              <Side title="defending" contingents={round.defenders} state={state} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
