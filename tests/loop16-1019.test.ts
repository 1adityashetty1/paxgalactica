import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the sixteenth loop of the advisor playtest (2026-10-19). */

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
const { resolveAction } = await import('../src/model/calls.js');
const { TreatySchema } = await import('../src/domain/diplomacy.js');

const CONTRACT = 'will not repudiate a contract it has signed, even a ruinous one; its whole value rests on that';
const ruledOnContract = {
  admissible: true, reason: '', stat: 'might', difficulty: 8, rationale: '',
  breach: { kind: 'red_line', principles: [CONTRACT], how: 'it abandons the ground', by: 'the Trade Council', reason: 'Our word holds.' },
};

beforeEach(() => {
  queue = {};
});

describe('a line that forbids only going back on paper', () => {
  it('cannot refuse an act of a power that holds no such paper', async () => {
    queue = { appraisal: [ruledOnContract], breach_relevance: [{ relevant: true, why: '' }], resolution: [{ narrative: 'The garrison lifts.', ops: [] }] };
    const out = await resolveAction(createSeedState('meridian'), 'Withdraw the garrison from Torrek Anchorage.');
    expect(out.output.refusal ?? null).toBeNull();
    expect(out.notes.join(' ')).toMatch(/names paper Meridian Trade Authority does not hold/);
  });

  it('still refuses when the power holds a treaty it could break', async () => {
    const s = createSeedState('meridian');
    s.treaties.push(TreatySchema.parse({ id: 'tre-0-9', type: 'trade_accord', parties: ['meridian', 'vigil'], signedTurn: 0, expiresTurn: null, terms: {}, status: 'active' }));
    queue = { appraisal: [ruledOnContract], breach_relevance: [{ relevant: true, why: '' }] };
    const out = await resolveAction(s, 'Tear up the Vigil accord.');
    expect(out.output.refusal?.violated).toBe(CONTRACT);
  });
});
