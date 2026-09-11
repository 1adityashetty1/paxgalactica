import type { WorldType } from '../domain/state.js';

/**
 * The face of a world, 32x32, as pixels.
 *
 * Pure and DOM-free for the same reason `layout.ts` and `portrait.ts` are: the
 * suite has no DOM, so anything living inside a component is logic nothing
 * checks. This returns a grid of colours and a component turns it into rects.
 *
 * Every sprite is a pure function of its type — the noise is a hash, never
 * `Math.random`, the same discipline `rollD20` follows — so a world looks the
 * same on every machine, in every session, forever. That matters more than it
 * sounds: a planet that reshuffled itself on each render would read as the
 * system panel being broken.
 *
 * The source of truth for a terrain world is the character grid below. `~` is
 * that world's sea, and the other marks are per type. Editing continents means
 * typing, and the diff is readable.
 */

/* eslint-disable */

const N = 32;

/* ------------------------------------------------------------------ */
/* Deterministic noise — a hash, never Math.random, so a sprite is a    */
/* pure function of its type and never changes between builds.          */
/* ------------------------------------------------------------------ */
function hash(x: number, y: number, salt: number): number {
  let h = 2166136261 ^ salt;
  h = Math.imul(h ^ x, 16777619);
  h = Math.imul(h ^ y, 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* The worlds                                                           */
/* ------------------------------------------------------------------ */

const EARTH = [
  '................................',
  '..........~~~~~~~~~~~~..........',
  '..........~~*******~~~..........',
  '.......~~~***********~~~~.......',
  '.....~~~~~~~*******~~~~~~~~.....',
  '....~~~~###~~~~~~~~~~###~~~~....',
  '...~~~~#####~~~~~~~~#####+~~~...',
  '...~~~######~~~~~~~~####++#~~...',
  '..~~~~######+~~~~~~~###++++#~~..',
  '..~~~~#####++~~~~~~~##+++++##~..',
  '.~~~~~~####++~~~~~~~~#++++###~~.',
  '.~~~~~~~###+~~~~~~~~~~#++###~~~.',
  '~~~~~~~~###~~~~~~~~~~~~####~~~~~',
  '~~~~~~~~##~~~~~~~~~~~~~###~~~~~~',
  '~~~~~~~###~~~~~~~~~~~~~##~~~~~~~',
  '~~~~~~~###~~~~~~~~~##~~~#~~~~~~~',
  '~~~~~~~###~~~~~~~~####~~~~~~~~~~',
  '~~~~~~~###+~~~~~~~###~~~~###~~~~',
  '~~~~~~~###+~~~~~~~~#~~~~#####~~~',
  '.~~~~~~###++~~~~~~~~~~~~#####~~.',
  '.~~~~~~~##+++~~~~~~~~~~~####+~~.',
  '..~~~~~~##+++~~~~~~~~~~~###++~~.',
  '..~~~~~~~##++~~~~~~~~~~~~##+~~..',
  '...~~~~~~~##~~~~~~~~~~~~~~#~~~..',
  '...~~~~~~~~#~~~~~~~~~~~~~~~~~...',
  '....~~~~~~~~~~~~~~~~~~~~~~~~....',
  '.....~~~~~~~*******~~~~~~~~.....',
  '.......~~~***********~~~~.......',
  '..........~~*******~~~..........',
  '..........~~~~~~~~~~~~..........',
  '................................',
  '................................',
];

const OCEAN = [
  '................................',
  '..........~~~~~~~~~~~~..........',
  '..........~~~*****~~~~..........',
  '.......~~~~~*******~~~~~........',
  '.....~~~~~~~~~~~~~~~~~~~~~~.....',
  '....~~~~~~~ccc~~~~~~~~~~~~~~....',
  '...~~~~~~cccccc~~~~~~~~~ccc~~...',
  '...~~~#~~~ccc~~~~~~~~~cccccc~~..',
  '..~~~##~~~~~~~~~~~~~~~ccc~~~~~..',
  '..~~~~#~~~~~~~~~~#~~~~~~~~~~~~..',
  '.~~~~~~~~~~~~~~~##~~~~~~~~#~~~~.',
  '.~~~~ccc~~~~~~~~#~~~~~~~~##~~~~.',
  '~~~~cccccc~~~~~~~~~~~~~~~#~~~~~~',
  '~~~~~ccc~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~#~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~##~~~~~~ccc~~~~~~~~~',
  '~~~~~~~~~~~~#~~~~~cccccc~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~ccc~~~~~~~~~~',
  '~~~~#~~~~~~~~~~~~~~~~~~~~~~#~~~~',
  '.~~~##~~~~~~~~~~~~~~~~~~~~##~~~.',
  '.~~~~#~~~~~~ccc~~~~~~~~~~~#~~~~.',
  '..~~~~~~~~~cccccc~~~~~~~~~~~~~..',
  '..~~~~~~~~~~ccc~~~~~~~~#~~~~~~..',
  '...~~~~~~~~~~~~~~~~~~~##~~~~~...',
  '...~~~~~~~~~~~~~~~~~~~~#~~~~~...',
  '....~~~~~~~~~~~~~~~~~~~~~~~~....',
  '.....~~~~~~~~~~~~~~~~~~~~~~.....',
  '.......~~~~~*******~~~~~........',
  '..........~~~*****~~~~..........',
  '..........~~~~~~~~~~~~..........',
  '................................',
  '................................',
];

const ARID = [
  '................................',
  '..........~~~~~~~~~~~~..........',
  '..........~~*******~~~..........',
  '.......~~~~~~~~~~~~~~~~~........',
  '.....~~~~~~~~~~~~~~~~~~~~~~.....',
  '....~~~~~~~~~~~###~~~~~~~~~~....',
  '...~~~~~~~~~~~#####~~~~~~~~~~...',
  '...~~~~###~~~~~###~~~~~~~~~~~~..',
  '..~~~~#####~~~~~~~~~~~~###~~~~..',
  '..~~~~~###~~~~~~~~~~~~#####~~~..',
  '.~~~~~~~~~~~~~~~~~~~~~~###~~~~~.',
  '.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.',
  '~~~~~~~~~~~+++++~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~+++++++~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~+++++~~~~~~~###~~~~~~',
  '~~~~###~~~~~~~~~~~~~~~#####~~~~~',
  '~~~#####~~~~~~~~~~~~~~~###~~~~~~',
  '~~~~###~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~+++++~~~~~~~~~~~',
  '.~~~~~~~~~~~~~~+++++++~~~~~~~~~.',
  '.~~~~~~~~~~~~~~~+++++~~~~~~~~~~.',
  '..~~~~~~~~###~~~~~~~~~~~~~~~~~..',
  '..~~~~~~~#####~~~~~~~~~###~~~~..',
  '...~~~~~~~###~~~~~~~~~#####~~~..',
  '...~~~~~~~~~~~~~~~~~~~~###~~~...',
  '....~~~~~~~~~~~~~~~~~~~~~~~~....',
  '.....~~~~~~~~~~~~~~~~~~~~~~.....',
  '.......~~~~~~~~~~~~~~~~~........',
  '..........~~*******~~~..........',
  '..........~~~~~~~~~~~~..........',
  '................................',
  '................................',
];

const ICE = [
  '................................',
  '..........~~~~~~~~~~~~..........',
  '..........~~~~~~~~~~~~..........',
  '.......~~~~~~~~~~~~~~~~~........',
  '.....~~~~~~~~~+~~~~~~~~~~~~.....',
  '....~~~~~~~~~~+~~~~~~~~~~~~~....',
  '...~~~~+~~~~~~+~~~~~~~~~~~~~~...',
  '...~~~~~+~~~~~+~~~~+++~~~~~~~~..',
  '..~~~~~~+~~~~~~~~~~+~~~~~~~~~~..',
  '..~~~~~~~+~~~~~~~~~+~~~~~~#~~~..',
  '.~~~~~~~~+++~~~~~~~+~~~~~~~~~~~.',
  '.~~~~~~~~~~~+~~~~~~~~~~~~~~~~~~.',
  '~~~~~~~~~~~~~+~~~~~~~~~+++~~~~~~',
  '~~~#~~~~~~~~~~+~~~~~~~~+~~~~~~~~',
  '~~~~~~~~~~~~~~~++~~~~~~+~~~~~~~~',
  '~~~~~~~~~~~~~~~~~+~~~~~+~~~~~~~~',
  '~~~~~~+++~~~~~~~~~~~~~~~+~~~~~~~',
  '~~~~~~~~~+~~~~~~~~~~~~~~+~~~~~~~',
  '~~~~~~~~~~+~~~~~~~~~~~~~~~~~~~~~',
  '.~~~~~~~~~~+~~~~~~~#~~~~~~~~~~~.',
  '.~~~~~~~~~~~~~~~~~~~~~~+++~~~~~.',
  '..~~~~~~~~~~~~~~~~~~~~+~~~~~~~..',
  '..~~~~~~+~~~~~~~~~~~~~+~~~~~~~..',
  '...~~~~~~+~~~~~~~~~~~~~~~~~~~...',
  '...~~~~~~~+~~~~~~~~~~~~~~~~~~...',
  '....~~~~~~~~~~~~~~~~~~~~~~~~....',
  '.....~~~~~~~~~~~~~~~~~~~~~~.....',
  '.......~~~~~~~~~~~~~~~~~........',
  '..........~~~~~~~~~~~~..........',
  '..........~~~~~~~~~~~~..........',
  '................................',
  '................................',
];


const WORLDS: Record<string, any> = {
  earthlike: {
    grid: EARTH, sea: '~', radius: 15.5,
    pal: {
      '~': ['#6fbce8', '#4fa3d8', '#2f7fbf', '#1d5490', '#123a67'],
      '#': ['#a6dd8c', '#8fd07a', '#5aa657', '#3a7440', '#20452c'],
      '+': ['#f0e0a6', '#e3d08f', '#c2a463', '#8e7442', '#5a4a2c'],
      '*': ['#ffffff', '#f2f9ff', '#dbeaf5', '#a8c4dc', '#6f8ca8'],
    },
    rim: '#bfe6ff', night: '#0a1a30',
  },
  // The same world with the sun off it, and the most legible view in the set:
  // the continents draw their own outline, because the lights cluster where
  // people do. The lit crescent is KEPT rather than blacked out — it is what
  // says sphere rather than dark circle with dots on it, and it gives the
  // terminator something to be the edge of.
  earthnight: {
    grid: EARTH, sea: '~', radius: 15.5, nightside: true,
    pal: {
      '~': ['#6fbce8', '#4fa3d8', '#2f7fbf', '#1d5490', '#123a67'],
      '#': ['#a6dd8c', '#8fd07a', '#5aa657', '#3a7440', '#20452c'],
      '+': ['#f0e0a6', '#e3d08f', '#c2a463', '#8e7442', '#5a4a2c'],
      '*': ['#ffffff', '#f2f9ff', '#dbeaf5', '#a8c4dc', '#6f8ca8'],
    },
    // What each terrain becomes once the sun is off it. Ocean goes nearly to
    // black; land keeps a little more, because it is what the lights sit on.
    dark: { '~': '#050b16', '#': '#101825', '+': '#171a2a', '*': '#22304a' },
    lamps: ['#ffd98a', '#ffc16a', '#ffe9bb'],
    dim: ['#9c7a46', '#986838', '#a08b62'],
    rim: '#bfe6ff', night: '#02060d',
  },
  oceanic: {
    grid: OCEAN, sea: '~', radius: 15.5,
    pal: {
      '~': ['#4ec6d8', '#2ea6c4', '#1b7ea6', '#125b80', '#0b3a58'],
      '#': ['#9ad6a0', '#6bb37c', '#3f7f58', '#2a5a3f', '#17362a'],
      'c': ['#ffffff', '#eaf8ff', '#c6e6f2', '#96bfd4', '#6a93ab'],
      '*': ['#ffffff', '#f0fbff', '#d4eef7', '#a6cadb', '#7398ac'],
    },
    rim: '#a8f0ff', night: '#06202f',
  },
  arid: {
    grid: ARID, sea: '~', radius: 15.5,
    pal: {
      '~': ['#e8a86a', '#d18b4e', '#a96636', '#7d4626', '#4f2c19'],
      '#': ['#b8663c', '#9c5130', '#763a22', '#552818', '#361810'],
      '+': ['#f6d9a4', '#e6bd80', '#bc9257', '#8a693c', '#584226'],
      '*': ['#ffffff', '#fdf0e2', '#e0cbb6', '#b09a86', '#7a6a5c'],
    },
    rim: '#ffd9a8', night: '#22120a',
  },
  ice: {
    grid: ICE, sea: '~', radius: 15.5,
    pal: {
      '~': ['#ffffff', '#e8f6ff', '#c2ddf0', '#94b7d6', '#6188ac'],
      '#': ['#8fa8c0', '#758ea8', '#5a7290', '#425570', '#2b3a50'],
      '+': ['#b9dcf5', '#93c2e6', '#6d9ecb', '#4d78a4', '#345477'],
      '*': ['#ffffff', '#f4fbff', '#d8ecfa', '#a9c8de', '#7896b0'],
    },
    rim: '#eaffff', night: '#0d2338',
  },
  industrialmoon: {
    moon: true, radius: 7.5,
    orbital: { inner: 1.62, outer: 2.00, tilt: 0.46, segments: 16 },
    ground: ['#cfcabf', '#aaa599', '#837f75', '#5d5a53', '#3b3935'],
    maria: ['#8f8b83', '#75726b', '#5a5852', '#43413d', '#2c2b28'],
    // Hand-placed so the face is the same every build and reads as a map
    // rather than as noise. x, y, radius, in pixels.
    craters: [[13, 12, 2.8], [19, 18, 2.4], [18, 11, 1.7], [12, 19, 1.5]],
    seas: [[19, 20, 4.0]],
    ringPal: ['#e3e6ea', '#b6bcc4', '#868d97', '#565c66'],
    ringLamp: ['#ffc46a', '#9fe0ff'],
    rim: '#e8eef5', night: '#0c0e14',
  },
  gasgiant: {
    bands: true, radius: 8.5, ring: { inner: 1.28, outer: 1.80, tilt: 0.32 },
    pal: {
      a: ['#f3e2bd', '#e0c99a', '#bda071', '#8e7550', '#5c4b33'],
      b: ['#d9b07e', '#c09261', '#9a7047', '#725232', '#4a351f'],
      c: ['#b87d55', '#9d6644', '#7c4e33', '#5b3826', '#3b2418'],
      s: ['#e8917a', '#d1735d', '#a95544', '#7d3d31', '#522621'],
    },
    ringPal: ['#e8dcc0', '#c9b898', '#a08e6f', '#6f6249'],
    rim: '#ffeec9', night: '#1a1206',
  },
};

/* ------------------------------------------------------------------ */
/* Lighting — one engine, every world                                   */
/* ------------------------------------------------------------------ */

const L: readonly [number, number, number] = [-0.5, -0.5, 0.45];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function draw(name: string) {
  const w = WORLDS[name];
  const R = w.radius;
  const px: (string | null)[][] = [];

  for (let y = 0; y < N; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < N; x++) {
      const cx = x + 0.5 - N / 2;
      const cy = y + 0.5 - N / 2;
      const nx = cx / R;
      const ny = cy / R;
      const r2 = nx * nx + ny * ny;
      const onDisc = r2 <= 1;

      // A ring is geometry, not paint: the far half passes BEHIND the planet
      // and the near half in front, which is the whole reason it reads as a
      // ring rather than as a painted-on hoop.
      let ring: string | null = null;
      if (w.orbital) {
        const o = w.orbital;
        const e = Math.hypot(nx, ny / o.tilt);
        if (e >= o.inner && e <= o.outer) {
          // Position ALONG the ring, which is what a built structure needs and
          // a rubble disc does not: segments repeat on a fixed pitch, so the
          // eye reads a manufactured object rather than a smear.
          const th = Math.atan2(ny / o.tilt, nx);
          const seg = Math.floor(((th + Math.PI) / (2 * Math.PI)) * o.segments);
          const far = cy < 0;
          const across = (e - o.inner) / (o.outer - o.inner);
          // Every other bay is a dark structural joint. The pitch is what
          // says "built" — a rubble ring grades smoothly from its inner edge
          // outward and never repeats, so repetition alone reads as fabrication.
          const joint = seg % 2 === 0;
          let shade = joint ? 3 : across < 0.42 ? 0 : across < 0.78 ? 1 : 2;
          if (far) shade = Math.min(3, shade + 1);
          ring = w.ringPal[shade];
          // Yard lights, on the joints, and only where the ring is in shadow —
          // a lamp against a lit hull is invisible and a lamp against the dark
          // side is the whole reason the thing looks inhabited.
          const lit = nx * L[0] + ny * L[1] > 0;
          if (joint && !lit && hash(seg, far ? 1 : 0, 23) > 0.20) {
            ring = w.ringLamp[(hash(seg, far ? 1 : 0, 67) * w.ringLamp.length) | 0];
          }
        }
      }
      if (w.ring) {
        const e = Math.hypot(nx, ny / w.ring.tilt);
        if (e >= w.ring.inner && e <= w.ring.outer) {
          const band = (e - w.ring.inner) / (w.ring.outer - w.ring.inner);
          const shade = band < 0.18 ? 1 : band < 0.34 ? 3 : band < 0.52 ? 0 : band < 0.72 ? 2 : 1;
          ring = w.ringPal[shade];
          // The ansa — where the ring runs edge-on toward us — is thin and
          // bright; darken the half that is behind so the eye reads depth.
          if (cy < 0) ring = w.ringPal[Math.min(3, shade + 1)];
        }
      }
      if (ring && !onDisc) { row.push(ring); continue; }
      if (!onDisc) { row.push(null); continue; }

      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const lam = nx * L[0] + ny * L[1] + nz * L[2];

      // A terrain world seen from its dark side.
      //
      // Same grid and same ramps; everything past the terminator swaps to
      // near-black with lights on the land. The lights are not scattered —
      // they cluster on the COAST, which is where they cluster in life and
      // which makes the continents draw their own outline. That is the whole
      // reason this view beats a dark disc with dots on it.
      if (w.nightside) {
        const ch0 = w.grid[y]![x]!;
        const t0: string = ch0 === '.' ? w.sea : ch0;
        const v0 = lam + (BAYER[y & 3]![x & 3]! / 16 - 0.47) * 0.14;

        if (v0 > 0.30) {
          // Still in daylight: the ordinary world, on its own ramp.
          if (r2 > 0.90 && lam > 0.55 && t0 !== '*') { row.push(w.rim); continue; }
          row.push(w.pal[t0][v0 > 0.62 ? 0 : v0 > 0.46 ? 1 : 2]);
          continue;
        }

        let c = w.dark[t0] ?? w.dark[w.sea];
        if (t0 !== '~') {
          // Coastal if any orthogonal neighbour is sea — cheap, and exactly the
          // outline the eye is looking for. Off the grid counts as sea so the
          // limb lights up too.
          const sea = (dx: number, dy: number): boolean => {
            const r = w.grid[y + dy] as string | undefined;
            const q = r?.[x + dx];
            return q === undefined || q === '~' || q === '.';
          };
          const coast = sea(1, 0) || sea(-1, 0) || sea(0, 1) || sea(0, -1);
          if (hash(x, y, 29) > (coast ? 0.30 : 0.76)) {
            const pick = (hash(x, y, 83) * w.lamps.length) | 0;
            // Twilight dims them; deep night does not.
            c = v0 > 0.04 || nz < 0.22 ? w.dim[pick] : w.lamps[pick];
          }
        } else if (hash(x, y, 47) > 0.988) {
          c = w.dim[0];   // a platform, or a fleet at anchor
        }
        row.push(c);
        continue;
      }

      // An airless body: maria, craters, and no atmosphere to glow.
      if (w.moon) {
        const px0 = x + 0.5, py0 = y + 0.5;
        let ramp = w.ground;
        for (const m of w.seas as number[][]) {
          const [mx, my, mr] = [m[0]!, m[1]!, m[2]!];
          if (Math.hypot(px0 - mx, py0 - my) < mr) { ramp = w.maria; break; }
        }
        const v0 = lam + (BAYER[y & 3]![x & 3]! / 16 - 0.47) * 0.06;
        let step = v0 > 0.60 ? 0 : v0 > 0.44 ? 1 : v0 > 0.28 ? 2 : v0 > 0.10 ? 3 : 4;

        // A crater is a hole, so its far wall catches the light and its near
        // wall is in shadow — the rim is what makes it read as a dish rather
        // than as a stain, and it flips with the light direction.
        for (const k of w.craters as number[][]) {
          const [cxx, cyy, cr] = [k[0]!, k[1]!, k[2]!];
          const d = Math.hypot(px0 - cxx, py0 - cyy);
          if (d > cr) continue;
          const toward = ((px0 - cxx) * -L[0] + (py0 - cyy) * -L[1]) / (d || 1);
          // Rim first, floor second. The far wall of the bowl faces the star and
          // catches it; the near wall is the shadow you actually read the hole
          // by. Blur the two together and a crater becomes a stain.
          if (d > cr - 1.0) step = toward > 0.25 ? Math.max(0, step - 2)
            : toward < -0.25 ? Math.min(4, step + 2) : step;
          else step = Math.min(4, step + 1);
          break;
        }

        // The near half of the ring passes IN FRONT of the moon. Without this
        // the structure was only ever visible as two stubs at the ansae, since
        // every on-disc pixel returned before the ring could be drawn — the
        // ring existed and crossed nothing.
        if (ring && cy > 0) { row.push(ring); continue; }
        if (lam < -0.12) { row.push(w.night); }
        else if (r2 > 0.94 && lam > 0.55) { row.push(w.rim); }
        else { row.push(ramp[Math.max(0, Math.min(4, step))]); }
        continue;
      }


      // Terrain. A banded world has no grid: latitude picks the ramp, with a
      // little hash wobble so the belts are not ruled lines, plus one storm.
      let t;
      if (w.bands) {
        const lat = ny + (hash(x, y, 7) - 0.5) * 0.10;
        const storm = Math.hypot((nx - 0.30) / 0.30, (ny - 0.22) / 0.15) < 1;
        t = storm ? 's'
          : Math.abs(lat) > 0.74 ? 'c'
            : Math.abs(lat) > 0.52 ? 'b'
              : Math.abs(lat) > 0.34 ? 'a'
                : Math.abs(lat) > 0.16 ? 'b' : 'a';
      } else {
        const ch = w.grid[y]![x]!;
        t = ch === '.' ? w.sea : ch;
      }
      const ramp = w.pal[t] ?? w.pal[w.sea];

      // The unlit crescent is ONE flat colour, not a darker planet: a
      // terminator that fades pixel by pixel reads as blur at this size.
      if (lam < -0.12) { row.push(w.night); continue; }

      // Rim light on the lit limb. Ice and cloud keep their own white — a rim
      // over them flattens the feature into the limb and it disappears.
      if (r2 > 0.90 && lam > 0.45 && t !== '*' && t !== 'c') { row.push(w.rim); continue; }

      // Ordered dither across the band edges. Five flat bands on a sphere put a
      // hard arc through the disc, and against terrain it reads as a scratch
      // rather than as curvature; a 4x4 Bayer threshold nudges each pixel up to
      // half a band, which breaks the boundary into a checker and keeps the
      // palette fixed where a gradient would not.
      const v = lam + (BAYER[y & 3]![x & 3]! / 16 - 0.47) * 0.14;
      const step = v > 0.60 ? 0 : v > 0.44 ? 1 : v > 0.28 ? 2 : v > 0.10 ? 3 : 4;
      let c = ramp[step];

      // A ring throws a shadow across the belts it crosses.
      if (w.ring && cy > 0 && Math.abs(ny) < 0.55) {
        const e = Math.hypot(nx, (ny + 0.42) / w.ring.tilt);
        if (e >= w.ring.inner && e <= w.ring.outer) c = ramp[Math.min(4, step + 2)];
      }
      // The near half of the ring passes in FRONT of the planet.
      if (ring && cy > 0) c = ring;
      row.push(c);
    }
    px.push(row);
  }
  return px;
}

/* ------------------------------------------------------------------ */
/* PNG out — RGBA, no dependencies                                      */
/* ------------------------------------------------------------------ */

export type WorldPixels = (string | null)[][];

/** One world's face. Cached: the grids never change, so neither do the pixels. */
const cache = new Map<string, WorldPixels>();

export function worldPixels(type: WorldType): WorldPixels {
  const hit = cache.get(type);
  if (hit) return hit;
  const px = draw(type in WORLDS ? type : 'arid') as WorldPixels;
  cache.set(type, px);
  return px;
}

/**
 * The same grid as horizontal runs, which is what a renderer actually wants.
 *
 * A 32x32 sprite is 1024 rects drawn naively and about 250 merged, because a
 * planet is mostly bands of one colour. Same trick `logWindow` plays: do the
 * work where it can be tested rather than in the component.
 */
export interface WorldRun {
  x: number;
  y: number;
  width: number;
  colour: string;
}

export function worldRuns(type: WorldType): WorldRun[] {
  const px = worldPixels(type);
  const runs: WorldRun[] = [];
  for (let y = 0; y < px.length; y++) {
    let x = 0;
    while (x < px[y]!.length) {
      const colour = px[y]![x]!;
      if (colour === null) { x += 1; continue; }
      let width = 1;
      while (x + width < px[y]!.length && px[y]![x + width] === colour) width += 1;
      runs.push({ x, y, width, colour });
      x += width;
    }
  }
  return runs;
}

/** The side of the square a sprite is drawn on, in sprite pixels. */
export const WORLD_SIZE = N;
