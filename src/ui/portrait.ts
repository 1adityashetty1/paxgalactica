/**
 * Where to put a faction portrait inside a small round avatar.
 *
 * Pure geometry, like `layout.ts` beside it: no DOM, no React, so the invariant
 * that actually broke can be asserted in the test suite rather than noticed on
 * screen. The component does nothing but apply what this returns.
 *
 * ## The two things this gets right, having got both wrong first
 *
 * **A focal point per faction.** The first version used one for all five, on
 * the reasoning that the set was generated to a single framing brief. Close, but
 * not true: the Vigil, the Combine and Drajk sit two or three percent right of
 * centre, and the zoom multiplies that into a head visibly against the right
 * edge of the circle. Meridian and Arkane are centred, which is exactly why the
 * assumption survived the first look.
 *
 * **Coverage.** Centring a face and covering a box are different requirements,
 * and the offset that does the first will happily fail the second: at 3x zoom
 * the art is only 1.67 boxes tall, so a head a quarter down wanted a *positive*
 * top offset, which pushed the picture below the top of the circle and left a
 * bar of panel background across it. The zoom is now large enough that the focal
 * points are reachable, and the offsets are clamped so the image can never
 * uncover the box whatever focal point is handed in.
 */

/**
 * Where the head sits and how big it is, measured from each piece of art.
 *
 * `zoom` is per-faction because the portraits are not shot at the same
 * distance: the Iron Vigil's is a closer composition, his head spanning about
 * 44% of the image height where the rest run 26–39%. At a shared zoom his face
 * filled visibly more of the circle than anyone else's — a difference a focal
 * point cannot fix, because it is a matter of scale rather than position. Only
 * the factions that need one carry an override.
 */
export const PORTRAIT_FOCUS: Record<string, { x: number; y: number; zoom?: number }> = {
  meridian: { x: 0.5, y: 0.27 },
  // Closer framing than the rest, so pulled back to match their head size.
  vigil: { x: 0.527, y: 0.285, zoom: 2.9 },
  ojjul: { x: 0.532, y: 0.28 },
  freeworlds: { x: 0.495, y: 0.27 },
  drajk: { x: 0.527, y: 0.29 },
};

/** Used for a faction with no measured focal point — a centred head, roughly. */
export const DEFAULT_FOCUS: { x: number; y: number; zoom?: number } = { x: 0.5, y: 0.27 };

/**
 * How many boxes wide the image is drawn, unless the faction overrides it.
 * Big enough that the head fills the frame, and big enough that the focal
 * points above are reachable rather than being clamped away by coverage.
 */
export const PORTRAIT_ZOOM = 3.4;

/** The art is 1100x614; the vertical offsets need its shape. */
export const PORTRAIT_ASPECT = 614 / 1100;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface PortraitCrop {
  /** Percentages, applied to an absolutely positioned image in a square box. */
  width: number;
  height: number;
  left: number;
  top: number;
}

export function portraitCrop(factionId: string): PortraitCrop {
  const focus = PORTRAIT_FOCUS[factionId] ?? DEFAULT_FOCUS;
  const zoom = focus.zoom ?? PORTRAIT_ZOOM;
  const width = zoom * 100;
  const height = zoom * PORTRAIT_ASPECT * 100;
  return {
    width,
    height,
    // The image spans [offset, offset + size], so covering [0, 100] means the
    // offset has to sit in [100 - size, 0]. Centring the focal point is the
    // preference; covering the box is the rule.
    left: clamp(50 - width * focus.x, 100 - width, 0),
    top: clamp(50 - height * focus.y, 100 - height, 0),
  };
}
