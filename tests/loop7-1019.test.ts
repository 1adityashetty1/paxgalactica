import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the seventh loop of the advisor playtest (2026-10-19). */

let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { Campaign } = await import('../src/engine/campaign.js');
const { submitAction } = await import('../src/engine/turn.js');
const { createSeedState } = await import('../src/seed/scenario.js');
const { paperOf } = await import('../src/domain/pressures.js');

beforeEach(() => {
  queue = {};
});

describe('work on a world the power has nothing at', () => {
  it('is withdrawn and costs no action, however it rolled', async () => {
    const campaign = Campaign.start('meridian', 'nowhere');
    const fortify = { op: 'fortify', factionId: 'meridian', systemId: 'sek-3', magnitude: 3 };
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'industry', difficulty: 5, rationale: '' }],
      resolution: [
        { narrative: 'Walls rise at Ithaal.', ops: [fortify] },
        { narrative: 'The plans stay plans.', ops: [] },
      ],
    };
    const before = campaign.actionPointsLeft;
    const out = await submitAction(campaign, 'Fortify Ithaal.');
    expect(out.inadmissible).toMatch(/Nothing of yours stands there to build on/);
    expect(campaign.actionPointsLeft).toBe(before);
    expect(campaign.stagedCount).toBe(0);
  });
});

describe('the counsellor’s paper', () => {
  it('gives every unaligned world’s standing with the power, and says nobody appoints to them', () => {
    const paper = paperOf(createSeedState('meridian'), 'meridian').join('\n');
    expect(paper).toMatch(/Worlds that answer to nobody \(one joins a power at 60 standing, 20 clear of the next; nobody appoints to them\): .*Ithaal -?\d+ with you/);
  });
});
