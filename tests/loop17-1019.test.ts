import { describe, expect, it } from 'vitest';
import { RecommendationSchema, firstActOnly } from '../src/model/calls.js';

/** Fixes from the seventeenth loop of the advisor playtest (2026-10-19). */

describe('a recommendation that runs on into a second act', () => {
  it('is cut to its first act rather than failing the call', () => {
    const raw = { counsel: 'c', recommendation: 'Open talks with the Vigil about the Corvid plate, then cede them nothing more.' };
    expect(RecommendationSchema.safeParse(raw.recommendation).success).toBe(false);
    const cut = firstActOnly(raw) as { recommendation: string };
    expect(cut.recommendation).toBe('Open talks with the Vigil about the Corvid plate.');
    expect(RecommendationSchema.safeParse(cut.recommendation).success).toBe(true);
  });

  it('leaves a reply alone when there is nothing left to keep', () => {
    const raw = { counsel: 'c', recommendation: 'Then wait.' };
    expect(firstActOnly(raw)).toBe(raw);
  });
});
