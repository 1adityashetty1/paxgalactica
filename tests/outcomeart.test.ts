import { describe, expect, it } from 'vitest';
import {
  OUTCOME_ART_KINDS,
  OUTCOME_H,
  OUTCOME_W,
  outcomePixels,
  outcomeRuns,
} from '../src/ui/outcomeart.js';

/**
 * The two rulings your own institutions make, as pixels.
 *
 * Pure geometry, so the suite can check it at all — the lesson `layout.ts` and
 * `worlds.ts` already carry. What it cannot check is whether the scenes read,
 * which is a thing only looking at them settles; what it can check is that
 * they are the same door, which is the entire reason they were drawn together.
 */
describe('the outcome scenes', () => {
  it('covers the pair and nothing else', () => {
    // `negotiation` keeps its illustration: it is not a breach, so it is not
    // part of a pair, and there is no second state of a door that says "this
    // needs somebody else to sign".
    expect([...OUTCOME_ART_KINDS]).toEqual(['refusal', 'defiance']);
  });

  it('fills every cell, so a scene can never render a hole', () => {
    for (const kind of OUTCOME_ART_KINDS) {
      const px = outcomePixels(kind);
      expect(px).toHaveLength(OUTCOME_H);
      for (const row of px) {
        expect(row).toHaveLength(OUTCOME_W);
        for (const cell of row) expect(cell).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('is the same door in both, which is the whole idea', () => {
    // The masonry either side of the arch is untouched by either ruling, so if
    // the two scenes ever stop sharing a wall they have stopped being one
    // object in two states and the pairing has silently been lost.
    const a = outcomePixels('refusal');
    const b = outcomePixels('defiance');
    let shared = 0;
    for (let y = 2; y <= 10; y++) {
      for (const x of [6, 8, 55, 57]) {
        expect(b[y]![x], `wall at ${x},${y}`).toBe(a[y]![x]);
        shared += 1;
      }
    }
    expect(shared).toBeGreaterThan(20);
  });

  it('differs where the ruling differs', () => {
    // And they must not be the SAME picture: the middle of the doorway is
    // whole in one and broken open in the other.
    const a = outcomePixels('refusal');
    const b = outcomePixels('defiance');
    let differing = 0;
    for (let y = 12; y <= 30; y++) {
      for (let x = 22; x <= 42; x++) if (a[y]![x] !== b[y]![x]) differing += 1;
    }
    expect(differing).toBeGreaterThan(150);
  });

  it('lights the broken door and not the whole one', () => {
    // The difference a reader is meant to catch in a quarter of a second.
    const lit = (kind: (typeof OUTCOME_ART_KINDS)[number]) =>
      outcomePixels(kind)
        .flat()
        .filter((c) => c === '#c9a227' || c === '#e8cd76').length;
    expect(lit('refusal')).toBe(0);
    expect(lit('defiance')).toBeGreaterThan(120);
  });

  it('merges into runs without losing a pixel', () => {
    for (const kind of OUTCOME_ART_KINDS) {
      const px = outcomePixels(kind);
      const runs = outcomeRuns(kind);
      expect(runs.reduce((n, r) => n + r.width, 0)).toBe(OUTCOME_W * OUTCOME_H);
      for (const r of runs) {
        for (let i = 0; i < r.width; i++) expect(px[r.y]![r.x + i]).toBe(r.colour);
      }
      // And it is worth doing: a scene is a few hundred rects, not 2,304.
      expect(runs.length).toBeLessThan(OUTCOME_W * OUTCOME_H * 0.4);
    }
  });
});
