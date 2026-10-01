import { useMemo } from 'react';
import type { BriefingEventView } from '../../../src/api/contract.js';
import { OUTCOME_H, OUTCOME_W, hasRimArt, rimEventRuns } from '../../../src/ui/outcomeart.js';

/**
 * Something the Rim did on its own (item 124), as a card rather than a line.
 *
 * Surfaced the way a veto is: a veto is not missable because it is a picture in
 * the feed with its sentence under it, not a sentence in the log. An event gets
 * the same treatment — its own card after End Turn, and again in the briefing
 * so it is still there on a resumed campaign.
 *
 * **Two lines, and the plain one always shows.** The flavour line is a model's
 * rewording, attached after the fact and allowed to be absent; the plain line
 * is the reducer's own sentence and is what actually happened. The card reads
 * whole with either, and never shows the flavour without the fact beneath it.
 *
 * **Art only where it has been approved.** Each kind gets a pixel scene once
 * the user has vetted it (see `docs/todo.md` 124); a kind without one is the
 * text treatment, which is exactly the fallback `OutcomeArt` keeps.
 */
export function RimEventCard({
  event,
  compact = false,
}: {
  event: BriefingEventView;
  /** The briefing's version: no art slot, and the plain line alone once it is old news. */
  compact?: boolean;
}) {
  const tone = event.boon ? 'boon' : 'hazard';
  const until =
    event.untilTurn === null
      ? null
      : event.ongoing
        ? `in force through turn ${event.untilTurn}`
        : `until turn ${event.untilTurn}`;
  return (
    <div className={`rim-event ${tone}${compact ? ' compact' : ''}`} role="note">
      {!compact && <RimEventArt kind={event.kind} alt={`${event.title}: ${event.text}`} />}
      <div className="rim-event-head">
        <strong>{event.title}</strong>
        {event.where && <span className="muted"> · {event.where}</span>}
        {until && <span className="muted"> · {until}</span>}
      </div>
      {event.flavour && !(compact && event.ongoing) && (
        <p className="rim-event-flavour">{event.flavour}</p>
      )}
      <p className="rim-event-fact">{event.text}</p>
    </div>
  );
}

/**
 * The picture for one kind of event, drawn from `src/ui/outcomeart.ts` the way
 * refusal and defiance are. A kind with no approved scene renders nothing at
 * all, never a grey slab or a broken image. `crispEdges` is what keeps it
 * pixel art at any size.
 */
function RimEventArt({ kind, alt }: { kind: BriefingEventView['kind']; alt: string }) {
  const runs = useMemo(() => (hasRimArt(kind) ? rimEventRuns(kind) : null), [kind]);
  if (!runs) return null;
  return (
    <svg
      className="outcome-art rim-art"
      viewBox={`0 0 ${OUTCOME_W} ${OUTCOME_H}`}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      role="img"
      aria-label={alt}
    >
      {runs.map((r) => (
        <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.colour} />
      ))}
    </svg>
  );
}
