import { useMemo, useState } from 'react';
import {
  OUTCOME_ART_KINDS,
  OUTCOME_H,
  OUTCOME_W,
  outcomeRuns,
  type OutcomeArtKind as DrawnKind,
} from '../../../src/ui/outcomeart.js';

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
 * ## Two of them are drawn, and one is still a file
 *
 * `refusal` and `defiance` were painterly 16:9 renders and were replaced for
 * two separate reasons. They sat in a contemporary corporate register — an
 * office worker holding a page stamped VETO, a television news desk reading
 * APPROVAL NUMBERS CRASH — against a game whose whole visual language is pixel
 * sprites and SVG glyphs. And the second was about the wrong thing entirely:
 * `defiance` is a leader overruling their own institutions and being charged
 * for it, not a collapse in polling.
 *
 * They are now **one door in two states**, which is the argument for drawing
 * them together at all: `classifyPrinciple` decides between them by reading
 * which list the quoted line is on, and the difference a player feels is that
 * one stops the order and the other prices it. Same arch, shut and whole, then
 * shut and broken through — so recognising the second is free once the first
 * has been seen.
 *
 * `negotiation` keeps its illustration, because it is not part of that pair. It
 * is not a breach of anything; it is being told the thing needs another power's
 * signature, and there is no second state of the door that says so.
 *
 * The geometry lives in `src/ui/outcomeart.ts`, pure and tested, the same split
 * `WorldSprite` and `layout.ts` use — the component does no work worth
 * checking. `shapeRendering: crispEdges` is what keeps it pixel art at any
 * size: without it the browser antialiases every rect and a 64px scene blown up
 * to 320 is a smudge.
 *
 * **Anything with neither a scene nor a file renders nothing at all**, which is
 * the rule the file-backed version needed and this one keeps. The caller has
 * already said in words what happened and why, so falling back means falling
 * back to exactly the treatment that existed before there was any art — not a
 * grey slab, and not a broken-image glyph.
 */
export type OutcomeArtKind =
  | 'refusal'
  | 'defiance'
  | 'negotiation'
  | 'inadmissible'
  | 'out-of-actions';

const DRAWN = new Set<string>(OUTCOME_ART_KINDS);
/** Kinds still served from `web/public/events`. */
const FILED = new Set<string>(['negotiation']);

export function OutcomeArt({ kind, alt }: { kind: OutcomeArtKind; alt: string }) {
  const runs = useMemo(
    () => (DRAWN.has(kind) ? outcomeRuns(kind as DrawnKind) : null),
    [kind],
  );
  const [failed, setFailed] = useState(false);

  if (runs) {
    return (
      <svg
        className={`outcome-art ${kind}`}
        viewBox={`0 0 ${OUTCOME_W} ${OUTCOME_H}`}
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="crispEdges"
        role="img"
        /* The breached line rides in the label so the picture is never the only
           carrier of what was crossed — it is a scene, not a caption, and a
           reader who cannot see it loses nothing that matters. */
        aria-label={alt}
      >
        {runs.map((r) => (
          <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.colour} />
        ))}
      </svg>
    );
  }

  if (!FILED.has(kind) || failed) return null;
  return (
    <img
      className={`outcome-art ${kind}`}
      src={`/events/${kind}.jpeg`}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
