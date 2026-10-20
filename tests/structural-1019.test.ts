import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The structural problems from the 2026-10-19 playtest (`docs/audit-2026-10-19.md`
 * S1–S6), each closed in code. Every test reproduces what the playtest hit.
 */

let queue: Record<string, unknown[]> = {};
const calls: { kind: string; user: string }[] = [];
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { applyOps, tickTurn } = await import('../src/domain/reducer.js');
const { commitmentsAsRuled } = await import('../src/domain/refusals.js');
const { serializeCommitments, voiceWithoutNumbering } = await import('../src/model/serialize.js');
const { pressuresOn } = await import('../src/domain/pressures.js');
const { ConcessionSchema } = await import('../src/domain/diplomacy.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { GameSession } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');
type WorldState = import('../src/domain/state.js').WorldState;

beforeEach(() => {
  queue = {};
  calls.length = 0;
});

describe('S1: a record beside an act that has a mechanism', () => {
  const record = { op: 'establish_commitment', kind: 'torrek_fortification', factionIds: ['meridian'], text: 'Torrek is hardened.' };
  it('is dropped; an income charter on its own is kept', () => {
    const fortify = { op: 'fortify', factionId: 'meridian', systemId: 'tor-1', magnitude: 1 };
    expect(commitmentsAsRuled([fortify, record], { kind: 'torrek_fortification', mechanism: 'record' })).toEqual({ ops: [fortify], dropped: ['torrek_fortification'] });
    const charter = { ...record, kind: 'free_port', incomePerTurn: 20 };
    expect(commitmentsAsRuled([charter], { kind: 'free_port', mechanism: 'income' }).ops).toHaveLength(1);
  });

  it('a one-party record is shown to every reader as policy, not a promise', () => {
    const s = applyOps(createSeedState('meridian'), [record], 'model', 'meridian').state;
    expect(serializeCommitments(s, 'meridian')).toMatch(/a statement of policy, owed to nobody/);
  });
});

describe('S2: the player strikes their own term', () => {
  it('comes off the record before the other power answers, and the message says so', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'strike');
    const inner = session as unknown as { openChannel: string | null; channelConcessions: unknown[]; channelHistory: { text: string }[] };
    inner.openChannel = 'vigil';
    inner.channelHistory = [];
    inner.channelConcessions = [ConcessionSchema.parse({ by: 'meridian', kind: 'cede_worlds', text: 'Torrek passes to the Vigil.', systems: ['tor-1'] })];
    queue = { diplomacy: [{ reply: 'Then there is nothing to sign, Chief Executive.', concessions: [], retractions: [] }] };
    const out = await session.talk('vigil', 'No deal.', ['cede_worlds']);
    expect(out.concessions).toEqual([]);
    expect(calls[0]!.user).toMatch(/Withdrawn from our side of the record: Torrek passes to the Vigil/);
  });
});

describe('S3: what the reactions are told about a fleet sent at somebody', () => {
  it('is what sailed, not the story of a battle not yet fought', () => {
    const campaign = Campaign.start('meridian', 'brief');
    campaign.stage(
      [{ op: 'move', factionId: 'meridian', originId: 'tor-1', targetId: 'tor-3', force: { battleship: 3 } }],
      'sweep Vantic',
      'The Vigil line breaks under a single disciplined pass.',
      'model',
      'meridian',
      { path: 'declared' },
    );
    const { summary } = campaign.reactionBrief();
    expect(summary).toMatch(/sends 3 battleships from Torrek Anchorage to Vantic \(the outcome is decided when they arrive\)/);
    expect(summary).not.toMatch(/disciplined pass/);
  });
});

describe('S4: a guard over unaligned ground', () => {
  const board = (lift: number): WorldState => {
    let s = createSeedState('meridian');
    s = applyOps(s, [{ op: 'adjust_ships', factionId: 'freeworlds', systemId: 'ark-2', delta: 3, hull: 'escort' }], 'engine').state;
    const force = lift > 0 ? { battleship: 2, lifter: lift } : { battleship: 2 };
    const r = applyOps(s, [{ op: 'issue_order', factionId: 'meridian', type: 'fleet_movement', originId: 'sek-1', targetId: 'ark-2', force }], 'engine');
    expect(r.rejections).toEqual([]);
    return r.state;
  };
  const sennex = (s: WorldState) => s.systems.find((x) => x.id === 'ark-2')!;

  it('takes station beside a power it is at peace with', () => {
    const after = tickTurn(board(0), { randomEvents: false }).state;
    expect(sennex(after).ships.meridian).toEqual({ battleship: 2 });
    expect(sennex(after).ships.freeworlds).toEqual({ escort: 3 });
  });

  it('fights as before with troops aboard, or for a journal before version 29', () => {
    const landing = tickTurn(board(1), { randomEvents: false }).state;
    expect(sennex(landing).ships.freeworlds).toBeUndefined();
    const old = tickTurn(board(0), { randomEvents: false, battleRules: { stationBesidePeers: false } }).state;
    expect(sennex(old).ships.freeworlds).toBeUndefined();
  });
});

describe('S5: the counsellor’s voice', () => {
  it('leaves out the rule to number its points, and keeps the rest', () => {
    const voice = createSeedState('meridian').factions.find((f) => f.id === 'meridian')!.voice;
    expect(voice).toMatch(/numbers his points/);
    const counsel = voiceWithoutNumbering(voice);
    expect(counsel).not.toMatch(/numbers his points/);
    expect(counsel).toMatch(/Corporate plural/);
  });
});

describe('S6: what presses on a power', () => {
  it('names transports massing a jump from a world, and a rival in its orbit', () => {
    let s = createSeedState('meridian');
    s = applyOps(s, [{ op: 'adjust_ships', factionId: 'vigil', systemId: 'tor-3', delta: 11, hull: 'lifter' }], 'engine').state;
    s.systems.find((x) => x.id === 'tor-1')!.ships.vigil = { battleship: 7 };
    const flagged = pressuresOn(s, 'meridian').join('\n');
    expect(flagged).toMatch(/Iron Vigil Remnant has lift for \d+ troops on or a jump from Torrek Anchorage/);
    expect(flagged).toMatch(/in the orbit of Torrek Anchorage, a world you hold \(garrison \d+, yours\)/);
  });
});
