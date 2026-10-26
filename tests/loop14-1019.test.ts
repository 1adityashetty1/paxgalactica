import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the fourteenth loop of the advisor playtest (2026-10-19). */

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
const { resolveAction } = await import('../src/model/calls.js');
const { DeclaredRulingSchema, rulingToAppraisal } = await import('../src/domain/ops.js');

beforeEach(() => {
  queue = {};
});

describe('an act with talks beside it', () => {
  it('stages the act and notes the talks, rather than throwing the act away', async () => {
    const campaign = Campaign.start('meridian', 'side-talks');
    const move = { op: 'move', factionId: 'meridian', originId: 'sek-4', targetId: 'sek-5', force: { escort: 2 } };
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'might', difficulty: 8, rationale: '' }],
      resolution: [
        {
          narrative: 'Two escorts settle over Var Hollow.',
          ops: [move],
          negotiation: { withFactionIds: ['ojjul'], what: 'the note for credit', supported: true, channels: '/talk ojjul' },
        },
      ],
    };
    const out = await submitAction(campaign, 'Send two escorts to Var Hollow, and offer the Combine our note.');
    expect(out.negotiation ?? null).toBeNull();
    expect(out.ops.some((o) => (o as { op?: string }).op === 'move')).toBe(true);
    expect(out.notes.join(' ')).toMatch(/The rest needs ojjul to agree — open a channel: \/talk ojjul/);
  });
});

describe('a landing', () => {
  it('is not turned away for naming the world it sails for', async () => {
    const ruling = rulingToAppraisal(
      DeclaredRulingSchema.parse({ kind: 'act', parts: [{ kind: 'overt', what: 'land at Vosk Marker', stat: 'might', difficulty: 12, buildsAt: ['ilv-4'] }] }),
    );
    queue = { appraisal: [ruling], resolution: [{ narrative: 'The fleet sails.', ops: [] }] };
    const out = await resolveAction(createSeedState('meridian'), 'Land a garrison at Vosk Marker.');
    expect(out.output.inadmissible ?? null).toBeNull();
  });
});
