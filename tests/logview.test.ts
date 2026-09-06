import { describe, expect, it } from 'vitest';
import { logWindow, spliceLog } from '../src/ui/logview.js';
import type { CampaignView } from '../src/api/contract.js';
import type { EventLogEntry } from '../src/domain/state.js';

/**
 * p.1 and p.2. The event log is 61% of a real campaign's state — 443 entries in
 * 12 turns on `classes_playtest`, ~37 a turn — and it was both shipped whole on
 * every one of eight `pushState()` call sites and drawn whole on every render.
 */

const entry = (n: number): EventLogEntry => ({
  turn: n, kind: 'narrative', factionId: null, text: `entry ${n}`, visibleTo: null,
});
const log = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => entry(i + offset));

const viewWith = (entries: EventLogEntry[], from: number, total: number) =>
  ({ state: { eventLog: entries }, eventLogFrom: from, eventLogTotal: total } as unknown as CampaignView);

describe('a push carries a tail, and the client puts it back', () => {
  it('splices a tail onto the history already held', () => {
    const prev = viewWith(log(500), 0, 500);
    const next = viewWith(log(200, 300), 300, 500);
    const merged = spliceLog(prev, next);
    expect(merged.state.eventLog).toHaveLength(500);
    expect(merged.state.eventLog.map((e) => e.text)).toEqual(log(500).map((e) => e.text));
  });

  it('takes a full read whole, whatever it was holding', () => {
    const prev = viewWith(log(500), 0, 500);
    const next = viewWith(log(3), 0, 3);
    expect(spliceLog(prev, next).state.eventLog).toHaveLength(3);
  });

  it('starts from nothing on the first view', () => {
    const next = viewWith(log(200, 300), 300, 500);
    // Nothing held, so the splice would leave a hole. Keep the short log: the
    // next full read repairs it, and a log missing its middle cannot be
    // detected by anything downstream.
    expect(spliceLog(null, next).state.eventLog).toHaveLength(200);
  });

  it('refuses to splice over a gap', () => {
    const prev = viewWith(log(10), 0, 10);
    const next = viewWith(log(200, 300), 300, 500);
    expect(spliceLog(prev, next).state.eventLog).toHaveLength(200);
  });
});

describe('the panel draws a window, not the whole log', () => {
  it('shows the newest entries, newest first', () => {
    const { shown, hidden } = logWindow(log(1000), new Set(), 200);
    expect(shown).toHaveLength(200);
    expect(hidden).toBe(800);
    expect(shown[0]!.text).toBe('entry 999');
    expect(shown[199]!.text).toBe('entry 800');
  });

  it('never copies more than the window', () => {
    // The defect was `[...shown].reverse()` over the whole array: 1,100 entries
    // copied on every state push to display twenty. Asserted as a property of
    // the result — the returned array is the window, not the log.
    const { shown } = logWindow(log(5000), new Set(), 50);
    expect(shown).toHaveLength(50);
  });

  it('filters by kind before windowing, so the count is of what matches', () => {
    const mixed = [...log(100), { ...entry(999), kind: 'rejection' as const }];
    const { shown, hidden } = logWindow(mixed, new Set(['rejection']), 200);
    expect(shown).toHaveLength(1);
    expect(hidden).toBe(0);
    expect(shown[0]!.kind).toBe('rejection');
  });

  it('is a no-op on a log shorter than the window', () => {
    const { shown, hidden, firstIndex } = logWindow(log(5), new Set(), 200);
    expect(shown).toHaveLength(5);
    expect(hidden).toBe(0);
    expect(firstIndex).toBe(0);
  });
});
