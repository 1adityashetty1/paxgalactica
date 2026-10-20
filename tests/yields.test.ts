import { describe, expect, it } from 'vitest';
import { DeclaredRulingSchema, rulingToAppraisal } from '../src/domain/ops.js';
import { prizesAsRuled } from '../src/domain/refusals.js';

/**
 * A prize is named before the roll (`docs/design-2026-10-17-intent-ops.md` §4).
 * Routine court acts at DC 5 came back with sellable charts, contraband and
 * dossiers on a critical success, invented after the dice by the pass with
 * every reason to be generous (playtest 2026-10-15, A10).
 */

const ruling = (yields?: string[]) =>
  DeclaredRulingSchema.parse({
    kind: 'act',
    parts: [{ kind: 'overt', what: 'sweep the wreck field', stat: 'industry', difficulty: 12, ...(yields ? { yields } : {}) }],
  });

describe('the ruling names what an attempt could yield', () => {
  it('yields nothing unless the arbiter says otherwise', () => {
    expect(rulingToAppraisal(ruling()).yields).toBeUndefined();
  });

  it('carries the named kinds to resolution', () => {
    expect(rulingToAppraisal(ruling(['salvage'])).yields).toEqual(['salvage']);
  });
});

describe('a prize is minted only of a kind the ruling named', () => {
  const salvage = { op: 'create_asset', kind: 'salvage', heldBy: 'meridian', quantity: 4, text: 'Hull plate.' };
  const charts = { op: 'create_asset', kind: 'charts', heldBy: 'meridian', quantity: 1, text: 'A chart.' };
  const order = { op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 };

  it('keeps a named kind and drops any other, leaving every other op alone', () => {
    const r = prizesAsRuled([salvage, charts, order], ['salvage']);
    expect(r.ops).toEqual([salvage, order]);
    expect(r.dropped).toEqual(['charts']);
  });

  it('drops every prize when nothing was named', () => {
    expect(prizesAsRuled([salvage], []).ops).toEqual([]);
  });
});
