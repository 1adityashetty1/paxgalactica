import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the nineteenth loop of the advisor playtest (2026-10-19). */

let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { handedTo, resolveAction } = await import('../src/model/calls.js');
const { DeclaredRulingSchema, rulingToAppraisal } = await import('../src/domain/ops.js');

beforeEach(() => {
  queue = {};
});

describe('handing a world to a named power', () => {
  it('reads who it is handed to, and nobody for a move between own worlds', () => {
    const s = createSeedState('meridian');
    expect(handedTo(s, 'Cede Torrek Anchorage to the Vigil and redeploy the garrison.')).toBe('vigil');
    expect(handedTo(s, 'Sell the plate to the Combine.')).toBe('ojjul');
    expect(handedTo(s, 'Move the fleet to Corvid.')).toBeNull();
  });

  it('is redirected as a negotiation when the arbiter found nothing the power could do alone', async () => {
    const ruling = rulingToAppraisal(DeclaredRulingSchema.parse({ kind: 'act', parts: [{ kind: 'unexpressed', outcome: 'the debt binds you' }] }));
    queue = { appraisal: [ruling] };
    const out = await resolveAction(createSeedState('meridian'), 'Cede Torrek Anchorage to the Vigil.');
    expect(out.output.negotiation).toMatchObject({ withFactionIds: ['vigil'], channels: '/talk vigil' });
    expect(out.output.inadmissible ?? null).toBeNull();
  });
});
