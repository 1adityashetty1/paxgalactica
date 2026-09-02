import { neighboursOf, shortestPath } from './graph.js';
import { isTreatyLive } from './diplomacy.js';
import {
  fleetStrengthOf,
  ledgerFor,
  SHIP_COST,
  UPKEEP_PER_FLEET_POINT,
  getFaction,
  type StarSystem,
  type WorldState,
} from './state.js';
import { routeEarnings, tradeRoutes } from './trade.js';

/**
 * Doctrine initiative: what a power would reach for, on this board, unprompted.
 *
 * These five bots began life in `src/balance.ts` as a balance harness — five
 * factions played as literally as the mechanics allow, against the real
 * reducer, with no model calls. They moved here because a measurement made
 * them load-bearing rather than diagnostic.
 *
 * **The NPCs were not passive. They were solipsistic.** Over a seven-turn
 * campaign the reaction call produced 16 fleet movements — six of them attacks
 * — and every single attack targeted the player, on one world. Zero
 * NPC-vs-NPC aggression, while `vigil -> krayt` sat at **-87** and
 * `freeworlds -> vigil` at **-75**. Wars on paper that nobody fought. The
 * galaxy was the player and four powers who existed only in relation to them.
 *
 * Three structural causes, none of them a prompt problem:
 *
 * 1. Responders are chosen by `mostAffectedFactions` from what the PLAYER's ops
 *    touched. A faction the player ignores is never asked to think.
 * 2. Reactions are skipped entirely when nothing was staged — the optimisation
 *    that makes a long campaign affordable. On a quiet turn NPCs cannot act at
 *    all.
 * 3. `reaction.md` asks a power to *respond*. It never asks it to want
 *    anything.
 *
 * The bots already do the thing the model does not: they contest each other.
 * That is the whole reason `tests/balance.test.ts` can assert nobody is
 * eliminated and nobody holds half the map. So they are used two ways in one
 * turn:
 *
 * - **Directly**, for every faction the model does not speak for this turn.
 *   Those are precisely the powers currently doing nothing at all.
 * - **Retroactively narrated.** A bot action logs what it did, and
 *   `serializeRecentLog` feeds the event log into the next reaction call — so
 *   the faction explains its own past move when it next speaks, at no extra
 *   cost. The alternative was paying the flavour tier to narrate every bot
 *   action; this makes the NPC's own history part of what it reasons from
 *   instead.
 *
 * Everything here is pure and deterministic, so a bot-driven turn replays
 * exactly like any other: the journal records the ops, not the reasoning.
 */

interface Ctx {
  state: WorldState;
  me: string;
}

type Ops = Record<string, unknown>[];

const sys = (s: WorldState, id: string): StarSystem | undefined =>
  s.systems.find((x) => x.id === id);
export const held = (s: WorldState, me: string): StarSystem[] =>
  s.systems.filter((x) => x.controllerFactionId === me);
const shipsAt = (s: WorldState, id: string, me: string): number => sys(s, id)?.ships[me] ?? 0;
const purse = (s: WorldState, me: string): number =>
  s.factions.find((f) => f.id === me)?.credits ?? 0;

/** Systems adjacent to anything this faction holds. */
function frontier(s: WorldState, me: string): StarSystem[] {
  const out = new Map<string, StarSystem>();
  for (const mine of held(s, me)) {
    for (const n of neighboursOf(s, mine.id)) {
      const target = sys(s, n);
      if (target && target.controllerFactionId !== me) out.set(n, target);
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Buy hulls toward a fleet the faction's income can actually carry.
 *
 * The first version of these bots bought every turn they could afford to, and
 * every one of them ground down to a net of ~0 with an enormous fleet. That
 * was the bots being stupid rather than the economy being broken — but it also
 * hid the economy completely, because everyone ended up at the same place. A
 * player would stop; so does this.
 */
function buy(ctx: Ctx, appetite: number, reserve: number): Ops {
  const ledger = ledgerFor(ctx.state, ctx.me);
  const fleet = fleetStrengthOf(ctx.state, ctx.me);
  // Gross income supports a fleet of gross/upkeep hulls. Spend `appetite` of
  // that headroom, never past it.
  const sustainable = Math.floor((ledger.gross * appetite) / UPKEEP_PER_FLEET_POINT);
  const room = sustainable - fleet;
  if (room <= 0) return [];

  const affordable = Math.floor(Math.max(0, purse(ctx.state, ctx.me) - reserve) / SHIP_COST);
  const n = Math.min(room, affordable, 8);
  return n > 0 ? [{ op: 'adjust_fleet', factionId: ctx.me, delta: n, reason: 'yards' }] : [];
}

/** Concentrate scattered hulls at one holding, so a blow can be struck. */
function massAt(ctx: Ctx, whereId: string, want: number): Ops {
  const ops: Ops = [];
  let owed = want - shipsAt(ctx.state, whereId, ctx.me);
  if (owed <= 0) return ops;
  for (const base of held(ctx.state, ctx.me)
    .filter((b) => b.id !== whereId)
    .sort((a, b) => shipsAt(ctx.state, b.id, ctx.me) - shipsAt(ctx.state, a.id, ctx.me))) {
    if (owed <= 0) break;
    // Leave a token garrison behind rather than stripping the world bare.
    const spare = Math.max(0, shipsAt(ctx.state, base.id, ctx.me) - 4);
    const take = Math.min(spare, owed);
    if (take <= 0) continue;
    ops.push(
      { op: 'adjust_ships', systemId: base.id, factionId: ctx.me, delta: -take },
      { op: 'adjust_ships', systemId: whereId, factionId: ctx.me, delta: take },
    );
    owed -= take;
  }
  return ops;
}

/** Send `force` from the nearest holding that can supply the whole blow. */
function sortie(ctx: Ctx, targetId: string, force: number, label: string): Ops {
  const bases = held(ctx.state, ctx.me)
    .filter((b) => shipsAt(ctx.state, b.id, ctx.me) >= force)
    .sort(
      (a, b) =>
        (shortestPath(ctx.state.systems, a.id, targetId)?.length ?? 99) -
          (shortestPath(ctx.state.systems, b.id, targetId)?.length ?? 99) ||
        a.id.localeCompare(b.id),
    );
  const from = bases[0];
  if (!from || force <= 0) return [];
  return [
    {
      op: 'issue_order', factionId: ctx.me, type: 'fleet_movement',
      originId: from.id, targetId, force, label,
    },
  ];
}

const hasOrder = (s: WorldState, me: string, type: string): boolean =>
  s.pendingOrders.some((o) => o.factionId === me && o.type === type);

/** Transit value crossing a system — what a raid or blockade there is worth. */
function trafficAt(s: WorldState, systemId: string): number {
  return tradeRoutes(s)
    .filter((r) => r.path.slice(1, -1).includes(systemId))
    .reduce((n, r) => n + r.volume, 0);
}

/* ------------------------------------------------------------------ */
/* The doctrines                                                        */
/* ------------------------------------------------------------------ */

type Bot = (ctx: Ctx) => Ops;

/**
 * "Commerce is sovereignty. Keep the lanes open... never fight a war a tariff
 * could have won." Builds, never blockades or raids, takes an undefended
 * neighbour only when it is genuinely free.
 */
const meridian: Bot = (ctx) => {
  const ops: Ops = [];
  // A defensive power keeps a modest navy and banks the rest.
  ops.push(...buy(ctx, 0.55, 600));

  const free = frontier(ctx.state, ctx.me)
    .filter((t) => t.controllerFactionId === null && t.garrison <= 3)
    .sort((a, b) => b.strategicValue - a.strategicValue)[0];
  if (free) {
    const need = free.garrison * 3 + 4;
    ops.push(...sortie(ctx, free.id, need, `secure ${free.name}`));
  }
  return ops;
};

/**
 * "Hold the Tion until order is restored, answer insolence with force."
 * Crusading and autarkic: builds hard, and attacks the best thing it can beat.
 */
const vigil: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.85, 200)); // crusading: spends most of its income on hulls

  if (hasOrder(ctx.state, ctx.me, 'fleet_movement')) return ops;

  const target = frontier(ctx.state, ctx.me)
    .map((t) => {
      const defence = t.garrison + Object.entries(t.ships)
        .filter(([id]) => id !== ctx.me)
        .reduce((n, [, v]) => n + v, 0);
      return { t, defence, prize: t.strategicValue };
    })
    .filter(({ defence }) => defence > 0)
    .sort((a, b) => b.prize - a.prize || a.t.id.localeCompare(b.t.id))[0];

  if (target) {
    const need = Math.ceil(target.defence * 2.2);
    // Crusading, not suicidal: it masses first, then strikes when it can
    // actually carry the world. Without the massing step it never attacked at
    // all, and a crusader that never crusades tests nothing.
    const staging = held(ctx.state, ctx.me)
      .filter((b) => neighboursOf(ctx.state, b.id).includes(target.t.id))
      .sort((a, b) => shipsAt(ctx.state, b.id, ctx.me) - shipsAt(ctx.state, a.id, ctx.me))[0];
    if (staging) {
      if (shipsAt(ctx.state, staging.id, ctx.me) >= need) {
        ops.push(...sortie(ctx, target.t.id, need, `pacify ${target.t.name}`));
      } else if (fleetStrengthOf(ctx.state, ctx.me) >= need + 8) {
        ops.push(...massAt(ctx, staging.id, need));
      }
    }
  }
  return ops;
};

/**
 * "Fund both sides, own the survivor, and let other powers spend their fleets
 * for you." Sits on its chokepoints, works neutral junctions, and blockades
 * rather than invades — it will not commit its own hulls to a conquest.
 */
const hutt: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.5, 800)); // will not spend its own hulls freely

  // Occupy the neutral junction it is already next to: income without a war.
  const junction = frontier(ctx.state, ctx.me)
    .filter((t) => t.controllerFactionId === null && shipsAt(ctx.state, t.id, ctx.me) === 0)
    .sort((a, b) => trafficAt(ctx.state, b.id) - trafficAt(ctx.state, a.id))[0];
  if (junction && !hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    ops.push(...sortie(ctx, junction.id, junction.garrison * 3 + 4, `take ${junction.name}`));
  }

  // Squeeze a rival's chokepoint when one is worth squeezing and a fleet is
  // already there. A profiteer blockades; it does not storm — and under its own
  // doctrine a war of its own costs it every war it was profiting from.
  if (!hasOrder(ctx.state, ctx.me, 'blockade')) {
    const squeeze = ctx.state.systems
      .filter((x) => shipsAt(ctx.state, x.id, ctx.me) >= 5 && x.controllerFactionId !== ctx.me)
      .sort((a, b) => trafficAt(ctx.state, b.id) - trafficAt(ctx.state, a.id))[0];
    if (squeeze && trafficAt(ctx.state, squeeze.id) > 0) {
      ops.push({
        op: 'issue_order', factionId: ctx.me, type: 'blockade',
        originId: squeeze.id, targetId: squeeze.id, durationTurns: 3,
        label: `close ${squeeze.name}`,
      });
    }
  }
  return ops;
};

/** "Defend the Drift, take no master." Fortifies, never attacks. */
const freeworlds: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.6, 300));

  // The Drift takes what is on its own doorstep and nothing beyond it.
  const home = frontier(ctx.state, ctx.me)
    .filter((t) => t.controllerFactionId === null && t.sector === 'Arkanis Drift')
    .sort((a, b) => b.strategicValue - a.strategicValue)[0];
  if (home && !hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    // Mass, then strike — the same step the Vigil already had, and the reason
    // this faction was invisible to the harness without it. `sortie` needs one
    // base holding the whole blow; the Drift wants 16 hulls for Sennex and
    // keeps a navy of 31 spread 10/7/8/6, so no base ever qualified and the bot
    // issued nothing for thirty turns. Its income sat at exactly 71/turn from
    // turn 5 to turn 30, and that flat line was read as a balance signal when
    // it was the harness never letting the faction move.
    const need = home.garrison * 3 + 4;
    const staging = held(ctx.state, ctx.me)
      .filter((b) => neighboursOf(ctx.state, b.id).includes(home.id))
      .sort((a, b) => shipsAt(ctx.state, b.id, ctx.me) - shipsAt(ctx.state, a.id, ctx.me))[0];
    if (staging) {
      if (shipsAt(ctx.state, staging.id, ctx.me) >= need) {
        ops.push(...sortie(ctx, home.id, need, `secure ${home.name}`));
      } else if (fleetStrengthOf(ctx.state, ctx.me) >= need + 8) {
        ops.push(...massAt(ctx, staging.id, need));
      }
    }
  }
  return ops;
};

/**
 * "Raid the rich, vanish into the deep lanes, and never hold ground worth
 * besieging." Works lawless junctions for traffic and raids the busiest
 * transit system it can reach. Buys few hulls; it cannot afford many.
 */
const krayt: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.7, 150));

  // Park on the richest unaligned junction — trade nobody else is carrying.
  const lawless = ctx.state.systems
    .filter((x) => x.controllerFactionId === null && shipsAt(ctx.state, x.id, ctx.me) === 0)
    .sort((a, b) => trafficAt(ctx.state, b.id) - trafficAt(ctx.state, a.id))[0];
  if (lawless && !hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    ops.push(...sortie(ctx, lawless.id, lawless.garrison * 3 + 3, `work ${lawless.name}`));
  }

  // Raid the busiest lane a squadron can reach. A raider does not need to
  // hold the system — it lurks a jump out — which is the whole point of the
  // Confederacy: it preys on powers it could never beat in orbit.
  if (!hasOrder(ctx.state, ctx.me, 'commerce_raiding')) {
    const reachable = new Set<string>();
    for (const base of ctx.state.systems) {
      if (shipsAt(ctx.state, base.id, ctx.me) < 4) continue;
      reachable.add(base.id);
      for (const n of neighboursOf(ctx.state, base.id)) reachable.add(n);
    }
    const prey = ctx.state.systems
      .filter((x) => reachable.has(x.id) && x.controllerFactionId !== ctx.me)
      .sort((a, b) => trafficAt(ctx.state, b.id) - trafficAt(ctx.state, a.id))[0];
    if (prey && trafficAt(ctx.state, prey.id) > 0) {
      ops.push({
        op: 'issue_order', factionId: ctx.me, type: 'commerce_raiding',
        originId: prey.id, targetId: prey.id, durationTurns: 3,
        label: `raid ${prey.name}`,
      });
    }
  }
  return ops;
};


export const BOTS: Record<string, Bot> = { meridian, vigil, hutt, freeworlds, krayt };

/* ------------------------------------------------------------------ */
/* Guards: a doctrine is not a licence                                  */
/* ------------------------------------------------------------------ */

/**
 * Treaties the bots do not read, and would cheerfully break.
 *
 * The bots were written for a harness where nobody signs anything, so none of
 * them looks at `state.treaties`. Turned loose on a live campaign that is a
 * real hazard rather than a rough edge: attacking a `non_aggression` partner
 * auto-breaks the pact, costs 25 disposition with them and
 * `PACT_BREAKING_REPUTATION_COST` with every onlooker — so a power could sign
 * in good faith through the diplomacy layer and have its own doctrine tear the
 * paper up on the same turn, for no reason anybody could read.
 *
 * Applied as a post-filter over the proposed ops rather than threaded into
 * five bots, which is what makes it total: a bot added later inherits the
 * guard without knowing it exists.
 */
const PEACE_TYPES = new Set(['non_aggression', 'ceasefire', 'mutual_defense']);

function boundBy(state: WorldState, a: string, b: string, types: Set<string>): boolean {
  return state.treaties.some(
    (t) =>
      isTreatyLive(t, state.turn) &&
      types.has(t.type) &&
      t.parties.includes(a) &&
      t.parties.includes(b),
  );
}

export interface Proposal {
  factionId: string;
  ops: Record<string, unknown>[];
  /** Third-person, for the event log and so the faction can explain it later. */
  rationale: string;
  /** Anything the guards removed, so a dropped act is never silently dropped. */
  withheld: string[];
}

/** Strip acts that would break a pact this faction has actually signed. */
function honourTreaties(
  state: WorldState,
  me: string,
  ops: Record<string, unknown>[],
): { ops: Record<string, unknown>[]; withheld: string[] } {
  const withheld: string[] = [];
  const kept = ops.filter((op) => {
    if (op.op !== 'issue_order') return true;
    const target = sys(state, String(op.targetId ?? ''));
    const holder = target?.controllerFactionId;
    if (!holder || holder === me) return true;

    if (op.type === 'fleet_movement' && boundBy(state, me, holder, PEACE_TYPES)) {
      withheld.push(`an attack on ${target.name}, which a standing pact forbids`);
      return false;
    }
    // A `trade_accord` makes its parties immune to each other's blockades and
    // raiding, so this is not only bad faith but mechanically inert.
    if (
      (op.type === 'blockade' || op.type === 'commerce_raiding') &&
      boundBy(state, me, holder, new Set(['trade_accord']))
    ) {
      withheld.push(`interdiction at ${target.name}, which a trade accord makes pointless`);
      return false;
    }
    return true;
  });
  return { ops: kept, withheld };
}

/** A plain third-person account of what a batch does, for the record. */
function describeProposal(state: WorldState, me: string, ops: Record<string, unknown>[]): string {
  const name = getFaction(state, me)?.name ?? me;
  const where = (id: unknown): string => sys(state, String(id ?? ''))?.name ?? String(id);
  const parts: string[] = [];
  let bought = 0;
  let massed = 0;

  for (const op of ops) {
    if (op.op === 'adjust_fleet') bought += Number(op.delta ?? 0);
    else if (op.op === 'adjust_ships' && Number(op.delta ?? 0) > 0) massed += Number(op.delta);
    else if (op.op === 'issue_order') {
      if (op.type === 'fleet_movement') {
        parts.push(`sends ${op.force} hull(s) from ${where(op.originId)} against ${where(op.targetId)}`);
      } else if (op.type === 'blockade') {
        parts.push(`closes the lanes at ${where(op.targetId)}`);
      } else if (op.type === 'commerce_raiding') {
        parts.push(`sets raiders on the traffic through ${where(op.targetId)}`);
      } else {
        parts.push(`begins ${String(op.label ?? op.type)} at ${where(op.targetId)}`);
      }
    }
  }
  if (massed > 0) parts.unshift(`concentrates ${massed} hull(s)`);
  if (bought > 0) parts.unshift(`lays down ${bought} hull(s)`);

  return parts.length === 0 ? `${name} holds its position.` : `${name} ${parts.join(', ')}.`;
}

/**
 * What this faction's own doctrine would do right now, unprompted.
 *
 * Returns `null` when the doctrine has nothing to reach for, which is a real
 * answer: a power with no opportunity should not manufacture one.
 *
 * **Fog-clean by construction.** The bots read `system.ships` and
 * `system.garrison`, which redaction does not touch, and the only pending
 * orders they look at are their own (`hasOrder`). So no bot can act on
 * something its faction cannot see. A test pins that, because it is an
 * invariant rather than an accident.
 */
export function proposeFor(state: WorldState, factionId: string): Proposal | null {
  const bot = BOTS[factionId];
  if (!bot) return null;

  const raw = bot({ state, me: factionId });
  const { ops, withheld } = honourTreaties(state, factionId, raw);
  if (ops.length === 0) return null;

  return { factionId, ops, rationale: describeProposal(state, factionId, ops), withheld };
}
