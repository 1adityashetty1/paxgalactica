import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the twenty-first loop of the advisor playtest (2026-10-19). */

const kinds: string[] = [];
let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    kinds.push(call.kind);
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { resolveAction, standingOrder } = await import('../src/model/calls.js');
const { DeclaredRulingSchema, rulingToAppraisal } = await import('../src/domain/ops.js');

beforeEach(() => {
  kinds.length = 0;
  queue = {};
});

describe('an order to go on as things are', () => {
  it('reads as one, and an order to act does not', () => {
    expect(standingOrder('Do not move against the Vigil this turn.')).toBe(true);
    expect(standingOrder('Hold Torrek Anchorage.')).toBe(true);
    expect(standingOrder('Move the fleet to Corvid.')).toBe(false);
  });

  it('is already so whatever record the arbiter cited, and costs nothing', async () => {
    const ruling = rulingToAppraisal(
      DeclaredRulingSchema.parse({ kind: 'inadmissible', ground: { kind: 'already_so', ref: 'no_hostilities_declared' }, reason: 'Nothing to declare.' }),
    );
    queue = { appraisal: [ruling] };
    const out = await resolveAction(createSeedState('meridian'), 'Do not move against the Vigil this turn.');
    expect(out.output.inadmissible).toBeTruthy();
    expect(out.check).toBeNull();
    expect(kinds).toEqual(['appraisal']);
  });
});
