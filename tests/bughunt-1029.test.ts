import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Bug hunt 2026-10-29, second round (Meridian): findings reproduced against the engine, the model scripted. */

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

beforeEach(() => {
  queue = {};
});

describe('an operative taken off the Lists', () => {
  it('is the power’s own business: the reactions are not told', async () => {
    // The Vigil's reaction opened "a Meridian ghost settles into Torrek
    // Anchorage" — the recruitment's account was in the summary every
    // responder reads, because only a send or groundwork marked a batch secret.
    const campaign = Campaign.start('meridian', 'recruit-secret');
    queue = {
      appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'take a ghost off the Lists', stat: 'guile', difficulty: 5 }] }],
      resolution: [
        {
          narrative: 'Priya Abernathy comes off the Lists at Torrek Anchorage.',
          ops: [{ op: 'recruit_agent', factionId: 'meridian', systemId: 'tor-1' }],
        },
      ],
    };
    await submitAction(campaign, 'Take a ghost off the Lists at Torrek Anchorage.');
    expect(campaign.state.agents.some((a) => a.ownerFactionId === 'meridian')).toBe(true);
    expect(campaign.reactionBrief().summary).not.toMatch(/Abernathy|ghost|Lists/);
  });
});

describe('an ultimatum declared on its own', () => {
  it('is issued, though the ruling forgot to name it coercion', async () => {
    // Ruled, rolled a critical success, and left out: "an act reaches into
    // another power's business only as it was ruled to".
    const campaign = Campaign.start('meridian', 'ultimatum-reach');
    queue = {
      appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'an ultimatum to Drajk', stat: 'influence', difficulty: 2 }] }],
      resolution: [
        {
          narrative: 'The demand goes to the Confederacy.',
          ops: [{ op: 'issue_ultimatum', targetFactionId: 'drajk', demand: 'trade_accord', deadlineTurns: 3, text: 'Sign a trade accord.' }],
        },
      ],
    };
    const out = await submitAction(campaign, 'Issue an ultimatum to the Drajk Confederacy: sign a trade accord within three turns.');
    expect(out.notes.join(' ')).not.toMatch(/left out issue_ultimatum/);
    expect(out.rejections).toEqual([]);
    expect((campaign.state.demands ?? []).some((d) => d.toFactionId === 'drajk')).toBe(true);
  });
});
