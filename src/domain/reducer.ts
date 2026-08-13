import {
  accelerationCost,
  applyCategoryFloor,
  dropOneBucket,
  isFibScale,
  toFibBucket,
  type DurationCategory,
  type FibScale,
} from './duration.js';
import { conflictingCommitment, MAX_COMMITMENT_INCOME } from './arbitration.js';
import { driftingCompulsions } from './compulsions.js';
import { rollD20, statModifier } from './checks.js';
import {
  applyOrderEffect,
  describeOrderEffect,
  effectAllowedIn,
  effectsAllowedFor,
  priceOrderEffect,
  trimOrderEffect,
} from './development.js';
import {
  AGENT_COST,
  MISSION_PROFILE,
  PACT_BREAKING_REPUTATION_COST,
  PEACE_TREATIES,
  treatyBetween,
} from './diplomacy.js';
import { jumpsBetween, neighboursOf, positionAlongPath, shortestPath } from './graph.js';
import { routeEarnings, tradeRoutes } from './trade.js';
import {
  OpSchema,
  REDUCER_ONLY_OPS,
  type Op,
  type OpRejection,
} from './ops.js';
import {
  effectiveStats,
  fleetBases,
  fleetStrengthOf,
  canSubornAt,
  COMPULSION_DRIFT_DISSENT,
  DEFENSIVE_GARRISON_BONUS,
  OPPORTUNIST_MIGHT_BONUS,
  warsFor,
  DOCTRINE_CHANGE_DISSENT_CEILING,
  DOCTRINE_ETHIC_DISSENT,
  DOCTRINE_TEXT_DISSENT,
  getSystem,
  MAX_NARRATIVE_CREDITS,
  isMovementType,
  ledgerFor,
  liveAgentsOf,
  maxAgentsFor,
  subornLimit,
  SHIP_COST,
  UPKEEP_PER_FLEET_POINT,
  type EventLogEntry,
  type Ledger,
  type OrderEffect,
  type PendingOrder,
  type WorldState,
} from './state.js';

export type OpSource = 'model' | 'engine';

/** Ground forces rebuilt per turn, toward the system's ceiling. */
export const GARRISON_REGROWTH = 1;

/** Dissent bled off per quiet turn. Refusals add 8, so defiance compounds. */
export const DISSENT_DECAY = 2;

/**
 * Ceiling on how much of a navy can be laid up in one turn when a faction
 * cannot pay its upkeep, as a fraction of the fleet. Without a cap an
 * overbuilt navy evaporates in a single tick; with it, insolvency is a
 * visible decline the player can react to over several turns.
 */
export const MAX_ATTRITION_FRACTION = 0.15;

/**
 * The most of its own fleet a faction can lose to one declared action.
 *
 * A deliberate scuttling or a costly accident is legitimate narrative; losing
 * the entire navy because a single `might` check came up 3 is the resolution
 * call resolving a battle it does not get to resolve. See
 * `capSelfInflictedLosses`.
 */
export const MAX_SELF_INFLICTED_LOSS_FRACTION = 0.25;

/**
 * Orders that interdict trade rather than build or move anything.
 *
 * These are the only order types that require a fleet already sitting on the
 * target. You cannot blockade a world by decree: the ships have to be there,
 * which also means they can be attacked, which is what stops interdiction
 * being free money. `trade.ts` reads these orders straight off `pendingOrders`.
 */
export const INTERDICTION_TYPES = new Set(['blockade', 'commerce_raiding']);

/**
 * Where the fleet sustaining an interdiction order has to be.
 *
 * A **blockade** sits on the system: you are physically closing the lane, so
 * you must hold the orbitals. A **raid** does not — you lurk one jump out and
 * hit the convoys, which is why an adjacent system counts.
 *
 * The distinction is load-bearing. Requiring raiders to be *in* the target
 * meant they had to defeat its defenders first, which made commerce raiding
 * something only the strong could do to the weak — the precise inversion of
 * what it is for. Drajk's whole doctrine is raiding the rich, and the rich are
 * exactly who it cannot beat in orbit.
 */
export function interdictionStations(
  state: WorldState,
  order: { type: string; targetId: string; factionId: string },
): number {
  const at = state.systems.find((s) => s.id === order.targetId)?.ships[order.factionId] ?? 0;
  if (order.type === 'blockade') return at;
  const nearby = neighboursOf(state, order.targetId).reduce(
    (n, id) => n + (state.systems.find((s) => s.id === id)?.ships[order.factionId] ?? 0),
    0,
  );
  return at + nearby;
}

/** Disposition lost per turn by the faction whose trade you are strangling. */
export const INTERDICTION_DISPOSITION_COST = 4;

/**
 * What every OTHER power's opinion drops by, per turn, when a faction that is
 * not a smuggler raids commerce.
 *
 * Raiding is available to anyone — a cornered power turning pirate is a real
 * strategic story and should not be impossible. But it is the Drajk
 * Confederacy's declared trade ("raid the rich, vanish into the deep lanes"),
 * and everyone expects it of them. An Imperial remnant doing the same thing is
 * news. Together with the halved yield for non-smugglers, this is what keeps
 * raiding a Drajk mechanic in practice without hard-coding a ban that the
 * faction's own red lines already express better.
 */
export const PIRACY_REPUTATION_COST = 2;

/**
 * What the victim's opinion drops by per hull talked out of its service, and
 * what every onlooker's drops by for the act itself.
 *
 * Matches the `defection` agent mission, so the two routes to the same outcome
 * cost the same. Inducing mutiny is a recognised dirty trick: it avoids a
 * battle, and the bill arrives in diplomacy instead.
 */
export const SUBORN_DISPOSITION_COST = 6;
export const SUBORN_REPUTATION_COST = 2;

/**
 * Disposition lost per turn, per payer, by a power levying transit tolls.
 *
 * The extortionist ran away with the balance harness — 302 credits a turn and
 * a treasury nobody could touch — precisely because tolling cost it nothing.
 * Squeezing every cargo that crosses your space is not a neutral act, and the
 * self-correction is the right one thematically: the Combine gets rich, and
 * everyone it taxes gradually decides something should be done about it.
 *
 * Deliberately smaller than raiding or blockading. A toll is a grievance, not
 * an outrage; it accumulates.
 */
export const TOLL_RESENTMENT = 1;

export interface ApplyResult {
  state: WorldState;
  rejections: OpRejection[];
  /** Human-readable record of discards, clamps and arrivals. */
  notes: string[];
}

/**
 * The world state is a JSON document by definition (it is Zod-validated on
 * load and save), so a JSON round-trip is an exact deep clone here. Keeping
 * the reducer pure matters more than the marginal speed of a structural clone.
 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const nameFor = (state: WorldState, id: string): string =>
  state.factions.find((f) => f.id === id)?.name ?? id;

function logEvent(
  state: WorldState,
  kind: EventLogEntry['kind'],
  text: string,
  factionId: string | null = null,
): void {
  state.eventLog.push({ turn: state.turn, kind, factionId, text });
}

/**
 * Deterministic order ids. Replay must produce byte-identical state, so ids
 * are derived from the turn plus a per-turn sequence, never from a clock or
 * random source.
 */
function mintOrderId(state: WorldState): string {
  const prefix = `ord-${state.turn}-`;
  // Take one past the highest suffix in use rather than counting orders: a
  // count would collide after a cancellation, and would double-count within a
  // batch because each new order is pushed before the next id is minted.
  let highest = -1;
  for (const order of state.pendingOrders) {
    if (!order.id.startsWith(prefix)) continue;
    const suffix = Number.parseInt(order.id.slice(prefix.length), 10);
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}${highest + 1}`;
}

/** Deterministic ids for treaties and agents, on the same scheme as orders. */
function mintId(state: WorldState, prefix: string): string {
  const stem = `${prefix}-${state.turn}-`;
  const pool = [
    ...state.treaties.map((t) => t.id),
    ...state.agents.map((a) => a.id),
    ...(state.commitments ?? []).map((c) => c.id),
  ];
  let highest = -1;
  for (const id of pool) {
    if (!id.startsWith(stem)) continue;
    const n = Number.parseInt(id.slice(stem.length), 10);
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return `${stem}${highest + 1}`;
}

/**
 * An agent's per-turn odds, from the owner's guile against the target's
 * counter-intelligence. Computed in code so a model cannot talk its spy into
 * being better than its faction is.
 */
export function agentSuccessChance(guile: number, counterIntel: number): number {
  return Math.max(5, Math.min(95, 50 + (guile - counterIntel) * 6));
}

/**
 * Take `count` hulls off a faction, largest concentration first.
 *
 * Deterministic by construction — ties break on system id — because replay
 * must reproduce which worlds were stripped, not merely how many hulls were
 * lost. Returns how many were actually removed, which is less than asked for
 * when the faction has fewer ships in systems than the caller believed
 * (hulls in transit are untouchable: they are nowhere to be taken from).
 */
function removeShips(
  state: WorldState,
  factionId: string,
  count: number,
  exceptSystemId?: string,
): number {
  let owed = count;
  const bases = [...state.systems]
    .filter((s) => s.id !== exceptSystemId && (s.ships[factionId] ?? 0) > 0)
    .sort((a, b) => (b.ships[factionId] ?? 0) - (a.ships[factionId] ?? 0) || a.id.localeCompare(b.id));
  for (const base of bases) {
    if (owed <= 0) break;
    const here = base.ships[factionId] ?? 0;
    const take = Math.min(here, owed);
    if (here - take === 0) delete base.ships[factionId];
    else base.ships[factionId] = here - take;
    owed -= take;
  }
  return count - owed;
}

/**
 * The single entry point for state change. Pure: the input state is never
 * mutated, and the same (state, ops) always yields the same result.
 *
 * Invalid ops are collected as structured rejections and returned — never
 * silently dropped — so the caller can feed them back to the model on retry.
 */
export function applyOps(
  input: WorldState,
  rawOps: unknown[],
  source: OpSource = 'model',
  /**
   * Whose ops these are. Needed because some guards depend on WHO is asking,
   * not merely on whether a model asked — you may move your own ships freely
   * and another power's only where you are present and only as far as guile
   * beats their resolve. Omitted for engine ops and for journals written
   * before the field existed, in which case the guard does not apply and
   * replay reproduces exactly what happened.
   */
  actor?: string,
): ApplyResult {
  const state = clone(input);
  const rejections: OpRejection[] = [];
  const notes: string[] = [];

  const reject = (op: unknown, code: OpRejection['code'], message: string): void => {
    rejections.push({ op, code, message });
    logEvent(state, 'rejection', `[${code}] ${message}`);
  };

  const factionExists = (id: string): boolean => state.factions.some((f) => f.id === id);
  const systemExists = (id: string): boolean => state.systems.some((s) => s.id === id);

  // Hull counts before anything is applied, so new construction can be billed
  // afterwards. Counted per faction across the whole batch rather than per op,
  // which is what makes repositioning free: `adjust_ships -5` here and `+5`
  // there nets to zero and costs nothing, however the ops are ordered.
  const hullsBefore = new Map(state.factions.map((f) => [f.id, fleetStrengthOf(state, f.id)]));

  for (const raw of rawOps) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      const opName =
        raw && typeof raw === 'object' && 'op' in raw ? String((raw as { op: unknown }).op) : '(none)';
      const known = OpSchema.options.some(
        (o) => o.shape.op.value === opName,
      );
      reject(
        raw,
        known ? 'schema_invalid' : 'unknown_op',
        known
          ? `Op "${opName}" failed validation: ${parsed.error.issues
              .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
              .join('; ')}`
          : `Unknown op "${opName}". Valid ops: ${OpSchema.options
              .map((o) => o.shape.op.value)
              .join(', ')}.`,
      );
      continue;
    }

    const op: Op = parsed.data;

    if (source === 'model' && REDUCER_ONLY_OPS.has(op.op)) {
      reject(
        raw,
        'reducer_only',
        `"${op.op}" is reducer-only. Control of a system changes only when a fleet_movement order actually arrives. Issue a fleet_movement order instead.`,
      );
      continue;
    }

    switch (op.op) {
      case 'transfer_control': {
        const sys = state.systems.find((s) => s.id === op.systemId);
        if (!sys) {
          reject(raw, 'unknown_system', `No system "${op.systemId}".`);
          break;
        }
        if (op.toFactionId !== null && !factionExists(op.toFactionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.toFactionId}".`);
          break;
        }
        const from = sys.controllerFactionId ?? 'nobody';
        sys.controllerFactionId = op.toFactionId;
        logEvent(
          state,
          'order',
          `${sys.name} passes from ${from} to ${op.toFactionId ?? 'nobody'}. ${op.reason}`.trim(),
          op.toFactionId,
        );
        break;
      }

      case 'adjust_disposition': {
        const f = state.factions.find((x) => x.id === op.factionId);
        if (!f) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        if (!factionExists(op.towardFactionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.towardFactionId}".`);
          break;
        }
        if (op.factionId === op.towardFactionId) {
          reject(raw, 'illegal_value', `A faction cannot hold a disposition toward itself.`);
          break;
        }
        const before = f.disposition[op.towardFactionId] ?? 0;
        const after = Math.max(-100, Math.min(100, before + op.delta));
        f.disposition[op.towardFactionId] = after;
        break;
      }

      case 'adjust_fleet': {
        if (!factionExists(op.factionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        // Hulls belonging to somebody else are not yours to delete. Taking a
        // rival's ships goes through `adjust_ships` (suborning: presence and a
        // guile-vs-resolve limit) or through combat; there is no path where a
        // narrative call simply erases another power's navy. `adjust_ships`
        // has been guarded this way since the suborn work — `adjust_fleet`
        // was not, and it is the *untargeted* op, which makes it strictly
        // worse: it draws from the victim's largest concentrations galaxy-wide.
        if (actor !== undefined && op.factionId !== actor && op.delta < 0) {
          reject(
            raw,
            'reducer_only',
            `${actor} cannot destroy ${op.factionId}'s ships directly. Losses come from combat when a fleet_movement arrives, or from suborning crews with adjust_ships.`,
          );
          break;
        }
        // Ships have to exist somewhere. With no system named, new hulls
        // commission at the faction's most valuable holding and losses are
        // drawn from its largest concentrations — deterministic either way.
        const bases = fleetBases(state, op.factionId);
        if (bases.length === 0) {
          reject(raw, 'illegal_value', `${op.factionId} holds no system to base ships at.`);
          break;
        }
        if (op.delta >= 0) {
          const home = bases[0]!;
          home.ships[op.factionId] = (home.ships[op.factionId] ?? 0) + op.delta;
        } else {
          let owed = -op.delta;
          for (const base of [...bases].sort(
            (a, b) => (b.ships[op.factionId] ?? 0) - (a.ships[op.factionId] ?? 0) || a.id.localeCompare(b.id),
          )) {
            if (owed <= 0) break;
            const here = base.ships[op.factionId] ?? 0;
            const take = Math.min(here, owed);
            if (take <= 0) continue;
            if (here - take === 0) delete base.ships[op.factionId];
            else base.ships[op.factionId] = here - take;
            owed -= take;
          }
        }
        break;
      }

      case 'adjust_credits': {
        const f = state.factions.find((x) => x.id === op.factionId);
        if (!f) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        // Taking another power's money is not something a sentence can do. The
        // same shape as the `adjust_fleet` guard: there are mechanisms for this
        // — an `income_penalty` agent, an extortionist's toll, commerce raiding
        // — and all of them cost something. Paying someone is still allowed,
        // because nothing needs protecting from a faction giving money away.
        if (actor !== undefined && op.factionId !== actor && op.delta < 0) {
          reject(
            raw,
            'illegal_value',
            `${actor} cannot take credits out of ${op.factionId}'s treasury directly. Skim it with an agent on an income_penalty mission, toll it, or raid its lanes.`,
          );
          break;
        }
        // Narrative money is capped. Every large movement of credits has a
        // mechanism that owns its price and debits the treasury itself, so an
        // `adjust_credits` this big is either duplicating one of those or
        // inventing a sum outright — a failed action once charged 380 for
        // nothing, and a priced 156-credit programme arrived with a freeform
        // 180 riding alongside it.
        let delta = op.delta;
        if (actor !== undefined && Math.abs(delta) > MAX_NARRATIVE_CREDITS) {
          const trimmed = Math.sign(delta) * MAX_NARRATIVE_CREDITS;
          const note = `Trimmed a ${delta > 0 ? 'windfall' : 'charge'} of ${Math.abs(delta)} credits to ${MAX_NARRATIVE_CREDITS} for ${nameFor(state, op.factionId)}; sums past that belong to a mechanic that prices them.`;
          notes.push(note);
          logEvent(state, 'clamp', note, op.factionId);
          delta = trimmed;
        }
        f.credits = Math.max(0, f.credits + delta);
        break;
      }

      case 'adjust_dissent': {
        const f = state.factions.find((x) => x.id === op.factionId);
        if (!f) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        // Dissent is a power's relationship with its OWN institutions, and it
        // is worth `MAX_DISSENT_PENALTY` off every stat at the top — the
        // largest debuff in the game. Unguarded, one batch could set a rival to
        // 100 with no roll, no presence and no cost, which is both the cheapest
        // hostile act available and a straight bypass of the agent route that
        // exists to do exactly this for credits, at risk, under a cap.
        if (actor !== undefined && op.factionId !== actor) {
          reject(
            raw,
            'illegal_value',
            `${actor} cannot move ${op.factionId}'s internal dissent. Turning a rival's institutions against it is an operative's work — deploy an agent on a subversion mission with a stat_debuff effect.`,
          );
          break;
        }
        // Raising your own costs nothing to allow: nothing needs protecting
        // from a faction choosing to be less governable. LOWERING it is the
        // exploit — without this, the same call that earns a refusal can erase
        // the penalty it just earned, and the whole mechanic becomes optional.
        // Standing is repaired by governing in character while `DISSENT_DECAY`
        // does its work, which is the pace the number was tuned for.
        if (actor !== undefined && op.delta < 0) {
          reject(
            raw,
            'illegal_value',
            `Dissent cannot be talked down. It falls ${DISSENT_DECAY} a turn on its own, and only by governing in character; ${f.name} is at ${f.dissent}/100.`,
          );
          break;
        }
        f.dissent = Math.max(0, Math.min(100, f.dissent + op.delta));
        break;
      }

      case 'set_doctrine': {
        const f = state.factions.find((x) => x.id === op.factionId);
        if (!f) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        // A power's character is its own. Rewriting a rival's doctrine reaches
        // straight into the persona its diplomacy and reactions are built from,
        // which is the same hazard `deploy_agent` validates its owner against.
        // `actor === undefined` means an engine op or a journal written before
        // this guard, and those replay exactly as they originally ran.
        if (actor !== undefined && op.factionId !== actor) {
          reject(
            raw,
            'illegal_value',
            `${actor} cannot rewrite ${op.factionId}'s doctrine. A power changes its own posture, and pays its own institutions for it.`,
          );
          break;
        }
        if (actor !== undefined && f.dissent >= DOCTRINE_CHANGE_DISSENT_CEILING) {
          reject(
            raw,
            'doctrine_refusal',
            `${f.name} sits at ${f.dissent} dissent. Institutions this far past trusting their leadership will not be redefined by it — govern in character until dissent falls below ${DOCTRINE_CHANGE_DISSENT_CEILING}.`,
          );
          break;
        }

        // Priced per axis actually moved. Restating the same posture in new
        // words costs nothing, so a model cannot farm dissent — or dodge it by
        // splitting one turn across several ops.
        const changed: string[] = [];
        let cost = 0;
        if (op.doctrine !== f.doctrine) {
          cost += DOCTRINE_TEXT_DISSENT;
          changed.push('a new statement of posture');
        }
        if (op.warEthic && op.warEthic !== f.warEthic) {
          changed.push(`war ${f.warEthic} -> ${op.warEthic}`);
          f.warEthic = op.warEthic;
          cost += DOCTRINE_ETHIC_DISSENT;
        }
        if (op.tradeEthic && op.tradeEthic !== f.tradeEthic) {
          changed.push(`trade ${f.tradeEthic} -> ${op.tradeEthic}`);
          f.tradeEthic = op.tradeEthic;
          cost += DOCTRINE_ETHIC_DISSENT;
        }
        f.doctrine = op.doctrine;

        if (actor !== undefined && cost > 0) {
          f.dissent = Math.max(0, Math.min(100, f.dissent + cost));
          const note = `${f.name} changes course (${changed.join('; ')}). Dissent +${cost}, now ${f.dissent}/100.`;
          notes.push(note);
          logEvent(state, 'system', note, f.id);
        }
        break;
      }

      case 'issue_order': {
        if (!factionExists(op.factionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        if (!systemExists(op.originId)) {
          reject(raw, 'unknown_system', `No origin system "${op.originId}".`);
          break;
        }
        if (!systemExists(op.targetId)) {
          reject(raw, 'unknown_system', `No target system "${op.targetId}".`);
          break;
        }

        // A works programme is validated HERE, before anything is mutated, and
        // paid for further down once every other rejection has been ruled out.
        // Charging earlier would take credits for an order that a later check
        // refuses to create; charging later, on completion, would let a faction
        // commission works it could never afford.
        if (op.onComplete) {
          if (isMovementType(op.type)) {
            reject(
              raw,
              'illegal_value',
              `A ${op.type} order carries ships, not a works programme; what it delivers is decided by the battle on arrival.`,
            );
            break;
          }
          // You can only build where you stand. Without this, a faction could
          // commission works on a rival's world — priced at the floor, because
          // the marginal income to the *actor* is nothing, while the rival kept
          // the improvement. Presence or ownership, the same line interdiction
          // and suborning draw.
          const site = state.systems.find((sys) => sys.id === op.targetId)!;
          const holds = site.controllerFactionId === op.factionId;
          const present = (site.ships[op.factionId] ?? 0) > 0;
          if (!holds && !present) {
            reject(
              raw,
              'no_presence',
              `${op.factionId} neither holds ${site.name} nor has ships there; a works programme needs the world, or at least a fleet over it.`,
            );
            break;
          }
          const category = op.type as DurationCategory;
          if (!effectAllowedIn(op.onComplete.kind, category)) {
            const allowed = effectsAllowedFor(category);
            reject(
              raw,
              'illegal_value',
              allowed.length === 0
                ? `Order type "${category}" cannot deliver "${op.onComplete.kind}", or any other works: its effect belongs in a different op (an agent, a treaty) or is read while it runs.`
                : `Order type "${category}" cannot deliver "${op.onComplete.kind}". It can deliver: ${allowed.join(', ')}.`,
            );
            break;
          }
        }

        if (INTERDICTION_TYPES.has(op.type)) {
          // Interdiction is done by ships, not by proclamation.
          if (interdictionStations(state, op) <= 0) {
            reject(
              raw,
              'illegal_value',
              op.type === 'blockade'
                ? `${op.factionId} has no ships at ${op.targetId}; a blockade must sit on the system it closes.`
                : `${op.factionId} has no ships at ${op.targetId} or any system adjacent to it; a raiding squadron must be within one jump of the lane it preys on.`,
            );
            break;
          }
        }

        let duration: number;
        let rationale = op.durationRationale;
        let path: string[] = [];
        let force = 0;

        if (isMovementType(op.type)) {
          // DETERMINISTIC branch. Whatever the model proposed is discarded.
          const computed = jumpsBetween(state.systems, op.originId, op.targetId);
          if (computed === null) {
            reject(
              raw,
              'unreachable_target',
              `No hyperlane route from "${op.originId}" to "${op.targetId}".`,
            );
            break;
          }
          if (op.durationTurns !== undefined && op.durationTurns !== computed) {
            const note = `Discarded model duration ${op.durationTurns} for movement ${op.originId}->${op.targetId}; recomputed ${computed} from hyperlane path.`;
            notes.push(note);
            logEvent(state, 'system', note, op.factionId);
          }
          duration = computed;
          path = shortestPath(state.systems, op.originId, op.targetId) ?? [];
          rationale = `${computed} jump(s) along the shortest hyperlane path.`;

          // A movement commits a stated force, drawn from the origin. Sending
          // "the fleet" without saying how much used to commit every ship the
          // faction owned, everywhere.
          const origin = state.systems.find((sys) => sys.id === op.originId)!;
          const available = origin.ships[op.factionId] ?? 0;
          const wanted = op.force ?? available;
          force = Math.min(wanted, available);
          if (force <= 0) {
            reject(
              raw,
              'illegal_value',
              `${op.factionId} has no ships at ${op.originId} to move.`,
            );
            break;
          }
          if (wanted > available) {
            const note = `Requested ${wanted} ships from ${origin.name} but only ${available} were there; sending ${force}.`;
            notes.push(note);
            logEvent(state, 'system', note, op.factionId);
          }
          if (available - force === 0) delete origin.ships[op.factionId];
          else origin.ships[op.factionId] = available - force;
        } else {
          // ESTIMATED branch. Model proposes, code clamps.
          if (op.durationTurns === undefined) {
            reject(
              raw,
              'missing_duration',
              `Order type "${op.type}" is estimated work and requires durationTurns from the Fibonacci scale (1,2,3,5,8,13,21).`,
            );
            break;
          }
          const category = op.type as DurationCategory;
          const clamp = applyCategoryFloor(category, op.durationTurns);
          if (clamp.clamped) {
            const note = `Clamped ${category} duration ${clamp.from} -> ${clamp.duration} (category floor ${clamp.floor}).`;
            notes.push(note);
            logEvent(state, 'clamp', note, op.factionId);
          }
          duration = clamp.duration;
        }

        // Pay for the works. Trimmed to the per-kind cap and then to what the
        // treasury can actually cover, on the same trim-don't-reject principle
        // as `billConstruction`: a partly affordable programme is partly
        // delivered, which reads the way a partial check reads. Only a treasury
        // that cannot buy a single unit is refused outright.
        let effect: OrderEffect | undefined;
        let invested = 0;
        if (op.onComplete) {
          const treasury = state.factions.find((f) => f.id === op.factionId)!;
          const site = getSystem(state, op.targetId)!;
          const trim = trimOrderEffect(
            state,
            site,
            op.factionId,
            op.onComplete,
            treasury.credits,
          );
          if (!trim) {
            // Quote the price. A development that crosses into hub status can
            // cost several turns of income, and "you cannot afford it" is only
            // actionable if the player is told what it would have taken.
            const asked = priceOrderEffect(state, site, op.factionId, op.onComplete);
            reject(
              raw,
              'insufficient_credits',
              `${op.onComplete.kind} at ${site.name} would cost ${asked} credits and ${op.factionId} has ${treasury.credits}.`,
            );
            break;
          }
          effect = trim.effect;
          invested = trim.cost;
          treasury.credits -= invested;
          if (trim.from !== undefined) {
            const why =
              trim.reason === 'cap'
                ? 'that is the most one programme can deliver'
                : 'that is all the treasury could cover';
            const note = `Trimmed ${op.onComplete.kind} from ${trim.from} to ${effect.magnitude}; ${why}.`;
            notes.push(note);
            logEvent(state, 'clamp', note, op.factionId);
          }
        }

        const order: PendingOrder = {
          id: mintOrderId(state),
          factionId: op.factionId,
          type: op.type,
          originId: op.originId,
          targetId: op.targetId,
          durationTurns: duration,
          progress: 0,
          interruptible: op.interruptible,
          onInterrupt: op.onInterrupt,
          visibility: [...new Set(op.visibility.filter(factionExists))],
          label: op.label || op.type.replace(/_/g, ' '),
          durationRationale: rationale,
          path,
          force,
          onComplete: effect,
          investedCredits: invested,
        };
        state.pendingOrders.push(order);
        const delivers = effect
          ? `, to deliver ${describeOrderEffect(effect)} for ${invested} credits`
          : '';
        logEvent(
          state,
          'order',
          `${op.factionId} begins ${order.label} (${duration} turns) -> ${op.targetId}${delivers}.`,
          op.factionId,
        );
        break;
      }

      case 'cancel_order': {
        const idx = state.pendingOrders.findIndex((o) => o.id === op.orderId);
        if (idx === -1) {
          reject(raw, 'unknown_order', `No pending order "${op.orderId}".`);
          break;
        }
        const [removed] = state.pendingOrders.splice(idx, 1);
        // Recalling a movement brings its ships home. Splicing the order out
        // without this quietly destroyed the fleet it was carrying.
        if (isMovementType(removed!.type) && removed!.force > 0) {
          const home = state.systems.find((sys) => sys.id === removed!.originId);
          if (home) {
            home.ships[removed!.factionId] = (home.ships[removed!.factionId] ?? 0) + removed!.force;
          }
        }
        // Recalling your own order is orderly, so the works return what they
        // have not yet cut into — the same principle that brings a recalled
        // fleet's ships home rather than destroying them. An *interruption* is
        // different: `onInterrupt: 'cancel'` means the work was lost, not
        // stood down, so nothing comes back there.
        let recovered = 0;
        if (removed!.investedCredits > 0) {
          const left = Math.max(0, removed!.durationTurns - removed!.progress);
          recovered = Math.round(removed!.investedCredits * (left / removed!.durationTurns));
          const owner = state.factions.find((f) => f.id === removed!.factionId);
          if (owner) owner.credits += recovered;
        }
        const returned = recovered > 0 ? ` ${recovered} credits recovered from the works.` : '';
        logEvent(
          state,
          'order',
          `${removed!.label} cancelled.${returned} ${op.reason}`.trim(),
          removed!.factionId,
        );
        break;
      }

      case 'interrupt_order': {
        const order = state.pendingOrders.find((o) => o.id === op.orderId);
        if (!order) {
          reject(raw, 'unknown_order', `No pending order "${op.orderId}".`);
          break;
        }
        if (!order.interruptible) {
          reject(
            raw,
            'not_interruptible',
            `Order "${op.orderId}" (${order.label}) is flagged not interruptible.`,
          );
          break;
        }
        const outcome = resolveInterrupt(state, order, op.reason);
        notes.push(outcome);
        break;
      }

      case 'extend_order': {
        const order = state.pendingOrders.find((o) => o.id === op.orderId);
        if (!order) {
          reject(raw, 'unknown_order', `No pending order "${op.orderId}".`);
          break;
        }
        if (isMovementType(order.type)) {
          reject(
            raw,
            'illegal_value',
            `Movement durations are computed from the hyperlane graph and cannot be extended.`,
          );
          break;
        }
        order.durationTurns += op.additionalTurns;
        logEvent(
          state,
          'order',
          `${order.label} extended by ${op.additionalTurns} to ${order.durationTurns} turns. ${op.reason}`.trim(),
          order.factionId,
        );
        break;
      }

      case 'accelerate_order': {
        const order = state.pendingOrders.find((o) => o.id === op.orderId);
        if (!order) {
          reject(raw, 'unknown_order', `No pending order "${op.orderId}".`);
          break;
        }
        if (isMovementType(order.type)) {
          reject(
            raw,
            'illegal_value',
            `Movement cannot be accelerated; a jump takes a turn regardless of spending.`,
          );
          break;
        }
        const faction = state.factions.find((f) => f.id === order.factionId);
        if (!faction) {
          reject(raw, 'unknown_faction', `No faction "${order.factionId}".`);
          break;
        }
        const current: FibScale = isFibScale(order.durationTurns)
          ? order.durationTurns
          : toFibBucket(order.durationTurns);
        if (current === 1) {
          reject(raw, 'illegal_value', `"${order.label}" is already at the 1-turn minimum.`);
          break;
        }
        const cost = accelerationCost(current);
        if (faction.credits < cost) {
          reject(
            raw,
            'insufficient_credits',
            `${faction.name} needs ${cost} credits to accelerate "${order.label}" but holds ${faction.credits}.`,
          );
          break;
        }
        const next = dropOneBucket(current);
        faction.credits -= cost;
        order.durationTurns = Math.max(next, order.progress + 1);
        logEvent(
          state,
          'order',
          `${faction.name} spends ${cost} credits: ${order.label} ${current} -> ${order.durationTurns} turns.`,
          faction.id,
        );
        break;
      }

      case 'form_treaty': {
        const unknown = op.parties.find((id) => !factionExists(id));
        if (unknown) {
          reject(raw, 'unknown_faction', `No faction "${unknown}".`);
          break;
        }
        if (op.parties[0] === op.parties[1]) {
          reject(raw, 'illegal_value', 'A treaty needs two distinct parties.');
          break;
        }
        const badSystem = [
          ...op.terms.territory,
          ...op.terms.incomeShares.map((c) => c.systemId),
        ].find((id) => !systemExists(id));
        if (badSystem) {
          reject(raw, 'unknown_system', `No system "${badSystem}" in treaty terms.`);
          break;
        }
        const treaty = {
          id: mintId(state, 'tre'),
          type: op.treatyType,
          parties: [...op.parties],
          terms: op.terms,
          signedTurn: state.turn,
          expiresTurn: op.durationTurns === undefined ? null : state.turn + op.durationTurns,
          status: 'active' as const,
          summary: op.summary || `${op.treatyType.replace(/_/g, ' ')} between ${op.parties.join(' and ')}`,
        };
        state.treaties.push(treaty);
        logEvent(state, 'diplomacy', `Treaty signed: ${treaty.summary}.`, op.parties[0]!);
        break;
      }

      case 'break_treaty': {
        const treaty = state.treaties.find((t) => t.id === op.treatyId);
        if (!treaty) {
          reject(raw, 'unknown_treaty', `No treaty "${op.treatyId}".`);
          break;
        }
        treaty.status = 'broken';
        // Breaking a pact is public and costly: both signatories' opinion of
        // the breaker sours, whoever was in the right.
        for (const party of treaty.parties) {
          for (const other of treaty.parties) {
            if (party === other) continue;
            const f = state.factions.find((x) => x.id === other);
            if (!f) continue;
            f.disposition[party] = Math.max(-100, (f.disposition[party] ?? 0) - 25);
          }
        }
        logEvent(state, 'diplomacy', `Treaty broken: ${treaty.summary}. ${op.reason}`.trim());
        break;
      }

      case 'deploy_agent': {
        if (!factionExists(op.ownerFactionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.ownerFactionId}".`);
          break;
        }
        // You may only run your own operatives. Reproduced three times in
        // playtests: on a hostile mission the resolution call anchored
        // `ownerFactionId` to the faction being harmed rather than the one
        // acting, producing e.g. a Vigil agent sabotaging Vigil. The tick loop
        // skips any agent whose owner is its own target, so such an agent is
        // silently inert forever — no rejection, no warning, and invisible in
        // the UI. Rejecting is strictly better than accepting a dead operative.
        if (actor !== undefined && op.ownerFactionId !== actor) {
          reject(
            raw,
            'illegal_value',
            `${actor} cannot deploy an agent owned by ${op.ownerFactionId}. Set ownerFactionId to the acting faction — an operative owned by its own target can never act.`,
          );
          break;
        }
        const host = state.systems.find((x) => x.id === op.systemId);
        if (!host) {
          reject(raw, 'unknown_system', `No system "${op.systemId}".`);
          break;
        }
        const owner = state.factions.find((f) => f.id === op.ownerFactionId)!;
        const target = host.controllerFactionId
          ? state.factions.find((f) => f.id === host.controllerFactionId)
          : undefined;

        // A `crew_defection` operative is worthless against a power whose
        // resolve outmatches your guile: `subornLimit` returns 0, so the agent
        // would roll faithfully every turn and be arithmetically incapable of
        // ever turning a single hull. Rejected rather than accepted-and-inert,
        // because the player has no way to see that from the agent panel — a
        // playtest produced exactly this (Drajk guile 14 vs Arkanis resolve 19)
        // and the operative sat there doing nothing for the rest of the run.
        if (op.effect.kind === 'crew_defection' && target) {
          if (subornLimit(state, op.ownerFactionId, target.id) <= 0) {
            reject(
              raw,
              'illegal_value',
              `${target.name}'s crews will not be suborned by ${owner.name} — their resolve is beyond its guile, so a defection network there could never turn a single hull. Choose another effect.`,
            );
            break;
          }
        }

        // A covert service is a standing commitment, not a free action: there
        // is a price to place an operative, a per-turn cost to run one, and a
        // ceiling on how many a faction can handle at once. All three were
        // missing, which made an unbounded spy network strictly dominant.
        const cap = maxAgentsFor(state, op.ownerFactionId);
        const running = liveAgentsOf(state, op.ownerFactionId).length;
        if (running >= cap) {
          reject(
            raw,
            'illegal_value',
            `${owner.name} is already running ${running} operatives, its limit at guile ${effectiveStats(state, op.ownerFactionId).guile}. Recall one before placing another.`,
          );
          break;
        }

        const price = AGENT_COST[op.mission];
        if (owner.credits < price) {
          reject(
            raw,
            'insufficient_credits',
            `Placing a ${op.mission} operative costs ${price} credits; ${owner.name} holds ${owner.credits}.`,
          );
          break;
        }
        owner.credits -= price;

        state.agents.push({
          id: mintId(state, 'agt'),
          ownerFactionId: op.ownerFactionId,
          systemId: op.systemId,
          mission: op.mission,
          effect: op.effect,
          // Computed here, never chosen by a model: guile against the target's
          // counter-intelligence, which is its resolve.
          successChance: agentSuccessChance(owner.stats.guile, target?.stats.resolve ?? 8),
          deployedTurn: state.turn,
          exposed: false,
          cover: op.cover,
        });
        logEvent(
          state,
          'order',
          `${owner.name} places an agent on ${host.name} (${op.mission}) for ${price} credits.`,
          op.ownerFactionId,
        );
        break;
      }

      case 'recall_agent': {
        const idx = state.agents.findIndex((a) => a.id === op.agentId);
        if (idx === -1) {
          reject(raw, 'unknown_agent', `No agent "${op.agentId}".`);
          break;
        }
        const [gone] = state.agents.splice(idx, 1);
        logEvent(state, 'order', `Agent withdrawn from ${gone!.systemId}. ${op.reason}`.trim(), gone!.ownerFactionId);
        break;
      }

      case 'adjust_ships': {
        const host = state.systems.find((x) => x.id === op.systemId);
        if (!host) {
          reject(raw, 'unknown_system', `No system "${op.systemId}".`);
          break;
        }
        if (!factionExists(op.factionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }

        // Taking hulls off a power that is not you is SUBORNING them, and it
        // needs two things the unguarded op did not ask for: that you are
        // actually there, and that your guile beats their resolve. Playtesting
        // produced a legitimate one-corvette defection on a natural 20 — and
        // the same op shape would have moved thirty hulls across the galaxy.
        let delta = op.delta;
        if (actor !== undefined && op.factionId !== actor && delta < 0) {
          if (!canSubornAt(state, actor, op.systemId)) {
            reject(
              raw,
              'no_presence',
              `${actor} has no ships at or next to ${op.systemId}, and no agent there; a crew cannot be talked into changing sides from further off.`,
            );
            break;
          }
          const limit = subornLimit(state, actor, op.factionId);
          if (limit <= 0) {
            reject(
              raw,
              'illegal_value',
              `${op.factionId}'s crews will not be suborned by ${actor} — their resolve is beyond its guile.`,
            );
            break;
          }
          if (-delta > limit) {
            const note = `${nameFor(state, actor)} could only talk ${limit} of ${-delta} ${nameFor(state, op.factionId)} hulls into changing sides.`;
            notes.push(note);
            logEvent(state, 'system', note, actor);
            delta = -limit;
          }
        }

        const now = Math.max(0, (host.ships[op.factionId] ?? 0) + delta);
        const taken = Math.min(-delta, host.ships[op.factionId] ?? 0);
        if (now === 0) delete host.ships[op.factionId];
        else host.ships[op.factionId] = now;

        // Suborning is an act of statecraft, not of war: no battle is fought,
        // and the price is paid in standing. Without this it was the only
        // hostile act in the game that cost nothing at all — you could strip a
        // rival's crews and remain on good terms with everyone.
        if (actor !== undefined && op.factionId !== actor && taken > 0) {
          const victim = state.factions.find((f) => f.id === op.factionId);
          if (victim) {
            victim.disposition[actor] = Math.max(
              -100,
              (victim.disposition[actor] ?? 0) - SUBORN_DISPOSITION_COST * taken,
            );
          }
          for (const witness of state.factions) {
            if (witness.id === actor || witness.id === op.factionId) continue;
            witness.disposition[actor] = Math.max(
              -100,
              (witness.disposition[actor] ?? 0) - SUBORN_REPUTATION_COST,
            );
          }
          const note = `${nameFor(state, actor)} turns ${taken} ${nameFor(state, op.factionId)} hull(s) at ${host.name} without a shot fired.`;
          notes.push(note);
          logEvent(state, 'diplomacy', note, actor);
        }
        break;
      }

      case 'establish_commitment': {
        const unknown = op.factionIds.find((id) => !factionExists(id));
        if (unknown) {
          reject(raw, 'unknown_faction', `No faction "${unknown}".`);
          break;
        }
        // The arbitrator rules that a marriage is exclusive; THIS is what
        // stops a second one. Trusting the arbitrator to remember turn 3 on
        // turn 4 is exactly the kind of consistency a prompt cannot be relied
        // on for, and the whole reason commitments are world state.
        const clash = conflictingCommitment(state.commitments, op.kind, op.factionIds);
        if (clash) {
          reject(
            raw,
            'commitment_conflict',
            `Already bound: ${clash.text} (turn ${clash.establishedTurn}). A faction may hold only one ${op.kind.replace(/_/g, ' ')} at a time; dissolve that one first.`,
          );
          break;
        }
        // An arrangement may be worth money, within a bound. Trimmed rather
        // than rejected: the arrangement itself is still real at a smaller
        // number, so refusing the whole thing over its price would throw away
        // the part the arbiter actually ruled on.
        const asked = op.incomePerTurn;
        const yieldPerTurn = Math.max(
          -MAX_COMMITMENT_INCOME,
          Math.min(MAX_COMMITMENT_INCOME, asked),
        );
        if (yieldPerTurn !== asked) {
          const note = `Trimmed ${op.kind} yield from ${asked} to ${yieldPerTurn} per turn (ceiling ${MAX_COMMITMENT_INCOME}).`;
          notes.push(note);
          logEvent(state, 'clamp', note, op.factionIds[0] ?? null);
        }
        state.commitments.push({
          id: mintId(state, 'com'),
          kind: op.kind,
          factionIds: [...op.factionIds],
          text: op.text,
          exclusive: op.exclusive,
          incomePerTurn: yieldPerTurn,
          establishedTurn: state.turn,
          status: 'active',
        });
        logEvent(state, 'diplomacy', op.text, op.factionIds[0] ?? null);
        break;
      }

      case 'dissolve_commitment': {
        const found = state.commitments.find((c) => c.id === op.commitmentId);
        if (!found) {
          reject(raw, 'unknown_commitment', `No commitment "${op.commitmentId}".`);
          break;
        }
        found.status = 'dissolved';
        logEvent(state, 'diplomacy', `Ended: ${found.text}. ${op.reason}`.trim());
        break;
      }

      case 'spawn_event': {
        if (op.factionId !== null && !factionExists(op.factionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.factionId}".`);
          break;
        }
        logEvent(state, 'system', op.text, op.factionId);
        break;
      }

      case 'log_narrative': {
        logEvent(state, 'narrative', op.text);
        break;
      }
    }
  }

  capSelfInflictedLosses(state, actor, hullsBefore, notes);
  billConstruction(state, hullsBefore, notes);

  return { state, rejections, notes };
}

/**
 * Stop a single declared action from wiping out the acting faction's own navy.
 *
 * Real combat losses never come through here — `resolveBattle` mutates state
 * directly during `tickTurn`, so this cap cannot blunt an honest defeat. What
 * it catches is a resolution call narrating a battle it was never supposed to
 * resolve and emitting ops to match: five separate playtest reproductions had
 * a bad `might` roll delete 88–100% of the acting fleet, with no
 * `fleet_movement` order anywhere and the enemy untouched.
 *
 * A faction can still lose hulls to a story beat — scuttling, an accident, a
 * disaster — but not its whole fleet in one declaration. Trimmed rather than
 * rejected, on the same principle as `billConstruction`: the batch's other
 * work stands, and the excess is handed back with a note.
 */
function capSelfInflictedLosses(
  state: WorldState,
  actor: string | undefined,
  before: Map<string, number>,
  notes: string[],
): void {
  if (actor === undefined) return; // engine ops, and journals predating the actor field
  const faction = state.factions.find((f) => f.id === actor);
  if (!faction) return;

  const had = before.get(actor) ?? 0;
  const lost = had - fleetStrengthOf(state, actor);
  if (lost <= 0) return;

  const allowed = Math.max(1, Math.floor(had * MAX_SELF_INFLICTED_LOSS_FRACTION));
  if (lost <= allowed) return;

  const restored = lost - allowed;
  const bases = fleetBases(state, actor);
  if (bases.length === 0) return;
  bases[0]!.ships[actor] = (bases[0]!.ships[actor] ?? 0) + restored;

  const note = `${faction.name} cannot lose ${lost} hulls to a single declaration; ${restored} were never at risk and remain at ${bases[0]!.name}. Battle losses are resolved when a fleet arrives, not when an order is given.`;
  notes.push(note);
  logEvent(state, 'rejection', note, actor);
}

/**
 * Bill every faction for the hulls it gained this batch, and deliver only what
 * it could pay for.
 *
 * This is the hard cap on "build a thousand ships". The model may emit any
 * `adjust_fleet` it likes; the yards deliver `credits / SHIP_COST` of it and
 * the rest never existed. Trimming the surplus rather than rejecting the op
 * keeps a partly-affordable order partly fulfilled, which is both the more
 * useful outcome and the one that matches how a partial check reads.
 *
 * Losses are never refunded — a scrapped hull returns nothing — so a faction
 * cannot cycle ships through the yards for money.
 */
function billConstruction(
  state: WorldState,
  before: Map<string, number>,
  notes: string[],
): void {
  for (const faction of state.factions) {
    const gained = fleetStrengthOf(state, faction.id) - (before.get(faction.id) ?? 0);
    if (gained <= 0) continue;

    const affordable = Math.floor(faction.credits / SHIP_COST);
    const built = Math.min(gained, affordable);
    faction.credits -= built * SHIP_COST;

    const shortfall = gained - built;
    if (shortfall > 0) {
      // Hulls in transit cannot be un-built, so trim from systems and accept
      // a smaller cut if that is all that is reachable.
      const trimmed = removeShips(state, faction.id, shortfall);
      const note = `${faction.name} could only pay for ${built} of ${gained} new hulls (${SHIP_COST} credits each); ${trimmed} were never laid down.`;
      notes.push(note);
      logEvent(state, 'system', note, faction.id);
    } else if (built > 0) {
      const note = `${faction.name} commissions ${built} hulls for ${built * SHIP_COST} credits.`;
      notes.push(note);
      logEvent(state, 'system', note, faction.id);
    }
  }
}

/**
 * Interruption semantics, per the order's own onInterrupt policy:
 *   cancel  - the work is lost entirely
 *   partial - the work stops but banks what it achieved (a fleet halts where
 *             it is; estimated work refunds the unspent portion)
 *   persist - the interruption is weathered and the order continues
 */
function resolveInterrupt(state: WorldState, order: PendingOrder, reason: string): string {
  const faction = state.factions.find((f) => f.id === order.factionId);

  if (order.onInterrupt === 'persist') {
    const note = `${order.label} weathered an interruption and continues (${order.progress}/${order.durationTurns}). ${reason}`.trim();
    logEvent(state, 'order', note, order.factionId);
    return note;
  }

  const idx = state.pendingOrders.findIndex((o) => o.id === order.id);
  if (idx !== -1) state.pendingOrders.splice(idx, 1);

  if (order.onInterrupt === 'cancel') {
    // Cancelled movement still returns its ships — they were never destroyed.
    if (isMovementType(order.type) && order.force > 0) {
      const home = state.systems.find((s) => s.id === order.originId);
      if (home) home.ships[order.factionId] = (home.ships[order.factionId] ?? 0) + order.force;
    }
    // `cancel` means the work is lost entirely, so money sunk into the works is
    // sunk. Said out loud rather than deducted silently: a player who abandons a
    // shipyard should be told what it cost them.
    const sunk = order.investedCredits > 0 ? ` ${order.investedCredits} credits sunk with it.` : '';
    const note = `${order.label} broken off; all progress lost.${sunk} ${reason}`.trim();
    logEvent(state, 'order', note, order.factionId);
    return note;
  }

  // partial
  if (isMovementType(order.type)) {
    const halted = positionAlongPath(order.path, order.progress) ?? order.originId;
    const sys = state.systems.find((s) => s.id === halted);
    // The ships are real and have to come back onto the board somewhere.
    if (sys && order.force > 0) {
      sys.ships[order.factionId] = (sys.ships[order.factionId] ?? 0) + order.force;
    }
    const note = `${order.label} halted mid-transit at ${sys?.name ?? halted} with ${order.force} ships. ${reason}`.trim();
    logEvent(state, 'order', note, order.factionId);
    return note;
  }

  const remaining = Math.max(0, order.durationTurns - order.progress);
  // Banked work is kept and unspent work is refunded. A programme with real
  // money sunk into it refunds pro-rata of what was actually committed, on top
  // of the flat recovery — the yards return the materials they never cut into.
  const unspent =
    order.investedCredits > 0
      ? Math.round(order.investedCredits * (remaining / order.durationTurns))
      : 0;
  const refund = remaining * 20 + unspent;
  if (faction) faction.credits += refund;
  const note = `${order.label} suspended at ${order.progress}/${order.durationTurns}; ${refund} credits recovered. ${reason}`.trim();
  logEvent(state, 'order', note, order.factionId);
  return note;
}

/** Everything the turn produced, structured so the UI never has to re-derive it. */
export interface TurnReport {
  completed: { label: string; factionId: string; where: string; outcome: string }[];
  /** Player-visible work still running, with how much is left. */
  advanced: {
    id: string;
    label: string;
    factionId: string;
    progress: number;
    duration: number;
    remaining: number;
    where: string;
    isMovement: boolean;
  }[];
  ledger: Ledger;
  arrivals: string[];
}

export interface TickResult extends ApplyResult {
  report: TurnReport;
}

/**
 * Advance time by one turn: collect income, tick every pending order, resolve
 * everything that completes. This is the only place `transfer_control`
 * originates.
 */
export function tickTurn(input: WorldState): TickResult {
  const state = clone(input);
  const notes: string[] = [];

  state.turn += 1;

  /* --- Income, for every power, before anything is spent --------------- */
  // Applied here rather than by any model, so a campaign's economy is
  // arithmetic the journal reproduces exactly.
  for (const faction of state.factions) {
    const ledger = ledgerFor(state, faction.id);
    const balance = faction.credits + ledger.net;
    faction.credits = Math.max(0, balance);

    // A navy you cannot pay for does not simply sit there. Credits used to
    // floor at zero and nothing else happened, which made upkeep no constraint
    // at all: a fleet of a thousand was sustainable on an empty treasury
    // forever. Unpaid crews are stood down instead, enough to close the gap
    // but capped so insolvency is a decline rather than a collapse.
    if (balance < 0) {
      const gap = -balance;
      const fleet = fleetStrengthOf(state, faction.id);
      const wanted = Math.ceil(gap / UPKEEP_PER_FLEET_POINT);
      const cap = Math.max(1, Math.floor(fleet * MAX_ATTRITION_FRACTION));
      const laidUp = removeShips(state, faction.id, Math.min(wanted, cap));
      if (laidUp > 0) {
        const note = `${faction.name} cannot meet its upkeep and lays up ${laidUp} ships.`;
        notes.push(note);
        logEvent(state, 'system', note, faction.id);
      }
    }
  }
  const playerLedger = ledgerFor(state, state.playerFactionId);

  /* --- Dissent cools ---------------------------------------------------- */
  // Institutions forgive slowly. A single refusal fades in a few turns; a
  // leader who keeps overruling their own people accumulates faster than this
  // can drain, and every stat suffers for it.
  for (const faction of state.factions) {
    if (faction.dissent > 0) faction.dissent = Math.max(0, faction.dissent - DISSENT_DECAY);
  }

  /* --- Compulsions ignored --------------------------------------------- */
  // The other half of governing in character. A refusal catches a leader
  // ordering their faction to betray itself; nothing caught one who simply
  // never acts, because a refusal needs an action to refuse. Four compulsions
  // in the seed promised consequences for exactly that and had none.
  //
  // Read here, before the orders phase consumes `pendingOrders`, so a faction
  // whose fleet lands this very turn still counts as having one under way —
  // the forgiving direction, and the correct one.
  //
  // This runs for EVERY faction, which makes it the first thing in the game
  // that holds an NPC to its own character: refusals only ever reached the
  // player, since reactions have no refusal channel.
  for (const faction of state.factions) {
    const drifting = driftingCompulsions(state, faction.id);
    if (drifting.length === 0) continue;
    const before = faction.dissent;
    faction.dissent = Math.min(100, before + drifting.length * COMPULSION_DRIFT_DISSENT);
    const added = faction.dissent - before;
    if (added === 0) continue;
    const note = `${faction.name}: dissent +${added} (now ${faction.dissent}/100) — ${drifting
      .map((d) => d.why)
      .join('; ')}.`;
    logEvent(state, 'system', note, faction.id);
    if (faction.id === state.playerFactionId) notes.push(note);
  }

  /* --- Treaties lapse before anything is paid out ---------------------- */
  for (const treaty of state.treaties) {
    if (treaty.status !== 'active' || treaty.expiresTurn === null) continue;
    if (state.turn >= treaty.expiresTurn) {
      treaty.status = 'expired';
      logEvent(state, 'diplomacy', `Treaty lapsed: ${treaty.summary}.`);
    }
  }

  /* --- Interdiction: blockades and commerce raiding -------------------- */
  // These orders are sustained by a fleet on station, so they end the moment
  // that fleet does. Checked BEFORE income is not an option — income was
  // already paid above using the orders as they stood at the start of the
  // turn, which is the same "the world you acted on is the world you saw"
  // rule the staging model follows everywhere else.
  for (const order of [...state.pendingOrders]) {
    if (!INTERDICTION_TYPES.has(order.type)) continue;
    const target = state.systems.find((sys) => sys.id === order.targetId);
    const onStation = interdictionStations(state, order);

    if (onStation <= 0) {
      const idx = state.pendingOrders.findIndex((o) => o.id === order.id);
      if (idx !== -1) state.pendingOrders.splice(idx, 1);
      const note = `${nameFor(state, order.factionId)} no longer has ships ${order.type === 'blockade' ? 'at' : 'within reach of'} ${target?.name ?? order.targetId}; ${order.label} ends.`;
      notes.push(note);
      logEvent(state, 'order', note, order.factionId);
      continue;
    }
    if (order.progress <= 0 || !target) continue;

    // Strangling someone's commerce is an act of war conducted without a
    // battle, so it has to cost what a battle would cost diplomatically.
    const victims = new Set<string>();
    if (target.controllerFactionId && target.controllerFactionId !== order.factionId) {
      victims.add(target.controllerFactionId);
    }
    if (order.type === 'blockade') {
      for (const route of tradeRoutes(state)) {
        if (!route.path.includes(target.id)) continue;
        for (const end of route.endpoints) {
          const holder = state.systems.find((x) => x.id === end)?.controllerFactionId;
          if (holder && holder !== order.factionId) victims.add(holder);
        }
      }
    }
    for (const victim of victims) {
      const f = state.factions.find((x) => x.id === victim);
      if (!f) continue;
      f.disposition[order.factionId] = Math.max(
        -100,
        (f.disposition[order.factionId] ?? 0) - INTERDICTION_DISPOSITION_COST,
      );
    }

    // Turning pirate is a reputational act, not merely a bilateral one —
    // unless piracy is what everyone already expects of you.
    const raider = state.factions.find((x) => x.id === order.factionId);
    if (order.type === 'commerce_raiding' && raider && raider.tradeEthic !== 'smuggler') {
      for (const witness of state.factions) {
        if (witness.id === order.factionId || victims.has(witness.id)) continue;
        witness.disposition[order.factionId] = Math.max(
          -100,
          (witness.disposition[order.factionId] ?? 0) - PIRACY_REPUTATION_COST,
        );
      }
    }
    if (victims.size > 0) {
      logEvent(
        state,
        'order',
        `${nameFor(state, order.factionId)} continues to ${order.type === 'blockade' ? 'blockade' : 'raid shipping at'} ${target.name}.`,
        order.factionId,
      );
    }
  }

  /* --- Tolls breed resentment ------------------------------------------ */
  // Levied in `trade.ts` as arithmetic; resented here, because a toll the
  // payers never notice is a toll with no politics attached to it.
  {
    const earnings = routeEarnings(state);
    for (const [collector, amount] of Object.entries(earnings.tolls)) {
      if (amount <= 0) continue;
      for (const payer of state.factions) {
        if (payer.id === collector) continue;
        // Only the powers actually shipping through them mind.
        if ((ledgerFor(state, payer.id).routes ?? 0) <= 0) continue;
        payer.disposition[collector] = Math.max(
          -100,
          (payer.disposition[collector] ?? 0) - TOLL_RESENTMENT,
        );
      }
    }
  }

  /* --- Agents act ------------------------------------------------------ */
  // Resolved with the same seeded d20 as everything else, so a campaign's
  // covert war replays exactly.
  //
  // The MISSION decides risk and persistence; the EFFECT decides what happens.
  // Keeping them separate is what lets a quiet surveillance post and a
  // one-shot decapitation share the same machinery without behaving alike.
  const spentAgents: string[] = [];

  for (const agent of state.agents) {
    if (agent.exposed) continue;
    const host = state.systems.find((sys) => sys.id === agent.systemId);
    const target = host?.controllerFactionId
      ? state.factions.find((f) => f.id === host.controllerFactionId)
      : undefined;
    if (!host || !target || target.id === agent.ownerFactionId) continue;

    const profile = MISSION_PROFILE[agent.mission];
    const owner = state.factions.find((f) => f.id === agent.ownerFactionId);
    const roll = rollD20(state.turn, `agent:${agent.id}`);
    const succeeded = roll * 5 <= agent.successChance;

    // A one-shot mission is spent whether or not it worked.
    if (profile.oneShot) spentAgents.push(agent.id);

    if (!succeeded) {
      // A botched operation risks the operative, and how much depends on the
      // mission: a watcher is rarely caught, an assassin usually is.
      if (roll <= profile.exposureRisk) {
        agent.exposed = true;
        logEvent(
          state,
          'system',
          `${target.name} exposes ${owner?.name ?? agent.ownerFactionId}'s ${agent.mission} operative on ${host.name}.`,
          target.id,
        );
        if (owner) {
          const outrage = profile.oneShot ? 40 : 20;
          target.disposition[owner.id] = Math.max(
            -100,
            (target.disposition[owner.id] ?? 0) - outrage,
          );
        }
      }
      continue;
    }

    if (agent.effect.kind === 'crew_defection') {
      // Hulls change sides rather than being destroyed. The operative asks for
      // `perTurn`; what it gets is the stat contest — guile against resolve —
      // so a model cannot request a squadron and be handed one. A power with
      // resolve beyond the suborner's guile yields nothing, ever.
      const limit = subornLimit(state, agent.ownerFactionId, target.id);
      const wanted = Math.min(agent.effect.perTurn * profile.effectMultiplier, limit);
      const available = host.ships[target.id] ?? 0;
      const turned = Math.min(wanted, available);

      if (turned > 0) {
        const left = available - turned;
        if (left === 0) delete host.ships[target.id];
        else host.ships[target.id] = left;
        host.ships[agent.ownerFactionId] = (host.ships[agent.ownerFactionId] ?? 0) + turned;

        // Bought, not conquered: crews that change sides still have to be
        // paid for, at the same price as a hull from the yards. Otherwise a
        // defection network is a free shipyard pointed at your rival.
        const buyer = state.factions.find((f) => f.id === agent.ownerFactionId);
        if (buyer) buyer.credits = Math.max(0, buyer.credits - turned * SHIP_COST);

        logEvent(
          state,
          'system',
          `${turned} ${target.name} hull(s) at ${host.name} change sides to ${owner?.name ?? agent.ownerFactionId}.`,
          target.id,
        );
        // Losing crews to a rival is a humiliation, not merely a loss.
        target.disposition[agent.ownerFactionId] = Math.max(
          -100,
          (target.disposition[agent.ownerFactionId] ?? 0) - 6 * turned,
        );
      } else if (limit <= 0) {
        logEvent(
          state,
          'system',
          `${owner?.name ?? agent.ownerFactionId}'s approaches to ${target.name}'s crews on ${host.name} find no takers.`,
          agent.ownerFactionId,
        );
      }
      continue;
    }

    if (agent.effect.kind === 'hull_damage') {
      const damage = agent.effect.perTurn * profile.effectMultiplier;
      // Sabotage destroys hulls where the operative is, not somewhere abstract.
      const before = host.ships[target.id] ?? 0;
      const left = Math.max(0, before - damage);
      if (left === 0) delete host.ships[target.id];
      else host.ships[target.id] = left;
      const lost = before - left;
      if (lost > 0) {
        logEvent(
          state,
          'system',
          profile.oneShot
            ? `${owner?.name ?? agent.ownerFactionId} decapitates the command on ${host.name}: ${target.name} loses ${lost} fleet strength.`
            : `Sabotage on ${host.name}: ${target.name} loses ${lost} fleet strength.`,
          target.id,
        );
      }
    }

    // A successful decapitation is not deniable for long. Relations collapse
    // even when the operative gets out.
    if (profile.oneShot && owner) {
      target.disposition[owner.id] = Math.max(-100, (target.disposition[owner.id] ?? 0) - 35);
      logEvent(
        state,
        'diplomacy',
        `${target.name} lays the killing at ${owner.name}'s door.`,
        target.id,
      );
    }
    // income_penalty and stat_debuff are applied where they are read
    // (ledgerFor and effectiveStats), so they cannot double-apply here.
  }

  // Spent operatives leave the board; they were never a standing asset.
  if (spentAgents.length > 0) {
    state.agents = state.agents.filter((a) => !spentAgents.includes(a.id));
  }

  /* --- Orders ---------------------------------------------------------- */
  const survivors: PendingOrder[] = [];
  const completed: PendingOrder[] = [];

  for (const order of state.pendingOrders) {
    const next = { ...order, progress: order.progress + 1 };
    if (next.progress >= next.durationTurns) completed.push(next);
    else survivors.push(next);
  }
  state.pendingOrders = survivors;

  const report: TurnReport = {
    completed: [],
    advanced: [],
    ledger: playerLedger,
    arrivals: [],
  };

  const nameOf = (id: string): string => state.systems.find((s) => s.id === id)?.name ?? id;

  // Systems that saw a landing or a battle this turn. Their garrisons sat out
  // the regrowth below regardless of who ended up holding them.
  const contested = new Set<string>();

  // Everything landing on the same world this turn fights ONE battle, so two
  // powers hitting the same system are co-belligerents rather than a queue of
  // separate duels against each other's leftovers.
  const landings = new Map<string, PendingOrder[]>();
  for (const order of completed) {
    if (!isMovementType(order.type)) continue;
    contested.add(order.targetId);
    const list = landings.get(order.targetId) ?? [];
    list.push(order);
    landings.set(order.targetId, list);
  }

  for (const [systemId, orders] of landings) {
    const outcome = resolveBattle(state, systemId, orders);
    notes.push(outcome);
    report.arrivals.push(outcome);
    for (const order of orders) {
      report.completed.push({
        label: order.label,
        factionId: order.factionId,
        where: nameOf(systemId),
        outcome,
      });
    }
  }

  for (const order of completed) {
    if (isMovementType(order.type)) {
      // handled above, per system
    } else {
      // A completed programme is where multi-turn work finally touches the
      // world. Without a payload the order really does just finish — correct for
      // a courier run or a decree, whose effects landed elsewhere.
      const target = order.onComplete ? getSystem(state, order.targetId) : undefined;
      const note =
        order.onComplete && target
          ? applyOrderEffect(target, order.factionId, order.onComplete, order.label).note
          : `${order.label} completed at ${nameOf(order.targetId)}.`;
      logEvent(state, 'order', note, order.factionId);
      notes.push(note);
      report.completed.push({
        label: order.label,
        factionId: order.factionId,
        where: nameOf(order.targetId),
        outcome: note,
      });
    }
  }

  /* --- Garrisons regrow, last, and only where it is quiet -------------- */
  // Levies are raised between fights, not during one. A world regrows only if
  // nothing hostile is sitting in its orbit and nothing landed on it this turn
  // — otherwise a besieged garrison would rebuild faster than it was being
  // ground down, and a world stormed this turn would have grown first.
  for (const system of state.systems) {
    const holder = system.controllerFactionId;
    if (holder === null) continue;
    if (contested.has(system.id)) continue;
    const besieged = Object.entries(system.ships).some(([id, n]) => id !== holder && n > 0);
    if (besieged) continue;
    if (system.garrison < system.garrisonMax) {
      system.garrison = Math.min(system.garrisonMax, system.garrison + GARRISON_REGROWTH);
    }
  }

  for (const order of state.pendingOrders) {
    report.advanced.push({
      id: order.id,
      label: order.label,
      factionId: order.factionId,
      progress: order.progress,
      duration: order.durationTurns,
      remaining: order.durationTurns - order.progress,
      where: nameOf(order.targetId),
      isMovement: isMovementType(order.type),
    });
  }

  logEvent(
    state,
    'system',
    `Turn ${state.turn}: ${playerLedger.gross} credits from ${playerLedger.systems} systems, ${playerLedger.upkeep} to upkeep.`,
    state.playerFactionId,
  );

  return { state, rejections: [], notes, report };
}

/**
 * A movement order has arrived. This — and only this — can change who controls
 * a system.
 *
 * Resolution is deterministic (no RNG) so that a campaign replays identically:
 * the arriving faction's fleet is measured against the garrison in place.
 */
/**
 * Combat for one system, once per turn, with coalitions on both sides.
 *
 *   1. FLEET BATTLE — everything the attacking coalition landed against every
 *      other ship in the system. Either side may break off; ships that run
 *      survive at a cost. Nothing touches the ground while defenders hold
 *      orbit.
 *   2. GROUND ASSAULT — only once the defending ships are destroyed or gone.
 *      Garrisons are dug-in ground forces and cannot retreat, so this is
 *      fought to a decision.
 *
 * Sides are decided by a deliberately safe default: **anyone already in the
 * system who is not landing an attack defends it.** There is no alliance model
 * to consult, so an uncommitted third party is treated as protecting the
 * status quo rather than as a bystander to be walked past.
 *
 * Reinforcements are not an attack: ships arriving for the system's current
 * controller join the defence.
 *
 * Deterministic throughout — one seeded d20 per system per turn.
 */
function resolveBattle(state: WorldState, systemId: string, orders: PendingOrder[]): string {
  const target = state.systems.find((s) => s.id === systemId);
  if (!target) return `A landing on ${systemId} could not be resolved (missing system).`;

  const holder = target.controllerFactionId;
  const nameOf = (id: string): string => state.factions.find((f) => f.id === id)?.name ?? id;

  // Ships arriving, per faction.
  const arriving = new Map<string, number>();
  for (const o of orders) arriving.set(o.factionId, (arriving.get(o.factionId) ?? 0) + o.force);

  const land = (factionId: string, n: number): void => {
    if (n > 0) target.ships[factionId] = (target.ships[factionId] ?? 0) + n;
  };

  // The holder reinforcing itself is not an invasion — and neither is an ally
  // arriving where a `basing_rights` treaty says it may. Without that second
  // case a fleet could not be stationed in friendly space at all: any movement
  // into a partner's system was resolved as an attack on them, which made the
  // treaty type unusable rather than merely inert.
  const guest = (id: string): boolean =>
    holder !== null &&
    id !== holder &&
    treatyBetween(state.treaties, state.turn, id, holder, ['basing_rights']) !== undefined;

  const attackers = [...arriving.entries()].filter(([id]) => id !== holder && !guest(id));
  const guests = [...arriving.entries()].filter(([id]) => guest(id));
  for (const [id, n] of arriving) if (id === holder) land(id, n);
  for (const [id, n] of guests) land(id, n);

  if (attackers.length === 0) {
    const who = [...arriving.keys()].map(nameOf).join(' and ');
    const note =
      guests.length > 0 && holder !== null
        ? `${guests.map(([id]) => nameOf(id)).join(' and ')} puts in at ${target.name} under basing rights.`
        : `${who} reinforces ${target.name}.`;
    logEvent(state, 'order', note, holder);
    return note;
  }

  const attackerIds = new Set(attackers.map(([id]) => id));
  const coalition = attackers.map(([id]) => nameOf(id)).join(' and ');
  let attackForce = attackers.reduce((sum, [, n]) => sum + n, 0);
  const attackShare = new Map(attackers);

  /* --- Pacts broken by this attack ------------------------------------- */
  // Attacking someone you have sworn peace with voids the pact, costs the
  // injured party's opinion, and costs your standing with everyone watching.
  for (const attackerId of attackerIds) {
    if (holder === null) continue;
    const pact = treatyBetween(state.treaties, state.turn, attackerId, holder, PEACE_TREATIES);
    if (!pact) continue;

    pact.status = 'broken';
    const injured = state.factions.find((f) => f.id === holder);
    if (injured) {
      injured.disposition[attackerId] = Math.max(-100, (injured.disposition[attackerId] ?? 0) - 25);
    }
    for (const witness of state.factions) {
      if (witness.id === attackerId || witness.id === holder) continue;
      witness.disposition[attackerId] = Math.max(
        -100,
        (witness.disposition[attackerId] ?? 0) - PACT_BREAKING_REPUTATION_COST,
      );
    }
    logEvent(
      state,
      'diplomacy',
      `${nameOf(attackerId)} breaks its ${pact.type.replace('_', ' ')} with ${nameOf(holder)} by attacking ${target.name}. The whole Rim notes it.`,
      attackerId,
    );
  }

  // Safe default: everyone else present is a defender.
  const defenders: [string, number][] = Object.entries(target.ships).filter(
    ([id, n]) => !attackerIds.has(id) && n > 0,
  );

  /* --- Mutual defence: pledged hulls are called in ---------------------- */
  // `shipsPledged` was a dead field: a treaty could promise a squadron and
  // nothing ever arrived. Pledged ships are drawn from the ally's nearest
  // holding and fight here — which is the whole point of the promise.
  if (holder !== null) {
    for (const treaty of state.treaties) {
      if (treaty.status !== 'active' || treaty.type !== 'mutual_defense') continue;
      if (!treaty.parties.includes(holder)) continue;

      const ally = treaty.parties.find((p) => p !== holder);
      if (!ally || attackerIds.has(ally)) continue;

      const pledged = treaty.terms.shipsPledged?.[ally] ?? 0;
      if (pledged <= 0) continue;

      // Never drawn from the system under attack: those hulls are already
      // counted among the defenders.
      const sent = removeShips(state, ally, pledged, target.id);
      if (sent <= 0) continue;
      target.ships[ally] = (target.ships[ally] ?? 0) + sent;
      const existing = defenders.find(([id]) => id === ally);
      if (existing) existing[1] += sent;
      else defenders.push([ally, sent]);

      logEvent(
        state,
        'diplomacy',
        `${nameOf(ally)} honours its mutual defence pact and commits ${sent} ships to ${target.name}.`,
        ally,
      );
    }
  }

  let defenceForce = defenders.reduce((sum, [, n]) => sum + n, 0);

  // Genuinely undefended: nobody in orbit AND nobody on the ground. An
  // unaligned world is NOT automatically this — the seed gives neutral worlds
  // garrisons of 2–5, and skipping the ground phase for them made every
  // neutral in the galaxy a free pickup whose militia you then inherited
  // intact. Unaligned means nobody speaks for it, not that nobody defends it.
  if (holder === null && defenceForce === 0 && target.garrison <= 0) {
    for (const [id, n] of attackers) land(id, n);
    const owner = strongest(attackShare);
    target.controllerFactionId = owner;
    const note = `${coalition} occupies ${target.name} unopposed; ${nameOf(owner)} takes possession.`;
    logEvent(state, 'order', note, owner);
    return note;
  }

  const roll = rollD20(state.turn, `combat:${systemId}:${state.turn}`);
  const bestMod = (ids: string[]): number =>
    ids.length === 0
      ? 0
      : Math.max(...ids.map((id) => statModifier(effectiveStats(state, id).might)));
  let attackMod = bestMod([...attackerIds]);
  const defendMod = bestMod(defenders.map(([id]) => id));

  // --- War ethics -------------------------------------------------------
  // Whose doctrine applies in a coalition is a real question: `bestMod` takes
  // the best modifier on each side, but a doctrine is not a stat and cannot be
  // borrowed. It is read off the LARGEST contingent, so a one-ship junior
  // partner cannot decide that nobody is allowed to retreat.
  const ethicOfFaction = (id: string | null): string | null =>
    id === null ? null : (state.factions.find((f) => f.id === id)?.warEthic ?? null);
  const largestAttacker =
    [...attackShare.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    null;
  const attackEthic = ethicOfFaction(largestAttacker);
  const holderEthic = ethicOfFaction(holder);

  // An opportunist avoids fair fights and is rewarded for picking unfair ones:
  // a world already stripped of its garrison, or a holder whose attention is on
  // somebody else entirely. Against a whole and undistracted defender it gets
  // nothing, which is what stops this being a flat buff.
  if (attackEthic === 'opportunist') {
    const weakened = target.garrisonMax > 0 && target.garrison * 2 < target.garrisonMax;
    const distracted =
      holder !== null && warsFor(state, holder).some((id) => !attackerIds.has(id));
    if (weakened || distracted) attackMod += OPPORTUNIST_MIGHT_BONUS;
  }

  // A retreating force loses 10–35% getting clear; bad luck costs more.
  const retreatLossPct = 10 + ((21 - roll) % 6) * 5;
  const bleed = (n: number): number => Math.max(0, n - Math.ceil((n * retreatLossPct) / 100));
  const notes: string[] = [];

  /* ---------- Phase 1: fleet battle ---------- */
  if (defenceForce > 0) {
    const swing = (roll - 10.5) / 22;
    const attackPower = attackForce * (1 + attackMod / 20) * (1 + swing);
    const defendPower = defenceForce * (1 + defendMod / 20) * (1 - swing);

    // A crusading power does not break off, in either direction. It wins
    // engagements it should have fled and loses fleets it should have saved —
    // the Iron Vigil fighting for the mandate rather than for the arithmetic.
    const defenderStands = holderEthic === 'crusading';
    const attackerStands = attackEthic === 'crusading';

    if (attackPower >= defendPower * 2 && !defenderStands) {
      let lost = 0;
      for (const [id, present] of defenders) {
        const escaped = bleed(present);
        lost += present - escaped;
        delete target.ships[id];
        const refuge = fleetBases(state, id).find(
          (x) => x.id !== target.id && x.controllerFactionId === id,
        );
        if (refuge && escaped > 0) refuge.ships[id] = (refuge.ships[id] ?? 0) + escaped;
      }
      notes.push(
        `${defenders.map(([id]) => nameOf(id)).join(' and ')} breaks off over ${target.name}, losing ${lost} ships between them.`,
      );
      defenceForce = 0;
    } else if (attackPower * 2 <= defendPower && !attackerStands) {
      // The coalition withdraws, each contingent back down its own path.
      let lost = 0;
      for (const order of orders) {
        if (!attackerIds.has(order.factionId)) continue;
        const escaped = bleed(order.force);
        lost += order.force - escaped;
        const fallback = order.path[Math.max(0, order.path.length - 2)] ?? order.originId;
        const refuge = state.systems.find((x) => x.id === fallback);
        if (refuge && escaped > 0) {
          refuge.ships[order.factionId] = (refuge.ships[order.factionId] ?? 0) + escaped;
        }
      }
      const note = `${coalition}'s attack on ${target.name} is driven off by its defenders, losing ${lost} ships.`;
      logEvent(state, 'order', note, attackers[0]![0]);
      return note;
    } else {
      const exchange = Math.min(attackPower, defendPower);
      const attackLeft = Math.max(0, attackForce - Math.ceil(exchange / (1 + attackMod / 20)));
      const defenceLeft = Math.max(0, defenceForce - Math.ceil(exchange / (1 + defendMod / 20)));
      notes.push(
        `Fleets engage over ${target.name}: ${coalition} loses ${attackForce - attackLeft} ships, the defenders lose ${defenceForce - defenceLeft}.`,
      );
      distribute(attackShare, attackForce, attackLeft);
      // Defender losses fall proportionally on each power present.
      let remaining = defenceLeft;
      defenders.forEach(([id, present], i) => {
        const share =
          i === defenders.length - 1
            ? remaining
            : Math.min(remaining, Math.round((present / defenceForce) * defenceLeft));
        remaining -= share;
        if (share > 0) target.ships[id] = share;
        else delete target.ships[id];
      });
      attackForce = attackLeft;
      defenceForce = defenceLeft;
    }
  }

  if (defenceForce > 0) {
    for (const [id, n] of attackShare) land(id, n);
    const note = `${notes.join(' ')} The defenders still hold the orbitals of ${target.name}; no landing is attempted.`.trim();
    logEvent(state, 'order', note, attackers[0]![0]);
    return note;
  }

  if (attackForce <= 0) {
    const note = `${notes.join(' ')} ${coalition}'s force is spent over ${target.name}.`.trim();
    logEvent(state, 'order', note, attackers[0]![0]);
    return note;
  }

  /* ---------- Phase 2: ground assault ---------- */
  const garrison = target.garrison;
  // A defensive power's ground is dug in: its garrison fights as though it were
  // half again its size, and costs the attacker accordingly. "Make occupation
  // cost more than it is worth" is the Arkanis doctrine written as arithmetic.
  // Only the real garrison is ever destroyed — the bonus buys resistance, not
  // extra troops to kill.
  const dugIn =
    holderEthic === 'defensive' ? Math.round(garrison * DEFENSIVE_GARRISON_BONUS) : garrison;
  const assault = attackForce * (1 + attackMod / 20) * (1 + (roll - 10.5) / 30);

  if (assault > dugIn) {
    const losses = Math.min(attackForce, Math.ceil(dugIn / 2));
    distribute(attackShare, attackForce, attackForce - losses);
    // Spoils go to whoever brought the most, counted on what survived.
    const owner = strongest(attackShare);
    target.controllerFactionId = owner;
    // An expansionist consolidates what it takes: the world comes with a
    // stronger occupation force, so conquest sticks instead of needing
    // re-garrisoning the moment the fleet moves on.
    const kept = attackEthic === 'expansionist' ? Math.floor(garrison / 2) : Math.floor(garrison / 3);
    target.garrison = Math.max(1, kept);
    for (const [id, n] of attackShare) land(id, n);
    const note = `${notes.join(' ')} ${coalition} storms ${target.name}, breaking a garrison of ${garrison} for ${losses} ships; ${nameOf(owner)} takes possession.`.trim();
    logEvent(state, 'order', note, owner);
    return note;
  }

  const losses = Math.min(attackForce, Math.ceil(attackForce / 3));
  target.garrison = Math.max(0, garrison - Math.ceil(attackForce / 4));
  distribute(attackShare, attackForce, attackForce - losses);
  for (const [id, n] of attackShare) land(id, n);
  const note = `${notes.join(' ')} ${coalition}'s landing on ${target.name} is thrown back by its garrison; ${losses} ships lost.`.trim();
  logEvent(state, 'order', note, attackers[0]![0]);
  return note;
}

/** Scale a coalition's contingents down to a new total, largest-remainder. */
function distribute(share: Map<string, number>, before: number, after: number): void {
  if (before <= 0) return;
  let remaining = after;
  const ids = [...share.keys()];
  ids.forEach((id, i) => {
    const had = share.get(id)!;
    const now =
      i === ids.length - 1 ? remaining : Math.min(remaining, Math.round((had / before) * after));
    remaining -= now;
    share.set(id, Math.max(0, now));
  });
}

/**
 * Who owns a captured world: the contingent that brought the most.
 * Ties break on faction id so replay stays exact.
 */
function strongest(share: Map<string, number>): string {
  return [...share.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

