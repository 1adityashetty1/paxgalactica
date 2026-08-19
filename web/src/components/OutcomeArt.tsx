import { useState } from 'react';

/**
 * The three ways a declaration produces no ordinary result, as a picture.
 *
 * These are the outcomes the engine already reports as *typed fields* on
 * `ActionOutcome` — `refusal`, `defiance`, `negotiation` — so nothing about the
 * schema, the reducer or the contract had to move to draw them. All three fire
 * on both paths a declaration can take (a declared action, and an accord closed
 * with `/endtalk`), which is why this is one component read from the feed
 * rather than three branches in two callers.
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
export type OutcomeArtKind = 'refusal' | 'defiance' | 'negotiation';

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
