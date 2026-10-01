import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

/**
 * Every schema a model answers with accepts every honest answer.
 *
 * A traced playtest (docs/todo.md 117) found one class of defect in five places:
 * a field required in every case that means nothing in some of them — a price
 * on an action that is not attempted, `ops` from a power that waits, an empty
 * string where "none" was meant. The model answers honestly by leaving it out,
 * the schema refuses the honest answer, and a retry is paid for nothing. That
 * was 7 of raw JSON's 8 arbiter retries.
 *
 * So each schema is pinned against the minimal honest answer of every kind it
 * receives, and a guard reads `calls.ts` for every schema it hands a model, so a
 * schema added later without its cases fails here rather than in a playtest.
 */

const calls: { kind: string; user: string }[] = [];
const queue: Record<string, unknown[]> = {};

vi.mock('../src/model/client.js', () => ({
  // Parsed through the real schema, so defaults and transforms apply exactly as
  // they would to a model's reply.
  callStructured: async (call: { kind: string; user: string; schema: z.ZodType }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    return { value: call.schema.parse(next), attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
  timingReport: () => '',
}));

const ops = await import('../src/domain/ops.js');
const callsModule = await import('../src/model/calls.js');
const { createSeedState } = await import('../src/seed/scenario.js');

/** Minimal honest answers, per schema. Every one must parse. */
const HONEST: Record<string, { schema: z.ZodType; answers: Record<string, unknown> }> = {
  AppraisalSchema: {
    schema: ops.AppraisalSchema,
    answers: {
      'an accord, which is never rolled': { admissible: true },
      'an accord that breaches a line': {
        admissible: true,
        breach: { kind: 'red_line', principles: ['x'], how: 'y', by: 'the council', reason: 'z' },
      },
    },
  },
  DeclaredAppraisalSchema: {
    schema: ops.DeclaredAppraisalSchema,
    answers: {
      'an ordinary action': { stat: 'might', difficulty: 12 },
      'an inadmissible action': { admissible: false, reason: 'You are already bound.' },
      'a redirect to a conversation': {
        admissible: true,
        negotiation: { withFactionIds: ['vigil'], what: 'a pact' },
      },
      'a covert act aimed at nobody': {
        stat: 'guile',
        difficulty: 14,
        covert: [{ mission: 'theft', systemId: 'tor-3', target: '' }],
      },
    },
  },
  ResolutionOutputSchema: {
    schema: ops.ResolutionOutputSchema,
    answers: {
      'nothing to emit': { narrative: 'Nothing moves.' },
      'a covert act aimed at nobody': { narrative: 'n', covert: [{ mission: 'theft', systemId: 'tor-3', target: '' }] },
    },
  },
  ReactionSchema: {
    schema: ops.ReactionSchema,
    answers: {
      'a power that waits': { factionId: 'vigil', narrative: 'The Legate reads the dispatch.' },
      'no approach, said with blanks': { factionId: 'vigil', narrative: 'n', ops: [], approach: { opening: '', about: '' } },
    },
  },
  ExtractionOutputSchema: {
    schema: ops.ExtractionOutputSchema,
    answers: { 'nothing was agreed': { narrative: 'Nothing was agreed.' } },
  },
  DiplomacyReplySchema: {
    schema: callsModule.DiplomacyReplySchema,
    answers: { 'a reply and nothing given': { reply: 'The Legate hears you out, and gives nothing.' } },
  },
  AdvisorReplySchema: {
    schema: callsModule.AdvisorReplySchema,
    answers: { 'counsel': { counsel: 'The Vigil is watching Kalzir, and so should you.' } },
  },
  BreachRelevanceSchema: {
    schema: callsModule.BreachRelevanceSchema,
    answers: { 'a bare verdict': { relevant: false } },
  },
  EventFlavourSchema: {
    schema: callsModule.EventFlavourSchema,
    answers: { 'one line': { line: 'The lanes past Shalka go quiet, and the pilots drink.' } },
  },
  EpilogueSchema: {
    schema: callsModule.EpilogueSchema,
    answers: { 'an ending': { slides: [{ factionId: 'vigil', text: 't' }], closing: 'c' } },
  },
};

describe('every schema a model answers with accepts every honest answer', () => {
  for (const [name, { schema, answers }] of Object.entries(HONEST)) {
    for (const [what, answer] of Object.entries(answers)) {
      it(`${name}: ${what}`, () => {
        const res = schema.safeParse(answer);
        expect(res.success, res.success ? '' : JSON.stringify(res.error.issues)).toBe(true);
      });
    }
  }

  it('covers every schema calls.ts hands a model', () => {
    const src = readFileSync('src/model/calls.ts', 'utf8');
    const used = new Set<string>();
    for (const m of src.matchAll(/schema:\s*([^,\n}]+)/g)) {
      for (const id of m[1]!.matchAll(/\b([A-Z][A-Za-z]*Schema)\b/g)) used.add(id[1]!);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(HONEST, `${name} has no honest-answer cases`).toHaveProperty(name);
  });

  it('reads blank as absent, and nothing as nothing', () => {
    expect(ops.ReactionSchema.parse(HONEST.ReactionSchema!.answers['no approach, said with blanks']).approach).toBeUndefined();
    expect(ops.ReactionSchema.parse(HONEST.ReactionSchema!.answers['a power that waits']).ops).toEqual([]);
    expect(ops.ExtractionOutputSchema.parse({ narrative: 'n' }).ops).toEqual([]);
    const covert = ops.DeclaredAppraisalSchema.parse(HONEST.DeclaredAppraisalSchema!.answers['a covert act aimed at nobody']);
    expect(covert.covert![0]!.target).toBeUndefined();
  });

  it('still insists on a price when a roll will follow', () => {
    const res = ops.DeclaredAppraisalSchema.safeParse({ admissible: true });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error!.issues)).toMatch(/stat it tests/);
  });
});

describe('an inadmissible ruling rewritten into a compulsion is priced, not invented', () => {
  it('asks the arbiter for the price it was right not to give, then rolls with it', async () => {
    calls.length = 0;
    const state = createSeedState('meridian');
    const meridian = state.factions.find((f) => f.id === 'meridian')!;
    const compulsion = meridian.compulsions[0]!.text;
    queue.appraisal = [
      { admissible: false, reason: compulsion },
      { admissible: true, stat: 'influence', difficulty: 13 },
    ];
    queue.resolution = [{ narrative: 'The Council grumbles, and the order goes out.' }];

    const res = await callsModule.resolveAction(state, 'Raid the Combine convoys through Shalka.');
    expect(res.check).toMatchObject({ stat: 'influence', difficulty: 13 });
    const appraisals = calls.filter((c) => c.kind === 'appraisal');
    expect(appraisals).toHaveLength(2);
    expect(appraisals[1]!.user).toMatch(/This action is admissible/);
  });
});
