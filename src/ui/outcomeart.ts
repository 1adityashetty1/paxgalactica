import { ESCORT_GLYPH, rasterise } from './glyphs.js';

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

const NIGHT = '#0c0f15';
const HAZE_HIGH = '#1c1519';
const HAZE = '#2c1b17';
const HAZE_LOW = '#3d2318';
const GROUND = '#120e0c';
const FORT = '#3a4150';
const FORT_DARK = '#272c36';
const FORT_LIT = '#4f5868';
const SLIT = '#c9a227';
const WINDOW_BAND = '#bcd7e6';
const SHUTTER = '#323844';
const MAST = '#6b7584';
const BEACON = '#ff4d3d';
const FLOOD = '#fdfcf0';
const FLOOD_GLOW = '#8a8a6a';
const BANNER = '#b3372e';
const BANNER_DARK = '#7a2620';
const CROWD = '#050608';
const FLAME = '#f59e0b';
const FLAME_CORE = '#fde68a';
const FLAME_TIP = '#ea580c';
const HAZE_GLOW = '#8a4a1c';
const FIRE_SKY = '#4d2a1a';
const FIRE_SKY_LOW = '#6a3518';
const TORCH_HAFT = '#3b2416';

/**
 * UNREST — a crowd with torches, in front of the occupier's post.
 *
 * Torches over a crowd is the oldest picture of a rising there is, and it reads
 * before anything else does. The crowd is drawn in silhouette against a sky the
 * fires have lit, because black figures on a black sky are nothing at all. The
 * post is the garrison the rising is costing, and its flag is the occupier's —
 * the event only ever happens on ground that was somebody else's first.
 */
function unrest(): Grid {
  const g = blank();
  // Night overhead, and the horizon lit orange by the fires — bright enough that
  // a black figure stands out against it, which is the whole of a silhouette.
  rect(g, 0, 0, OUTCOME_W - 1, OUTCOME_H - 1, NIGHT);
  const bands: [number, string][] = [[12, HAZE_HIGH], [16, HAZE], [20, HAZE_LOW], [24, FIRE_SKY], [28, FIRE_SKY_LOW]];
  for (const [y0, c] of bands) rect(g, 0, y0, OUTCOME_W - 1, OUTCOME_H - 1, c);
  for (const [x, y] of [[5, 3], [17, 6], [30, 2], [38, 8], [61, 5]] as const) put(g, x, y, STAR_DIM);

  // The garrison post, contemporary rather than a keep: a flat-roofed prefab
  // block with a control tier, a lit window band, panel seams and a roll-up
  // shutter for a gate — and the occupier's banner on a comms mast, a red
  // beacon on the antenna and a floodlight on the corner. Battlements read as
  // a castle at any size, which put the scene in the wrong century.
  rect(g, 43, 19, 62, 35, FORT);
  rect(g, 43, 19, 62, 19, FORT_LIT);
  rect(g, 61, 20, 62, 35, FORT_DARK);
  for (const x of [47, 51, 55, 59]) rect(g, x, 20, x, 35, FORT_DARK);
  rect(g, 46, 23, 59, 23, WINDOW_BAND);
  rect(g, 48, 12, 59, 18, FORT);
  rect(g, 48, 12, 59, 12, FORT_LIT);
  rect(g, 58, 13, 59, 18, FORT_DARK);
  rect(g, 49, 15, 57, 16, WINDOW_BAND);
  // The shutter: a wide door in horizontal slats.
  rect(g, 48, 28, 56, 35, FORT_DARK);
  for (let y = 29; y <= 35; y += 2) rect(g, 48, y, 56, y, SHUTTER);
  // Comms mast with the banner, and an antenna with a beacon.
  rect(g, 50, 3, 50, 11, MAST);
  rect(g, 51, 3, 55, 5, BANNER);
  rect(g, 51, 5, 55, 5, BANNER_DARK);
  rect(g, 58, 7, 58, 11, MAST);
  rect(g, 57, 9, 59, 9, MAST);
  put(g, 58, 6, BEACON);
  // A floodlight on the corner, lit.
  rect(g, 43, 17, 44, 18, MAST);
  put(g, 42, 18, FLOOD);
  put(g, 41, 19, FLOOD_GLOW);
  put(g, 42, 19, FLOOD_GLOW);

  // Glow around each torch, laid down before the people so they stand in it.
  const torches: [number, number][] = [];

  // Four people: a round head, a neck, broad shoulders, and a body to the
  // bottom edge. Fewer and larger than a crowd really is, because at feed size
  // a head has to be several pixels to be a head at all. A fifth stood against
  // the post's wall, and a figure touching the building flattened the distance
  // between the crowd and it.
  const person = (x: number, h: number, raised: 'torch' | 'fist' | null) => {
    rect(g, x + 1, h, x + 2, h, CROWD);
    rect(g, x, h + 1, x + 3, h + 2, CROWD);
    rect(g, x + 1, h + 3, x + 2, h + 3, CROWD);
    rect(g, x - 1, h + 4, x + 4, OUTCOME_H - 1, CROWD);
    put(g, x - 1, h + 4, before(x - 1, h + 4));
    put(g, x + 4, h + 4, before(x + 4, h + 4));
    if (!raised) return;
    // A thick arm straight up from the shoulder.
    rect(g, x + 4, h - 2, x + 5, h + 5, CROWD);
    if (raised === 'fist') {
      rect(g, x + 4, h - 3, x + 6, h - 2, CROWD);
      return;
    }
    rect(g, x + 4, h - 4, x + 5, h - 2, TORCH_HAFT);
    torches.push([x + 4, h - 5]);
  };
  // What was there before the person, so a rounded shoulder shows the sky.
  const sky = g.map((row) => [...row]);
  const before = (x: number, y: number) => sky[y]?.[x] ?? NIGHT;

  for (const [x, h, raised] of [
    [3, 19, 'fist'], [11, 17, 'torch'], [20, 20, null], [28, 18, 'torch'],
  ] as const) {
    person(x, h, raised);
  }

  // The flames, last, over everything.
  for (const [fx, fy] of torches) {
    for (const [dx, dy] of [[-2, -1], [3, -1], [-2, -2], [3, -2], [-1, -4], [2, -4], [0, -5], [1, -5]] as const) {
      put(g, fx + dx, fy + dy, HAZE_GLOW);
    }
    rect(g, fx - 1, fy - 3, fx + 2, fy, FLAME);
    rect(g, fx, fy - 2, fx + 1, fy, FLAME_CORE);
    rect(g, fx, fy - 4, fx + 1, fy - 4, FLAME_TIP);
  }
  return g;
}

const BORDER = '#4a5260';
const BUOY = '#b3372e';
const BUOY_LIT = '#ff6a5c';
const LEFT_HULL = '#4f7fa8';
const LEFT_LIT = '#86b4d8';
const LEFT_DARK = '#30536f';
const RIGHT_HULL = '#a8743f';
const RIGHT_LIT = '#d8a56a';
const RIGHT_DARK = '#6e4a27';
const SHOT_COOL = '#8fd3ff';
const SHOT_COOL_CORE = '#e8f7ff';
const SHOT_WARM = '#f59e0b';
const SHOT_WARM_CORE = '#fde68a';
const EXHAUST = '#2c6b66';
const SHOT_COOL_TRAIL = '#2f5f7a';
const SHOT_WARM_TRAIL = '#7a4a12';

/**
 * The escort, as pixels: the same silhouette the order of battle draws
 * (`ESCORT_GLYPH`), rasterised at 16 — the smallest size at which its swept
 * wings stay wings. `w` wing, `#` hull, `D` drive, `.` empty; nosed right.
 */
function escortStencil(n: number): string[] {
  const all = rasterise([ESCORT_GLYPH.hull, ...ESCORT_GLYPH.wings, ESCORT_GLYPH.drive], n);
  const hull = rasterise([ESCORT_GLYPH.hull], n);
  const drive = rasterise([ESCORT_GLYPH.drive], n);
  return all.map((row, r) =>
    row.map((on, c) => (!on ? '.' : drive[r]![c] ? 'D' : hull[r]![c] ? '#' : 'w')).join(''),
  );
}
const ESCORT_SPRITE: string[] = escortStencil(16);

/**
 * BORDER INCIDENT — two ships either side of a marked line, trading fire across
 * it.
 *
 * The line is what makes it a border rather than a battle: dashed, and buoyed
 * at both ends so it reads as something laid down rather than a stray mark. The
 * two sides are told apart by colour — cool against warm, hull and shot alike —
 * because the event is about two powers, and neither is anybody in particular.
 * Small ships and a few bolts, not a fleet action: nobody ordered this.
 */
function borderIncident(): Grid {
  const g = blank();
  for (const [x, y] of [[4, 3], [14, 8], [24, 2], [41, 5], [53, 3], [60, 11], [7, 30], [20, 33], [45, 31], [58, 28]] as const) {
    put(g, x, y, STAR_DIM);
  }
  for (const [x, y] of [[10, 26], [50, 9]] as const) put(g, x, y, STAR);

  // The border: dashed, buoyed at both ends.
  for (let y = 3; y <= 32; y++) if (y % 4 < 2) put(g, 32, y, BORDER);
  for (const by of [2, 33]) {
    put(g, 32, by - 1, BUOY);
    rect(g, 31, by, 33, by, BUOY);
    put(g, 32, by + 1, BUOY);
    put(g, 32, by, BUOY_LIT);
  }

  // An escort each side, nose to the line — the order of battle's own ship.
  const ship = (x0: number, y0: number, facingRight: boolean, hull: string, lit: string, dark: string) => {
    const width = ESCORT_SPRITE[0]!.length;
    const hullRows = ESCORT_SPRITE.map((row, r) => (row.includes('#') ? r : -1)).filter((r) => r >= 0);
    const top = Math.min(...hullRows);
    ESCORT_SPRITE.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === '.') return;
        const x = facingRight ? x0 + dx : x0 + (width - 1 - dx);
        const c = ch === 'w' ? dark : ch === 'D' ? EXHAUST : dy === top ? lit : hull;
        put(g, x, y0 + dy, c);
      });
    });
  };
  ship(1, 6, true, LEFT_HULL, LEFT_LIT, LEFT_DARK);
  ship(47, 10, false, RIGHT_HULL, RIGHT_LIT, RIGHT_DARK);

  // Fire across the line, each side's in its own colour: two bolts apiece,
  // one already past the border.
  // A bolt has a bright head and a fading tail, so it says which way it flies;
  // a dash lit the same at both ends could be going either way.
  const bolt = (head: number, y: number, dir: 1 | -1, core: string, glow: string, trail: string) => {
    put(g, head, y, BOLT);
    put(g, head - dir, y, core);
    put(g, head - 2 * dir, y, glow);
    put(g, head - 3 * dir, y, trail);
    put(g, head - 4 * dir, y, trail);
  };
  bolt(24, 13, 1, SHOT_COOL_CORE, SHOT_COOL, SHOT_COOL_TRAIL);
  bolt(39, 13, 1, SHOT_COOL_CORE, SHOT_COOL, SHOT_COOL_TRAIL);
  bolt(39, 18, -1, SHOT_WARM_CORE, SHOT_WARM, SHOT_WARM_TRAIL);
  bolt(24, 18, -1, SHOT_WARM_CORE, SHOT_WARM, SHOT_WARM_TRAIL);
  return g;
}

const WALL = '#161b23';
const FLOOR = '#262d38';
const FLOOR_LIT = '#323a46';
const RACK = '#5a6474';
const RACK_DARK = '#3b4350';
const GHOST = '#1f2530';
const CRATE = '#8a6a3a';
const CRATE_DARK = '#5e4626';
const CRATE_LIT = '#a8844c';
const SCREEN_FRAME = '#3a4552';
const SCREEN = '#0d1714';
const SCREEN_GRID = '#16241f';
const PRICE = '#fbbf24';

/**
 * SHORTAGE — a rack with almost nothing on it, and a price climbing to the
 * top of the board beside it.
 *
 * An empty shelf only says "empty"; the pale marks where crates used to stand
 * are what say "gone", which is the event. The price board says what scarcity
 * does to a buyer: the line climbs into the top corner of the screen rather
 * than ending in an arrowhead — the falling line in `defiance` learned that a
 * head big enough to read at this size stops reading as a point. It stays
 * inside the frame; a line drawn past it read as a mistake, not as off the
 * scale.
 */
function shortage(): Grid {
  const g = blank();
  rect(g, 0, 0, OUTCOME_W - 1, 28, WALL);
  rect(g, 0, 29, OUTCOME_W - 1, OUTCOME_H - 1, FLOOR);
  rect(g, 0, 29, OUTCOME_W - 1, 29, FLOOR_LIT);

  // The rack: three uprights and three shelves.
  for (const x of [3, 17, 31]) rect(g, x, 4, x + 1, 30, RACK);
  for (const y of [11, 20, 29]) {
    rect(g, 3, y, 32, y, RACK);
    rect(g, 3, y + 1, 32, y + 1, RACK_DARK);
  }
  // Where the crates stood: pale on the wall behind the shelf.
  for (const [x0, y0] of [[6, 5], [11, 5], [20, 5], [25, 5], [20, 14], [25, 14], [6, 23], [20, 23], [25, 23]] as const) {
    rect(g, x0, y0, x0 + 3, y0 + 5, GHOST);
  }
  // The one crate left.
  rect(g, 7, 14, 13, 19, CRATE);
  rect(g, 7, 14, 13, 14, CRATE_LIT);
  rect(g, 7, 17, 13, 17, CRATE_DARK);
  rect(g, 10, 14, 10, 19, CRATE_DARK);

  // The price board: a framed screen with a faint grid and a line that climbs
  // into its top corner.
  rect(g, 37, 4, 61, 24, SCREEN_FRAME);
  rect(g, 38, 5, 60, 23, SCREEN);
  for (let x = 41; x <= 59; x += 5) rect(g, x, 5, x, 23, SCREEN_GRID);
  for (let y = 9; y <= 21; y += 4) rect(g, 38, y, 60, y, SCREEN_GRID);
  const points: [number, number][] = [[39, 21], [43, 20], [46, 21], [49, 17], [52, 15], [55, 10], [58, 6], [60, 4]];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let st = 0; st <= steps; st++) {
      const x = Math.round(x0 + ((x1 - x0) * st) / steps);
      const y = Math.round(y0 + ((y1 - y0) * st) / steps);
      if (y >= 5) rect(g, x, y, x, y + 1, PRICE);
    }
  }
  // The board's stand.
  rect(g, 48, 25, 50, 28, RACK_DARK);
  return g;
}

const FLEET = '#7d8898';
const FLEET_LIT = '#b3bdca';
const FLEET_DARK = '#4b5462';
const DRIVE_LOYAL = '#2c6b66';
const DRIVE_TURNED = '#b3372e';
const TRAIL = '#3a2a2e';

/**
 * MUTINY — a fleet in formation, and two of its own ships turned the other way.
 *
 * The same hull, the same colours: they were this fleet a moment ago, which is
 * the whole difference between a mutiny and an enemy. What separates them is
 * the heading — the formation flies right in good order, and two break off left
 * and down, their drives burning red, with a faint trail back to the place in
 * the line they left. The order of battle's escort again, at 14 pixels — the
 * smallest that keeps its pointed nose — so a formation fits.
 */
function mutiny(): Grid {
  const g = blank();
  for (const [x, y] of [[3, 3], [14, 7], [25, 2], [52, 31], [60, 22], [40, 33], [22, 14], [58, 4]] as const) {
    put(g, x, y, STAR_DIM);
  }
  for (const [x, y] of [[9, 11], [47, 27]] as const) put(g, x, y, STAR);

  const sprite = escortStencil(14);
  const width = sprite[0]!.length;
  const top = Math.min(...sprite.map((row, r) => (row.includes('#') ? r : 99)));
  const escort = (x0: number, y0: number, facingRight: boolean, drive: string) => {
    sprite.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === '.') return;
        const x = facingRight ? x0 + dx : x0 + (width - 1 - dx);
        put(g, x, y0 + dy, ch === 'w' ? FLEET_DARK : ch === 'D' ? drive : dy === top ? FLEET_LIT : FLEET);
      });
    });
  };

  // The trails first, so the ships sit on them: dotted, from each deserter's
  // drive back up toward the gap in the formation.
  for (const [x0, y0, x1, y1] of [[25, 25, 37, 21], [17, 31, 35, 24]] as const) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let st = 0; st <= steps; st += 2) {
      put(g, Math.round(x0 + ((x1 - x0) * st) / steps), Math.round(y0 + ((y1 - y0) * st) / steps), TRAIL);
    }
  }

  // The formation, in good order, heading right.
  escort(49, 6, true, DRIVE_LOYAL);
  escort(36, -1, true, DRIVE_LOYAL);
  escort(36, 13, true, DRIVE_LOYAL);
  // Two of its own, turned and gone.
  escort(11, 18, false, DRIVE_TURNED);
  escort(2, 24, false, DRIVE_TURNED);
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
export const RIM_ART_KINDS = ['ion_storm', 'derelict', 'unrest', 'border_incident', 'shortage', 'mutiny'] as const;
export type RimArtKind = (typeof RIM_ART_KINDS)[number];

const RIM_SCENES: Record<RimArtKind, () => Grid> = {
  ion_storm: ionStorm,
  derelict,
  unrest,
  border_incident: borderIncident,
  shortage,
  mutiny,
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
