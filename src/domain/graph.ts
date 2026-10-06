import type { StarSystem, WorldState } from './state.js';

/**
 * Hyperlanes are undirected. Seed data (and models editing it) can easily
 * declare an edge on only one endpoint, so we union both directions when
 * building the adjacency rather than trusting the data to be symmetric.
 */
export function buildAdjacency(systems: StarSystem[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const known = new Set(systems.map((s) => s.id));
  for (const s of systems) adj.set(s.id, new Set());

  for (const s of systems) {
    for (const other of s.hyperlaneEdges) {
      if (!known.has(other) || other === s.id) continue;
      adj.get(s.id)!.add(other);
      adj.get(other)!.add(s.id);
    }
  }
  return adj;
}

/**
 * Breadth-first shortest path. Neighbours are visited in sorted order so that
 * ties break identically on every run — replay determinism depends on this.
 *
 * Returns the full node path including both endpoints, or null if the target
 * is unreachable. Jump count is `path.length - 1`.
 */
export function shortestPath(
  systems: StarSystem[],
  fromId: string,
  toId: string,
): string[] | null {
  const adj = buildAdjacency(systems);
  if (!adj.has(fromId) || !adj.has(toId)) return null;
  if (fromId === toId) return [fromId];

  const prev = new Map<string, string>();
  const seen = new Set<string>([fromId]);
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbours = [...(adj.get(cur) ?? [])].sort();
    for (const next of neighbours) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === toId) {
        const path = [toId];
        let step = toId;
        while (step !== fromId) {
          step = prev.get(step)!;
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Every path between two systems that is as short as the shortest, in a fixed
 * order: forward from `fromId` through neighbours in sorted id order, as
 * `shortestPath` explores them. At most `limit`, so a pair of worlds joined by a
 * grid of equal routes cannot make one lane cost more than a handful of legs.
 */
export function allShortestPaths(
  systems: StarSystem[],
  fromId: string,
  toId: string,
  limit = 8,
): string[][] {
  const adj = buildAdjacency(systems);
  if (!adj.has(fromId) || !adj.has(toId)) return [];
  if (fromId === toId) return [[fromId]];
  const distFrom = (start: string): Map<string, number> => {
    const dist = new Map<string, number>([[start, 0]]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (dist.has(next)) continue;
        dist.set(next, dist.get(cur)! + 1);
        queue.push(next);
      }
    }
    return dist;
  };
  const toEnd = distFrom(toId);
  const length = toEnd.get(fromId);
  if (length === undefined) return [];
  const out: string[][] = [];
  const walk = (path: string[]): void => {
    if (out.length >= limit) return;
    const cur = path[path.length - 1]!;
    if (cur === toId) {
      out.push(path);
      return;
    }
    const left = toEnd.get(cur)!;
    for (const next of [...(adj.get(cur) ?? [])].sort()) {
      if (toEnd.get(next) === left - 1) walk([...path, next]);
    }
  };
  walk([fromId]);
  return out;
}

/**
 * Movement cost in turns: one turn per hyperlane jump. This is the ONLY source
 * of truth for how long a fleet takes to arrive. A model-supplied duration for
 * a movement order is always discarded in favour of this number.
 */
export function jumpsBetween(
  systems: StarSystem[],
  fromId: string,
  toId: string,
): number | null {
  const path = shortestPath(systems, fromId, toId);
  if (path === null) return null;
  return Math.max(1, path.length - 1);
}

/** Where a fleet physically is, given how far along its path it has travelled. */
export function positionAlongPath(path: string[], progress: number): string | null {
  if (path.length === 0) return null;
  const idx = Math.min(progress, path.length - 1);
  return path[idx] ?? null;
}

export function neighboursOf(state: WorldState, systemId: string): string[] {
  return [...(buildAdjacency(state.systems).get(systemId) ?? [])].sort();
}
