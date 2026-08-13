import { z } from 'zod';
import { FactionStatsSchema, STAT_NAMES, statModifier, type FactionStats } from './checks.js';
import {
  COMMITMENT_INCOME_BASE,
  COMMITMENT_INCOME_PER_INFLUENCE,
  CommitmentSchema,
  commitmentIncomeFor,
  commitmentsFor,
  MIN_COMMITMENT_INCOME_CEILING,
  type Commitment,
} from './arbitration.js';
import {
  AgentSchema,
  isTreatyLive,
  TreatySchema,
  type Agent,
  type Treaty,
} from './diplomacy.js';
import { DurationCategorySchema, FibScaleSchema } from './duration.js';
import { buildAdjacency } from './graph.js';
// trade.ts imports only TYPES from here, so this edge is one-directional at
// runtime and there is no import cycle to trip over.
import { routeEarnings } from './trade.js';

/**
 * An order is either a fleet movement — whose duration the reducer computes
 * from the hyperlane graph — or a piece of estimated work, whose duration the
 * model proposes and code clamps. The type IS the duration category for
 * estimated work, so the two taxonomies can never drift apart.
 */
export const MOVEMENT_ORDER_TYPE = 'fleet_movement' as const;

export const OrderTypeSchema = z.union([
  z.literal(MOVEMENT_ORDER_TYPE),
  DurationCategorySchema,
]);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export function isMovementType(t: OrderType): t is typeof MOVEMENT_ORDER_TYPE {
  return t === MOVEMENT_ORDER_TYPE;
}

export const OnInterruptSchema = z.enum(['cancel', 'partial', 'persist']);
export type OnInterrupt = z.infer<typeof OnInterruptSchema>;

export const DispositionSchema = z.number().int().min(-100).max(100);

/**
 * Where a power stands on starting wars. Drives NPC behaviour and what an
 * extraction pass will believe a faction agreed to: a `defensive` power does
 * not sign on to a war of conquest because the conversation went well.
 */
export const WAR_ETHICS = [
  'expansionist',
  'defensive',
  'opportunist',
  'crusading',
  'mercenary',
] as const;
export const WarEthicSchema = z.enum(WAR_ETHICS);
export type WarEthic = z.infer<typeof WarEthicSchema>;

export const WAR_ETHIC_MEANING: Record<WarEthic, string> = {
  expansionist: 'takes territory because it is there; needs no provocation, only opportunity',
  defensive: 'fights only when struck or when a border is genuinely threatened; will not start a war of conquest',
  opportunist: 'attacks the weak and the distracted, avoids fair fights, switches sides without embarrassment',
  crusading: 'fights for legitimacy and grievance; will attack at a disadvantage if the cause demands it',
  mercenary: 'fights for payment; war is a service sold, and someone else’s enemy is negotiable',
};

/** Where a power stands on commerce. Also sets its baseline income. */
export const TRADE_ETHICS = [
  'free_trade',
  'monopolist',
  'extortionist',
  'autarkic',
  'smuggler',
] as const;
export const TradeEthicSchema = z.enum(TRADE_ETHICS);
export type TradeEthic = z.infer<typeof TradeEthicSchema>;

export const TRADE_ETHIC_MEANING: Record<TradeEthic, string> = {
  free_trade: 'open lanes enrich everyone; earns more the more of the galaxy is open, including lanes it has no stake in',
  monopolist: 'trade is good when controlled; secures exclusive rights and punishes competitors',
  extortionist: 'commerce is something that passes through your space and owes you a toll for the privilege',
  autarkic: 'dependence is weakness; earns more from its own worlds and cannot be strangled by a blockade, because it was never on the lanes',
  smuggler: 'the profitable cargo is the illegal one; runs blockades others cannot, and raids the shipping others depend on',
};

/** Prosperity multiplier applied to system income. */
/**
 * Multiplier on TERRITORIAL income only.
 *
 * Deliberately flatter than it used to be, because an ethic's real expression
 * now lives in `trade.ts` — a toll, a raid, a blockade run, an openness bonus.
 * When this multiplier was the entire mechanic, `extortionist` sat at 1.0 and
 * the Nars' defining trait did literally nothing. The spread here is now a
 * thumb on the scale, not the whole of it.
 */
export const TRADE_INCOME_MULTIPLIER: Record<TradeEthic, number> = {
  free_trade: 1.1,
  monopolist: 1.05,
  extortionist: 1.0,
  autarkic: 1.15, // pays its own way at home, having renounced the network
  smuggler: 1.05,
};

/**
 * What a free trader earns on top of its route income for a galaxy that is
 * open, at full network openness. Meridian profits from *everyone's* peace,
 * which gives it a mechanical reason to broker other powers' ceasefires.
 */
export const FREE_TRADE_OPENNESS_BONUS = 0.25;

/**
 * What a compulsion watches for, when it watches for anything.
 *
 * Compulsions were enforced by exactly one path: the resolution call refusing a
 * declared action. That works for a compulsion phrased as a prohibition, and
 * not at all for one phrased as a demand — a refusal needs an action to refuse,
 * so nothing ever fired on *drift*. Four lines in the seed promised
 * consequences for elapsed time ("a stretch of quiet with no raid", "within a
 * turn or two", "an unprofitable quarter") and nothing measured time, or
 * anything else.
 *
 * A trigger is a **pure predicate on world state**, checked once per faction
 * per turn. Nothing here reads history, a clock or a random number, so the
 * check replays exactly; a "stretch" of neglect emerges from the predicate
 * being true on several consecutive turns rather than from anything counting.
 */
export const COMPULSION_TRIGGERS = [
  /** Net income is zero or negative. */
  'unprofitable',
  /** At war with someone, with no fleet under way. */
  'idle_at_war',
  /** A rival's ships sit on a world you hold, and you have sent nothing. */
  'unanswered_incursion',
  /** No raid under way and nothing taken from anyone's lanes. */
  'no_plunder',
] as const;
export type CompulsionTrigger = (typeof COMPULSION_TRIGGERS)[number];
export const CompulsionTriggerSchema = z.enum(COMPULSION_TRIGGERS);

/**
 * A compulsion is `{ text, trigger? }`, but a bare string is accepted and
 * normalised — that is what every save file and journal written before triggers
 * existed contains, and they must keep loading.
 *
 * A compulsion with no trigger is not inert: it is still enforced the original
 * way, by the resolution call refusing an action that abandons it. The trigger
 * only adds the case a refusal cannot cover.
 */
export const CompulsionSchema = z.preprocess(
  (value) => (typeof value === 'string' ? { text: value } : value),
  z.object({
    text: z.string().min(1).max(240),
    trigger: CompulsionTriggerSchema.optional(),
  }),
);
export type Compulsion = z.infer<typeof CompulsionSchema>;

export const FactionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** ANSI 256 colour index used for every glyph this faction controls. */
  displayColor: z.number().int().min(0).max(255),
  /** factionId -> how this faction feels about them. Self-entry is ignored. */
  disposition: z.record(z.string(), DispositionSchema),
  /**
   * NOTE: there is no `fleetStrength` field. A faction's navy IS its ships,
   * summed across the systems they sit in plus anything in transit — see
   * `fleetStrengthOf`. Storing a second global number alongside per-system
   * ships gave two navies that never saw each other: one that fought and one
   * that collected income.
   */
  credits: z.number().int().min(0),
  doctrine: z.string(),
  /** D&D-style capabilities; every action resolves against one of these. */
  stats: FactionStatsSchema,
  /**
   * How this power SOUNDS: register, dialect, verbal habits. Fed verbatim into
   * the diplomacy persona, because five factions that argue in the same voice
   * are one faction wearing five colours.
   */
  voice: z.string(),
  warEthic: WarEthicSchema,
  tradeEthic: TradeEthicSchema,
  /** Things this power will not do, whatever the incentive. */
  redLines: z.array(z.string()).default([]),
  /**
   * Things this power's own institutions DEMAND of its leader.
   *
   * Red lines stop a faction acting out of character; compulsions stop it
   * failing to act in character. An Iron Vigil leader who sits passive while a
   * rebel holds Imperial ground is not playing Iron Vigil — the fleet
   * commanders have views, and this is where they live.
   */
  compulsions: z.array(CompulsionSchema).default([]),
  /**
   * How far the leader has strayed from doctrine, 0–100. Rises when orders are
   * refused or compulsions ignored; high dissent is a losing position.
   */
  dissent: z.number().int().min(0).max(100).default(0),
  /** Work it reaches for by instinct, biasing what NPCs choose to build. */
  buildBias: z.array(DurationCategorySchema).default([]),
});
export type Faction = z.infer<typeof FactionSchema>;

export const SystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sector: z.string().min(1),
  coords: z.object({ x: z.number(), y: z.number() }),
  /** null means unaligned/independent, not "unknown". */
  controllerFactionId: z.string().nullable(),
  garrison: z.number().int().min(0),
  /**
   * What the garrison regrows to. Ground forces are raised locally and cost
   * neither fleet nor treasury, so a captured world slowly re-arms itself —
   * which is what stops conquest being permanently cheap.
   */
  garrisonMax: z.number().int().min(0).default(0),
  strategicValue: z.number().int().min(0).max(10),
  hyperlaneEdges: z.array(z.string()),
  /**
   * Ships physically present, per faction.
   *
   * Separate from `garrison` (which is dug-in ground and orbital defence) and
   * from a faction's global `fleetStrength`. Presence here is what makes a
   * system contested and what splits its income: a rival parked in orbit is
   * taking a cut whether or not anyone has fired.
   */
  ships: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type StarSystem = z.infer<typeof SystemSchema>;

/**
 * What a completed order delivers. The bounds, the pricing and the application
 * live in `development.ts`; only the shape lives here.
 *
 * Every kind carries the same `magnitude` field on purpose, so capping,
 * pricing, trimming and affordability are one linear calculation rather than
 * four near-identical branches — and a kind added later cannot forget to be
 * capped, because the capping code does not know which kind it has.
 */
export const OrderEffectSchema = z.object({
  kind: z.enum([
    /** Permanent economic development: `strategicValue` up, capped at 10. */
    'develop_system',
    /** Levies raised now rather than waiting on passive regrowth. */
    'raise_garrison',
    /** Permanent defensive capacity: `garrisonMax` up. */
    'fortify',
    /** Hulls delivered at the target when the programme lands. */
    'commission_ships',
  ]),
  /**
   * How much. Generous bounds here and the real limits in code: a schema
   * rejection costs a correction round trip, where a trim costs a note.
   */
  magnitude: z.number().int().min(1).max(99),
  /** One clause, shown to the player in the orders panel and the briefing. */
  summary: z.string().max(160).default(''),
});
export type OrderEffect = z.infer<typeof OrderEffectSchema>;
export type OrderEffectKind = OrderEffect['kind'];

export const PendingOrderSchema = z.object({
  id: z.string().min(1),
  factionId: z.string().min(1),
  type: OrderTypeSchema,
  originId: z.string().min(1),
  targetId: z.string().min(1),
  durationTurns: z.number().int().min(1),
  progress: z.number().int().min(0),
  interruptible: z.boolean(),
  onInterrupt: OnInterruptSchema,
  /** Which factions can observe this order. Drives NPC reaction context. */
  visibility: z.array(z.string()),
  /** Free text shown in the orders panel. */
  label: z.string().default(''),
  /** Why the model chose this duration. Empty for movement (computed). */
  durationRationale: z.string().default(''),
  /** Path for movement orders, so the map can draw the fleet in transit. */
  path: z.array(z.string()).default([]),
  /**
   * Ships committed to a movement order, in transit and counted toward the
   * owner's fleet but present in no system. Zero for non-movement work.
   */
  force: z.number().int().min(0).default(0),
  /**
   * What this programme delivers on completion, already trimmed to its cap and
   * already paid for. Absent for work whose effect lands elsewhere — a courier
   * run, a decree, an espionage order that staged a `deploy_agent`.
   */
  onComplete: OrderEffectSchema.optional(),
  /**
   * Credits sunk into `onComplete` at issue time.
   *
   * Held on the order rather than recomputed because the refund on a `partial`
   * interruption is pro-rata of what was actually spent, and the prices could
   * change under a save file. Optional on the way in so journals and saves
   * written before payloads existed still load and replay.
   */
  investedCredits: z.number().int().min(0).default(0),
});
export type PendingOrder = z.infer<typeof PendingOrderSchema>;

export const EventLogEntrySchema = z.object({
  turn: z.number().int().min(0),
  kind: z.enum(['narrative', 'system', 'order', 'diplomacy', 'rejection', 'clamp']),
  factionId: z.string().nullable().default(null),
  text: z.string(),
});
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

export const WorldStateSchema = z.object({
  factions: z.array(FactionSchema).min(1),
  systems: z.array(SystemSchema).min(1),
  pendingOrders: z.array(PendingOrderSchema),
  /** Standing agreements with mechanical force, applied every tick. */
  treaties: z.array(TreatySchema).default([]),
  /** Durable arrangements with no dedicated mechanic — see `arbitration.ts`. */
  commitments: z.array(CommitmentSchema).default([]),
  /** Covert operatives in place, applied every tick. */
  agents: z.array(AgentSchema).default([]),
  playerFactionId: z.string().min(1),
  /** Abstract unit. There is no calendar in this game, deliberately. */
  turn: z.number().int().min(0),
  eventLog: z.array(EventLogEntrySchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

/* ------------------------------------------------------------------ */
/* Lookup helpers. Kept here so the reducer and UI agree on semantics.  */
/* ------------------------------------------------------------------ */

export function getFaction(s: WorldState, id: string): Faction | undefined {
  return s.factions.find((f) => f.id === id);
}

export function getSystem(s: WorldState, id: string): StarSystem | undefined {
  return s.systems.find((x) => x.id === id);
}

export function getOrder(s: WorldState, id: string): PendingOrder | undefined {
  return s.pendingOrders.find((o) => o.id === id);
}

export function systemsOf(s: WorldState, factionId: string): StarSystem[] {
  return s.systems.filter((x) => x.controllerFactionId === factionId);
}

/** Disposition of `from` toward `to`; 0 when unrecorded, 100 toward self. */
export function dispositionBetween(
  s: WorldState,
  from: string,
  to: string,
): number {
  if (from === to) return 100;
  return getFaction(s, from)?.disposition[to] ?? 0;
}

/** Orders `factionId` is allowed to see — its own, plus anything visible. */
export function ordersVisibleTo(s: WorldState, factionId: string): PendingOrder[] {
  // Systems where this faction has a live intel agent. An operative in place is
  // the whole point of surveillance: it turns a hidden project into a visible
  // one, which is what makes long builds worth hiding AND worth spying on.
  const watched = new Set(
    (s.agents ?? [])
      .filter(
        (a) => a.ownerFactionId === factionId && !a.exposed && a.effect.kind === 'intel',
      )
      .map((a) => a.systemId),
  );

  return s.pendingOrders.filter(
    (o) =>
      o.factionId === factionId ||
      o.visibility.includes(factionId) ||
      watched.has(o.targetId) ||
      watched.has(o.originId),
  );
}

/* ------------------------------------------------------------------ */
/* Fleets                                                              */
/* ------------------------------------------------------------------ */

/** Ships a faction has sitting in a given system. */
export function shipsAt(state: WorldState, factionId: string, systemId: string): number {
  return getSystem(state, systemId)?.ships[factionId] ?? 0;
}

/** Ships a faction has in transit, committed to movement orders. */
export function shipsInTransit(state: WorldState, factionId: string): number {
  return state.pendingOrders
    .filter((o) => o.factionId === factionId && isMovementType(o.type))
    .reduce((sum, o) => sum + o.force, 0);
}

/**
 * A faction's whole navy: every ship in every system, plus everything under
 * way. This is derived, never stored — there is exactly one place ships live,
 * so combat, income and upkeep cannot disagree about how many there are.
 */
export function fleetStrengthOf(state: WorldState, factionId: string): number {
  const inSystems = state.systems.reduce((sum, s) => sum + (s.ships[factionId] ?? 0), 0);
  return inSystems + shipsInTransit(state, factionId);
}

/**
 * Where a faction could pull ships from, richest system first. Used when an op
 * adds or removes fleet without naming a system; deterministic so replay holds.
 */
export function fleetBases(state: WorldState, factionId: string): StarSystem[] {
  return state.systems
    .filter((s) => s.controllerFactionId === factionId || (s.ships[factionId] ?? 0) > 0)
    .sort(
      (a, b) =>
        b.strategicValue - a.strategicValue ||
        (b.ships[factionId] ?? 0) - (a.ships[factionId] ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

/* ------------------------------------------------------------------ */
/* Economy                                                             */
/* ------------------------------------------------------------------ */

/**
 * Credits a single system yields per turn before the trade-ethic modifier.
 *
 * Was 12, when territory was the entire economy. Trade routes now carry the
 * difference (see `trade.ts`), so this was cut rather than kept and added to:
 * inflating the galaxy's income would have made `SHIP_COST` meaningless. About
 * a third of what a power earns is now route-borne, which is enough that
 * losing a lane hurts and not so much that one blockade ends a campaign.
 */
export const INCOME_PER_STRATEGIC_POINT = 7;
/** Credits each point of fleet strength costs to keep in being, per turn. */
export const UPKEEP_PER_FLEET_POINT = 4;

/**
 * What one hull costs to commission.
 *
 * Priced against the economy it is paid from: net incomes run 87–300 a turn,
 * so this buys between one and five ships per turn from revenue. Expanding a
 * navy is therefore a multi-turn programme competing with everything else,
 * rather than a sentence in an order.
 *
 * Enforced in the reducer, never in a prompt. "Build a thousand ships" is
 * exactly the kind of instruction a model can be argued into, which is why the
 * arithmetic lives here instead.
 */
export const SHIP_COST = 60;

/**
 * What each live operative costs its owner per turn.
 *
 * Slightly cheaper than a hull (4), because a spy network should be the
 * affordable way to project power for a weak faction — but not free, so that
 * a large network is a standing drain the way a large fleet is. Exposed
 * agents cost nothing: they are already burned.
 */
export const AGENT_UPKEEP = 3;

/**
 * How many operatives a faction can run at once.
 *
 * Scaled off `guile` rather than a flat constant, on the same principle as
 * `subornLimit`: the Nars at guile 18 run a real intelligence service, the
 * Iron Vigil at 11 manages a couple of watchers. Without any cap at all,
 * nothing stopped a player accumulating an unbounded number of permanent,
 * free intel and sabotage feeds.
 */
export const MAX_AGENTS_BASE = 2;

export function maxAgentsFor(state: WorldState, factionId: string): number {
  const faction = getFaction(state, factionId);
  if (!faction) return 0;
  return Math.max(1, MAX_AGENTS_BASE + statModifier(effectiveStats(state, factionId).guile));
}

/** Live (unexposed) operatives a faction is running. Exposed ones are spent. */
export function liveAgentsOf(state: WorldState, factionId: string): Agent[] {
  return (state.agents ?? []).filter((a) => a.ownerFactionId === factionId && !a.exposed);
}

/**
 * The most a faction can draw from its standing arrangements at once, scaled
 * off `influence` — see `MAX_COMMITMENT_INCOME` in `arbitration.ts` for why the
 * ceiling exists and why it is derived rather than flat.
 */
export function maxCommitmentIncomeFor(state: WorldState, factionId: string): number {
  const faction = getFaction(state, factionId);
  if (!faction) return 0;
  const modifier = statModifier(effectiveStats(state, factionId).influence);
  return Math.max(
    MIN_COMMITMENT_INCOME_CEILING,
    COMMITMENT_INCOME_BASE + COMMITMENT_INCOME_PER_INFLUENCE * modifier,
  );
}

export interface Ledger {
  gross: number;
  upkeep: number;
  net: number;
  systems: number;
  /** Flat treaty transfers: positive receives, negative pays. */
  treatyFlow: number;
  /** Credits denied by hostile agents in place. */
  espionageLoss: number;
  /** What this faction's own live operatives cost it per turn. */
  agentUpkeep: number;
  /**
   * Standing arrangements: charters, smuggling operations, tribute paid.
   * Positive receives, negative pays.
   */
  commitmentFlow: number;
  /** Territory: what the systems themselves pay. */
  territory: number;
  /** Trade: what the lane network pays, after tolls and raids. */
  routes: number;
  /** Of `routes`, what was taken from others as transit tolls. */
  tolls: number;
  /** Of `routes`, what was taken from others by commerce raiding. */
  raided: number;
}

/** What a single system pays, and to whom, before faction-level modifiers. */
export interface SystemIncome {
  systemId: string;
  base: number;
  /** factionId -> credits from this system this turn. */
  shares: Record<string, number>;
  /** More than one faction has ships here, or a rival contests the owner. */
  contested: boolean;
  /** Present in the split only because a treaty put them there. */
  byTreaty: string[];
}

const shipsPresent = (system: StarSystem): [string, number][] =>
  Object.entries(system.ships ?? {}).filter(([, n]) => n > 0);

/**
 * Treaties that make a fleet a GUEST rather than an intruder.
 *
 * Deliberately narrow: only pacts that actually concern presence or joint
 * defence. A `trade_accord` is about lanes and blockade immunity, and a
 * `non_aggression` pact is only a promise not to attack — neither is
 * permission to sit in someone's orbit, so a fleet there is still leverage and
 * still contests.
 */
const GUEST_TREATIES = ['basing_rights', 'mutual_defense'] as const;

/**
 * Whether `visitor`'s ships at a world held by `holder` are there by invitation.
 *
 * Without this, income was blind to diplomacy: an ally you had granted basing
 * rights skimmed your worlds exactly as an invader would, which made the
 * treaty actively harmful to sign. Worse, `mutual_defense` DISPATCHES an
 * ally's hulls into your system to defend it — so honouring a pact, taking
 * losses for you, and saving your world ended with your rescuer contesting
 * your income. Being defended must not be a tax.
 */
export function isGuestOf(
  state: WorldState,
  visitor: string,
  holder: string | null,
): boolean {
  if (holder === null || visitor === holder) return false;
  return (state.treaties ?? []).some(
    (t) =>
      isTreatyLive(t, state.turn) &&
      (GUEST_TREATIES as readonly string[]).includes(t.type) &&
      t.parties.includes(visitor) &&
      t.parties.includes(holder),
  );
}

/**
 * How one system's income divides.
 *
 * Three cases, in the order they are resolved:
 *
 *  - **Wholly owned** — the controller has the system and no rival has ships in
 *    it. The controller takes everything.
 *  - **Contested** — rivals have ships present. The take splits by armed
 *    presence, with the controller keeping a holder's edge, because occupying
 *    a world you do not administer yields less than administering it.
 *  - **Neutral** — nobody controls it, so nobody is owed anything by default.
 *    Income flows only to factions a treaty names, which is what makes an
 *    unaligned world worth negotiating over rather than just invading.
 */
export function systemIncome(state: WorldState, system: StarSystem): SystemIncome {
  const base = system.strategicValue * INCOME_PER_STRATEGIC_POINT;
  const shares: Record<string, number> = {};
  const byTreaty: string[] = [];

  // Treaty claims are honoured first and come off the top.
  let remaining = 1;
  for (const treaty of state.treaties ?? []) {
    if (!isTreatyLive(treaty, state.turn)) continue;
    for (const claim of treaty.terms.incomeShares) {
      if (claim.systemId !== system.id || claim.share <= 0) continue;
      const take = Math.min(claim.share, remaining);
      if (take <= 0) continue;
      shares[claim.factionId] = (shares[claim.factionId] ?? 0) + base * take;
      if (!byTreaty.includes(claim.factionId)) byTreaty.push(claim.factionId);
      remaining -= take;
    }
  }

  const present = shipsPresent(system);
  const controller = system.controllerFactionId;
  // Invited fleets neither contest the world nor take a share of it. They are
  // guests: the world is still wholly its holder's, and the guest earns
  // nothing from it.
  const rivals = present.filter(
    ([id]) => id !== controller && !isGuestOf(state, id, controller),
  );
  const contested = rivals.length > 0 && (controller !== null || present.length > 1);

  if (remaining > 0) {
    if (controller && !contested) {
      shares[controller] = (shares[controller] ?? 0) + base * remaining;
    } else if (controller && contested) {
      // The holder administers; rivals merely extract. A 2x weight keeps a
      // blockade painful without making occupation strictly better than owning.
      const HOLDER_EDGE = 2;
      const weights: [string, number][] = [
        // At least 1, so an owner with no ships in orbit still administers.
        [controller, Math.max(1, system.ships?.[controller] ?? 0) * HOLDER_EDGE],
        ...rivals,
      ];
      const total = weights.reduce((sum, [, w]) => sum + w, 0);
      if (total > 0) {
        for (const [id, w] of weights) {
          shares[id] = (shares[id] ?? 0) + base * remaining * (w / total);
        }
      }
    } else if (!controller && rivals.length > 0) {
      // Unaligned and occupied: whoever is present splits what they can take.
      const total = rivals.reduce((sum, [, n]) => sum + n, 0);
      for (const [id, n] of rivals) {
        shares[id] = (shares[id] ?? 0) + base * remaining * (n / total);
      }
    }
    // Unaligned and unoccupied with no treaty: the remainder simply is not
    // collected by anyone. Neutral worlds are not free money.
  }

  for (const id of Object.keys(shares)) shares[id] = Math.round(shares[id]!);
  return { systemId: system.id, base, shares, contested, byTreaty };
}

/**
 * What a faction earns and spends this turn. Pure and deterministic — it is
 * applied during `tickTurn`, so replay reproduces every credit.
 */
export function ledgerFor(state: WorldState, factionId: string): Ledger {
  const faction = getFaction(state, factionId);
  if (!faction) {
    return {
      gross: 0, upkeep: 0, net: 0, systems: 0, treatyFlow: 0,
      espionageLoss: 0, agentUpkeep: 0, commitmentFlow: 0,
      territory: 0, routes: 0, tolls: 0, raided: 0,
    };
  }

  let base = 0;
  let counted = 0;
  for (const system of state.systems) {
    const income = systemIncome(state, system);
    const share = income.shares[factionId] ?? 0;
    if (share > 0) {
      base += share;
      counted += 1;
    }
  }

  const territory = Math.round(base * TRADE_INCOME_MULTIPLIER[faction.tradeEthic]);

  // Trade is resolved for the whole galaxy at once, not per faction: tolls and
  // raids move credits BETWEEN powers, so one faction's take cannot be
  // computed without settling everyone else's claim on the same lane.
  const earnings = routeEarnings(state);
  let routes = earnings.shares[factionId] ?? 0;
  if (faction.tradeEthic === 'free_trade') {
    routes = Math.round(routes * (1 + FREE_TRADE_OPENNESS_BONUS * earnings.openness));
  }
  // A monopolist running a lane end to end is worth more than the sum of the
  // two halves. Added here rather than inside `routeEarnings` so the split it
  // performs stays a conserved division of what the network is worth — the same
  // treatment the free trader's openness bonus gets, two lines up.
  routes += earnings.monopolyPremium[factionId] ?? 0;

  const gross = territory + routes;
  const upkeep = fleetStrengthOf(state, factionId) * UPKEEP_PER_FLEET_POINT;

  let treatyFlow = 0;
  for (const treaty of state.treaties ?? []) {
    if (!isTreatyLive(treaty, state.turn)) continue;
    treatyFlow += treaty.terms.incomePerTurn[factionId] ?? 0;
  }

  // Hostile agents sitting on your systems skim before you ever see it.
  let espionageLoss = 0;
  for (const agent of state.agents ?? []) {
    if (agent.exposed || agent.ownerFactionId === factionId) continue;
    if (agent.effect.kind !== 'income_penalty') continue;
    const host = getSystem(state, agent.systemId);
    if (host?.controllerFactionId === factionId) espionageLoss += agent.effect.perTurn;
  }

  const agentUpkeep = liveAgentsOf(state, factionId).length * AGENT_UPKEEP;

  // Standing arrangements finally reach the books. Read here rather than paid
  // out each tick, for the same reason agent effects are read where they are
  // used: a per-turn mutation would compound instead of recurring.
  const commitmentFlow = commitmentIncomeFor(
    state.commitments ?? [],
    factionId,
    maxCommitmentIncomeFor(state, factionId),
  );

  return {
    gross,
    upkeep,
    net: gross - upkeep + treatyFlow - espionageLoss - agentUpkeep + commitmentFlow,
    systems: counted,
    treatyFlow,
    espionageLoss,
    agentUpkeep,
    commitmentFlow,
    territory,
    routes,
    tolls: earnings.tolls[factionId] ?? 0,
    raided: earnings.raided[factionId] ?? 0,
  };
}

/**
 * How many hulls one power can talk out of another's service, per attempt.
 *
 * A stat contest rather than a constant: the suborner's `guile` against the
 * target's `resolve`. One hull is the floor when you have any edge at all, and
 * a point of advantage buys one more. A power with high resolve simply cannot
 * be suborned — the Iron Vigil's crews do not defect, which is what resolve 17
 * ought to mean.
 *
 * Playtesting produced a real defection (a Nar corvette, on a natural 20) and
 * that was a good outcome. The problem was that nothing capped it: the same op
 * shape would move thirty hulls across the galaxy with no roll and no
 * presence. The magnitude is now arithmetic here, where a prompt cannot argue
 * with it.
 */
export function subornLimit(state: WorldState, actorId: string, targetId: string): number {
  if (actorId === targetId) return 0;
  const edge =
    statModifier(effectiveStats(state, actorId).guile) -
    statModifier(effectiveStats(state, targetId).resolve);
  return Math.max(0, 1 + edge);
}

/**
 * Whether a faction is close enough to suborn crews at a system.
 *
 * Three ways in, and the second is the important one:
 *
 * - ships **in** the system;
 * - ships **one jump out** — boats go across, quietly or under a show of
 *   force, and nobody has to fight;
 * - an unexposed **agent** already in place.
 *
 * Requiring ships *in* the system meant you had to win the orbital battle
 * before you could talk to anyone — so suborning was something you did to a
 * power you had already beaten, which is the same inversion that made commerce
 * raiding useless to the weak. A fleet should be able to force a defection
 * precisely because it does NOT want to fight; the price is paid in standing,
 * not in hulls.
 */
export function canSubornAt(state: WorldState, factionId: string, systemId: string): boolean {
  const system = getSystem(state, systemId);
  if (!system) return false;
  if ((system.ships[factionId] ?? 0) > 0) return true;

  const adjacent = buildAdjacency(state.systems).get(systemId) ?? new Set<string>();
  for (const id of adjacent) {
    if ((getSystem(state, id)?.ships[factionId] ?? 0) > 0) return true;
  }

  return (state.agents ?? []).some(
    (a) => a.ownerFactionId === factionId && a.systemId === systemId && !a.exposed,
  );
}

/** Live commitments binding a faction, for the UI and for prompts. */
export function commitmentsOf(state: WorldState, factionId: string): Commitment[] {
  return commitmentsFor(state.commitments ?? [], factionId);
}

/** Stat penalty from a leader's own institutions losing faith in them. */
/**
 * What a leader whose institutions have entirely stopped trusting them loses
 * from every stat.
 *
 * Stats run 1–20, so the old ceiling of 4 was a fifth of the scale — a bad
 * quarter, not a crisis. At 8 a maxed-out dissent is 40% of the range and −4 on
 * every modifier, which is the difference between a power that functions and
 * one that does not. That is what "your own people have stopped following you"
 * should mean, and it gives the whole 0–100 track somewhere to go.
 */
export const MAX_DISSENT_PENALTY = 8;

/**
 * Dissent per point of penalty — derived, not chosen, so the ceiling above is
 * the single number that sets the curve. 12.5 keeps one refusal (8) free and
 * makes a run of them bite.
 */
export const DISSENT_PER_PENALTY_POINT = 100 / MAX_DISSENT_PENALTY;

/**
 * Dissent added each time your own faction refuses an order.
 *
 * Not a punishment for being refused — the institutions got their way. It
 * measures how far the leader has strayed from the power they lead: repeatedly
 * trying to make a faction act against its own character is what erodes
 * confidence in the leadership, whether or not the attempt succeeds. Against a
 * decay of 2 a turn, one refusal fades in four turns and a run of them does
 * not.
 */
export const REFUSAL_DISSENT = 8;

/**
 * Dissent added per turn, per compulsion a faction is visibly ignoring.
 *
 * Set against `DISSENT_DECAY` (2), which is what makes it a *drift* rather than
 * a punishment: one ignored compulsion nets +1 a turn, so a power playing
 * mildly against type takes about thirteen turns to lose a single stat point
 * and stops the moment it complies. A power ignoring two at once — the Iron
 * Vigil sitting passive while a rival's fleet sits on an Imperial world — nets
 * +4, and finds out considerably sooner.
 *
 * Deliberately far below `REFUSAL_DISSENT` (8). Actively ordering your faction
 * to betray itself is a worse offence than merely failing to be it.
 */
export const COMPULSION_DRIFT_DISSENT = 3;

/**
 * Reorienting a power costs standing with the people who have to carry it out.
 *
 * `set_doctrine` used to write a string and nothing else. Every axis that
 * actually did anything — `warEthic`, `tradeEthic`, `redLines`, `compulsions` —
 * was immutable for the whole campaign, so "we abandon free trade and turn
 * raider" changed the paragraph on screen and left the Authority's
 * anti-raiding compulsion in place to refuse every raid that followed. The
 * player was told they had changed course while nothing had, and the mechanism
 * that then punished them was invisibly unrelated.
 *
 * Doctrine is now really changeable, and dissent is the price. Priced in code,
 * per axis actually moved, because a model asked to nominate its own cost will
 * nominate a small one:
 *
 * - Restating your posture is cheap. Words are cheap.
 * - Changing a war or trade ethic is a real institutional turn: two of these
 *   plus an abandoned principle is 65, which is two penalty points off every
 *   stat for the thirty turns it takes to decay.
 * - Abandoning a red line or a compulsion is the expensive one. It is the thing
 *   the institution exists to hold, and it is what actually unblocks a change
 *   of course — retiring "commerce raiding is refused outright" is what lets
 *   Meridian raid at all.
 */
export const DOCTRINE_TEXT_DISSENT = 6;
export const DOCTRINE_ETHIC_DISSENT = 20;
export const DOCTRINE_RETIRE_DISSENT = 25;

/**
 * Dissent at or above which a faction will not be reoriented at all.
 *
 * Two jobs. It is the fiction — a leadership its own institutions have stopped
 * trusting does not get to redefine what the institution is for. And it closes
 * a loophole in the ceiling: dissent clamps at 100, so without this a leader at
 * the cap could change doctrine as often as they liked for free, the cost
 * having already been paid in full.
 */
export const DOCTRINE_CHANGE_DISSENT_CEILING = 75;

export function dissentPenalty(dissent: number): number {
  return Math.min(MAX_DISSENT_PENALTY, Math.floor(dissent / DISSENT_PER_PENALTY_POINT));
}

/**
 * Effective stats after covert interference AND internal dissent.
 *
 * A `stat_debuff` agent makes its target measurably worse at something. So does
 * a leader their own commanders no longer trust: dissent subtracts from EVERY
 * stat, because an order carried out reluctantly is carried out badly. Checks
 * read from here rather than straight off the faction, so refusing to govern in
 * character has a running cost rather than being a free "no".
 */
export function effectiveStats(state: WorldState, factionId: string): FactionStats {
  const faction = getFaction(state, factionId);
  const base: FactionStats = faction
    ? { ...faction.stats }
    : { might: 10, guile: 10, industry: 10, influence: 10, resolve: 10 };

  const penalty = dissentPenalty(faction?.dissent ?? 0);
  if (penalty > 0) {
    for (const stat of STAT_NAMES) base[stat] = Math.max(1, base[stat] - penalty);
  }

  for (const agent of state.agents ?? []) {
    if (agent.exposed || agent.ownerFactionId === factionId) continue;
    if (agent.effect.kind !== 'stat_debuff') continue;
    const host = getSystem(state, agent.systemId);
    if (host?.controllerFactionId !== factionId) continue;
    base[agent.effect.stat] = Math.max(1, base[agent.effect.stat] - agent.effect.magnitude);
  }
  return base;
}

/** Live treaties a faction is party to. */
export function treatiesFor(state: WorldState, factionId: string): Treaty[] {
  return (state.treaties ?? []).filter(
    (t) => t.parties.includes(factionId) && isTreatyLive(t, state.turn),
  );
}

/** Agents a faction can see: its own, plus any hostile agent it has exposed. */
export function agentsVisibleTo(state: WorldState, factionId: string): Agent[] {
  return (state.agents ?? []).filter((a) => a.ownerFactionId === factionId || a.exposed);
}

/** Factions this one is at war with — no live non-aggression or ceasefire. */
/**
 * How far a relationship has to sour before it counts as a war.
 *
 * Named rather than inlined because two different reads of it have to agree:
 * a faction's own war list, and the same list as any other party sees it.
 */
export const WAR_DISPOSITION_THRESHOLD = -60;

/**
 * Factions this one is at war with — no live non-aggression or ceasefire, and
 * a relationship soured past `WAR_DISPOSITION_THRESHOLD`.
 *
 * Checked in BOTH directions, because a war is a property of the relationship
 * and not of one party's opinion. This previously read only "who hates me",
 * which meant the victim of an unprovoked attack did not list their attacker
 * as an enemy: the mechanical disposition costs (raiding, suborning, tolls,
 * pact-breaking) all move the INJURED party's view of the aggressor, and
 * nothing moves the aggressor's view of them. A playtest raid left Arkanis
 * hating Drajk at -62 while Drajk's own view sat at -10, so
 * `warsFor('freeworlds')` omitted the faction that had just raided it.
 */
export function warsFor(state: WorldState, factionId: string): string[] {
  const atPeace = new Set<string>();
  for (const treaty of treatiesFor(state, factionId)) {
    if (treaty.type === 'non_aggression' || treaty.type === 'ceasefire' || treaty.type === 'mutual_defense') {
      for (const p of treaty.parties) if (p !== factionId) atPeace.add(p);
    }
  }
  return state.factions
    .filter(
      (f) =>
        f.id !== factionId &&
        !atPeace.has(f.id) &&
        (dispositionBetween(state, f.id, factionId) <= WAR_DISPOSITION_THRESHOLD ||
          dispositionBetween(state, factionId, f.id) <= WAR_DISPOSITION_THRESHOLD),
    )
    .map((f) => f.id);
}

/**
 * A system is contested when someone other than its controller has a fleet
 * movement inbound that is already under way.
 */
export function isContested(s: WorldState, systemId: string): boolean {
  const sys = getSystem(s, systemId);
  if (!sys) return false;
  return s.pendingOrders.some(
    (o) =>
      isMovementType(o.type) &&
      o.targetId === systemId &&
      o.factionId !== sys.controllerFactionId,
  );
}
