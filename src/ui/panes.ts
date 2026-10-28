/**
 * The sizes the player has dragged the screen's panes to: the side column's
 * width, the map's height, and the briefing's height. Pure, beside
 * `history.ts`, so the limits are tested without a DOM.
 *
 * A size that is null is the stylesheet's own, so a player who never drags sees
 * the layout exactly as it was.
 */

export type Pane = 'side' | 'stage' | 'briefing';

export type PaneSizes = Record<Pane, number | null>;

export const NO_SIZES: PaneSizes = { side: null, stage: null, briefing: null };

/** The CSS custom property each pane reads, with the stylesheet's fallback beside it. */
export const PANE_VAR: Record<Pane, string> = {
  side: '--side-width',
  stage: '--stage-height',
  briefing: '--briefing-height',
};

/**
 * What each pane may be dragged to, in pixels, for a window of this size. The
 * map leaves room under it for the feed and the command line, and the side
 * column never takes the map's column away.
 */
export function paneBounds(pane: Pane, viewport: { width: number; height: number }): { min: number; max: number } {
  switch (pane) {
    case 'side':
      return { min: 260, max: Math.max(260, Math.round(viewport.width * 0.7)) };
    case 'stage':
      return { min: 120, max: Math.max(120, viewport.height - 220) };
    case 'briefing':
      return { min: 60, max: Math.max(60, Math.round(viewport.height * 0.8)) };
  }
}

export function clampPane(pane: Pane, px: number, viewport: { width: number; height: number }): number {
  const { min, max } = paneBounds(pane, viewport);
  return Math.round(Math.min(max, Math.max(min, px)));
}

/**
 * The size a drag leaves a pane at. The side column sits to the right of its
 * handle, so dragging the handle right makes it narrower; the map and the
 * briefing sit above theirs, so dragging down makes them taller.
 */
export function dragged(pane: Pane, start: number, delta: { x: number; y: number }, viewport: { width: number; height: number }): number {
  const raw = pane === 'side' ? start - delta.x : start + delta.y;
  return clampPane(pane, raw, viewport);
}

/** Sizes as stored, read back leniently: anything that is not a positive number is the default. */
export function readPanes(raw: string | null): PaneSizes {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    const one = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    return { side: one(parsed.side), stage: one(parsed.stage), briefing: one(parsed.briefing) };
  } catch {
    return { ...NO_SIZES };
  }
}

/** The custom properties to set for these sizes: only the ones the player has dragged. */
export function paneStyle(sizes: PaneSizes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pane of Object.keys(PANE_VAR) as Pane[]) {
    const px = sizes[pane];
    if (px !== null) out[PANE_VAR[pane]] = `${px}px`;
  }
  return out;
}
