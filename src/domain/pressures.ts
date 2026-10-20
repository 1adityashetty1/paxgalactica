import { buildAdjacency } from './graph.js';
import { HULL_SPEC, LIFTER_CARRY } from './hulls.js';
import { getFaction, orbitalWeightAt, stackAt, systemIncome, type WorldState } from './state.js';

/**
 * What presses on a power, computed rather than read (playtest 2026-10-19, S6).
 *
 * The counsellor read the same flat state block every prompt gets, in which a
 * massing fleet is one stack among twenty: it never mentioned eleven Vigil
 * lifters a jump from Torrek Anchorage, invented a position at Neth and called
 * the player's own garrison the Vigil's. Code knows each of these; the
 * counsellor's job is to choose among them and speak.
 */
export function pressuresOn(state: WorldState, me: string): string[] {
  const adjacency = buildAdjacency(state.systems);
  const byId = new Map(state.systems.map((s) => [s.id, s]));
  const be = HULL_SPEC.battleship.orbitalWeight;
  const name = (id: string) => getFaction(state, id)?.name ?? id;
  const out: string[] = [];

  for (const world of state.systems.filter((s) => s.controllerFactionId === me)) {
    const mine = orbitalWeightAt(world, me) / be;
    const rivals = new Map<string, { line: number; troops: number; over: number }>();
    for (const id of [world.id, ...(adjacency.get(world.id) ?? [])]) {
      const sys = byId.get(id);
      if (!sys) continue;
      for (const f of Object.keys(sys.ships)) {
        // A power that likes you is not massing against you; one in your
        // orbit is still named, whatever it thinks of you.
        if (f === me) continue;
        if (id !== world.id && (getFaction(state, f)?.disposition[me] ?? 0) > 0) continue;
        const row = rivals.get(f) ?? { line: 0, troops: 0, over: 0 };
        const line = orbitalWeightAt(sys, f) / be;
        row.line += line;
        row.troops += (stackAt(sys, f).lifter ?? 0) * LIFTER_CARRY;
        if (id === world.id) row.over += line;
        rivals.set(f, row);
      }
    }
    for (const [f, r] of rivals) {
      if (r.over > 0) {
        const take = systemIncome(state, world).shares[me] ?? 0;
        out.push(
          `${name(f)} has ${r.over.toFixed(1)} battleships' weight in the orbit of ${world.name}, a world you hold (garrison ${world.garrison}, yours); you have ${mine.toFixed(1)} there, and the world pays you ${Math.round(take)} a turn of ${world.strategicValue * 7}.`,
        );
      }
      if (r.troops > world.garrison) {
        out.push(`${name(f)} has lift for ${r.troops} troops on or a jump from ${world.name}, against your garrison of ${world.garrison} there.`);
      } else if (r.line > Math.max(mine, 0.5) * 1.5 && r.over === 0) {
        out.push(`${name(f)} has ${r.line.toFixed(1)} battleships' weight within a jump of ${world.name}, against your ${mine.toFixed(1)} there.`);
      }
    }
  }
  return [...new Set(out)].slice(0, 8);
}
