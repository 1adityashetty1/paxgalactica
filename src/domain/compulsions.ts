import {
  isGuestOf,
  isMovementType,
  ledgerFor,
  warsFor,
  type CompulsionTrigger,
  type WorldState,
} from './state.js';

/**
 * Compulsions that a faction is currently failing to honour.
 *
 * ## Why this exists
 *
 * Red lines and compulsions had one enforcement path between them: the
 * resolution call returning a `refusal` for a declared action. That covers a
 * prohibition perfectly well — declare a raid, get refused — and cannot cover a
 * demand at all, because a refusal needs an action to refuse. A player who
 * simply never acts is never noticed.
 *
 * So four lines in the seed were dead on arrival. They promised consequences
 * for the passage of time — the Iron Vigil's officer corps answering an insult
 * "without you", the Drajk captains taking their ships elsewhere after "a
 * stretch of quiet", Meridian's Trade Council calling a vote of no confidence
 * over "an unprofitable quarter" — and nothing in the game measured time,
 * income or idleness against a faction's character. They read as rules and were
 * decoration.
 *
 * ## How it works
 *
 * Each trigger is a pure predicate on world state, evaluated once per faction
 * per turn in `tickTurn`. Three consequences follow from that shape:
 *
 * - **It replays exactly.** No history, no clock, no dice.
 * - **A "stretch" needs nothing to count it.** The predicate is simply true
 *   again next turn, so neglect accumulates by repetition and stops the moment
 *   the faction complies — which is the behaviour the flavour text described.
 * - **It applies to everyone.** `tickTurn` walks every faction, so this is the
 *   first mechanism in the game that holds an NPC to its own character.
 *   Refusals only ever reached the player, because `ReactionSchema` has no
 *   `refusal` field, which left four of five powers free to act completely
 *   against type with no cost at all.
 */

export interface CompulsionDrift {
  /** The compulsion being ignored, quoted for the event log. */
  text: string;
  trigger: CompulsionTrigger;
  /** One clause naming what was observed, so the charge is never mysterious. */
  why: string;
}

/** Does this faction have a fleet under way? */
function hasFleetUnderWay(state: WorldState, factionId: string): boolean {
  return state.pendingOrders.some((o) => o.factionId === factionId && isMovementType(o.type));
}

/** Worlds this faction holds that a rival is sitting on, guests excepted. */
function incursions(state: WorldState, factionId: string): string[] {
  return state.systems
    .filter(
      (system) =>
        system.controllerFactionId === factionId &&
        Object.entries(system.ships).some(
          ([id, n]) => n > 0 && id !== factionId && !isGuestOf(state, id, factionId),
        ),
    )
    .map((system) => system.name);
}

/**
 * Evaluate one trigger. Returns the reason it fired, or null.
 *
 * Every branch reports what it actually saw rather than restating the rule:
 * "at war with vigil and no fleet under way" is something a player can act on,
 * where "compulsion violated" is not.
 */
function evaluate(
  state: WorldState,
  factionId: string,
  trigger: CompulsionTrigger,
): string | null {
  switch (trigger) {
    case 'unprofitable': {
      const net = ledgerFor(state, factionId).net;
      return net <= 0 ? `net income is ${net}` : null;
    }

    case 'idle_at_war': {
      const enemies = warsFor(state, factionId);
      if (enemies.length === 0) return null;
      if (hasFleetUnderWay(state, factionId)) return null;
      return `at war with ${enemies.join(', ')} and no fleet under way`;
    }

    case 'unanswered_incursion': {
      const trespassed = incursions(state, factionId);
      if (trespassed.length === 0) return null;
      if (hasFleetUnderWay(state, factionId)) return null;
      return `foreign ships over ${trespassed.join(', ')} and nothing sent to answer them`;
    }

    case 'no_plunder': {
      const raiding = state.pendingOrders.some(
        (o) => o.factionId === factionId && o.type === 'commerce_raiding',
      );
      if (raiding) return null;
      const taken = ledgerFor(state, factionId).raided;
      return taken > 0 ? null : 'no raid under way and nothing taken from anyone';
    }
  }
}

/**
 * Every compulsion this faction is currently drifting from.
 *
 * A compulsion with no trigger never appears here — it is enforced the original
 * way, by refusal, and this is only the case a refusal cannot reach.
 */
export function driftingCompulsions(state: WorldState, factionId: string): CompulsionDrift[] {
  const faction = state.factions.find((f) => f.id === factionId);
  if (!faction) return [];

  const drifting: CompulsionDrift[] = [];
  for (const compulsion of faction.compulsions) {
    if (!compulsion.trigger) continue;
    const why = evaluate(state, factionId, compulsion.trigger);
    if (why !== null) {
      drifting.push({ text: compulsion.text, trigger: compulsion.trigger, why });
    }
  }
  return drifting;
}
