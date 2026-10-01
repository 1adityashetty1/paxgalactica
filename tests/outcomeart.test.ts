import { describe, expect, it } from 'vitest';
import {
  OUTCOME_ART_KINDS,
  OUTCOME_H,
  OUTCOME_W,
  outcomePixels,
  outcomeRuns,
  RIM_ART_KINDS,
  hasRimArt,
  rimEventPixels,
  rimEventRuns,
} from '../src/ui/outcomeart.js';
import { RIM_EVENT_KINDS } from '../src/domain/events.js';

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

/**
 * The Rim's own events (item 124). Each scene is in `RIM_ART_KINDS` only because
 * the user approved it by eye; what is pinned here is what the picture claims.
 */
describe('the event scenes', () => {
  it('draws only real event kinds, and says which have art', () => {
    for (const kind of RIM_ART_KINDS) expect(RIM_EVENT_KINDS).toContain(kind);
    expect(hasRimArt('ion_storm')).toBe(true);
    expect(hasRimArt('mutiny')).toBe(RIM_ART_KINDS.includes('mutiny' as never));
  });

  it('fills every cell and merges into runs without losing a pixel', () => {
    for (const kind of RIM_ART_KINDS) {
      const px = rimEventPixels(kind);
      expect(px).toHaveLength(OUTCOME_H);
      for (const row of px) {
        expect(row).toHaveLength(OUTCOME_W);
        for (const cell of row) expect(cell).toMatch(/^#[0-9a-f]{6}$/);
      }
      const runs = rimEventRuns(kind);
      expect(runs.reduce((n, r) => n + r.width, 0)).toBe(OUTCOME_W * OUTCOME_H);
      for (const r of runs) {
        for (let i = 0; i < r.width; i++) expect(px[r.y]![r.x + i]).toBe(r.colour);
      }
    }
  });

  it('ion storm: a bolt from the cloud to a lane that is cut beneath it', () => {
    const px = rimEventPixels('ion_storm');
    const LANE = '#2c6b66';
    const BOLT = new Set(['#f2f7ff', '#8fd3ff']);
    const CLOUD = new Set(['#261f47', '#40357a', '#6f62b8']);
    const laneRow = px[27]!;
    const lane = laneRow.map((c, x) => (c === LANE ? x : -1)).filter((x) => x >= 0);
    // Dashes on both sides of the storm, and none under it.
    expect(lane.some((x) => x < 24)).toBe(true);
    expect(lane.some((x) => x > 40)).toBe(true);
    expect(lane.some((x) => x >= 24 && x <= 40)).toBe(false);
    // The cloud is above the lane and the bolt spans the gap between them:
    // every row from the cloud's belly down to the lane has bolt in it.
    const cloudRows = px.map((row, y) => (row.some((c) => CLOUD.has(c)) ? y : -1)).filter((y) => y >= 0);
    expect(Math.max(...cloudRows)).toBeLessThan(27);
    for (let y = Math.max(...cloudRows) + 1; y <= 27; y++) {
      expect(px[y]!.some((c) => BOLT.has(c)), `row ${y}`).toBe(true);
    }
  });
});

describe('the derelict', () => {
  const px = rimEventPixels('derelict');
  const HULL = new Set(['#353c49', '#586272', '#808b9b', '#7f8a99', '#b4bfcc', '#e1e7ee']);
  const LIT = new Set(['#7f8a99', '#b4bfcc', '#e1e7ee']);

  it('is one ship in two pieces, with a gap where it broke', () => {
    // A column with at most a drifting fragment in it, between two columns
    // that have plenty — debris is hull too, and it is meant to be there.
    const hullIn = (x: number) => px.filter((row) => HULL.has(row[x]!)).length;
    const gap = [36, 37, 38].some((x) => hullIn(x) <= 1);
    expect(gap).toBe(true);
    expect(hullIn(25)).toBeGreaterThan(4);
    expect(hullIn(46)).toBeGreaterThan(4);
  });

  it('is lit where the searchlight lands, and the light comes from a ship', () => {
    expect(px.flat().filter((c) => LIT.has(c)).length).toBeGreaterThan(20);
    // The lamp is the brightest thing in the scene, at the scout's nose.
    expect(px.flat().filter((c) => c === '#fdfcf0')).toHaveLength(1);
    expect(px.flat().filter((c) => c === '#3fb8ad').length).toBeGreaterThan(3);
  });
});

describe('unrest', () => {
  const px = rimEventPixels('unrest');
  const CROWD = '#050608';
  const has = (x: number, c: string) => px.some((row) => row[x] === c);

  it('is a crowd with torches, with open ground between it and the post', () => {
    expect(px.flat().filter((c) => c === '#f59e0b').length).toBeGreaterThan(6);
    // Nobody stands against the wall: a figure touching the building flattened
    // the distance between them, so the columns before the post are empty.
    const crowdRight = Math.max(...px.flatMap((row) => row.map((c, x) => (c === CROWD ? x : -1))));
    expect(crowdRight).toBeLessThan(40);
    expect(has(45, '#3a4150')).toBe(true);
  });

  it('flies the occupier\'s banner over the post, and has no battlements', () => {
    expect(px.flat().filter((c) => c === '#b3372e').length).toBeGreaterThan(8);
    // The roof line is flat: no gap-toothed merlons along the top of the block.
    const roof = px[12]!.slice(48, 60);
    expect(new Set(roof).size).toBeLessThanOrEqual(2);
  });
});

describe('the border incident', () => {
  const px = rimEventPixels('border_incident');
  const LEFT = new Set(['#4f7fa8', '#86b4d8', '#30536f']);
  const RIGHT = new Set(['#a8743f', '#d8a56a', '#6e4a27']);

  it('puts one ship each side of a buoyed line, and fire crossing it both ways', () => {
    const xs = (set: Set<string>) => px.flatMap((row) => row.map((c, x) => (set.has(c) ? x : -1))).filter((x) => x >= 0);
    expect(Math.max(...xs(LEFT))).toBeLessThan(32);
    expect(Math.min(...xs(RIGHT))).toBeGreaterThan(32);
    expect(px[2]![32]).toBe('#ff6a5c');
    expect(px[33]![32]).toBe('#ff6a5c');
    // Each side's fire on both sides of the line.
    const cool = xs(new Set(['#e8f7ff']));
    const warm = xs(new Set(['#fde68a']));
    expect(cool.some((x) => x < 32) && cool.some((x) => x > 32)).toBe(true);
    expect(warm.some((x) => x < 32) && warm.some((x) => x > 32)).toBe(true);
  });

  it('draws the ships as the escort glyph, swept wings and all', () => {
    // A wing pixel well above the hull's nose row: the swept wing is the line
    // that makes the silhouette an escort and not a cross.
    const wingRows = px.map((row, y) => (row.some((c) => c === '#30536f') ? y : -1)).filter((y) => y >= 0);
    expect(Math.max(...wingRows) - Math.min(...wingRows)).toBeGreaterThan(8);
  });
});
