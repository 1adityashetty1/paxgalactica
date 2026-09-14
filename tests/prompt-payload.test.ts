import { describe, expect, it, vi } from 'vitest';

/**
 * What each call is actually sent, as opposed to what it needs.
 *
 * Two things had accumulated. The **arbiter** was handed every rival's
 * doctrine paragraph and a spelled-out sentence for each of their war and
 * trade ethics — 1.5k characters of character prose, on the most frequent
 * call in the game, to rule on whether the ACTING power may attempt a thing
 * and how hard that is. It is given that power's own red lines and
 * compulsions separately, by `serializePrinciples`.
 *
 * And **extraction** was handed the duration rubric — 944 tokens of anchors
 * for choosing `durationTurns` — when `issue_order` is not in
 * `EXTRACTION_ALLOWED` at all. The reducer refuses it outright: "an order is
 * your own work and costs an action to give." The one pass that could never
 * write a duration was the one being taught how.
 */

const calls: { kind: string; system: string; user: string }[] = [];

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; system: string; user: string }) => {
    calls.push({ kind: call.kind, system: call.system, user: call.user });
    const scripted: Record<string, unknown> = {
      appraisal: {
        admissible: true,
        stat: 'industry',
        difficulty: 12,
        reason: 'ok',
        establishes: null,
        breach: null,
        negotiation: null,
        covert: [],
      },
      extraction: { narrative: 'Nothing was agreed.', ops: [] },
      reaction: { reactions: [{ factionId: 'vigil', narrative: 'The Legate says nothing.', ops: [] }] },
    };
    return { value: scripted[call.kind], attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
}));

const { appraiseAction, extractAgreements, gatherReactions } = await import('../src/model/calls.js');
const { createSeedState } = await import('../src/seed/scenario.js');
const { EXTRACTION_ALLOWED } = await import('../src/domain/ops.js');
const { loadPrompt } = await import('../src/model/prompts.js');

/** A line the rubric cannot be confused with anything else by. */
const RUBRIC_MARK = loadPrompt('duration-rubric').split('\n').find((l) => l.trim().length > 40)!;

describe('the arbiter is sent positions, not portraits', () => {
  it('keeps the acting power whole and trims the rest', async () => {
    calls.length = 0;
    const state = createSeedState('meridian');
    await appraiseAction(state, 'Raise the garrison at Brannix.');

    const { user } = calls[0]!;
    // The actor keeps everything: it is the power being ruled on.
    expect(user).toContain('Commerce is sovereignty');
    // Rivals keep where they stand and what they are...
    expect(user).toContain('Iron Vigil Remnant');
    expect(user).toMatch(/war: crusading/);
    // ...but not the paragraph explaining who they are.
    expect(user).not.toContain('The Empire did not fall; it withdrew');
  });

  it('still gives it the acting power’s own lines to rule against', async () => {
    calls.length = 0;
    const state = createSeedState('meridian');
    await appraiseAction(state, 'Run narcotics through the Sekkar lanes.');
    // `serializePrinciples`, which is what makes a breach ruling possible at
    // all — trimming the board must not have taken this with it.
    expect(calls[0]!.user).toContain('The acting faction’s own character');
    expect(calls[0]!.user).toMatch(/narcotics/i);
  });
});

describe('the duration rubric goes to the passes that set durations', () => {
  it('is not sent to extraction, which cannot issue an order', async () => {
    // The premise, checked rather than assumed: if `issue_order` ever became
    // reachable from an accord, this test should fail loudly rather than
    // quietly starve the pass of the rules it now needs.
    expect([...EXTRACTION_ALLOWED]).not.toContain('issue_order');

    calls.length = 0;
    const state = createSeedState('meridian');
    await extractAgreements(state, 'vigil', [
      { speaker: 'player', text: 'We are done here.' },
      { speaker: 'faction', text: 'So we are.' },
    ]);
    expect(calls[0]!.system).not.toContain(RUBRIC_MARK);
  });

  it('is still sent to reaction, which does', async () => {
    // The other half, and the one that makes the first mean something: a
    // reaction emits `issue_order` routinely, so the anchors are load-bearing
    // there and removing them from extraction must not have removed them here.
    calls.length = 0;
    const state = createSeedState('meridian');
    await gatherReactions(state, ['vigil'], 'Meridian moved a fleet.');
    expect(calls[0]!.kind).toBe('reaction');
    expect(calls[0]!.system).toContain(RUBRIC_MARK);
  });
});
