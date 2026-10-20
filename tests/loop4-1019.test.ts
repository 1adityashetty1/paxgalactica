import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the fourth loop of the advisor playtest (2026-10-19). */

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
const { askAdvisor, resolveAction } = await import('../src/model/calls.js');
const { paperOf } = await import('../src/domain/pressures.js');
const { GameSession } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');
const { serializeOutcome, campaignOutcome } = await import('../src/engine/epilogue.js');

const CONTRACT = 'will not repudiate a contract it has signed, even a ruinous one; its whole value rests on that';
const ruledOnContract = {
  admissible: true,
  reason: '',
  stat: 'influence',
  difficulty: 12,
  rationale: '',
  breach: { kind: 'red_line', principles: [CONTRACT], how: 'it trades the note away', by: 'the Trade Council', reason: 'Our word is not for sale.' },
};

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('a red line code can check', () => {
  it('is judged against the closed list of acts it forbids', async () => {
    queue = { appraisal: [ruledOnContract], breach_relevance: [{ relevant: false, why: 'giving a note away repudiates nothing' }], resolution: [{ narrative: 'The note goes to Shalka.', ops: [] }] };
    const out = await resolveAction(createSeedState('meridian'), 'Give our most-favoured note to the Combine.');
    const check = calls.find((c) => c.kind === 'breach_relevance')!;
    expect(check.user).toMatch(/This line forbids exactly these acts, and nothing else: .*repudiate a treaty.*walk away from an arrangement/);
    expect(out.output.refusal ?? null).toBeNull();
  });
});

describe('the counsellor', () => {
  it('is told its paper whole, including what it does not have', () => {
    const paper = paperOf(createSeedState('meridian'), 'meridian').join('\n');
    expect(paper).toMatch(/Favours owed to you: none\. There is no favour to call in/);
    expect(paper).toMatch(/your own most-favoured terms note — yours to give to another power, not to call in/i);
    expect(paper).toMatch(/you owe Ojjul Nar Combine \d+, paid \d+ a turn\. A debt is not a note/);
  });

  it('hears what became of the order after its counsel', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'counsel-followed');
    queue = {
      advisor: [
        { counsel: 'The note is worth more to the Combine.', recommendation: 'Trade the note to the Combine.' },
        { counsel: 'Torrek still matters.', recommendation: 'Hold Torrek.' },
      ],
      appraisal: [ruledOnContract],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    await session.advisor('What should we do?');
    const out = await session.action('Trade the note to the Combine.');
    expect(out.refusal).not.toBeNull();
    const last = session.snapshot()!.lastCounsel!;
    expect(last.followed).toMatch(/^"Trade the note to the Combine\." — refused by the Trade Council, on the line "will not repudiate/);
    await askAdvisor(createSeedState('meridian'), 'meridian', 'And now?', last);
    const second = calls.filter((c) => c.kind === 'advisor')[1]!;
    expect(second.user).toMatch(/What came of the next order your leader gave: "Trade the note/);
    expect(second.user).toMatch(/do not urge it a second time/);
  });
});

describe('the epilogue', () => {
  it('says a refused order was never carried out', () => {
    const s = createSeedState('meridian');
    const text = serializeOutcome(campaignOutcome(s, s, 10, [], { meridian: { refusals: 3, defiances: 0 } }, {}));
    expect(text).toMatch(/refused its orders 3 times, and those orders were never carried out/);
  });
});
