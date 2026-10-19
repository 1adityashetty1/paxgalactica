import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Narrate what landed (`docs/design-2026-10-18-code-knows.md` §5). Resolution
 * writes the story before the reducer rules on its ops; when the two differ, a
 * cheap pass rewrites the story to what landed, held to no number the landed
 * acts and the notes do not contain.
 */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { Campaign } = await import('../src/engine/campaign.js');
const { submitAction, storyDiverged, describeLanded } = await import('../src/engine/turn.js');
const { overrulings } = await import('../src/engine/journal.js');
const { campaignOutcome, serializeOutcome } = await import('../src/engine/epilogue.js');
const { createSeedState } = await import('../src/seed/scenario.js');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('whether the story and the result differ', () => {
  it('reads it off the rejections and the notes already written', () => {
    expect(storyDiverged([], [])).toBe(false);
    expect(storyDiverged(['Meridian lays down 4 battleships.'], [])).toBe(false);
    expect(storyDiverged([], [{ code: 'no_presence' }])).toBe(true);
    expect(storyDiverged(['Trimmed to 240 credits: the declaration cap.'], [])).toBe(true);
    expect(storyDiverged(['An act reaches into another power\'s business only as it was ruled to: left out interrupt_order.'], [])).toBe(true);
  });

  it('says what landed, one line an op, and skips the roll', () => {
    const text = describeLanded([
      { op: 'log_check', stat: 'might' },
      { op: 'fortify', factionId: 'meridian', systemId: 'sek-1', magnitude: 1, label: '' },
    ]);
    expect(text).toBe('- fortify factionId=meridian systemId=sek-1 magnitude=1');
  });
});

describe('the story told is rewritten onto the batch the reactions read', () => {
  it('puts it on the first batch of the declaration and clears the rest', () => {
    const campaign = Campaign.start('meridian', 'reconcile-rewrite');
    const from = campaign.stagedCount;
    campaign.stage([{ op: 'log_narrative', text: 'a' }], 'one', 'The first story.', 'model', 'meridian', { path: 'declared' });
    campaign.stage([{ op: 'log_narrative', text: 'b' }], 'one:correction', 'Correction: the second.', 'model', 'meridian', { path: 'declared' });
    campaign.rewriteNarrative(from, 'What happened.');
    expect(campaign.stagedNarratives().slice(from)).toEqual(['What happened.', '']);
  });
});

describe('a declaration whose ops were trimmed', () => {
  const script = (rewrite: string) => ({
    appraisal: [{ admissible: true, reason: '', stat: 'industry', difficulty: 2 }],
    resolution: [
      {
        narrative: 'The yards at Brannix lay down eighty battleships, every berth filled.',
        ops: [{ op: 'build_ships', factionId: 'meridian', systemId: 'sek-4', hull: 'battleship', count: 80 }],
      },
    ],
    reconcile: [{ narrative: rewrite }],
  });

  it('is told as what landed', async () => {
    const campaign = Campaign.start('meridian', 'reconcile-trim');
    const before = campaign.stagedCount;
    queue = script('The yards at Brannix take what keels they can, and the rest of the order waits.');
    const outcome = await submitAction(campaign, 'Lay down eighty battleships at Brannix.');
    expect(calls.map((c) => c.kind)).toContain('reconcile');
    expect(calls.find((c) => c.kind === 'reconcile')!.user).toMatch(/ACTS THAT LANDED/);
    expect(outcome.narrative).toBe('The yards at Brannix take what keels they can, and the rest of the order waits.');
    expect(campaign.stagedNarratives().slice(before).find((n) => n)).toBe(outcome.narrative);
  });

  it('keeps the draft when the rewrite invents a number', async () => {
    const campaign = Campaign.start('meridian', 'reconcile-guard');
    queue = script('The yards at Brannix lay down 9999 battleships.');
    const outcome = await submitAction(campaign, 'Lay down eighty battleships at Brannix.');
    expect(calls.map((c) => c.kind)).toContain('reconcile');
    expect(outcome.narrative).toBe('The yards at Brannix lay down eighty battleships, every berth filled.');
  });

  it('makes no call when nothing differed', async () => {
    const campaign = Campaign.start('meridian', 'reconcile-none');
    queue = {
      appraisal: [{ admissible: true, reason: '', stat: 'industry', difficulty: 2 }],
      resolution: [{ narrative: 'Brannix lays down a battleship.', ops: [{ op: 'build_ships', factionId: 'meridian', systemId: 'sek-4', hull: 'battleship', count: 1 }] }],
    };
    await submitAction(campaign, 'Lay down a battleship at Brannix.');
    expect(calls.map((c) => c.kind)).not.toContain('reconcile');
  });
});

describe('the epilogue knows who was overruled', () => {
  it('counts refusals and defiances off the journal, by label', () => {
    const campaign = Campaign.start('meridian', 'overruled');
    campaign.commit([{ op: 'adjust_dissent', factionId: 'meridian', delta: 8, reason: 'a line' }], 'engine', 'refused: close the Sennex lane', 'meridian', 'engine');
    campaign.commit([{ op: 'adjust_dissent', factionId: 'meridian', delta: 15, reason: 'a line' }], 'engine', 'objection: raid the Nars', 'meridian', 'engine');
    campaign.commit([{ op: 'adjust_dissent', factionId: 'vigil', delta: 15, reason: 'a line' }], 'engine', 'vigil acts against its own line', undefined, 'engine');
    campaign.commit([{ op: 'adjust_dissent', factionId: 'vigil', delta: 4, reason: 'raised it' }], 'engine', 'ordinary', undefined, 'engine');
    expect(overrulings(campaign.journal)).toEqual({
      meridian: { refusals: 1, defiances: 1 },
      vigil: { refusals: 0, defiances: 1 },
    });
  });

  it('says so on the slide, whatever the dissent at the end', () => {
    const seed = createSeedState('meridian');
    const text = serializeOutcome(campaignOutcome(seed, seed, 30, [], { meridian: { refusals: 2, defiances: 0 } }));
    const meridian = text.slice(text.indexOf('(`meridian`)'), text.indexOf('(`vigil`)'));
    expect(meridian).toMatch(/refused its orders twice/);
    expect(meridian).not.toMatch(/stood behind it throughout/);
    const vigil = text.slice(text.indexOf('(`vigil`)'));
    expect(vigil).toMatch(/never once refused it/);
  });
});
