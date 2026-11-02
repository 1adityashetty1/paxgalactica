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

describe('a fixture named in the words', () => {
  it('is rolled on its own primary attribute, whatever stat the arbiter wrote', async () => {
    // "Raise a hospital at Vashka" was ruled industry, rolled, and the
    // hospital refused for not being a resolve undertaking.
    const campaign = Campaign.start('freeworlds', 'fixture-stat');
    queue = {
      appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'raise a hospital', stat: 'industry', difficulty: 2 }] }],
      resolution: [
        {
          narrative: 'Ground is broken for a hospital at Vashka.',
          ops: [{ op: 'found_fixture', factionId: 'freeworlds', systemId: 'ark-4', kind: 'hospital' }],
        },
      ],
    };
    const out = await submitAction(campaign, 'Raise a hospital at Vashka.');
    expect(out.check?.stat).toBe('resolve');
    expect(out.notes.join(' ')).not.toMatch(/was not begun/);
  });
});

describe('a theft the player did not ask to be a copy', () => {
  it('takes the thing', async () => {
    // "Steal the Vigil's line-of-battle drawings" was sent with copy: true,
    // which leaves the original with the Vigil.
    const campaign = Campaign.start('ojjul', 'steal-not-copy');
    campaign.commit([{ op: 'recruit_agent', factionId: 'ojjul', systemId: 'ilv-5' }], 'model', 'ojjul');
    const agent = campaign.state.agents.find((a) => a.ownerFactionId === 'ojjul')!;
    queue = {
      appraisal: [{ kind: 'act', parts: [{ kind: 'covert', what: 'steal the drawings', mission: 'larceny', systemId: 'tor-3', agent: agent.name }] }],
      resolution: [
        {
          narrative: 'The ghost goes to Vantic.',
          ops: [{ op: 'deploy_agent', agent: agent.name, systemId: 'tor-3', mission: 'larceny', effect: { kind: 'steal', assetId: null, copy: true }, cover: 'a clerk' }],
        },
      ],
    };
    await submitAction(campaign, `Send ${agent.name} to Vantic to steal the Vigil's line-of-battle drawings.`);
    const sent = campaign.state.agents.find((a) => a.id === agent.id)!;
    expect(sent.mission).toBe('larceny');
    expect((sent.effect as { copy?: boolean }).copy).toBe(false);
  });
});

describe('acts the board answers before the roll', () => {
  it('a bounty is priced trivial, whatever the arbiter wrote', async () => {
    const campaign = Campaign.start('meridian', 'bounty-trivial');
    queue = {
      appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'post a bounty', stat: 'influence', difficulty: 10 }] }],
      resolution: [{ narrative: 'The price goes up.', ops: [{ op: 'post_bounty', targetFactionId: 'vigil', credits: 200, reason: 'raids' }] }],
    };
    const out = await submitAction(campaign, 'Post a bounty of 200 credits on the Iron Vigil Remnant.');
    expect(out.check?.difficulty).toBe(5);
  });

  it('a levy on full barracks is turned away, and spends nothing', async () => {
    const campaign = Campaign.start('freeworlds', 'full-barracks');
    const vashka = campaign.state.systems.find((x) => x.id === 'ark-4')!;
    expect(vashka.garrison).toBe(vashka.garrisonMax);
    queue = { appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'raise troops', stat: 'industry', difficulty: 10 }] }] };
    const out = await submitAction(campaign, 'Raise four more troops in the Vashka garrison.');
    expect(out.check ?? null).toBeNull();
    expect(out.narrative).toMatch(/already full/);
    expect(out.inadmissible).toMatch(/already full/);
    expect(campaign.actionPointsLeft).toBe(2);
  });
});
