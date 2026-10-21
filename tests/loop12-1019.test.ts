import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the twelfth loop of the advisor playtest (2026-10-19). */

const calls: string[] = [];
let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    calls.push(call.kind);
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { resolveAction } = await import('../src/model/calls.js');
const { DeclaredRulingSchema, rulingToAppraisal } = await import('../src/domain/ops.js');

const ruling = (buildsAt: string[]) =>
  rulingToAppraisal(DeclaredRulingSchema.parse({ kind: 'act', parts: [{ kind: 'overt', what: 'fortify', stat: 'industry', difficulty: 12, buildsAt }] }));

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('works on a world the power has nothing at', () => {
  it('are turned away before the roll, so a failure cannot cost anything', async () => {
    queue = { appraisal: [ruling(['sek-3'])] };
    const out = await resolveAction(createSeedState('meridian'), 'Fortify Ithaal.');
    expect(out.output.inadmissible).toMatch(/Nothing of yours stands at Ithaal to build on/);
    expect(out.check).toBeNull();
    expect(calls).toEqual(['appraisal']);
  });

  it('go ahead on a world the power holds', async () => {
    queue = { appraisal: [ruling(['tor-1'])], resolution: [{ narrative: 'Walls rise.', ops: [] }] };
    const out = await resolveAction(createSeedState('meridian'), 'Fortify Torrek Anchorage.');
    expect(out.output.inadmissible ?? null).toBeNull();
    expect(out.check).not.toBeNull();
  });
});
