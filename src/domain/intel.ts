import { z } from 'zod';
import type { DurationCategory } from './duration.js';
import {
  MOVEMENT_ORDER_TYPE,
  type OrderType,
  type PendingOrder,
  type WorldState,
} from './state.js';

/* ------------------------------------------------------------------ */
/* What a faction can see of everyone else's work                      */
/* ------------------------------------------------------------------ */

/**
 * Intelligence, and why it needed a module rather than a flag.
 *
 * `ordersVisibleTo` has existed for a long time and had **exactly one caller**:
 * `serialize.ts`, building prompt blocks for a model. Every player-facing path
 * — `report.advanced`, the `GET /api/campaign` payload, the orders panel —
 * read `state.pendingOrders` whole. So the loop this project describes
 * everywhere ("long projects are worth hiding AND worth raiding") existed only
 * for NPCs, and a player had perfect information from turn 0. Measured over a
 * seven-turn campaign played expressly to spy: four `surveillance` operatives
 * produced **zero** output, because nothing they could reveal was concealed.
 *
 * The obvious fix — filter the existing function into the API — is a trap, and
 * the board says why. On the final state of that campaign four orders were
 * pending and `visibility` was **empty on all four**: `prompts/resolution.md`
 * asks the resolution call to name who would plausibly notice, and it simply
 * does not. Switching the filter on would therefore not move the game from
 * "sees everything" to "sees selectively" but to **"sees almost nothing"**,
 * with the only dial that reopens it one the model has proven it will not
 * turn. A fleet would arrive on a world with no way to have seen it coming,
 * which is not fog of war but a coin toss.
 *
 * So visibility is decided in code, from three rules that need nothing from a
 * model:
 *
 * 1. **Some work is public by its nature.** A blockade closes lanes, a decree
 *    is announced, walls are visible from orbit, and a fleet under way is
 *    ships in space. A refit inside a yard, a back-room manoeuvre, a
 *    capital-ship programme and an operation run by definition in secret are
 *    not. `PUBLIC_CATEGORIES` is that split, and it lives beside the order
 *    *type* deliberately — the type is already the duration category and
 *    already decides which `onComplete` payloads may be delivered, so making
 *    it decide visibility too adds a column rather than a taxonomy.
 * 2. **You see your own space** — but not everything in it. Anything physical
 *    whose origin or target is a world you hold, or one your ships sit in, is
 *    visible: a rival's yard work over your own world happens in front of your
 *    dockmasters. `COVERT_CATEGORIES` is the exception, and it matters more
 *    than the rule: an operation run *against* you must not be revealed to you
 *    for the reason that it targets you. A pure predicate over state either
 *    way, so it replays exactly and cannot be argued with.
 * 3. **An operative sees through the rest**, which is what `intel` was always
 *    for and is now the only way to reach a secret programme.
 *
 * Everything else is a **rumour**: you learn that a power has something under
 * way at a named world and how long it runs, and nothing else. That grading is
 * the load-bearing half. A binary filter would hide secret work so completely
 * that a player would never learn there was anything in the Tion Marches worth
 * looking at, and surveillance would stay exactly as unmotivated as it is
 * today. Knowing that something is happening and not what it is, is the
 * pressure that makes an operative worth 150 credits.
 *
 * A rumour is deliberately **not** a `PendingOrder`. Reusing that shape would
 * mean inventing a `type` and an `id` for something the player is not supposed
 * to know the type of — and shipping the real id would let them
 * `interrupt_order` a programme they cannot see, which is worse than showing
 * it to them. A separate, smaller record cannot leak what it does not carry.
 *
 * **Knowledge is a snapshot, not a memory.** What you can see now is what you
 * see; burn the operative and the programme goes back to being a rumour. A
 * last-known-position model is the more honest one and needs a durable set on
 * `WorldState` — schema, save format and journal — which is a much larger
 * change than this one. Written down as the known simplification rather than
 * pretended away.
 */

/**
 * Work that cannot be hidden, whatever the faction would prefer.
 *
 * The test for membership is physical, not strategic: could a neighbour with
 * no operative in place tell that this was happening? Troops drilling, walls
 * going up, a lane closed, a ship under way and a decree read out all pass it.
 * Everything else is inside a yard, a ministry or a safe house.
 */
export const PUBLIC_CATEGORIES: ReadonlySet<OrderType> = new Set<OrderType>([
  MOVEMENT_ORDER_TYPE,
  'courier',
  'decree',
  'blockade',
  'treaty_ratification',
  'garrison_raising',
  'fortification',
  'construction_infrastructure',
]);

/** The complement, named so the split is readable in one place. */
export const SECRET_CATEGORIES: ReadonlySet<DurationCategory> = new Set<DurationCategory>([
  'political_maneuver',
  'espionage',
  'counter_intelligence',
  'commerce_raiding',
  'refit',
  'retooling',
  'capital_ship_construction',
  'industrial_conversion',
]);

/**
 * Work that stays secret **even in your own space**.
 *
 * "You see your own space" is right for anything physical — a rival refitting
 * hulls in a yard over a world you hold is happening in front of your own
 * dockmasters, and so is a conversion or a slipway. It is exactly wrong for
 * the four categories whose entire purpose is to be run against someone
 * without their knowledge: an `espionage` operation targeting your capital
 * would be revealed to you *because* it targets your capital, which is the
 * mechanic cancelling itself out. The first draft of this file did precisely
 * that, and it is a sharper bug than the one it replaced — an oversight became
 * a rule.
 *
 * These are reachable only by an operative of your own, or by the acting power
 * choosing to be seen. Presence buys nothing. Note that presence is still not
 * *nothing*: `commerce_raiding` needs a fleet a jump out and `system.ships` is
 * not redacted, so the hulls show even while the order does not — you can see
 * that raiders are gathering, and not that a raid is the plan.
 */
export const COVERT_CATEGORIES: ReadonlySet<DurationCategory> = new Set<DurationCategory>([
  'espionage',
  'counter_intelligence',
  'political_maneuver',
  'commerce_raiding',
]);

export function isCovertOrderType(t: OrderType): boolean {
  return COVERT_CATEGORIES.has(t as DurationCategory);
}

export function isPublicOrderType(t: OrderType): boolean {
  return PUBLIC_CATEGORIES.has(t);
}

/**
 * What a power learns about a programme it did not order.
 *
 * `hidden` is never shipped: it is the third state so that callers have to say
 * what they do with it rather than defaulting to showing it.
 */
export type OrderVisibility = 'full' | 'rumour' | 'hidden';

/** Systems a faction can watch without an operative: its own, and where it stands. */
function ownSpace(state: WorldState, factionId: string): Set<string> {
  const ids = new Set<string>();
  for (const sys of state.systems) {
    if (sys.controllerFactionId === factionId || (sys.ships[factionId] ?? 0) > 0) {
      ids.add(sys.id);
    }
  }
  return ids;
}

/** Systems a faction has an unexposed `intel` operative in. */
function watchedSystems(state: WorldState, factionId: string): Set<string> {
  return new Set(
    (state.agents ?? [])
      .filter((a) => a.ownerFactionId === factionId && !a.exposed && a.effect.kind === 'intel')
      .map((a) => a.systemId),
  );
}

/**
 * How well `factionId` sees one order.
 *
 * Nothing is ever `hidden` today — every secret programme surfaces as a
 * rumour, because a rumour is the hook that makes an operative worth buying.
 * The state exists so that a later rule (distance, a counter-intelligence
 * sweep that suppresses rumours) has somewhere to land without every caller
 * changing shape.
 */
export function visibilityOf(
  state: WorldState,
  factionId: string,
  order: PendingOrder,
  space = ownSpace(state, factionId),
  watched = watchedSystems(state, factionId),
): OrderVisibility {
  // Your own work, and work its owner is content to be seen doing.
  if (order.factionId === factionId) return 'full';
  if (order.visibility.includes(factionId)) return 'full';

  // An operative sees through everything, including the covert categories
  // below. This is tested BEFORE them, which is the whole reason an operative
  // is worth buying.
  if (watched.has(order.originId) || watched.has(order.targetId)) return 'full';

  if (isPublicOrderType(order.type)) return 'full';

  // Clandestine by definition: presence does not reveal it, and being the
  // target least of all. Ordered before the space clause on purpose.
  if (isCovertOrderType(order.type)) return 'rumour';

  if (space.has(order.originId) || space.has(order.targetId)) return 'full';
  return 'rumour';
}

/**
 * What a power knows a rival is doing, without knowing what it is.
 *
 * Carries only the four facts a neighbour could plausibly have: whose it is,
 * where, how long it runs and how far along it is. No type, no label, no
 * payload, no force, no path — and crucially **no order id**, so a rumour
 * cannot be handed to `interrupt_order`.
 */
export const OrderRumourSchema = z.object({
  factionId: z.string().min(1),
  /** The system the activity is centred on — a target id. */
  systemId: z.string().min(1),
  durationTurns: z.number().int().min(1),
  progress: z.number().int().min(0),
});
export type OrderRumour = z.infer<typeof OrderRumourSchema>;

export interface Observation {
  /** Orders seen in full, safe to render and to act against. */
  orders: PendingOrder[];
  /** Everything else, reduced to the fact that it exists. */
  rumours: OrderRumour[];
}

/** Split the board's pending work into what a faction sees and what it merely suspects. */
export function observeOrders(state: WorldState, factionId: string): Observation {
  const space = ownSpace(state, factionId);
  const watched = watchedSystems(state, factionId);

  const orders: PendingOrder[] = [];
  const rumours: OrderRumour[] = [];

  for (const order of state.pendingOrders) {
    const how = visibilityOf(state, factionId, order, space, watched);
    if (how === 'full') orders.push(order);
    else if (how === 'rumour') {
      rumours.push({
        factionId: order.factionId,
        systemId: order.targetId,
        durationTurns: order.durationTurns,
        progress: order.progress,
      });
    }
  }

  return { orders, rumours };
}

/**
 * The world as one faction sees it.
 *
 * A derived value, never campaign state: `pendingOrders` is narrowed to what
 * the faction can actually see, so everything computed from it downstream —
 * the map's in-transit fleets, the orders panel, a system's activity — narrows
 * with it and cannot disagree.
 *
 * One consequence needs stating because it looks like a bug and is not.
 * `shipsInTransit` and `fleetStrengthOf` are derived from `pendingOrders`, so
 * in principle a rival's navy could read low by whatever it has under way
 * unseen. **It does not, and the reason is load-bearing:** `fleet_movement` is
 * in `PUBLIC_CATEGORIES`, so every movement survives redaction and both totals
 * stay exact for every faction. Ships in space are observable; that was the
 * argument for putting movement in the public set, and this is the property it
 * buys.
 *
 * The corollary is a tripwire rather than a caveat: making movement hideable
 * would silently turn two exact counts into partial ones, and a number that is
 * wrong without saying so is the lie this project already refuses for
 * base-vs-effective stats. A test pins the invariant so that change cannot be
 * made quietly.
 */
export function worldAsSeenBy(state: WorldState, factionId: string): WorldState {
  return {
    ...state,
    pendingOrders: observeOrders(state, factionId).orders,
    eventLog: eventsVisibleTo(state, factionId),
  };
}

/**
 * The log as one faction may read it.
 *
 * Filtering `pendingOrders` alone was never going to be enough, and that is the
 * lesson worth keeping: **fog is a property of the whole payload, not of one
 * field.** The event log is shipped to the browser whole, and it carried the
 * label, duration, target, payload and price of the very orders the redaction
 * had just hidden — so a player who opened the log saw everything a player who
 * read the orders panel could not.
 *
 * An entry is public unless it says otherwise, which is what keeps every save
 * written before this loading unchanged and every existing call site correct.
 * Only the handful of sites that describe secret work — a non-public order
 * being issued, an operative placed, an operative recalled — name their
 * audience.
 */
export function eventsVisibleTo(state: WorldState, factionId: string) {
  return state.eventLog.filter((e) => e.visibleTo === null || e.visibleTo.includes(factionId));
}

/**
 * Orders a faction may see in full.
 *
 * Kept as its own name because it reads better at call sites that only want
 * the visible list, and because it is the shape the NPC prompt blocks have
 * always used — a reaction is built from what a power knows, and a rumour is
 * not something a faction can act on in a single turn.
 *
 * It used to live in `state.ts` and apply a narrower rule (your own, plus
 * `visibility`, plus an operative). It moved here when the floor grew, so that
 * the player's view and the model's cannot be computed two different ways.
 */
export function ordersVisibleTo(state: WorldState, factionId: string): PendingOrder[] {
  return observeOrders(state, factionId).orders;
}
