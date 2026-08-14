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
