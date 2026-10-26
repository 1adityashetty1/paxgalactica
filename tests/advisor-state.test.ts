import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The counsellor is told the turn so far, and what its power can do. */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push(call);
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { capabilitiesOf } = await import('../src/domain/capabilities.js');
const { GameSession } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('what a power can do', () => {
  it('is computed from the board', () => {
    const lines = capabilitiesOf(createSeedState('meridian'), 'meridian').join('\n');
    console.log(lines);
    expect(lines).toMatch(/^Yards: \d+ tons of hulls a declaration/m);
    expect(lines).toMatch(/Fixture slots free on your worlds: .*Brannix/);
    expect(lines).toMatch(/^Operatives: \d+ of \d+ slots used/m);
    expect(lines).toMatch(/On your Lists, recruitable/);
    expect(lines).toMatch(/^Officers in post: .*Operations Executive/m);
    expect(lines).toMatch(/^Your fleets stand at: /m);
    expect(lines).toMatch(/Worlds that answer to nobody within reach/);
  });

  it('says when there is no slot and nobody to send', () => {
    const s = createSeedState('meridian');
    s.agents = [];
    s.listedAgents = [];
    expect(capabilitiesOf(s, 'meridian').join('\n')).toMatch(/Nobody is free to send: sending one means recruiting first/);
  });
});

const LANE = 'will not close a lane — no blockade of civilian traffic, no embargo, no shut border; closed lanes are bad for everyone, including the closer';

describe('the counsellor', () => {
  it('hears what was declared this turn and how many actions are left', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'turn-so-far');
    queue = {
      appraisal: [
        {
          admissible: true,
          reason: '',
          stat: 'influence',
          difficulty: 12,
          rationale: '',
          breach: { kind: 'red_line', principles: [LANE], how: 'it shuts the lane', by: 'the Trade Council', reason: 'Our lanes stay open.' },
        },
      ],
      breach_relevance: [{ relevant: true, why: '' }],
      advisor: [{ counsel: 'Torrek still matters.', recommendation: 'Hold Torrek.' }],
    };
    await session.action('Close the Sennex lane.');
    await session.advisor('What now?');
    const user = calls.find((c) => c.kind === 'advisor')!.user;
    expect(user).toMatch(/## This turn so far \(true\)\n\n- "Close the Sennex lane\." — /);
    expect(user).toMatch(/After this counsel your leader has 0 of 2 actions left this turn\./);
    expect(user).toMatch(/— refused by the Trade Council/);
    expect(user).toMatch(/## What your power can do \(computed; complete\)/);
    expect(session.snapshot()!.thisTurn!.lines).toHaveLength(1);
  });
});
