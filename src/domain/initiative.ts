import {
  COMMANDER_COST,
  MAX_ACTIVE_COMMANDERS,
  activeCommanders,
  commanderAt,
} from './command.js';
import { neighboursOf, shortestPath } from './graph.js';
import { FIXTURE_COST, isTreatyLive } from './diplomacy.js';
import { ASSET_ARCHETYPES } from './assets.js';
import {
  hullsAt,
  presentAt,
  fleetStrengthOf,
  fleetBases,
  fleetTonsOf,
  tonsAt,
  holdsGround,
  livesOffTheLanes,
  dispositionBetween,
  warsFor,
  ledgerFor,
  stackAt,
  getFaction,
  statFixtureAt,
  isStatFixture,
  fixtureUpkeepForCount,
  WORLD_TYPE_STAT,
  type StarSystem,
  type WorldState,
} from './state.js';
import {
  CREDITS_PER_TON,
  HULL_CLASSES,
  battleshipEquivalents,
  HULL_SPEC,
  UPKEEP_PER_TON,
  describeStack,
  drawProportional,
  drawToWeight,
  hullsIn,
  mergeStacks,
  normaliseStack,
  subtractStack,
  type HullClass,
  type ShipStack,
} from './hulls.js';
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
 * NPC-vs-NPC aggression, while `vigil -> drajk` sat at **-87** and
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
const shipsAt = (s: WorldState, id: string, me: string): number => {
  const at = sys(s, id);
  return at ? hullsAt(at, me) : 0;
};
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
 * How much of a bot's tonnage it keeps as lift, and the floor under that.
 *
 * A world is taken by the troops the lift arm lands, so a bot with no
 * transports can win every orbital engagement in the galaxy and annex nothing.
 *
 * Sized from **the board rather than from the fleet**: enough for the largest
 * landing it can currently see, twice over, so one costly assault does not end
 * its offensive career. A fraction of tonnage was the first attempt and it is
 * the wrong shape — lift is bought for a job, so a fraction means a power that
 * has grown large hoards transports it will never use and pays upkeep on all of
 * them. It also drags the fleet's fighting weight down, since a lifter
 * contributes none: at a fifth of tonnage in lift and a matching screen a bot
 * fields barely three quarters of the combat power its credits bought, which
 * the harness reports as a galaxy where nobody attacks.
 */
const MIN_BOT_LIFTERS = 4;
const BOT_LANDINGS_HELD = 2;

/**
 * How much more than the garrison a bot wants ashore before it commits.
 *
 * `DEFENSIVE_GARRISON_BONUS` is 1.5 and the roll swings either way, so landing
 * exactly the garrison's worth of troops is a coin toss against half the map.
 */
const DUG_IN_MARGIN = 2;

/**
 * Buy hulls toward a fleet the faction's income can actually carry.
 *
 * The first version of these bots bought every turn they could afford to, and
 * every one of them ground down to a net of ~0 with an enormous fleet. That
 * was the bots being stupid rather than the economy being broken — but it also
 * hid the economy completely, because everyone ended up at the same place. A
 * player would stop; so does this.
 */
interface BuyDoctrine {
  /** What the yards lay down once lift and screen are covered. */
  line?: HullClass;
  /**
   * Whether to keep a screen at all.
   *
   * A screen is a defensive purchase — it brings a convoy home from a
   * withdrawal — so a power whose whole doctrine is preying on fleets it cannot
   * beat in orbit spends that tonnage on boats instead. Turning it off is the
   * only way a poor power reaches the line at all: sized ton for ton with the
   * lift arm, the screen ate every credit Drajk had spare for thirty turns and
   * its yards never laid down a warship.
   */
  screen?: boolean;
}

/**
 * How many officers a bot wants in post: one, plus one per three worlds held.
 *
 * **A class nobody builds is a class nobody has measured**, and the same is
 * true of a roster nobody keeps. Without this, recruitment would be a
 * player-only mechanic — the bots drive four of the five powers, so a cap of
 * five that only one power ever reaches is a cap on nothing. It is the same
 * mistake giving an officer a location made, caught the same way.
 *
 * Sized off **territory rather than treasury**, because officers are bought for
 * fronts: a power holding six worlds has more places a battle can happen than
 * one holding three, and hoarding commanders it cannot post is the shape of
 * error `lift` already made when it was a fraction of tonnage.
 *
 * Deliberately short of the cap at any realistic board size. Five is what the
 * rules allow, not what doctrine wants, and a bot that always maxes a limit
 * tells you nothing about whether the limit is right.
 */
function wantedOfficers(ctx: Ctx): number {
  const held = ctx.state.systems.filter((s) => s.controllerFactionId === ctx.me).length;
  return Math.min(MAX_ACTIVE_COMMANDERS, 1 + Math.floor(held / 3));
}

/**
 * Hire one officer a turn, at most, while short-handed and comfortably solvent.
 *
 * One at a time because a roster is a standing cost and a bot that filled it in
 * a single turn would be making an irreversible decision on one turn's
 * treasury. The reserve is deliberately several times the fee: an officer is
 * worth having and is never worth going short of hulls for.
 */
function hire(ctx: Ctx): Ops {
  if (activeCommanders(ctx.state.commanders, ctx.me).length >= wantedOfficers(ctx)) return [];
  if (purse(ctx.state, ctx.me) < COMMANDER_COST * 3) return [];
  const post = fleetBases(ctx.state, ctx.me).find((s) => s.controllerFactionId === ctx.me);
  if (!post) return [];
  return [{ op: 'recruit_commander', factionId: ctx.me, systemId: post.id }];
}

/**
 * Raise one fixture at a time, on the best held world with a free slot.
 *
 * **The bots build them because a fixture nobody builds is a fixture nobody
 * has measured** — the lesson `monopolist` taught by sitting implemented,
 * tested and dead for the life of the project. Four of the five powers are
 * played by this module on any given turn, so a mechanic only the player
 * reaches is a mechanic the harness cannot see.
 *
 * The **pure** archetype for the ground, never a split: a bot has no reason to
 * trade half its budget for an attribute the world does not make, and the
 * concentrated kind is the one whose reach the clamp is sized against. One
 * programme at a time, and only while comfortably solvent against both the
 * price and the upkeep it adds — the same shape `hire` takes, for the same
 * reason: a standing cost bought on one turn's treasury is a decision a bot
 * should not make in a hurry.
 */
function raise(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const underway = state.pendingOrders.some(
    (o) => o.factionId === me && o.onComplete?.kind === 'found_fixture',
  );
  if (underway) return [];
  if (purse(state, me) < FIXTURE_COST * 3) return [];
  // What the NEXT one adds to the bill, not what one costs on its own —
  // upkeep rises with the count, so the marginal building is the dearest one.
  const running = state.assets.filter((a) => a.heldBy === me && isStatFixture(a)).length;
  const marginal = fixtureUpkeepForCount(running + 1) - fixtureUpkeepForCount(running);
  if (ledgerFor(state, me).net < marginal * 4) return [];
  const site = state.systems
    .filter((s) => s.controllerFactionId === me && statFixtureAt(state, s.id) === undefined)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
  if (!site) return [];
  const ground = WORLD_TYPE_STAT[site.worldType];
  const kind = ASSET_ARCHETYPES.find(
    (a) => a.modifies !== undefined && a.modifies.length === 1 && a.modifies[0] === ground,
  )?.kind;
  if (!kind) return [];
  return [
    {
      op: 'issue_order',
      factionId: me,
      type: 'construction_infrastructure',
      originId: site.id,
      targetId: site.id,
      durationTurns: 3,
      label: `${kind.replace(/_/g, ' ')} at ${site.name}`,
      onComplete: { kind: 'found_fixture', magnitude: 1, fixtureKind: kind },
    },
  ];
}

function buy(ctx: Ctx, appetite: number, reserveTurns: number, doctrine: BuyDoctrine = {}): Ops {
  const line = doctrine.line ?? 'battleship';
  // A power with no ground has no yards unless its doctrine says otherwise, so
  // asking would only earn a rejection. The reducer is the rule; this keeps the
  // bots from generating ops it is going to refuse.
  const me = getFaction(ctx.state, ctx.me);
  if (!holdsGround(ctx.state, ctx.me) && !(me && livesOffTheLanes(me))) return [];
  const ledger = ledgerFor(ctx.state, ctx.me);
  const tons = fleetTonsOf(ctx.state, ctx.me);
  // Gross income supports a fleet of gross/upkeep TONS. Spend `appetite` of
  // that headroom, never past it.
  const sustainable = Math.floor((ledger.gross * appetite) / UPKEEP_PER_TON);
  const room = sustainable - tons;
  if (room <= 0) return [];

  // **The war chest is a number of TURNS, not a number of credits.** A flat
  // reserve is a fixed sum against an income that is not fixed, so a power
  // whose position collapses is locked out of rebuilding at exactly the moment
  // it most needs to: Drajk stripped of every world sat on 158 credits against
  // a reserve of 150, which rounds to **zero affordable tons**, and held 15
  // tons and a net of 1 unchanged from turn 30 to turn 50 — able to grow, never
  // able to pay for the first hull. Denominated in its own gross, the chest
  // shrinks with the power and there is always a first hull.
  const keep = Math.round(ledger.gross * reserveTurns);
  const budget = Math.max(0, purse(ctx.state, ctx.me) - keep);
  const affordable = Math.floor(budget / CREDITS_PER_TON);
  let tonsToSpend = Math.min(room, affordable, 8 * HULL_SPEC.battleship.tonnage);
  if (tonsToSpend <= 0) return [];

  // **A world is taken by the lift arm**, so a bot that only laid down
  // battleships would sterilise its neighbours' orbitals for thirty turns and
  // annex nothing. Lift is topped up first, to a fraction of the fleet rather
  // than to a fixed number, so a small power is not spending its whole yard on
  // transports and a large one keeps enough to mount more than one landing.
  const ops: Ops = [];
  const lift = lifterCount(ctx.state, ctx.me);
  // Enough for the largest landing on this board, twice over. `sortie` sizes a
  // landing the same way, so the yards and the fleet cannot disagree about what
  // an invasion needs.
  const biggest = frontier(ctx.state, ctx.me).reduce((n, t) => Math.max(n, t.garrison), 0);
  const wantLift = Math.max(
    MIN_BOT_LIFTERS,
    Math.ceil((biggest * DUG_IN_MARGIN + 1) / HULL_SPEC.lifter.carry) * BOT_LANDINGS_HELD,
  );
  const lifterTons = HULL_SPEC.lifter.tonnage;
  const buyLift = Math.min(Math.max(0, wantLift - lift), Math.floor(tonsToSpend / lifterTons));
  if (buyLift > 0) {
    ops.push({ op: 'adjust_fleet', factionId: ctx.me, delta: buyLift, hull: 'lifter', reason: 'lift' });
    tonsToSpend -= buyLift * lifterTons;
  }

  // **A convoy has an escort.** The lift arm is soft — it dies before the
  // battle line does — so a fleet that buys transports and no screen wins the
  // orbital battle and arrives with nothing to land. Sized to match the lift
  // it is protecting rather than to an expected loss, because a bot cannot
  // know what it is about to run into; ton for ton with the convoy is the
  // simplest statement of "escorted".
  const screen = escortCount(ctx.state, ctx.me);
  const wantScreen = doctrine.screen === false
    ? 0
    : Math.round(((lift + buyLift) * lifterTons) / HULL_SPEC.escort.tonnage);
  const escortTons = HULL_SPEC.escort.tonnage;
  const buyScreen = Math.min(
    Math.max(0, wantScreen - screen),
    Math.floor(tonsToSpend / escortTons),
  );
  if (buyScreen > 0) {
    ops.push({ op: 'adjust_fleet', factionId: ctx.me, delta: buyScreen, hull: 'escort', reason: 'screen' });
    tonsToSpend -= buyScreen * escortTons;
  }

  // **A hull nobody builds is a hull nobody has measured**, which is how
  // `monopolist` stayed implemented, tested and dead for the life of the
  // project. Both auxiliaries are therefore bought for a stated reason rather
  // than to a quota, the way lift is sized from the board and not from the
  // fleet — and both are capped low, because neither wins a battle and tonnage
  // spent here is tonnage not in the line.

  // A freighter earns only where a lane crosses ground nobody owns, so it is
  // sized from how much lawless ground this power actually sits next to.
  const junctions = frontier(ctx.state, ctx.me).filter(
    (t) => t.controllerFactionId === null,
  ).length;
  const wantHaul = Math.min(BOT_MAX_FREIGHTERS, junctions);
  const haul = hullEverywhere(ctx.state, ctx.me, 'freighter');
  const haulTons = HULL_SPEC.freighter.tonnage;
  const buyHaul = Math.min(Math.max(0, wantHaul - haul), Math.floor(tonsToSpend / haulTons));
  if (buyHaul > 0) {
    ops.push({ op: 'adjust_fleet', factionId: ctx.me, delta: buyHaul, hull: 'freighter', reason: 'hauling' });
    tonsToSpend -= buyHaul * haulTons;
  }

  // SIGINT is how a power with no spies sees. `maxAgentsFor` comes off guile,
  // so a faction below the median is bad at operatives by construction — and
  // buys ears instead, which is the whole argument for the class existing
  // beside the `surveillance` operative it duplicates.
  const guile = getFaction(ctx.state, ctx.me)?.stats.guile ?? 10;
  const wantEars = guile <= BOT_SIGINT_GUILE ? BOT_MAX_LISTENERS : 0;
  const ears = hullEverywhere(ctx.state, ctx.me, 'listener');
  const earTons = HULL_SPEC.listener.tonnage;
  const buyEars = Math.min(Math.max(0, wantEars - ears), Math.floor(tonsToSpend / earTons));
  if (buyEars > 0) {
    ops.push({ op: 'adjust_fleet', factionId: ctx.me, delta: buyEars, hull: 'listener', reason: 'sigint' });
    tonsToSpend -= buyEars * earTons;
  }

  const buyLine = Math.floor(tonsToSpend / HULL_SPEC[line].tonnage);
  if (buyLine > 0) {
    ops.push({ op: 'adjust_fleet', factionId: ctx.me, delta: buyLine, hull: line, reason: 'yards' });
  }
  return ops;
}

/**
 * How many freighters a bot will run, and how many ears.
 *
 * Both small on purpose. Neither hull wins an engagement, so every ton here is
 * a ton not in the line — the caps exist so that the classes are exercised on
 * a live board without the harness measuring a galaxy that forgot to build a
 * navy.
 */
/** Tons of shipping that make a raiding squadron — four battleships' worth. */
const RAID_SQUADRON_TONS = 16;

const BOT_MAX_FREIGHTERS = 3;
const BOT_MAX_LISTENERS = 2;
/** At or below this guile, a power is bad enough at spies to buy ears instead. */
const BOT_SIGINT_GUILE = 13;

/** Hulls of one class a faction has, in systems and under way. */
function hullEverywhere(s: WorldState, me: string, hull: HullClass): number {
  const inSystems = s.systems.reduce((n, sys) => n + (stackAt(sys, me)[hull] ?? 0), 0);
  const inTransit = s.pendingOrders
    .filter((o) => o.factionId === me && o.force)
    .reduce((n, o) => n + (o.force[hull] ?? 0), 0);
  return inSystems + inTransit;
}

/** Escorts a faction has, everywhere. */
function escortCount(s: WorldState, me: string): number {
  const inSystems = s.systems.reduce((n, sys) => n + (stackAt(sys, me).escort ?? 0), 0);
  const inTransit = s.pendingOrders
    .filter((o) => o.factionId === me && o.type === 'fleet_movement')
    .reduce((n, o) => n + (o.force.escort ?? 0), 0);
  return inSystems + inTransit;
}

/**
 * How much a faction can actually fight with at one world, in
 * **battleship-equivalents**.
 *
 * Every strength threshold in these bots was a hull count, calibrated when a
 * hull was a battleship and nothing else — and a hull count is wrong the moment
 * classes exist, because a cheap hull is still one hull. Measured twice, in the
 * same shape both times:
 *
 * - counting **transports** as strength took the Vigil from six systems to ten
 *   and reduced Meridian to one world at −126 net;
 * - counting **escorts** would do it again, more quietly, since an escort is a
 *   whole hull for a third of a battleship's weight.
 *
 * Battleship-equivalents are the unit the exchange itself compares, so a
 * threshold means the same thing whatever is in the fleet — and in a galaxy of
 * nothing but battleships it reads exactly as the hull count it replaces.
 */
function lineStrengthAt(s: WorldState, systemId: string, me: string): number {
  const sys = s.systems.find((x) => x.id === systemId);
  return sys ? battleshipEquivalents(stackAt(sys, me)) : 0;
}

/** The same, everywhere, including what is under way. */
function lineStrength(s: WorldState, me: string): number {
  const inSystems = s.systems.reduce((n, sys) => n + battleshipEquivalents(stackAt(sys, me)), 0);
  const inTransit = s.pendingOrders
    .filter((o) => o.factionId === me && o.type === 'fleet_movement')
    .reduce((n, o) => n + battleshipEquivalents(o.force), 0);
  return inSystems + inTransit;
}

/** Lifters a faction has, everywhere. *//** Lifters a faction has, everywhere. */
function lifterCount(s: WorldState, me: string): number {
  const inSystems = s.systems.reduce((n, sys) => n + (stackAt(sys, me).lifter ?? 0), 0);
  const inTransit = s.pendingOrders
    .filter((o) => o.factionId === me && o.type === 'fleet_movement')
    .reduce((n, o) => n + (o.force.lifter ?? 0), 0);
  return inSystems + inTransit;
}

/** Concentrate scattered hulls at one holding, so a blow can be struck. */
function massAt(ctx: Ctx, whereId: string, want: number): Ops {
  const ops: Ops = [];
  let owed = want - lineStrengthAt(ctx.state, whereId, ctx.me);
  if (owed <= 0) return ops;
  for (const base of held(ctx.state, ctx.me)
    .filter((b) => b.id !== whereId)
    .sort((a, b) => lineStrengthAt(ctx.state, b.id, ctx.me) - lineStrengthAt(ctx.state, a.id, ctx.me))) {
    if (owed <= 0) break;
    // Leave a token garrison behind rather than stripping the world bare.
    const spare = Math.max(0, lineStrengthAt(ctx.state, base.id, ctx.me) - 4);
    const take = Math.min(spare, owed);
    if (take <= 0) continue;
    // Class by class, so concentrating a fleet does not silently turn its
    // transports into battleships on the way: a bare `adjust_ships` removes in
    // loss order and adds battleships.
    for (const [hull, n] of movedClasses(ctx.state, base.id, ctx.me, take)) {
      ops.push(
        { op: 'adjust_ships', systemId: base.id, factionId: ctx.me, delta: -n, hull },
        { op: 'adjust_ships', systemId: whereId, factionId: ctx.me, delta: n, hull },
      );
    }
    owed -= take;
  }
  return ops;
}

/** Send `force` from the nearest holding that can supply the whole blow. */
function sortie(ctx: Ctx, targetId: string, force: number, label: string): Ops {
  // **Enough lift to take the place, or this is a raid.** A bot that sails
  // with guns only wins the orbitals and hands the world back, which is how
  // conquest quietly stops happening: the fleets still move, the map stops
  // changing, and nothing in the logs says why.
  const target = ctx.state.systems.find((x) => x.id === targetId);
  const garrison = target?.garrison ?? 0;
  const wantLift = Math.ceil((garrison * DUG_IN_MARGIN + 1) / HULL_SPEC.lifter.carry);

  const bases = held(ctx.state, ctx.me)
    .filter(
      (b) =>
        lineStrengthAt(ctx.state, b.id, ctx.me) >= force &&
        (stackAt(b, ctx.me).lifter ?? 0) >= wantLift,
    )
    .sort(
      (a, b) =>
        (shortestPath(ctx.state.systems, a.id, targetId)?.length ?? 99) -
          (shortestPath(ctx.state.systems, b.id, targetId)?.length ?? 99) ||
        a.id.localeCompare(b.id),
    );
  const from = bases[0];
  if (!from || force <= 0) return [];
  // Named explicitly rather than left to the proportional draw: the point of
  // the sortie is that a stated weight of warship goes with a stated number of
  // troops, and a proportion of whatever happened to be berthed is neither.
  const here = stackAt(from, ctx.me);
  const lifter = Math.min(wantLift, here.lifter ?? 0);
  const warships = subtractStack(here, { lifter: here.lifter ?? 0 });
  return [
    {
      op: 'issue_order', factionId: ctx.me, type: 'fleet_movement',
      originId: from.id, targetId,
      force: mergeStacks(drawToWeight(warships, force), { lifter }),
      // The officer sails if they are standing at the port the sortie leaves
      // from, and otherwise the fleet goes without one.
      //
      // **This is what keeps commanders from becoming a player-only mechanic.**
      // Giving an officer a location made presence the thing that decides which
      // battle they command, and the bots drive four of the five powers — so
      // without this an NPC officer would never reach a fight, never accrue a
      // `battles`, and never be worth losing. Measured exactly that way before
      // it was added: every officer on the board ended thirty turns at zero
      // engagements, where the same run had produced 3/2/1/0/0.
      //
      // Deliberately not a reason to MOVE them: the bots pick a port for the
      // fleet, not for the officer, so they are either there or they are not. A bot
      // that repositioned its commander to catch a sortie would be playing the
      // mechanic rather than its doctrine.
      commanderId: commanderAt(ctx.state.commanders, ctx.me, from.id)?.id ?? null,
      label,
    },
  ];
}

/** Which classes a move of `take` hulls actually draws, keeping the shape. */
function movedClasses(
  s: WorldState,
  systemId: string,
  me: string,
  take: number,
): [HullClass, number][] {
  const sys = s.systems.find((x) => x.id === systemId);
  if (!sys) return [];
  const drawn = drawProportional(stackAt(sys, me), take);
  return HULL_CLASSES.filter((h) => (drawn[h] ?? 0) > 0).map((h) => [h, drawn[h]!]);
}

const hasOrder = (s: WorldState, me: string, type: string): boolean =>
  s.pendingOrders.some((o) => o.factionId === me && o.type === type);

/**
 * How much a bot wants a particular world, prize and grievance together.
 *
 * `strategicValue` alone was the whole of it, tie-broken on system id — so the
 * Iron Vigil, whose doctrine is *"answer insolence with force"*, picked the
 * richest thing on its border and was indifferent to who was standing on it.
 * A power it loathed at -95 and one it liked at +50 were the same target at the
 * same value.
 *
 * **A thumb on the scale, not the scale.** Standing is worth at most
 * `GRIEVANCE_WEIGHT` against a `strategicValue` that runs 0-10, so a grievance
 * can reorder two comparable prizes and cannot turn a worthless world into a
 * war aim. That bound is the point rather than timidity: the item that asked for
 * this named the failure mode, which is that *always* attacking whoever you hate
 * most makes the board deterministic and flattens `opportunist` (hits the weak)
 * into `crusading` (hits regardless) — two distinctions the harness exists to
 * keep visible.
 *
 * Unaligned ground scores its prize and no grievance, because there is nobody
 * there to have offended you. That is also what stops this being a general
 * increase in aggression: a neutral world and a rival's world are still compared
 * on what they are worth.
 */
export const GRIEVANCE_WEIGHT = 4;

export function targetPriority(state: WorldState, me: string, target: StarSystem): number {
  const holder = target.controllerFactionId;
  if (!holder || holder === me) return target.strategicValue;
  const standing = dispositionBetween(state, me, holder);
  return target.strategicValue + (Math.max(0, -standing) / 100) * GRIEVANCE_WEIGHT;
}

/**
 * The warship weight needed to clear a world's orbit, in battleship-equivalents.
 *
 * **The garrison is not in it, and that was a units bug in four bots.** An
 * invasion has two independent requirements in two different currencies:
 *
 * | | beaten by | requirement |
 * |---|---|---|
 * | the defending fleet | warship weight | ~2x their battleship-equivalents |
 * | the garrison | **lifters** | `lifters * LIFTER_CARRY > garrison` |
 *
 * Warships cannot touch a garrison — `resolveBattle`'s orbital phase is
 * *"purely ship against ship: the garrison takes no part and grants no bonus"*
 * — and lifters cannot fight a fleet. `sortie` already sizes lift correctly and
 * separately, at `DUG_IN_MARGIN` times the garrison.
 *
 * The Vigil's bot was asking for `2.2 * (garrison + enemy ships)` of
 * **warships**, so every defender's garrison was paid for twice: once properly
 * in transports, and again as though troops dug in on a planet were capital
 * ships in orbit. On `tor-1` — garrison 9, squadron 11 BE — it demanded 44 BE
 * where the battle needs 22 and four lifters, which is exactly double, against
 * an opening fleet of 34. That is why it could not sail until turn 8.
 *
 * It is the same units drift this module already fixed once, when hull counts
 * were standing in for battleship-equivalents and *"counting transports among
 * them makes a fleet cross its own thresholds faster the more lift it buys."*
 * Here it was troops standing in for tonnage.
 *
 * Floored at a token weight so an undefended world still gets a real escort
 * sent with the convoy: the orbit may be empty now and need not be on arrival.
 */
const MIN_SORTIE_WEIGHT = 4;

function orbitalNeed(state: WorldState, me: string, target: StarSystem): number {
  const defenders = Object.keys(target.ships ?? {})
    .filter((id) => id !== me)
    .reduce((n, id) => n + lineStrengthAt(state, target.id, id), 0);
  return Math.max(MIN_SORTIE_WEIGHT, Math.ceil(defenders * ORBITAL_MARGIN));
}

/**
 * How far past the 2:1 break-off a bot wants to be before it commits.
 *
 * `resolveBattle` breaks a defender off at exactly 2.0, and the seeded d20
 * swings each side's power by up to ±43% — so a fleet at exactly 2:1 on paper
 * is in the mutual-bleed band on a bad roll. The margin is the bot's caution,
 * not a rule of the game: a player may attack at any odds they like.
 */
const ORBITAL_MARGIN = 2.2;

/** Transit value crossing a system — what a raid or blockade there is worth. */
function trafficAt(s: WorldState, systemId: string): number {
  return tradeRoutes(s)
    .filter((r) => r.path.slice(1, -1).includes(systemId))
    .reduce((n, r) => n + r.volume, 0);
}

/**
 * The sector a power began in: where most of the worlds it started with lie.
 *
 * Read off `homeFactionId`, which the seed writes once and never again, so this
 * is a fixed fact about where a power comes from rather than a moving readout of
 * what it currently holds. A power driven out of its own sector still wants it
 * back; one that conquers half of somebody else's does not acquire a claim to
 * the rest of it.
 *
 * Pure, and derived rather than declared — there is no new seed field to keep in
 * step, and a campaign replays it identically.
 */
function homeSectorOf(state: WorldState, me: string): string | null {
  const count = new Map<string, number>();
  for (const sys of state.systems) {
    if (sys.homeFactionId !== me) continue;
    count.set(sys.sector, (count.get(sys.sector) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const [sector, n] of [...count].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > most) {
      most = n;
      best = sector;
    }
  }
  return best;
}

/**
 * Worlds in a power's own sector that it does not hold.
 *
 * **This is what gives four of the five bots a reason to take ground.** Before
 * it, only the Vigil ever attacked a world another power held: Meridian took
 * unclaimed worlds with a garrison of three or less, the Combine parked on empty
 * junctions, Arkane took unclaimed ground in its own sector, and Drajk raided.
 * So once the five neutral worlds were gone the galaxy had exactly one
 * aggressor, and when it ran out of cheap targets the board stopped moving —
 * at any disposition, including every power at -100.
 *
 * A sector is the right unit for that appetite because it is **bounded and
 * geographic**. "Take everything" makes every bot the same bot and ends in one
 * power holding the map; "take the next cheap thing" is what produced the
 * stall. A power that wants its own sector whole wants a specific, finite list
 * of worlds, stops when it has them, and is opposed by whoever is standing on
 * them — which the seed already arranges, because **Drajk holds a world in
 * three of the four sectors** and Meridian holds `tor-1` in the Vigil's.
 */
function sectorGaps(state: WorldState, me: string): StarSystem[] {
  const home = homeSectorOf(state, me);
  if (home === null) return [];
  return state.systems
    .filter((x) => x.sector === home && x.controllerFactionId !== me)
    .sort((a, b) => {
      // **Unclaimed ground first.** Consolidating your own sector is cheaper
      // than evicting somebody from it, needs no war, and is what a power
      // actually does first. It is also what keeps Drajk on the board: the
      // Confederacy squats in three of the four sectors, so when every home
      // power reaches for a rival's holding before an empty world, all three of
      // them reach for Drajk at once and it is carved up by turn 12 — one world
      // left in an ordinary run and **none at all** under total war.
      const empty = Number(a.controllerFactionId === null) - Number(b.controllerFactionId === null);
      return (
        empty || targetPriority(state, me, b) - targetPriority(state, me, a) || a.id.localeCompare(b.id)
      );
    });
}

/**
 * Worlds that began the campaign under nobody's flag.
 *
 * Drajk's appetite, and deliberately not a sector: the Confederacy's line is
 * *"borders are a fiction maintained by people with fleets"*, so a power whose
 * doctrine is the denial of borders should not be handed one to defend. What it
 * wants is that the unclaimed middle of the map stays unclaimed, or becomes its
 * own — which is the same sentence either way, and reaches across three sectors
 * without giving it a home in any of them.
 *
 * Read off `homeFactionId === null`, so it is fixed at turn 0: a world Drajk
 * itself takes stays on the list as something to hold rather than becoming
 * territory, and one a rival annexes becomes something to take back.
 */
function lawlessGround(state: WorldState, me: string): StarSystem[] {
  return state.systems
    .filter((x) => x.homeFactionId === null && x.controllerFactionId !== me)
    .sort((a, b) => {
      // Ground a rival has annexed first — that is the border being drawn, and
      // the whole objection. Unclaimed ground is merely opportunity.
      const claimed = Number(b.controllerFactionId !== null) - Number(a.controllerFactionId !== null);
      return claimed || trafficAt(state, b.id) - trafficAt(state, a.id) || a.id.localeCompare(b.id);
    });
}

/**
 * Mass, then strike — the two-step every land-taking bot shares.
 *
 * `sortie` needs ONE holding that can supply the whole blow, so a power whose
 * navy is spread across four worlds can be strong enough in total and unable to
 * sail. Concentrating first is what makes an attack reachable at all; it was
 * written twice, in the Vigil and in Arkane, before four bots needed it.
 */
/**
 * Take station over a world without landing on it.
 *
 * **Presence, not conquest**, and for Drajk the difference is the doctrine. A
 * warship-only squadron wins the orbit and then cannot put anybody ashore, so
 * the world stays unaligned with Drajk hulls sitting on it — which contests its
 * income, denies it to whoever wanted to annex it, and leaves the Confederacy
 * holding no ground worth besieging. *"The unclaimed middle of the map stays
 * unclaimed, or becomes Drajk's"* is one sentence, and this is its first half.
 *
 * It is also what the Confederacy can afford. Conquest costs lift, lift dies
 * first in the loss order, and the poorest power on the board buying transports
 * for five worlds across three sectors went insolvent at -33 a turn. A blockading
 * squadron costs warships it already has.
 */
const OCCUPY_RESERVE = 3;

function occupy(ctx: Ctx, target: StarSystem, label: string): Ops {
  const need = orbitalNeed(ctx.state, ctx.me, target);
  // **`OCCUPY_RESERVE` is what has to stay home, and it was swept both ways.**
  // At `MIN_SORTIE_WEIGHT` (4) no base on Drajk's board ever qualified — its
  // best holding fields 6.3 battleship-equivalents — and the doctrine was
  // silent. At 0 or 2 it sails, and the squadron it sends is the squadron that
  // was holding `ilv-6`: the Vigil takes that world, then four more, ending at
  // eight while Drajk is reduced to **one**. A power with no ground worth
  // besieging still has ground worth keeping.
  const from = held(ctx.state, ctx.me)
    .filter((b) => lineStrengthAt(ctx.state, b.id, ctx.me) >= need + OCCUPY_RESERVE)
    .sort(
      (a, b) =>
        (shortestPath(ctx.state.systems, a.id, target.id)?.length ?? 99) -
          (shortestPath(ctx.state.systems, b.id, target.id)?.length ?? 99) ||
        a.id.localeCompare(b.id),
    )[0];
  if (!from) return [];
  const here = stackAt(from, ctx.me);
  // Warships only. Carrying lift would land it and take the world, which is the
  // thing this doctrine declines to do.
  const warships = subtractStack(here, { lifter: here.lifter ?? 0 });
  const force = drawToWeight(warships, need);
  if (hullsIn(force) === 0) return [];
  return [
    {
      op: 'issue_order', factionId: ctx.me, type: 'fleet_movement',
      originId: from.id, targetId: target.id, force,
      commanderId: commanderAt(ctx.state.commanders, ctx.me, from.id)?.id ?? null,
      label,
    },
  ];
}

function press(ctx: Ctx, target: StarSystem, label: string): Ops {
  const need = orbitalNeed(ctx.state, ctx.me, target);
  // **Sail first, and from anywhere.** `sortie` already finds the nearest
  // holding that can supply the whole blow, at any range, so gating the attempt
  // on an ADJACENT staging base was a second, stricter rule laid over a
  // mechanism that did not need it — and it silenced Drajk completely, whose
  // four worlds do not touch a single one of the five that began unaligned.
  const away = sortie(ctx, target.id, need, label);
  if (away.length > 0) return away;

  // Nothing could supply it, so concentrate toward the frontier world nearest
  // the target and try again next turn.
  const staging = held(ctx.state, ctx.me)
    .filter((b) => neighboursOf(ctx.state, b.id).includes(target.id))
    .sort(
      (a, b) =>
        lineStrengthAt(ctx.state, b.id, ctx.me) - lineStrengthAt(ctx.state, a.id, ctx.me) ||
        a.id.localeCompare(b.id),
    )[0];
  if (!staging) return [];
  if (lineStrength(ctx.state, ctx.me) >= need + 8) return massAt(ctx, staging.id, need);
  return [];
}

/**
 * Take the best thing you can take today; failing that, build toward the best
 * thing there is.
 *
 * **A bot used to commit to its single highest-prize target and stay committed**,
 * which is why the Combine issued nothing for thirty turns: it wanted `ilv-6`
 * (a raider's world, value 7, garrison 9, wanting 14 battleship-equivalents and
 * four transports at one base), massed toward it every turn, and stalled around
 * thirteen — while `ilv-4` sat unclaimed next door at garrison 2, needing four
 * and one. It could not take the prize and would not take the rock.
 *
 * So the order is: walk the list in priority order and sail at the first target
 * a base can actually supply; if none can, concentrate toward the best one, as
 * before. A commander takes what is takeable and builds toward what is not, and
 * the fallback is what turns a permanent stall into a slower campaign.
 *
 * `sortie` and `occupy` both return `[]` when nothing can supply the blow, so
 * "can I do this today" needs no separate predicate — the attempt is the test.
 */
function pursue(
  ctx: Ctx,
  candidates: StarSystem[],
  label: (t: StarSystem) => string,
  go: (ctx: Ctx, t: StarSystem, label: string) => Ops = press,
): Ops {
  for (const target of candidates) {
    const ops = go(ctx, target, label(target));
    // `press` also returns massing ops, which are not an attack — those are the
    // fallback, not a reason to stop looking for something reachable.
    if (ops.some((o) => o.op === 'issue_order')) return ops;
  }
  const best = candidates[0];
  return best ? go(ctx, best, label(best)) : [];
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
  ops.push(...buy(ctx, 0.55, 1.3));
  ops.push(...hire(ctx));
  ops.push(...raise(ctx));

  // The Verge, whole. A trading power's sovereignty is the ground its lanes run
  // over, and three of the Sekkar's six worlds have never been anybody's — which
  // is also where Drajk goes looking, so Meridian's appetite and the
  // Confederacy's are aimed at the same three rocks.
  if (!hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    ops.push(...pursue(ctx, sectorGaps(ctx.state, ctx.me), (t) => `secure ${t.name}`));
  }
  return ops;
};

/**
 * "Hold the Torrek until order is restored, answer insolence with force."
 * Crusading and autarkic: builds hard, and attacks the best thing it can beat.
 */
const vigil: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.85, 0.53));
  ops.push(...hire(ctx));
  ops.push(...raise(ctx)); // crusading: spends most of its income on hulls

  if (hasOrder(ctx.state, ctx.me, 'fleet_movement')) return ops;

  const target = frontier(ctx.state, ctx.me)
    .map((t) => {
      const defence =
        t.garrison +
        Object.entries(t.ships ?? {})
          .filter(([id]) => id !== ctx.me)
          .reduce((n, [id]) => n + lineStrengthAt(ctx.state, t.id, id), 0);
      return { t, defence, prize: targetPriority(ctx.state, ctx.me, t) };
    })
    // `defence` decides whether there is anything here to fight at all —
    // garrison or ships — and nothing else. What it must NOT do is size the
    // fleet; see `orbitalNeed`.
    .filter(({ defence }) => defence > 0)
    .sort((a, b) => b.prize - a.prize || a.t.id.localeCompare(b.t.id))[0];

  if (target) {
    const need = orbitalNeed(ctx.state, ctx.me, target.t);
    // Crusading, not suicidal: it masses first, then strikes when it can
    // actually carry the world. Without the massing step it never attacked at
    // all, and a crusader that never crusades tests nothing.
    // **The Torrek first.** "Hold the Torrek until order is restored" is the
    // first clause of the doctrine and the crusade is the second, so the
    // Marches are put back in order before the Vigil goes looking further
    // afield. Without that ordering it is the only power on the board with an
    // unbounded appetite — everyone else now wants a sector and stops — and it
    // simply runs away with the map, reaching eight worlds while Drajk is
    // ground down to one.
    const home = sectorGaps(ctx.state, ctx.me);
    ops.push(
      ...(home.length > 0
        ? pursue(ctx, home, (t) => `restore order at ${t.name}`)
        : press(ctx, target.t, `pacify ${target.t.name}`)),
    );
  }
  return ops;
};

/**
 * "Fund both sides, own the survivor, and let other powers spend their fleets
 * for you." Sits on its chokepoints, works neutral junctions, and blockades
 * rather than invades — it will not commit its own hulls to a conquest.
 */
const ojjul: Bot = (ctx) => {
  const ops: Ops = [];
  ops.push(...buy(ctx, 0.5, 1.91));
  ops.push(...hire(ctx));
  ops.push(...raise(ctx)); // will not spend its own hulls freely

  // The Fringe, whole. The Combine's chokepoints are only worth what the lanes
  // through them carry, and two of the Ilvenn's richest crossings are held by a
  // raider — so "own the survivor" starts at home.
  if (!hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    ops.push(...pursue(ctx, sectorGaps(ctx.state, ctx.me), (t) => `take ${t.name}`));
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
  // **A defensive power spends a larger share of its income on its navy** —
  // that is what defensive means — where Meridian at 0.55 banks the difference.
  // It also has to: at 0.6 the Drift's opening fleet of 123 tons was already
  // above the 117 its own gross would carry, so `buy` returned `room <= 0` and
  // the yards laid down **nothing at all for thirty turns**. Arkane kept the
  // single lifter it started with, could never mount the two-transport landing
  // its own sector needed, and its income sat flat from turn 5 to turn 30 —
  // read as a balance signal when it was a power unable to act at all.
  ops.push(...buy(ctx, 0.8, 1.54));
  ops.push(...hire(ctx));
  ops.push(...raise(ctx));

  // The Drift, whole — and nothing beyond it. That sentence was already this
  // bot's comment; what it could not previously do is remove a squatter, so
  // "take no master" stopped at ground nobody was standing on.
  const gaps = sectorGaps(ctx.state, ctx.me);
  if (gaps.length > 0 && !hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    // Mass, then strike — see `press`. This faction was invisible to the harness
    // without that step: the Drift wanted 16 hulls for Sennex and kept a navy of
    // 31 spread 10/7/8/6, so no single base ever qualified and the bot issued
    // nothing for thirty turns. Its income sat at exactly 71/turn from turn 5 to
    // turn 30, and that flat line was read as a balance signal when it was the
    // harness never letting the faction move.
    ops.push(...pursue(ctx, gaps, (t) => `secure ${t.name}`));
  }
  return ops;
};

/**
 * "Raid the rich, vanish into the deep lanes, and never hold ground worth
 * besieging." Works lawless junctions for traffic and raids the busiest
 * transit system it can reach. Buys few hulls; it cannot afford many.
 */
const drajk: Bot = (ctx) => {
  const ops: Ops = [];
  // **Boats, not a battle line.** The Jeune École answer to a power you cannot
  // beat in orbit: cheap hulls that put their share of the fire through the
  // screen and onto the capital ships, rather than a line that would simply
  // lose to a richer one. It is the doctrine the Confederacy already has —
  // *"borders are a fiction maintained by people with fleets"* — expressed in
  // what its yards lay down, and it is what gives the class an owner in the
  // harness the way each ethic has one.
  ops.push(...buy(ctx, 0.7, 0.89, { line: 'torpedo_boat', screen: false }));
  ops.push(...hire(ctx));
  ops.push(...raise(ctx));

  // The unclaimed middle of the map stays unclaimed, or becomes Drajk's — and a
  // world somebody else has just annexed is the first thing on the list, because
  // that is a border being drawn. It takes no sector of its own: a power whose
  // line is "borders are a fiction maintained by people with fleets" should not
  // be handed one to defend. See `lawlessGround`.
  if (!hasOrder(ctx.state, ctx.me, 'fleet_movement')) {
    // Deliberately NOT filtered to what it already borders. Drajk holds ark-5,
    // tor-6, ilv-6 and ilv-7, and **not one of them touches a world that began
    // unaligned** — so an adjacency test silences the doctrine completely, which
    // is what a first pass at this did. `occupy` and `sortie` both find the
    // nearest base that can supply the blow and sail however far it is; reaching
    // across the map is the Confederacy's whole manner of operating.
    // A border somebody else has drawn is taken down; ground nobody has claimed
    // is merely stood on. See `occupy`.
    ops.push(
      ...pursue(
        ctx,
        lawlessGround(ctx.state, ctx.me),
        (t) => (t.controllerFactionId !== null ? `break the claim on ${t.name}` : `work ${t.name}`),
        press,
      ),
    );
  }

  // Raid the busiest lane a squadron can reach. A raider does not need to
  // hold the system — it lurks a jump out — which is the whole point of the
  // Confederacy: it preys on powers it could never beat in orbit.
  //
  // **Weighed in TONS, because the question is whether a squadron is there.**
  // It was four battleship-equivalents, which is a fighting-weight unit, and a
  // torpedo boat carries 0.1 of one by design — its whole output is the opening
  // strike. So the Confederacy, whose buy doctrine is `line: 'torpedo_boat'`,
  // needed **120 boats and 3,600 credits** to unlock the mechanic that is its
  // entire economic identity, against four battleships and 240 for anybody
  // else. It raided at all only while it still had battleships left from the
  // seed; a Drajk that had actually followed its own doctrine could never raid.
  //
  // The same units drift as the garrison double-count, in the same module: a
  // threshold written when a hull meant a battleship, read against a hull
  // chosen for a different property. Tons is the unit every fleet-size limit in
  // the game is denominated in, and 16 of them is what four battleships used to
  // weigh — so nothing changes for a power that builds a line.
  if (!hasOrder(ctx.state, ctx.me, 'commerce_raiding')) {
    const reachable = new Set<string>();
    for (const base of ctx.state.systems) {
      if (tonsAt(base, ctx.me) < RAID_SQUADRON_TONS) continue;
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


export const BOTS: Record<string, Bot> = { meridian, vigil, ojjul, freeworlds, drajk };

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

/**
 * How well a power must think of a neighbour for its own doctrine to refuse to
 * attack them, absent a war. Strictly positive standing protects you.
 *
 * **The bots read no standing at all before this.** A power that loathed you at
 * −95 with no paper between you picked its targets exactly as one that liked you
 * at +50 did: `lineStrength`, garrison, adjacency. `honourTreaties` was the only
 * relationship any of them consulted, which made *paper* the sole restraint and
 * left the whole range between neutral and war inert — for the half of the
 * galaxy that is played by arithmetic on an ordinary turn.
 *
 * That was a correct decision that stopped being correct. CLAUDE.md filed it
 * honestly as a limitation of the harness — *"the counterplay their position
 * invites is political, and politics is what the model-driven game supplies"* —
 * and that argument holds only while the bots play nobody but each other. They
 * now run in `endTurn` for every faction the model did not speak for.
 *
 * ## This is an invariant, not a behaviour change, and it is measured as one
 *
 * It withholds **nothing** across 30 harness turns and nothing on all 24 played
 * boards in `saves/`. That is not a threshold that wants tuning; it is what the
 * board is actually like. The whole galaxy issues **four fleet movements in
 * thirty turns** — wars here are rare and decisive, the same fact that made the
 * first veterancy thresholds unreachable — and only one bot ever attacks a world
 * another power holds, its target being one it already dislikes.
 *
 * So what this buys is a guarantee rather than a difference: a bot will never
 * send a fleet at a power it is on good terms with, which a model-driven campaign
 * can reach easily and the bots cannot reach on their own. The behaviour half of
 * the same item is `targetPriority`, which fires every turn. Pinned on a
 * constructed board in `tests/initiative.test.ts`, because a guard nobody has
 * watched fire is the failure this repo keeps catching.
 *
 * **Set where it is a rule rather than a number.** At −21 and below the Vigil's
 * campaign against Meridian at −20 is withheld too, and −20 is mild dislike in a
 * lawless outer rim rather than friendship: gating it says a power may only
 * attack what it hates past a quarter of the scale, which is over-firing. Zero
 * is the line that states itself — *nobody attacks a neighbour that thinks well
 * of them* — and it leaves the measured board untouched.
 *
 * ## Read on my own view of them, and only outside a war
 *
 * `warsFor` first, because it is **bilateral** and a war is a property of the
 * relationship: a power that has been attacked may answer whatever its own
 * opinion was a moment ago.
 *
 * Outside a war the test is *my* view of *them*, which is what keeps this from
 * closing the positive feedback loop the item warned about. Every mechanical
 * disposition cost in the game moves the **injured** party's view of the
 * aggressor and nothing moves the aggressor's view of its victim — so attacking
 * cannot talk me into attacking again, while it can and should talk my victim
 * into answering. Gating on the worse of the two directions would make the first
 * war self-reinforcing and permanent, since disposition has no decay.
 *
 * **Unaligned ground is not gated**, which is most of why the board keeps
 * moving: a world with no flag over it has nobody to have offended, and taking
 * unclaimed space is not an act against a power. Nor is interdiction — raiding
 * is deliberately available to anyone, and `PIRACY_REPUTATION_COST` already
 * prices doing it to a power that does not expect it of you. Gating that too
 * would have taken the Confederacy's whole economy away from it: Drajk's best
 * prey is the Combine, which it likes at +30.
 */
export const BOT_AGGRESSION_CEILING = 0;

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

/**
 * Strip attacks on powers this faction has no quarrel with.
 *
 * A second post-filter beside `honourTreaties` rather than a check threaded
 * into five bots, for the reason that one is: a bot added later inherits the
 * guard without knowing it exists. See `BOT_AGGRESSION_CEILING`.
 *
 * What it withholds is **reported**, exactly as a treaty refusal is. A power
 * that quietly does less than its doctrine demands is the bug this module was
 * written to fix, and a silent restraint is indistinguishable from a broken bot.
 */
function honourStanding(
  state: WorldState,
  me: string,
  ops: Record<string, unknown>[],
): { ops: Record<string, unknown>[]; withheld: string[] } {
  const withheld: string[] = [];
  const enemies = new Set(warsFor(state, me));
  const kept = ops.filter((op) => {
    if (op.op !== 'issue_order' || op.type !== 'fleet_movement') return true;
    const target = sys(state, String(op.targetId ?? ''));
    const holder = target?.controllerFactionId;
    // Your own world is reinforcement, and unaligned ground has nobody to have
    // offended.
    if (!target || !holder || holder === me) return true;
    if (enemies.has(holder)) return true;

    const standing = dispositionBetween(state, me, holder);
    if (standing > BOT_AGGRESSION_CEILING) {
      withheld.push(
        `an attack on ${target.name}, which it has no quarrel with ${getFaction(state, holder)?.name ?? holder} to justify (${standing})`,
      );
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
        // `op.force` is a stack now, and interpolating one yields
        // "[object Object]" — legal TypeScript, and it would put that in the
        // event log the next reaction call reads back.
        parts.push(
          `sends ${describeStack(normaliseStack((op.force ?? {}) as ShipStack))} from ${where(op.originId)} against ${where(op.targetId)}`,
        );
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
  // Paper first, then standing. Both are post-filters over one proposal, so a
  // bot cannot route around either and the order between them only decides
  // which reason is given for an act both would have refused.
  const paper = honourTreaties(state, factionId, raw);
  const standing = honourStanding(state, factionId, paper.ops);
  const ops = standing.ops;
  const withheld = [...paper.withheld, ...standing.withheld];
  if (ops.length === 0) return null;

  return { factionId, ops, rationale: describeProposal(state, factionId, ops), withheld };
}
