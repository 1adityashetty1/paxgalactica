import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the thirteenth loop of the advisor playtest (2026-10-19). */

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
const { DeclaredRulingSchema, rulingToAppraisal } = await import('../src/domain/ops.js');
const { noPaymentBesideAGift } = await import('../src/domain/refusals.js');

beforeEach(() => {
  queue = {};
});

describe('an envoy with an offer of development', () => {
  it('is not turned away for having nothing to build on', async () => {
    const ruling = rulingToAppraisal(
      DeclaredRulingSchema.parse({ kind: 'act', parts: [{ kind: 'overt', what: 'envoy', stat: 'influence', difficulty: 12, buildsAt: ['sek-3'] }] }),
    );
    queue = { appraisal: [ruling], resolution: [{ narrative: 'The envoy sets out.', ops: [] }] };
    const out = await resolveAction(createSeedState('meridian'), 'Send an envoy to Ithaal offering development.');
    expect(out.output.inadmissible ?? null).toBeNull();
    expect(out.check).not.toBeNull();
  });
});

describe('a debt paid in goods', () => {
  it('keeps the handover as a gift and leaves out the cash paid beside it', () => {
    const s = createSeedState('meridian');
    const debt = s.debts.find((d) => d.debtorFactionId === 'meridian')!;
    const give = { op: 'transfer_asset', assetId: 'ast-0-0', toFactionId: debt.creditorFactionId };
    const pay = { op: 'settle_debt', debtId: debt.id, amount: 50 };
    expect(noPaymentBesideAGift([give, pay], s.debts)).toEqual({ ops: [give], dropped: true });
    expect(noPaymentBesideAGift([pay], s.debts)).toEqual({ ops: [pay], dropped: false });
  });
});
