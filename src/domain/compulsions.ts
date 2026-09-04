import { delinquentDebtorsOf } from './debt.js';
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

/**
 * Which list a quoted principle actually appears on — decided here, in code,
 * from the faction sheet, rather than taken from the arbiter's own label.
 *
 * Found in a live Iron Vigil playtest, and it is the same failure the arbiter
 * rework was built to close, one door along. Asked to retain Nar smuggler
 * captains as informants, the arbiter quoted the right line —
 * *"no accommodation with pirates, smugglers or the Nars may be entertained"* —
 * and then got both halves of the ruling wrong: it called that line "a red
 * line, not a compulsion" when the seed carries it in `compulsions`, and it
 * returned the whole thing as `admissible: false`, which is the one exit in the
 * game that charges **nothing at all**. No dissent, no ops, no record. A
 * compulsion worth 25 dissent and a landed order became a free no-op.
 *
 * The lesson is the one this codebase keeps relearning: a classification a
 * model states is a classification that drifts. The model is good at the part
 * that needs judgement — *which line does this action touch* — and needless at
 * the part that is a lookup. So it names the line and code does the lookup:
 *
 * - `kind` is derived from the list the line is actually on, and the model's
 *   own label is discarded.
 * - A principle that matches **nothing** on the sheet is not a breach at all.
 *   An invented line costs the player nothing, because there is nothing there
 *   to have broken.
 *
 * Matching is deliberately loose in one direction only: the arbiter is asked to
 * quote, and it mostly does, but it truncates, re-punctuates and drops trailing
 * clauses. Containment either way catches that, and a token-overlap fallback
 * catches a light paraphrase. It is never loose enough to match a *different*
 * line, because the five factions' lines have almost nothing in common.
 */
export type PrincipleKind = 'red_line' | 'compulsion';

export interface ClassifiedPrinciple {
  kind: PrincipleKind;
  /** The line as the sheet states it, not as it was quoted back. */
  principle: string;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'its', 'that',
  'this', 'be', 'as', 'at', 'by', 'for', 'on', 'with', 'not', 'no', 'will',
  'must', 'may', 'any', 'are', 'was', 'has', 'have', 'what', 'whatever',
]);

function contentTokens(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
}

/** How much of the sheet's line the quote actually reproduces, 0–1. */
function overlap(quoted: string, actual: string): number {
  const a = contentTokens(actual);
  if (a.size === 0) return 0;
  const q = contentTokens(quoted);
  let hit = 0;
  for (const word of a) if (q.has(word)) hit += 1;
  return hit / a.size;
}

/** Enough shared content to be the same line, in either direction. */
const PRINCIPLE_MATCH_THRESHOLD = 0.6;

function matches(quoted: string, actual: string): boolean {
  const q = normalize(quoted);
  const a = normalize(actual);
  if (q.length === 0 || a.length === 0) return false;
  if (q.includes(a) || a.includes(q)) return true;
  return overlap(quoted, actual) >= PRINCIPLE_MATCH_THRESHOLD;
}

/**
 * Find a quoted principle on a faction's sheet, and say which kind it is.
 *
 * Red lines are checked first: a line that somehow appeared on both lists is
 * the absolute reading, because under-charging a red line (letting an act
 * through for 25) is a worse error than over-charging a compulsion.
 */
export function classifyPrinciple(
  faction: { redLines: string[]; compulsions: { text: string }[] },
  quoted: string,
): ClassifiedPrinciple | null {
  for (const line of faction.redLines) {
    if (matches(quoted, line)) return { kind: 'red_line', principle: line };
  }
  for (const c of faction.compulsions) {
    if (matches(quoted, c.text)) return { kind: 'compulsion', principle: c.text };
  }
  return null;
}

/**
 * The most severe principle among several the arbiter named.
 *
 * An action can touch more than one line, and which one gets quoted decides
 * what happens — so leaving it to whichever came to mind first made the outcome
 * arbitrary. Measured live: forgiving a debt as the Ojjul Nar was returned
 * against *"every favour carries a price"* (a compulsion: pay 15 and it lands)
 * and never against *"will not forgive an unpaid debt"* (a red line: blocked),
 * which is the more apposite of the two and is the whole instrument the faction
 * is built on.
 *
 * A red line therefore wins over a compulsion whenever both are named. The
 * asymmetry is deliberate: under-charging a red line lets an absolute act
 * through for 15, while over-charging a compulsion merely blocks something the
 * player could have bought. The first is a hole; the second is a ruling they
 * can argue with.
 */
export function classifyPrinciples(
  faction: { redLines: string[]; compulsions: { text: string }[] },
  quotes: string[],
): ClassifiedPrinciple | null {
  let compulsion: ClassifiedPrinciple | null = null;
  for (const quote of quotes) {
    const found = classifyPrinciple(faction, quote);
    if (found?.kind === 'red_line') return found;
    if (found && !compulsion) compulsion = found;
  }
  return compulsion;
}

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
    case 'debt_unpursued': {
      // A creditor whose debtor has defaulted and who has done nothing about
      // it. "Pursued" is read as any pressure actually applied to that debtor:
      // a fleet under way toward one of their worlds, or an operative placed in
      // their space. Diplomacy is deliberately not enough — the line is about a
      // client who has already learned that owing you costs nothing.
      const defaulters = delinquentDebtorsOf(state.debts ?? [], factionId);
      if (defaulters.length === 0) return null;

      const unpursued = defaulters.filter((debtorId) => {
        const theirWorlds = new Set(
          state.systems.filter((sys) => sys.controllerFactionId === debtorId).map((sys) => sys.id),
        );
        const fleetSent = state.pendingOrders.some(
          (o) => o.factionId === factionId && isMovementType(o.type) && theirWorlds.has(o.targetId),
        );
        const agentPlaced = state.agents.some(
          (a) => a.ownerFactionId === factionId && !a.exposed && theirWorlds.has(a.systemId),
        );
        return !fleetSent && !agentPlaced;
      });

      return unpursued.length > 0
        ? `${unpursued.join(', ')} owe you and have defaulted, and nothing has been sent`
        : null;
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

/**
 * Is a compulsion the arbiter says was breached actually being breached?
 *
 * A compulsion may carry a **trigger** — a pure predicate on world state — and
 * that gives the game two enforcement paths for one line: a model judging a
 * breach from the prose of an accord, and code evaluating the predicate. They
 * can disagree, and measured live they did: a player was charged
 * `COMPULSION_BREACH_DISSENT` for *"the captains require plunder: no raid under
 * way and nothing taken from anyone"* at a moment when a `commerce_raiding`
 * order was staged and six hulls were in transit to storm a world. The code's
 * own `no_plunder` predicate evaluates **false** on that board.
 *
 * `verifyBreachRelevance` cannot catch it by construction — it is shown the act
 * and the line and deliberately nothing else, no state — so it cannot know a
 * state-dependent compulsion is factually inapplicable.
 *
 * Returns `false` only when the faction is demonstrably complying: the line has
 * a trigger and that trigger is not firing. A compulsion with no trigger is not
 * a state question and is left entirely to the ruling, which is the case
 * refusal was built for.
 */
export function breachContradictsState(
  state: WorldState,
  factionId: string,
  principle: string,
): boolean {
  const faction = state.factions.find((f) => f.id === factionId);
  if (!faction) return false;

  const line = faction.compulsions.find((c) => matches(principle, c.text));
  if (!line?.trigger) return false;

  return evaluate(state, factionId, line.trigger) === null;
}
