import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three found by the playtest of 2026-11-17 (bughunt13, the Iron Vigil):
 * a deal that landed without the leader's own side, an envoy rolled at a world
 * no envoy can go to, and a recruitment off the Lists failed on a natural 1.
 */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { rollD20 } = await import('../src/domain/checks.js');
const { Campaign, MemoryCampaignStore } = await import('../src/engine/campaign.js');
const { closeChannel, leaderGivesOutsideRecord } = await import('../src/engine/turn.js');
const { resolveAction, takesOffTheLists } = await import('../src/model/calls.js');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

const none = { assets: [], pays: 0, cedes: [], lifts: [], obligations: [] };

describe('the leader’s side of a deal the record left out', () => {
  const s = createSeedState('vigil');
  const drawings = s.assets.find((a) => a.heldBy === 'vigil' && a.portable !== false)!;

  it('is built from what the leader holds, and only that', () => {
    const out = leaderGivesOutsideRecord(s, { ...none, assets: [drawings.id, 'ast-9-9'] }, 'vigil', 'meridian', [], true);
    expect(out.ops).toEqual([expect.objectContaining({ op: 'transfer_asset', assetId: drawings.id, toFactionId: 'meridian' })]);
    expect(out.notes.some((n) => n.includes('"ast-9-9" is not a thing'))).toBe(true);
  });

  it('is never given for nothing: without the other side on the record, nothing of the leader’s moves', () => {
    const out = leaderGivesOutsideRecord(s, { ...none, assets: [drawings.id], pays: 300 }, 'vigil', 'meridian', [], false);
    expect(out.ops).toEqual([]);
    expect(out.notes[0]).toMatch(/not given for nothing/);
  });

  it('moves nothing twice: a thing already handed over, money already paid', () => {
    const built = [
      { op: 'transfer_asset', assetId: drawings.id, toFactionId: 'meridian' },
      { op: 'pay', factionId: 'vigil', to: 'meridian', amount: 100 },
    ];
    expect(leaderGivesOutsideRecord(s, { ...none, assets: [drawings.id], pays: 100 }, 'vigil', 'meridian', built, true).ops).toEqual([]);
  });

  it('cedes only a world the leader holds, and lifts only a toll it charges', () => {
    const mine = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const theirs = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    const out = leaderGivesOutsideRecord(s, { ...none, cedes: [mine.id, theirs.id], lifts: ['meridian'] }, 'vigil', 'meridian', [], true);
    expect(out.ops.filter((o) => o.op === 'form_treaty')).toEqual([expect.objectContaining({ treatyType: 'cession', terms: { territory: [mine.id] } })]);
    expect(out.notes.some((n) => n.includes(`"${theirs.id}" is not a world`))).toBe(true);
  });

  it('lands with the accord when the other power’s side does', async () => {
    const campaign = Campaign.start('vigil', 'pt1117-gives', new MemoryCampaignStore());
    queue = {
      extraction: [
        {
          narrative: 'The Vigil returns the drawings; the two sign a non-aggression pact.',
          accepted: [],
          leaderGives: { ...none, assets: [drawings.id] },
          ops: [{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['vigil', 'meridian'], terms: {}, durationTurns: 10, summary: 'peace' }],
        },
      ],
      appraisal: [{ admissible: true, reason: '', stat: 'influence', difficulty: 10, rationale: '' }],
    };
    const said = [
      { speaker: 'player' as const, text: 'We hand the drawings back and sign a non-aggression pact.' },
      { speaker: 'faction' as const, text: 'Agreed.' },
    ];
    await closeChannel(campaign, 'meridian', said, []);
    expect(campaign.state.assets.find((a) => a.id === drawings.id)?.heldBy).toBe('meridian');
  });
});

describe('an envoy goes only where an envoy can', () => {
  it('is turned away before the roll at a world another power holds', async () => {
    const s = createSeedState('vigil');
    queue = { appraisal: [{ admissible: true, reason: '', stat: 'influence', difficulty: 14, rationale: '' }] };
    const out = await resolveAction(s, 'Send an envoy to Tulgarn to court it.');
    expect(out.output.inadmissible).toMatch(/Tulgarn answers to another power/);
    expect(out.check).toBeNull();
    expect(calls.map((c) => c.kind)).toEqual(['appraisal']);
  });
});

describe('taking your own people off your Lists', () => {
  const action = 'Recruit a ghost off our Lists at Kalzir.';

  it('is read off the words, and only for a recruitment, an appointment or a seating', () => {
    expect(takesOffTheLists(action)).toBe(true);
    expect(takesOffTheLists('Appoint a new officer off the Lists.')).toBe(true);
    expect(takesOffTheLists('Recruit troops at Kalzir.')).toBe(false);
    expect(takesOffTheLists('Lay down four escorts at Vantic.')).toBe(false);
  });

  it('cannot fail, even on a natural 1, and the roll is kept', async () => {
    const s = createSeedState('vigil');
    let salt = 0;
    while (rollD20(s.turn, `${salt}:${action}`) !== 1) salt++;
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'industry', difficulty: 5, rationale: '' }],
      resolution: [{ narrative: 'Servius Flaccus comes onto the books.', ops: [] }],
    };
    const out = await resolveAction(s, action, String(salt));
    expect(out.roll).toBe(1);
    expect(out.check?.outcome).toBe('success');
  });
});
