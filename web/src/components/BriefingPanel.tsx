import type { Briefing } from '../../../src/engine/briefing.js';
import type { StagedItem } from './types.js';
import { ansi256ToHex } from '../color.js';

/**
 * The standing brief, always on screen.
 *
 * In the terminal this was printed once per turn and scrolled away. Here it is
 * persistent, because the whole point is that the player never has to go
 * looking to find out what is running.
 */
export function BriefingPanel({
  briefing,
  staged,
  onDiscard,
}: {
  briefing: Briefing | null;
  staged: StagedItem[];
  onDiscard: (index?: number) => void;
}) {
  return (
    <section className="briefing">
      {staged.length > 0 && (
        <div className="staged">
          <header>
            <strong>Declared this turn</strong>
            <button className="link" onClick={() => onDiscard()}>
              discard all
            </button>
          </header>
          <ul className="staged-list">
            {staged.map((s) => (
              <li key={s.index}>
                <span className="staged-label" title={s.narrative}>
                  {s.label}
                </span>
                <button
                  className="drop"
                  onClick={() => onDiscard(s.index)}
                  title="Drop this declaration"
                  aria-label={`Discard: ${s.label}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">These land when you end the turn.</p>
        </div>
      )}

      {!briefing ? (
        <p className="empty">End a turn to see the situation report.</p>
      ) : (
        <>
          <div className="ledger-row">
            <span className="treasury">{briefing.treasury}cr</span>
            <span className={briefing.ledger.net >= 0 ? 'good' : 'bad'}>
              {briefing.ledger.net >= 0 ? '+' : ''}
              {briefing.ledger.net}/turn
            </span>
            <span className="sub">
              +{briefing.ledger.territory} territory · +{briefing.ledger.routes} lanes · −
              {briefing.ledger.upkeep} upkeep
              {briefing.ledger.tolls > 0 && ` · ${briefing.ledger.tolls} in tolls`}
              {briefing.ledger.raided > 0 && ` · ${briefing.ledger.raided} raided`}
            </span>
          </div>

          {briefing.completed.length > 0 && (
            <div className="brief-group">
              <h4>Completed</h4>
              <ul>
                {briefing.completed.map((c, i) => (
                  <li key={i} className={c.mine ? 'mine' : ''} style={{ color: ansi256ToHex(c.color) }}>
                    {c.outcome}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {briefing.inProgress.length > 0 && (
            <div className="brief-group">
              <h4>Under way</h4>
              {briefing.inProgress.map((p) => (
                <div key={p.id} className="brief-project">
                  <div className="brief-project-head">
                    <span>{p.label}</span>
                    <span className={p.completesNextTurn ? 'eta soon' : 'eta'}>
                      {p.completesNextTurn ? 'NEXT TURN' : `${p.remaining} turns`}
                    </span>
                  </div>
                  <div className="progress">
                    <span
                      style={{
                        width: `${(p.progress / p.duration) * 100}%`,
                        background: ansi256ToHex(p.color),
                      }}
                    />
                  </div>
                  <div className="meta">→ {p.where}</div>
                </div>
              ))}
            </div>
          )}

          {briefing.observed.length > 0 && (
            <div className="brief-group">
              <h4>Enemy work you can see</h4>
              <ul>
                {briefing.observed.map((p) => (
                  <li key={p.id} style={{ color: ansi256ToHex(p.color) }}>
                    {p.factionName}: {p.label} → {p.where}, {p.remaining} left
                  </li>
                ))}
              </ul>
            </div>
          )}

          {briefing.quiet && <p className="empty">Nothing under way. The Rim is quiet.</p>}
        </>
      )}
    </section>
  );
}
