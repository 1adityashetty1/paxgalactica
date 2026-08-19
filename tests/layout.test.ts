import { describe, expect, it } from 'vitest';
import {
  portraitCrop,
  PORTRAIT_ASPECT,
  PORTRAIT_FOCUS,
  PORTRAIT_ZOOM,
} from '../src/ui/portrait.js';
import { applyOps } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { ansi256ToHex } from '../src/ui/ansi256.js';
import {
  layoutGalaxy,
  MAX_ASPECT,
  MIN_ASPECT,
  sectorOf,
  sectorsOf,
} from '../src/ui/layout.js';

/**
 * These carry over the invariants that mattered in the terminal renderer and
 * still matter in SVG: everything gets placed, nothing escapes the coordinate
 * space, a nearly-collinear sector stays legible, and zoom means zoom.
 *
 * Label collision and Braille subpixel tests did NOT survive the port — SVG
 * does real text layout, so there is nothing left to collide by hand.
 */

const state = createSeedState('freeworlds');

describe('galaxy layout', () => {
  it('places every system', () => {
    const layout = layoutGalaxy(state);
    expect(layout.placed).toHaveLength(25);
    expect(layout.omitted).toHaveLength(0);
  });

  it('keeps every coordinate inside the unit-width space', () => {
    const layout = layoutGalaxy(state);
    for (const p of layout.placed) {
      expect(p.x, `${p.id}.x`).toBeGreaterThanOrEqual(0);
      expect(p.x, `${p.id}.x`).toBeLessThanOrEqual(1);
      expect(p.y, `${p.id}.y`).toBeGreaterThanOrEqual(0);
      expect(p.y, `${p.id}.y`).toBeLessThanOrEqual(layout.aspect);
    }
  });

  it('spans the full width and height rather than bunching', () => {
    const layout = layoutGalaxy(state);
    const xs = layout.placed.map((p) => p.x);
    const ys = layout.placed.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(layout.aspect, 5);
  });

  it('draws each undirected hyperlane exactly once', () => {
    const layout = layoutGalaxy(state);
    const keys = layout.lanes.map((l) => [l.a, l.b].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(layout.lanes.length).toBeGreaterThan(30);
  });

  it('marks a lane shared when both ends are the same power', () => {
    const layout = layoutGalaxy(state);
    // tio-2 and tio-4 are both Iron Vigil.
    const lane = layout.lanes.find(
      (l) => [l.a, l.b].sort().join('|') === ['tio-2', 'tio-4'].sort().join('|'),
    );
    expect(lane?.sharedControllerId).toBe('vigil');
  });

  it('leaves a border lane unshared', () => {
    const layout = layoutGalaxy(state);
    // tio-1 is Meridian, tio-2 is Vigil.
    const lane = layout.lanes.find(
      (l) => [l.a, l.b].sort().join('|') === ['tio-1', 'tio-2'].sort().join('|'),
    );
    expect(lane?.sharedControllerId).toBeNull();
  });

  it('carries lane endpoints matching the placed systems', () => {
    const layout = layoutGalaxy(state);
    const at = new Map(layout.placed.map((p) => [p.id, p]));
    for (const l of layout.lanes) {
      expect(l.ax).toBeCloseTo(at.get(l.a)!.x, 9);
      expect(l.by).toBeCloseTo(at.get(l.b)!.y, 9);
    }
  });
});

describe('aspect handling', () => {
  it('caps a nearly-collinear sector instead of flattening it', () => {
    // The Kessel Fringe spans x 13–87 but y only 26–32. Unclamped that is an
    // aspect of ~0.08: a hairline nobody can read.
    const layout = layoutGalaxy(state, { sector: 'Kessel Fringe' });
    expect(layout.aspect).toBe(MIN_ASPECT);
  });

  it('never exceeds the ceiling', () => {
    for (const sector of sectorsOf(state)) {
      const layout = layoutGalaxy(state, { sector });
      expect(layout.aspect, sector).toBeLessThanOrEqual(MAX_ASPECT);
      expect(layout.aspect, sector).toBeGreaterThanOrEqual(MIN_ASPECT);
    }
  });

  it('preserves relative shape between the galaxy and a tall sector', () => {
    const galaxy = layoutGalaxy(state);
    expect(galaxy.aspect).toBeGreaterThan(MIN_ASPECT);
    expect(galaxy.aspect).toBeLessThanOrEqual(MAX_ASPECT);
  });
});

describe('sector zoom', () => {
  it('includes only that sector and reports the rest as omitted', () => {
    const layout = layoutGalaxy(state, { sector: 'Tion Marches' });
    expect(layout.placed).toHaveLength(6);
    expect(layout.omitted).toHaveLength(19);
    expect(layout.placed.every((p) => p.system.sector === 'Tion Marches')).toBe(true);
  });

  it('drops lanes leaving the sector', () => {
    const layout = layoutGalaxy(state, { sector: 'Tion Marches' });
    const ids = new Set(layout.placed.map((p) => p.id));
    for (const l of layout.lanes) {
      expect(ids.has(l.a)).toBe(true);
      expect(ids.has(l.b)).toBe(true);
    }
  });

  it('handles an unknown sector without throwing', () => {
    const layout = layoutGalaxy(state, { sector: 'Nowhere' });
    expect(layout.placed).toHaveLength(0);
    expect(layout.omitted).toHaveLength(25);
  });

  it('re-normalises so a zoomed sector fills the space', () => {
    const layout = layoutGalaxy(state, { sector: 'Arkanis Drift' });
    const xs = layout.placed.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
  });
});

describe('fleets in transit', () => {
  const moving = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-1', targetId: 'tio-3', label: 'Drift squadron',
    },
  ]).state;

  it('produces no markers when nothing is moving', () => {
    expect(layoutGalaxy(state).fleets).toHaveLength(0);
  });

  it('places a marker between the current hop and the next', () => {
    const layout = layoutGalaxy(moving);
    expect(layout.fleets).toHaveLength(1);
    const fleet = layout.fleets[0]!;
    const at = new Map(layout.placed.map((p) => [p.id, p]));
    const origin = at.get('ark-1')!;
    // Partway along, so it does not sit on the system it is leaving.
    expect(fleet.x === origin.x && fleet.y === origin.y).toBe(false);
    expect(fleet.targetId).toBe('tio-3');
    expect(fleet.remaining).toBeGreaterThan(0);
  });

  it('omits a fleet whose current hop is outside a zoomed sector', () => {
    const layout = layoutGalaxy(moving, { sector: 'Kessel Fringe' });
    expect(layout.fleets).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('finds a system’s sector', () => {
    expect(sectorOf(state, 'tio-3')).toBe('Tion Marches');
    expect(sectorOf(state, 'nope')).toBeNull();
    expect(sectorOf(state, null)).toBeNull();
  });

  it('lists sectors in a stable order', () => {
    expect(sectorsOf(state)).toEqual([
      'Arkanis Drift',
      'Kessel Fringe',
      'Sluis Verge',
      'Tion Marches',
    ]);
  });

  it('still converts faction colours to hex for the browser', () => {
    expect(ansi256ToHex(76)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/**
 * A portrait has to cover the circle it is cropped into.
 *
 * Centring a face and covering a box are different requirements, and the first
 * version of the avatar satisfied neither for every faction. It used one focal
 * point for all five — the Vigil, the Combine and Drajk sit two or three
 * percent right of centre, so their heads showed against the right edge — and
 * its offsets came out *positive* on the vertical, which pushed the image below
 * the top of the circle and left a bar of panel background across it. Both were
 * spotted on screen rather than by the suite, which is why this exists.
 */
describe('a faction portrait always covers its avatar', () => {
  const ids = [...Object.keys(PORTRAIT_FOCUS), 'a-faction-with-no-measured-focus'];

  it('never uncovers the box, for any faction or an unknown one', () => {
    for (const id of ids) {
      const crop = portraitCrop(id);
      // The image spans [offset, offset + size] over a box of [0, 100].
      expect(crop.left, `${id} leaves a gap on the left`).toBeLessThanOrEqual(0);
      expect(crop.top, `${id} leaves a bar across the top`).toBeLessThanOrEqual(0);
      expect(crop.left + crop.width, `${id} leaves a gap on the right`).toBeGreaterThanOrEqual(100);
      expect(crop.top + crop.height, `${id} leaves a gap on the bottom`).toBeGreaterThanOrEqual(100);
    }
  });

  it('keeps the head near the middle rather than merely covering', () => {
    // Coverage alone is satisfied by any corner of the picture. The point of
    // the focal points is that the face lands roughly centre, so assert it.
    for (const id of Object.keys(PORTRAIT_FOCUS)) {
      const crop = portraitCrop(id);
      const focus = PORTRAIT_FOCUS[id]!;
      const faceX = crop.left + crop.width * focus.x;
      const faceY = crop.top + crop.height * focus.y;
      expect(faceX, `${id} head is off-centre horizontally`).toBeGreaterThan(35);
      expect(faceX, `${id} head is off-centre horizontally`).toBeLessThan(65);
      expect(faceY, `${id} head is too low or too high`).toBeGreaterThan(30);
      expect(faceY, `${id} head is too low or too high`).toBeLessThan(60);
    }
  });

  it('zooms enough that the focal points are reachable', () => {
    // At 3x the art was only 1.67 boxes tall, so a head a quarter down could
    // not be centred without uncovering the top. This is the guard on that,
    // and it has to hold for a per-faction zoom too — pulling back to match a
    // closer portrait must not pull back past coverage.
    for (const id of Object.keys(PORTRAIT_FOCUS)) {
      const crop = portraitCrop(id);
      expect(crop.height, `${id} is drawn too small to cover and centre`).toBeGreaterThan(140);
      expect(crop.width, `${id} is drawn too narrow`).toBeGreaterThan(140);
    }
    expect(PORTRAIT_ZOOM * PORTRAIT_ASPECT * 100).toBeGreaterThan(150);
  });

  it('keeps every head at a similar size, so one face does not loom', () => {
    // The Vigil's portrait is a closer shot: at a shared zoom his head filled
    // far more of the circle than anyone else's. Scale is not something a focal
    // point can correct, which is why `zoom` is per-faction.
    const drawnHeights = Object.keys(PORTRAIT_FOCUS).map((id) => portraitCrop(id).height);
    const largest = Math.max(...drawnHeights);
    const smallest = Math.min(...drawnHeights);
    expect(largest / smallest).toBeLessThan(1.4);
  });
});
