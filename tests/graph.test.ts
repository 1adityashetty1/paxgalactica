import { describe, expect, it } from 'vitest';
import { buildAdjacency, jumpsBetween, positionAlongPath, shortestPath } from '../src/domain/graph.js';
import { createSeedState } from '../src/seed/scenario.js';
import type { StarSystem } from '../src/domain/state.js';

const systems = createSeedState('freeworlds').systems;

const mk = (id: string, edges: string[]): StarSystem => ({
  id,
  name: id,
  sector: 'test',
  coords: { x: 0, y: 0 },
  controllerFactionId: null,
  garrison: 0,
  strategicValue: 0,
  hyperlaneEdges: edges,
});

describe('adjacency', () => {
  it('treats lanes as undirected even when declared on one endpoint only', () => {
    const adj = buildAdjacency([mk('a', ['b']), mk('b', [])]);
    expect([...adj.get('b')!]).toEqual(['a']);
  });

  it('ignores self-loops and edges to systems that do not exist', () => {
    const adj = buildAdjacency([mk('a', ['a', 'ghost', 'b']), mk('b', [])]);
    expect([...adj.get('a')!]).toEqual(['b']);
  });
});

describe('shortest path', () => {
  it('finds a direct lane', () => {
    expect(shortestPath(systems, 'ark-1', 'ark-3')).toEqual(['ark-1', 'ark-3']);
  });

  it('returns the single node for a trip to itself', () => {
    expect(shortestPath(systems, 'ark-1', 'ark-1')).toEqual(['ark-1']);
  });

  it('routes across sectors', () => {
    const path = shortestPath(systems, 'ark-1', 'tio-3');
    expect(path).not.toBeNull();
    expect(path![0]).toBe('ark-1');
    expect(path![path!.length - 1]).toBe('tio-3');
  });

  it('returns null when the target is unreachable', () => {
    const isolated = [...systems.map((s) => ({ ...s, hyperlaneEdges: [] }))];
    expect(shortestPath(isolated, 'ark-1', 'tio-3')).toBeNull();
  });

  it('returns null for ids that do not exist', () => {
    expect(shortestPath(systems, 'ark-1', 'nowhere')).toBeNull();
    expect(shortestPath(systems, 'nowhere', 'ark-1')).toBeNull();
  });

  it('is deterministic across repeated calls', () => {
    const runs = Array.from({ length: 5 }, () => shortestPath(systems, 'ark-5', 'tio-5'));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it('every system in the seed is reachable from every other', () => {
    for (const s of systems) {
      expect(shortestPath(systems, 'ark-1', s.id), `ark-1 -> ${s.id}`).not.toBeNull();
    }
  });
});

describe('jump cost', () => {
  it('is one turn per jump', () => {
    expect(jumpsBetween(systems, 'ark-1', 'ark-3')).toBe(1);
    expect(jumpsBetween(systems, 'ark-1', 'ark-4')).toBe(2);
  });

  it('is symmetric', () => {
    expect(jumpsBetween(systems, 'ark-1', 'tio-5')).toBe(jumpsBetween(systems, 'tio-5', 'ark-1'));
  });
});

describe('position along a path', () => {
  it('tracks progress and clamps at the destination', () => {
    const path = ['a', 'b', 'c'];
    expect(positionAlongPath(path, 0)).toBe('a');
    expect(positionAlongPath(path, 1)).toBe('b');
    expect(positionAlongPath(path, 2)).toBe('c');
    expect(positionAlongPath(path, 99)).toBe('c');
  });

  it('returns null for an empty path', () => {
    expect(positionAlongPath([], 0)).toBeNull();
  });
});
