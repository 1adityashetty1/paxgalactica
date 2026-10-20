import { buildAdjacency } from './graph.js';
import { HULL_SPEC, LIFTER_CARRY } from './hulls.js';
import { statModifier } from './checks.js';
import { effectiveStats, getFaction, orbitalWeightAt, stackAt, systemIncome, type WorldState } from './state.js';

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
  // The odds of the obvious answer. Twice a player who followed the counsel
  // attacked at even weight and both lines died — 21 against 19, 17 against 18
  // (playtest 2026-10-19, loop 2, L9). The exchange's own arithmetic: weight
  // times one plus a twentieth of the might modifier, and 2:1 to break the
  // defender off.
  const might = (f: string) => 1 + statModifier(effectiveStats(state, f, { seenBy: me }).might) / 20;
  for (const world of state.systems.filter((s) => s.controllerFactionId === me)) {
    const mine = (orbitalWeightAt(world, me) / be) * might(me);
    // Two lifters are not a battle line: "0.0:1" told nobody anything.
    if (mine < 0.5) continue;
    for (const id of adjacency.get(world.id) ?? []) {
      const base = byId.get(id);
      const holder = base?.controllerFactionId;
      if (!base || !holder || holder === me) continue;
      const them = getFaction(state, holder);
      // Only a power that dislikes you: odds against a near-neutral read as an invitation.
      if (!them || (them.disposition[me] ?? 0) > -25) continue;
      // The holder's own ships a jump from the base land in the batch that
      // answers an attack, and fought it: a 2.0:1 attack met 9 battleships
      // moved in from Vantic and was mutual ruin (playtest 2026-10-19, loop 3).
      const nearby = [...(adjacency.get(base.id) ?? [])]
        .map((n) => byId.get(n))
        .filter((n) => n !== undefined && n.controllerFactionId === holder)
        .reduce((w, n) => w + orbitalWeightAt(n!, holder), 0);
      const theirs = ((orbitalWeightAt(base, holder) + nearby) / be) * might(holder);
      if (theirs <= 0) continue;
      const ratio = mine / theirs;
      const holds = them.warEthic === 'crusading' ? ', and it never breaks off' : '';
      const verdict =
        ratio >= 2 && !holds
          ? 'enough that its line would break off'
          : ratio >= 1.5
            ? 'a win that costs a large part of your line'
            : ratio >= 1
              ? 'an even exchange: both lines would be spent and nothing taken'
              : 'too little: your line would be driven off';
      out.push(
        `If you attacked ${base.name} (${name(holder)}) with what stands at ${world.name}, it would be ${ratio.toFixed(1)}:1 counting what ${name(holder)} could move in from a jump away — ${verdict}${holds}. (These are the odds of YOUR attack, not of theirs on you.)`,
      );
    }
  }
  // Whose is whose, once, at the top: the counsellor called a world of the
  // player's "held" by the Vigil for one freighter in its orbit (playtest
  // 2026-10-19, loop 3). A ship in an orbit holds nothing.
  const held = state.systems.filter((s) => s.controllerFactionId === me).map((s) => s.name);
  const header = `Worlds you hold: ${held.join(', ') || 'none'}. A rival's ships in an orbit do not make the world theirs.`;
  return [header, ...[...new Set(out)].slice(0, 10)];
}
