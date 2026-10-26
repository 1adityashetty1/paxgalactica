import { describe, expect, it } from 'vitest';
import { digestLog, logReader, spliceLog, weighEntry } from '../src/ui/logview.js';
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
  const reader = { playerFactionId: 'meridian', names: ['Meridian Trade Authority', 'Sekkar Gate'] };
  const window = (entries: EventLogEntry[], limit: number, kinds = new Set<string>()) =>
    digestLog(entries, reader, { kinds, importantOnly: false, limit });
  const flat = (d: ReturnType<typeof window>) => d.turns.flatMap((t) => t.entries.map((e) => e.entry));

  it('shows the newest entries, newest first, grouped by turn', () => {
    const d = window(log(1000), 200);
    expect(flat(d)).toHaveLength(200);
    expect(d.hidden).toBe(800);
    expect(flat(d)[0]!.text).toBe('entry 999');
    expect(flat(d)[199]!.text).toBe('entry 800');
    expect(d.turns[0]!.turn).toBe(999);
  });

  it('filters by kind before windowing, so the count is of what matches', () => {
    const mixed = [...log(100), { ...entry(999), kind: 'rejection' as const }];
    const d = window(mixed, 200, new Set(['rejection']));
    expect(flat(d)).toHaveLength(1);
    expect(d.hidden).toBe(0);
  });
});

describe('what matters is shown first', () => {
  // Lines the engine wrote in a played campaign (loop18), as the player Meridian.
  const reader = { playerFactionId: 'meridian', names: ['Meridian Trade Authority', 'Sekkar Gate', 'Sennex', 'Brannix'] };
  const at = (turn: number, kind: EventLogEntry['kind'], text: string): EventLogEntry => ({ turn, kind, factionId: null, text, visibleTo: null });
  const lines = [
    at(1, 'system', 'Iron Vigil Remnant lays down 8 hull(s), begins university at Vantic at Vantic.'),
    at(1, 'system', 'Iron Vigil Remnant sends 4 battleships, 1 escort, 2 lifters, 1 listener from Vantic against Threx.'),
    at(4, 'order', 'Meridian Trade Authority and Arkane Free Worlds storms Sennex, breaking a garrison of 4 for 1 lifters; Meridian Trade Authority takes possession with 4 troops ashore.'),
    at(5, 'system', 'Sennex rises against Meridian Trade Authority: its last troops desert, and Sennex answers to nobody.'),
    at(5, 'order', 'Meridian Trade Authority moves 3 escorts from Corvid to Torrek Anchorage.'),
    at(5, 'rejection', '[no_presence] meridian neither holds Ithaal nor has ships there.'),
    at(6, 'rim', 'A border incident near Brannix: Meridian Trade Authority and Ojjul Nar Combine ships trade fire nobody ordered.'),
    at(6, 'rim', 'A shortage of salvage runs through the Rim: buyers will pay 50% more for it for 3 turns.'),
    at(6, 'system', 'Turn 6: 470 credits from 4 systems, 154 to upkeep.'),
  ];

  it('weighs a line by what it is and whose', () => {
    expect(lines.map((l) => weighEntry(l, reader))).toEqual([
      'routine', 'notable', 'attention', 'attention', 'routine', 'routine', 'attention', 'notable', 'routine',
    ]);
  });

  it('puts what needs the player at the top, from the last turns only, newest first', () => {
    const d = digestLog(lines, reader, { kinds: new Set(), importantOnly: true, limit: 200, recentTurns: 2 });
    expect(d.attention.map((e) => e.turn)).toEqual([6, 5, 4]);
    // Routine lines are left out of the turns, and nothing is invented.
    expect(d.turns.flatMap((t) => t.entries).every((e) => e.weight !== 'routine')).toBe(true);
    expect(d.turns.map((t) => t.turn)).toEqual([6, 5, 4, 1]);
  });

  it('reads the player and their worlds off the served world', () => {
    expect(
      logReader({
        playerFactionId: 'meridian',
        factions: [{ id: 'meridian', name: 'Meridian Trade Authority' }],
        systems: [
          { name: 'Sekkar Gate', controllerFactionId: 'meridian', homeFactionId: 'meridian' },
          { name: 'Sennex', controllerFactionId: null, homeFactionId: null },
          { name: 'Corvid', controllerFactionId: 'vigil', homeFactionId: 'meridian' },
        ],
      }).names,
    ).toEqual(['Meridian Trade Authority', 'Sekkar Gate', 'Corvid']);
  });
});
