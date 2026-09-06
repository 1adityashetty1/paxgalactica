import { z } from 'zod';
import {
  CREDITS_PER_TON,
  HULL_SPEC,
  HullClassSchema,
  ShipStackSchema,
  UPKEEP_PER_TON,
  hullsIn,
  mergeStacks,
  normaliseStack,
  takeHulls,
  inLossOrder,
  orbitalWeightOf,
  tonsIn,
  type HullClass,
  type ShipStack,
} from './hulls.js';
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
import { DebtSchema, MAX_DEBT_PER_TURN, scheduledDebtService, type Debt } from './debt.js';
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
  /**
   * Was `mercenary`, which was exactly backwards for the only faction that had
   * it. `mercenary` means "fights for payment; war is a service sold" — the
   * seller. The Ojjul Nar Combine's doctrine is *"let other powers spend their
   * fleets for you"* and its red line is *"will not fight its own war where a
   * proxy could be hired"* — the buyer. On might 9, the lowest in the game, it
   * has no army to sell and never did. It funds wars; it does not fight them.
   */
  'profiteer',
] as const;
export const WarEthicSchema = z.enum(WAR_ETHICS);
export type WarEthic = z.infer<typeof WarEthicSchema>;

export const WAR_ETHIC_MEANING: Record<WarEthic, string> = {
  expansionist: 'takes territory because it is there; every world it holds makes the rest pay better',
  defensive: 'fights only when struck; its worlds are dug in, and storming one costs far more than taking it should',
  opportunist: 'attacks the weak and the distracted, avoids fair fights, switches sides without embarrassment',
  crusading: 'fights for legitimacy and grievance, and does not break off — it will win fights it should have fled and lose fleets it should have saved',
  profiteer: 'war is a market it funds rather than joins; it earns from every war it stays out of, and loses that trade the moment it is in one',
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
  /**
   * Someone has defaulted on a debt owed to you and you have done nothing
   * about it. The Ojjul Nar's *"an unpaid debt must be pursued"* is a demand,
   * which is exactly the shape a refusal cannot reach: a creditor who simply
   * never chases a debtor takes no action to be refused.
   */
  'debt_unpursued',
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
  ships: z.record(z.string(), ShipStackSchema).default({}),
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
  /**
   * Which class `commission_ships` lays down. Ignored by every other kind.
   *
   * A yard builds what it is told to build, and what it is told to build is
   * the difference between a programme that can take a world and one that can
   * only win the space over it.
   */
  hull: HullClassSchema.default('battleship'),
  /** One clause, shown to the player in the orders panel and the briefing. */
  summary: z.string().max(160).default(''),
});
export type OrderEffect = z.infer<typeof OrderEffectSchema>;
/**
 * The shape a payload is WRITTEN in, before defaults are filled.
 *
 * Same reason `OpInput` exists: `OrderEffect` is the parsed shape, so every
 * field with a `.default()` is required on it — right for reading a payload off
 * an order, wrong for writing one down in a fixture or a hand-built batch.
 */
export type OrderEffectInput = z.input<typeof OrderEffectSchema>;
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
   * owner's fleet but present in no system. Empty for non-movement work.
   *
   * A **composed** force rather than a count, because the ground phase asks a
   * question a total cannot answer: an invasion needs lift, and a fleet that is
   * all guns can sterilise a world's orbitals and take nothing. Accepts the
   * bare number every order written before classes existed carries, exactly as
   * `system.ships` does, so an old campaign replays as the game it was played
   * as.
   */
  force: ShipStackSchema.default({}),
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
  /**
   * `intel` is what your own operatives report, and it is the one kind that is
   * PRIVATE: the event log is shipped to the browser whole, so an entry here
   * must never contain something the player could not know. Only the player's
   * own agents write these. See `reportWatch` in the reducer.
   */
  kind: z.enum(['narrative', 'system', 'order', 'diplomacy', 'rejection', 'clamp', 'intel']),
  factionId: z.string().nullable().default(null),
  text: z.string(),
  /**
   * Who may read this entry. `null` — the default — means everybody.
   *
   * The event log is shipped to the browser whole, and it was quietly undoing
   * the fog. Measured live: in the *same* payload where a Meridian order was
   * correctly redacted to an anonymous rumour, the log carried
   * `"meridian begins Patrol conversion at Torrek Anchorage (3 turns) -> tor-1,
   * to deliver 4 new hulls for 240 credits"` — label, duration, target, payload
   * and price of the thing being hidden. A `counter_intelligence` sweep and a
   * rival's operative placed on the player's own world leaked the same way.
   *
   * Defaulting to public keeps every existing entry and every saved campaign
   * exactly as it was: only the handful of sites that describe secret work set
   * it. `intel` entries are player-only by a different route — they are written
   * solely for the player's own agents — and this makes that rule expressible
   * for anything else that needs it.
   */
  visibleTo: z.array(z.string()).nullable().default(null),
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
  /**
   * Money owed between powers — see `debt.ts`. Serviced as a transfer during
   * the tick rather than as a ledger rate, so a balance falls by exactly what a
   * debtor could actually find. Defaults to empty, so every save written before
   * debts existed still loads.
   */
  debts: z.array(DebtSchema).default([]),
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

/* ------------------------------------------------------------------ */
/* Fleets                                                              */
/* ------------------------------------------------------------------ */

/** Ships a faction has sitting in a given system. */
/**
 * A faction's ships at one world, by class. Never undefined.
 *
 * Every read and write of `system.ships` goes through the four functions below,
 * which is what keeps the stack invariant true everywhere: no zero entries, no
 * empty stacks, and no way for a caller to leave a class behind by writing a
 * bare total over a mixed force.
 */
export function stackAt(system: StarSystem, factionId: string): ShipStack {
  return system.ships[factionId] ?? {};
}

/** Hulls of every class. What a player counts. */
export function hullsAt(system: StarSystem, factionId: string): number {
  return hullsIn(system.ships[factionId]);
}

/** Tons. What every rule that limits a fleet by size counts. */
export function tonsAt(system: StarSystem, factionId: string): number {
  return tonsIn(system.ships[factionId]);
}

/** What this force is worth in an orbital exchange — zero for pure lift. */
export function orbitalWeightAt(system: StarSystem, factionId: string): number {
  return orbitalWeightOf(system.ships[factionId]);
}

/** Everyone present, as `[factionId, hulls]`, skipping empty stacks. */
export function presentAt(system: StarSystem): [string, number][] {
  return Object.entries(system.ships ?? {})
    .map(([id, stack]) => [id, hullsIn(stack)] as [string, number])
    .filter(([, n]) => n > 0);
}

/**
 * Add hulls of one class.
 *
 * Written through `normaliseStack`, so the key order of a stack is a function
 * of what is in it and never of the order it was built in. That is not
 * cosmetic: `verifyReplay` compares `JSON.stringify` of live state against
 * replayed state, and JSON preserves insertion order — so a fleet assembled as
 * battleships-then-escorts and one assembled as escorts-then-battleships
 * compared as DIFFERENT worlds while holding identical ships. It surfaced the
 * moment the doctrine bots began buying three classes in varying order, and it
 * would have surfaced sooner or later as a replay divergence nobody could
 * explain, since every value on both sides matched.
 */
export function addShipsAt(
  system: StarSystem,
  factionId: string,
  count: number,
  hull: HullClass = 'battleship',
): void {
  if (count <= 0) return;
  const stack = { ...stackAt(system, factionId) };
  stack[hull] = (stack[hull] ?? 0) + count;
  system.ships[factionId] = normaliseStack(stack);
}

/** Add a whole composed force. */
export function addStackAt(system: StarSystem, factionId: string, stack: ShipStack): void {
  const merged = mergeStacks(stackAt(system, factionId), stack);
  if (hullsIn(merged) === 0) delete system.ships[factionId];
  else system.ships[factionId] = merged;
}

/** Put an exact stack in place of whatever was there. */
export function setStackAt(system: StarSystem, factionId: string, stack: ShipStack): void {
  const next = normaliseStack(stack);
  if (hullsIn(next) === 0) delete system.ships[factionId];
  else system.ships[factionId] = next;
}

/**
 * Take `hulls` ships out of a system, cheapest first, and say what went.
 *
 * The counterpart of `setShipsAt` for callers that have to report what they
 * destroyed rather than only what survived.
 */
export function takeShipsAt(system: StarSystem, factionId: string, hulls: number): ShipStack {
  const { taken, left } = takeHulls(stackAt(system, factionId), hulls);
  setStackAt(system, factionId, left);
  return taken;
}

/**
 * Set the TOTAL hull count, adding or removing to reach it.
 *
 * Removing spends classes in `lossOrder` — the screen, then the lift arm, then
 * torpedo boats, then the battle line — which is the whole of an escort's job
 * and the reason a fleet without one arrives at a contested world with its
 * transports already dead. Zero clears the entry entirely, so `presentAt` and
 * the income split never see a faction that is not there.
 */
export function setShipsAt(
  system: StarSystem,
  factionId: string,
  total: number,
  hull: HullClass = 'battleship',
): void {
  const want = Math.max(0, Math.floor(total));
  if (want === 0) {
    delete system.ships[factionId];
    return;
  }
  const stack = { ...stackAt(system, factionId) };
  const have = hullsIn(stack);
  if (want > have) {
    stack[hull] = (stack[hull] ?? 0) + (want - have);
  } else if (want < have) {
    let toRemove = have - want;
    for (const cls of inLossOrder(stack)) {
      if (toRemove <= 0) break;
      const taken = Math.min(toRemove, stack[cls] ?? 0);
      const left = (stack[cls] ?? 0) - taken;
      if (left === 0) delete stack[cls];
      else stack[cls] = left;
      toRemove -= taken;
    }
  }
  system.ships[factionId] = normaliseStack(stack);
}

export function shipsAt(state: WorldState, factionId: string, systemId: string): number {
  const system = getSystem(state, systemId);
  return system ? hullsAt(system, factionId) : 0;
}

/** Ships a faction has in transit, committed to movement orders. */
export function shipsInTransit(state: WorldState, factionId: string): number {
  return state.pendingOrders
    .filter((o) => o.factionId === factionId && isMovementType(o.type))
    .reduce((sum, o) => sum + hullsIn(o.force), 0);
}

/**
 * A faction's whole navy: every ship in every system, plus everything under
 * way. This is derived, never stored — there is exactly one place ships live,
 * so combat, income and upkeep cannot disagree about how many there are.
 */
export function fleetStrengthOf(state: WorldState, factionId: string): number {
  const inSystems = state.systems.reduce((sum, s) => sum + (hullsAt(s, factionId)), 0);
  return inSystems + shipsInTransit(state, factionId);
}

/**
 * The same navy weighed rather than counted.
 *
 * **Tons are what every rule that limits a fleet by size reads** — upkeep, the
 * yards' bill, insolvency attrition, the price of a suborned crew. Hulls are
 * what a player counts, and the two must not be confused: three escorts and a
 * battleship are four ships either way, but ten tons against twelve.
 */
export function fleetTonsOf(state: WorldState, factionId: string): number {
  const inSystems = state.systems.reduce((sum, s) => sum + tonsAt(s, factionId), 0);
  const inTransit = state.pendingOrders
    .filter((o) => o.factionId === factionId && isMovementType(o.type))
    .reduce((sum, o) => sum + tonsIn(o.force), 0);
  return inSystems + inTransit;
}

/**
 * Where a faction could pull ships from, richest system first. Used when an op
 * adds or removes fleet without naming a system; deterministic so replay holds.
 */
export function fleetBases(state: WorldState, factionId: string): StarSystem[] {
  return state.systems
    .filter((s) => s.controllerFactionId === factionId || (hullsAt(s, factionId)) > 0)
    .sort(
      (a, b) =>
        b.strategicValue - a.strategicValue ||
        (hullsAt(b, factionId)) - (hullsAt(a, factionId)) ||
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
/**
 * Credits a battleship costs to keep in being, per turn.
 *
 * Kept as the anchor the tonnage rates were chosen against — `UPKEEP_PER_TON`
 * times a battleship's four tons is exactly this — so the number the economy
 * was balanced around is still stated once, in the place the balance argument
 * was made. Upkeep itself is billed per ton.
 */
export const UPKEEP_PER_FLEET_POINT = 4;

/**
 * What a battleship costs to commission — four tons at `CREDITS_PER_TON`.
 *
 * Priced against the economy it is paid from: net incomes run 87–300 a turn,
 * so this buys between one and five capital ships per turn from revenue.
 * Expanding a navy is therefore a multi-turn programme competing with
 * everything else, rather than a sentence in an order.
 *
 * **Derived rather than stated**, since classes exist: the yards bill by
 * displacement, and a constant that could disagree with the rate it was chosen
 * against is the drift this whole design is trying to remove. Kept because it
 * is still the anchor other prices are argued against.
 *
 * Enforced in the reducer, never in a prompt. "Build a thousand ships" is
 * exactly the kind of instruction a model can be argued into, which is why the
 * arithmetic lives here instead.
 */
export const SHIP_COST = HULL_SPEC.battleship.tonnage * CREDITS_PER_TON;

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
  /**
   * A profiteer's take from other powers' wars — or, when it is in one itself,
   * what that costs it. Zero for everyone else.
   */
  warProfit: number;
  /** Territory: what the systems themselves pay. */
  territory: number;
  /** Trade: what the lane network pays, after tolls and raids. */
  routes: number;
  /** Of `routes`, what was taken from others as transit tolls. */
  tolls: number;
  /** Of `routes`, what was taken from others by commerce raiding. */
  raided: number;
  /**
   * Scheduled debt service: positive receives, negative pays.
   *
   * Deliberately **not** part of `net`. A debt is settled as an explicit
   * transfer in `tickTurn`, because a rate read off state cannot know whether
   * the debtor could afford it — `credits` floors at zero, so a broke debtor
   * would "pay" money it never had and the creditor would receive it. This is
   * reported so the briefing is honest about the drain, and charged exactly
   * once, in the tick.
   */
  debtService: number;
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

/**
 * Who is in orbit and how much of them there is.
 *
 * Weighed in TONS rather than counted, because the contest is over how much
 * force is sitting on the world: three escorts do not extract what three
 * battleships do. Hull counts would also make the cheapest class the efficient
 * way to skim a rival's income, which is exactly the exploit per-ton pricing
 * exists to close.
 */
const shipsPresent = (system: StarSystem): [string, number][] =>
  Object.entries(system.ships ?? {})
    .map(([id, stack]) => [id, tonsIn(stack)] as [string, number])
    .filter(([, t]) => t > 0);

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
        [controller, Math.max(1, tonsAt(system!, controller)) * HOLDER_EDGE],
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
      espionageLoss: 0, agentUpkeep: 0, commitmentFlow: 0, warProfit: 0,
      territory: 0, routes: 0, tolls: 0, raided: 0, debtService: 0,
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

  let territory = Math.round(base * TRADE_INCOME_MULTIPLIER[faction.tradeEthic]);
  // Expansion compounds: every world an expansionist holds makes the rest pay
  // better. `counted` is worlds actually paying it, so a power squeezed out of
  // its holdings loses the bonus along with the income.
  if (faction.warEthic === 'expansionist') {
    territory = Math.round(territory * (1 + EXPANSIONIST_TERRITORY_BONUS * counted));
  }

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
  const upkeep = fleetTonsOf(state, factionId) * UPKEEP_PER_TON;

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

  const warProfit = warProfitFor(state, factionId);

  return {
    gross,
    upkeep,
    net:
      gross - upkeep + treatyFlow - espionageLoss - agentUpkeep + commitmentFlow + warProfit,
    systems: counted,
    treatyFlow,
    espionageLoss,
    agentUpkeep,
    commitmentFlow,
    warProfit,
    territory,
    routes,
    tolls: earnings.tolls[factionId] ?? 0,
    raided: earnings.raided[factionId] ?? 0,
    // Reported, never summed into `net` — see `Ledger.debtService`.
    debtService: scheduledDebtService(state.debts ?? [], factionId),
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
  if ((hullsAt(system, factionId)) > 0) return true;

  const adjacent = buildAdjacency(state.systems).get(systemId) ?? new Set<string>();
  for (const id of adjacent) {
    if (shipsAt(state, factionId, id) > 0) return true;
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
 * The most a single declaration may move a treasury through a freeform
 * `adjust_credits`, in either direction.
 *
 * Found in the first live playtest. A failed construction attempt emitted
 * `adjust_credits -380` with no order at all, and the successful retry emitted
 * the correctly priced order — `investedCredits: 156`, derived from marginal
 * income — *plus* a freeform `-180` for "premium rates demanded by wary
 * contractors". So `developmentCost`'s careful pricing bounded the payload and
 * bounded nothing about a second op in the same batch spending more than it.
 *
 * Every large movement of money in this game already has a mechanism that owns
 * its price: `SHIP_COST` through `billConstruction`, `AGENT_COST`,
 * `developmentCost`, treaty `incomePerTurn`, commitment income, tolls, raiding.
 * None of them route through `adjust_credits` — they debit the treasury
 * directly — so capping this op cannot interfere with any of them. What is left
 * for `adjust_credits` is narrative money: a bribe, a fine, a windfall. Four
 * hulls' worth is generous for that, and anything larger has somewhere better
 * to live.
 */
export const MAX_NARRATIVE_CREDITS = 4 * SHIP_COST;

/**
 * The most a single treaty may move per turn, in either direction.
 *
 * The paragraph above notes that treaty `incomePerTurn` is one of the
 * mechanisms that "owns its price" and so does not need the narrative cap. It
 * owned no price at all: the field was unbounded, which made it strictly the
 * better way to move money out of a negotiation. Measured live — the same
 * payment refused at 990 as a one-off (trimmed to `MAX_NARRATIVE_CREDITS`) was
 * accepted at 300 *per turn*, indefinitely, through this field. Twelve times
 * the one-off ceiling, every turn, forever, and the cap on the one-off path was
 * theatre for as long as this one existed.
 *
 * Anchored to `MAX_DEBT_PER_TURN` rather than picked: a debt instalment is the
 * other recurring per-turn instrument in the game, and the two should not
 * differ by an order of magnitude for what is, mechanically, the same act of
 * promising a stream. It is also one hull a turn, which is a real commitment
 * against net incomes of 87–300 without being anyone's whole economy.
 *
 * Trimmed rather than rejected, the same shape as `MAX_COMMITMENT_INCOME`: the
 * arrangement is still real at a smaller number.
 *
 * > Worth a balance pass. This is the first bound the field has ever had, so
 * > the number has never been swept against played turns the way
 * > `MONOPOLY_BONUS` and `ENDPOINT_SHARE` were.
 */
export const MAX_TREATY_INCOME_PER_TURN = MAX_DEBT_PER_TURN;

/* ------------------------------------------------------------------ */
/* War ethics                                                          */
/* ------------------------------------------------------------------ */

/**
 * `warEthic` had **no mechanical reader anywhere** — only the prompt
 * serializer — for the whole life of the project, which is why two factions
 * shared `defensive` and nobody noticed, and why `expansionist` sat unused. A
 * belief with no arithmetic behind it is flavour text, and the model can be
 * argued out of flavour text.
 *
 * Each ethic now has exactly one signature mechanic, on the same principle as
 * `tradeEthic`: two of them are deliberately double-edged rather than flat
 * buffs, because a doctrine that is purely an advantage is not a doctrine, it
 * is a bonus.
 */

/**
 * How much better every world an expansionist holds pays, per world it holds.
 *
 * Deliberately an income mechanic rather than a military one. Meridian is a
 * *commercial* expansionist — "Commerce is sovereignty" — so what expansion
 * buys it is administrative scale, not a better army. It compounds, which is
 * the point: an expansionist that is allowed to keep taking worlds becomes a
 * problem the others have to answer, and one held to four worlds gains ~12%.
 */
export const EXPANSIONIST_TERRITORY_BONUS = 0.03;

/**
 * What a war is worth per turn to a profiteer that is not in it.
 *
 * The Combine's entire doctrine — "fund both sides, own the survivor" — and
 * nothing in the game paid it for doing so.
 */
export const PROFITEER_INCOME_PER_WAR = 20;

/**
 * What each of its own wars costs a profiteer, per turn, on top of forfeiting
 * every war it was profiting from.
 *
 * This is what makes the doctrine self-enforcing rather than advisory. A
 * financier at war is a financier whose clients have noticed its attention is
 * elsewhere and taken their business somewhere calmer, so entering one war
 * costs it that war's fee, every other war's fee, and this. Its red line
 * against fighting its own wars is now a line the ledger agrees with.
 */
export const PROFITEER_WAR_PENALTY = 40;

/**
 * How much larger a defensive power's garrison fights than it is.
 *
 * "Make occupation cost more than it is worth" is the Arkane doctrine stated
 * almost as arithmetic, and this is the arithmetic.
 */
export const DEFENSIVE_GARRISON_BONUS = 1.5;

/** What an opportunist gains against a target already weakened or distracted. */
export const OPPORTUNIST_MIGHT_BONUS = 2;

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
/**
 * What defying one of your own compulsions costs, every time you do it.
 *
 * This replaced retiring principles outright: a leader can turn their power
 * against its own character by simply insisting, and the price is that
 * eventually nobody is following them. Roughly **eight breaches** reach the 100
 * cap and `MAX_DISSENT_PENALTY` — eight points off every stat — allowing for
 * `DISSENT_DECAY` between them.
 *
 * Deliberately larger than `REFUSAL_DISSENT` (8), which is what a *red line*
 * costs. Being told no is cheaper than being obeyed against the institution's
 * judgement, because the second one actually happened. And deliberately smaller
 * than `DOCTRINE_ETHIC_DISSENT` (20): one act against character is a lighter
 * thing than permanently rewriting what the power is.
 *
 * **It was 25, and the first live playtest of the arbiter rework showed that was
 * too steep.** The charge lands on the *attempt* — the institutions are furious
 * that the thing was proposed, which is the right reading and the one that keeps
 * the price out of the outcome bands — but at 25 that made attempting the lesser
 * transgression and failing three times worse than attempting an absolute one
 * and being blocked. Playing Arkane, two compulsion breaches in a single turn
 * (one of them a natural 1 that achieved precisely nothing) took the Free Worlds
 * to 58 dissent and −4 on every stat before the second turn began. At 15 that
 * same turn lands at 38 and −3: still a real, visible cost, and no longer a
 * spiral from one bad roll.
 *
 * Nothing further fires at the cap, and that is on purpose: at 100 the penalty
 * is already crippling, and a terminal state on top of it would be charging
 * twice for one decision.
 */
export const COMPULSION_BREACH_DISSENT = 15;

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
 * nothing moves the aggressor's view of them. A playtest raid left Arkane
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
 * Every war currently running in the galaxy, as canonical unordered pairs.
 *
 * Derived from `warsFor` in both directions and de-duplicated, so a war between
 * two powers is counted once however either of them feels about it.
 */
export function warsInProgress(state: WorldState): string[] {
  const wars = new Set<string>();
  for (const faction of state.factions) {
    for (const enemy of warsFor(state, faction.id)) {
      wars.add([faction.id, enemy].sort().join('~'));
    }
  }
  return [...wars].sort();
}

/**
 * What a profiteer earns from the galaxy's wars, or what its own cost it.
 *
 * Zero for every other ethic. This is the Ojjul Nar Combine's whole doctrine —
 * *"fund both sides, own the survivor, and let other powers spend their fleets
 * for you"* — which nothing in the game paid it a credit for.
 *
 * The sign flip is what makes the doctrine enforce itself. A profiteer at peace
 * is paid for every war it is not in; a profiteer at war forfeits all of that
 * *and* pays a penalty, because a financier whose attention is on its own
 * fighting is a financier whose clients have gone somewhere calmer. Its red
 * line against fighting its own wars is now a line the ledger agrees with,
 * rather than one the model has to be trusted to remember.
 */
export function warProfitFor(state: WorldState, factionId: string): number {
  const faction = getFaction(state, factionId);
  if (!faction || faction.warEthic !== 'profiteer') return 0;

  const own = warsFor(state, factionId);
  if (own.length > 0) return -PROFITEER_WAR_PENALTY * own.length;

  const elsewhere = warsInProgress(state).filter(
    (war) => !war.split('~').includes(factionId),
  );
  return elsewhere.length * PROFITEER_INCOME_PER_WAR;
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
