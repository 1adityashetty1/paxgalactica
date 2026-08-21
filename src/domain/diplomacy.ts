import { z } from 'zod';
import { StatNameSchema } from './checks.js';

/**
 * Treaties and covert agents: the two standing structures that outlive the turn
 * they were created in.
 *
 * Both live in world state rather than in prompt memory, because both have
 * mechanical consequences the reducer must apply every turn — income shares,
 * defence triggers, sabotage. A treaty a model merely "remembers" is a treaty
 * that quietly stops existing.
 */

export const TREATY_TYPES = [
  'non_aggression',
  'mutual_defense',
  'trade_accord',
  'tribute',
  'basing_rights',
  'ceasefire',
] as const;
export const TreatyTypeSchema = z.enum(TREATY_TYPES);
export type TreatyType = z.infer<typeof TreatyTypeSchema>;

export const TREATY_TYPE_MEANING: Record<TreatyType, string> = {
  non_aggression: 'neither party attacks the other; breaking it is a betrayal everyone sees',
  mutual_defense: 'an attack on one obliges the other to answer',
  trade_accord: 'lanes stay open and income is shared on named systems',
  tribute: 'one party pays the other every turn, in exchange for being left alone',
  basing_rights: 'fleets of one party may transit and resupply in the other’s systems',
  ceasefire: 'hostilities stop for a fixed number of turns and then lapse',
};

/** A share of one system's income, granted by treaty. */
export const IncomeShareSchema = z.object({
  systemId: z.string().min(1),
  factionId: z.string().min(1),
  /** 0–1. Shares across a system are normalised if they exceed 1. */
  share: z.number().min(0).max(1),
});
export type IncomeShare = z.infer<typeof IncomeShareSchema>;

export const TreatyTermsSchema = z.object({
  /** Systems whose ownership or access the treaty settles. */
  territory: z.array(z.string()).default([]),
  /** Fleet strength each party has pledged to the arrangement. */
  shipsPledged: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Flat credits moved every turn: positive receives, negative pays. */
  incomePerTurn: z.record(z.string(), z.number().int()).default({}),
  /** Claims on system income — the mechanism for neutral and shared worlds. */
  incomeShares: z.array(IncomeShareSchema).default([]),
  /** What obliges the signatories to act. Empty for treaties with no trigger. */
  mutualDefenseTrigger: z.string().default(''),
});
export type TreatyTerms = z.infer<typeof TreatyTermsSchema>;

/** A live treaty of one of the given types binding both factions. */
export function treatyBetween(
  treaties: Treaty[],
  turn: number,
  a: string,
  b: string,
  types: readonly TreatyType[],
): Treaty | undefined {
  return treaties.find(
    (t) =>
      isTreatyLive(t, turn) &&
      types.includes(t.type) &&
      t.parties.includes(a) &&
      t.parties.includes(b),
  );
}

/**
 * Treaties that forbid an attack. Breaking one of these is the betrayal the
 * whole galaxy hears about — see `PACT_BREAKING_REPUTATION_COST`.
 */
export const PEACE_TREATIES = ['non_aggression', 'ceasefire', 'mutual_defense'] as const;

/**
 * What every OTHER power's opinion of you drops by when you attack a partner.
 *
 * Distinct from the −25 the injured party feels: that is a grievance, this is
 * a reputation. Without it, breaking a pact was a private matter between two
 * factions and treachery had no strategic price at all.
 */
export const PACT_BREAKING_REPUTATION_COST = 10;

export const TreatySchema = z.object({
  id: z.string().min(1),
  type: TreatyTypeSchema,
  /** Exactly two parties. Multilateral pacts are modelled as several treaties. */
  parties: z.array(z.string().min(1)).length(2),
  terms: TreatyTermsSchema,
  signedTurn: z.number().int().min(0),
  /** null means indefinite; otherwise it lapses at the start of this turn. */
  expiresTurn: z.number().int().min(0).nullable().default(null),
  /**
   * `superseded` is what a renegotiation leaves behind: distinct from `expired`
   * (ran its term) and `broken` (repudiated, and priced accordingly), because
   * neither of those is what happened when the same parties simply rewrote the
   * same grant. Added after a playtest ratcheted one charter from 5% to 8% and
   * left both live.
   */
  status: z.enum(['active', 'expired', 'broken', 'superseded', 'pending']).default('active'),
  /**
   * The turn this treaty starts having effect. `null` means immediately.
   *
   * A `pending` treaty is one whose parties agreed but whose terms are not yet
   * live — a deal a council still has to ratify. It exists because extraction
   * is told, correctly, that a conditional promise produces nothing yet, so a
   * deal an NPC gated on ratification used to produce a `treaty_ratification`
   * order and no treaty at all. That order carries no payload by design, so the
   * order completed, logged, and changed nothing: a fully negotiated marriage,
   * supply line and transit compact evaporated on completion.
   *
   * Making it one object rather than an order plus a promise means there is no
   * second source of truth to desync, and the deal is visible in the treaties
   * panel while it waits instead of hiding inside an order.
   *
   * `isTreatyLive` gates on `status === 'active'`, so a pending treaty is inert
   * everywhere for free — no reader had to change.
   */
  effectiveTurn: z.number().int().min(0).nullable().default(null),
  /** One line the UI can show verbatim. */
  summary: z.string().default(''),
});
export type Treaty = z.infer<typeof TreatySchema>;

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export const AGENT_MISSIONS = [
  'sabotage',
  'surveillance',
  'subversion',
  'theft',
  'defection',
  'assassination',
] as const;
export const AgentMissionSchema = z.enum(AGENT_MISSIONS);
export type AgentMission = z.infer<typeof AgentMissionSchema>;

export const AGENT_MISSION_MEANING: Record<AgentMission, string> = {
  surveillance:
    'reveals the target\'s hidden orders on this system; no damage, and the quietest mission there is',
  theft: 'siphons credits from the system it sits on, every turn it succeeds',
  subversion: 'erodes a named stat while in place — the target governs, fights or builds worse',
  sabotage: 'destroys fleet strength every turn it succeeds; loud, and easier to trace',
  defection:
    'talks crews out of the target\'s service and into yours, one or two hulls at a time. How many is your guile against their resolve, not your choice — and a power resolute enough simply cannot be turned',
  assassination:
    'ONE attempt at a decapitating strike, then the operative is gone either way. Success is a heavy one-off blow and a collapse in relations; failure almost always ends with the agent caught',
};

/**
 * What the mission itself costs in risk and persistence.
 *
 * Without this, `mission` is a label: an agent doing 3 hull damage a turn
 * behaves identically whether it is called surveillance or assassination.
 * These are the two axes on which the missions genuinely differ.
 */
/**
 * What it costs to put an operative in place, by mission.
 *
 * Priced against the same economy as hulls (`SHIP_COST` 60, net incomes
 * 72-283 a turn): a watcher is cheaper than a corvette, a decapitation strike
 * costs more than two. Agents were previously free in every sense — no
 * deployment cost, no upkeep, no cap — which made an unbounded covert network
 * strictly dominant once a player noticed.
 *
 * Scales with what the mission actually requires rather than with its effect:
 * `assassination` is dear because arranging one is dear, and it is spent after
 * a single attempt either way.
 */
export const AGENT_COST: Record<AgentMission, number> = {
  surveillance: 40,
  theft: 60,
  subversion: 60,
  defection: 80,
  sabotage: 80,
  assassination: 150,
};

export interface MissionProfile {
  /** A failed roll at or below this exposes the operative. */
  exposureRisk: number;
  /** One attempt, then the agent is spent regardless of outcome. */
  oneShot: boolean;
  /** Multiplies the declared effect. A single strike hits far harder. */
  effectMultiplier: number;
}

export const MISSION_PROFILE: Record<AgentMission, MissionProfile> = {
  surveillance: { exposureRisk: 1, oneShot: false, effectMultiplier: 1 },
  theft: { exposureRisk: 2, oneShot: false, effectMultiplier: 1 },
  subversion: { exposureRisk: 2, oneShot: false, effectMultiplier: 1 },
  sabotage: { exposureRisk: 3, oneShot: false, effectMultiplier: 1 },
  // Riskier than theft — you are talking to people who may report you — but
  // it persists, because a defection network is a standing arrangement.
  defection: { exposureRisk: 4, oneShot: false, effectMultiplier: 1 },
  // A near-coin-flip on being caught, in exchange for one heavy blow.
  assassination: { exposureRisk: 9, oneShot: true, effectMultiplier: 4 },
};

/**
 * What an agent does to its target each turn.
 *
 * Effects are explicit numbers rather than narrative, so the player can see the
 * trade being made and the reducer can apply it deterministically.
 */
export const AgentEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hull_damage'),
    /** Fleet strength destroyed per turn on success. */
    perTurn: z.number().int().min(0).max(20),
  }),
  z.object({
    kind: z.literal('income_penalty'),
    /** Credits denied to the target per turn on success. */
    perTurn: z.number().int().min(0).max(400),
  }),
  z.object({
    kind: z.literal('stat_debuff'),
    stat: StatNameSchema,
    /** Points subtracted while the agent is in place. */
    magnitude: z.number().int().min(1).max(4),
  }),
  z.object({
    kind: z.literal('intel'),
    /** Reveals the target's hidden orders while in place. */
    revealsOrders: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('crew_defection'),
    /**
     * Hulls the operative TRIES for each turn. What it actually gets is
     * `subornLimit` — the owner's guile against the target's resolve — so this
     * is a ceiling on ambition, not a promise. A model cannot ask for a
     * squadron and receive one.
     */
    perTurn: z.number().int().min(1).max(4),
  }),
]);
export type AgentEffect = z.infer<typeof AgentEffectSchema>;

/**
 * What a mission does when nobody said.
 *
 * Used when a declared covert action is routed into the agent mechanic and the
 * resolution call did not supply an effect. Deliberately modest: the point of
 * routing is that the act is priced, capped and exposed like every other
 * operation, not that it hits hard. A model that wants more says so.
 */
export const DEFAULT_COVERT_EFFECT: Record<AgentMission, AgentEffect> = {
  surveillance: { kind: 'intel', revealsOrders: true },
  theft: { kind: 'income_penalty', perTurn: 10 },
  subversion: { kind: 'stat_debuff', stat: 'industry', magnitude: 1 },
  sabotage: { kind: 'hull_damage', perTurn: 2 },
  defection: { kind: 'crew_defection', perTurn: 1 },
  // One attempt, quadrupled by the mission profile, then the operative is gone.
  assassination: { kind: 'stat_debuff', stat: 'resolve', magnitude: 1 },
};

export const AgentSchema = z.object({
  id: z.string().min(1),
  ownerFactionId: z.string().min(1),
  /** Where the agent physically is. Drives which faction it harms. */
  systemId: z.string().min(1),
  mission: AgentMissionSchema,
  effect: AgentEffectSchema,
  /**
   * Per-turn chance the agent achieves its effect, 0–100. Computed in code
   * from the owner's guile against the target's counter-intelligence, never
   * chosen by a model.
   */
  successChance: z.number().int().min(0).max(100),
  deployedTurn: z.number().int().min(0),
  /** Exposed agents are visible to the target and stop producing effects. */
  exposed: z.boolean().default(false),
  cover: z.string().default(''),
});
export type Agent = z.infer<typeof AgentSchema>;

export function describeEffect(effect: AgentEffect): string {
  switch (effect.kind) {
    case 'hull_damage':
      return `−${effect.perTurn} fleet strength per turn`;
    case 'income_penalty':
      return `−${effect.perTurn} credits per turn`;
    case 'stat_debuff':
      return `−${effect.magnitude} ${effect.stat}`;
    case 'crew_defection':
      return `talks up to ${effect.perTurn} hull(s) a turn out of the target's service, as far as guile beats resolve`;
    case 'intel':
      return 'reveals hidden orders';
  }
}

export function isTreatyLive(treaty: Treaty, turn: number): boolean {
  if (treaty.status !== 'active') return false;
  return treaty.expiresTurn === null || turn < treaty.expiresTurn;
}
