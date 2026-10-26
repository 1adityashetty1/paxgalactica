import { ASSET_ARCHETYPES } from './assets.js';
import { COMMANDER_COST, MAX_ACTIVE_COMMANDERS, listedOfficers } from './command.js';
import { FIXTURE_COST, MAX_FIXTURES_PER_WORLD, atWork } from './diplomacy.js';
import { buildAdjacency } from './graph.js';
import { CREDITS_PER_TON, HULL_SPEC, LIFTER_CARRY } from './hulls.js';
import {
  WORLD_TYPE_STAT,
  fixtureSlotRefusal,
  fixtureUpkeepForCount,
  getFaction,
  maxAgentsFor,
  orbitalWeightAt,
  stackAt,
  statFixturesAt,
  yardCapacityFor,
  type WorldState,
} from './state.js';

/**
 * What a power can do this turn, computed: its yards, the fixture slots its
 * ground has free, the operatives and officers it can send or appoint, and the
 * worlds its fleets and envoys reach.
 *
 * For the counsellor, beside `paperOf`. Its commonest bad recommendation in
 * the 2026-10-19 playtest loops was an act the power had no means to carry
 * out — works where nothing of its stood, a landing with no lift, an operative
 * sent with no slot free. Each is arithmetic the engine already does, so it is
 * done here rather than left to the counsellor to guess.
 */
export function capabilitiesOf(state: WorldState, me: string): string[] {
  const faction = getFaction(state, me);
  if (!faction) return [];
  const out: string[] = [];
  const byId = new Map(state.systems.map((s) => [s.id, s]));
  const nameOf = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? id) : 'nowhere');
  const held = state.systems
    .filter((s) => s.controllerFactionId === me)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id));

  // Yards.
  const berths = yardCapacityFor(state, me);
  const afford = Math.floor(faction.credits / CREDITS_PER_TON);
  const bs = HULL_SPEC.battleship;
  out.push(
    held.length > 0
      ? `Yards: ${berths} tons of hulls a declaration, laid down at a world you hold (${Math.floor(berths / bs.tonnage)} battleships at ${bs.tonnage * CREDITS_PER_TON} each). Your treasury pays for ${afford} tons now.`
      : 'Yards: none. You hold no world, so you cannot build hulls.',
  );

  // Fixture slots.
  const owned = state.assets.filter((a) => a.heldBy === me && ASSET_ARCHETYPES.some((k) => k.kind === a.kind && k.fixture)).length;
  const nextUpkeep = fixtureUpkeepForCount(owned + 1) - fixtureUpkeepForCount(owned);
  const sites = held.flatMap((site) => {
    const standing = statFixturesAt(state, site.id).length;
    const building = state.pendingOrders.filter((o) => o.targetId === site.id && o.onComplete?.kind === 'found_fixture').length;
    const room = MAX_FIXTURES_PER_WORLD - standing - building;
    if (room <= 0) return [];
    const stat = WORLD_TYPE_STAT[site.worldType];
    const kinds = ASSET_ARCHETYPES.filter(
      (k) => k.fixture && k.modifies?.includes(stat) && fixtureSlotRefusal(state, site, k.kind) === null,
    ).map((k) => k.kind.replace(/_/g, ' '));
    return kinds.length > 0 ? [`${site.name} (${room} free; its ${stat} ground takes ${kinds.slice(0, 4).join(', ')})`] : [];
  });
  out.push(
    sites.length > 0
      ? `Fixture slots free on your worlds: ${sites.slice(0, 5).join('; ')}. A fixture costs ${FIXTURE_COST}, and the next adds ${nextUpkeep} a turn to upkeep. Nothing can be built on a world you do not hold.`
      : 'Fixture slots: none free on any world you hold.',
  );

  // Operatives.
  const mine = state.agents.filter((a) => a.ownerFactionId === me && !a.exposed);
  const slots = maxAgentsFor(state, me);
  const working = mine.filter((a) => atWork(a, state.turn));
  const travelling = mine.filter((a) => a.mission !== null && !atWork(a, state.turn));
  const idle = mine.filter((a) => a.mission === null);
  const listed = (state.listedAgents ?? []).filter((a) => a.ownerFactionId === me);
  const free = slots - mine.length;
  out.push(
    [
      `Operatives: ${mine.length} of ${slots} slots used — ${working.length} at work, ${travelling.length} on the way, ${idle.length} awaiting orders.`,
      idle.length > 0
        ? `Free to send now: ${idle.map((a) => `${a.name || a.id}${a.agentClass ? ` (${a.agentClass})` : ''} at ${nameOf(a.systemId)}`).join(', ')}.`
        : 'Nobody is free to send: sending one means recruiting first, which takes a whole action.',
      free > 0 && listed.length > 0
        ? `On your Lists, recruitable into ${free} free slot${free === 1 ? '' : 's'}: ${listed.map((a) => `${a.name}${a.agentClass ? ` (${a.agentClass})` : ''}`).join(', ')}.`
        : free <= 0
          ? 'No slot is free: nobody can be recruited until one is recalled or lost.'
          : 'Nobody is on your Lists to recruit.',
    ].join(' '),
  );

  // Officers.
  const active = state.commanders.filter((c) => c.factionId === me && c.status === 'active');
  const waiting = listedOfficers(state.commanders, me);
  const where = (c: (typeof active)[number]) =>
    c.atSystemId
      ? `at ${nameOf(c.atSystemId)}`
      : (() => {
          const order = state.pendingOrders.find((o) => o.officers?.includes(c.id));
          return order ? `under way to ${nameOf(order.targetId)}` : 'nowhere';
        })();
  out.push(
    [
      `Officers in post: ${active.length > 0 ? active.map((c) => `${c.name} (${c.archetype}) ${where(c)}`).join('; ') : 'none — your fleets fight without one'}. An officer sails only with a fleet leaving the world they stand on.`,
      active.length >= MAX_ACTIVE_COMMANDERS
        ? `The roster is full at ${MAX_ACTIVE_COMMANDERS}.`
        : waiting.length > 0
          ? `On your Lists to appoint: ${waiting.map((c) => `${c.name} (${c.archetype}, ${c.commissioned ? 'served, free' : `${COMMANDER_COST} credits`})`).join('; ')}.`
          : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  // Reach.
  const adjacency = buildAdjacency(state.systems);
  const be = HULL_SPEC.battleship.orbitalWeight;
  const bases = state.systems
    .map((s) => ({ s, line: orbitalWeightAt(s, me) / be, lift: (stackAt(s, me).lifter ?? 0) * LIFTER_CARRY }))
    .filter((b) => b.line >= 0.5 || b.lift > 0);
  out.push(
    bases.length > 0
      ? `Your fleets stand at: ${bases.map((b) => `${b.s.name} (${b.line.toFixed(1)} battleships' weight${b.lift > 0 ? `, lift for ${b.lift} troops` : ', no lift'})`).join('; ')}. A world is taken only by lift that lands; warships alone take nothing.`
      : 'You have no fleet standing anywhere.',
  );
  const open = new Map<string, string>();
  for (const s of state.systems) {
    if (s.controllerFactionId !== null) continue;
    const from = [...(adjacency.get(s.id) ?? [])].map((n) => byId.get(n)).find((n) => n?.controllerFactionId === me);
    const orbit = Object.keys(stackAt(s, me)).length > 0;
    if (!from && !orbit) continue;
    const standing = s.regard?.[me];
    open.set(
      s.id,
      `${s.name} (garrison ${s.garrison}${standing !== undefined ? `, its standing with you ${standing}` : ''}; ${orbit ? 'your ships are in its orbit' : `a jump from ${from!.name}`})`,
    );
  }
  if (open.size > 0) {
    out.push(`Worlds that answer to nobody within reach — an envoy can court them, a landing can take them: ${[...open.values()].join('; ')}.`);
  }
  return out;
}
