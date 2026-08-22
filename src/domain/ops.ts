import { z } from 'zod';
import { StatNameSchema } from './checks.js';
import {
  AgentEffectSchema,
  AgentMissionSchema,
  TreatyTermsSchema,
  TreatyTypeSchema,
} from './diplomacy.js';
import { FibScaleSchema } from './duration.js';
import {
  OnInterruptSchema,
  OrderEffectSchema,
  OrderTypeSchema,
  TradeEthicSchema,
  WarEthicSchema,
} from './state.js';

/**
 * The op vocabulary. The model never rewrites state — it emits ops from this
 * list, they are Zod-validated, and a pure reducer applies them.
 *
 * `transfer_control` is deliberately NOT in the model-facing schema. Control
 * of a system changes only when a movement order actually arrives, so that a
 * model can never talk itself into owning a system on the far side of the map.
 */

export const TransferControlOp = z.object({
  op: z.literal('transfer_control'),
  systemId: z.string().min(1),
  toFactionId: z.string().nullable(),
  reason: z.string().default(''),
});

export const AdjustDispositionOp = z.object({
  op: z.literal('adjust_disposition'),
  factionId: z.string().min(1),
  towardFactionId: z.string().min(1),
  delta: z.number().int().min(-200).max(200),
  reason: z.string().default(''),
});

export const AdjustFleetOp = z.object({
  op: z.literal('adjust_fleet'),
  factionId: z.string().min(1),
  delta: z.number().int(),
  reason: z.string().default(''),
});

export const AdjustCreditsOp = z.object({
  op: z.literal('adjust_credits'),
  factionId: z.string().min(1),
  delta: z.number().int(),
  reason: z.string().default(''),
});

/** Internal standing with your own institutions. Reducer-driven, not narrative. */
export const AdjustDissentOp = z.object({
  op: z.literal('adjust_dissent'),
  factionId: z.string().min(1),
  delta: z.number().int().min(-100).max(100),
  reason: z.string().default(''),
});

/**
 * A change of standing posture — and, optionally, of the axes that give a
 * posture mechanical force.
 *
 * The text alone is narration. `warEthic` and `tradeEthic` are read by the
 * reducer and by `trade.ts`, and both are charged in dissent — see
 * `DOCTRINE_TEXT_DISSENT`.
 *
 * There is deliberately no way to retire a red line or a compulsion. A `retire`
 * field existed briefly and was the wrong shape: the model narrated a
 * retirement while emitting an empty array, so the paragraph on screen and the
 * enforced principle disagreed, and the fix for that was three more guards. A
 * principle is instead permanent, and acting against one is *priced* — see
 * `defiance` below. Nothing to desync, because nothing changes.
 */
export const SetDoctrineOp = z.object({
  op: z.literal('set_doctrine'),
  factionId: z.string().min(1),
  doctrine: z.string().min(1).max(240),
  /** New stance on force. Omit to leave it alone. */
  warEthic: WarEthicSchema.optional(),
  /** New stance on commerce. Omit to leave it alone. */
  tradeEthic: TradeEthicSchema.optional(),
});

export const IssueOrderOp = z.object({
  op: z.literal('issue_order'),
  factionId: z.string().min(1),
  /**
   * For estimated work this is the duration category as well as the order
   * type — one taxonomy, so category floors can never address a category the
   * order does not actually have.
   */
  type: OrderTypeSchema,
  originId: z.string().min(1),
  targetId: z.string().min(1),
  /**
   * Required for estimated work, ignored for `fleet_movement` (the reducer
   * computes that from the hyperlane graph and logs the discard).
   */
  durationTurns: FibScaleSchema.optional(),
  durationRationale: z.string().default(''),
  /**
   * Ships committed, for `fleet_movement` only. Omit to send everything at the
   * origin. Clamped to what is actually there.
   */
  force: z.number().int().min(1).optional(),
  interruptible: z.boolean().default(true),
  onInterrupt: OnInterruptSchema.default('cancel'),
  visibility: z.array(z.string()).default([]),
  label: z.string().default(''),
  /**
   * What the programme delivers when it lands — see `development.ts`.
   *
   * Omit it and the order is theatre: it will run its duration and change
   * nothing, which is correct for a courier run or a decree and wrong for a
   * shipyard. Paid for at issue time, capped per kind, and only legal on a
   * category that can plausibly deliver it.
   */
  onComplete: OrderEffectSchema.optional(),
});

export const CancelOrderOp = z.object({
  op: z.literal('cancel_order'),
  orderId: z.string().min(1),
  reason: z.string().default(''),
});

export const InterruptOrderOp = z.object({
  op: z.literal('interrupt_order'),
  orderId: z.string().min(1),
  reason: z.string().default(''),
});

export const ExtendOrderOp = z.object({
  op: z.literal('extend_order'),
  orderId: z.string().min(1),
  additionalTurns: z.number().int().min(1).max(21),
  reason: z.string().default(''),
});

export const AccelerateOrderOp = z.object({
  op: z.literal('accelerate_order'),
  orderId: z.string().min(1),
  reason: z.string().default(''),
});

export const FormTreatyOp = z.object({
  op: z.literal('form_treaty'),
  treatyType: TreatyTypeSchema,
  parties: z.array(z.string().min(1)).length(2),
  terms: TreatyTermsSchema,
  /** Turns from now until it lapses; omit for an indefinite treaty. */
  durationTurns: z.number().int().min(1).max(40).optional(),
  summary: z.string().default(''),
});

export const BreakTreatyOp = z.object({
  op: z.literal('break_treaty'),
  treatyId: z.string().min(1),
  reason: z.string().default(''),
});

export const DeployAgentOp = z.object({
  op: z.literal('deploy_agent'),
  ownerFactionId: z.string().min(1),
  systemId: z.string().min(1),
  mission: AgentMissionSchema,
  effect: AgentEffectSchema,
  cover: z.string().default(''),
});

export const RecallAgentOp = z.object({
  op: z.literal('recall_agent'),
  agentId: z.string().min(1),
  reason: z.string().default(''),
});

/** Move ships into or out of a system. Presence drives contested income. */
export const AdjustShipsOp = z.object({
  op: z.literal('adjust_ships'),
  systemId: z.string().min(1),
  factionId: z.string().min(1),
  delta: z.number().int(),
  reason: z.string().default(''),
});

/**
 * Record a durable arrangement the op vocabulary cannot otherwise express.
 *
 * Emitted only when the arbitration pass ruled the action admissible and said
 * it establishes something lasting. `exclusive` is the arbitrator's ruling;
 * the reducer is what enforces it.
 */
export const EstablishCommitmentOp = z.object({
  op: z.literal('establish_commitment'),
  kind: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  factionIds: z.array(z.string().min(1)).min(1).max(5),
  text: z.string().min(1).max(240),
  exclusive: z.boolean().default(false),
  /**
   * What it is worth per turn to each bound faction — positive for a charter or
   * a smuggling operation, negative for tribute paid. Trimmed by the reducer to
   * `MAX_COMMITMENT_INCOME`, and again in the ledger by a per-faction ceiling.
   * Omit it for an arrangement that is purely political.
   */
  incomePerTurn: z.number().int().min(-500).max(500).default(0),
});

/**
 * Money owed, on terms both powers accepted.
 *
 * Extraction-only, exactly like `form_treaty` and for the same reason: a debt
 * binds the debtor, and nobody becomes a debtor because the other party
 * declared it. Lending is a negotiation.
 */
export const EstablishDebtOp = z.object({
  op: z.literal('establish_debt'),
  creditorFactionId: z.string().min(1),
  debtorFactionId: z.string().min(1),
  /** Trimmed to `MAX_DEBT_PRINCIPAL`, not rejected. */
  principal: z.number().int().min(1).max(100000),
  /** Trimmed to `MAX_DEBT_PER_TURN`, and never more than the principal. */
  perTurn: z.number().int().min(1).max(10000),
  text: z.string().min(1).max(240),
});

/**
 * Writing a debt off.
 *
 * Unilateral and therefore an ordinary op, the same shape as `break_treaty`: a
 * creditor needs nobody's permission to stop collecting. It is also the exact
 * act the Ojjul Nar's first red line forbids, which is the point — the line now
 * has something to forbid.
 */
export const ForgiveDebtOp = z.object({
  op: z.literal('forgive_debt'),
  debtId: z.string().min(1),
  reason: z.string().default(''),
});

export const DissolveCommitmentOp = z.object({
  op: z.literal('dissolve_commitment'),
  commitmentId: z.string().min(1),
  reason: z.string().default(''),
});

export const SpawnEventOp = z.object({
  op: z.literal('spawn_event'),
  factionId: z.string().nullable().default(null),
  text: z.string().min(1),
});

export const LogNarrativeOp = z.object({
  op: z.literal('log_narrative'),
  text: z.string().min(1),
});

/** Everything the model is allowed to emit. */
export const ModelOpSchema = z.discriminatedUnion('op', [
  AdjustDispositionOp,
  AdjustFleetOp,
  AdjustCreditsOp,
  SetDoctrineOp,
  IssueOrderOp,
  CancelOrderOp,
  InterruptOrderOp,
  ExtendOrderOp,
  AccelerateOrderOp,
  // `form_treaty` is deliberately ABSENT — see `ExtractionOpSchema`. A treaty
  // binds another power, and a resolution call reached by a single player
  // declaration has nobody's consent but the player's.
  BreakTreatyOp,
  DeployAgentOp,
  RecallAgentOp,
  AdjustShipsOp,
  AdjustDissentOp,
  EstablishCommitmentOp,
  DissolveCommitmentOp,
  // `establish_debt` is deliberately ABSENT, like `form_treaty`: lending binds
  // the debtor, and consent lives in a transcript. Forgiving is unilateral.
  ForgiveDebtOp,
  SpawnEventOp,
  LogNarrativeOp,
]);
export type ModelOp = z.infer<typeof ModelOpSchema>;

/**
 * What the diplomacy extraction pass may emit: everything a model may emit,
 * plus `form_treaty`.
 *
 * The split exists because a treaty is the one op that binds a faction other
 * than the actor, and consent is a thing only a conversation can establish.
 * Extraction is the single pass in the game that has read one: it is handed a
 * transcript and asked what these two powers actually agreed to, so a treaty it
 * emits is backed by an NPC that said yes in its own voice.
 *
 * `break_treaty` stays in the ordinary vocabulary on purpose. Repudiating an
 * agreement is genuinely unilateral — you do not need the other party's
 * agreement to stop honouring it, only to pay for having stopped.
 */
export const ExtractionOpSchema = z.union([ModelOpSchema, FormTreatyOp, EstablishDebtOp]);

/** The full vocabulary, including ops only the reducer may originate. */
export const OpSchema = z.discriminatedUnion('op', [
  TransferControlOp,
  AdjustDispositionOp,
  AdjustFleetOp,
  AdjustCreditsOp,
  SetDoctrineOp,
  IssueOrderOp,
  CancelOrderOp,
  InterruptOrderOp,
  ExtendOrderOp,
  AccelerateOrderOp,
  FormTreatyOp,
  BreakTreatyOp,
  DeployAgentOp,
  RecallAgentOp,
  AdjustShipsOp,
  AdjustDissentOp,
  EstablishCommitmentOp,
  DissolveCommitmentOp,
  EstablishDebtOp,
  ForgiveDebtOp,
  SpawnEventOp,
  LogNarrativeOp,
]);
export type Op = z.infer<typeof OpSchema>;
/**
 * An op as *written* — before Zod fills in defaults.
 *
 * `Op` is the parsed shape, so every field carrying a `.default()` is required
 * on it. That is right for reading an op out of state and wrong for writing one
 * down, which is what a test fixture, a hand-built batch and the model itself
 * all do. The same input/output split the JSON schema already makes with
 * `z.toJSONSchema(..., { io: 'input' })`.
 */
export type OpInput = z.input<typeof OpSchema>;

export const REDUCER_ONLY_OPS = new Set(['transfer_control']);

/** Standard envelope for every model call that produces state change. */
export const ModelTurnOutputSchema = z.object({
  narrative: z.string().min(1),
  ops: z.array(ModelOpSchema),
});
export type ModelTurnOutput = z.infer<typeof ModelTurnOutputSchema>;

/** What `/endtalk` extraction returns: the ordinary vocabulary plus treaties. */
export const ExtractionOutputSchema = z.object({
  narrative: z.string().min(1),
  ops: z.array(ExtractionOpSchema),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

/**
 * The ability check an action resolves against.
 *
 * The model chooses WHICH stat is being tested and HOW HARD the thing is; it
 * does not choose whether it succeeds. The d20 is rolled in code from the turn
 * number before the call is made and handed to the model, so a favourable
 * outcome cannot be talked into existence — the same discipline as duration,
 * where code owns the number and the prompt owns the interpretation.
 */
export const ActionCheckSchema = z.object({
  stat: StatNameSchema,
  /** 5 trivial · 10 straightforward · 13 demanding · 16 hard · 19 formidable · 22 near-impossible */
  difficulty: z.number().int().min(5).max(25),
  rationale: z.string().default(''),
});
export type ActionCheck = z.infer<typeof ActionCheckSchema>;

/**
 * Your own institutions refusing the order.
 *
 * A faction is not a puppet. When a declared action crosses one of the
 * faction's red lines, or abandons something its compulsions demand, the people
 * who would have to carry it out say no — and nothing happens.
 */
export const RefusalSchema = z.object({
  /** Who refused: "the fleet commanders", "the Trade Council". */
  by: z.string().min(1),
  reason: z.string().min(1),
  /** The red line or compulsion breached, quoted from the faction sheet. */
  violated: z.string().default(''),
});
export type Refusal = z.infer<typeof RefusalSchema>;

/**
 * Your institutions objecting, and carrying the order out anyway.
 *
 * The third outcome, between "done" and "refused". A **red line** is absolute:
 * it produces a `refusal`, nothing is staged, and no price buys it. A
 * **compulsion** is a demand rather than a prohibition, and defying one is a
 * decision a leader is allowed to make — so the ops land and the faction is
 * charged `COMPULSION_BREACH_DISSENT`, which it can choose to pay again.
 *
 * This replaced retiring principles. A player who means to change what their
 * power is does not edit its character sheet; they act against it and absorb
 * what that costs, repeatedly, until either they stop or their institutions
 * have stopped following them.
 */
export const DefianceSchema = z.object({
  /** Who objected: "the Trade Council", "the old cousins". */
  by: z.string().min(1),
  reason: z.string().min(1),
  /** The compulsion defied, quoted from the faction sheet. */
  violated: z.string().default(''),
});
export type Defiance = z.infer<typeof DefianceSchema>;

/**
 * What the appraisal pass returns: how an action should be priced, decided
 * WITHOUT knowledge of the roll.
 *
 * This used to be part of the resolution output, which meant the model chose
 * the difficulty after being shown the d20. Picking the target after seeing
 * the roll is deciding the outcome, however firmly the prompt insists the roll
 * is fixed — so the appraisal is now its own call and the roll is not in it.
 */
export const AppraisalSchema = z.object({
  /**
   * False when the action cannot be attempted at all — it contradicts a
   * standing commitment, needs something that is not there, or is impossible
   * in the fiction. NOT for "out of character": that is a refusal, and it is
   * decided in resolution by the faction itself.
   */
  admissible: z.boolean().default(true),
  /** Why it was refused, or a one-clause note on the ruling. */
  reason: z.string().default(''),
  stat: StatNameSchema,
  difficulty: z.number().int().min(1).max(30),
  rationale: z.string().default(''),
  /**
   * The principle on the acting faction's own sheet that this action breaks,
   * if it breaks one.
   *
   * This ruling used to live in the resolution call, and a playtest showed why
   * that was the wrong home: three unambiguous compulsion breaches resolved as
   * ordinary skill checks costing nothing, and a red line was never once
   * returned as a refusal. Resolution is the pass with the least incentive to
   * classify honestly — it has been handed the outcome and asked to narrate a
   * success — and nothing structural checked it.
   *
   * The arbiter is the right home for the same reasons it prices the action:
   * it is a separate call, it is not shown the roll, and it already rules on
   * `establishes`. A `red_line` ruling ends the action here, before anything is
   * rolled; a `compulsion` ruling lets it through and the engine charges
   * `COMPULSION_BREACH_DISSENT` for it.
   */
  breach: z
    .object({
      /**
       * `red_line` blocks absolutely; `compulsion` is a price the leader may
       * pay. **The label is advisory** — `classifyPrinciple` derives the real
       * kind from the list the line is actually on, because a live playtest
       * had the arbiter call a compulsion "a red line, not a compulsion".
       */
      kind: z.enum(['red_line', 'compulsion']),
      /**
       * Every line this action touches, quoted from the sheet.
       *
       * A list rather than one string because an action can break more than
       * one principle and the arbiter quotes whichever came to mind first:
       * forgiving a debt was returned against the Combine's *"every favour
       * carries a price"* compulsion, never mentioning *"will not forgive an
       * unpaid debt"* — the red line that should have blocked it outright. The
       * engine takes the most severe of whatever is named.
       */
      principles: z.array(z.string().min(1).max(240)).min(1).max(3),
      /**
       * What the action does that the line forbids, in one clause.
       *
       * Required, and required for a reason: the arbiter quoted the Ojjul Nar's
       * *"will not fight its own war where a proxy could be hired to fight it
       * instead"* against an action **hiring a proxy** — the precise inversion,
       * since hiring is the line being honoured. Naming the direction out loud
       * is the cheapest available check on it. Code cannot settle this the way
       * it settles which list a line is on.
       */
      how: z.string().min(1).max(240),
      /** Who inside the faction objects: "the fleet commanders", "the Trade Council". */
      by: z.string().min(1).max(80),
      /** One or two sentences, in the institutions' own voice. */
      reason: z.string().min(1).max(400),
    })
    .optional(),
  /**
   * This action is a covert operation, and belongs to the agent mechanic.
   *
   * The same act had two routes with uncoordinated prices. A *deployed*
   * assassination costs 150 credits, counts against the cap, is spent after one
   * attempt, is caught about 45% of the time and costs the target 35 disposition
   * undetected or 40 exposed — all in code. A *declared* "assassinate their raid
   * captain" was priced as an ordinary `guile` check and the resolution call
   * then invented its consequences: measured live, −15 with the victim and −6
   * with an onlooker, for no credits, against no cap, with no exposure roll.
   * The cheaper route was the one a player reaches by typing a sentence.
   *
   * Naming the mission and the place here lets the engine route the declaration
   * into the mechanic, so there is one path, one price and one exposure profile.
   */
  covert: z
    .object({
      mission: AgentMissionSchema,
      /** Where the operative works — the system the action happens at. */
      systemId: z.string().min(1),
    })
    .optional(),
  /**
   * This is a negotiation, not a decree: it needs another power to agree.
   *
   * The fourth verdict, and the one that closes a hole rather than adding
   * polish. `form_treaty` was model-emittable from a resolution call and the
   * reducer checked only that the ids existed and differed, so "sign a mutual
   * defence pact with the Iron Vigil" was priced as an `influence` check —
   * measured live at DC 17 against a power at −45 disposition — and a good roll
   * bound the Vigil to a pact it was never asked about, pledged hulls and all.
   *
   * The diplomacy architecture already answers this: chat emits no ops, and a
   * separate extraction pass produces them from what was actually agreed. This
   * verdict routes the player there instead of rolling for another power's
   * consent. It costs nothing and stages nothing — being told "that is a
   * conversation" is not a failure, and must not be priced like one.
   */
  negotiation: z
    .object({
      /** Who has to agree. Usually one power; the channel is opened per faction. */
      withFactionIds: z.array(z.string().min(1)).min(1).max(4),
      /** What the player is trying to get, in their own terms, to open with. */
      what: z.string().min(1).max(240),
      /** Whether the acting faction is behind it, so the redirect is not a "no". */
      supported: z.boolean().default(true),
    })
    .optional(),
  /**
   * A durable arrangement this action would create IF it succeeds, for which
   * the op vocabulary has no other home. The arbitrator decides that a thing
   * is exclusive; the reducer enforces it.
   */
  establishes: z
    .object({
      kind: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
      factionIds: z.array(z.string().min(1)).min(1).max(5),
      text: z.string().min(1).max(240),
      exclusive: z.boolean().default(false),
    })
    .optional(),
});
export type Appraisal = z.infer<typeof AppraisalSchema>;

export const ResolutionOutputSchema = ModelTurnOutputSchema.extend({
  // No `check` field. The check is an INPUT to resolution now — computed in
  // code from a separate arbitration pass — so leaving it in the output schema
  // only invited the model to spend tokens (and thinking) filling a field
  // nothing reads, while the prompt told it the outcome was already settled.
  /** Present when the player's OWN faction will not carry the order out. */
  refusal: RefusalSchema.optional(),
  /**
   * Present when the order breaches a COMPULSION rather than a red line: the
   * institutions object, the ops still land, and the faction pays for it.
   */
  defiance: DefianceSchema.optional(),
  /**
   * Set by the engine, never by the model: the arbiter ruled the action could
   * not be attempted. Nothing was rolled and nothing is staged.
   */
  inadmissible: z.string().optional(),
  /**
   * Set by the engine, never by the model: the arbiter ruled this covert, and
   * the mission and place it named. Carried so the engine can route the
   * declaration into the agent mechanic rather than let it be priced twice.
   */
  covert: z.object({ mission: AgentMissionSchema, systemId: z.string() }).optional(),
  /**
   * Set by the engine, never by the model: this needs another power's consent,
   * so it belongs in a diplomatic channel rather than on the dice. Nothing was
   * rolled, nothing is staged, and nothing is charged — being told "that is a
   * conversation" is not a failure and must not be priced like one.
   */
  negotiation: z
    .object({
      withFactionIds: z.array(z.string()),
      what: z.string(),
      supported: z.boolean(),
      /** The literal commands to type, built in code so they are always right. */
      channels: z.string(),
    })
    .optional(),
});
export type ResolutionOutput = z.infer<typeof ResolutionOutputSchema>;

export const ReactionSchema = z.object({
  factionId: z.string().min(1),
  narrative: z.string().min(1),
  ops: z.array(ModelOpSchema),
});

export const ReactionSetSchema = z.object({
  reactions: z.array(ReactionSchema),
});
export type ReactionSet = z.infer<typeof ReactionSetSchema>;

/** Structured rejection. Never silently dropped; fed back to the model. */
export interface OpRejection {
  op: unknown;
  code:
    | 'unknown_op'
    | 'schema_invalid'
    | 'reducer_only'
    | 'unknown_faction'
    | 'unknown_system'
    | 'unknown_order'
    | 'unknown_commitment'
    | 'commitment_conflict'
    | 'no_presence'
    | 'unreachable_target'
    | 'missing_duration'
    | 'insufficient_credits'
    | 'not_interruptible'
    | 'illegal_value'
    | 'unknown_treaty'
    | 'unknown_agent'
    | 'unknown_debt'
    | 'doctrine_refusal'
    /** A treaty was declared rather than negotiated; the other party never agreed. */
    | 'needs_consent';
  message: string;
}

export function describeRejections(rejections: OpRejection[]): string {
  return rejections
    .map((r, i) => `${i + 1}. [${r.code}] ${r.message}\n   offending op: ${JSON.stringify(r.op)}`)
    .join('\n');
}
