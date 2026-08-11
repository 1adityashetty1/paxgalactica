import { positionAlongPath } from '../domain/graph.js';
import { isMovementType, type StarSystem, type WorldState } from '../domain/state.js';

/**
 * Pure galaxy layout: world state in, normalised coordinates out.
 *
 * Extracted from the old character-grid renderer, which mixed this geometry
 * with Braille subpixel drawing. The geometry was the part worth keeping — the
 * coordinate fit, the aspect cap, and the sector zoom all still apply when the
 * output is SVG rather than terminal cells.
 *
 * Coordinates are returned in a unit-width space: `x` spans 0–1 and `y` spans
 * 0–`aspect`. A consumer can use `viewBox="0 0 1 aspect"` and get undistorted
 * geometry at any size, which is what makes this renderer-agnostic.
 */

/**
 * Aspect bounds.
 *
 * The Kessel Fringe runs almost flat: without a floor it collapses to a
 * hairline, and without a ceiling a tall sector becomes an unreadable column.
 * Clamping keeps every sector legible while preserving relative shape.
 */
export const MIN_ASPECT = 0.22;
export const MAX_ASPECT = 0.85;

export interface PlacedSystem {
  id: string;
  x: number;
  y: number;
  system: StarSystem;
}

export interface LayoutLane {
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Set when both endpoints are held by the same power. */
  sharedControllerId: string | null;
}

export interface FleetMarker {
  orderId: string;
  factionId: string;
  label: string;
  x: number;
  y: number;
  remaining: number;
  /** Where it is heading, for a tooltip. */
  targetId: string;
}

export interface Layout {
  placed: PlacedSystem[];
  lanes: LayoutLane[];
  fleets: FleetMarker[];
  /** Systems outside the current view, e.g. when a sector is zoomed. */
  omitted: string[];
  /** Height of the coordinate space, given width 1. */
  aspect: number;
}

export interface LayoutOptions {
  /** Restrict to one sector, or null/undefined for the whole galaxy. */
  sector?: string | null;
}

export function layoutGalaxy(state: WorldState, opts: LayoutOptions = {}): Layout {
  const visible = opts.sector
    ? state.systems.filter((s) => s.sector === opts.sector)
    : state.systems;

  if (visible.length === 0) {
    return {
      placed: [],
      lanes: [],
      fleets: [],
      omitted: state.systems.map((s) => s.id),
      aspect: MIN_ASPECT,
    };
  }

  const xs = visible.map((s) => s.coords.x);
  const ys = visible.map((s) => s.coords.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // A single system, or a perfectly collinear set, would divide by zero.
  const spanX = Math.max(1e-6, Math.max(...xs) - minX);
  const spanY = Math.max(1e-6, Math.max(...ys) - minY);

  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, spanY / spanX));

  const placed: PlacedSystem[] = visible.map((s) => ({
    id: s.id,
    x: (s.coords.x - minX) / spanX,
    y: ((s.coords.y - minY) / spanY) * aspect,
    system: s,
  }));

  const at = new Map(placed.map((p) => [p.id, p]));

  // Hyperlanes are undirected; draw each once.
  const seen = new Set<string>();
  const lanes: LayoutLane[] = [];
  for (const s of visible) {
    const a = at.get(s.id)!;
    for (const otherId of s.hyperlaneEdges) {
      const b = at.get(otherId);
      if (!b) continue;
      const key = [s.id, otherId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const shared =
        s.controllerFactionId !== null && s.controllerFactionId === b.system.controllerFactionId;
      lanes.push({
        a: s.id,
        b: otherId,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        sharedControllerId: shared ? s.controllerFactionId : null,
      });
    }
  }

  const fleets: FleetMarker[] = [];
  for (const order of state.pendingOrders) {
    if (!isMovementType(order.type) || order.path.length === 0) continue;
    const fromId = positionAlongPath(order.path, order.progress);
    const from = fromId ? at.get(fromId) : undefined;
    if (!from) continue;

    const nextId = order.path[Math.min(order.progress + 1, order.path.length - 1)];
    const next = nextId ? at.get(nextId) : undefined;

    // Sit the marker partway along the current hop so it reads as in transit
    // rather than parked on the system it is passing.
    const t = 0.45;
    fleets.push({
      orderId: order.id,
      factionId: order.factionId,
      label: order.label,
      x: next ? from.x + (next.x - from.x) * t : from.x,
      y: next ? from.y + (next.y - from.y) * t : from.y,
      remaining: order.durationTurns - order.progress,
      targetId: order.targetId,
    });
  }

  const inView = new Set(visible.map((s) => s.id));
  return {
    placed,
    lanes,
    fleets,
    omitted: state.systems.filter((s) => !inView.has(s.id)).map((s) => s.id),
    aspect,
  };
}

/** Sector a system belongs to, for zoom controls. */
export function sectorOf(state: WorldState, systemId: string | null): string | null {
  if (!systemId) return null;
  return state.systems.find((s) => s.id === systemId)?.sector ?? null;
}

export function sectorsOf(state: WorldState): string[] {
  return [...new Set(state.systems.map((s) => s.sector))].sort();
}
