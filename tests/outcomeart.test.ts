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
 * `worlds.ts` already carry. What it cannot check is whether the scenes *read*,
 * which is a thing only looking at them settles, and looking is what changed
 * both of them: they were a barred door and a broken one, paired on the
 * argument that the two rulings are one thing in two states, and at feed size a
 * stone arch is an abstraction a reader has to decode before they can get to
 * the sentence underneath it.
 *
 * So what is pinned here is not the drawing. It is the handful of claims each
 * picture makes that would be wrong if they stopped being true — a stamp that
 * runs off the page, a line that only falls, a face beside the scale and not in
 * the plot.
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

  it('stamps the document across the page and off both edges', () => {
    // The stamp has to read as something done TO the document rather than as
    // part of it, and running past the paper on both sides is what says so.
    const px = outcomePixels('refusal');
    const red = new Set(['#b3372e', '#7a2620']);
    const onPage = (x: number) => x >= 16 && x <= 46;
    let left = 0;
    let right = 0;
    let across = 0;
    for (let y = 0; y < OUTCOME_H; y++) {
      for (let x = 0; x < OUTCOME_W; x++) {
        if (!red.has(px[y]![x]!)) continue;
        if (x < 16) left += 1;
        else if (x > 46) right += 1;
        else if (onPage(x)) across += 1;
      }
    }
    expect(left).toBeGreaterThan(8);
    expect(right).toBeGreaterThan(8);
    expect(across).toBeGreaterThan(60);
  });

  it('draws a document rather than a rectangle', () => {
    // Letterhead, body lines and a seal. A page with nothing on it is a shape,
    // and the whole reason this replaced a barred door is that a shape makes
    // the reader work.
    const px = outcomePixels('refusal');
    const paper = px.flat().filter((c) => c === '#cbc4b4' || c === '#e4ded1').length;
    const ink = px.flat().filter((c) => c === '#2f3640' || c === '#6d7480').length;
    expect(paper).toBeGreaterThan(400);
    expect(ink).toBeGreaterThan(80);
  });

  it('only ever falls, and leaves the chart still falling', () => {
    // The one thing the picture asserts. A line that recovers anywhere is
    // saying something the mechanic does not: `DISSENT_DECAY` is 2 a turn
    // against a breach of 15, and disposition has no decay at all.
    const px = outcomePixels('defiance');
    const red = new Set(['#b3372e', '#7a2620']);
    const topAt = (x: number): number | null => {
      for (let y = 0; y < OUTCOME_H; y++) if (red.has(px[y]![x]!)) return y;
      return null;
    };
    const first = topAt(15);
    // The plot area ends at 61, not at the image edge — `OUTCOME_W - 1` is
    // outside it and finds nothing.
    const last = topAt(61);
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    // Falls by most of the chart's height over its width.
    expect(last! - first!).toBeGreaterThan(18);
    // And is still on the board at the right edge rather than flattening onto
    // the axis — it has not levelled off, it has left.
    expect(last!).toBeLessThan(31);
  });

  it('labels the axis with a face, in the gutter and nowhere else', () => {
    // A falling red line says "down" and nothing about what. The smile is what
    // makes it a chart OF something — and it belongs beside the scale rather
    // than in the plot, where it would read as a datum.
    const px = outcomePixels('defiance');
    let inGutter = 0;
    let inPlot = 0;
    for (let y = 0; y < OUTCOME_H; y++) {
      for (let x = 0; x < OUTCOME_W; x++) {
        if (px[y]![x] !== '#c9a227') continue;
        if (x < 12) inGutter += 1;
        else inPlot += 1;
      }
    }
    expect(inGutter).toBeGreaterThan(40);
    expect(inPlot).toBe(0);
  });

  it('is two different pictures', () => {
    const a = outcomePixels('refusal').flat().join('');
    const b = outcomePixels('defiance').flat().join('');
    expect(a).not.toBe(b);
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
