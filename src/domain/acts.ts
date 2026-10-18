/**
 * The acts the reducer charges for, and what each one costs.
 *
 * The reducer decides that an act happened — a pact was broken, a loan was
 * kept, a favour refused. This module decides what that act costs in standing
 * and in heat, once, so two sites that produce the same act cannot charge
 * different prices for it (`docs/design-2026-10-17-acts.md`).
 *
 * The first family is the **breach of faith**: a power going back on its word.
 * It was priced at eight sites with five sets of numbers. A leaf: it reads
 * nothing but its own constants, and `reducer.ts` applies what it returns.
 */
import { PACT_BREAKING_REPUTATION_COST, TRUCE_BREAKING_REPUTATION_COST } from './diplomacy.js';
import { COMMITMENT_BREAKING_COST } from './arbitration.js';
import { LOAN_DEFAULT_DISPOSITION_COST } from './loan.js';
import { HEAT_PACT_BROKEN } from './heat.js';

/** What one injured party thinks of a power that broke its word to it. */
export const BROKEN_WORD_COST = 25;

/**
 * What every onlooker charges a power that **openly repudiates** a treaty —
 * half of `PACT_BREAKING_REPUTATION_COST`. Going back on your word in the open
 * is a smaller thing than attacking a partner while still bound, so it costs
 * less, and it is no longer free (journal version 24).
 */
export const REPUDIATION_REPUTATION_COST = Math.ceil(PACT_BREAKING_REPUTATION_COST / 2);

export const BREACH_KINDS = [
  /** Attacking a partner the attacker has sworn peace with. Breaks the pact on arrival. */
  'attack_under_pact',
  /** Attacking across a truce: the dearest public act in the game. */
  'attack_across_truce',
  /** Attacking in-laws whose marriage was the only peace between them. */
  'attack_on_inlaws',
  /** `break_treaty` on a treaty the breaker is party to. */
  'treaty_repudiated',
  /** `break_treaty` on a marriage the breaker is party to. */
  'marriage_repudiated',
  /** A treaty broken because an ultimatum the breaker conceded demanded it. */
  'treaty_conceded',
  /** A marriage ended by the court that holds its ward, questioning or executing them. */
  'match_betrayed',
  /** `repudiate_obligation`: a favour owed, refused. */
  'favour_repudiated',
  /** A loan not returned, kept or lost. */
  'loan_defaulted',
  /** `dissolve_commitment` by a party to a commitment binding two or more. */
  'commitment_walked',
] as const;
export type BreachKind = (typeof BREACH_KINDS)[number];

export interface BreachPrice {
  /** What each injured party's regard for the breaker falls. */
  injured: number;
  /** What every onlooker's regard for the breaker falls. */
  onlookers: number;
  /** Onlookers care only from this many parties up (a commitment: three). */
  onlookersFrom: number;
  /** Heat on the breaker. */
  heat: number;
  /** Heat only from this many parties up. */
  heatFrom: number;
  /**
   * Journal versions before 24 only. `break_treaty` lowered regard both ways —
   * the breaker went cold on its own victim — and a commitment's onlookers
   * included its other parties, who were charged twice.
   */
  mutual?: boolean;
  onlookersIncludeParties?: boolean;
}

const price = (p: Partial<BreachPrice> & { injured: number }): BreachPrice => ({
  onlookers: 0,
  onlookersFrom: 0,
  heat: 0,
  heatFrom: 0,
  ...p,
});

/** The prices from journal version 24. */
export const BREACH_PRICES: Record<BreachKind, BreachPrice> = {
  attack_under_pact: price({ injured: BROKEN_WORD_COST, onlookers: PACT_BREAKING_REPUTATION_COST, heat: HEAT_PACT_BROKEN }),
  attack_across_truce: price({ injured: BROKEN_WORD_COST, onlookers: TRUCE_BREAKING_REPUTATION_COST, heat: HEAT_PACT_BROKEN * 2 }),
  attack_on_inlaws: price({ injured: BROKEN_WORD_COST }),
  treaty_repudiated: price({ injured: BROKEN_WORD_COST, onlookers: REPUDIATION_REPUTATION_COST, heat: HEAT_PACT_BROKEN }),
  marriage_repudiated: price({ injured: BROKEN_WORD_COST, onlookers: REPUDIATION_REPUTATION_COST, heat: HEAT_PACT_BROKEN }),
  treaty_conceded: price({ injured: BROKEN_WORD_COST }),
  match_betrayed: price({ injured: BROKEN_WORD_COST }),
  favour_repudiated: price({ injured: BROKEN_WORD_COST, onlookers: PACT_BREAKING_REPUTATION_COST, heat: HEAT_PACT_BROKEN }),
  loan_defaulted: price({ injured: LOAN_DEFAULT_DISPOSITION_COST, onlookers: PACT_BREAKING_REPUTATION_COST, heat: HEAT_PACT_BROKEN }),
  commitment_walked: price({
    injured: COMMITMENT_BREAKING_COST,
    onlookers: PACT_BREAKING_REPUTATION_COST,
    onlookersFrom: 3,
    heat: HEAT_PACT_BROKEN,
    heatFrom: 2,
  }),
};

/**
 * The prices every journal before version 24 was played under, written down
 * exactly — accidents included — so an old campaign replays as it was played.
 */
export const LEGACY_BREACH_PRICES: Record<BreachKind, BreachPrice> = {
  ...BREACH_PRICES,
  treaty_repudiated: price({ injured: BROKEN_WORD_COST, mutual: true, heat: HEAT_PACT_BROKEN }),
  marriage_repudiated: price({ injured: BROKEN_WORD_COST, heat: HEAT_PACT_BROKEN }),
  commitment_walked: price({
    injured: COMMITMENT_BREAKING_COST,
    onlookers: PACT_BREAKING_REPUTATION_COST,
    onlookersFrom: 3,
    onlookersIncludeParties: true,
    heat: HEAT_PACT_BROKEN,
    heatFrom: 3,
  }),
};

export interface Breach {
  kind: BreachKind;
  /** The power going back on its word. Null for a treaty broken with no actor — the engine, or an old journal. */
  breaker: string | null;
  /** Everyone bound by what was broken, the breaker included. */
  parties: readonly string[];
  /**
   * Whether the injured side charges the injured price. False only where a
   * legacy rule left it out (`arrangementStanding` for a commitment).
   */
  chargeInjured?: boolean;
}

/** One regard movement: `who`'s view of `toward` moves by `delta`. */
export interface RegardMove {
  who: string;
  toward: string;
  delta: number;
}

export interface BreachCharge {
  regard: RegardMove[];
  heat: number;
}

/**
 * What a breach costs, as movements and heat, for the reducer to apply. The
 * rules that every site used to restate are here once: the injured are the
 * other parties, onlookers are everyone else, nobody is charged twice, and
 * nobody resents itself.
 */
export function breachCharges(
  breach: Breach,
  everyone: readonly string[],
  prices: Record<BreachKind, BreachPrice> = BREACH_PRICES,
): BreachCharge {
  const p = prices[breach.kind];
  const regard: RegardMove[] = [];
  const parties = [...breach.parties];
  const { breaker } = breach;

  if (breaker === null) {
    // No one to blame: each party's view of each other falls, as the engine's
    // break always charged. No onlookers and no heat, having no culprit.
    if (breach.chargeInjured !== false) {
      for (const who of parties) {
        for (const toward of parties) if (who !== toward) regard.push({ who, toward, delta: -p.injured });
      }
    }
    return { regard, heat: 0 };
  }

  const injured = parties.filter((f) => f !== breaker);
  if (breach.chargeInjured !== false) {
    for (const who of injured) {
      regard.push({ who, toward: breaker, delta: -p.injured });
      if (p.mutual) regard.push({ who: breaker, toward: who, delta: -p.injured });
    }
  }
  if (p.onlookers > 0 && parties.length >= p.onlookersFrom) {
    for (const who of everyone) {
      if (who === breaker) continue;
      if (!p.onlookersIncludeParties && parties.includes(who)) continue;
      regard.push({ who, toward: breaker, delta: -p.onlookers });
    }
  }
  const heat = p.heat > 0 && parties.length >= p.heatFrom ? p.heat : 0;
  return { regard, heat };
}

/* ------------------------------------------------------------------ */
/* Regard written by a model, priced here (intent-ops §3)               */
/* ------------------------------------------------------------------ */

/**
 * What an influence check that worked moves the other power's view of the actor
 * by: the payoff of charm, propaganda and a state visit. Sized off what models
 * wrote for it in the saved campaigns (median 5, quartiles 4 and 10). A failure
 * moves nothing; offence is the offended power's to record, in its reaction.
 */
export const SWAY_BY_BAND = {
  partial: 3,
  success: 6,
  critical_success: 10,
} as const;

/**
 * Why a reacting power's view of another moves, and by how much. The model
 * judges that it happened; the table says what it is worth — the division
 * `classifyPrinciple` already makes. Sized off the reactions in the saved
 * campaigns (coolings median 6, quartiles 4 and 10; warmings median 5,
 * quartiles 3 and 6). No reason names an act the reducer already prices — an
 * attack, a broken treaty, suborning, piracy — so nothing is charged twice.
 */
export const REGARD_BECAUSE = {
  slight: -4,
  insult: -8,
  threat: -10,
  /** A promise made in conversation and recorded nowhere — a broken treaty, loan or favour is priced already. */
  promise_broken: -12,
  deference: 3,
  promise_kept: 5,
  aid: 6,
} as const;
export type RegardReason = keyof typeof REGARD_BECAUSE;
export const REGARD_REASONS = Object.keys(REGARD_BECAUSE) as RegardReason[];

/** Credits a point of regard costs when it is bought, and the most one gift buys. */
export const GIFT_RATE = 20;
export const GIFT_MAX_REGARD = 10;

/** What a gift of `credits` buys in the receiver's regard for the giver. */
export function giftRegard(credits: number): number {
  return Math.min(GIFT_MAX_REGARD, Math.floor(Math.max(0, credits) / GIFT_RATE));
}
