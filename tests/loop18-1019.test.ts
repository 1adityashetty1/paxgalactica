import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the eighteenth loop of the advisor playtest (2026-10-19). */

const users: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    users.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { Campaign } = await import('../src/engine/campaign.js');
const { submitAction } = await import('../src/engine/turn.js');

beforeEach(() => {
  users.length = 0;
  queue = {};
});

describe('a story that takes a world the power does not hold', () => {
  it('is rewritten with who holds it', async () => {
    const campaign = Campaign.start('meridian', 'holder');
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'resolve', difficulty: 8, rationale: '' }],
      resolution: [{ narrative: "Sorel's dash on Threx lands home: the Vigil banners come down over Threx.", ops: [] }],
      reconcile: [{ narrative: 'The line holds at Torrek Anchorage; Threx is still the Vigil’s.' }],
    };
    const out = await submitAction(campaign, 'Hold Threx when Sorel takes it.');
    const rewrite = users.find((u) => u.kind === 'reconcile');
    expect(rewrite?.user).toMatch(/HOLDER: Threx is held by Drajk Confederacy, not by you; nothing in this act took it/);
    expect(out.narrative).toMatch(/still the Vigil/);
  });

  it('is not read into a world named beside a taking about something else (bughunt 2026-10-28)', async () => {
    const campaign = Campaign.start('meridian', 'holder-near');
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'resolve', difficulty: 8, rationale: '' }],
      resolution: [{ narrative: 'Meridian settles its Shalka refit account and keeps a fifth of every prize it takes.', ops: [] }],
    };
    const out = await submitAction(campaign, 'Settle the Shalka refit account.');
    expect(users.some((u) => u.kind === 'reconcile')).toBe(false);
    expect(out.narrative).not.toMatch(/Not as told/);
  });
});
