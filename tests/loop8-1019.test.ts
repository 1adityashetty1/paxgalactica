import { describe, expect, it } from 'vitest';
import { DeclaredRulingSchema, oneActPerRuling, rulingToAppraisal } from '../src/domain/ops.js';

/** Fixes from the eighth loop of the advisor playtest (2026-10-19). */

const overt = (what: string) => ({ kind: 'overt', what, stat: 'influence', difficulty: 12 });

describe('a ruling on two acts', () => {
  it('keeps the first overt part and notes the second, where the schema refused it', () => {
    const raw = { kind: 'act', parts: [overt('send an envoy to Ithaal'), overt('fortify Ithaal')] };
    expect(DeclaredRulingSchema.safeParse(raw).success).toBe(false);
    const fixed = DeclaredRulingSchema.parse(oneActPerRuling(raw));
    expect(fixed.kind === 'act' && fixed.parts.map((p) => p.kind)).toEqual(['overt', 'unexpressed']);
    expect(JSON.stringify(fixed)).toMatch(/a second act, which needs an order of its own — fortify Ithaal/);
  });

  it('notes a negotiation beside an act, and is the negotiation when that is all it is', () => {
    const talks = { kind: 'negotiation', withFactionIds: ['freeworlds'], what: 'Sennex' };
    const beside = DeclaredRulingSchema.parse(oneActPerRuling({ kind: 'act', parts: [talks, overt('develop Neth')] }));
    expect(JSON.stringify(beside)).toMatch(/Needs freeworlds to agree; open a channel: Sennex/);
    expect(rulingToAppraisal(beside).admissible).toBe(true);
    const alone = DeclaredRulingSchema.parse(oneActPerRuling({ kind: 'act', parts: [talks] }));
    expect(alone).toMatchObject({ kind: 'negotiation', withFactionIds: ['freeworlds'] });
  });
});


