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
      reaction: { factionId: 'vigil', narrative: 'The Legate says nothing.', ops: [] },
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

describe('the model is not offered values it can never use', () => {
  it('cannot express a downward dissent adjustment at all', async () => {
    const { ModelOpSchema, OpSchema } = await import('../src/domain/ops.js');
    const down = { op: 'adjust_dissent', factionId: 'meridian', delta: -10 };

    // Layer 1: ungeneratable. `ModelOpSchema` becomes the JSON schema handed
    // to the model, so a floor of zero means the rejected half never appears.
    expect(ModelOpSchema.safeParse(down).success).toBe(false);
    expect(
      ModelOpSchema.safeParse({ op: 'adjust_dissent', factionId: 'meridian', delta: 8 }).success,
    ).toBe(true);

    // Layer 2 keeps the full range: journals written before this carry
    // negative deltas that were rejected, and replay has to parse them to
    // reach the same verdict rather than failing to load.
    expect(OpSchema.safeParse(down).success).toBe(true);
  });

  it('advertises the floor in the schema the model actually receives', async () => {
    const { z } = await import('zod');
    const { ModelOpSchema } = await import('../src/domain/ops.js');
    const json = JSON.stringify(z.toJSONSchema(ModelOpSchema, { target: 'draft-7', io: 'input' }));
    // The constraint is worthless if it does not survive into the JSON schema,
    // which is the artefact that does the enforcing.
    expect(json).toMatch(/"adjust_dissent"[\s\S]{0,400}?"minimum":0/);
  });
});

describe('a prose cap trims rather than costs a call', () => {
  it('trims an over-long narrative at a sentence end', async () => {
    const { ReactionSchema } = await import('../src/domain/ops.js');
    const long = 'The Legate reads it twice. '.repeat(30);
    const out = ReactionSchema.parse({ factionId: 'vigil', narrative: long, ops: [] });
    expect(out.narrative.length).toBeLessThanOrEqual(421);
    expect(out.narrative.endsWith('.')).toBe(true);
  });

  it('leaves prose inside the cap exactly as written', async () => {
    const { ReactionSchema } = await import('../src/domain/ops.js');
    const said = 'The Legate reads the dispatch twice and says nothing.';
    expect(ReactionSchema.parse({ factionId: 'vigil', narrative: said, ops: [] }).narrative).toBe(said);
  });

  it('never rejects on length, which is the whole point', async () => {
    // Under `outputFormat: json_schema` the cap was enforced while the model
    // wrote, so overrunning was impossible and rejecting on it cost nothing.
    // Without structured output it became the single largest source of
    // retries — three of three reaction calls, measured — and a retry is a
    // whole extra model call to re-say a sentence that was forty characters
    // long. A readability rule must not be able to do that.
    const { ReactionSchema } = await import('../src/domain/ops.js');
    const huge = 'x'.repeat(5000);
    expect(ReactionSchema.safeParse({ factionId: 'vigil', narrative: huge, ops: [] }).success).toBe(true);
  });
});
