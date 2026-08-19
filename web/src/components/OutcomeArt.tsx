import { useState } from 'react';

/**
 * The five ways a declaration produces no ordinary result, as a picture.
 *
 * The five outcomes the engine reports as *typed fields* on `ActionOutcome`:
 * `refusal`, `defiance` and `negotiation` fire on both paths a declaration can
 * take (a declared action, and an accord closed with `/endtalk`), which is why
 * this is one component read from the feed rather than branches in two callers.
 * `inadmissible` and `out-of-actions` are declared-action only — there is no
 * admissibility ruling on an accord, and diplomacy is unmetered.
 *
 * Deliberately NOT on the list: the five check bands. Every rolled action
 * produces one, so imagery there becomes wallpaper and stops meaning anything.
 * These five are the ways an action produces *nothing*, which is the thing
 * worth marking.
 *
 * **In the feed, not on the stage.** A channel is a *mode* and earns the whole
 * stage the map sits in; an outcome is a beat. Taking the map away for one
 * would overstate it, and the beat is over by the next line anyway.
 *
 * **A missing file renders nothing at all.** Same rule as `FactionAvatar` and
 * `PortraitStage`, with an easier answer than either: the caller has already
 * said in words what happened and why, so falling back means falling back to
 * exactly the treatment that existed before there was any art — not a grey
 * slab, and not a broken-image glyph, which is what an unguarded `<img>` leaves
 * behind for anyone who has not built the assets.
 */
export type OutcomeArtKind =
  | 'refusal'
  | 'defiance'
  | 'negotiation'
  | 'inadmissible'
  | 'out-of-actions';

export function OutcomeArt({ kind, alt }: { kind: OutcomeArtKind; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className={`outcome-art ${kind}`}
      src={`/events/${kind}.jpeg`}
      /* The breached line rides in the alt text so the image is never the only
         carrier of what was crossed — it is a scene, not a caption, and a
         reader who cannot see it loses nothing that matters. */
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
