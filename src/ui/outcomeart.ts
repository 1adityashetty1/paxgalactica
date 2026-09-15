/**
 * The ways a declaration produces nothing, as pixel art.
 *
 * Pure and DOM-free for the reason `worlds.ts`, `layout.ts` and `portrait.ts`
 * are: the suite has no DOM, so art built inside a component is art nothing
 * checks. This returns horizontal runs and a component turns them into rects.
 *
 * ## Why these replaced the illustrations
 *
 * The originals were painterly 16:9 renders and they did not work, in two
 * separate ways. They were in a contemporary corporate register — an office
 * worker holding a page stamped VETO, a television news desk reading APPROVAL
 * NUMBERS CRASH — against a game whose entire visual language is pixel sprites
 * and SVG glyphs. And the second one was about the wrong thing: `defiance` is a
 * leader overruling their own institutions and being charged for it, not a
 * polling collapse.
 *
 * ## The pair is one object in two states, which is the whole idea
 *
 * `refusal` and `defiance` are the same ruling with different force —
 * `classifyPrinciple` decides which by reading whether the line is on the red
 * list or the compulsion list, and the difference the player feels is that one
 * stops the order and the other prices it. So they are drawn as **the same
 * barred door**: shut and whole, then shut and broken through. A reader who has
 * seen one recognises the other instantly and knows it is the same kind of
 * event, which is a thing two unrelated illustrations cannot do however good
 * they are.
 *
 * ## Drawn in code rather than typed as a grid
 *
 * `worlds.ts` keeps its terrain as character grids, and that is right there —
 * continents are organic and editing one should be typing. These are
 * architecture: arches, bars, verticals. Thirty-six rows of sixty-four
 * characters would be a worse diff and an easier place to hide a mistake than
 * `arch(...)` and `bar(...)`, and the primitives are testable.
 */

export const OUTCOME_W = 64;
export const OUTCOME_H = 36;

/**
 * The kinds drawn as pixels.
 *
 * `negotiation` is deliberately not here. It keeps its illustration: the pair
 * below exists because `refusal` and `defiance` are one ruling in two states
 * and reading the second off the first is the whole value, and a redirect to a
 * channel is not part of that pair — it is not a breach at all, it is being
 * told the thing needs somebody else's signature. `inadmissible` and
 * `out-of-actions` have never had art and still fall back to text.
 */
export const OUTCOME_ART_KINDS = ['refusal', 'defiance'] as const;
export type OutcomeArtKind = (typeof OUTCOME_ART_KINDS)[number];

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const VOID = '#0b0f14';
const DESK_DARK = '#1a212b';
const DESK = '#2b3440';
const DESK_LIT = '#3a4552';
const PAPER = '#cbc4b4';
const PAPER_LIT = '#e4ded1';
const INK = '#2f3640';
const INK_PALE = '#6d7480';
const SEAL = '#b3372e';
const SEAL_DARK = '#7a2620';
const CHART_BG = '#131a23';
const GRID = '#1f2833';
const AXIS = '#48525f';
/** The face on the axis. Warm, so it reads as a mood and not as a datum. */
const MOOD = '#c9a227';

/* ------------------------------------------------------------------ */
/* A very small painter                                                */
/* ------------------------------------------------------------------ */

type Grid = string[][];

const blank = (): Grid =>
  Array.from({ length: OUTCOME_H }, () => Array.from({ length: OUTCOME_W }, () => VOID));

const put = (g: Grid, x: number, y: number, c: string): void => {
  if (x < 0 || y < 0 || x >= OUTCOME_W || y >= OUTCOME_H) return;
  g[y]![x] = c;
};

const rect = (g: Grid, x0: number, y0: number, x1: number, y1: number, c: string): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, c);
};

/* ------------------------------------------------------------------ */
/* The scenes                                                          */
/* ------------------------------------------------------------------ */

/**
 * REFUSAL — the order, stamped.
 *
 * An earlier version drew a barred door, paired with a broken one for
 * `defiance`, on the argument that the two rulings are one thing in two states.
 * The argument was sound and the pictures were not: at feed size a stone arch
 * is an abstraction, and a reader who has to work out that the shape is a
 * doorway has already stopped reading the line underneath it.
 *
 * A document with a stamp across it needs no working out. It is also literally
 * what happened: `submitAction` stages **nothing** on a refusal, so the order
 * exists, it was put in front of somebody, and it came back marked.
 */
function refusal(): Grid {
  const g = blank();

  // The desk it is lying on.
  rect(g, 0, 0, OUTCOME_W - 1, OUTCOME_H - 1, DESK_DARK);
  rect(g, 0, 26, OUTCOME_W - 1, OUTCOME_H - 1, DESK);
  rect(g, 0, 26, OUTCOME_W - 1, 26, DESK_LIT);

  // The page, with a shadow under it so it sits ON something.
  rect(g, 18, 4, 48, 34, VOID);
  rect(g, 16, 2, 46, 32, PAPER);
  rect(g, 16, 2, 46, 2, PAPER_LIT);
  rect(g, 16, 2, 16, 32, PAPER_LIT);

  // Letterhead: a heavy rule, a block of title, and a seal in the corner. This
  // is the part that says OFFICIAL rather than "a rectangle".
  rect(g, 20, 6, 38, 8, INK);
  rect(g, 20, 10, 42, 10, INK_PALE);
  rect(g, 16, 12, 46, 12, INK);

  // Body text: lines of varying length, with a gap where a paragraph breaks.
  for (const [y, x1] of [[15, 41], [17, 43], [19, 38], [23, 42], [25, 40], [27, 33]] as const) {
    rect(g, 20, y, x1, y, INK_PALE);
  }

  // The seal at the foot, and a signature line it was never signed on.
  rect(g, 20, 29, 27, 30, INK_PALE);
  rect(g, 37, 26, 43, 31, SEAL_DARK);
  rect(g, 38, 27, 42, 30, SEAL);
  rect(g, 39, 28, 41, 29, SEAL_DARK);

  // The stamp: a band driven across the whole page and off both edges, so it
  // reads as something done TO the document rather than as part of it. Stepped
  // rather than level, because a rubber stamp is never put down square.
  for (let x = 10; x <= 54; x++) {
    const y = 24 - Math.floor((x - 10) * 0.28);
    rect(g, x, y, x, y + 3, SEAL);
    // Flat, with only the edges darkened. A lighter core down the middle was
    // tried first and it read as a TUBE — a rod laid on the page rather than
    // ink pressed into it, because a highlight running the length of a band is
    // what tells an eye the band is round.
    rect(g, x, y, x, y, SEAL_DARK);
    rect(g, x, y + 3, x, y + 3, SEAL_DARK);
    // Where the impression skipped. Punched back to whatever is underneath, so
    // the page shows through — that is what ink does and paint does not.
    if (x % 11 === 3) {
      put(g, x, y + 1, x >= 16 && x <= 46 ? PAPER : DESK);
      put(g, x + 1, y + 2, x + 1 >= 16 && x + 1 <= 46 ? PAPER : DESK);
    }
  }
  return g;
}

/**
 * DEFIANCE — they objected, it went out anyway, and this is what it cost.
 *
 * A line falling off a chart. `COMPULSION_BREACH_DISSENT` is 15 and around
 * eight of them reach the cap, so what a player is actually being told is that
 * standing behind them has just dropped and will not come back on its own —
 * `DISSENT_DECAY` is 2 a turn and disposition has no decay at all.
 *
 * Deliberately the most conventional image in the game. Every other picture
 * here is trying to say something a sentence cannot; this one is trying to be
 * understood before the sentence is read, and a falling red line is the fastest
 * thing there is.
 */
function defiance(): Grid {
  const g = blank();
  rect(g, 0, 0, OUTCOME_W - 1, OUTCOME_H - 1, CHART_BG);

  /**
   * A face on the axis, which is what makes this a chart OF something.
   *
   * A falling red line says "down" and nothing at all about what. The whole
   * content of a defiance is that your own institutions objected and you went
   * ahead — so what is falling is how your own people feel about you, and a
   * smile at the top of the scale says that in less time than the word
   * "dissent" takes to read.
   *
   * At the TOP because that is where the line starts. It is a label for the
   * high end of the axis, so it reads as the thing being left behind.
   */
  const fx = 6;
  const fy = 8;
  for (let y = fy - 4; y <= fy + 4; y++) {
    for (let x = fx - 4; x <= fx + 4; x++) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx * dx + dy * dy <= 17) put(g, x, y, MOOD);
    }
  }
  put(g, fx - 2, fy - 2, CHART_BG);
  put(g, fx + 2, fy - 2, CHART_BG);
  // A curve, not a bar. A straight five-pixel mouth with notches at the cheeks
  // cut the disc in half and read as a slot rather than a smile — the corners
  // have to come UP or there is no expression in it.
  put(g, fx - 2, fy + 1, CHART_BG);
  rect(g, fx - 1, fy + 2, fx + 1, fy + 2, CHART_BG);
  put(g, fx + 2, fy + 1, CHART_BG);

  // Gridlines, faint enough to be a surface rather than a subject.
  for (let y = 5; y <= 29; y += 6) rect(g, 13, y, 61, y, GRID);
  for (let x = 13; x <= 61; x += 9) rect(g, x, 3, x, 31, GRID);

  // Axes. Ticks only below the face, which owns the top of the gutter.
  rect(g, 11, 3, 12, 32, AXIS);
  rect(g, 11, 31, 61, 32, AXIS);
  for (const y of [17, 23, 29]) rect(g, 9, y, 10, y, AXIS);

  /**
   * The line itself: high at the left, ragged, and off the bottom by the right.
   *
   * Plotted from a fixed table rather than a curve, because a curve that looks
   * like a collapse at 64 pixels wide has to be drawn by eye anyway — and a
   * table is something a reader of this file can adjust without solving for it.
   */
  const points: [number, number][] = [
    [14, 7], [19, 6], [25, 9], [30, 8], [35, 13], [40, 12], [45, 18], [49, 22], [54, 25], [61, 29],
  ];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let st = 0; st <= steps; st++) {
      const x = Math.round(x0 + ((x1 - x0) * st) / steps);
      const y = Math.round(y0 + ((y1 - y0) * st) / steps);
      // Two pixels thick, so it survives being shown small.
      rect(g, x, y, x, y + 1, SEAL);
    }
  }

  // **No arrowhead.** Two were tried — a filled wedge, then a pair of barbs —
  // and both came out as a blob of red in the corner: any head large enough to
  // read at 64 pixels is large enough to stop reading as a point, and this one
  // sat against the axis where it merged with it besides.
  //
  // The line runs off the right edge instead, which says the same thing and
  // says it with the shape already there: it has not levelled off, it has left.
  return g;
}

/* ------------------------------------------------------------------ */
/* Out                                                                 */
/* ------------------------------------------------------------------ */

const SCENES: Record<OutcomeArtKind, () => Grid> = {
  refusal,
  defiance,
};

export interface OutcomeRun {
  x: number;
  y: number;
  width: number;
  colour: string;
}

const cache = new Map<OutcomeArtKind, OutcomeRun[]>();

/**
 * One scene as horizontal runs.
 *
 * Merged here rather than in the component, the same trick `worldRuns` plays:
 * 2,304 cells becomes a few hundred rects, and the work happens somewhere a
 * test can see it.
 */
export function outcomeRuns(kind: OutcomeArtKind): OutcomeRun[] {
  const hit = cache.get(kind);
  if (hit) return hit;
  const g = SCENES[kind]();
  const runs: OutcomeRun[] = [];
  for (let y = 0; y < OUTCOME_H; y++) {
    let x = 0;
    while (x < OUTCOME_W) {
      const colour = g[y]![x]!;
      let width = 1;
      while (x + width < OUTCOME_W && g[y]![x + width] === colour) width += 1;
      runs.push({ x, y, width, colour });
      x += width;
    }
  }
  cache.set(kind, runs);
  return runs;
}

/** The raw grid. Exported for tests and for anything that wants to sample it. */
export function outcomePixels(kind: OutcomeArtKind): string[][] {
  return SCENES[kind]();
}
