import { useState } from 'react';
import { ansi256ToHex } from '../color.js';
import type { Faction } from '../../../src/domain/state.js';

/**
 * A faction's face, small, ringed in its colour.
 *
 * The five powers were distinguished in the panel by a colour chip and a name,
 * and their portraits were only ever seen at the moment of negotiation — so the
 * face you met in a channel was a stranger. Showing it here is what makes the
 * channel portrait a recognition rather than an introduction.
 *
 * ## Why there is a table
 *
 * The first version used one focal point for all five, on the reasoning that
 * the set was generated to a single framing brief. That was close but not true:
 * the Vigil, the Combine and Drajk all sit two or three percent right of centre,
 * which the 3x zoom multiplies into a visibly off-centre head — their faces
 * showed against the right edge of the circle while Meridian's and Arkanis's
 * looked right. Art is not that obedient, and a table of five entries is a
 * smaller price than a crop that is wrong for three of them.
 */

/** Where the head actually is, as a fraction of the image. Measured, not guessed. */
const FOCUS: Record<string, { x: number; y: number }> = {
  meridian: { x: 0.5, y: 0.27 },
  vigil: { x: 0.527, y: 0.26 },
  hutt: { x: 0.532, y: 0.28 },
  freeworlds: { x: 0.495, y: 0.27 },
  krayt: { x: 0.527, y: 0.29 },
};
const DEFAULT_FOCUS = { x: 0.5, y: 0.27 };

/**
 * Show about a third of the image width, so the head fills the box rather than
 * the whole scene shrinking into it.
 */
const ZOOM = 3;
/** The art is 1100x614, and the offsets below need its shape. */
const ASPECT = 614 / 1100;

export function FactionAvatar({ faction, size = 26 }: { faction: Faction; size?: number }) {
  const [failed, setFailed] = useState(false);
  const colour = ansi256ToHex(faction.displayColor);

  if (failed) {
    // A faction row must never render as a hole.
    return <span className="swatch" style={{ background: colour }} />;
  }

  // Land the focal point in the middle of the box: the image is ZOOM boxes
  // wide and ZOOM*ASPECT tall, so a point at fraction f sits at ZOOM*f from
  // the image's edge, and the offset is whatever puts that at the halfway mark.
  const focus = FOCUS[faction.id] ?? DEFAULT_FOCUS;
  const left = 50 - ZOOM * 100 * focus.x;
  const top = 50 - ZOOM * ASPECT * 100 * focus.y;

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, borderColor: colour }}
      title={faction.name}
    >
      <img
        src={`/portraits/${faction.id}.jpeg`}
        alt=""
        style={{ width: `${ZOOM * 100}%`, left: `${left}%`, top: `${top}%` }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
