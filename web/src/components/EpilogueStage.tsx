import type { EpilogueView } from '../../../src/api/contract.js';
import { ansi256ToHex } from '../color.js';

/**
 * The last page.
 *
 * Takes the whole stage the way a diplomatic channel does, and for the same
 * reason: this is a mode, not a beat. The map is what you read while moving
 * fleets, and there are no fleets left to move.
 *
 * The per-faction verdict (`arc`) is computed in the engine and printed here
 * beside the narration, so a reader can check the prose against the board
 * rather than taking its word — the whole point of settling the arc in code.
 */
const ARC_LABEL: Record<EpilogueView['factions'][number]['arc'], string> = {
  ascendant: 'ascendant',
  diminished: 'diminished',
  holding: 'holding',
  broken: 'broken',
};

export function EpilogueStage({ epilogue }: { epilogue: EpilogueView }) {
  const slideFor = (id: string) => epilogue.slides.find((s) => s.factionId === id)?.text ?? '';

  return (
    <div className="epilogue">
      <header className="epilogue-head">
        <h2>The Rim, {epilogue.turn} turns on</h2>
        <p className="hint">
          {epilogue.unaligned} worlds still answer to nobody.
          {epilogue.fallback && ' (The narration could not be written; this is the plain record.)'}
        </p>
      </header>

      {epilogue.factions.map((f) => (
        <section
          key={f.factionId}
          className={`epilogue-slide${f.factionId === epilogue.playerFactionId ? ' mine' : ''}`}
          style={{ borderColor: ansi256ToHex(f.color) }}
        >
          <h3 style={{ color: ansi256ToHex(f.color) }}>
            {f.name}
            <span className={`arc arc-${f.arc}`}>{ARC_LABEL[f.arc]}</span>
          </h3>
          <p className="epilogue-text">{slideFor(f.factionId)}</p>
          <div className="epilogue-facts">
            <span>
              {f.systems} worlds
              {f.systemsDelta !== 0 && (
                <span className={f.systemsDelta > 0 ? 'up' : 'down'}>
                  {' '}
                  {f.systemsDelta > 0 ? '+' : ''}
                  {f.systemsDelta}
                </span>
              )}
            </span>
            <span>{f.fleet} hulls</span>
            <span className={f.net >= 0 ? 'up' : 'down'}>
              {f.net >= 0 ? '+' : ''}
              {f.net}/turn
            </span>
            {f.wars.length > 0 && <span className="down">at war: {f.wars.join(', ')}</span>}
            {/* The net position above can be zero while the campaign was
                fought over the same world three times, so the count of
                changes of hands is a separate fact and belongs on screen
                beside the prose that draws on it — the whole point of
                settling the facts in code is that a reader can check the
                story against them. */}
            {(f.took.length > 0 || f.ceded.length > 0) && (
              <span title={`taken: ${f.took.join(', ') || 'none'} · lost: ${f.ceded.join(', ') || 'none'}`}>
                {f.took.length} taken / {f.ceded.length} lost
              </span>
            )}
            {f.contested.length > 0 && (
              <span title="Changed hands more than once">
                fought over: {f.contested.join(', ')}
              </span>
            )}
          </div>
        </section>
      ))}

      <section className="epilogue-closing">
        <p>{epilogue.closing}</p>
      </section>
    </div>
  );
}
