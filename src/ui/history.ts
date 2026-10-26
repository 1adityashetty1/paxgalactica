/**
 * The command line's history: up and down recall what was sent before, the way
 * a shell does. Pure, beside `logview.ts`, so it is tested without a DOM.
 *
 * A turned-back or refused order is the commonest thing a player wants to send
 * again with one word changed, and it had to be typed out whole.
 */

/** How many lines are kept. */
export const HISTORY_CAP = 50;

/** `history` with `line` sent last: a line sent twice running is kept once. */
export function remember(history: readonly string[], line: string): string[] {
  const text = line.trim();
  if (!text || history[history.length - 1] === text) return [...history];
  return [...history, text].slice(-HISTORY_CAP);
}

/**
 * Where an arrow key moves the recall. `pos` is the index of the line shown,
 * or null for the line being written. Up from the line being written shows the
 * last line sent and stops at the first; down past the last returns to the
 * line being written.
 */
export function step(history: readonly string[], pos: number | null, dir: 'up' | 'down'): number | null {
  if (history.length === 0) return null;
  if (dir === 'up') return pos === null ? history.length - 1 : Math.max(0, pos - 1);
  if (pos === null) return null;
  return pos + 1 >= history.length ? null : pos + 1;
}
