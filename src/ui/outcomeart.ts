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
/* The Rim's own events (item 124)                                     */
/* ------------------------------------------------------------------ */

const STAR_DIM = '#2b3440';
const STAR = '#6d7480';
const LANE = '#2c6b66';
const WORLD = '#8a94a3';
const WORLD_LIT = '#c3cad4';
const STORM_DARK = '#261f47';
const STORM = '#40357a';
const STORM_LIT = '#6f62b8';
const BOLT = '#f2f7ff';
const BOLT_GLOW = '#8fd3ff';

/** A filled disc. */
const disc = (g: Grid, cx: number, cy: number, r: number, c: string): void => {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r + r) put(g, x, y, c);
    }
  }
};

/**
 * ION STORM — a storm cloud with a bolt in it, sitting on a trade lane that
 * stops underneath it.
 *
 * The cloud and the bolt are the most conventional storm there is, which is the
 * point: the refusal stamp's lesson is that a picture has to be understood
 * before the sentence under it is read. Space is said by the stars and by the
 * lane — two worlds and a dashed line, the way the map draws one — and what the
 * event DOES is said by the gap: the lane runs in from both sides and is gone
 * where the bolt comes down.
 */
function ionStorm(): Grid {
  const g = blank();

  // A few stars, fixed so the scene is the same every time it is drawn.
  for (const [x, y] of [[3, 4], [11, 2], [55, 3], [60, 9], [5, 16], [58, 19], [17, 31], [48, 32], [62, 30], [2, 33]] as const) {
    put(g, x, y, STAR_DIM);
  }
  for (const [x, y] of [[8, 7], [52, 6], [14, 21], [61, 25]] as const) put(g, x, y, STAR);

  // The lane, dashed as the map dashes it, cut where the storm sits.
  const LANE_Y = 27;
  for (let x = 10; x <= 54; x++) {
    if (x >= 24 && x <= 40) continue;
    if (x % 4 < 3) put(g, x, LANE_Y, LANE);
  }
  // A world at each end, lit from the upper left.
  for (const wx of [7, 57]) {
    disc(g, wx, LANE_Y, 3, WORLD);
    put(g, wx - 1, LANE_Y - 2, WORLD_LIT);
    put(g, wx - 2, LANE_Y - 1, WORLD_LIT);
  }

  // The cloud: overlapping discs with a flat underside. Shaded after it is
  // laid down — lit where nothing is above a pixel, dark along the bottom — so
  // it reads as a mass rather than a flat blob.
  const cloud = blank();
  // Puffs of clearly different sizes, so the top is bumpy the way a drawn
  // cloud's is; evenly sized ones merged into a mound.
  for (const [cx, cy, r] of [[19, 13, 4], [26, 10, 5], [35, 8, 7], [45, 12, 4], [31, 13, 4], [40, 13, 4]] as const) {
    disc(cloud, cx, cy, r, STORM);
  }
  for (let y = 16; y < OUTCOME_H; y++) for (let x = 0; x < OUTCOME_W; x++) cloud[y]![x] = VOID;
  for (let y = 0; y < OUTCOME_H; y++) {
    for (let x = 0; x < OUTCOME_W; x++) {
      if (cloud[y]![x] !== STORM) continue;
      const above = y > 0 ? cloud[y - 1]![x] : VOID;
      const below = y < OUTCOME_H - 1 ? cloud[y + 1]![x] : VOID;
      put(g, x, y, above === VOID ? STORM_LIT : below === VOID || y >= 14 ? STORM_DARK : STORM);
    }
  }

  // The bolt: a zigzag two pixels wide from the cloud's belly to the gap in the
  // lane, with a glow down its left side so it reads as light, not as a line.
  const bolt: [number, number][] = [[33, 16], [29, 21], [34, 21], [31, 27]];
  for (let i = 0; i < bolt.length - 1; i++) {
    const [x0, y0] = bolt[i]!;
    const [x1, y1] = bolt[i + 1]!;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let st = 0; st <= steps; st++) {
      const x = Math.round(x0 + ((x1 - x0) * st) / steps);
      const y = Math.round(y0 + ((y1 - y0) * st) / steps);
      put(g, x - 1, y, BOLT_GLOW);
      put(g, x, y, BOLT);
      put(g, x + 1, y, BOLT);
    }
  }
  // Where it strikes the lane: a short burst on either side.
  for (const [x, y] of [[28, 27], [34, 27], [29, 26], [33, 26], [31, 28]] as const) put(g, x, y, BOLT_GLOW);
  return g;
}

const HULL_DARK = '#353c49';
const HULL = '#586272';
const HULL_LIT = '#808b9b';
const RUST = '#8a4e2c';
const DEAD_WINDOW = '#161c25';
const SCOUT = '#3fb8ad';
const SCOUT_DARK = '#23766f';
const SCOUT_LIT = '#9ff0e7';
const LAMP = '#fdfcf0';
const BEAM = '#161f2a';
const BEAM_LIT = '#22303f';
/** Hull under the searchlight: the same metal, lit. */
const SPOT: Record<string, string> = {
  [HULL_DARK]: '#7f8a99',
  [HULL]: '#b4bfcc',
  [HULL_LIT]: '#e1e7ee',
  [RUST]: '#d08a55',
  [DEAD_WINDOW]: '#3a4350',
};

/**
 * DERELICT — a hulk broken in two, and a searchlight on it.
 *
 * The wreck says what was found; the light says somebody found it, which is
 * the event — a power's ships were there, and the prize is theirs. The beam is
 * faint over empty space and **bright where it lands on the hull**, because a
 * spot of lit metal is what makes a cone read as light rather than as a smear.
 * The break is jagged and rust-edged, since a clean gap between two hull halves
 * reads as two ships.
 */
function derelict(): Grid {
  const g = blank();
  for (const [x, y] of [[4, 3], [15, 6], [27, 2], [45, 4], [59, 7], [62, 16], [3, 20], [52, 30], [30, 33], [60, 33]] as const) {
    put(g, x, y, STAR_DIM);
  }
  for (const [x, y] of [[9, 9], [56, 12], [22, 30]] as const) put(g, x, y, STAR);

  // The searchlight: a cone from the scout's lamp toward the break amidships.
  const lamp: [number, number] = [14, 28];
  const aim: [number, number] = [31, 17];
  const len = Math.hypot(aim[0] - lamp[0], aim[1] - lamp[1]);
  const dir = [(aim[0] - lamp[0]) / len, (aim[1] - lamp[1]) / len] as const;
  const inBeam = (x: number, y: number): 'core' | 'edge' | null => {
    const px = x - lamp[0];
    const py = y - lamp[1];
    const along = px * dir[0] + py * dir[1];
    if (along < 1 || along > len + 4) return null;
    const perp = Math.abs(px * dir[1] - py * dir[0]);
    if (perp <= 0.4 + along * 0.1) return 'core';
    if (perp <= 0.6 + along * 0.2) return 'edge';
    return null;
  };
  for (let y = 0; y < OUTCOME_H; y++) {
    for (let x = 0; x < OUTCOME_W; x++) {
      const b = inBeam(x, y);
      if (b) put(g, x, y, b === 'core' ? BEAM_LIT : BEAM);
    }
  }

  // The aft half: engine block, hull, a row of dead windows.
  rect(g, 15, 15, 18, 21, HULL_DARK);
  rect(g, 13, 16, 14, 17, HULL_DARK);
  rect(g, 13, 19, 14, 20, HULL_DARK);
  rect(g, 19, 14, 33, 21, HULL);
  rect(g, 19, 14, 33, 14, HULL_LIT);
  rect(g, 19, 21, 33, 21, HULL_DARK);
  for (let x = 21; x <= 31; x += 3) put(g, x, 17, DEAD_WINDOW);
  // Its broken end: jagged, and rust where the metal tore.
  for (const [y, x] of [[14, 34], [15, 35], [16, 34], [17, 35], [18, 36], [19, 35], [20, 34], [21, 33]] as const) {
    rect(g, 33, y, x, y, HULL);
    put(g, x, y, RUST);
  }

  // The bow half, knocked up and away from the break, tapering to a point.
  const bowTop = 11;
  for (const [y, x0, x1] of [
    [bowTop, 40, 49], [bowTop + 1, 39, 52], [bowTop + 2, 40, 54], [bowTop + 3, 39, 55],
    [bowTop + 4, 40, 54], [bowTop + 5, 39, 52], [bowTop + 6, 40, 49],
  ] as const) {
    rect(g, x0, y, x1, y, HULL);
    put(g, x0, y, RUST);
  }
  rect(g, 41, bowTop, 49, bowTop, HULL_LIT);
  rect(g, 41, bowTop + 6, 49, bowTop + 6, HULL_DARK);
  for (let x = 43; x <= 50; x += 3) put(g, x, bowTop + 3, DEAD_WINDOW);

  // Where the light lands, the metal is lit.
  for (let y = 0; y < OUTCOME_H; y++) {
    for (let x = 0; x < OUTCOME_W; x++) {
      const lit = SPOT[g[y]![x]!];
      if (lit && inBeam(x, y)) put(g, x, y, lit);
    }
  }

  // What came off it, drifting in the gap.
  for (const [x, y] of [[37, 9], [38, 22], [36, 24], [42, 21], [35, 11]] as const) put(g, x, y, HULL_LIT);
  put(g, 39, 8, RUST);

  // The scout that found it: a small ship nosed toward the wreck, its lamp lit.
  const [lx, ly] = lamp;
  rect(g, lx - 6, ly, lx - 1, ly, SCOUT);
  rect(g, lx - 5, ly + 1, lx - 2, ly + 1, SCOUT_DARK);
  rect(g, lx - 4, ly - 1, lx - 2, ly - 1, SCOUT_LIT);
  put(g, lx - 7, ly - 1, SCOUT_DARK);
  put(g, lx - 7, ly + 1, SCOUT_DARK);
  put(g, lx, ly, LAMP);
  return g;
}

/* ------------------------------------------------------------------ */
/* Out                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Random events with a scene. **Each one is here because the user approved it**
 * — rendered at feed size and larger and put in front of them before it was
 * committed (item 124) — and every other kind falls back to the text card.
 */
export const RIM_ART_KINDS = ['ion_storm', 'derelict'] as const;
export type RimArtKind = (typeof RIM_ART_KINDS)[number];

const RIM_SCENES: Record<RimArtKind, () => Grid> = {
  ion_storm: ionStorm,
  derelict,
};

export function hasRimArt(kind: string): kind is RimArtKind {
  return (RIM_ART_KINDS as readonly string[]).includes(kind);
}

/** A random event's scene, as the raw grid. */
export function rimEventPixels(kind: RimArtKind): string[][] {
  return RIM_SCENES[kind]();
}

const rimCache = new Map<RimArtKind, OutcomeRun[]>();

/** A random event's scene as horizontal runs, the way `outcomeRuns` does it. */
export function rimEventRuns(kind: RimArtKind): OutcomeRun[] {
  const hit = rimCache.get(kind);
  if (hit) return hit;
  const runs = toRuns(RIM_SCENES[kind]());
  rimCache.set(kind, runs);
  return runs;
}

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
  const runs = toRuns(SCENES[kind]());
  cache.set(kind, runs);
  return runs;
}

function toRuns(g: Grid): OutcomeRun[] {
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
  return runs;
}

/** The raw grid. Exported for tests and for anything that wants to sample it. */
export function outcomePixels(kind: OutcomeArtKind): string[][] {
  return SCENES[kind]();
}
