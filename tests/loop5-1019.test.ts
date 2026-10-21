import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the fifth loop of the advisor playtest (2026-10-19). */

let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { GameSession, whatCameOf } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');

beforeEach(() => {
  queue = {};
});

describe('what the counsellor is told came of its advice', () => {
  it('is what landed, not the band: a success whose work was refused came to nothing', () => {
    const out = whatCameOf({
      check: { outcome: 'success' },
      ops: [{ op: 'log_narrative' }],
      rejections: [{ message: 'meridian neither holds Ithaal nor has ships there' }],
    });
    expect(out).toBe('attempted; it came out a success, and nothing came of it (meridian neither holds Ithaal nor has ships there)');
    expect(whatCameOf({ check: { outcome: 'success' }, ops: [{ op: 'fortify' }] })).toBe('attempted; it came out a success');
  });

  it('includes what the talks it urged came to', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'talks-remembered');
    queue = {
      advisor: [{ counsel: 'Torrek is thin.', recommendation: 'Open talks with the Vigil about Torrek.' }],
      diplomacy: [{ reply: 'Move your fleet out of Torrek first.', concessions: [], retractions: [] }],
      extraction: [{ narrative: 'The Vigil refused any rate while the fleet stays at Torrek.', accepted: [], ops: [] }],
    };
    await session.advisor('What should we do?');
    await session.talk('vigil', 'What settles Torrek?');
    await session.endTalk('vigil');
    expect(session.snapshot()!.lastCounsel!.followed).toMatch(/^Talks with Iron Vigil Remnant then: The Vigil refused any rate/);
  });
});
