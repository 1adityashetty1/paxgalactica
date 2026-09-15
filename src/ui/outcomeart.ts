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
const STONE_DARK = '#232a34';
const STONE = '#39434f';
const STONE_LIT = '#4d5a68';
const IRON = '#6b7785';
const IRON_DARK = '#4a535e';
const SEAL = '#b3372e';
const SEAL_DARK = '#7a2620';
const COLD = '#16202b';
const WAY_OUT = '#c9a227';
const WAY_OUT_PALE = '#e8cd76';
const PAPER = '#cbc4b4';

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

/**
 * The doorway both rulings are drawn in.
 *
 * A rounded arch rather than a square opening, because a square one reads as a
 * window and the whole point is that this is a way THROUGH that somebody has
 * closed.
 */
const ARCH = { x0: 20, x1: 43, top: 5, floor: 33 } as const;
/**
 * The middle column of the doorway, as an integer.
 *
 * `(x0 + x1) / 2` is 31.5, and a loop written off that steps 24.5, 25.5, … —
 * which `put` happily writes as string keys on the row array, so the pixels go
 * nowhere and the scene renders without them. That is exactly what happened to
 * the light behind the broken door: the whole effect was missing and nothing
 * errored.
 */
const ARCH_MID = Math.round((ARCH.x0 + ARCH.x1) / 2);

function archway(g: Grid): void {
  const cx = (ARCH.x0 + ARCH.x1) / 2;
  const rx = (ARCH.x1 - ARCH.x0) / 2;
  const springLine = ARCH.top + rx; // where the curve meets the jambs

  const insideArch = (x: number, y: number): boolean => {
    if (y > ARCH.floor) return false;
    if (y >= springLine) return x >= ARCH.x0 && x <= ARCH.x1;
    const dx = (x - cx) / rx;
    const dy = (y - springLine) / rx;
    return dx * dx + dy * dy <= 1;
  };

  // The wall the arch is cut into. Courses run the full width and the vertical
  // joints break every other row, which is what makes it read as masonry — the
  // first version drew both at once and produced a field of plus signs.
  rect(g, 4, 1, 59, ARCH.floor, STONE_DARK);
  for (let y = 1; y <= ARCH.floor; y += 5) {
    rect(g, 4, y, 59, y, STONE);
    const offset = ((y - 1) / 5) % 2 === 0 ? 0 : 6;
    for (let x = 4 + offset; x <= 59; x += 12) rect(g, x, y + 1, x, Math.min(y + 4, ARCH.floor), STONE);
  }

  // The opening. Deliberately DARKER than the wall rather than lighter: a bright
  // slab reads as a window with something behind it, and a dark one reads as a
  // way through — which is what has been closed.
  for (let y = 0; y <= ARCH.floor; y++) {
    for (let x = 0; x < OUTCOME_W; x++) {
      if (insideArch(x, y)) put(g, x, y, y > 27 ? VOID : COLD);
    }
  }

  // A lit edge on the left jamb and voussoirs, so the arch has depth.
  for (let y = 0; y <= ARCH.floor; y++) {
    for (let x = 0; x < OUTCOME_W; x++) {
      if (!insideArch(x, y)) continue;
      if (!insideArch(x - 1, y) || !insideArch(x, y - 1)) put(g, x, y, STONE_LIT);
    }
  }

  // Floor.
  rect(g, 0, ARCH.floor + 1, OUTCOME_W - 1, OUTCOME_H - 1, STONE_DARK);
  rect(g, 0, ARCH.floor + 1, OUTCOME_W - 1, ARCH.floor + 1, STONE);
}

/** Portcullis bars in the opening. `broken` leaves a torn gap in the middle. */
function portcullis(g: Grid, broken: boolean): void {
  const cx = ARCH_MID;
  const rx = (ARCH.x1 - ARCH.x0) / 2;
  const springLine = ARCH.top + rx;
  const inside = (x: number, y: number): boolean => {
    if (y > ARCH.floor) return false;
    if (y >= springLine) return x >= ARCH.x0 + 1 && x <= ARCH.x1 - 1;
    const dx = (x - cx) / rx;
    const dy = (y - springLine) / rx;
    return dx * dx + dy * dy <= 0.86;
  };
  for (let x = ARCH.x0 + 2; x <= ARCH.x1 - 2; x += 4) {
    for (let y = ARCH.top; y <= ARCH.floor; y++) {
      if (!inside(x, y)) continue;
      // The way out, torn open in the middle and bent aside.
      if (broken && x > cx - 7 && x < cx + 7 && y > 14) continue;
      put(g, x, y, IRON_DARK);
    }
  }
  // Two cross-members, which is what makes it a grate and not a fence.
  for (const y of [12, 22]) {
    for (let x = ARCH.x0 + 1; x <= ARCH.x1 - 1; x++) {
      if (!inside(x, y)) continue;
      if (broken && y === 22 && x > cx - 7 && x < cx + 7) continue;
      put(g, x, y, IRON_DARK);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The scenes                                                          */
/* ------------------------------------------------------------------ */

/**
 * REFUSAL — the door does not open, and the seal on it is whole.
 *
 * The order was never carried out, so nothing about this picture is damaged.
 * That is the reading the mechanic wants: a refusal is not a failure, it is an
 * order that never went out, and `submitAction` stages nothing at all.
 */
function refusal(): Grid {
  const g = blank();
  archway(g);
  portcullis(g, false);

  // The bar: iron, unbroken, straight across the whole doorway and into the
  // jambs either side — held by the wall, not resting against it.
  rect(g, 13, 19, 50, 22, IRON);
  rect(g, 13, 19, 50, 19, STONE_LIT);
  rect(g, 13, 22, 50, 22, IRON_DARK);
  // Brackets in the stone.
  rect(g, 12, 18, 14, 23, STONE_LIT);
  rect(g, 49, 18, 51, 23, STONE_LIT);

  // The seal over the join: whole, and the colour of an institution saying no.
  rect(g, 28, 16, 35, 25, SEAL_DARK);
  rect(g, 29, 17, 34, 24, SEAL);
  rect(g, 31, 19, 32, 22, SEAL_DARK);

  // The order itself, put down at the foot of the door.
  rect(g, 16, 29, 26, 33, PAPER);
  rect(g, 16, 29, 26, 29, STONE_LIT);
  rect(g, 18, 31, 24, 31, STONE_DARK);
  rect(g, 18, 32, 22, 32, STONE_DARK);
  rect(g, 25, 29, 26, 33, IRON_DARK);
  return g;
}

/**
 * DEFIANCE — the same door, gone through.
 *
 * The bar is snapped and its halves hang; the seal is in pieces on the floor;
 * the way beyond is lit rather than cold. Nothing here says the order failed,
 * because it did not — a compulsion breach lets the ops land and charges
 * `COMPULSION_BREACH_DISSENT` for having insisted.
 */
function defiance(): Grid {
  const g = blank();
  archway(g);

  // The way beyond, lit. The whole opening below the upper cross-member goes
  // warm — the first version lit a band and then drew the figure and the bars
  // over it, which left two gold lobes either side of a silhouette and read as
  // curtains. An open door is open all the way across.
  const rx = (ARCH.x1 - ARCH.x0) / 2;
  const springLine = ARCH.top + rx;
  // **The WHOLE opening goes warm, including the head of the arch.** Lighting
  // it from a band downward leaves the dark curve above the light, and that
  // curve then reads as a helmet sitting on a lit robe rather than as a door
  // standing open. An open door is open to the top.
  for (let y = ARCH.top; y <= ARCH.floor; y++) {
    for (let x = ARCH.x0 + 1; x <= ARCH.x1 - 1; x++) {
      if (y < springLine) {
        const dx = (x - ARCH_MID) / rx;
        const dy = (y - springLine) / rx;
        if (dx * dx + dy * dy > 0.9) continue;
      }
      put(g, x, y, y > 27 ? WAY_OUT : WAY_OUT_PALE);
    }
  }

  // What is left of the grate: stubs hanging at the jambs, torn out of the
  // middle. Kept OFF the lit centre, because iron drawn across the light is
  // read as pattern on a surface and not as wreckage in front of a gap.
  rect(g, ARCH.x0 + 1, ARCH.top + 6, ARCH.x0 + 2, 17, IRON_DARK);
  rect(g, ARCH.x1 - 2, ARCH.top + 6, ARCH.x1 - 1, 15, IRON_DARK);
  rect(g, ARCH.x0 + 1, 11, ARCH.x0 + 6, 12, IRON_DARK);
  rect(g, ARCH.x1 - 6, 11, ARCH.x1 - 1, 12, IRON_DARK);
  rect(g, ARCH.x0 + 5, 13, ARCH.x0 + 6, 18, IRON_DARK);
  rect(g, ARCH.x1 - 6, 13, ARCH.x1 - 5, 16, IRON_DARK);

  // Whoever insisted, walking out through it. A silhouette rather than a face:
  // this is the player, and the player has no portrait in this game. Read as a
  // hole in the light, which is why the light had to be whole first.
  const m = ARCH_MID;
  rect(g, m - 2, 13, m + 1, 17, VOID);         // head
  rect(g, m - 1, 18, m, 18, VOID);             // neck
  rect(g, m - 4, 19, m + 3, 27, VOID);         // shoulders and torso
  rect(g, m - 5, 20, m - 5, 26, VOID);         // arms, clear of the body
  rect(g, m + 4, 20, m + 4, 26, VOID);
  rect(g, m - 4, 28, m - 2, ARCH.floor, VOID); // legs, mid-stride
  rect(g, m + 2, 28, m + 3, ARCH.floor - 2, VOID);

  // The bar, snapped. Drawn LAST so the break sits in front of the light, and
  // with a real gap either side of the middle — the halves droop toward it and
  // end ragged.
  for (let x = 11; x <= 26; x++) {
    const drop = Math.max(0, Math.floor((x - 18) / 2));
    const ragged = x > 24 ? 1 : 0;
    rect(g, x, 19 + drop, x, 22 + drop - ragged, IRON);
    put(g, x, 19 + drop, STONE_LIT);
  }
  for (let x = 37; x <= 52; x++) {
    const drop = Math.max(0, Math.floor((45 - x) / 2));
    const ragged = x < 39 ? 1 : 0;
    rect(g, x, 19 + drop, x, 22 + drop - ragged, IRON);
    put(g, x, 19 + drop, STONE_LIT);
  }
  rect(g, 10, 18, 12, 23, STONE_LIT);
  rect(g, 51, 18, 53, 23, STONE_LIT);

  // The seal that was over the join, in pieces: still falling, and on the floor.
  put(g, 28, 16, SEAL);
  put(g, 35, 14, SEAL_DARK);
  put(g, 27, 24, SEAL);
  put(g, 36, 26, SEAL_DARK);
  rect(g, 24, 32, 27, 33, SEAL_DARK);
  rect(g, 37, 33, 40, 33, SEAL);
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
