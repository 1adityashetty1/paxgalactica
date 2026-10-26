import { buildAdjacency } from '../domain/graph.js';
import { hullsAt, movesAtOnce, type WorldState } from '../domain/state.js';

/**
 * How long your nearest fleet takes to reach a world, for the map's tooltip.
 *
 * The movement rules, read and not restated: one turn a jump (`jumpsBetween`),
 * except one jump between two worlds you hold with nobody else's ships over
 * the target, which lands at once (`movesAtOnce`). Nearest by jumps; a tie
 * goes to the larger fleet, then to the system id, so it does not flicker.
 */
export interface Travel {
  /** The world the fleet stands at. */
  fromId: string;
  fromName: string;
  jumps: number;
  /** Turns until it arrives: 0 when it is already there or lands at once. */
  turns: number;
  /** One jump inside your own space that lands in the batch it is ordered in. */
  atOnce: boolean;
}

export function travelTo(state: WorldState, me: string, targetId: string): Travel | null {
  const bases = state.systems.filter((s) => hullsAt(s, me) > 0);
  if (bases.length === 0) return null;
  const adjacency = buildAdjacency(state.systems);
  // One breadth-first walk out from the target finds every base's distance.
  const distance = new Map<string, number>([[targetId, 0]]);
  const queue = [targetId];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of [...(adjacency.get(at) ?? [])].sort()) {
      if (distance.has(next)) continue;
      distance.set(next, distance.get(at)! + 1);
      queue.push(next);
    }
  }
  const best = bases
    .filter((b) => distance.has(b.id))
    .sort((a, b) => distance.get(a.id)! - distance.get(b.id)! || hullsAt(b, me) - hullsAt(a, me) || a.id.localeCompare(b.id))[0];
  if (!best) return null;
  const jumps = distance.get(best.id)!;
  const atOnce = jumps === 1 && movesAtOnce(state, me, best.id, targetId);
  return { fromId: best.id, fromName: best.name, jumps, turns: jumps === 0 || atOnce ? 0 : jumps, atOnce };
}

/** The tooltip's line. */
export function travelLine(t: Travel | null): string {
  if (t === null) return 'No fleet of yours can reach here.';
  if (t.jumps === 0) return 'Your ships are here.';
  if (t.atOnce) return `From ${t.fromName}, one jump inside your space: lands the turn it is ordered.`;
  return `From ${t.fromName}: ${t.jumps} jump${t.jumps === 1 ? '' : 's'}, arrives in ${t.turns} turn${t.turns === 1 ? '' : 's'}.`;
}
