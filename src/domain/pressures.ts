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
    const rivals = new Map<string, { line: number; troops: number; over: number; staged: Map<string, number> }>();
    for (const id of [world.id, ...(adjacency.get(world.id) ?? [])]) {
      const sys = byId.get(id);
      if (!sys) continue;
      for (const f of Object.keys(sys.ships)) {
        // A power that likes you is not massing against you; one in your
        // orbit is still named, whatever it thinks of you.
        if (f === me) continue;
        if (id !== world.id && (getFaction(state, f)?.disposition[me] ?? 0) > 0) continue;
        const row = rivals.get(f) ?? { line: 0, troops: 0, over: 0, staged: new Map<string, number>() };
        const line = orbitalWeightAt(sys, f) / be;
        row.line += line;
        const lift = (stackAt(sys, f).lifter ?? 0) * LIFTER_CARRY;
        row.troops += lift;
        if (lift > 0) row.staged.set(sys.name, (row.staged.get(sys.name) ?? 0) + lift);
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
        // Where the lift stands, and that it has not sailed; and what is on
        // the world's side too. A counsellor read "on or a jump from" as "is
        // moving to", invented a landing date, and weighed it against the
        // garrison alone while 36 troops of the player's own lift and nine
        // battleships stood over the world (playtest 2026-10-19, loop 2).
        const where = [...r.staged].map(([at, n]) => (at === world.name ? `${n} in its orbit` : `${n} at ${at}, a jump away`)).join(' and ');
        const ownLift = (stackAt(world, me).lifter ?? 0) * LIFTER_CARRY;
        out.push(
          `${name(f)} has lift for ${r.troops} troops within reach of ${world.name} (${where}); none of it has sailed, and nothing says when it will. On ${world.name}'s side: your garrison of ${world.garrison}, your own lift for ${ownLift} troops, and ${mine.toFixed(1)} battleships' weight in its orbit.`,
        );
      } else if (r.line > Math.max(mine, 0.5) * 1.5 && r.over === 0) {
        out.push(`${name(f)} has ${r.line.toFixed(1)} battleships' weight within a jump of ${world.name}, against your ${mine.toFixed(1)} there.`);
      }
    }
  }
  return [...new Set(out)].slice(0, 8);
}
