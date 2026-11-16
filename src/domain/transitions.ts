import type { Commitment } from './arbitration.js';
import type { Commander } from './command.js';
import type { Debt } from './debt.js';
import {
  fixtureIntegrity,
  isTruceLive,
  MAX_FIXTURES_PER_WORLD,
  type Bounty,
  type Demand,
  type Obligation,
  type Treaty,
  type Truce,
} from './diplomacy.js';
import type { Loan } from './loan.js';
import { personViolations } from './people.js';
import { seatsFor } from './seats.js';
import { isStatFixture, relationBetween, type WorldState } from './state.js';
import { say } from '../skin/lexicon.js';

/**
 * The headless spine's second check: every state machine in the world keeps
 * its own rules, on any one world and between any two consecutive ones.
 *
 * `personViolations` already holds people to one place each. This adds the
 * rest — treaties, truces, debts, loans, favours owed, ultimatums, bounties,
 * commitments, officers, orders, fixtures, a world's standing, seats and the
 * relation between two powers — so the engine can be checked with no browser
 * and no model attached. The bug-hunt gate runs it over every step of every
 * saved campaign, and the suite over the balance harness.
 *
 * Read-only, like `bands.ts` and `people.ts`: nothing here changes what any
 * mechanic does, and a campaign replays exactly as it did.
 */

/* ------------------------------------------------------------------ */
/* The lifecycles, as graphs                                           */
/* ------------------------------------------------------------------ */

/**
 * Each machine's legal moves, one step at a time. Keyed by the status enum, so
 * a status added to a schema fails the typecheck here until it is given its
 * edges. A terminal status has none.
 */
type Graph<S extends string> = { readonly [K in S]: readonly S[] };

export const TREATY_MOVES: Graph<Treaty['status']> = {
  // Agreed and waiting on ratification: it goes live, or is backed out of,
  // voided or superseded before it does.
  pending: ['active', 'broken', 'voided', 'superseded', 'expired'],
  active: ['expired', 'broken', 'superseded', 'voided'],
  expired: [],
  broken: [],
  superseded: [],
  voided: [],
};

export const TRUCE_MOVES: Graph<Truce['status']> = {
  active: ['ended', 'broken'],
  ended: [],
  broken: [],
};

export const DEBT_MOVES: Graph<Debt['status']> = {
  current: ['delinquent', 'settled', 'forgiven'],
  // Paying again clears the status; never `missedPayments`.
  delinquent: ['current', 'settled', 'forgiven'],
  settled: [],
  forgiven: [],
};

export const LOAN_MOVES: Graph<Loan['status']> = {
  current: ['delinquent', 'defaulted', 'returned', 'forgiven'],
  delinquent: ['current', 'defaulted', 'returned', 'forgiven'],
  // A default ends the automatic return; `return_loan` still makes it good.
  defaulted: ['returned', 'forgiven'],
  returned: [],
  forgiven: [],
};

export const OBLIGATION_MOVES: Graph<Obligation['status']> = {
  // A strong hook that is called rests and stays open.
  open: ['called', 'repudiated', 'lapsed', 'released'],
  called: [],
  repudiated: [],
  lapsed: [],
  released: [],
};

export const ULTIMATUM_MOVES: Graph<Demand['status']> = {
  open: ['conceded', 'war', 'withdrawn'],
  conceded: [],
  war: [],
  withdrawn: [],
};

export const BOUNTY_MOVES: Graph<Bounty['status']> = {
  open: ['claimed', 'withdrawn'],
  claimed: [],
  withdrawn: [],
};

export const COMMITMENT_MOVES: Graph<Commitment['status']> = {
  active: ['dissolved'],
  dissolved: [],
};

export const OFFICER_MOVES: Graph<Commander['status']> = {
  listed: ['active'],
  active: ['captured', 'lost'],
  // Handed home: back on the Lists from journal version 20, back in post
  // before it. Questioned or executed: lost.
  captured: ['active', 'listed', 'lost'],
  lost: [],
};

/**
 * Whether `to` can follow `from` in any number of steps. The harness samples
 * once a turn and the gate once a batch, so a check between two samples has to
 * allow anything the graph can reach, not only one edge.
 */
export function reachable<S extends string>(graph: Graph<S>, from: S, to: S): boolean {
  if (from === to) return true;
  const seen = new Set<S>([from]);
  const queue: S[] = [from];
  while (queue.length > 0) {
    for (const next of graph[queue.shift()!] ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* One world                                                           */
/* ------------------------------------------------------------------ */

/**
 * What every world must be, whatever came before it. Returns what is broken,
 * empty when nothing is. People are `personViolations`, folded in.
 */
export function worldViolations(state: WorldState): string[] {
  const out = [...personViolations(state)];
  const factions = new Set(state.factions.map((f) => f.id));
  const systems = new Map(state.systems.map((s) => [s.id, s]));

  // Every keyed collection names each record once.
  const unique = (label: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) out.push(`${label} ${id} appears twice`);
      seen.add(id);
    }
  };
  unique('order', state.pendingOrders.map((o) => o.id));
  unique('treaty', state.treaties.map((t) => t.id));
  unique('debt', (state.debts ?? []).map((d) => d.id));
  unique('loan', (state.loans ?? []).map((l) => l.id));
  unique('obligation', (state.obligations ?? []).map((o) => o.id));
  unique('ultimatum', (state.demands ?? []).map((d) => d.id));
  unique('bounty', (state.bounties ?? []).map((b) => b.id));
  unique('commitment', (state.commitments ?? []).map((c) => c.id));
  unique('officer', (state.commanders ?? []).map((c) => c.id));
  unique('asset', (state.assets ?? []).map((a) => a.id));
  unique('notable', (state.notables ?? []).map((n) => n.id));

  // Relation: one reading for both directions, and never war under a live truce.
  for (const f of state.factions) {
    for (const [other, value] of Object.entries(f.disposition)) {
      if (other === f.id) out.push(`${f.id} holds a regard for itself`);
      else if (!factions.has(other)) out.push(`${f.id} holds a regard for ${other}, who does not exist`);
      if (value < -100 || value > 100) out.push(`${f.id}'s regard for ${other} is ${value}`);
    }
  }
  const ids = state.factions.map((f) => f.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ab = relationBetween(state, ids[i]!, ids[j]!).kind;
      const ba = relationBetween(state, ids[j]!, ids[i]!).kind;
      if (ab !== ba) out.push(`${ids[i]} and ${ids[j]} read as ${ab} one way and ${ba} the other`);
    }
  }

  // Treaties bind two powers that exist.
  for (const t of state.treaties) {
    if (t.parties[0] === t.parties[1]) out.push(`treaty ${t.id} binds ${t.parties[0]} to itself`);
    for (const p of t.parties) if (!factions.has(p)) out.push(`treaty ${t.id} binds ${p}, who does not exist`);
  }

  // Truces: one live truce a pair, none past its last turn.
  const liveTruces = new Map<string, number>();
  for (const t of state.truces ?? []) {
    if (t.status === 'active' && state.turn >= t.untilTurn) {
      out.push(`the truce between ${t.parties.join(' and ')} is active on turn ${state.turn}, past its last turn ${t.untilTurn - 1}`);
    }
    if (!isTruceLive(t, state.turn)) continue;
    const key = [...t.parties].sort().join('~');
    liveTruces.set(key, (liveTruces.get(key) ?? 0) + 1);
  }
  for (const [pair, n] of liveTruces) if (n > 1) out.push(`${n} truces hold between ${pair.replace('~', ' and ')}`);

  // Debts: a live one is owed something, a settled one nothing.
  for (const d of state.debts ?? []) {
    const live = d.status === 'current' || d.status === 'delinquent';
    if (live && d.balance <= 0) out.push(`debt ${d.id} is ${d.status} with nothing owed`);
    if (d.status === 'settled' && d.balance !== 0) out.push(`debt ${d.id} is settled with ${d.balance} still owed`);
    if (d.balance > d.principal) out.push(`debt ${d.id} owes ${d.balance}, more than its principal ${d.principal}`);
  }

  // Loans: what has come back has nothing outstanding.
  for (const l of state.loans ?? []) {
    if (l.status === 'returned' && l.outstanding !== null) out.push(`loan ${l.id} is returned with something still out`);
  }

  // Favours: only a weak one is spent by calling it; only a strong hook rests.
  for (const o of state.obligations ?? []) {
    if (o.status === 'called' && o.strength !== 'weak') out.push(`obligation ${o.id} is a ${o.strength} hook marked called`);
    if (o.restsUntil !== null && o.strength !== 'strong') out.push(`obligation ${o.id} is ${o.strength} and resting`);
  }

  // Bounties: an open pool has money in it, a closed one none.
  for (const b of state.bounties ?? []) {
    if (b.status === 'open' && b.pool <= 0) out.push(`bounty ${b.id} is open with an empty pool`);
    if (b.status !== 'open' && b.pool !== 0) out.push(`bounty ${b.id} is ${b.status} with ${b.pool} still in it`);
  }

  // Orders: a power that exists, worlds that exist, progress within the term.
  for (const o of state.pendingOrders) {
    if (!factions.has(o.factionId)) out.push(`order ${o.id} belongs to ${o.factionId}, who does not exist`);
    if (!systems.has(o.originId)) out.push(`order ${o.id} starts at ${o.originId}, which does not exist`);
    if (!systems.has(o.targetId)) out.push(`order ${o.id} is bound for ${o.targetId}, which does not exist`);
    if (o.progress < 0 || o.progress > o.durationTurns) {
      out.push(`order ${o.id} is ${o.progress} of ${o.durationTurns} turns along`);
    }
  }

  // Fixtures: on a world, within their slots, no two alike, damage within the budget.
  const statFixtures = new Map<string, string[]>();
  for (const a of state.assets ?? []) {
    if (a.portable) continue;
    if (a.atSystemId === null || !systems.has(a.atSystemId)) {
      out.push(say`fixture ${a.id} stands on no {world}`);
      continue;
    }
    if ((a.damage ?? 0) > fixtureIntegrity(a)) out.push(`fixture ${a.id} has ${a.damage} damage against ${fixtureIntegrity(a)}`);
    if (isStatFixture(a)) statFixtures.set(a.atSystemId, [...(statFixtures.get(a.atSystemId) ?? []), a.kind]);
  }
  for (const [world, kinds] of statFixtures) {
    if (kinds.length > MAX_FIXTURES_PER_WORLD) out.push(`${world} carries ${kinds.length} fixtures`);
    if (new Set(kinds).size < kinds.length) out.push(`${world} carries two fixtures of one kind`);
  }

  // A world's standing is held toward powers that exist.
  for (const s of state.systems) {
    for (const [who, value] of Object.entries(s.regard ?? {})) {
      if (!factions.has(who)) out.push(`${s.id} holds a standing with ${who}, who does not exist`);
      if (value < -100 || value > 100) out.push(`${s.id}'s standing with ${who} is ${value}`);
    }
  }

  // Seats: one notable a seat, on a world that has it.
  const seated = new Map<string, string>();
  for (const n of state.notables ?? []) {
    if (n.systemId === null) continue;
    const world = systems.get(n.systemId);
    if (!world) {
      out.push(`notable ${n.id} sits on ${n.systemId}, which does not exist`);
      continue;
    }
    const seat = `${n.systemId}#${n.seat}`;
    const already = seated.get(seat);
    if (already) out.push(`${n.id} and ${already} both hold seat ${n.seat} at ${n.systemId}`);
    seated.set(seat, n.id);
    if (n.seat >= seatsFor(world)) out.push(`notable ${n.id} holds seat ${n.seat} at ${n.systemId}, which has ${seatsFor(world)}`);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Two worlds                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a transition check needs of one world: each machine's records, by id,
 * reduced to the fields a move is judged on. Small, so a watcher can keep the
 * last one without holding a whole world.
 */
export interface Machines {
  turn: number;
  treaties: Map<string, { status: Treaty['status']; type: string; parties: string }>;
  truces: { status: Truce['status']; parties: string; treatyId: string; untilTurn: number }[];
  debts: Map<string, { status: Debt['status']; debtor: string; principal: number; balance: number }>;
  loans: Map<string, { status: Loan['status']; lender: string; borrower: string }>;
  obligations: Map<string, { status: Obligation['status']; debtor: string; strength: string }>;
  demands: Map<string, { status: Demand['status']; from: string; to: string; kind: string }>;
  bounties: Map<string, { status: Bounty['status']; target: string; paidOut: number }>;
  commitments: Map<string, { status: Commitment['status']; kind: string }>;
  officers: Map<string, { status: Commander['status']; factionId: string; name: string; battles: number }>;
  orders: Map<string, { factionId: string; type: string; progress: number }>;
  fixtures: Map<string, { kind: string; atSystemId: string | null }>;
  notables: Map<string, { estateId: string | null }>;
}

export function machinesOf(state: WorldState): Machines {
  return {
    turn: state.turn,
    treaties: new Map(state.treaties.map((t) => [t.id, { status: t.status, type: t.type, parties: [...t.parties].sort().join('~') }])),
    truces: (state.truces ?? []).map((t) => ({
      status: t.status,
      parties: [...t.parties].sort().join('~'),
      treatyId: t.treatyId,
      untilTurn: t.untilTurn,
    })),
    debts: new Map(
      (state.debts ?? []).map((d) => [d.id, { status: d.status, debtor: d.debtorFactionId, principal: d.principal, balance: d.balance }]),
    ),
    loans: new Map((state.loans ?? []).map((l) => [l.id, { status: l.status, lender: l.lenderFactionId, borrower: l.borrowerFactionId }])),
    obligations: new Map(
      (state.obligations ?? []).map((o) => [o.id, { status: o.status, debtor: o.debtorFactionId, strength: o.strength }]),
    ),
    demands: new Map(
      (state.demands ?? []).map((d) => [d.id, { status: d.status, from: d.fromFactionId, to: d.toFactionId, kind: d.kind }]),
    ),
    bounties: new Map((state.bounties ?? []).map((b) => [b.id, { status: b.status, target: b.targetFactionId, paidOut: b.paidOut }])),
    commitments: new Map((state.commitments ?? []).map((c) => [c.id, { status: c.status, kind: c.kind }])),
    officers: new Map(
      (state.commanders ?? []).map((c) => [c.id, { status: c.status, factionId: c.factionId, name: c.name, battles: c.battles }]),
    ),
    orders: new Map(state.pendingOrders.map((o) => [o.id, { factionId: o.factionId, type: o.type, progress: o.progress }])),
    fixtures: new Map(
      (state.assets ?? []).filter((a) => !a.portable).map((a) => [a.id, { kind: a.kind, atSystemId: a.atSystemId }]),
    ),
    notables: new Map((state.notables ?? []).map((n) => [n.id, { estateId: n.estateId }])),
  };
}

/**
 * The moves no machine may make between two worlds, the second later than the
 * first: a status the graph cannot reach, a record that should never leave
 * leaving, a fixed fact about a record changing, a count running backwards.
 *
 * `ended` is every order id the caller has seen leave the board, so an order
 * that came back after several samples is caught too. `watchMachines` keeps it.
 */
export function transitionViolations(before: Machines, after: Machines, ended: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  if (after.turn < before.turn) out.push(`the turn ran back from ${before.turn} to ${after.turn}`);

  /** A machine whose records are never removed, each moving only along its graph. */
  function lifecycle<S extends string, R extends { status: S }>(
    label: string,
    graph: Graph<S>,
    was: Map<string, R>,
    now: Map<string, R>,
    fixed: (r: R) => string,
  ): void {
    for (const [id, a] of was) {
      const b = now.get(id);
      if (!b) {
        out.push(`${label} ${id} was ${a.status} and is gone`);
        continue;
      }
      if (!reachable(graph, a.status, b.status)) out.push(`${label} ${id} went from ${a.status} to ${b.status}`);
      if (fixed(a) !== fixed(b)) out.push(`${label} ${id} changed from ${fixed(a)} to ${fixed(b)}`);
    }
  }

  // Treaties are removed in one place, the envoys sandbox, before turn 0.
  lifecycle('treaty', TREATY_MOVES, before.treaties, after.treaties, (t) => `${t.type} ${t.parties}`);
  lifecycle('debt', DEBT_MOVES, before.debts, after.debts, (d) => `${d.debtor} owing ${d.principal}`);
  lifecycle('loan', LOAN_MOVES, before.loans, after.loans, (l) => `${l.lender} to ${l.borrower}`);
  lifecycle('obligation', OBLIGATION_MOVES, before.obligations, after.obligations, (o) => `${o.strength} on ${o.debtor}`);
  lifecycle('ultimatum', ULTIMATUM_MOVES, before.demands, after.demands, (d) => `${d.kind} ${d.from} to ${d.to}`);
  lifecycle('bounty', BOUNTY_MOVES, before.bounties, after.bounties, (b) => `on ${b.target}`);
  lifecycle('commitment', COMMITMENT_MOVES, before.commitments, after.commitments, (c) => c.kind);
  lifecycle('officer', OFFICER_MOVES, before.officers, after.officers, (c) => `${c.name} of ${c.factionId}`);

  // Truces are never removed and have no id: one record a slot, in order.
  if (after.truces.length < before.truces.length) out.push(`${before.truces.length - after.truces.length} truce(s) are gone`);
  before.truces.forEach((a, i) => {
    const b = after.truces[i];
    if (!b) return;
    if (!reachable(TRUCE_MOVES, a.status, b.status)) out.push(`the truce between ${a.parties} went from ${a.status} to ${b.status}`);
    if (a.parties !== b.parties || a.treatyId !== b.treatyId || a.untilTurn !== b.untilTurn) {
      out.push(`the truce between ${a.parties} became one between ${b.parties}`);
    }
  });

  // Counts that only rise or only fall.
  for (const [id, a] of before.debts) {
    const b = after.debts.get(id);
    if (b && b.balance > a.balance) out.push(`debt ${id} rose from ${a.balance} to ${b.balance}`);
  }
  for (const [id, a] of before.bounties) {
    const b = after.bounties.get(id);
    if (b && b.paidOut < a.paidOut) out.push(`bounty ${id} has paid out ${b.paidOut}, less than the ${a.paidOut} it had`);
  }
  for (const [id, a] of before.officers) {
    const b = after.officers.get(id);
    if (b && b.battles < a.battles) out.push(`officer ${id} has fought ${b.battles}, fewer than ${a.battles}`);
  }

  // Orders: an order that ended is never back; one still running keeps its owner and kind and never runs backwards.
  for (const [id, b] of after.orders) {
    if (!before.orders.has(id) && ended.has(id)) out.push(`order ${id} ended and is back`);
    const a = before.orders.get(id);
    if (!a) continue;
    if (a.factionId !== b.factionId || a.type !== b.type) out.push(`order ${id} changed from ${a.factionId} ${a.type} to ${b.factionId} ${b.type}`);
    if (b.progress < a.progress) out.push(`order ${id} ran back from ${a.progress} to ${b.progress}`);
  }

  // Fixtures stand where they were built, as what they were built as.
  for (const [id, a] of before.fixtures) {
    const b = after.fixtures.get(id);
    if (b && (a.kind !== b.kind || a.atSystemId !== b.atSystemId)) {
      out.push(`fixture ${id} moved from ${a.kind} at ${a.atSystemId} to ${b.kind} at ${b.atSystemId}`);
    }
  }

  // A notable never moves from one estate to another. An independent world's
  // takes one when the world joins a power, and gives it up when a world rises.
  for (const [id, a] of before.notables) {
    const b = after.notables.get(id);
    if (b && a.estateId !== null && b.estateId !== null && a.estateId !== b.estateId) {
      out.push(`notable ${id} moved from ${a.estateId} to ${b.estateId}`);
    }
  }
  return out;
}

/**
 * Both checks, fed one world after another: the gate gives it every step of a
 * replay, the suite every turn of the harness. Each call returns what that
 * world broke, on its own or against the one before it.
 */
export function watchMachines(): { step(state: WorldState): string[] } {
  let last: Machines | null = null;
  const ended = new Set<string>();
  return {
    step(state) {
      const now = machinesOf(state);
      const out = worldViolations(state);
      if (last) {
        out.push(...transitionViolations(last, now, ended));
        for (const id of last.orders.keys()) if (!now.orders.has(id)) ended.add(id);
      }
      last = now;
      return out;
    },
  };
}
