import {
  COMMANDER_COST,
  MAX_ACTIVE_COMMANDERS,
  activeCommanders,
  commanderAt,
} from './command.js';
import { neighboursOf, shortestPath } from './graph.js';
import {
  AGENT_COST,
  FIXTURE_COST,
  TRUCE_TURNS,
  atWork,
  fixtureIntegrity,
  hookedBy,
  isCommodity,
  ULTIMATUM_YIELD_RATIO,
  isTreatyLive,
  truceBetween,
  bountyOn,
  commissionsAgainst,
  protectedFrom,
  raidLandsOn,
} from './diplomacy.js';
import { EFFECT_COST, MIN_DEVELOPMENT_COST } from './development.js';
import {
  BATTLE_REGARD,
  CONQUEST_REGARD,
  CONTENT_REGARD,
  HOLD_DIVISOR,
  PROTECTION_LINE,
  envoyRefusal,
  holdAt,
  holdingFactor,
  regardFor,
  regardRecorded,
  wantOf,
} from './regard.js';
import { ENVOYS_QUIET_TURNS } from './events.js';
import { clashKey } from './pulse.js';
import { jumpsBetween } from './graph.js';
import { secretLive, sideStrength } from './leverage.js';
import { HEAT_NOTORIOUS } from './heat.js';
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
  effectiveStats,
  fixtureSlotRefusal,
  statFixturesAt,
  isStatFixture,
  fixtureUpkeepForCount,
  WORLD_TYPE_STAT,
  liveAgentsOf,
  maxAgentsFor,
  MAX_TREATY_INCOME_PER_TURN,
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
import { routeEarnings, routeLegs, tradeRoutes } from './trade.js';
import { STAT_NAMES, statModifier } from './checks.js';

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
 * 1. Responders are chosen by `involvedFactions` from what the PLAYER's ops
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
 * What a power's might does to its weight in a battle: `resolveBattle` reads
 * every side as `weight * (1 + modifier / 20)`, in the exchange and on the
 * ground alike.
 *
 * **The bots used to read no stat at all**, so they sized every attack on raw
 * weight and a stronger power struck exactly when a weaker one would. That is
 * why the rally (item 123) could fire for most of a campaign and never turn a
 * war in the harness: a power whose occupied homeland had lifted its might by
 * three sailed at the same odds as before, and never leaned into what its
 * situation had given it. Read through `effectiveStats`, so terrain, fixtures,
 * the rally and dissent all reach the decision the way they reach the dice.
 *
 * A rival is read as the fog shows it to this power (`seenBy`): an unexposed
 * operative's `stat_debuff` is known to its victim and its owner, so a bot
 * counts the ones it runs and no one else's.
 */
function mightFactor(state: WorldState, factionId: string, me: string): number {
  const stats = effectiveStats(state, factionId, factionId === me ? {} : { covert: false, seenBy: me });
  return 1 + statModifier(stats.might) / 20;
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
 * What it raises is `fixtureKindFor`: the pure kind for the ground first, and
 * the second slot a split. One programme at a time, and only while comfortably
 * solvent against both the price and the upkeep it adds — the same shape
 * `hire` takes, for the same reason: a standing cost bought on one turn's
 * treasury is a decision a bot should not make in a hurry.
 */
/**
 * The fixture a power would raise next on one of its worlds, or null when the
 * world has no room for anything it could build.
 *
 * **The pure kind for the ground first**: the concentrated one is what the
 * clamp is sized against, and a power has no reason to trade half the budget
 * for an attribute the world does not make while the whole of it is on offer.
 * **The second slot is a split**, because a world's two fixtures must differ
 * and every kind the ground allows names its stat — pairing it with the power's
 * strongest other attribute that still has room under 20, so a bot builds
 * toward what it already is. Ties go in stat order, so replay walks it the same.
 *
 * Shared with the help text's example, so the line a player is shown is the
 * line a bot in their seat would choose.
 */
export function fixtureKindFor(state: WorldState, me: string, site: StarSystem): string | null {
  const ground = WORLD_TYPE_STAT[site.worldType];
  const stats = effectiveStats(state, me);
  const options = ASSET_ARCHETYPES.filter((a) => a.modifies?.includes(ground));
  const pure = options.filter((a) => a.modifies!.length === 1);
  const splits = options
    .filter((a) => a.modifies!.length === 2)
    .map((a) => ({ kind: a.kind, other: a.modifies!.find((x) => x !== ground)! }))
    .filter((x) => stats[x.other] < 20)
    .sort(
      (a, b) =>
        stats[b.other] - stats[a.other] || STAT_NAMES.indexOf(a.other) - STAT_NAMES.indexOf(b.other),
    );
  for (const kind of [...pure.map((a) => a.kind), ...splits.map((x) => x.kind)]) {
    if (fixtureSlotRefusal(state, site, kind) === null) return kind;
  }
  return null;
}

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
  // Judged against STANDING income: a building is paid for every turn, and
  // this turn's prizes and the bounties on them are not — a raid runs out, and
  // a fixture raised on a good raiding turn is a bill the next quiet one
  // cannot meet.
  const ledger = ledgerFor(state, me);
  if (ledger.net - ledger.raided - ledger.bounties < marginal * 4) return [];
  // **Every empty world before any second slot.** Stacking both on the best
  // world was the first version, and it moved the board: the Vigil's second
  // building at Vantic was a split carrying might, and Threx fell on turn 10
  // rather than 18. Filling bare ground first is what the bots did when a world
  // held one, so the second slot is headroom for a power that has run out of
  // empty worlds rather than a new place to concentrate.
  const pick = state.systems
    .filter((s) => s.controllerFactionId === me)
    .sort(
      (a, b) =>
        statFixturesAt(state, a.id).length - statFixturesAt(state, b.id).length ||
        b.strategicValue - a.strategicValue ||
        a.id.localeCompare(b.id),
    )
    .map((s) => ({ site: s, kind: fixtureKindFor(state, me, s) }))
    .find((p): p is { site: StarSystem; kind: string } => p.kind !== null);
  if (!pick) return [];
  const { site, kind } = pick;
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

/**
 * Put back what a saboteur broke: the power's most damaged fixture, one repair
 * at a time, while it can afford it with room to spare.
 *
 * A bot that never repaired would be wrecked by sabotage permanently, which is
 * a stronger weapon than the one the mechanic prices — the repair programme
 * exists so that damage is a cost and not a sentence.
 */
function mend(ctx: Ctx): Ops {
  const { state, me } = ctx;
  if (state.pendingOrders.some((o) => o.factionId === me && o.onComplete?.kind === 'repair_fixture')) return [];
  const broken = state.assets
    .filter(
      (a) =>
        a.heldBy === me &&
        isStatFixture(a) &&
        (a.damage ?? 0) > 0 &&
        sys(state, a.atSystemId ?? '')?.controllerFactionId === me,
    )
    .sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0) || a.id.localeCompare(b.id))[0];
  if (!broken) return [];
  const points = broken.damage ?? 0;
  if (purse(state, me) < points * EFFECT_COST.repair_fixture * 3) return [];
  const site = sys(state, broken.atSystemId!)!;
  return [
    {
      op: 'issue_order',
      factionId: me,
      type: 'construction_infrastructure',
      originId: site.id,
      targetId: site.id,
      durationTurns: 3,
      label: `repair the ${broken.kind.replace(/_/g, ' ')} at ${site.name}`,
      onComplete: { kind: 'repair_fixture', magnitude: points, fixtureKind: broken.kind },
    },
  ];
}

/**
 * What a bot holds back before it will put a saboteur in the field: a few
 * missions' worth, so covert war never comes out of the money a navy needs.
 */
export const BOT_SABOTEUR_RESERVE = AGENT_COST.sabotage * 4;

/**
 * Send a saboteur at an enemy's fixtures — one at a time, and only at war.
 *
 * The bots ran no operatives at all, so the covert layer existed only for the
 * model-driven powers and the harness could measure none of it. This is the
 * narrowest use with a target on the board: a power at war wrecks what makes
 * its enemy's ground worth holding. Any power may, since `maxAgentsFor` already
 * makes a poor-guile power bad at it rather than forbidden.
 *
 * Recruited and sent in one batch, which an NPC may do — the "a recruitment is
 * a declaration of its own" rule is about the PLAYER's action economy, and a
 * bot has none. Aimed at the enemy's best working fixture nearest home; moved
 * on when the one it is at is wrecked, and recalled when nothing is left.
 */
function sabotage(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const enemies = new Set(warsFor(state, me));
  const home = held(state, me).sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
  const working = (a: (typeof state.assets)[number]) => fixtureIntegrity(a) - (a.damage ?? 0);
  const targets = state.assets
    .filter(
      (a) =>
        isStatFixture(a) &&
        a.atSystemId !== null &&
        enemies.has(a.heldBy) &&
        sys(state, a.atSystemId)?.controllerFactionId === a.heldBy &&
        working(a) > 0,
    )
    .map((a) => ({ a, far: home ? (jumpsBetween(state.systems, home.id, a.atSystemId!) ?? 99) : 99 }))
    .sort((x, y) => working(y.a) - working(x.a) || x.far - y.far || x.a.id.localeCompare(y.a.id));

  const effect = { kind: 'fixture_damage', perTurn: 1 };
  const saboteur = state.agents.find(
    (a) => a.ownerFactionId === me && !a.exposed && a.mission === 'sabotage' && a.effect?.kind === 'fixture_damage',
  );
  if (saboteur) {
    if (!atWork(saboteur, state.turn)) return [];
    if (targets.some((t) => t.a.atSystemId === saboteur.systemId)) return [];
    const next = targets[0];
    if (!next) return [{ op: 'recall_agent', agentId: saboteur.id, reason: 'nothing left to wreck' }];
    if (purse(state, me) < AGENT_COST.sabotage) return [];
    return [
      { op: 'deploy_agent', agent: saboteur.id, systemId: next.a.atSystemId, mission: 'sabotage', effect },
    ];
  }

  const target = targets[0];
  if (!target || !home) return [];
  if (purse(state, me) < BOT_SABOTEUR_RESERVE) return [];
  if (liveAgentsOf(state, me).length >= maxAgentsFor(state, me)) return [];
  return [
    { op: 'recruit_agent', systemId: home.id },
    {
      op: 'deploy_agent',
      systemId: target.a.atSystemId,
      mission: 'sabotage',
      effect,
      cover: `a contract crew at ${sys(state, target.a.atSystemId!)?.name ?? target.a.atSystemId}`,
    },
  ];
}

/**
 * Call in a favour owed by a power this bot is at war with: a ceasefire, which
 * is the most a debt of honour can buy off an enemy and leaves a truce behind
 * it. A doctrine bot has no other use for a favour that it can read off the
 * board — backing an ultimatum needs an ultimatum of its own, and the bots
 * issue none.
 */
function callIn(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const enemies = new Set(warsFor(state, me));
  const ready = (state.obligations ?? [])
    .filter(
      (o) =>
        o.holderFactionId === me &&
        o.status === 'open' &&
        (o.restsUntil === null || state.turn >= o.restsUntil) &&
        // A hook whose secret is over would be refused, and a refused op
        // discards the bot's whole batch in live play.
        (!o.secret || secretLive(state, o.secret)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const ops: Ops = [];
  const used = new Set<string>();
  // An enemy that owes it a favour is a war it can end.
  const enemy = ready.find((o) => enemies.has(o.debtorFactionId));
  if (enemy) {
    used.add(enemy.id);
    ops.push({
      op: 'call_obligation',
      obligationId: enemy.id,
      call: 'sign',
      treatyType: 'ceasefire',
      reason: 'a war it can end with a debt owed',
    });
  }
  // And a demand of its own is one every power that owes it should back.
  const mine = (state.demands ?? []).find((d) => d.status === 'open' && d.fromFactionId === me);
  if (mine) {
    for (const o of ready) {
      if (used.has(o.id) || o.debtorFactionId === mine.toFactionId) continue;
      if (mine.backers.some((b) => b.factionId === o.debtorFactionId && b.side === 'from')) continue;
      used.add(o.id);
      ops.push({ op: 'call_obligation', obligationId: o.id, call: 'support', demandId: mine.id, reason: 'what it owes' });
    }
  }
  return ops;
}

/**
 * Who demands tribute: a power whose doctrine takes money for leaving a
 * neighbour alone. Not the Vigil — its sheet will *"not accept payment to stand
 * down; being bought is the insult"*, and tribute is exactly that — and not the
 * Drift, whose whole doctrine is to take no master and ask nothing. Keyed on the
 * war ethic, so a power that changes doctrine changes this with it.
 */
const DEMANDING_ETHICS = new Set(['expansionist', 'profiteer', 'opportunist']);

/** A tenth of the target's gross a turn, the same order as a debt's instalment. */
export const BOT_TRIBUTE_SHARE = 0.1;
export const BOT_TRIBUTE_DEADLINE = 3;

/**
 * Demand tribute of a weaker neighbour.
 *
 * Only of a power the bot outguns by `ULTIMATUM_YIELD_RATIO` — the margin at
 * which a bot-run target gives way — so a rational demander asks only what it
 * expects to get, and only of one it has no warmth for, is not already at war
 * with, is not bound to peace with, and is not already being paid by. One
 * demand at a time.
 *
 * Self-limiting by construction: a concession costs the target's regard
 * (`ULTIMATUM_RESENTMENT`), so a power squeezed often enough comes to hate the
 * squeezer, and a power at war is not sent demands.
 */
function demandTribute(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const faction = getFaction(state, me);
  if (!faction || !DEMANDING_ETHICS.has(faction.warEthic)) return [];
  if ((state.demands ?? []).some((d) => d.status === 'open' && d.fromFactionId === me)) return [];
  const enemies = new Set(warsFor(state, me));
  const mine = sideStrength(state, [me]);
  const neighbours = [
    ...new Set(
      frontier(state, me)
        .map((t) => t.controllerFactionId)
        .filter((id): id is string => id !== null && id !== me),
    ),
  ];
  const target = neighbours
    .filter(
      (id) =>
        !enemies.has(id) &&
        dispositionBetween(state, me, id) <= BOT_AGGRESSION_CEILING &&
        !boundBy(state, me, id, PEACE_TYPES) &&
        !truceBetween(state.truces, state.turn, me, id) &&
        !boundBy(state, me, id, new Set(['tribute'])) &&
        !(state.demands ?? []).some((d) => d.status === 'open' && d.toFactionId === id),
    )
    .map((id) => ({ id, ratio: mine / Math.max(0.1, sideStrength(state, [id])) }))
    .filter((t) => t.ratio >= ULTIMATUM_YIELD_RATIO)
    .sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id))[0];
  if (!target) return [];
  const perTurn = Math.max(
    5,
    Math.min(MAX_TREATY_INCOME_PER_TURN, Math.round(ledgerFor(state, target.id).gross * BOT_TRIBUTE_SHARE)),
  );
  return [
    {
      op: 'issue_ultimatum',
      targetFactionId: target.id,
      demand: 'tribute',
      perTurn,
      deadlineTurns: BOT_TRIBUTE_DEADLINE,
      text: `${faction.name} demands ${perTurn} a turn of ${getFaction(state, target.id)?.name ?? target.id}, or it will take what it is owed.`,
    },
  ];
}

/** What a bot holds back before it posts a watcher. */
export const BOT_WATCHER_RESERVE = AGENT_COST.surveillance * 4;

/**
 * Keep a watcher on the power it trusts least, one at a time, at that power's
 * best world.
 *
 * The bots ran no watchers, so secrets — the whole of what a watcher digs up —
 * could never be found by anyone but the player. Aimed by standing rather than
 * by what there is to find, because what there is to find is the fog's to hide:
 * a bot cannot see a rival's operatives to know which rival is worth watching.
 */
function watch(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const home = held(state, me).sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
  if (!home) return [];
  const distrusted = state.factions
    .filter((f) => f.id !== me && held(state, f.id).length > 0)
    .map((f) => ({ id: f.id, regard: dispositionBetween(state, me, f.id) }))
    .sort((a, b) => a.regard - b.regard || a.id.localeCompare(b.id))[0];
  if (!distrusted) return [];
  const post = held(state, distrusted.id).sort(
    (a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id),
  )[0]!;
  const effect = { kind: 'intel', revealsOrders: true };
  const watcher = state.agents.find(
    (a) => a.ownerFactionId === me && !a.exposed && a.mission === 'surveillance',
  );
  if (watcher) {
    // Still watching somebody who is not itself? Then leave it be.
    const host = sys(state, watcher.systemId)?.controllerFactionId;
    if (host && host !== me) return [];
    if (purse(state, me) < AGENT_COST.surveillance) return [];
    return [{ op: 'deploy_agent', agent: watcher.id, systemId: post.id, mission: 'surveillance', effect }];
  }
  if (purse(state, me) < BOT_WATCHER_RESERVE) return [];
  // One slot always left for a saboteur, so the two never race for the last.
  if (liveAgentsOf(state, me).length + 1 >= maxAgentsFor(state, me)) return [];
  return [
    { op: 'recruit_agent', systemId: home.id },
    {
      op: 'deploy_agent',
      systemId: post.id,
      mission: 'surveillance',
      effect,
      cover: `a factor's clerk at ${post.name}`,
    },
  ];
}

/** Turns after catching a rival's operative that a bot keeps a sweep running. */
export const BOT_SWEEP_AFTER_CATCH = 5;

/**
 * A counter-intelligence sweep where a rival was caught working: one at a time,
 * at that world, while the catch is recent. A bot cannot see anybody's intel on
 * it, so it answers what it can see — being spied on. A sweep wears down every
 * rival's picture of it and makes their operatives on that world likelier to
 * be caught. Without the rule the counter is a mechanic nobody uses.
 */
function sweep(ctx: Ctx): Ops {
  const { state, me } = ctx;
  if (hasOrder(state, me, 'counter_intelligence')) return [];
  const caught = (state.agents ?? [])
    .filter(
      (a) =>
        a.ownerFactionId !== me &&
        a.caughtTurn !== undefined &&
        state.turn - a.caughtTurn <= BOT_SWEEP_AFTER_CATCH &&
        sys(state, a.systemId)?.controllerFactionId === me,
    )
    .sort((a, b) => (b.caughtTurn ?? 0) - (a.caughtTurn ?? 0) || a.id.localeCompare(b.id))[0];
  if (!caught) return [];
  const where = sys(state, caught.systemId)!;
  return [
    {
      op: 'issue_order', factionId: me, type: 'counter_intelligence',
      originId: where.id, targetId: where.id, durationTurns: 3,
      label: `sweep ${where.name}`,
    },
  ];
}

/**
 * Use proof it holds while it still proves something: published against a power
 * it is at war with, to cost the enemy standing everywhere; spent for a strong
 * hook on anybody else, which `callIn` then turns into backing.
 */
function useProof(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const enemies = new Set(warsFor(state, me));
  return state.assets
    .filter((a) => a.heldBy === me && a.secret && a.secret.subject !== me && secretLive(state, a.secret))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 1)
    .map((a) => ({
      op: enemies.has(a.secret!.subject) ? 'publish_dossier' : 'blackmail',
      assetId: a.id,
    }));
}

/**
 * Declare for a side of somebody else's ultimatum: against whichever principal
 * this bot is already at war with. Never against a power holding a hook on it
 * or one it is bound to peace with — the reducer would refuse both, and a bot
 * proposing what it cannot do is a bot reporting a move it never made.
 */
function backDemands(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const enemies = new Set(warsFor(state, me));
  const ops: Ops = [];
  for (const d of state.demands ?? []) {
    if (d.status !== 'open' || d.fromFactionId === me || d.toFactionId === me) continue;
    if (d.backers.some((b) => b.factionId === me)) continue;
    const side = enemies.has(d.toFactionId) ? 'from' : enemies.has(d.fromFactionId) ? 'to' : null;
    if (side === null) continue;
    const against = side === 'from' ? d.toFactionId : d.fromFactionId;
    if (hookedBy(state.obligations, me, against)) continue;
    if (boundBy(state, me, against, PEACE_TYPES) || truceBetween(state.truces, state.turn, me, against)) continue;
    ops.push({ op: 'back_ultimatum', demandId: d.id, side });
  }
  return ops;
}

/** What a bot puts on an enemy's head, and what it keeps in hand first. */
export const BOT_BOUNTY = 150;
export const BOT_BOUNTY_RESERVE = 1500;

/**
 * Put a price on the enemy it hates most, one bounty at a time.
 *
 * Only a power that thinks in money pays raiders — the same ethics that demand
 * tribute (`DEMANDING_ETHICS`) — so not the Vigil, whose compulsions forbid any
 * accommodation with pirates, and not the Drift. Only at war, and only out of a
 * full treasury: a bounty is money a power can spare to have somebody else
 * spend their fleets for it, which is the Combine's whole doctrine.
 */
function postBounty(ctx: Ctx): Ops {
  const { state, me } = ctx;
  const faction = getFaction(state, me);
  if (!faction || !DEMANDING_ETHICS.has(faction.warEthic)) return [];
  if (purse(state, me) < BOT_BOUNTY_RESERVE) return [];
  if ((state.bounties ?? []).some((b) => b.status === 'open' && b.postedBy === me)) return [];
  const enemy = warsFor(state, me)
    .filter((id) => held(state, id).length > 0)
    .sort((a, b) => dispositionBetween(state, me, a) - dispositionBetween(state, me, b) || a.localeCompare(b))[0];
  if (!enemy) return [];
  return [{ op: 'post_bounty', targetFactionId: enemy, credits: BOT_BOUNTY, reason: 'a price on an enemy' }];
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
  // Effective, as `maxAgentsFor` reads it: a power whose ground or fixtures
  // make it good at spies runs operatives, whatever its sheet opened at.
  const guile = effectiveStats(ctx.state, ctx.me).guile;
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
/**
 * The officer a bot sends with a fleet leaving `systemId`: whoever of its own is
 * standing there, as a one-name list for `issue_order.officers`. One rather
 * than all, so a sortie does not strip the port it left of its commander.
 */
function officersAt(ctx: Ctx, systemId: string): string[] {
  const here = commanderAt(ctx.state.commanders, ctx.me, systemId);
  return here ? [here.id] : [];
}

function sortie(ctx: Ctx, targetId: string, force: number, label: string): Ops {
  // **Enough lift to take the place, or this is a raid.** A bot that sails
  // with guns only wins the orbitals and hands the world back, which is how
  // conquest quietly stops happening: the fleets still move, the map stops
  // changing, and nothing in the logs says why.
  const target = ctx.state.systems.find((x) => x.id === targetId);
  const garrison = target?.garrison ?? 0;
  // Troops ashore count at the attacker's might, as `resolveBattle` scales them.
  const wantLift = Math.ceil(
    ((garrison * DUG_IN_MARGIN) / mightFactor(ctx.state, ctx.me, ctx.me) + 1) /
      HULL_SPEC.lifter.carry,
  );

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
      officers: officersAt(ctx, from.id),
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

export function orbitalNeed(state: WorldState, me: string, target: StarSystem): number {
  const present = Object.keys(target.ships ?? {}).filter((id) => id !== me);
  const defenders = present.reduce((n, id) => n + lineStrengthAt(state, target.id, id), 0);
  // At the odds the battle will actually be fought at: each side's weight
  // scaled by its might, the defenders by the best modifier among them, as
  // `bestMod` takes it. See `mightFactor`.
  const ratio =
    present.length === 0
      ? 1
      : Math.max(...present.map((id) => mightFactor(state, id, me))) / mightFactor(state, me, me);
  return Math.max(MIN_SORTIE_WEIGHT, Math.ceil(defenders * ORBITAL_MARGIN * ratio));
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
    .flatMap(routeLegs)
    .filter((leg) => leg.path.slice(1, -1).includes(systemId))
    .reduce((n, leg) => n + leg.volume, 0);
}

/** Heat this close below notorious makes a raider keep its next raid dark. */
export const BOT_DARK_HEAT_MARGIN = 10;

/**
 * Whether a raider runs this raid dark: the trade a player weighs — half the
 * prizes, against what being seen would cost. Being seen costs nothing on a
 * raid a letter of marque pays for, so that one runs open. Otherwise it goes
 * dark to keep a holder that still thinks well of it from finding out, or to
 * keep its own heat off the threshold where the Rim starts answering.
 */
function raidsDark(s: WorldState, me: string, world: StarSystem): boolean {
  const holder = world.controllerFactionId;
  if (!holder || holder === me) return false;
  if (commissionsAgainst(s.treaties, s.turn, me, holder).length > 0) return false;
  const heat = getFaction(s, me)?.heat ?? 0;
  return dispositionBetween(s, holder, me) >= 0 || heat >= HEAT_NOTORIOUS - BOT_DARK_HEAT_MARGIN;
}

/** A bounty this large doubles how much a raider wants a world its target holds. */
export const BOT_BOUNTY_PULL = 200;
/** How much more a raider wants a world held by a power its letter of marque names. */
export const BOT_MARQUE_PULL = 1.5;

/**
 * What raiding a world is worth to a raider: the traffic crossing it, more for
 * a price on its holder (*"the pirates raid whoever carries the largest
 * pool"*) and more again for a holder a letter of marque names — and nothing
 * where the prizes would not land, on a power it sells protection to or one
 * that commissioned it. See `BountySchema` and `CommissionSchema`.
 */
function raidWorth(s: WorldState, me: string, world: StarSystem): number {
  const traffic = trafficAt(s, world.id);
  const holder = world.controllerFactionId;
  if (!holder || holder === me) return traffic;
  if (!raidLandsOn(s.treaties, s.turn, me, holder)) return 0;
  const bounty = 1 + Math.min(1, bountyOn(s.bounties, holder) / BOT_BOUNTY_PULL);
  const licensed = commissionsAgainst(s.treaties, s.turn, me, holder).length > 0 ? BOT_MARQUE_PULL : 1;
  return traffic * bounty * licensed;
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
  // A power that courts does not storm the worlds it courts, nor take by force
  // one that chose somebody else: ground that was never anybody's home is won
  // by asking. Measured without the second half, Arkane lost the race for
  // Sennex to Meridian on turn 4 and stormed it on turn 5.
  const wooer = courts(state, me);
  // And a power that takes no master makes none: where worlds have a view,
  // the defensive ethic takes back its own and storms nobody else's home,
  // which would hate it for as long as it was held.
  const keepsToItsOwn =
    regardRecorded(state) && getFaction(state, me)?.warEthic === 'defensive';
  return state.systems
    .filter((x) => x.sector === home && x.controllerFactionId !== me)
    .filter((x) => !(wooer && x.homeFactionId === null))
    .filter((x) => !(keepsToItsOwn && x.homeFactionId !== null && x.homeFactionId !== me))
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
/**
 * How strong a rival's fleet on or next to a world may be, as a share of the
 * Confederacy's strongest base, before it leaves that world alone.
 *
 * It judged a strike only by what stood on the target, so it took Var Hollow
 * on turn 16 with Meridian's main fleet one jump away and lost it on turn 20,
 * hulls and all — the sheet's *"never hold ground worth besieging"*, ignored by
 * its own bot. Swept from nothing to 1.5: everything up to 0.9 gives the same
 * board, 6/5/5/5/4 at 30 and 100 turns with events and without, and its net at
 * turn 30 is −22; at 1 and above it attacks into strong fleets and ends on two
 * or three worlds. In practice it now takes only ground nobody strong is
 * guarding, and raids for the rest, which is the doctrine.
 */
export const OPPORTUNIST_HOLD_MARGIN = 0.75;

export function lawlessGround(state: WorldState, me: string): StarSystem[] {
  const contest = new Map(state.systems.map((x) => [x.id, contestAt(state, me, x.id)]));
  // What one strike can bring: the strongest of its own bases. A world a
  // rival guards with more than a share of that is ground it could take and
  // not keep — see `OPPORTUNIST_HOLD_MARGIN`.
  const strike = Math.max(0, ...held(state, me).map((b) => lineStrengthAt(state, b.id, me)));
  return state.systems
    .filter((x) => x.homeFactionId === null && x.controllerFactionId !== me)
    .filter((x) => strongestRivalNear(state, me, x.id) <= strike * OPPORTUNIST_HOLD_MARGIN)
    .sort((a, b) => {
      // Ground a rival has annexed first — that is the border being drawn, and
      // the whole objection. Unclaimed ground is merely opportunity.
      const claimed = Number(b.controllerFactionId !== null) - Number(a.controllerFactionId !== null);
      // Then where it would have to fight least for it — an opportunist hits
      // the weak — and only then where the trade is richest.
      //
      // Traffic came first, and with lanes divided across equally short paths
      // (`TradeRoute.paths`) that sent the Confederacy's very first expansion
      // to Neth (125) over Sennex (120): into Meridian's backyard, where it
      // spent the campaign contesting the strongest navy on the board and lost
      // Tulgarn and Threx while its fleet was away. A five-credit difference
      // in traffic decided a war; who stands next door should.
      return (
        claimed ||
        contest.get(a.id)! - contest.get(b.id)! ||
        trafficAt(state, b.id) - trafficAt(state, a.id) ||
        a.id.localeCompare(b.id)
      );
    });
}

/**
 * Who a power would have to fight for a world: every rival's battle line on it
 * and one jump out, in battleship-equivalents. The strongest single rival
 * instead of the sum was measured too, and chose the same worlds.
 */
/** The strongest single rival's battle line on a world and one jump out. */
function strongestRivalNear(state: WorldState, me: string, systemId: string): number {
  const near = [systemId, ...neighboursOf(state, systemId)];
  return Math.max(
    0,
    ...state.factions
      .filter((f) => f.id !== me)
      .map((f) => near.reduce((m, id) => m + lineStrengthAt(state, id, f.id), 0)),
  );
}

function contestAt(state: WorldState, me: string, systemId: string): number {
  const near = [systemId, ...neighboursOf(state, systemId)];
  return state.factions
    .filter((f) => f.id !== me)
    .reduce((n, f) => n + near.reduce((m, id) => m + lineStrengthAt(state, id, f.id), 0), 0);
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
      officers: officersAt(ctx, from.id),
      label,
    },
  ];
}

function press(ctx: Ctx, target: StarSystem, label: string): Ops {
  if (!holdable(ctx.state, ctx.me, target)) return [];
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
/**
 * How far above the bare threshold a guarded world is kept, in
 * battleship-equivalents. Swept: at 0 and 0.5 the Vigil still takes Threx on
 * turn 2, because hulls move whole and the guard lands a battleship short; at
 * 1, 2 and 3 Threx holds to turn 13–14 and every board is the same. 2 is the
 * middle of that flat region rather than its edge.
 */
const FRONT_MARGIN = 2;

/**
 * Keep every world facing a power you are at war with too strong for any one
 * of their adjacent bases to take today.
 *
 * Read off the attacker's own arithmetic: a base can sail when its weight
 * meets `orbitalNeed`, which is the defence times `ORBITAL_MARGIN`, scaled by
 * the two sides' might. So the world is safe while it holds more than the
 * strongest adjacent enemy base divided by that, and it is topped up by massing
 * — `massAt`, which leaves a token squadron at every other holding.
 *
 * **It makes a world not worth the attempt, not a fortress**, which is why it
 * stops at one base. A determined enemy can still concentrate from several and
 * come anyway; what it can no longer do is sail on turn one at a world one
 * jump from its biggest yard.
 */
function guardFronts(ctx: Ctx): Ops {
  const wars = new Set(warsFor(ctx.state, ctx.me));
  const mine = mightFactor(ctx.state, ctx.me, ctx.me);
  const ops: Ops = [];
  for (const world of held(ctx.state, ctx.me)) {
    let want = 0;
    for (const id of neighboursOf(ctx.state, world.id)) {
      const holder = ctx.state.systems.find((x) => x.id === id)?.controllerFactionId;
      if (!holder || !wars.has(holder)) continue;
      const theirs = mightFactor(ctx.state, holder, ctx.me);
      const threat = lineStrengthAt(ctx.state, id, holder) * theirs;
      want = Math.max(want, threat / (ORBITAL_MARGIN * mine) + FRONT_MARGIN);
    }
    if (want > lineStrengthAt(ctx.state, world.id, ctx.me)) ops.push(...massAt(ctx, world.id, want));
  }
  return ops;
}

const drajk: Bot = (ctx) => {
  const ops: Ops = [];
  // **An opportunist does not leave an easy target.** The Confederacy holds
  // Threx inside the Vigil's home sector, one jump from Vantic, at war with the
  // strongest might on the board — and its bot never defended anything. Once the
  // bots sized an attack at the odds the battle uses, the Vigil saw that Vantic's
  // opening squadron was enough and took Threx on turn 2; Drajk had been
  // surviving to turn 17 only because the raw-weight sum rounded the Vigil's
  // need up past Vantic by 0.3 of a battleship. A doctrine that hits the weak
  // knows what a weak target looks like. See `guardFronts`.
  //
  // Drajk's alone, and measured that way: guarding every power's fronts sent
  // the Vigil to nine worlds by turn 100 and wiped the Confederacy out.
  ops.push(...guardFronts(ctx));
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
      .map((x) => ({ x, worth: raidWorth(ctx.state, ctx.me, x) }))
      .sort((a, b) => b.worth - a.worth)[0]?.x;
    if (prey && raidWorth(ctx.state, ctx.me, prey) > 0) {
      ops.push({
        op: 'issue_order', factionId: ctx.me, type: 'commerce_raiding',
        originId: prey.id, targetId: prey.id, durationTurns: 3,
        label: `raid ${prey.name}`,
        ...(raidsDark(ctx.state, ctx.me, prey) ? { dark: true } : {}),
      });
    }
  }
  return ops;
};

/* ------------------------------------------------------------------ */
/* Worlds with a view of their own                                      */
/* ------------------------------------------------------------------ */

/**
 * The war ethics that court an independent world rather than storm it: the
 * expansionist trader, the defensive power that takes no master and so makes
 * none, and the profiteer that will not spend its own hulls on a conquest. The
 * crusader and the opportunist take what they want and hold it down. Keyed on
 * the ethic rather than on a faction, as every doctrine rule here is.
 */
export const COURTING_ETHICS = new Set(['expansionist', 'defensive', 'profiteer']);

/** Credits a bot keeps back before it spends on a courtship. */
export const BOT_COURT_RESERVE = 150;
/**
 * Independent worlds a bot courts at once. Swept: at two the Confederacy loses
 * a world by turn 100 without events, at three in two of the four boards; at
 * one the four boards are the same, 5/5/6/5/4.
 */
export const BOT_COURT_TARGETS = 1;

const courts = (state: WorldState, me: string): boolean =>
  regardRecorded(state) && COURTING_ETHICS.has(getFaction(state, me)?.warEthic ?? '');

/**
 * How far a rival must have got with a world before a bot leaves the race.
 *
 * Two powers courting one world with equal effort both climb to the cap and
 * neither ever leads by `JOIN_LEAD`, so the world stays its own forever and
 * both go on paying for envoys: measured, Sennex sat at 98 and 98 for Meridian
 * and Arkane from turn 8 to turn 30. So a bot that is behind a serious rival —
 * or level with one that sorts first, which is what makes a tie break the same
 * way on replay — courts somewhere else, and the leader's lead opens as its own
 * regard fades.
 */
export const BOT_RIVAL_SUITOR = 30;

function outcourted(target: StarSystem, me: string, ids: readonly string[]): boolean {
  const mine = regardFor(target, me);
  return ids.some((rival) => {
    if (rival === me) return false;
    const theirs = regardFor(target, rival);
    return theirs >= BOT_RIVAL_SUITOR && (theirs > mine || (theirs === mine && rival < me));
  });
}

/**
 * Keep every world that is neither content nor held down held down: mass
 * warships onto it, from the other holdings, before its garrison deserts.
 * Every power, whatever its doctrine — a doctrine that conquers has to hold
 * what it took, and one that courts has to keep what joined it.
 */
/**
 * How far over a world's need a bot keeps its holding force, in the holder's
 * resolve-scaled battleship-equivalents. The need moves inside the tick — a
 * world's regard drifts, and dissent can take a point off resolve and so off
 * what each warship holds down — so a bot that tops up to exactly the need
 * finds itself short by the time the world is asked. Measured at nothing: the
 * Iron Vigil held Torrek Anchorage at 5.3 against 4.9 and lost it four turns
 * later when its resolve slipped.
 */
export const BOT_HOLD_MARGIN = 1;

function hold(ctx: Ctx): Ops {
  if (!regardRecorded(ctx.state)) return [];
  const factor = Math.max(0.1, holdingFactor(ctx.state, ctx.me));
  const ops: Ops = [];
  for (const world of held(ctx.state, ctx.me)) {
    const h = holdAt(ctx.state, world, factor);
    if (!h || h.need <= 0 || h.have >= h.need + BOT_HOLD_MARGIN) continue;
    // In the holder's own battleship-equivalents, with half a battleship over,
    // since hulls move whole.
    const want =
      lineStrengthAt(ctx.state, world.id, ctx.me) + (h.need + BOT_HOLD_MARGIN - h.have) / factor + 0.5;
    ops.push(...massAt(ctx, world.id, want));
  }
  return ops;
}

/**
 * Whether the fleet that takes a world could hold it down afterwards: what a
 * fresh conquest of it would need, against the force the attack is sized at.
 * A world that hates a power past that is not worth storming — measured, the
 * Vigil retook Torrek Anchorage thirteen times in twenty-five turns, each time
 * a little more hated and a little less holdable, and lost it each time.
 */
export function holdable(state: WorldState, me: string, target: StarSystem): boolean {
  if (!regardRecorded(state) || target.homeFactionId === me) return true;
  const after = Math.min(regardFor(target, me) - BATTLE_REGARD, CONQUEST_REGARD);
  const need = (target.strategicValue * Math.max(0, CONTENT_REGARD - after)) / HOLD_DIVISOR;
  return need / Math.max(0.1, holdingFactor(state, me)) <= orbitalNeed(state, me, target);
}

/** A movement under way, of this power, to this world. */
const sailingTo = (s: WorldState, me: string, targetId: string): boolean =>
  s.pendingOrders.some((o) => o.factionId === me && o.type === 'fleet_movement' && o.targetId === targetId);

/** Send a small squadron of one shape from the nearest holding that can spare it. */
function station(ctx: Ctx, target: StarSystem, shape: 'line' | 'freighter', label: string): Ops {
  if (sailingTo(ctx.state, ctx.me, target.id)) return [];
  const from = held(ctx.state, ctx.me)
    .filter((b) =>
      shape === 'freighter'
        ? (stackAt(b, ctx.me).freighter ?? 0) > 0
        : lineStrengthAt(ctx.state, b.id, ctx.me) >= PROTECTION_LINE + 4,
    )
    .sort(
      (a, b) =>
        (shortestPath(ctx.state.systems, a.id, target.id)?.length ?? 99) -
          (shortestPath(ctx.state.systems, b.id, target.id)?.length ?? 99) ||
        a.id.localeCompare(b.id),
    )[0];
  if (!from) return [];
  const here = stackAt(from, ctx.me);
  const force: ShipStack =
    shape === 'freighter'
      ? { freighter: 1 }
      : drawToWeight(subtractStack(here, { lifter: here.lifter ?? 0, freighter: here.freighter ?? 0, listener: here.listener ?? 0 }), PROTECTION_LINE + 0.5);
  if (hullsIn(force) === 0) return [];
  return [{ op: 'issue_order', factionId: ctx.me, type: 'fleet_movement', originId: from.id, targetId: target.id, force, label }];
}

/**
 * Court the independent worlds in reach: an envoy, and whatever the world
 * wants that this power can give it. Every power courts its own home worlds
 * that have risen and gone their own way; the courting ethics court any
 * independent world they can reach. See `regard.ts`.
 */
function court(ctx: Ctx): Ops {
  const { state, me } = ctx;
  if (!regardRecorded(state)) return [];
  const wooer = courts(state, me);
  const ids = state.factions.map((f) => f.id);
  const targets = state.systems
    .filter((x) => x.controllerFactionId === null && (wooer || x.homeFactionId === me))
    .filter((x) => envoyRefusal(state, x, me) === null)
    // Its own home is always worth the attempt; anywhere else, not a race
    // already lost.
    .filter((x) => x.homeFactionId === me || !outcourted(x, me, ids))
    .sort(
      (a, b) =>
        Number(b.homeFactionId === me) - Number(a.homeFactionId === me) ||
        regardFor(b, me) - regardFor(a, me) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, BOT_COURT_TARGETS);
  const ops: Ops = [];
  let left = purse(state, me) - BOT_COURT_RESERVE;
  for (const target of targets) {
    const pending = (kind: string) =>
      state.pendingOrders.some((o) => o.factionId === me && o.targetId === target.id && o.onComplete?.kind === kind);
    const envoy = 2 * EFFECT_COST.court;
    if (!pending('court') && left >= envoy) {
      ops.push({
        op: 'issue_order', factionId: me, type: 'political_maneuver',
        originId: target.id, targetId: target.id, durationTurns: 1,
        label: `an envoy to ${target.name}`,
        onComplete: { kind: 'court', magnitude: 2, summary: `court ${target.name}` },
      });
      left -= envoy;
    }
    const want = wantOf(target);
    const present = battleshipEquivalents(stackAt(target, me)) > 0;
    if (want === 'protection' || ((want === 'development' || want === 'arms') && !present)) {
      if (battleshipEquivalents(stackAt(target, me)) < PROTECTION_LINE) {
        ops.push(...station(ctx, target, 'line', `stand guard over ${target.name}`));
      }
    } else if (want === 'trade' && (stackAt(target, me).freighter ?? 0) === 0) {
      ops.push(...station(ctx, target, 'freighter', `open a market at ${target.name}`));
    }
    if (present && want === 'development' && !pending('develop_system') && left >= 2 * MIN_DEVELOPMENT_COST) {
      ops.push({
        op: 'issue_order', factionId: me, type: 'construction_infrastructure',
        originId: target.id, targetId: target.id, durationTurns: 3,
        label: `works at ${target.name}`,
        onComplete: { kind: 'develop_system', magnitude: 1, summary: `develop ${target.name}` },
      });
      left -= 2 * MIN_DEVELOPMENT_COST;
    }
    if (present && want === 'arms' && !pending('fortify') && left >= EFFECT_COST.fortify) {
      ops.push({
        op: 'issue_order', factionId: me, type: 'fortification',
        originId: target.id, targetId: target.id, durationTurns: 3,
        label: `walls for ${target.name}`,
        onComplete: { kind: 'fortify', magnitude: 1, summary: `fortify ${target.name}` },
      });
      left -= EFFECT_COST.fortify;
    }
  }
  return ops;
}

/** Credits a power keeps before it sends an inciter: four missions' worth, the saboteur's rule. */
export const BOT_INCITER_RESERVE = AGENT_COST.incitement * 4;

/**
 * *"Make occupation cost more than it is worth"*: a defensive power stirs the
 * people of worlds other powers hold down by force.
 *
 * The defensive ethic courts and storms nobody's home, so without this it had
 * nothing on the map to do once the worlds it could court were spoken for —
 * measured, Arkane's last order touching territory came on turn 12. An inciter
 * on somebody's occupation raises the force the holder needs to keep it, and
 * in the end can make it rise, which is that doctrine's last clause as a
 * mechanic. Keyed on the ethic, like every doctrine rule here.
 *
 * One at a time. Its own lost ground first, then the world nearest rising, and
 * never against a power it is on good terms with outside a war — the line
 * `honourStanding` draws for an attack.
 */
function incite(ctx: Ctx): Ops {
  const { state, me } = ctx;
  if (!regardRecorded(state) || getFaction(state, me)?.warEthic !== 'defensive') return [];
  const wars = new Set(warsFor(state, me));
  const home = held(state, me).sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0];
  const targets = state.systems
    .filter((x) => {
      const holder = x.controllerFactionId;
      if (holder === null || holder === me || x.homeFactionId === holder) return false;
      if (regardFor(x, holder) >= CONTENT_REGARD) return false;
      return wars.has(holder) || dispositionBetween(state, me, holder) <= BOT_AGGRESSION_CEILING;
    })
    .map((x) => ({ x, far: home ? (jumpsBetween(state.systems, home.id, x.id) ?? 99) : 99 }))
    .sort(
      (a, b) =>
        Number(b.x.homeFactionId === me) - Number(a.x.homeFactionId === me) ||
        regardFor(a.x, a.x.controllerFactionId!) - regardFor(b.x, b.x.controllerFactionId!) ||
        a.far - b.far ||
        a.x.id.localeCompare(b.x.id),
    );

  const effect = { kind: 'incite', perTurn: 3 };
  const inciter = state.agents.find(
    (a) => a.ownerFactionId === me && !a.exposed && a.mission === 'incitement',
  );
  if (inciter) {
    if (!atWork(inciter, state.turn)) return [];
    if (targets.some((t) => t.x.id === inciter.systemId)) return [];
    const next = targets[0];
    if (!next) return [{ op: 'recall_agent', agentId: inciter.id, reason: 'nobody left held down by force' }];
    if (purse(state, me) < AGENT_COST.incitement) return [];
    return [{ op: 'deploy_agent', agent: inciter.id, systemId: next.x.id, mission: 'incitement', effect }];
  }

  const target = targets[0];
  if (!target || !home) return [];
  if (purse(state, me) < BOT_INCITER_RESERVE) return [];
  if (liveAgentsOf(state, me).length >= maxAgentsFor(state, me)) return [];
  return [
    { op: 'recruit_agent', systemId: home.id },
    {
      op: 'deploy_agent',
      systemId: target.x.id,
      mission: 'incitement',
      effect,
      cover: `a printer of pamphlets on ${target.x.name}`,
    },
  ];
}

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
    // A truce outlives the paper that made it, and breaking one is the dearest
    // public act in the game — see `TruceSchema`.
    if (op.type === 'fleet_movement' && truceBetween(state.truces, state.turn, me, holder)) {
      withheld.push(`an attack on ${target.name}, which the truce with ${getFaction(state, holder)?.name ?? holder} forbids`);
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
    // Protection sold is a promise kept, and a commissioner is a paymaster.
    if (
      (op.type === 'blockade' || op.type === 'commerce_raiding') &&
      (protectedFrom(state.treaties, state.turn, me, holder) ||
        state.treaties.some(
          (t) => t.type === 'contract' && isTreatyLive(t, state.turn) && t.terms.commission?.raider === me && t.parties.includes(holder),
        ))
    ) {
      withheld.push(`interdiction at ${target.name}, which a contract with ${getFaction(state, holder)?.name ?? holder} forbids`);
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
        // A raid run dark is not announced, least of all in its own account.
        if (!op.dark) parts.push(`sets raiders on the traffic through ${where(op.targetId)}`);
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
export function proposeFor(
  state: WorldState,
  factionId: string,
  /**
   * Whether a batch would apply cleanly, atomically, as `endTurn` commits it.
   * Given, a rule that would sink the whole batch is left out rather than
   * costing the bot its turn — the rules each read the treasury as it stood,
   * so a saboteur sent after the yards spent it was refused, and with it
   * everything else the power meant to do. Passed in rather than imported
   * because this module ships to the browser and the reducer does not.
   */
  applies?: (ops: Record<string, unknown>[]) => boolean,
): Proposal | null {
  const bot = BOTS[factionId];
  if (!bot) return null;

  // Every bot, whatever its doctrine, mends what was broken and wages the
  // covert half of a war it is in — added here rather than to five bots, for
  // the reason the filters below are: a bot added later inherits them.
  const ctx = { state, me: factionId };
  const rules = [hold, court, incite, mend, sabotage, watch, sweep, useProof, demandTribute, callIn, backDemands, postBounty].map((rule) =>
    rule(ctx),
  );
  // Paper first, then standing. Both are post-filters over one proposal, so a
  // bot cannot route around either and the order between them only decides
  // which reason is given for an act both would have refused.
  const filtered = (raw: Ops) => {
    const paper = honourTreaties(state, factionId, raw);
    const standing = honourStanding(state, factionId, paper.ops);
    return { ops: standing.ops, withheld: [...paper.withheld, ...standing.withheld] };
  };
  let chosen = filtered([...bot(ctx), ...rules.flat()]);
  if (applies && chosen.ops.length > 0 && !applies(chosen.ops)) {
    // The doctrine's own ops first, then each rule only if the batch still applies.
    let raw: Ops = bot(ctx);
    for (const extra of rules) {
      if (extra.length === 0) continue;
      const next = filtered([...raw, ...extra]);
      if (applies(next.ops)) raw = [...raw, ...extra];
    }
    chosen = filtered(raw);
  }
  const { ops, withheld } = chosen;
  if (ops.length === 0) return null;

  return { factionId, ops, rationale: describeProposal(state, factionId, ops), withheld };
}

/* ------------------------------------------------------------------ */
/* What two powers agree without a channel                             */
/* ------------------------------------------------------------------ */

/**
 * How well two powers must think of each other to trade their goods.
 *
 * Mutual, and an exchange rather than a gift, because the Combine's own sheet
 * refuses to give anything away for nothing — and two powers each handing over
 * goods worth nothing to themselves is consideration on both sides, which is
 * the whole of a trade. On the opening board only the Combine and the
 * Confederacy clear it, at 35 and 40.
 */
export const EXCHANGE_STANDING = 20;

/** How long a peace the bots make lasts, before the war may resume. */
export const BOT_PEACE_TURNS = TRUCE_TURNS;

export interface Accord {
  /** The two powers agreeing. */
  parties: [string, string];
  label: string;
  /** Engine ops: a treaty or a transfer needs both parties, and here both agreed by rule. */
  ops: Record<string, unknown>[];
}

/**
 * What NPC powers agree between themselves each turn, by rule.
 *
 * **Every treaty in the game came out of a transcript**, and every transcript
 * has the player in it — so two NPCs could fight each other and never make
 * peace, and goods could only ever reach a power the player handed them to.
 * That was right for the player, whose consent lives in a conversation, and it
 * left the half of the galaxy the bots run unable to agree anything at all.
 *
 * Two agreements, decided by arithmetic both sides can see, and applied as
 * ENGINE batches — the source that may sign for two parties, because the rule
 * that decided it read both of them:
 *
 * - **An exchange of goods** between two powers on good terms
 *   (`EXCHANGE_STANDING` both ways), each handing the other its stock. Each
 *   power trades with at most one partner a turn, its best.
 * - **A peace** between two powers whose war has gone quiet — no battle for
 *   `ENVOYS_QUIET_TURNS`, the quiet the envoys wait for, and neither with a
 *   fleet under way at the other. A ceasefire for `BOT_PEACE_TURNS`, which
 *   leaves a truce; a war too deep to heal resumes when both run out.
 *
 * **A bot does not make a peace its own compulsions bar** (`barsPeaceWith`).
 * The first version made it anyway and charged `COMPULSION_BREACH_DISSENT`, the
 * price a player pays for the same defiance, and measured it: battles are so
 * rare that wars go quiet within five turns, so the Vigil made peace with the
 * Confederacy and the Combine four times in thirty turns and finished at 62
 * dissent against 34. A doctrine bot paying to defy its own sheet for nothing it
 * can name is not following its doctrine, and nowhere else does a bot defy a
 * compulsion. The price is still there for a power that reasons about it — the
 * player, or a model-driven reaction — through the arbiter.
 *
 * Never with the player, whose agreements are made in a channel.
 */
export function brokeredAccords(state: WorldState): Accord[] {
  const npcs = state.factions.map((f) => f.id).filter((id) => id !== state.playerFactionId).sort();
  const name = (id: string) => getFaction(state, id)?.name ?? id;
  const out: Accord[] = [];

  // Goods, best-liked pair first, each power once.
  const stock = (id: string) =>
    state.assets.find((a) => isCommodity(a) && a.issuedBy === id && a.heldBy === id && a.quantity > 0);
  const pairs: { a: string; b: string; warmth: number }[] = [];
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i]!;
      const b = npcs[j]!;
      const warmth = Math.min(dispositionBetween(state, a, b), dispositionBetween(state, b, a));
      if (warmth < EXCHANGE_STANDING || !stock(a) || !stock(b)) continue;
      pairs.push({ a, b, warmth });
    }
  }
  pairs.sort((x, y) => y.warmth - x.warmth || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const traded = new Set<string>();
  for (const { a, b } of pairs) {
    if (traded.has(a) || traded.has(b)) continue;
    traded.add(a);
    traded.add(b);
    out.push({
      parties: [a, b],
      label: `exchange:${a}:${b}`,
      ops: [
        { op: 'transfer_asset', assetId: stock(a)!.id, toFactionId: b, reason: 'in exchange' },
        { op: 'transfer_asset', assetId: stock(b)!.id, toFactionId: a, reason: 'in exchange' },
        { op: 'spawn_event', factionId: a, text: `${name(a)} and ${name(b)} exchange their goods.` },
      ],
    });
  }

  // Peace, where a war has gone quiet.
  const attacking = (by: string, of: string) =>
    state.pendingOrders.some(
      (o) => o.factionId === by && o.type === 'fleet_movement' && sys(state, o.targetId)?.controllerFactionId === of,
    );
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i]!;
      const b = npcs[j]!;
      if (!warsFor(state, a).includes(b)) continue;
      const quiet = state.turn - (state.lastClash?.[clashKey(a, b)] ?? 0);
      if (quiet < ENVOYS_QUIET_TURNS) continue;
      if (attacking(a, b) || attacking(b, a)) continue;
      const barred = (p: string, other: string) =>
        getFaction(state, p)?.compulsions.some((c) => c.barsPeaceWith?.includes(other)) ?? false;
      if (barred(a, b) || barred(b, a)) continue;
      out.push({
        parties: [a, b],
        label: `peace:${a}:${b}`,
        ops: [
          {
            op: 'form_treaty',
            parties: [a, b],
            treatyType: 'ceasefire',
            terms: {},
            durationTurns: BOT_PEACE_TURNS,
            summary: `${name(a)} and ${name(b)} let a quiet war end`,
          },
          {
            op: 'spawn_event',
            factionId: a,
            text: `${name(a)} and ${name(b)}, ${quiet} turns without a battle between them, agree a ceasefire.`,
          },
        ],
      });
    }
  }

  out.push(...brokeredLedger(state, npcs));
  return out;
}

/** The terms the bots write a letter of marque on. */
export const BOT_MARQUE_STIPEND = 10;
export const BOT_MARQUE_SHARE = 25;
export const BOT_MARQUE_TURNS = 10;
/** What a commissioner keeps in hand before it pays a raider. */
export const BOT_MARQUE_RESERVE = 600;
/** How much a power must hate another to pay a raider to go after it, short of war. */
export const MARQUE_GRUDGE = -50;
/** What protection costs: this share of what the raider is taking now, a turn. */
export const PROTECTION_FEE_SHARE = 0.75;
export const BOT_PROTECTION_TURNS = 10;

/**
 * The raider's ledger, between NPC powers: letters of marque and protection.
 *
 * - **A letter of marque** — a power that thinks in money (`DEMANDING_ETHICS`),
 *   with a war or a deep grudge (`MARQUE_GRUDGE`), commissions a raider it is on
 *   good terms with (`EXCHANGE_STANDING` both ways) against that enemy: a
 *   stipend and a quarter of what the raider takes from it. The raider then
 *   stops raiding its paymaster, and weighs the enemy's worlds above the rest.
 * - **Protection** — a power of the same ethics, being raided by a power it is
 *   not at war with, pays it `PROTECTION_FEE_SHARE` of the current take a turn
 *   to stop. Cheaper than the raids, certain for the raider, and it carries no
 *   heat, so both sides gain by the arithmetic both can see.
 *
 * A raider is a power whose doctrine raids (`smuggler`) or that has a raid
 * under way. Neither deal is made across a compulsion that bars accommodation
 * with the other power (`barsPeaceWith`), and each pair holds one contract at a
 * time — two would supersede each other, since both carry a flow.
 */
function brokeredLedger(state: WorldState, npcs: string[]): Accord[] {
  const name = (id: string) => getFaction(state, id)?.name ?? id;
  const out: Accord[] = [];
  const mercantile = (id: string) => DEMANDING_ETHICS.has(getFaction(state, id)?.warEthic ?? '');
  const raiders = npcs.filter(
    (id) => getFaction(state, id)?.tradeEthic === 'smuggler' || hasOrder(state, id, 'commerce_raiding'),
  );
  const barred = (p: string, other: string) =>
    getFaction(state, p)?.compulsions.some((c) => c.barsPeaceWith?.includes(other)) ?? false;
  const contracted = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  for (const t of state.treaties) {
    if (t.type === 'contract' && isTreatyLive(t, state.turn)) contracted.add(pairKey(t.parties[0]!, t.parties[1]!));
  }

  // Letters of marque.
  for (const c of npcs) {
    if (!mercantile(c) || purse(state, c) < BOT_MARQUE_RESERVE) continue;
    const enemies = state.factions
      .map((f) => f.id)
      .filter((e) => e !== c && (warsFor(state, c).includes(e) || dispositionBetween(state, c, e) <= MARQUE_GRUDGE))
      .sort((a, b) => dispositionBetween(state, c, a) - dispositionBetween(state, c, b) || a.localeCompare(b));
    for (const r of raiders) {
      if (r === c || contracted.has(pairKey(c, r)) || barred(c, r) || barred(r, c)) continue;
      if (Math.min(dispositionBetween(state, c, r), dispositionBetween(state, r, c)) < EXCHANGE_STANDING) continue;
      const enemy = enemies.find((e) => e !== r && raidLandsOn(state.treaties, state.turn, r, e));
      if (!enemy) continue;
      contracted.add(pairKey(c, r));
      out.push({
        parties: [c, r],
        label: `marque:${c}:${r}`,
        ops: [
          {
            op: 'form_treaty',
            parties: [c, r],
            treatyType: 'contract',
            terms: {
              incomePerTurn: { [c]: -BOT_MARQUE_STIPEND, [r]: BOT_MARQUE_STIPEND },
              commission: { raider: r, against: [enemy], share: BOT_MARQUE_SHARE },
            },
            durationTurns: BOT_MARQUE_TURNS,
            summary: `${name(c)} commissions ${name(r)} to raid ${name(enemy)}`,
          },
          {
            op: 'spawn_event',
            factionId: c,
            text: `${name(c)} gives ${name(r)} a letter of marque against ${name(enemy)}.`,
          },
        ],
      });
      break;
    }
  }

  // Protection, bought by the powers being raided.
  const takings = routeEarnings(state).raidedFrom;
  for (const v of npcs) {
    if (!mercantile(v)) continue;
    const by = raiders
      .filter((r) => r !== v && (takings[r]?.[v] ?? 0) > 0)
      .sort((a, b) => (takings[b]?.[v] ?? 0) - (takings[a]?.[v] ?? 0) || a.localeCompare(b))[0];
    if (!by || contracted.has(pairKey(v, by)) || warsFor(state, v).includes(by)) continue;
    if (barred(v, by) || barred(by, v)) continue;
    const fee = Math.max(5, Math.min(MAX_TREATY_INCOME_PER_TURN, Math.ceil((takings[by]![v] ?? 0) * PROTECTION_FEE_SHARE)));
    if (ledgerFor(state, v).net < fee) continue;
    contracted.add(pairKey(v, by));
    out.push({
      parties: [v, by],
      label: `protection:${v}:${by}`,
      ops: [
        {
          op: 'form_treaty',
          parties: [v, by],
          treatyType: 'contract',
          terms: { incomePerTurn: { [v]: -fee, [by]: fee }, protection: [v] },
          durationTurns: BOT_PROTECTION_TURNS,
          summary: `${name(v)} pays ${name(by)} ${fee} a turn to leave its shipping alone`,
        },
        {
          op: 'spawn_event',
          factionId: v,
          text: `${name(v)} buys protection from ${name(by)}: ${fee} a turn, and its shipping goes unmolested.`,
        },
      ],
    });
  }
  return out;
}
