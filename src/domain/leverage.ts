import {
  assetWorthTo,
  atWork,
  obligationsOwed,
  DARK_PROOF_TURNS,
  PIRACY_REPUTATION_COST,
  type Concession,
  type Secret,
} from './diplomacy.js';
import { isDebtLive } from './debt.js';
import { isLoanLive } from './loan.js';
import { SECRET_CATEGORIES } from './intel.js';
import { DEVELOPMENT_PAYBACK_TURNS } from './development.js';
import { statModifier } from './checks.js';
import { HULL_SPEC } from './hulls.js';
import {
  INCOME_PER_STRATEGIC_POINT,
  SHIP_COST,
  dispositionBetween,
  effectiveStats,
  getFaction,
  ledgerFor,
  orbitalWeightAt,
  underDuressFrom,
  type WorldState,
} from './state.js';
import type { DurationCategory } from './duration.js';

/**
 * Leverage: what one power has over another, read off the board.
 *
 * The pure half of the obligations tree — the records live in `diplomacy.ts`
 * beside the other standing structures, and the reducer changes them. This
 * module only reads: which secrets a power has to find, whether a piece of
 * proof still proves anything, how much a power can give up in a conversation,
 * and how hard each side of an ultimatum hits.
 */

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every secret `subject` is keeping right now, in a fixed order so the watcher
 * that finds one finds the same one on replay.
 */
export function secretsAbout(state: WorldState, subject: string): Secret[] {
  const out: Secret[] = [];
  for (const agent of [...(state.agents ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (agent.ownerFactionId === subject && atWork(agent, state.turn)) {
      out.push({ kind: 'covert_operation', subject, ref: agent.id });
    }
  }
  for (const order of [...state.pendingOrders].sort((a, b) => a.id.localeCompare(b.id))) {
    if (order.factionId !== subject) continue;
    // A raid run dark is proof of whose the raids are, priced at what it owed.
    if (order.dark) out.push(darkRaidSecret(state, order.id, subject, order.dark));
    else if (SECRET_CATEGORIES.has(order.type as DurationCategory)) {
      out.push({ kind: 'secret_programme', subject, ref: order.id });
    }
  }
  for (const debt of [...(state.debts ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (debt.debtorFactionId === subject && debt.status === 'delinquent') {
      out.push({ kind: 'default', subject, ref: debt.id });
    }
  }
  for (const loan of [...(state.loans ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (loan.borrowerFactionId === subject && loan.status === 'defaulted') {
      out.push({ kind: 'default', subject, ref: loan.id });
    }
  }
  return out;
}

/**
 * Whether proof still proves something. A burned operative, a finished
 * programme and a settled debt are old news: published, nobody cares, and
 * nobody pays to keep them quiet.
 */
export function secretLive(state: WorldState, secret: Secret): boolean {
  switch (secret.kind) {
    case 'covert_operation': {
      const agent = (state.agents ?? []).find((a) => a.id === secret.ref);
      return agent !== undefined && !agent.exposed;
    }
    case 'secret_programme':
      return state.pendingOrders.some((o) => o.id === secret.ref);
    case 'default': {
      const debt = (state.debts ?? []).find((d) => d.id === secret.ref);
      if (debt) return isDebtLive(debt) && debt.status === 'delinquent';
      const loan = (state.loans ?? []).find((l) => l.id === secret.ref);
      return loan !== undefined && isLoanLive(loan) && loan.status === 'defaulted';
    }
    // News while the raid runs, and for a while after the proof was filed.
    case 'dark_raid':
      return (
        state.pendingOrders.some((o) => o.id === secret.ref) ||
        state.turn <= (secret.filedTurn ?? 0) + DARK_PROOF_TURNS
      );
  }
}

/**
 * Proof that a dark raid is the subject's: what publishing it costs is double
 * what the raid owed while it ran dark.
 */
export function darkRaidSecret(
  state: WorldState,
  orderId: string,
  subject: string,
  owed: { turns: number; heat: number },
): Secret {
  const smuggler = getFaction(state, subject)?.tradeEthic === 'smuggler';
  return {
    kind: 'dark_raid',
    subject,
    ref: orderId,
    // Piracy is what everyone expects of a smuggler, open or dark.
    reputation: smuggler ? 0 : 2 * PIRACY_REPUTATION_COST * owed.turns,
    heat: 2 * owed.heat,
    filedTurn: state.turn,
  };
}

/** One clause, for the dossier's text and the log. */
export function describeSecret(state: WorldState, secret: Secret): string {
  const who = getFaction(state, secret.subject)?.name ?? secret.subject;
  const where = (id: string) => state.systems.find((x) => x.id === id)?.name ?? id;
  switch (secret.kind) {
    case 'covert_operation': {
      const agent = (state.agents ?? []).find((a) => a.id === secret.ref);
      return agent
        ? `${who} has an operative working ${agent.mission ?? 'unseen'} at ${where(agent.systemId)}`
        : `${who} runs an operative it has never owned to`;
    }
    case 'secret_programme': {
      const order = state.pendingOrders.find((o) => o.id === secret.ref);
      return order
        ? `${who} is running ${order.type.replace(/_/g, ' ')} at ${where(order.targetId)} in secret`
        : `${who} ran a programme it never admitted to`;
    }
    case 'default':
      return `${who} is not paying what it owes`;
    case 'dark_raid': {
      const order = state.pendingOrders.find((o) => o.id === secret.ref);
      return order
        ? `the raiders taking shipping at ${where(order.targetId)} are ${who}'s`
        : `${who} ran raids it never admitted to`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The concession budget                                               */
/* ------------------------------------------------------------------ */

/**
 * How long a flow is counted for when it is priced as a concession: ten turns,
 * about a third of a campaign. A payment every turn is worth more than the same
 * figure once, and less than forever.
 */
export const CONCESSION_FLOW_TURNS = 10;

/**
 * How many turns of its own income a power will give up in one conversation,
 * before standing and leverage scale it.
 */
export const CONCESSION_BUDGET_TURNS = 3;

/** The floor and ceiling on what standing and leverage can do to that. */
export const CONCESSION_SCALE_MIN = 0.25;
export const CONCESSION_SCALE_MAX = 3;

/**
 * What a concession is worth to the power making it, in credits.
 *
 * One unit for everything a concession can carry, which is what lets a budget
 * exist at all: money at face, a flow for `CONCESSION_FLOW_TURNS`, a hull at a
 * battleship's price, a world at `DEVELOPMENT_PAYBACK_TURNS` of what it pays
 * (the price development already uses for a point of value), and a thing at
 * what it is worth to the power giving it up — so prisoners worth nothing to
 * their holder cost nothing to hand over, which is the whole of gains-from-trade.
 * A free-form arrangement with no structured referent is worth nothing here;
 * its damage is bounded elsewhere.
 */
export function concessionWorth(state: WorldState, c: Concession): number {
  const worlds = c.systems.reduce((n, id) => {
    const sys = state.systems.find((x) => x.id === id);
    return n + (sys ? sys.strategicValue * INCOME_PER_STRATEGIC_POINT * DEVELOPMENT_PAYBACK_TURNS : 0);
  }, 0);
  const things = c.assets.reduce((n, id) => {
    const asset = (state.assets ?? []).find((a) => a.id === id);
    return n + (asset ? assetWorthTo(asset, c.by) : 0);
  }, 0);
  return c.credits + c.perTurn * CONCESSION_FLOW_TURNS + c.hulls * SHIP_COST + worlds + things;
}

export interface ConcessionBudget {
  /** Credits' worth the power will give up to this counterparty, in one channel. */
  budget: number;
  /** The multiplier on its income that standing and leverage produced. */
  scale: number;
  /** What moved the scale, one clause each, for the persona and the panel. */
  because: string[];
}

/**
 * How much `conceder` will give up to `other` in one conversation.
 *
 * Borrowed from *Burning Wheel*'s Duel of Wits, where an argument has a body
 * and the winner's compromise is sized by what it lost. **Code owns how much
 * ground; the model owns the words.** A persona's concessions were free text
 * checked only for whether they matched the ops, and personas are measurably
 * agreeable under pressure — so the amount a power gave up was whatever the
 * conversation talked it into.
 *
 * `CONCESSION_BUDGET_TURNS` of its gross income, scaled by:
 *
 * - the other side's **influence** — a tenth per modifier point;
 * - the conceder's **regard** for them — ±1 across the whole scale;
 * - **leverage** — a quarter for each obligation it owes them (a strong hook
 *   counts twice), a quarter for their ships over its worlds, a quarter for a
 *   debt it owes them.
 *
 * Clamped to `CONCESSION_SCALE_MIN`–`CONCESSION_SCALE_MAX`, so a hated rival
 * with nothing on you still gets a quarter, and nobody gets the treasury.
 */
export function concessionBudget(state: WorldState, conceder: string, other: string): ConcessionBudget {
  const because: string[] = [];
  let scale = 1;
  const influence = statModifier(effectiveStats(state, other, { covert: false }).influence);
  if (influence !== 0) {
    scale += influence * 0.1;
    because.push(`their influence ${influence > 0 ? '+' : ''}${influence}`);
  }
  const regard = dispositionBetween(state, conceder, other);
  if (regard !== 0) {
    scale += regard / 100;
    because.push(`your regard for them ${regard > 0 ? '+' : ''}${regard}`);
  }
  const owed = obligationsOwed(state.obligations, conceder, other);
  const hooks = owed.reduce((n, o) => n + (o.strength === 'strong' ? 2 : 1), 0);
  if (hooks > 0) {
    scale += hooks * 0.25;
    because.push(`${owed.length} obligation${owed.length === 1 ? '' : 's'} you owe them`);
  }
  if (underDuressFrom(state, other, conceder) > 0) {
    scale += 0.25;
    because.push('their ships over your worlds');
  }
  if ((state.debts ?? []).some((d) => isDebtLive(d) && d.debtorFactionId === conceder && d.creditorFactionId === other)) {
    scale += 0.25;
    because.push('a debt you owe them');
  }
  scale = Math.max(CONCESSION_SCALE_MIN, Math.min(CONCESSION_SCALE_MAX, scale));
  const gross = Math.max(0, ledgerFor(state, conceder).gross);
  return { budget: Math.round(gross * CONCESSION_BUDGET_TURNS * scale), scale, because };
}

/**
 * Hold a power's concessions in one channel to its budget, in the order it
 * made them: what fits stands, and anything that would carry the total past it
 * is struck. Only `conceder`'s own are touched — the other side's are theirs.
 */
export function withinBudget(
  state: WorldState,
  conceded: readonly Concession[],
  conceder: string,
  other: string,
): { kept: Concession[]; over: Concession[]; budget: number; given: number } {
  const { budget } = concessionBudget(state, conceder, other);
  const kept: Concession[] = [];
  const over: Concession[] = [];
  let given = 0;
  for (const c of conceded) {
    if (c.by !== conceder) {
      kept.push(c);
      continue;
    }
    const worth = concessionWorth(state, c);
    if (given + worth > budget) {
      over.push(c);
      continue;
    }
    given += worth;
    kept.push(c);
  }
  return { kept, over, budget, given };
}

/* ------------------------------------------------------------------ */
/* Ultimatums                                                          */
/* ------------------------------------------------------------------ */

/**
 * How hard a side of an ultimatum hits: every member's fighting weight across
 * the board, in battleship-equivalents — the unit the exchange compares.
 */
export function sideStrength(state: WorldState, ids: readonly string[]): number {
  const be = HULL_SPEC.battleship.orbitalWeight;
  let weight = 0;
  for (const system of state.systems) {
    for (const id of ids) weight += orbitalWeightAt(system, id);
  }
  return weight / be;
}
