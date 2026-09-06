import {
  MAX_DURATION,
  accelerationCost,
  applyCategoryFloor,
  dropOneBucket,
  isFibScale,
  toFibBucket,
  type DurationCategory,
  type FibScale,
} from './duration.js';
import {
  COMMITMENT_GOODWILL,
  conflictingCommitment,
  MAX_COMMITMENT_INCOME,
} from './arbitration.js';
import type {
  BattleOutcome,
  BattleReport,
  BattleRound,
  Contingent,
} from './battle.js';
import { driftingCompulsions } from './compulsions.js';
import {
  instalment,
  isDebtLive,
  MAX_DEBT_PER_TURN,
  MAX_DEBT_PRINCIPAL,
} from './debt.js';
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
  isTreatyLive,
  treatyBetween,
  type Treaty,
  type VoidCondition,
} from './diplomacy.js';
import { jumpsBetween, neighboursOf, positionAlongPath, shortestPath } from './graph.js';
import { routeEarnings, tradeRoutes } from './trade.js';
import {
  CREDITS_PER_TON,
  HULL_CLASSES,
  HULL_SPEC,
  LIFTER_CARRY,
  UPKEEP_PER_TON,
  carryOf,
  describeStack,
  drawProportional,
  hullsIn,
  mergeStacks,
  normaliseStack,
  orbitalWeightOf,
  stackCost,
  strikeStack,
  subtractStack,
  tonsOfClass,
  torpedoStrike,
  takeHulls,
  tonsIn,
  trimToTons,
  type HullClass,
  type ShipStack,
} from './hulls.js';
import { isPublicOrderType } from './intel.js';
import {
  EXTRACTION_ALLOWED,
  EXTRACTION_REFUSAL_REASON,
  OpSchema,
  REDUCER_ONLY_OPS,
  type Op,
  type OpRejection,
} from './ops.js';
import {
  shipsAt,
  presentAt,
  addShipsAt,
  addStackAt,
  hullsAt,
  setShipsAt,
  setStackAt,
  stackAt,
  takeShipsAt,
  tonsAt,
  fleetTonsOf,
  commitmentsOf,
  maxCommitmentIncomeFor,
  effectiveStats,
  fleetBases,
  isGuestOf,
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
  MAX_TREATY_INCOME_PER_TURN,
  isMovementType,
  ledgerFor,
  liveAgentsOf,
  maxAgentsFor,
  subornLimit,
  type EventLogEntry,
  type Ledger,
  type OrderEffect,
  type PendingOrder,
  type WorldState,
} from './state.js';

/**
 * Where a batch came from, which some guards depend on.
 *
 * `extraction` is the diplomacy pass at `/endtalk`: it is handed a transcript
 * and asked what the two powers actually agreed to, so it is the only
 * model-driven source whose ops carry another faction's consent. `form_treaty`
 * is reachable from it and from nowhere else a model can reach.
 */
export type OpSource = 'model' | 'engine' | 'extraction';

/**
 * What being let off a debt is worth to the debtor.
 *
 * Forgiveness has to buy something real, or the Ojjul Nar's refusal to use it
 * is not a sacrifice and the red line costs them nothing to hold.
 */
export const DEBT_FORGIVENESS_GOODWILL = 20;

/** What defaulting costs the debtor in the creditor's eyes, per missed payment. */
export const DEBT_DEFAULT_DISPOSITION_COST = 6;

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
  const at = shipsAt(state, order.factionId, order.targetId);
  if (order.type === 'blockade') return at;
  const nearby = neighboursOf(state, order.targetId).reduce(
    (n, id) => n + shipsAt(state, order.factionId, id),
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

/**
 * What a power loses in standing for taking terms at gunpoint.
 *
 * A lopsided-Vigil playtest put the identical ultimatum to all four powers with
 * 1,020 hulls against 24–39. Three of them conceded — and **the two that
 * conceded most ended the turn better disposed toward the Vigil than before**,
 * because the only thing moving disposition after a negotiation was the
 * extraction pass rewarding a constructive conversation. Nothing anywhere
 * modelled resentment at being coerced, so bullying a neighbour into tribute
 * was rewarded in standing for having been done politely.
 *
 * Charged **per treaty signed under duress**, to the coercer, with the party
 * that signed. Duress is not a judgement the model makes: it is
 * `underDuressFrom` below, hostile ships sitting on your worlds — the same
 * presence test interdiction and suborning already use.
 *
 * Small on purpose, and the reason is `DISSENT_DECAY`'s opposite: disposition
 * has **no decay at all**, so this never fades. A power that habitually extorts
 * its neighbours accumulates a permanent debt of ill will, which is the intended
 * reading — but it means one signature should be a grievance rather than a
 * catastrophe. Deliberately larger than `TOLL_RESENTMENT`, since a fleet in
 * orbit is not a tariff, and well under `PACT_BREAKING_REPUTATION_COST` (10),
 * since signing under pressure is not betrayal.
 */
export const COERCION_RESENTMENT = 6;

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
  /** Who may read it. Omit for public — see `EventLogEntrySchema.visibleTo`. */
  visibleTo: string[] | null = null,
): void {
  state.eventLog.push({ turn: state.turn, kind, factionId, text, visibleTo });
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

/**
 * Deterministic ids for treaties, agents, commitments and debts, on the same
 * scheme as orders.
 *
 * Every id-bearing collection has to be in the pool. Debts were added to world
 * state and not added here, so two debts minted in one turn both came out
 * `debt-0-0` — found by an adversarial playtest that negotiated a debt
 * restructuring, which emitted two `establish_debt` ops in a single extraction
 * batch. The ledger entries were distinct and both ticked correctly, so nothing
 * looked wrong until something tried to address one by id: `forgive_debt` on a
 * duplicated id resolves to whichever the reducer finds first.
 */
function mintId(state: WorldState, prefix: string): string {
  const stem = `${prefix}-${state.turn}-`;
  const pool = [
    ...state.treaties.map((t) => t.id),
    ...state.agents.map((a) => a.id),
    ...(state.commitments ?? []).map((c) => c.id),
    ...(state.debts ?? []).map((d) => d.id),
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
    .filter((s) => s.id !== exceptSystemId && (hullsAt(s, factionId)) > 0)
    .sort((a, b) => (hullsAt(b, factionId)) - (hullsAt(a, factionId)) || a.id.localeCompare(b.id));
  for (const base of bases) {
    if (owed <= 0) break;
    const here = hullsAt(base, factionId);
    const take = Math.min(here, owed);
    setShipsAt(base, factionId, here - take);
    owed -= take;
  }
  return count - owed;
}

/**
 * The same, but says which ships it drew rather than only how many.
 *
 * A mutual-defence pledge has to arrive as a real squadron: `shipsPledged` is a
 * count, and the hulls it pulls out are whatever the ally had spare, so the
 * composition is discovered rather than chosen.
 */
function drawShips(
  state: WorldState,
  factionId: string,
  count: number,
  exceptSystemId?: string,
): ShipStack {
  let owed = count;
  let drawn: ShipStack = {};
  const bases = [...state.systems]
    .filter((s) => s.id !== exceptSystemId && hullsAt(s, factionId) > 0)
    .sort((a, b) => hullsAt(b, factionId) - hullsAt(a, factionId) || a.id.localeCompare(b.id));
  for (const base of bases) {
    if (owed <= 0) break;
    const take = Math.min(hullsAt(base, factionId), owed);
    drawn = mergeStacks(drawn, takeShipsAt(base, factionId, take));
    owed -= take;
  }
  return drawn;
}

/**
 * The single entry point for state change. Pure: the input state is never
 * mutated, and the same (state, ops) always yields the same result.
 *
 * Invalid ops are collected as structured rejections and returned — never
 * silently dropped — so the caller can feed them back to the model on retry.
 */
/**
 * A negotiated handover of systems, applied when a treaty comes into force.
 *
 * `Treaty.terms.territory` existed for the whole life of the project and
 * **nothing read it** — a playtest signed an accord listing four systems, two
 * of which the player did not even hold, and no controller changed. It is now
 * a real cession.
 *
 * The obvious objection is the invariant that control changes *only* when a
 * `fleet_movement` arrives, which is enforced three times over. That rule
 * exists to stop a model talking itself into owning a system across the galaxy,
 * and a cession does not do that: it arrives from a transcript, which is the
 * one place the other party's consent exists — the same argument that makes
 * `form_treaty` extraction-only. Control still never changes from a declared
 * action.
 *
 * What happens to what is standing there is decided by the rule the game
 * already uses for the violent case, minus the blood:
 *
 * - **The garrison transfers intact.** Nobody fought. This is the whole
 *   difference between capitulation and conquest, and it is what makes a ceded
 *   world worth more than a stormed one, where the garrison is destroyed and
 *   the conqueror keeps a fraction.
 * - **The ceder's ships withdraw to their nearest holding, with no losses**,
 *   because there was no battle to escape. A defender that breaks off is moved
 *   instantly by exactly this route and pays 10–35% for the privilege; leaving
 *   under a signature costs nothing.
 * - **If there is nowhere to go they stay in orbit**, an uninvited presence
 *   contesting the income of a world they no longer own, until they leave or
 *   are cleared. The violent path destroys such ships; doing that here would
 *   make cession a trap rather than a bargain.
 *
 * Only what the ceder actually holds moves. Anyone else's ships in the system
 * are untouched and simply become a foreign presence in the new owner's space,
 * which needs no special rule.
 */
/**
 * Whether a void condition has come true, and the sentence explaining it.
 *
 * Returns the reason rather than a boolean so the event log can say *why* a
 * treaty ended — "voided" with no cause is exactly the kind of silent state
 * change this project keeps having to dig out of playtests.
 */
/**
 * Whether `victim` is signing with a fleet on its throat.
 *
 * Hostile ships sitting in systems the victim controls, which is the same
 * presence test interdiction and suborning draw — deliberately mechanical
 * rather than a reading of the transcript, because "were they threatened" is
 * exactly the judgement a model would be talked out of.
 *
 * A guest under `basing_rights` or `mutual_defense` is not coercion: those
 * ships were invited, and `isGuestOf` already knows the difference.
 */
/**
 * Move every bound party's view of every other bound party by `delta`.
 *
 * A commitment binds people to each other, so the standing it creates is
 * mutual and pairwise. A one-party commitment — a standing policy, a charter
 * over your own space — binds nobody else and moves nothing.
 */
function adjustCommitmentGoodwill(
  state: WorldState,
  factionIds: string[],
  delta: number,
  notes: string[],
): void {
  if (factionIds.length < 2) return;
  for (const id of factionIds) {
    const faction = state.factions.find((f) => f.id === id);
    if (!faction) continue;
    for (const other of factionIds) {
      if (other === id) continue;
      if (!state.factions.some((f) => f.id === other)) continue;
      faction.disposition[other] = Math.max(
        -100,
        Math.min(100, (faction.disposition[other] ?? 0) + delta),
      );
    }
  }
  notes.push(
    delta >= 0
      ? `Bound together: ${factionIds.join(' and ')} each gain ${delta} disposition.`
      : `No longer bound: ${factionIds.join(' and ')} each lose ${-delta} disposition.`,
  );
}

function underDuressFrom(state: WorldState, coercer: string, victim: string): number {
  let worlds = 0;
  for (const system of state.systems) {
    if (system.controllerFactionId !== victim) continue;
    if ((hullsAt(system, coercer)) <= 0) continue;
    if (isGuestOf(state, coercer, victim)) continue;
    worlds += 1;
  }
  return worlds;
}

/**
 * Retire the treaty this one replaces.
 *
 * Powers renegotiate constantly and say so — both parties to a live playtest
 * accord used the word "supersedes" out loud — and nothing acted on it. The
 * result was two `tribute` treaties between the same pair, both paying: Arkane
 * believed it paid 40 and paid 65, the Combine believed 55 and paid 95, and the
 * ending duly listed "tribute with Drajk Confederacy" twice.
 *
 * Supersession already existed and was scoped to `incomeShares` — a new grant
 * of the same system to the same faction retired the old one. It never looked
 * at anything else, so every other recurring term stacked.
 *
 * **"One live treaty per (pair, type)" is the tempting rule and it is wrong.**
 * Two `trade_accord`s between the same powers granting *different lanes* are two
 * deals, not a renegotiation, and a test has pinned that since item 26. What
 * cannot coexist is two treaties doing the same recurring thing to the same
 * pair. So the test is on the **footprint**:
 *
 * - a term that flows between the parties as a whole — `incomePerTurn`,
 *   `shipsPledged`, `mutualDefenseTrigger` — there is one such flow, and a
 *   second treaty carrying it is a double-count;
 * - a type that carries no recurring terms at all — `non_aggression`,
 *   `ceasefire`, `basing_rights` — where the treaty *is* the status, so a
 *   second one is a pure duplicate.
 *
 * `incomeShares` is deliberately absent: it is keyed by system and already has
 * its own, narrower supersession. `territory` is a one-time cession and cannot
 * recur.
 *
 * Called where a treaty becomes ACTIVE rather than where it is created: a
 * `pending` treaty must not retire the live one it will replace, or the parties
 * would have nothing in force while a council deliberates.
 */
function pairLevelFootprint(t: Treaty): string[] {
  const marks: string[] = [];
  if (Object.values(t.terms.incomePerTurn).some((v) => v !== 0)) marks.push('incomePerTurn');
  if (Object.values(t.terms.shipsPledged).some((v) => v > 0)) marks.push('shipsPledged');
  if (t.terms.mutualDefenseTrigger !== '') marks.push('mutualDefenseTrigger');
  // A treaty with no recurring term and no per-system grant is its own status:
  // a second one of the same type between the same powers says nothing new.
  if (marks.length === 0 && t.terms.incomeShares.length === 0) marks.push('the pact itself');
  return marks;
}

function supersedePriorTreaties(
  state: WorldState,
  incoming: Treaty,
  notes: string[],
): void {
  const mine = pairLevelFootprint(incoming);
  if (mine.length === 0) return;

  for (const prior of state.treaties) {
    if (prior.id === incoming.id) continue;
    if (prior.status !== 'active') continue;
    if (prior.type !== incoming.type) continue;
    if (prior.parties.length !== incoming.parties.length) continue;
    if (!incoming.parties.every((party) => prior.parties.includes(party))) continue;

    const clash = pairLevelFootprint(prior).filter((m) => mine.includes(m));
    if (clash.length === 0) continue;

    prior.status = 'superseded';
    const note = `Superseded ${prior.id}: the ${prior.type.replace(/_/g, ' ')} between ${prior.parties.join(' and ')} is now set by the new accord, not added to it (${clash.join(', ')}).`;
    notes.push(note);
    logEvent(state, 'diplomacy', note, incoming.parties[0]);
  }
}

function voidConditionMet(state: WorldState, condition: VoidCondition): string | null {
  const name = (id: string): string =>
    state.factions.find((f) => f.id === id)?.name ?? id;

  switch (condition.kind) {
    case 'treaty_with': {
      const bound = (state.treaties ?? []).some(
        (t) =>
          isTreatyLive(t, state.turn) &&
          t.parties.includes(condition.by) &&
          t.parties.includes(condition.target),
      );
      return bound
        ? `${name(condition.by)} is now bound by treaty to ${name(condition.target)}`
        : null;
    }
    case 'attacks': {
      const atWar = warsFor(state, condition.by).includes(condition.target);
      return atWar ? `${name(condition.by)} is at war with ${name(condition.target)}` : null;
    }
    case 'insolvent': {
      // Read from the ledger rather than the treasury: a faction can be sitting
      // on savings while running at a loss, and it is the loss that means the
      // obligation has stopped being funded.
      const net = ledgerFor(state, condition.by).net;
      return net < 0
        ? `${name(condition.by)} is running at a loss (${net} a turn) and can no longer fund it`
        : null;
    }
  }
}

function cedeTerritory(state: WorldState, treaty: Treaty): string[] {
  const notes: string[] = [];
  if (treaty.terms.territory.length === 0) return notes;

  // Two parties, so the receiver is whichever one is not the holder.
  for (const systemId of treaty.terms.territory) {
    const system = state.systems.find((sys) => sys.id === systemId);
    if (!system) continue;
    const ceder = system.controllerFactionId;
    // You can only cede what you hold. A treaty naming a world neither party
    // controls is a claim, not a transfer, and quietly does nothing.
    if (!ceder || !treaty.parties.includes(ceder)) continue;
    const receiver = treaty.parties.find((party: string) => party !== ceder);
    if (!receiver) continue;

    system.controllerFactionId = receiver;

    const leaving = hullsAt(system, ceder);
    if (leaving > 0) {
      const refuge = fleetBases(state, ceder).find(
        (x) => x.id !== system.id && x.controllerFactionId === ceder,
      );
      if (refuge) {
        setShipsAt(system, ceder, 0);
        addShipsAt(refuge, ceder, leaving);
        notes.push(
          `${ceder} cedes ${system.name} to ${receiver}; ${leaving} ships withdraw to ${refuge.name}.`,
        );
      } else {
        notes.push(
          `${ceder} cedes ${system.name} to ${receiver}, but has nowhere to send its ${leaving} ships; they remain in orbit over a world they no longer hold.`,
        );
      }
    } else {
      notes.push(`${ceder} cedes ${system.name} to ${receiver}.`);
    }

    logEvent(state, 'diplomacy', notes[notes.length - 1]!, receiver);
  }
  return notes;
}

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
  /**
   * Apply the batch as one unit: if any op is rejected, none of them land.
   *
   * The reducer treats a batch as a flat list of independent ops, which is
   * right when they are independent — moving ships here and there — and wrong
   * for the common case where they are one action's parts and some of them are
   * only justified by the others. Measured live: a `develop_system` order was
   * rejected for `insufficient_credits`, and its sibling `adjust_credits +120`
   * for "surplus conversion materiel" landed anyway. Free money as a byproduct
   * of a rejected op.
   *
   * Nothing expresses which ops depend on which — the model emits a flat list —
   * so the only dependency unit actually available is the batch, and a batch is
   * one declared action. Treating it as atomic is the honest reading.
   *
   * **Off by default, and deliberately so.** Replay re-runs recorded batches,
   * and a journal written before this existed recorded batches that really did
   * apply partially. Those must replay as they ran; `replay()` passes this
   * according to the journal version. See `JOURNAL_VERSION`.
   */
  atomic = false,
): ApplyResult {
  const state = clone(input);
  const rejections: OpRejection[] = [];
  const notes: string[] = [];

  // A rejection has to outlive an atomic rollback. `reject()` writes its entry
  // into the working state, and the rollback returns `clone(input)` — so the
  // discard that correctly removes the ops was also removing the only account
  // of why they were removed. Measured on `saves/spy_playtest.json`: six
  // rejections during replay, **zero** `rejection` entries in a 127-entry log,
  // which is why the browser's filter for that kind had never had anything to
  // show. Collected separately so both exits can carry them.
  //
  // Deliberately only `reject()`. `capSelfInflictedLosses` logs under the same
  // kind, but it describes a trim that did not happen when the batch is held
  // back — it is dropped with the state it describes, exactly as its note is.
  const rejectionEvents: EventLogEntry[] = [];

  const reject = (op: unknown, code: OpRejection['code'], message: string): void => {
    rejections.push({ op, code, message });
    const entry: EventLogEntry = {
      turn: state.turn,
      kind: 'rejection',
      factionId: null,
      text: `[${code}] ${message}`,
      visibleTo: null,
    };
    rejectionEvents.push({ ...entry });
    state.eventLog.push(entry);
  };

  const factionExists = (id: string): boolean => state.factions.some((f) => f.id === id);
  const systemExists = (id: string): boolean => state.systems.some((s) => s.id === id);

  // Hull counts before anything is applied, so new construction can be billed
  // afterwards. Counted per faction across the whole batch rather than per op,
  // which is what makes repositioning free: `adjust_ships -5` here and `+5`
  // there nets to zero and costs nothing, however the ops are ordered.
  const hullsBefore = new Map(state.factions.map((f) => [f.id, fleetTonsOf(state, f.id)]));
  // Per-system counts too, so `capSelfInflictedLosses` can put restored hulls
  // back where they were taken from rather than at the faction's best world.
  // Deep enough to survive the batch: the values are stacks now, so a shallow
  // copy of the record would hand back objects the batch goes on to mutate.
  const shipsBefore = new Map(
    state.systems.map((sys) => [
      sys.id,
      Object.fromEntries(Object.entries(sys.ships).map(([id, st]) => [id, { ...st }])),
    ]),
  );

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

    // An accord may only produce what needs the other party's agreement, or
    // what is purely a record of the conversation. The mirror of
    // `needs_consent`: that rejects a DECLARED op which needs someone else's
    // agreement; this rejects a NEGOTIATED op which needs nobody's, because
    // that is unilateral work the action economy already prices at the moment
    // it is declared.
    //
    // This was one exception — `fleet_movement` — and everything else walked
    // through. Measured live: a channel closed with `actionPoints: {left: 0}`
    // issued a `courier` order and the count stayed at zero, so 13 of the 14
    // order types were reachable free, along with a red-line probe that cost
    // nothing because a refused accord spends no action point either.
    if (source === 'extraction' && !EXTRACTION_ALLOWED.has(op.op)) {
      reject(
        raw,
        'declared_only',
        EXTRACTION_REFUSAL_REASON[op.op] ??
          `"${op.op}" needs nobody's agreement, so it cannot come out of a negotiation. Declare it on your own turn, where it costs an action.`,
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
          addShipsAt(home, op.factionId, op.delta, op.hull);
        } else {
          let owed = -op.delta;
          for (const base of [...bases].sort(
            (a, b) => (hullsAt(b, op.factionId)) - (hullsAt(a, op.factionId)) || a.id.localeCompare(b.id),
          )) {
            if (owed <= 0) break;
            const here = hullsAt(base, op.factionId);
            const take = Math.min(here, owed);
            if (take <= 0) continue;
            setShipsAt(base, op.factionId, here - take);
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
        const wasDissent = f.dissent;
        f.dissent = Math.max(0, Math.min(100, f.dissent + op.delta));
        // Dissent movements were not logged at all. Only the drift trigger
        // wrote a line, so a refusal (+8) and a compulsion breach (+15) left no
        // record — a playtest went 25 -> 28 -> 45 -> 69 with the log accounting
        // for +9 of it, for the mechanic this project calls the most successful
        // in the build. A number the engine changes and nobody can audit is the
        // same defect as a check nobody can audit.
        if (f.dissent !== wasDissent) {
          logEvent(
            state,
            'system',
            `${f.name}: dissent ${wasDissent} -> ${f.dissent}/100 (${op.delta >= 0 ? '+' : ''}${op.delta}). ${op.reason}`.trim(),
            f.id,
          );
        }
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
          const present = (hullsAt(site, op.factionId)) > 0;
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
        let force: ShipStack = {};

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
          //
          // The force is COMPOSED, because the ground phase asks a question a
          // total cannot answer. `op.force` may name classes — the only way to
          // send guns and no transports, or the reverse — and a bare number
          // still means "this many ships", drawn proportionally so the
          // squadron that sails is the squadron that was there.
          const origin = state.systems.find((sys) => sys.id === op.originId)!;
          const inPort = stackAt(origin, op.factionId);
          const available = hullsIn(inPort);
          const wantStack: ShipStack =
            op.force === undefined || typeof op.force === 'number'
              ? inPort
              : normaliseStack(op.force);
          const asked = typeof op.force === 'number' ? op.force : hullsIn(wantStack);
          force =
            op.force === undefined
              ? normaliseStack(inPort)
              : typeof op.force === 'number'
                ? drawProportional(inPort, op.force)
                : // Named classes are trimmed per class: asking for six lifters
                  // where two are berthed sends the two, and does not make up
                  // the difference out of the battle line.
                  normaliseStack(
                    Object.fromEntries(
                      HULL_CLASSES.map((h) => [h, Math.min(wantStack[h] ?? 0, inPort[h] ?? 0)]),
                    ) as ShipStack,
                  );
          if (hullsIn(force) <= 0) {
            reject(
              raw,
              'illegal_value',
              `${op.factionId} has no ships at ${op.originId} to move.`,
            );
            break;
          }
          if (asked > hullsIn(force)) {
            const note = `Requested ${asked} ships from ${origin.name} but only ${describeStack(force) || available} could sail; sending ${describeStack(force)}.`;
            notes.push(note);
            logEvent(state, 'system', note, op.factionId);
          }
          setStackAt(
            origin,
            op.factionId,
            Object.fromEntries(
              HULL_CLASSES.map((h) => [h, (inPort[h] ?? 0) - (force[h] ?? 0)]),
            ) as ShipStack,
          );
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
            // The ORDER still goes out; only the payload is dropped. Exactly
            // the rule `boundPayloadsToOutcome` applies when the check failed —
            // "the order itself is never dropped, only its payload" — and it
            // was inconsistent here: the same situation was answered two ways
            // depending on *why* the payload could not be delivered, and the
            // affordability branch threw the whole order away.
            //
            // Quote the price. A development that crosses into hub status can
            // cost several turns of income, and "you cannot afford it" is only
            // actionable if the player is told what it would have taken.
            const asked = priceOrderEffect(state, site, op.factionId, op.onComplete);
            const note = `${op.onComplete.kind} at ${site.name} would cost ${asked} credits and ${op.factionId} has ${treasury.credits}; the order goes out with nothing commissioned.`;
            notes.push(note);
            logEvent(state, 'clamp', note, op.factionId);
          } else {
            effect = trim.effect;
            invested = trim.cost;
            treasury.credits -= invested;
            if (trim.from !== undefined) {
              const why =
                trim.reason === 'cap'
                  ? 'that is the most one programme can deliver'
                  : 'that is all the treasury could cover';
              const trimNote = `Trimmed ${op.onComplete.kind} from ${trim.from} to ${effect.magnitude}; ${why}.`;
              notes.push(trimNote);
              logEvent(state, 'clamp', trimNote, op.factionId);
            }
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
        // Secret work is logged for the people who can see it and nobody else.
        // This line named the label, duration, target, payload and price of an
        // order the fog had just redacted out of `pendingOrders` — so the
        // redaction was decorative for anyone who read the log.
        logEvent(
          state,
          'order',
          `${op.factionId} begins ${order.label} (${duration} turns) -> ${op.targetId}${delivers}.`,
          op.factionId,
          isPublicOrderType(order.type) ? null : [op.factionId, ...order.visibility],
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
        if (isMovementType(removed!.type) && hullsIn(removed!.force) > 0) {
          const home = state.systems.find((sys) => sys.id === removed!.originId);
          if (home) {
            addStackAt(home, removed!.factionId, removed!.force);
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
        // Clamped to the documented ceiling. This was a bare `+=`, so an order
        // could be extended without limit — a playtest inherited one at 10
        // turns against `MAX_DURATION` 5 and "Nothing takes longer than 5
        // turns", and an unbounded `remaining` was the multiplier on the
        // interrupt-refund exploit.
        const wanted = order.durationTurns + op.additionalTurns;
        order.durationTurns = Math.min(wanted, MAX_DURATION);
        if (wanted > order.durationTurns) {
          const trim = `${order.label} cannot run past ${MAX_DURATION} turns; extended to ${order.durationTurns} rather than ${wanted}.`;
          notes.push(trim);
          logEvent(state, 'clamp', trim, order.factionId);
        }
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
        // A treaty binds a power other than the actor, and consent is a thing
        // only a conversation can establish. Measured live: "sign a mutual
        // defence pact with the Iron Vigil" was priced as an influence check at
        // DC 17 against a power at -45 disposition, and a good roll would have
        // bound them to it — pledged hulls, income and all — without the Vigil
        // ever being asked. The op is absent from `ModelOpSchema` for that
        // reason; this is the reducer saying the same thing, so a journal or a
        // hand-written batch cannot route around it either.
        if (source === 'model') {
          reject(
            raw,
            'needs_consent',
            'A treaty cannot be declared into existence: the other party has to agree to it. Open a channel with them (/talk) and negotiate — the ops are emitted from what is actually agreed there.',
          );
          break;
        }
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
        // A per-turn flow is the one treaty term that compounds, and it was
        // unbounded — which made it strictly the better way to move money out
        // of a negotiation than the capped one-off `adjust_credits`. Trimmed
        // rather than rejected: the arrangement is still real at a smaller
        // number, the same shape as `MAX_COMMITMENT_INCOME`.
        const terms = { ...op.terms, incomePerTurn: { ...op.terms.incomePerTurn } };
        for (const [who, amount] of Object.entries(terms.incomePerTurn)) {
          const bounded = Math.max(
            -MAX_TREATY_INCOME_PER_TURN,
            Math.min(MAX_TREATY_INCOME_PER_TURN, amount),
          );
          if (bounded !== amount) {
            terms.incomePerTurn[who] = bounded;
            const note = `Trimmed a treaty flow of ${amount} to ${bounded} per turn for ${who} (ceiling ${MAX_TREATY_INCOME_PER_TURN}).`;
            notes.push(note);
            logEvent(state, 'clamp', note, who);
          }
        }

        // A treaty flow is a TRANSFER, and it has to conserve.
        //
        // Nothing required the entries to sum to zero, so a negotiated "joint
        // venture that pays both houses" landed as `{drajk: 30, meridian: 20}`
        // — both positive, from nowhere. A playtest closed four of them and
        // conjured 480 credits a turn galaxy-wide, roughly a sixth of the
        // economy, at a cost of zero action points because diplomacy is
        // unmetered. No NPC ever objected: in fiction the arrangement is
        // Pareto-improving, so all four counterparties negotiated the number
        // *upward*.
        //
        // **Both parties profiting is a legitimate deal — it just is not this
        // field.** The game has three income mechanisms and this one was
        // silently absorbing all three, while being the most generous:
        //
        // - a joint venture that pays both sides is an `establish_commitment`,
        //   whose `incomePerTurn` is deliberately ONE scalar every bound
        //   faction reads the same way, bounded at `MAX_COMMITMENT_INCOME` and
        //   again by an influence-derived per-faction ceiling — precisely
        //   because a commitment is the easiest place in the game for a model
        //   to invent revenue;
        // - a share of one world's take is `incomeShares`, conserved by that
        //   system's own worth;
        // - a transfer is this, and it exists at all *because* a commitment
        //   cannot be directional. `MAX_TREATY_INCOME_PER_TURN` is literally
        //   `MAX_DEBT_PER_TURN`: the ceiling was inherited from debt service.
        //
        // The direction is never guessed. If nothing is being paid, the term
        // creates value and belongs in a commitment, so it is dropped and the
        // treaty stands without it — flipping a party negative would invert a
        // deal both sides agreed to, and which party to flip is a coin toss.
        const flows = Object.entries(terms.incomePerTurn);
        const paid = flows.reduce((n, [, v]) => n + Math.min(0, v), 0);
        const received = flows.reduce((n, [, v]) => n + Math.max(0, v), 0);
        if (received > -paid) {
          if (paid === 0) {
            terms.incomePerTurn = {};
            const note = `A treaty flow paying ${received} per turn with nobody paying it is an arrangement, not a transfer; the treaty stands without it. Record it with establish_commitment, which prices what an arrangement is worth.`;
            notes.push(note);
            logEvent(state, 'clamp', note, op.parties[0]);
          } else {
            // Something IS being paid, so the deal has a direction; the
            // receipts are simply larger than it. Trim them to what is
            // actually leaving a treasury, largest first so the order is
            // deterministic.
            let over = received + paid;
            for (const [who] of flows
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
              if (over <= 0) break;
              const cut = Math.min(over, terms.incomePerTurn[who]!);
              terms.incomePerTurn[who]! -= cut;
              over -= cut;
              if (terms.incomePerTurn[who] === 0) delete terms.incomePerTurn[who];
            }
            const note = `Trimmed a treaty's receipts to the ${-paid} per turn actually being paid; a transfer cannot pay out more than it takes in.`;
            notes.push(note);
            logEvent(state, 'clamp', note, op.parties[0]);
          }
        }

        // Renegotiating a charter added a second treaty and left the first
        // live, so the same system paid the same faction twice and the share
        // ratcheted upward every time it was renegotiated — while the op's own
        // summary said "superseding the prior arrangement". Nothing superseded
        // anything, and the counterparty was never asked whether the old one
        // ended. A new grant of the same system to the same faction, between
        // the same parties, now retires the older grant explicitly.
        for (const share of terms.incomeShares) {
          for (const prior of state.treaties) {
            if (prior.status !== 'active') continue;
            if (prior.parties.length !== op.parties.length) continue;
            if (!op.parties.every((party) => prior.parties.includes(party))) continue;
            if (
              !prior.terms.incomeShares.some(
                (s) => s.systemId === share.systemId && s.factionId === share.factionId,
              )
            ) {
              continue;
            }
            prior.status = 'superseded';
            const note = `Superseded ${prior.id}: ${share.factionId}'s share of ${share.systemId} is now set by the new accord.`;
            notes.push(note);
            logEvent(state, 'diplomacy', note, share.factionId);
          }
        }

        // A treaty whose void condition is ALREADY true is not a treaty.
        //
        // `voidConditionMet` had one caller, in `tickTurn`, so such a deal was
        // recorded `active`, announced, shown in the panel, and killed on the
        // next tick — having paid nothing and been believed by both parties.
        // Measured live: a 15/turn toll voided on the tick it was signed
        // because its `attacks` condition already held at signature, and the
        // counterparty's next reaction described it as an arrangement it was
        // honouring.
        //
        // Refused rather than recorded-and-voided, because a silently void
        // treaty IS the phantom-belief problem. Under atomic batching this
        // fails the accord and the correction pass is told exactly why, so the
        // deal gets re-expressed without the impossible clause instead of
        // evaporating.
        const alreadyVoid = terms.voidsOn
          .map((condition) => voidConditionMet(state, condition))
          .find((why): why is string => why !== null);
        if (alreadyVoid !== undefined) {
          reject(
            raw,
            'already_void',
            `That treaty voids the moment it is signed: ${alreadyVoid}. Drop the condition or settle what triggers it first.`,
          );
          break;
        }

        // A deal agreed subject to ratification is recorded now and inert until
        // its effective turn. `isTreatyLive` gates on `status === 'active'`, so
        // `pending` costs nothing anywhere else.
        const effectiveTurn =
          op.ratifyTurns === undefined ? null : state.turn + op.ratifyTurns;
        const pending = effectiveTurn !== null && effectiveTurn > state.turn;

        const treaty = {
          id: mintId(state, 'tre'),
          type: op.treatyType,
          parties: [...op.parties],
          terms,
          signedTurn: state.turn,
          expiresTurn: op.durationTurns === undefined ? null : state.turn + op.durationTurns,
          effectiveTurn,
          status: (pending ? 'pending' : 'active') as
            | 'active'
            | 'expired'
            | 'broken'
            | 'superseded'
            | 'pending',
          summary: op.summary || `${op.treatyType.replace(/_/g, ' ')} between ${op.parties.join(' and ')}`,
        };
        state.treaties.push(treaty);
        // One live treaty per (pair, type). A pending one supersedes nothing
        // yet — it does so when it is promoted in `tickTurn`, or the parties
        // would have nothing in force while the council deliberates.
        if (!pending) supersedePriorTreaties(state, treaty, notes);
        logEvent(
          state,
          'diplomacy',
          pending
            ? `Treaty agreed, pending ratification on turn ${effectiveTurn}: ${treaty.summary}.`
            : `Treaty signed: ${treaty.summary}.`,
          op.parties[0]!,
        );
        // Signing with a fleet on your throat costs the power holding the fleet.
        // Charged here rather than left to the extraction pass, which was the
        // only thing moving disposition after a negotiation and rewarded a
        // constructive conversation — so the two powers that conceded most to
        // an ultimatum ended up BETTER disposed toward the power extorting them.
        for (const party of op.parties) {
          const other = op.parties.find((p: string) => p !== party);
          if (!other) continue;
          const worlds = underDuressFrom(state, party, other);
          if (worlds <= 0) continue;
          const victim = state.factions.find((f) => f.id === other);
          if (!victim) continue;
          victim.disposition[party] = Math.max(
            -100,
            Math.min(100, (victim.disposition[party] ?? 0) - COERCION_RESENTMENT),
          );
          const note = `${other} signs with ${party}'s ships over ${worlds} of its worlds: −${COERCION_RESENTMENT} disposition toward ${party}.`;
          notes.push(note);
          logEvent(state, 'diplomacy', note, other);
        }

        // A treaty that is live on signature cedes now; a pending one cedes when
        // it comes into force, in `tickTurn`. A cession is a one-time event
        // rather than a term that applies while the treaty is live, so it is
        // NOT undone if the treaty later lapses or is broken — land changes
        // hands once, and taking it back is a fresh act.
        if (!pending) notes.push(...cedeTerritory(state, treaty));
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
        // playtest produced exactly this (Drajk guile 14 vs Arkane resolve 19)
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
          // A covert placement is the acting power's business alone. This told
          // the world's holder that a rival operative had just arrived on it,
          // with the mission and the price — the one thing an operative exists
          // not to announce.
          [op.ownerFactionId],
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
        logEvent(
      state,
      'order',
      `Agent withdrawn from ${gone!.systemId}. ${op.reason}`.trim(),
      gone!.ownerFactionId,
      [gone!.ownerFactionId],
    );
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

        const taken = Math.min(-delta, hullsAt(host, op.factionId));
        if (delta > 0) {
          addShipsAt(host, op.factionId, delta, op.hull);
        } else if (taken > 0) {
          // Moving your OWN ships, you say which. A crew changing sides is not
          // a choice you get to make, so a suborn spends the loss order — the
          // cheapest hulls, the ones with least invested in them.
          const own = op.factionId === actor;
          const here = stackAt(host, op.factionId);
          const fromClass = own ? Math.min(taken, here[op.hull] ?? 0) : 0;
          const named: ShipStack = fromClass > 0 ? { [op.hull]: fromClass } : {};
          setStackAt(host, op.factionId, subtractStack(here, named));
          if (taken > fromClass) takeShipsAt(host, op.factionId, taken - fromClass);
        }

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
        // A commitment can bind another power exactly the way a treaty does —
        // a dynastic marriage or a charter naming a partner is not something
        // one side can declare into the other's ledger, and "a good roll is
        // not agreement" applies here as much as it does to `form_treaty`.
        // Gated on the actor rather than unconditionally on `source ===
        // 'model'`: this op has been declarable directly since before consent
        // was enforced anywhere, and existing journals contain exactly that,
        // written with no actor recorded. `actor === undefined` is precisely
        // "an engine op, or a journal from before the actor field existed" —
        // see the note on `applyOps` — so those replay exactly as they did. A
        // commitment naming only the actor (a unilateral policy, a charter
        // over one's own space) needs nobody's consent and stays declarable.
        if (
          source === 'model' &&
          actor !== undefined &&
          op.factionIds.some((id) => id !== actor)
        ) {
          reject(
            raw,
            'needs_consent',
            'A commitment binding another power cannot be declared into existence: they have to agree to it. Open a channel with them (/talk) and negotiate — the ops are emitted from what is actually agreed there.',
          );
          break;
        }
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
        // A second, tighter ceiling applies when the money is READ, and it is
        // the one that actually decides what an arrangement is worth. Both caps
        // are deliberate; nobody decided they should compound silently.
        // Measured: the Combine agreed to 60 a turn, this trimmed it to 25, and
        // `ledgerFor` paid 10 — a sixth of what was negotiated, on every turn of
        // the campaign, with neither party ever told. Reported so a player can
        // see the deal they actually struck rather than the one they discussed.
        for (const bound of op.factionIds) {
          const ceiling = maxCommitmentIncomeFor(state, bound);
          const drawn = commitmentsOf(state, bound).reduce(
            (n, c) => n + Math.max(0, c.incomePerTurn ?? 0),
            0,
          );
          if (yieldPerTurn > 0 && drawn + yieldPerTurn > ceiling) {
            const capped = `${nameFor(state, bound)} can draw at most ${ceiling} a turn from standing arrangements in total (its influence sets that), so this one is worth ${Math.max(0, ceiling - drawn)} to it rather than ${yieldPerTurn}.`;
            notes.push(capped);
            logEvent(state, 'clamp', capped, bound);
          }
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
        // Binding yourself to another power is worth something in standing even
        // when no money moves. Without this a commitment with no `incomePerTurn`
        // was entirely inert, and a playtest closed five accords that each
        // produced exactly that — a war subsidy, a share of prizes and a
        // standing intelligence duty, all decoration. The record is the useful
        // part; this is what makes the record bite.
        //
        // Between the parties only: a commitment is not public business the way
        // a treaty is, so onlookers have no view.
        adjustCommitmentGoodwill(state, op.factionIds, COMMITMENT_GOODWILL, notes);
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
        // Walking away takes the goodwill back, which is what makes a
        // commitment cost something to have made.
        adjustCommitmentGoodwill(state, found.factionIds, -COMMITMENT_GOODWILL, notes);
        logEvent(state, 'diplomacy', `Ended: ${found.text}. ${op.reason}`.trim());
        break;
      }

      case 'establish_debt': {
        // The same rule as `form_treaty`: nobody becomes a debtor because
        // somebody else declared it. Lending is negotiated, so the op is
        // reachable from the extraction pass and nowhere else a model reaches.
        if (source === 'model') {
          reject(
            raw,
            'needs_consent',
            'A debt cannot be declared into existence: the debtor has to agree to owe it. Open a channel with them (/talk) and negotiate the terms.',
          );
          break;
        }
        const missing = [op.creditorFactionId, op.debtorFactionId].find((id) => !factionExists(id));
        if (missing) {
          reject(raw, 'unknown_faction', `No faction "${missing}".`);
          break;
        }
        if (op.creditorFactionId === op.debtorFactionId) {
          reject(raw, 'illegal_value', 'A power cannot owe itself.');
          break;
        }

        // Trimmed rather than rejected, the same shape as `billConstruction`
        // and `trimOrderEffect`: the arrangement is still real at a smaller
        // number, and a rejection costs a correction round trip.
        const principal = Math.min(op.principal, MAX_DEBT_PRINCIPAL);
        const perTurn = Math.min(op.perTurn, MAX_DEBT_PER_TURN, principal);
        if (principal < op.principal || perTurn < op.perTurn) {
          const note = `Debt trimmed to ${principal} at ${perTurn} a turn (asked ${op.principal} at ${op.perTurn}).`;
          notes.push(note);
          logEvent(state, 'clamp', note, op.creditorFactionId);
        }

        // A loan MOVES THE MONEY. This recorded the obligation and transferred
        // nothing, which made a negotiated advance impossible to express
        // honestly: the debtor's `adjust_credits +N` is legal, the creditor's
        // `-N` is refused by design ("you cannot take credits out of another
        // faction's treasury"), and extraction runs as the borrower — so the
        // only expressible half was the credit to self. Measured live on a
        // real campaign: `TOTAL +240` with no counterparty debit, principal
        // conjured out of nothing.
        //
        // Trimmed to what the creditor actually holds, exactly as `settle_debt`
        // trims to what the debtor holds. A lender who cannot fund the whole
        // advance lends what it has, and the paper is written for that.
        const creditorFaction = state.factions.find((f) => f.id === op.creditorFactionId);
        const debtorFaction = state.factions.find((f) => f.id === op.debtorFactionId);
        const advanced = Math.min(principal, creditorFaction?.credits ?? 0);
        if (advanced <= 0) {
          reject(
            raw,
            'insufficient_credits',
            `${op.creditorFactionId} has nothing to lend. A debt is an advance of real money, not a promise recorded.`,
          );
          break;
        }
        if (advanced < principal) {
          const note = `${creditorFaction?.name ?? op.creditorFactionId} could only advance ${advanced} of the ${principal} agreed; the paper is written for what was actually paid over.`;
          notes.push(note);
          logEvent(state, 'clamp', note, op.creditorFactionId);
        }
        if (creditorFaction) creditorFaction.credits -= advanced;
        if (debtorFaction) debtorFaction.credits += advanced;

        state.debts.push({
          id: mintId(state, 'debt'),
          creditorFactionId: op.creditorFactionId,
          debtorFactionId: op.debtorFactionId,
          principal: advanced,
          balance: advanced,
          perTurn: Math.min(perTurn, advanced),
          status: 'current',
          missedPayments: 0,
          establishedTurn: state.turn,
          text: op.text,
        });
        logEvent(
          state,
          'diplomacy',
          `Debt recorded: ${op.text} (${advanced} advanced).`,
          op.creditorFactionId,
        );
        break;
      }

      case 'forgive_debt': {
        const debt = state.debts.find((d) => d.id === op.debtId);
        if (!debt) {
          reject(raw, 'unknown_debt', `No debt "${op.debtId}".`);
          break;
        }
        // Only the creditor may write it off. Without this a debtor could
        // cancel what it owes by declaring it — the cheapest possible exploit,
        // and the same actor-shaped hazard `deploy_agent` and `set_doctrine`
        // are both guarded against.
        if (actor !== undefined && debt.creditorFactionId !== actor) {
          reject(
            raw,
            'illegal_value',
            `Only ${debt.creditorFactionId} can forgive what is owed to it. A debtor does not write off its own debt.`,
          );
          break;
        }
        if (!isDebtLive(debt)) {
          reject(raw, 'illegal_value', `That debt is already ${debt.status}.`);
          break;
        }
        debt.status = 'forgiven';
        const debtor = state.factions.find((f) => f.id === debt.debtorFactionId);
        // Being let off a debt is worth something to the debtor, which is what
        // makes forgiveness a real instrument rather than pure loss — and what
        // makes the Combine's refusal to use it a genuine sacrifice.
        if (debtor) {
          debtor.disposition[debt.creditorFactionId] = Math.max(
            -100,
            Math.min(100, (debtor.disposition[debt.creditorFactionId] ?? 0) + DEBT_FORGIVENESS_GOODWILL),
          );
        }
        logEvent(
          state,
          'diplomacy',
          `${debt.creditorFactionId} writes off ${debt.balance} owed by ${debt.debtorFactionId}. ${op.reason}`.trim(),
          debt.creditorFactionId,
        );
        break;
      }

      /**
       * Move an existing debt to a new creditor.
       *
       * Extraction-only, like `establish_debt` and for the same reason: the
       * outgoing creditor has to agree to sell. What this closes is that
       * agreeing to *assign* paper could previously only be written as a new
       * debt, which minted a second copy and retired nothing — three debts
       * standing where there had been one, and a debtor owing more than twice
       * what it originally borrowed purely because the paper changed hands.
       */
      case 'assign_debt': {
        if (source === 'model') {
          reject(
            raw,
            'needs_consent',
            'A debt cannot be reassigned by declaration: the creditor holding it has to agree to part with it. Open a channel with them (/talk) and negotiate the sale.',
          );
          break;
        }
        const debt = state.debts.find((d) => d.id === op.debtId);
        if (!debt) {
          reject(raw, 'unknown_debt', `No debt "${op.debtId}".`);
          break;
        }
        if (!factionExists(op.toCreditorFactionId)) {
          reject(raw, 'unknown_faction', `No faction "${op.toCreditorFactionId}".`);
          break;
        }
        if (!isDebtLive(debt)) {
          reject(raw, 'illegal_value', `That debt is already ${debt.status}.`);
          break;
        }
        // Nobody ends up owing money to themselves.
        if (op.toCreditorFactionId === debt.debtorFactionId) {
          reject(
            raw,
            'illegal_value',
            `${debt.debtorFactionId} owes this debt; assigning it to them would be settling it, not selling it.`,
          );
          break;
        }
        const from = debt.creditorFactionId;
        if (from === op.toCreditorFactionId) {
          reject(raw, 'illegal_value', `${from} already holds that debt.`);
          break;
        }
        debt.creditorFactionId = op.toCreditorFactionId;
        logEvent(
          state,
          'diplomacy',
          `${from} assigns the ${debt.balance} owed by ${debt.debtorFactionId} to ${op.toCreditorFactionId}. ${op.reason}`.trim(),
          op.toCreditorFactionId,
        );
        break;
      }

      /**
       * Pay a debt down, in part or in full.
       *
       * An ordinary op, because prepaying what you owe needs nobody's
       * permission — and safe to leave open precisely because the money really
       * moves: the debtor pays exactly what comes off the balance, bounded by
       * what it actually holds, so this cannot wish a debt away. Without it,
       * paying a debt off early produced a narrative saying the column was shut
       * and a balance that was still there next turn.
       */
      case 'restructure_debt': {
        // New terms need the other party to grant them, so this is negotiated
        // like `form_treaty` and `establish_debt`. The schema says so and the
        // reducer says so, since a hand-written batch parses against the full
        // vocabulary rather than the model's.
        if (source === 'model') {
          reject(
            raw,
            'needs_consent',
            'Terms cannot be rewritten by declaring them: the other party to the debt has to agree. Open a channel with them (/talk) and settle it there.',
          );
          break;
        }
        const debt = state.debts.find((d) => d.id === op.debtId);
        if (!debt) {
          reject(raw, 'unknown_debt', `No debt "${op.debtId}".`);
          break;
        }
        if (!isDebtLive(debt)) {
          reject(raw, 'illegal_value', `That debt is already ${debt.status}.`);
          break;
        }
        // Either party may agree new terms — the creditor grants them, the
        // debtor asks for them — but a stranger cannot rewrite someone else's
        // paper. Same actor-shaped hazard `forgive_debt` is guarded against.
        if (
          actor !== undefined &&
          actor !== debt.creditorFactionId &&
          actor !== debt.debtorFactionId
        ) {
          reject(
            raw,
            'illegal_value',
            `${actor} is not a party to ${debt.id}. Only the creditor and the debtor can reschedule it.`,
          );
          break;
        }

        const wasPerTurn = debt.perTurn;
        const wasStatus = debt.status;
        // The balance is deliberately untouched: a restructure changes the
        // TERMS of what is owed, never the amount. Writing part of it off is
        // `forgive_debt` and paying it down is `settle_debt`, and both move
        // real money. Rebuilding the debt through forgive+establish is what
        // minted principal and paid goodwill for a forgiveness that forgave
        // nothing.
        debt.perTurn = Math.min(op.perTurn, MAX_DEBT_PER_TURN, debt.balance);
        if (op.text !== undefined) debt.text = op.text;
        if (op.clearsArrears) {
          debt.missedPayments = 0;
          if (debt.status === 'delinquent') debt.status = 'current';
        }

        const note = `${debt.id} rescheduled: ${wasPerTurn} -> ${debt.perTurn} a turn on an unchanged balance of ${debt.balance}${
          wasStatus === 'delinquent' && debt.status === 'current' ? ', arrears cleared' : ''
        }. ${op.reason}`.trim();
        notes.push(note);
        logEvent(state, 'diplomacy', note, debt.creditorFactionId);
        break;
      }

      case 'settle_debt': {
        const debt = state.debts.find((d) => d.id === op.debtId);
        if (!debt) {
          reject(raw, 'unknown_debt', `No debt "${op.debtId}".`);
          break;
        }
        // The debtor settles. A creditor writing it off is `forgive_debt`, and
        // it is a different act with a different price.
        if (actor !== undefined && debt.debtorFactionId !== actor) {
          reject(
            raw,
            'illegal_value',
            `Only ${debt.debtorFactionId} can pay this debt down. A creditor clearing it is forgive_debt.`,
          );
          break;
        }
        if (!isDebtLive(debt)) {
          reject(raw, 'illegal_value', `That debt is already ${debt.status}.`);
          break;
        }
        const debtor = state.factions.find((f) => f.id === debt.debtorFactionId);
        const creditor = state.factions.find((f) => f.id === debt.creditorFactionId);
        if (!debtor) {
          reject(raw, 'unknown_faction', `No faction "${debt.debtorFactionId}".`);
          break;
        }
        // Trimmed rather than rejected, the same shape as `billConstruction`:
        // you cannot pay more than you owe, nor more than you have, and a
        // part-payment is a real payment.
        const paid = Math.min(op.amount, debt.balance, debtor.credits);
        if (paid <= 0) {
          const note = `${debtor.name} cannot pay anything toward ${debt.id}: it holds ${debtor.credits} credits.`;
          notes.push(note);
          logEvent(state, 'clamp', note, debtor.id);
          break;
        }
        if (paid !== op.amount) {
          const note = `Trimmed a payment of ${op.amount} to ${paid} against ${debt.id}: balance ${debt.balance}, treasury ${debtor.credits}.`;
          notes.push(note);
          logEvent(state, 'clamp', note, debtor.id);
        }
        debtor.credits = Math.max(0, debtor.credits - paid);
        if (creditor) creditor.credits += paid;
        debt.balance -= paid;
        if (debt.balance <= 0) {
          debt.balance = 0;
          debt.status = 'settled';
        } else if (debt.status === 'delinquent') {
          // Paying against arrears brings you back into good standing; the
          // per-turn service check decides afresh next tick.
          debt.status = 'current';
          debt.missedPayments = 0;
        }
        logEvent(
          state,
          'diplomacy',
          `${debt.debtorFactionId} pays ${paid} against ${debt.id}; ${debt.balance} remains${debt.status === 'settled' ? ' — settled' : ''}. ${op.reason}`.trim(),
          debt.debtorFactionId,
        );
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

  capSelfInflictedLosses(state, actor, hullsBefore, shipsBefore, notes);
  billConstruction(state, hullsBefore, notes);

  // Nothing lands unless everything does. The notes are dropped with the state
  // they describe — a trim note for an op that was discarded would be telling
  // the player about work that did not happen — but the rejections are what
  // the correction pass reads, so they are kept and one note says plainly that
  // the batch was held back.
  //
  // The rejection log entries are carried across the rollback rather than
  // rebuilt: they are the record of why the batch was held back, and rolling
  // that back with it left the player with a summary and no itemisation.
  if (atomic && rejections.length > 0) {
    const rolledBack = clone(input);
    rolledBack.eventLog.push(...rejectionEvents);
    return {
      state: rolledBack,
      rejections,
      notes: [
        `Nothing in this batch was applied: ${rejections.length} of ${rawOps.length} ops were rejected, and an action lands whole or not at all.`,
      ],
    };
  }

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
  /** Per-system ship counts as they stood before the batch. */
  shipsBefore: Map<string, Record<string, ShipStack>>,
  notes: string[],
): void {
  if (actor === undefined) return; // engine ops, and journals predating the actor field
  const faction = state.factions.find((f) => f.id === actor);
  if (!faction) return;

  // In TONS, the same currency the batch was billed in, so a declaration that
  // scuttles lifters and one that scuttles battleships are held to the same
  // limit by displacement rather than by headcount.
  const had = before.get(actor) ?? 0;
  const lost = had - fleetTonsOf(state, actor);
  if (lost <= 0) return;

  const allowed = Math.max(1, Math.floor(had * MAX_SELF_INFLICTED_LOSS_FRACTION));
  if (lost <= allowed) return;

  const restored = lost - allowed;
  // Put them back WHERE THEY WERE TAKEN FROM. This restored at `fleetBases[0]`,
  // which sorts by `strategicValue` — so a declaration that drew hulls from a
  // backwater handed them back at the faction's best world. Measured: an
  // `adjust_fleet -4` moved 3 hulls two jumps from Hollow Star to Vergesse,
  // instantly, with no `fleet_movement`, no transit and no interception. A
  // scuttling was a free strategic redeployment, and the note even claimed the
  // survivors "remain at Vergesse" when they had never been there.
  const drawnFrom = state.systems
    .map((sys) => ({
      sys,
      // The exact ships that went, so what comes back is what was taken and
      // not an equivalent tonnage of battleships.
      missing: subtractStack(shipsBefore.get(sys.id)?.[actor] ?? {}, stackAt(sys, actor)),
      had: tonsIn(shipsBefore.get(sys.id)?.[actor]),
      now: tonsAt(sys, actor),
    }))
    .filter((x) => x.had > x.now)
    .sort((a, b) => b.had - a.had || a.sys.id.localeCompare(b.sys.id));

  let owed = restored;
  for (const { sys, missing } of drawnFrom) {
    if (owed <= 0) break;
    // Cheapest hulls first, so the cap restores the smallest ships it can and
    // a partial restoration does not hand back the flagship.
    const { taken } = trimToTons(missing, Math.max(0, tonsIn(missing) - owed));
    if (hullsIn(taken) === 0) continue;
    addStackAt(sys, actor, taken);
    owed -= tonsIn(taken);
  }
  // Nothing identifiable was drawn from (an abstract `adjust_fleet` against a
  // faction with no recorded losses): fall back to a holding rather than
  // losing the hulls entirely.
  const bases = fleetBases(state, actor);
  if (owed > 0) {
    if (bases.length === 0) return;
    addShipsAt(bases[0]!, actor, Math.ceil(owed / HULL_SPEC.battleship.tonnage));
  }

  const where =
    drawnFrom.length > 0 ? drawnFrom.map((d) => d.sys.name).join(', ') : (bases[0]?.name ?? 'their stations');
  const note = `${faction.name} cannot lose ${lost} tons of shipping to a single declaration; ${restored} tons were never at risk and remain at ${where}. Battle losses are resolved when a fleet arrives, not when an order is given.`;
  notes.push(note);
  logEvent(state, 'rejection', note, actor);
}

/**
 * Bill every faction for the hulls it gained this batch, and deliver only what
 * it could pay for.
 *
 * This is the hard cap on "build a thousand ships". The model may emit any
 * `adjust_fleet` it likes; the yards deliver `credits / CREDITS_PER_TON` of it and
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
    // Billed in TONS, so a class costs what it displaces and nothing has to
    // agree separately about the price of an escort. Comparing the whole
    // faction's tonnage before and after is what keeps repositioning free.
    const gained = fleetTonsOf(state, faction.id) - (before.get(faction.id) ?? 0);
    if (gained <= 0) continue;

    const affordable = Math.floor(faction.credits / CREDITS_PER_TON);
    const built = Math.min(gained, affordable);
    faction.credits -= built * CREDITS_PER_TON;

    const shortfall = gained - built;
    if (shortfall > 0) {
      // Tonnage in transit cannot be un-built, so trim from systems and accept
      // a smaller cut if that is all that is reachable.
      const trimmed = removeTons(state, faction.id, shortfall);
      const note = `${faction.name} could only pay for ${built} of ${gained} new tons (${CREDITS_PER_TON} credits each); ${trimmed} tons were never laid down.`;
      notes.push(note);
      logEvent(state, 'system', note, faction.id);
    } else if (built > 0) {
      const note = `${faction.name} commissions ${built} tons of shipping for ${built * CREDITS_PER_TON} credits.`;
      notes.push(note);
      logEvent(state, 'system', note, faction.id);
    }
  }
}

/**
 * Cut `tons` of shipping out of a faction, richest system first.
 *
 * The tonnage counterpart of `removeShips`, for the two callers that are
 * settling a bill rather than destroying particular ships: unpaid construction
 * and unpaid upkeep. Deterministic ordering, so replay holds.
 */
function removeTons(
  state: WorldState,
  factionId: string,
  tons: number,
  exceptSystemId?: string,
): number {
  let owed = tons;
  const bases = [...state.systems]
    .filter((s) => s.id !== exceptSystemId && tonsAt(s, factionId) > 0)
    .sort((a, b) => tonsAt(b, factionId) - tonsAt(a, factionId) || a.id.localeCompare(b.id));
  for (const base of bases) {
    if (owed <= 0) break;
    const here = tonsAt(base, factionId);
    const { taken, left } = trimToTons(stackAt(base, factionId), Math.max(0, here - owed));
    if (hullsIn(taken) === 0) continue;
    setStackAt(base, factionId, left);
    owed -= here - tonsIn(left);
  }
  return tons - Math.max(0, owed);
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
    if (isMovementType(order.type) && hullsIn(order.force) > 0) {
      const home = state.systems.find((s) => s.id === order.originId);
      if (home) addStackAt(home, order.factionId, order.force);
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
    if (sys && hullsIn(order.force) > 0) {
      addStackAt(sys, order.factionId, order.force);
    }
    const note = `${order.label} halted mid-transit at ${sys?.name ?? halted} with ${hullsIn(order.force)} ships. ${reason}`.trim();
    logEvent(state, 'order', note, order.factionId);
    return note;
  }

  const remaining = Math.max(0, order.durationTurns - order.progress);
  // Banked work is kept and unspent work is refunded, pro-rata of what was
  // actually committed: the yards return the materials they never cut into.
  //
  // There used to be a flat `remaining * 20` on top of that, and it made
  // **issue-then-interrupt unconditionally profitable**. At `progress: 0` the
  // pro-rata half already returns 100% of the outlay, so the flat part was pure
  // profit — measured at +100 on a 120-credit programme, and unbounded once
  // `extend_order` (which had no ceiling) inflated `remaining`. A refund that
  // can exceed the outlay is not a refund.
  const refund =
    order.investedCredits > 0
      ? Math.round(order.investedCredits * (remaining / order.durationTurns))
      : 0;
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
  /**
   * Structured battle reports for everything that fought this turn.
   *
   * `arrivals` keeps the prose for the log; this is the same engagements with
   * the arithmetic still attached, so the UI can show which phase decided a
   * battle and which doctrines changed it.
   */
  battles: BattleReport[];
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
      // In tons, because upkeep is charged in tons: laying up a lifter has to
      // close three credits of the gap and an escort two, not one apiece.
      const gap = -balance;
      const tons = fleetTonsOf(state, faction.id);
      const wanted = Math.ceil(gap / UPKEEP_PER_TON);
      const cap = Math.max(1, Math.floor(tons * MAX_ATTRITION_FRACTION));
      const laidUp = removeTons(state, faction.id, Math.min(wanted, cap));
      if (laidUp > 0) {
        const note = `${faction.name} cannot meet its upkeep and lays up ${laidUp} tons of shipping.`;
        notes.push(note);
        logEvent(state, 'system', note, faction.id);
      }
    }
  }
  /* --- Debts are serviced ---------------------------------------------- */
  // After income, so a debtor pays out of this turn's revenue, and as an
  // explicit transfer rather than a ledger rate. The rate version is what a
  // commitment does and it cannot work here: `credits` floors at zero, so a
  // broke debtor would "pay" money it never had and the creditor would receive
  // it. Moving exactly what is there keeps the two sides conserved and lets a
  // shortfall be recorded as a default instead of conjured.
  for (const debt of state.debts) {
    if (!isDebtLive(debt)) continue;
    const debtor = state.factions.find((f) => f.id === debt.debtorFactionId);
    const creditor = state.factions.find((f) => f.id === debt.creditorFactionId);
    if (!debtor || !creditor) continue;

    const { paid, due, missed } = instalment(debt, debtor.credits);
    debtor.credits -= paid;
    creditor.credits += paid;
    debt.balance -= paid;

    if (missed) {
      debt.status = 'delinquent';
      debt.missedPayments += 1;
      // A default is a grievance, and it compounds: the creditor thinks worse
      // of them every turn the debt goes unserviced.
      creditor.disposition[debt.debtorFactionId] = Math.max(
        -100,
        Math.min(
          100,
          (creditor.disposition[debt.debtorFactionId] ?? 0) - DEBT_DEFAULT_DISPOSITION_COST,
        ),
      );
      const note = `${debtor.name} misses ${due - paid} of ${due} owed to ${creditor.name} (${debt.balance} outstanding).`;
      notes.push(note);
      logEvent(state, 'diplomacy', note, debt.creditorFactionId);
    } else if (debt.balance === 0) {
      debt.status = 'settled';
      const note = `${debtor.name} settles its debt to ${creditor.name} in full.`;
      notes.push(note);
      logEvent(state, 'diplomacy', note, debt.debtorFactionId);
    } else {
      // Paying again after a default clears the *status*, so pressure can be
      // relieved — but never `missedPayments`, which is what the relationship
      // remembers.
      debt.status = 'current';
    }
  }

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

  /* --- Ratified treaties come into force ------------------------------- */
  // Before expiry, so a treaty cannot lapse in the same tick it becomes live.
  for (const treaty of state.treaties) {
    if (treaty.status !== 'pending' || treaty.effectiveTurn === null) continue;
    if (state.turn < treaty.effectiveTurn) continue;
    treaty.status = 'active';
    // It replaces its predecessor now, not at signature — see
    // `supersedePriorTreaties`.
    supersedePriorTreaties(state, treaty, notes);
    logEvent(state, 'diplomacy', `Treaty ratified and now in force: ${treaty.summary}.`);
    notes.push(`Ratified: ${treaty.summary}`);
    // A cession takes effect with the rest of the terms, not at signature, so a
    // council that has to consent delays the handover too.
    notes.push(...cedeTerritory(state, treaty));
  }

  /* --- Void conditions fire before anything is paid out ---------------- */
  // Before expiry and before income, so a treaty that has voided does not pay
  // out one last time on its way off the board.
  for (const treaty of state.treaties) {
    if (treaty.status !== 'active') continue;
    for (const condition of treaty.terms.voidsOn) {
      const why = voidConditionMet(state, condition);
      if (!why) continue;
      treaty.status = 'voided';
      const note = `Treaty voided: ${treaty.summary || treaty.id} — ${why}.`;
      logEvent(state, 'diplomacy', note, condition.by);
      notes.push(note);
      break;
    }
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

  /**
   * What each operative did this turn, so that none of them can be silent.
   *
   * An agent used to report only when it destroyed something. `intel` had no
   * branch at all, and `income_penalty` / `stat_debuff` are read where they are
   * used rather than applied here, so three of five effects produced no output
   * whatsoever — measured live as four surveillance operatives running seven
   * turns and generating not one line. You could not tell a working agent from
   * a broken one, which is exactly how the `intel` effect stayed unreachable
   * for the life of the project without anyone noticing.
   *
   * Every branch below writes an entry, and anything that did not is reported
   * as having nothing to report. "Nothing to report" is the load-bearing case:
   * it is what makes an idle operative visibly idle instead of invisibly
   * broken.
   */
  const watchNotes = new Map<string, string>();

  for (const agent of state.agents) {
    if (agent.exposed) {
      watchNotes.set(agent.id, 'is burned and out of contact.');
      continue;
    }
    const host = state.systems.find((sys) => sys.id === agent.systemId);
    const target = host?.controllerFactionId
      ? state.factions.find((f) => f.id === host.controllerFactionId)
      : undefined;
    if (!host || !target || target.id === agent.ownerFactionId) {
      watchNotes.set(
        agent.id,
        host === undefined
          ? 'has lost its posting.'
          : target === undefined
            ? `sits on ${host.name}, which answers to nobody. Nothing to work against.`
            : `sits on ${host.name}, which is already ours. Nothing to report.`,
      );
      continue;
    }

    const profile = MISSION_PROFILE[agent.mission];
    const owner = state.factions.find((f) => f.id === agent.ownerFactionId);
    const roll = rollD20(state.turn, `agent:${agent.id}`);
    const succeeded = roll * 5 <= agent.successChance;

    // A one-shot mission is spent whether or not it worked.
    if (profile.oneShot) spentAgents.push(agent.id);

    if (!succeeded) {
      // A botched operation risks the operative, and how much depends on the
      // mission: a watcher is rarely caught, an assassin usually is.
      //
      // Exposure is tested on the TOP of the die, not the bottom. It used to
      // read `roll <= profile.exposureRisk`, which looks right and fires almost
      // never: a roll succeeds when `roll * 5 <= successChance`, so rolls
      // `1..floor(successChance / 5)` are exactly the ones that never reach
      // this branch — and they are exactly the rolls the risk test was looking
      // for. `successChance` floors at 5, so a *surveillance* operative (risk 1)
      // could not be exposed at any stat pairing in the game, and only an
      // assassin below 44% was ever really at risk. Measured before the change:
      // 80 operatives, five owner/target pairings, 40 turns each — zero
      // exposures. Nobody noticed because a burned agent is a non-event; you
      // observe nothing rather than something visibly wrong.
      //
      // Reading the same risk off the high end keeps the intent ("a botched
      // operation risks the operative") and makes the documented ladder real:
      // 1 in 20 for a watcher through 9 in 20 for an assassin. Competence still
      // protects — an operative good enough to succeed on all but a natural 20
      // is only ever exposed on that 20 — which is the right shape, and bounded
      // at 5% rather than at nothing.
      watchNotes.set(agent.id, `attempted ${agent.mission} on ${host.name} and it came to nothing.`);
      if (roll >= 21 - profile.exposureRisk) {
        agent.exposed = true;
        watchNotes.set(agent.id, `was taken on ${host.name}. That line is closed.`);
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
      const available = hullsAt(host, target.id);
      const turned = Math.min(wanted, available);

      if (turned > 0) {
        // Which hulls change sides is the loss order: a bought crew is the
        // cheapest one that can be bought, not the flagship.
        const crews = takeShipsAt(host, target.id, turned);
        addStackAt(host, agent.ownerFactionId, crews);

        // Bought, not conquered: crews that change sides still have to be
        // paid for, at the same price the yards charge for the same tonnage.
        // Otherwise a defection network is a free shipyard pointed at your
        // rival — and priced per ton, so turning three escorts is not the same
        // bill as turning three battleships.
        const price = stackCost(crews);
        const buyer = state.factions.find((f) => f.id === agent.ownerFactionId);
        if (buyer) buyer.credits = Math.max(0, buyer.credits - price);

        watchNotes.set(
          agent.id,
          `turned ${describeStack(crews)} of ${target.name}'s at ${host.name}, bought at ${price} credits.`,
        );
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
        watchNotes.set(
          agent.id,
          `finds no takers among ${target.name}'s crews on ${host.name}; they will not be bought.`,
        );
        logEvent(
          state,
          'system',
          `${owner?.name ?? agent.ownerFactionId}'s approaches to ${target.name}'s crews on ${host.name} find no takers.`,
          agent.ownerFactionId,
        );
      } else {
        watchNotes.set(agent.id, `found no ${target.name} crews left at ${host.name} to approach.`);
      }
      continue;
    }

    if (agent.effect.kind === 'hull_damage') {
      const damage = agent.effect.perTurn * profile.effectMultiplier;
      // Sabotage destroys hulls where the operative is, not somewhere abstract.
      const before = hullsAt(host, target.id);
      const left = Math.max(0, before - damage);
      setShipsAt(host, target.id, left);
      const lost = before - left;
      watchNotes.set(
        agent.id,
        lost > 0
          ? `destroyed ${lost} of ${target.name}'s hull(s) at ${host.name}.`
          : `found nothing of ${target.name}'s left at ${host.name} to strike.`,
      );
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
    // (ledgerFor and effectiveStats), so they cannot double-apply here. They
    // still report, because "applied elsewhere" was being heard as "produces
    // nothing" — a theft draining 15 a turn was exactly as silent as a
    // surveillance post that did nothing at all.
    if (agent.effect.kind === 'income_penalty') {
      watchNotes.set(
        agent.id,
        `is skimming ${agent.effect.perTurn} a turn out of ${target.name}'s accounts at ${host.name}.`,
      );
    } else if (agent.effect.kind === 'stat_debuff') {
      watchNotes.set(
        agent.id,
        `is costing ${target.name} ${agent.effect.magnitude} ${agent.effect.stat} for as long as it is in place.`,
      );
    } else if (agent.effect.kind === 'intel') {
      // What the watcher can actually see: work at this world that is not its
      // own master's. This is the output the effect never had — the reason a
      // player could run four watchers for seven turns and read nothing.
      const seen = state.pendingOrders.filter(
        (o) =>
          o.factionId !== agent.ownerFactionId &&
          (o.originId === agent.systemId || o.targetId === agent.systemId),
      );
      watchNotes.set(
        agent.id,
        seen.length === 0
          ? `reports nothing moving at ${host.name}.`
          : `reports from ${host.name}: ${seen
              .map((o) => {
                const who = state.factions.find((f) => f.id === o.factionId)?.name ?? o.factionId;
                return `${who} — ${o.label || o.type} (${o.progress}/${o.durationTurns})`;
              })
              .join('; ')}.`,
      );
    }
  }

  // One line per operative, and ONLY for the player's own.
  //
  // A watch report is private intelligence, and the event log is shipped to the
  // browser whole — so logging every faction's reports would hand the player a
  // transcript of what four rival spy networks can see, which is the exact
  // opposite of the fog the same tick is enforcing. NPC operatives still work;
  // their product reaches their own prompt block through `ordersVisibleTo` and
  // has no business in the player's record.
  //
  // Written before `spentAgents` is filtered, so a one-shot mission still
  // reports the strike it was spent on.
  for (const agent of state.agents) {
    if (agent.ownerFactionId !== state.playerFactionId) continue;
    const note = watchNotes.get(agent.id) ?? 'has nothing to report.';
    const where = state.systems.find((sys) => sys.id === agent.systemId)?.name ?? agent.systemId;
    logEvent(
      state,
      'intel',
      `[${agent.mission} · ${where}] Your operative ${note}`,
      agent.ownerFactionId,
    );
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

  // Computed HERE, not partway up this function, which is where it used to sit.
  // A tick pays income, resolves orders, fights battles, moves territory, fires
  // agents and collects tolls — all of it after the old snapshot was taken — so
  // the briefing reported a ledger describing a world that no longer existed by
  // the time the player read it. Seen live as two consecutive turns reporting
  // byte-identical `{gross, upkeep, net}` across a tick that changed treaties.
  //
  // Safe to move because this value only ever fed the report and the turn log:
  // income is paid from a per-faction `ledgerFor` inside the payment loop above,
  // never from this one.
  const playerLedger = ledgerFor(state, state.playerFactionId);

  const report: TurnReport = {
    completed: [],
    advanced: [],
    ledger: playerLedger,
    arrivals: [],
    battles: [],
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
    const { note: outcome, report: battle } = resolveBattle(state, systemId, orders);
    notes.push(outcome);
    report.arrivals.push(outcome);
    if (battle) report.battles.push(battle);
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
    const besieged = presentAt(system).some(([id, n]) => id !== holder && n > 0);
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
interface BattleOutcomeResult {
  note: string;
  /** Null when nothing was fought — a reinforcement, or a missing system. */
  report: BattleReport | null;
}

function resolveBattle(
  state: WorldState,
  systemId: string,
  orders: PendingOrder[],
): BattleOutcomeResult {
  const target = state.systems.find((s) => s.id === systemId);
  if (!target) {
    return {
      note: `A landing on ${systemId} could not be resolved (missing system).`,
      report: null,
    };
  }

  const holder = target.controllerFactionId;
  const nameOf = (id: string): string => state.factions.find((f) => f.id === id)?.name ?? id;

  // Everything below mutates `target`, so the "before" picture is taken now.
  const garrisonBefore = target.garrison;
  const rounds: BattleRound[] = [];
  const doctrinesFired: string[] = [];
  let roll = 0;
  let attackModOut = 0;
  let defendModOut = 0;

  // Attackers are in transit, not in `target.ships`, so their "before" is the
  // force they committed — reading the system would report a fleet of zero
  // attacking. Snapshots advance per round, so each round shows its own delta
  // rather than the cumulative one.
  let attackSnapshot = new Map<string, ShipStack>();
  let defendSnapshot = new Map<string, ShipStack>();

  /** Close the engagement: snapshot the result and hand back both forms. */
  const finish = (note: string): BattleOutcomeResult => ({
    note,
    report: {
      id: `${systemId}:${state.turn}`,
      systemId,
      systemName: target.name,
      turn: state.turn,
      roll,
      attackMod: attackModOut,
      defendMod: defendModOut,
      doctrinesFired,
      holderBefore: holder,
      holderAfter: target.controllerFactionId,
      garrisonBefore,
      garrisonAfter: target.garrison,
      rounds,
      status: 'resolved',
      note,
    },
  });

  // Ships arriving, per faction — composed, because the ground phase asks what
  // is aboard and not merely how much.
  const arriving = new Map<string, ShipStack>();
  for (const o of orders) arriving.set(o.factionId, mergeStacks(arriving.get(o.factionId), o.force));

  const land = (factionId: string, stack: ShipStack): void => {
    if (hullsIn(stack) > 0) addStackAt(target, factionId, stack);
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

  /**
   * Rivals sitting in orbit over a world they do not hold.
   *
   * Presence is deliberately meaningful — parked ships take a share of the
   * world's income, blockade its lanes and suborn its crews — and there was no
   * way to answer it. Battles resolve only on a `fleet_movement` ARRIVAL, and a
   * holder arriving at its own world was always read as reinforcing, so one
   * enemy hull on your best world was a permanent, unanswerable tax. Measured
   * live: the Vigil held a hull over Vergesse for five turns and nothing in the
   * rules could remove it.
   */
  const squatters = presentAt(target).filter(
    ([id, n]) => n > 0 && id !== holder && !guest(id),
  );

  /**
   * A holder arriving where a rival is squatting is clearing its own orbit.
   *
   * Purely ship against ship: the garrison takes no part and grants no bonus,
   * because the squatters do not hold the ground and there is no ground to
   * take — the holder already has it. So the engagement stops after the
   * orbital phase whichever way it goes.
   */
  const sweep =
    holder !== null &&
    hullsIn(arriving.get(holder)) > 0 &&
    squatters.length > 0 &&
    [...arriving.keys()].every((id) => id === holder || guest(id));

  const attackers: [string, ShipStack][] = sweep
    ? [[holder!, arriving.get(holder!)!]]
    : [...arriving.entries()].filter(([id]) => id !== holder && !guest(id));
  const guests = [...arriving.entries()].filter(([id]) => guest(id));
  // In a sweep the holder's arriving hulls are the attacking force, so they
  // must not also be landed before the fight.
  if (!sweep) for (const [id, n] of arriving) if (id === holder) land(id, n);
  for (const [id, n] of guests) land(id, n);

  if (attackers.length === 0) {
    const who = [...arriving.keys()].map(nameOf).join(' and ');
    const note =
      guests.length > 0 && holder !== null
        ? `${guests.map(([id]) => nameOf(id)).join(' and ')} puts in at ${target.name} under basing rights.`
        : `${who} reinforces ${target.name}.`;
    logEvent(state, 'order', note, holder);
    // Not a battle. Reporting one would put a "no losses" card in the panel
    // every time a fleet moved between friendly worlds.
    return { note, report: null };
  }

  const attackerIds = new Set(attackers.map(([id]) => id));
  const coalition = attackers.map(([id]) => nameOf(id)).join(' and ');
  /** One side of one round: what it had at the round's start, and what it has now. */
  const sideOf = (now: Map<string, ShipStack>, was: Map<string, ShipStack>): Contingent[] =>
    [...now.entries()].map(([id, stack]) => {
      const before = was.get(id) ?? stack;
      return {
        factionId: id,
        factionName: nameOf(id),
        before: hullsIn(before),
        after: hullsIn(stack),
        stackBefore: before,
        stackAfter: stack,
      };
    });
  attackSnapshot = new Map(attackers);
  const attackShare = new Map(attackers);
  /** Hulls the coalition still has. What a player counts. */
  const attackHulls = (): number =>
    [...attackShare.values()].reduce((n, st) => n + hullsIn(st), 0);

  /* --- Pacts broken by this attack ------------------------------------- */
  // Attacking someone you have sworn peace with voids the pact, costs the
  // injured party's opinion, and costs your standing with everyone watching.
  // Who is being attacked: normally the holder, but in a sweep it is the powers
  // squatting in the holder's own orbit. Sweeping a partner you have sworn
  // peace with breaks that peace exactly as any other attack does.
  const pactVictims: string[] = sweep
    ? squatters.map(([id]) => id)
    : holder === null
      ? []
      : [holder];

  for (const attackerId of attackerIds) {
    for (const victimId of pactVictims) {
    if (victimId === attackerId) continue;
    const pact = treatyBetween(state.treaties, state.turn, attackerId, victimId, PEACE_TREATIES);
    if (!pact) continue;

    pact.status = 'broken';
    const injured = state.factions.find((f) => f.id === victimId);
    if (injured) {
      injured.disposition[attackerId] = Math.max(-100, (injured.disposition[attackerId] ?? 0) - 25);
    }
    for (const witness of state.factions) {
      if (witness.id === attackerId || witness.id === victimId) continue;
      witness.disposition[attackerId] = Math.max(
        -100,
        (witness.disposition[attackerId] ?? 0) - PACT_BREAKING_REPUTATION_COST,
      );
    }
    logEvent(
      state,
      'diplomacy',
      `${nameOf(attackerId)} breaks its ${pact.type.replace('_', ' ')} with ${nameOf(victimId)} by attacking ${target.name}. The whole Rim notes it.`,
      attackerId,
    );
    }
  }

  // Safe default: everyone else present is a defender.
  const defenders: [string, ShipStack][] = presentAt(target)
    .filter(([id, n]) => !attackerIds.has(id) && n > 0)
    .map(([id]) => [id, stackAt(target, id)]);

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
      const sent = drawShips(state, ally, pledged, target.id);
      if (hullsIn(sent) <= 0) continue;
      addStackAt(target, ally, sent);
      const existing = defenders.find(([id]) => id === ally);
      if (existing) existing[1] = mergeStacks(existing[1], sent);
      else defenders.push([ally, sent]);

      logEvent(
        state,
        'diplomacy',
        `${nameOf(ally)} honours its mutual defence pact and commits ${hullsIn(sent)} ships to ${target.name}.`,
        ally,
      );
    }
  }

  /**
   * The two currencies the orbitals are settled in.
   *
   * **Weight decides who wins; tonnage decides how much burns.** A lifter has
   * no weight at all, so counting losses in weight would make it unhittable and
   * a fleet that packed transports behind its line would carry them through any
   * battle free. Weight is stated in battleship-equivalents so the exchange is
   * the arithmetic it has always been: a galaxy of nothing but battleships
   * fights exactly as it did before classes existed.
   */
  const BE = HULL_SPEC.battleship.orbitalWeight;
  const weightOfSide = (side: Iterable<ShipStack>): number =>
    [...side].reduce((n, st) => n + orbitalWeightOf(st), 0) / BE;

  let defenceForce = defenders.reduce((sum, [, st]) => sum + hullsIn(st), 0);
  defendSnapshot = new Map(defenders);

  // Genuinely undefended: nobody in orbit AND nobody on the ground. An
  // unaligned world is NOT automatically this — the seed gives neutral worlds
  // garrisons of 2–5, and skipping the ground phase for them made every
  // neutral in the galaxy a free pickup whose militia you then inherited
  // intact. Unaligned means nobody speaks for it, not that nobody defends it.
  if (holder === null && defenceForce === 0 && target.garrison <= 0) {
    for (const [id, st] of attackers) land(id, st);
    const owner = strongestBy(attackShare, tonsIn);
    target.controllerFactionId = owner;
    const note = `${coalition} occupies ${target.name} unopposed; ${nameOf(owner)} takes possession.`;
    logEvent(state, 'order', note, owner);
    rounds.push({
      turn: state.turn, phase: 'ground', outcome: 'unopposed',
      attackPower: 0, defendPower: 0, assault: 0, garrison: 0, garrisonEffective: 0,
      attackers: sideOf(attackShare, attackSnapshot),
      defenders: [], note,
    });
    return finish(note);
  }

  // Who is fighting is part of the seed, not just where and when.
  //
  // The salt was `combat:${systemId}:${turn}` — neither fleet, neither faction,
  // nor the order — so a world had a fixed lucky turn: Kalzir on turn 6 rolled a
  // 20 whoever arrived and whatever they brought. That is noticeable over a long
  // campaign with no arithmetic at all, because the same world keeps producing
  // the same kind of battle, and it makes the roll a property of the calendar
  // rather than of the engagement.
  //
  // Sorted, so it stays a function of who is present and never of the order the
  // orders happened to arrive in, and replay reproduces it exactly.
  const combatants = [...new Set([...attackerIds, ...defenders.map(([id]) => id)])].sort();
  roll = rollD20(state.turn, `combat:${systemId}:${state.turn}:${combatants.join(',')}`);
  const bestMod = (ids: string[]): number =>
    ids.length === 0
      ? 0
      : Math.max(...ids.map((id) => statModifier(effectiveStats(state, id).might)));
  let attackMod = bestMod([...attackerIds]);
  const defendMod = bestMod(defenders.map(([id]) => id));
  defendModOut = defendMod;

  // --- War ethics -------------------------------------------------------
  // Whose doctrine applies in a coalition is a real question: `bestMod` takes
  // the best modifier on each side, but a doctrine is not a stat and cannot be
  // borrowed. It is read off the LARGEST contingent, so a one-ship junior
  // partner cannot decide that nobody is allowed to retreat.
  const ethicOfFaction = (id: string | null): string | null =>
    id === null ? null : (state.factions.find((f) => f.id === id)?.warEthic ?? null);
  const largestAttacker =
    [...attackShare.entries()].sort(
      (a, b) => tonsIn(b[1]) - tonsIn(a[1]) || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? null;
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
    if (weakened || distracted) {
      attackMod += OPPORTUNIST_MIGHT_BONUS;
      doctrinesFired.push(
        `opportunist: +${OPPORTUNIST_MIGHT_BONUS} might for ${nameOf(largestAttacker!)} against a ${weakened ? 'weakened' : 'distracted'} ${holder ? nameOf(holder) : 'holder'}`,
      );
    }
  }
  attackModOut = attackMod;

  // A retreating force loses 10–35% getting clear; bad luck costs more.
  const retreatLossPct = 10 + ((21 - roll) % 6) * 5;
  /**
   * What survives a withdrawal, spending the loss order.
   *
   * In TONS, like every other loss, so a fleet of many cheap hulls does not
   * escape more lightly than the same displacement of heavy ones. A pure
   * battleship fleet bleeds exactly the hulls it always did, since its tons and
   * its hulls are the same fraction.
   *
   * **This is where a screen actually earns its keep.** The exchange band
   * destroys half a fleet or more, which no realistic escort force absorbs, but
   * a withdrawal costs 10–35% — and that a screen can cover outright, which is
   * what brings a convoy home from a battle it should not have fought.
   */
  const bleed = (stack: ShipStack): ShipStack =>
    strikeStack(stack, (tonsIn(stack) * retreatLossPct) / 100).left;
  const notes: string[] = [];

  /* ---------- Phase 0: the torpedo strike ---------- */
  //
  // Boats fire before the fleets close, and this is the whole of what they do:
  // they carry no weight into the exchange at all. Both sides fire at once, so
  // a defender's boats are an ambush and not merely a slower version of the
  // attacker's.
  //
  // **This is the one effect in the battle that is superadditive**, and it is
  // why a mixed fleet can be worth more than the sum of its hulls. Damage dealt
  // here lowers what the enemy brings to the exchange, so it lowers your losses
  // there as well — where an extra battleship only ever adds its own weight.
  // No reweighting of the classes could have produced that: combat weight is a
  // sum, so weight-per-credit of any mix is a weighted average of the per-class
  // figures and can never beat the best single class.
  const strikeOn = (
    firing: ShipStack[],
    targetSide: ShipStack[],
  ): { tons: number; deep: number } => ({
    tons: torpedoStrike(firing),
    deep: pastScreen(firing, targetSide),
  });

  {
    const attackerStacks = [...attackShare.values()];
    const defenderStacks = defenders.map(([, st]) => st);
    const onDefenders = strikeOn(attackerStacks, defenderStacks);
    const onAttackers = strikeOn(defenderStacks, attackerStacks);

    if (onDefenders.tons > 0 || onAttackers.tons > 0) {
      const beforeAtk = attackHulls();
      const beforeDef = defenders.reduce((n, [id]) => n + hullsAt(target, id), 0);

      // Simultaneous: both salvos are computed against the fleets as they
      // stood, so neither side's losses reduce the fire it was already under.
      if (onDefenders.tons > 0) {
        const total = defenderStacks.reduce((n, st) => n + tonsIn(st), 0);
        for (const [id, present] of defenders) {
          if (total <= 0) break;
          const share = (onDefenders.tons * tonsIn(present)) / total;
          setStackAt(target, id, strikeStack(present, share, onDefenders.deep).left);
        }
      }
      if (onAttackers.tons > 0) {
        const total = attackerStacks.reduce((n, st) => n + tonsIn(st), 0);
        for (const [id, st] of attackShare) {
          if (total <= 0) break;
          const share = (onAttackers.tons * tonsIn(st)) / total;
          attackShare.set(id, strikeStack(st, share, onAttackers.deep).left);
        }
      }

      defenceForce = defenders.reduce((n, [id]) => n + hullsAt(target, id), 0);
      for (const [i, entry] of defenders.entries()) {
        defenders[i] = [entry[0], stackAt(target, entry[0])];
      }
      const struck = `Torpedoes run in ahead of the fleets over ${target.name}: ${coalition} loses ${beforeAtk - attackHulls()} ships, the defenders lose ${beforeDef - defenceForce}.`;
      notes.push(struck);
      rounds.push({
        turn: state.turn, phase: 'strike', outcome: 'torpedo_strike',
        attackPower: Math.round(onDefenders.tons), defendPower: Math.round(onAttackers.tons),
        assault: 0, garrison: 0, garrisonEffective: 0,
        attackers: sideOf(attackShare, attackSnapshot),
        defenders: sideOf(new Map(defenders), defendSnapshot),
        note: struck,
      });
      attackSnapshot = new Map(attackShare);
      defendSnapshot = new Map(defenders);
    }
  }

  /* ---------- Phase 1: fleet battle ---------- */
  const attackWeight = weightOfSide(attackShare.values());
  const defendWeight = weightOfSide(defenders.map(([, st]) => st));

  /**
   * A fleet that cannot shoot cannot deny the orbitals, and cannot cover its
   * own withdrawal either.
   *
   * Without this a pure-lift squadron squatting in orbit had `defendWeight` 0,
   * which every branch below reads as "nothing to fight" — so a convoy nobody
   * could remove would block a landing forever. It is a walkover that destroys
   * them, not a no-op. Symmetric, so an invasion that arrives as transports
   * only is annihilated the same way.
   */
  if (defenceForce > 0 && defendWeight === 0 && attackWeight > 0) {
    let lost = 0;
    for (const [id, st] of defenders) {
      lost += hullsIn(st);
      setStackAt(target, id, {});
    }
    const swept = `${defenders.map(([id]) => nameOf(id)).join(' and ')} has nothing over ${target.name} that can fight; ${lost} unarmed ships are destroyed where they lie.`;
    notes.push(swept);
    rounds.push({
      turn: state.turn, phase: 'orbital', outcome: 'defender_broke_off',
      attackPower: Math.round(attackWeight), defendPower: 0,
      assault: 0, garrison: 0, garrisonEffective: 0,
      attackers: sideOf(attackShare, attackSnapshot),
      defenders: sideOf(new Map(defenders.map(([id]) => [id, {}])), defendSnapshot),
      note: swept,
    });
    attackSnapshot = new Map(attackShare);
    defendSnapshot = new Map();
    defenceForce = 0;
  } else if (defenceForce > 0 && attackWeight === 0 && defendWeight > 0) {
    let lost = 0;
    for (const [id, st] of attackShare) {
      lost += hullsIn(st);
      attackShare.set(id, {});
    }
    const note = `${coalition} arrives over ${target.name} with nothing that can fight; ${lost} unarmed ships are destroyed by its defenders.`;
    logEvent(state, 'order', note, attackers[0]![0]);
    rounds.push({
      turn: state.turn, phase: 'orbital', outcome: 'attacker_driven_off',
      attackPower: 0, defendPower: Math.round(defendWeight),
      assault: 0, garrison: 0, garrisonEffective: 0,
      attackers: sideOf(attackShare, attackSnapshot),
      defenders: sideOf(new Map(defenders), defendSnapshot),
      note,
    });
    return finish(note);
  } else if (defenceForce > 0 && defendWeight > 0) {
    const swing = (roll - 10.5) / 22;
    const attackPower = attackWeight * (1 + attackMod / 20) * (1 + swing);
    const defendPower = defendWeight * (1 + defendMod / 20) * (1 - swing);

    // A crusading power does not break off, in either direction. It wins
    // engagements it should have fled and loses fleets it should have saved —
    // the Iron Vigil fighting for the mandate rather than for the arithmetic.
    const defenderStands = holderEthic === 'crusading';
    const attackerStands = attackEthic === 'crusading';

    const orbital = (outcome: BattleOutcome, note: string): void => {
      rounds.push({
        turn: state.turn, phase: 'orbital', outcome,
        attackPower: Math.round(attackPower), defendPower: Math.round(defendPower),
        assault: 0, garrison: 0, garrisonEffective: 0,
        attackers: sideOf(attackShare, attackSnapshot),
        defenders: sideOf(
          new Map(defenders.map(([id]) => [id, stackAt(target, id)])),
          defendSnapshot,
        ),
        note,
      });
      attackSnapshot = new Map(attackShare);
      defendSnapshot = new Map(defenders.map(([id]) => [id, stackAt(target, id)]));
    };
    // Only reported when it CHANGED the outcome: a crusading power that was
    // never asked to retreat did not do anything worth telling the player.
    if (defenderStands && attackPower >= defendPower * 2) {
      doctrinesFired.push(
        `crusading: ${nameOf(holder!)} was outmatched 2:1 and did not break off`,
      );
    }
    if (attackerStands && attackPower * 2 <= defendPower) {
      doctrinesFired.push(
        `crusading: ${nameOf(largestAttacker!)} was outmatched 2:1 and pressed the attack anyway`,
      );
    }

    if (attackPower >= defendPower * 2 && !defenderStands) {
      let lost = 0;
      for (const [id, present] of defenders) {
        const escaped = bleed(present);
        lost += hullsIn(present) - hullsIn(escaped);
        setStackAt(target, id, {});
        const refuge = fleetBases(state, id).find(
          (x) => x.id !== target.id && x.controllerFactionId === id,
        );
        if (refuge && hullsIn(escaped) > 0) addStackAt(refuge, id, escaped);
      }
      const broke = `${defenders.map(([id]) => nameOf(id)).join(' and ')} breaks off over ${target.name}, losing ${lost} ships between them.`;
      notes.push(broke);
      orbital('defender_broke_off', broke);
      defenceForce = 0;
    } else if (attackPower * 2 <= defendPower && !attackerStands) {
      // The coalition withdraws, each contingent back down its own path.
      let lost = 0;
      for (const order of orders) {
        if (!attackerIds.has(order.factionId)) continue;
        const escaped = bleed(order.force);
        lost += hullsIn(order.force) - hullsIn(escaped);
        const fallback = order.path[Math.max(0, order.path.length - 2)] ?? order.originId;
        const refuge = state.systems.find((x) => x.id === fallback);
        if (refuge && hullsIn(escaped) > 0) {
          addStackAt(refuge, order.factionId, escaped);
        }
      }
      for (const [id] of attackShare) attackShare.set(id, {});
      const note = `${coalition}'s attack on ${target.name} is driven off by its defenders, losing ${lost} ships.`;
      logEvent(state, 'order', note, attackers[0]![0]);
      orbital('attacker_driven_off', note);
      return finish(note);
    } else {
      // Both sides trade around the WEAKER side's raw weight, and the roll
      // tilts which of them comes off better. Settled in
      // battleship-equivalents and then charged to each contingent as a
      // fraction of the TONNAGE it brought — which is what makes a transport
      // die alongside the line that was covering it rather than sailing
      // through the battle untouched because it has no guns.
      //
      // **The roll used to reach the defender backwards.** The exchange was
      // `min(attackPower, defendPower)`, so whichever side was weaker had its
      // own swing already baked into the figure, and dividing by that side's
      // own modifier cancelled the modifier but not the swing:
      //
      //     defenceLeft = defendWeight - defendWeight x (1 - swing)
      //                 = defendWeight x swing
      //
      // — so a natural 20 left a defender that could not break off with 42% of
      // its fleet intact and a natural 1 annihilated it. Measured live against
      // the same crusading Vigil at the same odds: roll 20 left seven
      // battleships holding the orbitals and the landing was called off; roll
      // 10 destroyed them outright. The good roll was the worse outcome, and it
      // bit hardest against `crusading` — the one doctrine that never escapes
      // this branch by breaking off.
      //
      // The swing is applied ONCE now, to a base neither side's modifier has
      // touched, in the same direction for both: it takes losses off the
      // attacker and adds them to the defender. Might then divides each side's
      // own losses, so it is counted once as well.
      const base = Math.min(attackWeight, defendWeight);
      const tilt = base * swing;
      const attackLeft = Math.max(
        0,
        attackWeight - Math.ceil((base - tilt) / (1 + attackMod / 20)),
      );
      const defenceLeft = Math.max(
        0,
        defendWeight - Math.ceil((base + tilt) / (1 + defendMod / 20)),
      );
      const hullsBeforeExchange = attackHulls();
      const defendHullsBefore = defenceForce;

      // No redirection here: the boats already fired, in the strike phase, and
      // carry nothing into the line. The exchange is the battle line's alone.
      for (const [id, st] of attackShare) {
        const lost = tonsIn(st) * (1 - attackLeft / attackWeight);
        attackShare.set(id, strikeStack(st, lost).left);
      }
      for (const [id, present] of defenders) {
        const lost = tonsIn(present) * (1 - defenceLeft / defendWeight);
        setStackAt(target, id, strikeStack(present, lost).left);
      }
      defenceForce = defenders.reduce((sum, [id]) => sum + hullsAt(target, id), 0);

      const engaged = `Fleets engage over ${target.name}: ${coalition} loses ${hullsBeforeExchange - attackHulls()} ships, the defenders lose ${defendHullsBefore - defenceForce}.`;
      notes.push(engaged);
      // Recorded after the redistribution, so the per-contingent numbers are
      // the ones that actually landed on the board.
      orbital('exchange', engaged);
    }
  }

  // Denial is a question of guns, not of hulls: a surviving fleet that cannot
  // shoot has already been dealt with above, and one that can stops a landing.
  if (weightOfSide(defenders.map(([id]) => stackAt(target, id))) > 0) {
    for (const [id, st] of attackShare) land(id, st);
    const note = `${notes.join(' ')} The defenders still hold the orbitals of ${target.name}; no landing is attempted.`.trim();
    logEvent(state, 'order', note, attackers[0]![0]);
    if (rounds.length > 0) rounds[rounds.length - 1]!.outcome = 'no_landing';
    return finish(note);
  }

  if (attackHulls() <= 0) {
    const note = `${notes.join(' ')} ${coalition}'s force is spent over ${target.name}.`.trim();
    logEvent(state, 'order', note, attackers[0]![0]);
    if (rounds.length > 0) rounds[rounds.length - 1]!.outcome = 'force_spent';
    return finish(note);
  }

  // A sweep ends here whichever way it went. There is no ground phase: the
  // holder already holds the ground, the garrison took no part, and there is
  // nothing to take. Surviving hulls put in over the world they came to clear.
  if (sweep) {
    for (const [id, st] of attackShare) land(id, st);
    const cleared = `${notes.join(' ')} ${nameOf(holder!)} clears the orbitals of ${target.name}.`.trim();
    logEvent(state, 'order', cleared, holder);
    if (rounds.length > 0) rounds[rounds.length - 1]!.outcome = 'orbit_cleared';
    return finish(cleared);
  }

  /* ---------- Phase 2: ground assault ---------- */
  const garrison = target.garrison;
  // A defensive power's ground is dug in: its garrison fights as though it were
  // half again its size, and costs the attacker accordingly. "Make occupation
  // cost more than it is worth" is the Arkane doctrine written as arithmetic.
  // Only the real garrison is ever destroyed — the bonus buys resistance, not
  // extra troops to kill.
  const dugIn =
    holderEthic === 'defensive' ? Math.round(garrison * DEFENSIVE_GARRISON_BONUS) : garrison;
  if (dugIn !== garrison) {
    doctrinesFired.push(
      `defensive: ${nameOf(holder!)}'s garrison of ${garrison} fought as ${dugIn}`,
    );
  }
  /**
   * A world is taken by the troops the lift arm puts on it.
   *
   * `attackForce` used to be every hull in the coalition, so a fleet of pure
   * warships stormed a planet by flying at it. Ground combat now counts what is
   * actually aboard, which is what gives conquest a dedicated cost and lets an
   * all-gun fleet win the orbitals and take nothing.
   */
  const liftersIn = (): number =>
    [...attackShare.values()].reduce((n, st) => n + (st.lifter ?? 0), 0);
  const troops = [...attackShare.values()].reduce((n, st) => n + carryOf(st), 0);
  const assault = troops * (1 + attackMod / 20) * (1 + (roll - 10.5) / 30);
  const ground = (outcome: BattleOutcome, note: string): void => {
    rounds.push({
      turn: state.turn, phase: 'ground', outcome,
      attackPower: 0, defendPower: 0,
      assault: Math.round(assault), garrison, garrisonEffective: dugIn,
      attackers: sideOf(attackShare, attackSnapshot),
      defenders: [],
      note,
    });
    attackSnapshot = new Map(attackShare);
  };

  // Won the orbitals with nothing aboard to put ashore. The world is left
  // sterilised and in the same hands, which is the cost of sending a fleet
  // that is all guns.
  if (troops <= 0) {
    for (const [id, st] of attackShare) land(id, st);
    const note = `${notes.join(' ')} ${coalition} commands the orbitals of ${target.name} and has no troops aboard to land.`.trim();
    logEvent(state, 'order', note, attackers[0]![0]);
    ground('no_lift', note);
    return finish(note);
  }

  if (assault > dugIn) {
    // The garrison is broken by troops, and the troops die with the transports
    // carrying them — so a hard-fought landing eats the lift arm and conquest
    // stays a recurring cost rather than a one-off purchase.
    //
    // An expansionist consolidates what it takes: it comes through the landing
    // with more of its lift intact, so the occupying force it leaves behind is
    // larger and conquest sticks instead of needing re-garrisoning the moment
    // the fleet moves on. The same doctrine as before, said through the
    // mechanism that now decides a garrison.
    // A garrison that is broken still kills its own strength in troops, and
    // the transports that carried them go with them.
    //
    // It was half that, mirroring the old formula — which charged half the
    // garrison in *warships*. Half a garrison of ten is five hulls, 300
    // credits; half of it in lift is one lifter, 45. Conquest came out six
    // times CHEAPER than the model it replaced, which is the opposite of "a
    // dedicated cost", and the balance harness showed it immediately: the
    // Vigil rolled Meridian down to a single world by turn 30.
    const bare = Math.ceil(dugIn / LIFTER_CARRY);
    // Rounded in the expansionist's favour rather than against it: a lifter
    // carries six, so `bare` is usually 1 or 2 against the garrisons on this
    // map, and halving upwards would leave the doctrine inert exactly where
    // most conquests happen.
    const lifterLosses = Math.min(
      liftersIn(),
      attackEthic === 'expansionist' ? Math.floor(bare / 2) : bare,
    );
    if (attackEthic === 'expansionist' && lifterLosses < bare) {
      doctrinesFired.push(
        `expansionist: ${nameOf(largestAttacker!)} consolidates, losing ${lifterLosses} lifters in the landing rather than ${bare}`,
      );
    }
    spendLifters(attackShare, lifterLosses);
    // Spoils go to whoever put the most troops on the ground, not to whoever
    // brought the most ships: a partner who escorted the convoy and landed
    // nobody has not taken the world.
    const owner = strongestBy(attackShare, carryOf);
    target.controllerFactionId = owner;
    // The garrison IS the landing force. What holds the world afterwards is
    // the troops that took it, up to what the world can quarter — not a
    // fraction of the defenders, who were just destroyed.
    const landed = [...attackShare.values()].reduce((n, st) => n + carryOf(st), 0);
    target.garrison = Math.max(1, Math.min(target.garrisonMax, landed));
    for (const [id, st] of attackShare) land(id, st);
    const note = `${notes.join(' ')} ${coalition} storms ${target.name}, breaking a garrison of ${garrison} for ${lifterLosses} lifters; ${nameOf(owner)} takes possession with ${target.garrison} troops ashore.`.trim();
    logEvent(state, 'order', note, owner);
    ground('world_taken', note);
    return finish(note);
  }

  const lifterLosses = Math.ceil(liftersIn() / 3);
  target.garrison = Math.max(0, garrison - Math.ceil(troops / 4));
  spendLifters(attackShare, lifterLosses);
  for (const [id, st] of attackShare) land(id, st);
  const note = `${notes.join(' ')} ${coalition}'s landing on ${target.name} is thrown back by its garrison; ${lifterLosses} lifters lost.`.trim();
  logEvent(state, 'order', note, attackers[0]![0]);
  ground('landing_thrown_back', note);
  return finish(note);
}

/**
 * How much of a torpedo strike goes past the screen to the heaviest hulls.
 *
 * **Escorts are what answers boats**, which is the historical shape as well as
 * the mechanical one: destroyers were originally *torpedo boat destroyers*. A
 * screen matching the attacking boats ton for ton turns the strike aside
 * entirely — the tonnage still burns, but it burns off the screen instead of
 * the battle line. Half a screen turns aside half of it.
 */
function pastScreen(firing: ShipStack[], target: ShipStack[]): number {
  const boats = tonsOfClass(firing, 'torpedo_boat');
  if (boats <= 0) return 0;
  const screen = tonsOfClass(target, 'escort');
  return Math.max(0, 1 - Math.min(1, screen / boats));
}

/**
 * Take `count` lifters off a coalition, proportionally, largest remainder.
 *
 * Ground losses fall on the lift arm and nowhere else: the escorts and the
 * battle line are in orbit, and it is the landing that is being fought.
 */
function spendLifters(share: Map<string, ShipStack>, count: number): void {
  const total = [...share.values()].reduce((n, st) => n + (st.lifter ?? 0), 0);
  if (total <= 0 || count <= 0) return;
  const want = Math.min(count, total);
  const ids = [...share.keys()].filter((id) => (share.get(id)!.lifter ?? 0) > 0);
  const exact = ids.map((id) => ((share.get(id)!.lifter ?? 0) * want) / total);
  const take = exact.map((x) => Math.floor(x));
  let assigned = take.reduce((a, b) => a + b, 0);
  const order = ids
    .map((id, i) => ({ i, id, frac: exact[i]! - take[i]! }))
    .sort((a, b) => b.frac - a.frac || a.id.localeCompare(b.id));
  for (const { i, id } of order) {
    if (assigned >= want) break;
    if (take[i]! >= (share.get(id)!.lifter ?? 0)) continue;
    take[i]! += 1;
    assigned += 1;
  }
  ids.forEach((id, i) => {
    const stack = { ...share.get(id)! };
    const left = (stack.lifter ?? 0) - take[i]!;
    if (left > 0) stack.lifter = left;
    else delete stack.lifter;
    share.set(id, stack);
  });
}

/**
 * Who owns a captured world, by whichever measure the caller cares about.
 *
 * A world stormed goes to the power that landed the most troops; a world walked
 * into goes to the power that brought the most ship. Ties break on faction id
 * so replay stays exact.
 */
function strongestBy(share: Map<string, ShipStack>, weigh: (s: ShipStack) => number): string {
  return [...share.entries()].sort(
    (a, b) => weigh(b[1]) - weigh(a[1]) || a[0].localeCompare(b[0]),
  )[0]![0];
}

