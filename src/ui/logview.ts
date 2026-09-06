import type { CampaignView } from '../api/contract.js';
import type { EventLogEntry } from '../domain/state.js';

/**
 * The event log is the largest thing in a campaign and the two cheapest wins
 * are both here: don't send it all, and don't draw it all.
 *
 * Measured on the real `classes_playtest` save — 443 entries in 12 turns, ~37 a
 * turn, 89KB of a 146KB state, so **61% of the world is history**. `pushState()`
 * has eight call sites and fires several times a turn.
 *
 * Pure and beside `layout.ts` and `portrait.ts` for the same reason those are:
 * there is no DOM in the suite, so logic that lives inside a component is logic
 * nothing checks.
 */

/**
 * Put a pushed tail back onto the history the client already holds.
 *
 * The cursor is an index because the visible log is **append-only and
 * order-stable**: `visibleTo` is fixed per entry, so entry `i` is always the
 * same entry and a splice at `eventLogFrom` is exact. No sequence number and no
 * schema change.
 *
 * A client holding fewer entries than the tail starts at would be spliced into
 * a history missing its middle, so that case keeps the shorter authoritative
 * log and lets the next full read repair it. A log with a hole in it is worse
 * than a short one, because nothing downstream can tell.
 */
export function spliceLog(prev: CampaignView | null, next: CampaignView): CampaignView {
  const from = next.eventLogFrom;
  if (from === 0) return next;
  const held = prev?.state.eventLog ?? [];
  if (held.length < from) return next;
  return {
    ...next,
    state: { ...next.state, eventLog: [...held.slice(0, from), ...next.state.eventLog] },
  };
}

/** What the log panel actually draws: newest first, bounded, plus what is left. */
export interface LogWindow {
  shown: EventLogEntry[];
  hidden: number;
  /** Index of `shown[0]` in the filtered log, so a stable React key can be derived. */
  firstIndex: number;
}

/**
 * Filter by kind, take the newest `limit`, reverse.
 *
 * Slicing BEFORE reversing is the point. The panel used to do
 * `[...shown].reverse()` over the whole log on every render, which copies every
 * entry to display twenty of them — ~1,100 at turn 30, twice that at 60, on
 * every state push.
 */
export function logWindow(
  entries: readonly EventLogEntry[],
  kinds: ReadonlySet<string>,
  limit: number,
): LogWindow {
  const matching = kinds.size === 0 ? entries : entries.filter((e) => kinds.has(e.kind));
  const start = Math.max(0, matching.length - Math.max(0, limit));
  return {
    shown: matching.slice(start).reverse(),
    hidden: start,
    firstIndex: start,
  };
}
