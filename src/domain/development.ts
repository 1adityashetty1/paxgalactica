import { DEFAULT_COVERT_EFFECT, type AgentMission } from './diplomacy.js';
import type { DurationCategory } from './duration.js';
import { CREDITS_PER_TON, HULL_SPEC } from './hulls.js';
import {
  addShipsAt,
  ledgerFor,
  type OrderEffect,
  type OrderEffectKind,
  type StarSystem,
  type WorldState,
} from './state.js';

/**
 * What a completed order actually *does*.
 *
 * Before this module, finishing a multi-turn order produced a log line and
 * nothing else. Twelve of fifteen duration categories had no reader anywhere
 * outside `duration.ts`: `garrison_raising` raised no garrison,
 * `fortification` fortified nothing, `industrial_conversion` converted
 * nothing. A player could spend five turns and real credits developing a world
 * and get a sentence in the event log — which made economic development the one
 * strategy in the game with no mechanical existence, and made `durationTurns`
 * meaningless for every category that had no other home for its effect.
 *
 * An order now carries an optional `onComplete` payload: what the programme
 * delivers, declared up front and applied by the reducer when the work lands.
 *
 * ## Why this is not "the model rewrites state, on a delay"
 *
 * A payload the model chooses freely is a model choosing its own payoff, which
 * is the exact hazard the central rule exists to prevent. Four bounds, all in
 * code, none of them guidance a prompt could be argued out of:
 *
 * 1. **The vocabulary is closed.** Four effect kinds, all of them arithmetic on
 *    a single system. Nothing here can transfer control, move credits directly,
 *    or touch another faction — `transfer_control`-class effects are not
 *    expressible, the same way they are absent from `ModelOpSchema`.
 * 2. **The category must permit the kind** (`EFFECT_CATEGORIES`). A `courier`
 *    run cannot develop a world; a one-turn `decree` cannot commission a
 *    fleet. This is the link that was missing entirely — the order's type is
 *    already its duration category, so tying the payload to the type means a
 *    development payload inherits a development category's floor and cannot
 *    land in one turn however the action is phrased.
 * 3. **Magnitude is capped** per kind (`EFFECT_CAPS`), and over-asking is
 *    trimmed with a note rather than rejected — the same trim-don't-reject
 *    shape as `billConstruction` and `subornLimit`.
 * 4. **It is paid for at issue time**, not on completion. The treasury is
 *    debited when the order goes out, so a payoff cannot exceed what the
 *    faction could actually afford to commission, and an interrupted programme
 *    has real money sunk in it. This is what makes the whole thing an
 *    *investment* rather than a wish.
 *
 * `OrderEffectSchema` itself lives in `state.ts` beside `PendingOrderSchema`,
 * with every other world-state shape. The bounds, the pricing and the
 * application live here.
 */

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** Most a single programme may deliver, whatever it asks for. */
export const EFFECT_CAPS: Record<OrderEffectKind, number> = {
  // Two points is a visible change to a world (14 credits/turn, and enough to
  // carry a 5-value world most of the way to hub status over two programmes)
  // without one order rewriting the economic map.
  develop_system: 2,
  raise_garrison: 5,
  // Permanent capacity, so the tightest cap. A world's defensibility should
  // move over a campaign, not over a turn.
  fortify: 3,
  commission_ships: 12,
};

/**
 * Credits per point of magnitude, charged when the order is issued.
 *
 * Two kinds are absent, both because a flat per-point price would be a second
 * opinion about something already priced elsewhere. `develop_system`'s payoff
 * is not a fixed quantity, so it is priced from what it is actually worth —
 * see `developmentCost`. `commission_ships` delivers hulls, and a hull is
 * billed by displacement at `CREDITS_PER_TON`, the same rate the yards charge
 * in `billConstruction`; anything else would make a construction programme a
 * cheaper shipyard than the shipyard.
 */
export const EFFECT_COST: Record<
  Exclude<OrderEffectKind, 'develop_system' | 'commission_ships'>,
  number
> = {
  // Ground troops are raised locally and normally cost nothing — passive
  // regrowth is free. What is bought here is speed, so the price is small.
  raise_garrison: 15,
  fortify: 45,
};

/**
 * How many turns of the income it creates a development programme costs.
 *
 * This is the whole pricing model for `develop_system`, and it replaced a flat
 * per-point price that was wrong by a factor of twenty-five. The flat price was
 * set against territory income — a point of `strategicValue` pays
 * `INCOME_PER_STRATEGIC_POINT` (7) a turn — and that is indeed what an ordinary
 * point is worth. But `strategicValue` also sets route volume, and at
 * `HUB_THRESHOLD` a world *becomes a trade hub*, which opens a lane to every
 * other hub in the galaxy at once. Measured on the seed, one point is worth
 * between +7 and +209 credits a turn depending entirely on which point it is:
 *
 * ```
 * krayt  kes-7  3->4    +7/turn      an ordinary world getting slightly better
 * hutt   kes-2  9->10  +13/turn      already a hub; more volume on its lanes
 * free   ark-4  6->7   +36/turn      becomes a hub, but a poorly connected one
 * merid  slu-2  6->7  +209/turn      becomes a hub in the middle of everything
 * ```
 *
 * A single price cannot serve that range: at 80 credits a point, a 30-turn
 * reinvestment run took Meridian's net income from 283 to 952 for 1,120 credits
 * of total spend — a payback under two turns, and permanent.
 *
 * So the reducer computes the marginal income of the exact development being
 * proposed, on the actual board, and charges twelve turns of it. Routes are
 * pure and derived, so this is ordinary arithmetic and replays exactly. It
 * needs no tuning constant per case, the way `subornLimit` and `successChance`
 * need none: expensive worlds are expensive because they are worth it.
 */
export const DEVELOPMENT_PAYBACK_TURNS = 12;

/**
 * Floor under a development programme, so improving a worthless backwater is
 * still a real commitment rather than free.
 */
export const MIN_DEVELOPMENT_COST = 80;

/**
 * Which order categories may carry which effect.
 *
 * The eight categories absent from every list here — `courier`, `decree`,
 * `political_maneuver`, `espionage`, `counter_intelligence`, `blockade`,
 * `commerce_raiding`, `treaty_ratification` — carry no payload deliberately,
 * because their effects already live somewhere: espionage lands as
 * `deploy_agent`, ratification as `form_treaty`, and blockade and raiding are
 * read live off `pendingOrders` by `trade.ts` while they run. A payload would
 * be a second, competing mechanism for something that already works.
 */
export const EFFECT_CATEGORIES: Record<OrderEffectKind, readonly DurationCategory[]> = {
  develop_system: ['construction_infrastructure', 'industrial_conversion', 'retooling'],
  raise_garrison: ['garrison_raising', 'fortification'],
  fortify: ['fortification', 'construction_infrastructure'],
  commission_ships: ['capital_ship_construction', 'refit', 'retooling'],
};

/** Kinds this category is allowed to deliver. Empty for the eight above. */
export function effectsAllowedFor(category: DurationCategory): OrderEffectKind[] {
  return (Object.keys(EFFECT_CATEGORIES) as OrderEffectKind[]).filter((kind) =>
    EFFECT_CATEGORIES[kind].includes(category),
  );
}

export function effectAllowedIn(kind: OrderEffectKind, category: DurationCategory): boolean {
  return EFFECT_CATEGORIES[kind].includes(category);
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

/** What a faction's worlds and lanes pay it, which is what development moves. */
function earningsOf(state: WorldState, factionId: string): number {
  const ledger = ledgerFor(state, factionId);
  return ledger.territory + ledger.routes;
}

/**
 * Twelve turns of the income this exact development would create.
 *
 * The hypothetical is a shallow copy with one system's value replaced —
 * `ledgerFor` only reads, so nothing here mutates the board.
 */
export function developmentCost(
  state: WorldState,
  system: StarSystem,
  factionId: string,
  points: number,
): number {
  const raised = Math.min(10, system.strategicValue + points);
  if (raised <= system.strategicValue) return MIN_DEVELOPMENT_COST;

  const hypothetical: WorldState = {
    ...state,
    systems: state.systems.map((s) =>
      s.id === system.id ? { ...s, strategicValue: raised } : s,
    ),
  };
  const gain = earningsOf(hypothetical, factionId) - earningsOf(state, factionId);
  return Math.max(MIN_DEVELOPMENT_COST, Math.round(gain * DEVELOPMENT_PAYBACK_TURNS));
}

/** The bill for a payload, on this board. */
export function priceOrderEffect(
  state: WorldState,
  system: StarSystem,
  factionId: string,
  effect: OrderEffect,
): number {
  if (effect.kind === 'develop_system') {
    return developmentCost(state, system, factionId, effect.magnitude);
  }
  // Hulls are billed by displacement, so a programme for eight escorts costs
  // what eight escorts cost — the same rate the yards charge in
  // `billConstruction`, and the reason nothing has to agree separately about
  // the price of a class.
  if (effect.kind === 'commission_ships') {
    return effect.magnitude * HULL_SPEC[effect.hull].tonnage * CREDITS_PER_TON;
  }
  return effect.magnitude * EFFECT_COST[effect.kind];
}

/* ------------------------------------------------------------------ */
/* The fifth bound: the check the action was resolved against           */
/* ------------------------------------------------------------------ */

/**
 * A payload may not deliver more than the roll earned.
 *
 * The four bounds above are all about *magnitude* — a closed vocabulary, an
 * allowed category, a cap, and a price. None of them knows whether the action
 * that carried the payload actually worked, because `applyOps` has never been
 * told the check: `OUTCOME_GUIDANCE` ("a failure emits the ops for what the
 * attempt COST and NOT the ops for the thing the player wanted") is a promise
 * made in a prompt and nowhere else.
 *
 * Seen live, as Arkanis: a `fortification` action failed its `industry` check,
 * the narrative said the walls stand exactly as thick as they did that morning,
 * and the batch contained both the cost *and* the three-turn order, labelled
 * "(stalled)". That one was harmless because it carried no payload. With one it
 * would not have been — measured on the seed, a `develop_system +1` at slu-2
 * emitted in a batch the player was told was a failure crosses `HUB_THRESHOLD`
 * five turns later and takes Meridian's net income from 309 to **519,
 * permanently**, with zero rejections.
 *
 * This is the same hole as the combat leak and it runs the other way: there the
 * model fabricated losses on a failure, here it banks gains on one. The fix is
 * the same shape — the engine knows the outcome band at the moment it stages,
 * so the arithmetic is applied in code instead of asked for in a prompt.
 *
 * - **failure / critical_failure** — the payload is stripped. The order still
 *   goes out (never dropped: an attack MUST still be issued on a failure, which
 *   is the whole of the combat fix) and delivers nothing when it lands.
 * - **partial** — halved, floored, minimum 1. "A reduced result and a bill" is
 *   what a partial means, and nothing enforced the reduced half.
 * - **success / critical_success** — untouched.
 *
 * Stripping happens *before* the reducer prices the payload, so a stripped
 * payload is never charged for. That is deliberate: the price exists to bound
 * the payoff, and with no payoff there is nothing to bound — charging for a
 * commission that was never placed would invent a cost the player was never
 * quoted. What a failed attempt costs is whatever the resolution call emits for
 * it, which is the mechanism that already exists for exactly that.
 */
export const PARTIAL_PAYLOAD_DIVISOR = 2;

export interface PayloadBounding {
  ops: unknown[];
  /** One line per payload changed, in the same voice as a `billConstruction` trim. */
  notes: string[];
}

export function boundPayloadsToOutcome(
  ops: unknown[],
  outcome: 'critical_success' | 'success' | 'partial' | 'failure' | 'critical_failure',
): PayloadBounding {
  if (outcome === 'success' || outcome === 'critical_success') return { ops, notes: [] };

  const notes: string[] = [];
  const failed = outcome === 'failure' || outcome === 'critical_failure';

  // An operative placed on a failed attempt.
  //
  // This pass bounded `onComplete` payloads and nothing else, so a
  // model-emitted `deploy_agent` sailed through on any band. Reproduced three
  // times: a **natural 1** whose narrative had the courier paraded before a
  // tribunal and the confession broadcast still landed a live, unburned asset
  // at `successChance: 56`; a failed theft granted a permanent 15/turn income
  // drain for an operation the game said bought nothing.
  //
  // `routeCovertAction` states the right rule — "a failed attempt places no
  // operative, the man was caught at the door" — but it only governs whether
  // the engine APPENDS one. On a failure it returns the model's ops untouched.
  // The guard has to live here, in the pass that already knows the band and
  // already runs on the correction batch as well as the first.
  //
  // `partial` places intact: an operative is in place or is not, so there is no
  // magnitude to halve, and a half-placed spy is not a thing the mechanic can
  // express.
  const withoutFailedAgents = failed
    ? ops.filter((op) => {
        const isAgent =
          !!op && typeof op === 'object' && (op as { op?: unknown }).op === 'deploy_agent';
        if (isAgent) {
          notes.push(
            'The attempt failed, so nobody was placed: the operative never reached their posting, and the fee bought nothing.',
          );
        }
        return !isAgent;
      })
    : ops;

  const bounded = withoutFailedAgents.map((op) => {
    if (!op || typeof op !== 'object') return op;
    const o = op as Record<string, unknown>;
    if (o.op !== 'issue_order') return op;
    const effect = o.onComplete as OrderEffect | undefined;
    if (!effect || typeof effect !== 'object' || typeof effect.magnitude !== 'number') return op;

    if (failed) {
      const { onComplete: _dropped, ...rest } = o;
      notes.push(
        `The attempt failed, so the ${String(o.label ?? 'order')} was issued without its programme: ${describeOrderEffect(effect)} is not commissioned and nothing is delivered on completion.`,
      );
      return rest;
    }

    const reduced = Math.max(1, Math.floor(effect.magnitude / PARTIAL_PAYLOAD_DIVISOR));
    if (reduced === effect.magnitude) return op;
    notes.push(
      `A partial result: ${String(o.label ?? 'the order')} delivers ${describeOrderEffect({ ...effect, magnitude: reduced })} rather than ${describeOrderEffect(effect)}.`,
    );
    return { ...o, onComplete: { ...effect, magnitude: reduced } };
  });

  return { ops: bounded, notes };
}

export interface EffectTrim {
  effect: OrderEffect;
  /** What it costs, already computed against this board. */
  cost: number;
  /** Set when the magnitude was reduced, so the reducer can say why. */
  from?: number;
  reason?: 'cap' | 'affordability';
}

/**
 * Trim to the per-kind cap and then to what the treasury can actually pay.
 *
 * Walked down a point at a time rather than divided, because `develop_system`
 * is not priced linearly — the second point of a development can cost many
 * times the first if it is the one that crosses into hub status. Returns `null`
 * only when even a single point is unaffordable, the one case where there is
 * nothing to deliver and a rejection is the honest answer.
 */
export function trimOrderEffect(
  state: WorldState,
  system: StarSystem,
  factionId: string,
  effect: OrderEffect,
  credits: number,
): EffectTrim | null {
  const cap = EFFECT_CAPS[effect.kind];
  let magnitude = Math.min(effect.magnitude, cap);
  let reason: EffectTrim['reason'] = magnitude < effect.magnitude ? 'cap' : undefined;

  while (magnitude >= 1) {
    const cost = priceOrderEffect(state, system, factionId, { ...effect, magnitude });
    if (cost <= credits) {
      return {
        effect: { ...effect, magnitude },
        cost,
        ...(magnitude < effect.magnitude ? { from: effect.magnitude, reason } : {}),
      };
    }
    magnitude -= 1;
    reason = 'affordability';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Description                                                         */
/* ------------------------------------------------------------------ */

/** One clause, for the orders panel, the model's state document and notes. */
export function describeOrderEffect(effect: OrderEffect): string {
  const n = effect.magnitude;
  switch (effect.kind) {
    case 'develop_system':
      return `+${n} strategic value`;
    case 'raise_garrison':
      return `+${n} garrison`;
    case 'fortify':
      return `+${n} garrison capacity`;
    case 'commission_ships':
      return `${n} new ${HULL_SPEC[effect.hull].label}${n === 1 ? '' : 's'}`;
  }
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

export interface EffectOutcome {
  /** A sentence for the event log, the notes and the turn report. */
  note: string;
  /** False when the programme delivered nothing at all. */
  delivered: boolean;
}

/**
 * Apply a completed programme to the world.
 *
 * Called only from the order-completion pass in `tickTurn`, never through
 * `applyOps`, so it cannot be reached by a model op and its hull deliveries are
 * not double-charged by `billConstruction` (which is a post-pass over an
 * `applyOps` batch and never sees this).
 *
 * The split on ownership is deliberate. Concrete and orbital yards are physical
 * and stay where they were poured, so a world that changed hands mid-programme
 * still gets its infrastructure — and whoever holds it now gets the benefit,
 * which is a real risk worth taking on. Levies and crews are people who
 * answered a specific summons: lose the world and there is nobody left to
 * muster.
 */
export function applyOrderEffect(
  system: StarSystem,
  factionId: string,
  effect: OrderEffect,
  label: string,
): EffectOutcome {
  const holder = system.controllerFactionId;
  const stillOurs = holder === factionId;

  switch (effect.kind) {
    case 'develop_system': {
      const before = system.strategicValue;
      system.strategicValue = Math.min(10, before + effect.magnitude);
      const gained = system.strategicValue - before;
      if (gained <= 0) {
        return {
          note: `${label} completed at ${system.name}, but the world is already developed as far as it can be (strategic value ${before}).`,
          delivered: false,
        };
      }
      const whose = stillOurs
        ? ''
        : ` The works now serve ${holder ?? 'nobody in particular'}, who holds the world.`;
      return {
        note: `${label} completed at ${system.name}: strategic value ${before} -> ${system.strategicValue}.${whose}`,
        delivered: true,
      };
    }

    case 'fortify': {
      const before = system.garrisonMax;
      system.garrisonMax = before + effect.magnitude;
      const whose = stillOurs
        ? ''
        : ` The works stand, and they defend ${holder ?? 'whoever takes the world next'}.`;
      return {
        note: `${label} completed at ${system.name}: garrison capacity ${before} -> ${system.garrisonMax}.${whose}`,
        delivered: true,
      };
    }

    case 'raise_garrison': {
      if (!stillOurs) {
        return {
          note: `${label} completed at ${system.name}, but the world is no longer ${factionId}'s and the levy dispersed.`,
          delivered: false,
        };
      }
      const before = system.garrison;
      system.garrison = Math.min(system.garrisonMax, before + effect.magnitude);
      const gained = system.garrison - before;
      if (gained <= 0) {
        return {
          note: `${label} completed at ${system.name}, but its barracks are already full (${before}/${system.garrisonMax}).`,
          delivered: false,
        };
      }
      return {
        note: `${label} completed at ${system.name}: garrison ${before} -> ${system.garrison}.`,
        delivered: true,
      };
    }

    case 'commission_ships': {
      if (!stillOurs) {
        return {
          note: `${label} completed at ${system.name}, but the yards were lost with the world and the hulls with them.`,
          delivered: false,
        };
      }
      addShipsAt(system, factionId, effect.magnitude, effect.hull);
      return {
        note: `${label} completed at ${system.name}: ${describeOrderEffect(effect)} commissioned.`,
        delivered: true,
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Covert action: one act, one mechanism                                */
/* ------------------------------------------------------------------ */

/**
 * Route a declared covert action into the agent mechanic.
 *
 * The same act had two routes with uncoordinated prices. A **deployed**
 * assassination costs 150 credits, counts against the cap, is spent after one
 * attempt, is caught about 45% of the time, and costs the target 35 disposition
 * undetected or 40 exposed — all of that in code. A **declared** "assassinate
 * their raid captain" was priced as an ordinary `guile` check and the resolution
 * call then invented the consequences: measured live, −15 with the victim and
 * −6 with an onlooker, for no credits, against no cap, with no exposure roll.
 * The cheaper route was the one a player reaches by typing a sentence.
 *
 * So a covert declaration now *becomes* a deployment. The arbiter names the
 * mission and the place; if the resolution call did not emit the
 * `deploy_agent` itself, one is appended here from that ruling. There is then
 * exactly one path: charged by `AGENT_COST`, held to `maxAgentsFor`, resolved
 * on the tick against the same seeded d20, exposed on the same ladder.
 *
 * **Only on an outcome that placed something.** A failed attempt places no
 * operative — the man was caught at the door — so nothing is appended and
 * whatever the resolution call emitted for the cost stands. That is the same
 * rule `boundPayloadsToOutcome` applies to a works payload, for the same reason.
 */
export interface CovertRouting {
  ops: unknown[];
  notes: string[];
}

export function routeCovertAction(
  ops: unknown[],
  outcome: 'critical_success' | 'success' | 'partial' | 'failure' | 'critical_failure',
  covert: { mission: AgentMission; systemId: string } | null | undefined,
  actor: string,
): CovertRouting {
  if (!covert) return { ops, notes: [] };
  // A failure places nobody. The attempt still cost whatever it cost.
  if (outcome === 'failure' || outcome === 'critical_failure') return { ops, notes: [] };

  const alreadyPlaced = ops.some(
    (op) =>
      !!op &&
      typeof op === 'object' &&
      (op as { op?: unknown }).op === 'deploy_agent',
  );
  if (alreadyPlaced) return { ops, notes: [] };

  return {
    ops: [
      ...ops,
      {
        op: 'deploy_agent',
        ownerFactionId: actor,
        systemId: covert.systemId,
        mission: covert.mission,
        effect: DEFAULT_COVERT_EFFECT[covert.mission],
        cover: 'placed by a covert operation the arbiter ruled on',
      },
    ],
    notes: [
      `Covert work is run by operatives: a ${covert.mission} agent was placed at ${covert.systemId}, charged and capped like any other. It resolves on the tick.`,
    ],
  };
}
