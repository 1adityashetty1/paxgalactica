import type { BriefingEventView } from '../../../src/api/contract.js';

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
 * **No art yet, on purpose.** Each kind gets a pixel scene once the user has
 * vetted it (see `docs/todo.md` 124); until then there is nothing to draw and
 * the card is the text treatment, which is exactly the fallback `OutcomeArt`
 * keeps for a kind with no scene. The slot is `RimEventArt`, and it renders
 * nothing for a kind with no approved scene.
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
      {!compact && <RimEventArt kind={event.kind} />}
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
 * The picture for one kind of event, once it exists. Nothing is approved yet,
 * so nothing is drawn: a missing scene renders nothing at all, never a grey
 * slab or a broken image.
 */
function RimEventArt(_: { kind: BriefingEventView['kind'] }) {
  return null;
}
