import { z } from 'zod';
import { StatNameSchema } from './checks.js';
import {
  AgentEffectSchema,
  AgentMissionSchema,
  AssetYieldSchema,
  TreatyTermsSchema,
  TreatyTypeSchema,
  VoidConditionSchema,
} from './diplomacy.js';
import { FibScaleSchema } from './duration.js';
import { LentSchema } from './loan.js';
import { HullClassSchema, TypedStackSchema } from './hulls.js';
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
  /** Which class the yards lay down. Ignored when `delta` is a loss. */
  hull: HullClassSchema.default('battleship'),
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

/**
 * What your fleets do when they are losing a defence.
 *
 * Free — no credits, no dissent, no roll. It is a standing order to your own
 * navy, not a change of character: `set_doctrine` charges dissent because
 * rewriting what a power BELIEVES is a real upheaval, and deciding whether this
 * particular war is worth the fleet is the ordinary work of commanding one.
 */
export const SetStanceOp = z.object({
  op: z.literal('set_stance'),
  factionId: z.string().min(1),
  /**
   * `hold` never breaks off — the world at any price.
   * `stand` breaks off at two to one, which is how every campaign has played.
   * `withdraw` leaves the moment it is outmatched, keeping the fleet.
   */
  stance: z.enum(['hold', 'stand', 'withdraw']),
});

/**
 * Decide who pays to cross your space.
 *
 * A standing policy about your own borders, so it is free and takes no roll —
 * the same reasoning as `set_stance`: this is an instruction to your own
 * customs service, not a change in what your power believes. Your own faction
 * only.
 *
 * `targets` REPLACES the list rather than adding to it, which is what lets an
 * accord say "and the Sennex lane opens to Meridian" as one op instead of a
 * diff the model has to compute correctly.
 */
export const SetTollPolicyOp = z.object({
  op: z.literal('set_toll_policy'),
  factionId: z.string().min(1),
  /** Everyone charged for passage. Empty means the lanes are open to all. */
  targets: z.array(z.string().min(1)).max(8),
  reason: z.string().default(''),
});

/**
 * Bring a thing into the world — prisoners taken, ore surveyed, a seal struck.
 *
 * **Only ever the payoff of an attempt that worked.** A player never declares
 * that they have something; they declare an attempt to get it, spend an action
 * point, roll, and the asset exists because the roll succeeded.
 * `boundPayloadsToOutcome` strips this on a failed check and halves the
 * quantity on a partial, exactly as it treats an `onComplete` payload — an
 * asset minted by a resolution is that same payoff in a different shape.
 *
 * Refused from an **accord**: a conversation can trade what exists and cannot
 * conjure what does not. And refused when the actor is not the holder — you
 * cannot survey ore into somebody else's warehouse.
 */
/**
 * Write down what the arbiter ruled, and what became of the ruling.
 *
 * **Engine-only** — absent from `ModelOpSchema` — because it is the engine's
 * account of a model's judgement, and a model writing its own report card is
 * the confirmation bias this whole layer is shaped to avoid.
 *
 * Recorded on every ruling that named a line, INCLUDING the ones that charged
 * nothing. Those are the valuable rows: a breach dropped by
 * `verifyBreachRelevance`, or dropped because the quoted line matched nothing
 * on the sheet, is invisible today, so "the same act was ruled three ways" can
 * only ever be an anecdote. Four relevance failures in nine turns is a
 * measurement; noticing four is a story.
 */
export const LogRulingOp = z.object({
  op: z.literal('log_ruling'),
  /** The act, as the player phrased it. Truncated — this is an index, not a transcript. */
  action: z.string().min(1).max(200),
  /** Whether it came from a declared order or from closing a channel. */
  via: z.enum(['declared', 'accord']),
  /** What the arbiter quoted, verbatim, before anything checked it. */
  named: z.array(z.string()).max(3).default([]),
  /** The line as the SHEET states it, once `classifyPrinciple` matched it. */
  matched: z.string().nullable().default(null),
  /** What list it turned out to be on. `null` when the quote matched nothing. */
  kind: z.enum(['red_line', 'compulsion']).nullable().default(null),
  /**
   * `verifyBreachRelevance`'s verdict, or `null` when it did not run — which is
   * itself worth recording, since a state-contradicting compulsion is dropped
   * before the paid call.
   */
  relevant: z.boolean().nullable().default(null),
  /** What actually happened, which is the column a drift report groups by. */
  outcome: z.enum(['refused', 'charged', 'dropped_irrelevant', 'dropped_unmatched', 'dropped_contradicted']),
});

export const CreateAssetOp = z.object({
  op: z.literal('create_asset'),
  kind: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  text: z.string().min(1).max(240),
  heldBy: z.string().min(1),
  quantity: z.number().int().min(1).max(100000),
  unit: z.string().min(1).max(24),
  divisible: z.boolean().default(true),
  /** factionId -> credits one unit is worth to them. A claim, never money. */
  valuePerUnit: z.record(z.string(), z.number().int().min(0).max(10000)).default({}),
  /** `true` when nobody has settled what it is worth. Use `valueRange` then. */
  speculative: z.boolean().default(false),
  /** factionId -> the band one unit might be worth. Read only when speculative. */
  valueRange: z
    .record(
      z.string(),
      z.object({
        min: z.number().int().min(0).max(10000),
        max: z.number().int().min(0).max(10000),
      }),
    )
    .default({}),
  /** Plays before it is spent, for an instrument. `null` for ordinary stuff. */
  uses: z.number().int().min(1).max(1000).nullable().default(null),
  /** Where it is, if anywhere. An asset at a world changes hands with it. */
  atSystemId: z.string().nullable().default(null),
  /**
   * `false` for a thing that IS the world — a mine, an exchange, a theatre.
   * It changes hands only when the ground does, and needs `atSystemId`.
   */
  portable: z.boolean().default(true),
  /** What it does every turn, if anything. Needs `atSystemId`. */
  yield: AssetYieldSchema.nullable().default(null),
});

/**
 * Hand a thing to somebody else.
 *
 * Giving your own away needs nobody's permission. **Taking** another power's
 * needs theirs, so it is refused from a declared action and reachable from an
 * accord — the same rule `terms.territory` follows, and for the same reason: a
 * transcript is the one place the other party's consent exists.
 */
export const TransferAssetOp = z.object({
  op: z.literal('transfer_asset'),
  assetId: z.string().min(1),
  toFactionId: z.string().min(1),
  reason: z.string().default(''),
});

/**
 * Spending a thing, or destroying it.
 *
 * **Nothing in the game could remove an asset.** `state.assets` was only ever
 * appended to and re-pointed — traded, ceded, conquered, forfeited on a
 * contingency — so prisoners could not be released, ore could not be consumed,
 * and an instrument could not be played. A playtest wrote a claimant's seal into
 * escrow and exercised it in prose, and the seal was still there the next turn,
 * exercisable again forever.
 *
 * Which counter it draws down depends on what the thing is. An **instrument**
 * (`uses !== null`) is played: a writ once, a set of cipher keys three times.
 * Everything else is **stuff** and is spent by `quantity`. Both reach zero the
 * same way and the row is removed when they do, which is also what finally lets
 * `voidsOn: asset_lost` fire because something ceased to exist rather than only
 * because it changed hands.
 *
 * An ordinary op: spending what is yours needs nobody's permission, and the
 * reducer removes the real thing, so it cannot be used to wish an obligation
 * away — a borrowed holding is refused outright.
 *
 * **Not bound by `boundPayloadsToOutcome`.** Consuming is a COST, and the rule
 * that pass enforces is that a failure emits what the attempt cost and not what
 * the player wanted. Powder burned on a failed demolition is still burned.
 */
export const ConsumeAssetOp = z.object({
  op: z.literal('consume_asset'),
  assetId: z.string().min(1),
  /** Units, or plays of an instrument. Trimmed to what is left. */
  quantity: z.number().int().min(1).max(100000).default(1),
  /** What it was spent on, in a phrase. */
  reason: z.string().max(240).default(''),
});

/**
 * Break a divisible holding into two.
 *
 * Forty crews ransomed twenty at a time. Value is stated per unit, so the split
 * conserves by construction rather than by a model dividing correctly — and an
 * atomic asset refuses, because half a family heirloom is not a thing.
 */
export const SplitAssetOp = z.object({
  op: z.literal('split_asset'),
  assetId: z.string().min(1),
  /** How much comes off into the new lot. Must leave at least one behind. */
  quantity: z.number().int().min(1),
  reason: z.string().default(''),
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
   *
   * Either a plain count — drawn proportionally across the classes berthed
   * there, so the squadron that sails is the squadron that was standing — or a
   * named composition, `{ "battleship": 8, "lifter": 4 }`, which is the only
   * way to say "guns but no transports" or the reverse. **A world is taken by
   * the lift arm**, so a fleet ordered out with no lifters can win the
   * orbitals and take nothing.
   */
  force: z.union([z.number().int().min(1), TypedStackSchema]).optional(),
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
  /**
   * Turns until the terms start applying. Omit when the deal is live on
   * signature, which is the ordinary case.
   *
   * Set it when the other party agreed *subject to ratification* — a council
   * that must consent, a senate that must read it. The treaty is recorded now,
   * `pending`, and does nothing until then. Previously this could only be
   * expressed as a `treaty_ratification` order, which carries no payload and so
   * completed without producing the treaty at all.
   */
  ratifyTurns: z.number().int().min(1).max(10).optional(),
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
  /**
   * Which class. Laying down escorts, torpedo boats or lift is how a fleet
   * becomes composed rather than merely large — and **a world can only be
   * taken by lifters**, so a power that builds nothing but battleships can
   * win every battle and annex nothing.
   *
   * Defaults to `battleship`, which is what every op written before classes
   * existed meant.
   */
  hull: HullClassSchema.default('battleship'),
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
  /**
   * A PROPORTION of one party's own take, for the deals that are naturally
   * written that way — *"a tenth of every prize"*, *"a share of what the
   * Sennex lane pays you"*. `incomePerTurn` is a fixed integer, so those had no
   * honest number and were recorded as worth nothing.
   *
   * `of` names which flow is divided: `raided` (prizes taken off other powers'
   * lanes), `tolls` (transit charged in your own space), or `routes` (the whole
   * of what the lane network pays you). `from` and `to` must both be bound by
   * the commitment. Floored to whole credits when applied.
   */
  share: z
    .object({
      of: z.enum(['raided', 'tolls', 'routes']),
      percent: z.number().int().min(1).max(100),
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
  /**
   * What this pays out, and on what — *"if Pell Reach falls, nine hundred"*.
   *
   * The shape of insurance, indemnity, bounty, ransom, escrow, surety, war
   * subsidy and any performance clause. `trigger` uses the same closed
   * vocabulary a treaty's `voidsOn` uses. It fires **once**; a thing that paid
   * every turn its condition held would be `incomePerTurn`.
   */
  contingencies: z
    .array(
      z.object({
        trigger: VoidConditionSchema,
        from: z.string().min(1),
        to: z.string().min(1),
        credits: z.number().int().min(0).max(100000).default(0),
        /** An asset changing hands rather than, or as well as, money. */
        assetId: z.string().nullable().default(null),
        text: z.string().min(1).max(240),
      }),
    )
    .max(4)
    .default([]),
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

/**
 * Moving an existing debt to a new creditor.
 *
 * Buying another power's paper is a thing powers in this galaxy do constantly,
 * and extraction had `establish_debt` and `forgive_debt` and nothing between —
 * so agreeing to *assign* a debt could only be written as a fresh one, which
 * minted a second copy and retired nothing. Measured live: two purchases of the
 * same Drajk paper left three debts standing and Drajk owing 1400 against an
 * original 600, an obligation manufactured by the act of trading it.
 *
 * Extraction-only for the same reason `establish_debt` is: the outgoing
 * creditor has to agree to sell, and a transcript is the only place that
 * agreement exists.
 */
export const AssignDebtOp = z.object({
  op: z.literal('assign_debt'),
  debtId: z.string().min(1),
  /** Who holds the paper afterwards. */
  toCreditorFactionId: z.string().min(1),
  reason: z.string().default(''),
});

/**
 * Paying a debt down, in part or in full.
 *
 * The other half of the same gap: a debtor who settles early had no op for it,
 * so 430 credits paid to clear a 400 balance produced a narrative saying "that
 * column shut" and a debt still live at 350 the next turn.
 *
 * An ordinary op rather than extraction-only, because prepaying what you owe
 * needs nobody's permission — and it is safe to leave open precisely because
 * the reducer moves the money: the debtor pays exactly what comes off the
 * balance, capped at what it actually holds, so this cannot be used to wish a
 * debt away.
 */
/**
 * Reschedule a debt without retiring it.
 *
 * Powers renegotiate terms constantly and there was no verb for it, so an
 * agreed restructure had to be written as `forgive_debt` + `establish_debt` —
 * the only retirement primitive there is. That chain pays out three things it
 * should not, all measured on a real campaign:
 *
 * - **principal minted.** A balance of 400 was retired and reissued at 480, and
 *   a balance of 460 at 480. The new figure is whatever the model writes down.
 * - **`DEBT_FORGIVENESS_GOODWILL` paid for a forgiveness that forgave nothing.**
 *   Twice, so +40 disposition on a debt that got *larger*; Drajk went from a
 *   seeded 30 to 96 toward the Combine, and those two payouts were 60% of the
 *   swing.
 * - **a delinquency laundered clean**, ending the per-turn
 *   `DEBT_DEFAULT_DISPOSITION_COST` bleed that models a creditor's patience
 *   running out.
 *
 * This is the same shape as `assign_debt`, which exists because a debt could
 * previously be *transferred* only by minting a second copy. One module, one
 * lesson twice: a missing verb forces the model through a primitive that does
 * more than was meant.
 *
 * The balance is untouchable here on purpose — a restructure changes the terms
 * of what is owed, not the amount. Writing part of it off is `forgive_debt`,
 * and paying part of it down is `settle_debt`; both already move real money.
 */
export const RestructureDebtOp = z.object({
  op: z.literal('restructure_debt'),
  debtId: z.string().min(1),
  /** The new instalment, trimmed to `MAX_DEBT_PER_TURN` in code. The balance does not move. */
  perTurn: z.number().int().min(0).max(10000),
  /** Optional new wording for the paper. */
  text: z.string().max(400).optional(),
  /**
   * Whether rescheduling clears the arrears.
   *
   * Defaults to true, which is what a creditor is doing when it agrees to new
   * terms: it has chosen to reschedule rather than write off, and a debtor
   * still marked `delinquent` on the terms it just renegotiated would keep
   * bleeding disposition for a default that no longer exists.
   */
  clearsArrears: z.boolean().default(true),
  reason: z.string().max(240).default(''),
});

export const SettleDebtOp = z.object({
  op: z.literal('settle_debt'),
  debtId: z.string().min(1),
  /** Trimmed to the balance, and to what the debtor can actually find. */
  amount: z.number().int().min(1).max(100000),
  reason: z.string().default(''),
});

/**
 * Lending a thing out under terms.
 *
 * Extraction-only, for the reason `establish_debt` and `form_treaty` are: it
 * binds the **borrower** — to feed the squadron, to pay the rent, to give it
 * back — and a transcript is the only place that power's agreement exists. The
 * lender giving something away would need nobody; the arrangement is not the
 * gift.
 *
 * A world is not on the list of things that can be lent. The instrument for a
 * world changing hands is a `cession` and the instrument for somebody else's
 * fleet standing on one is `basing_rights`, so a lease would be a third answer
 * to a question that already has two. Nor is a fixture — a mine, an exchange, a
 * theatre change hands with their ground and by no other route.
 */
export const EstablishLoanOp = z.object({
  op: z.literal('establish_loan'),
  lenderFactionId: z.string().min(1),
  borrowerFactionId: z.string().min(1),
  lent: LentSchema,
  /** The hire fee, borrower to lender, per turn. Trimmed to `MAX_LOAN_RENT`. */
  rentPerTurn: z.number().int().min(0).max(10000).default(0),
  /** Turns until it must be back. `null` is "until somebody says otherwise". */
  termTurns: z.number().int().min(1).max(60).nullable().default(null),
  text: z.string().min(1).max(240),
});

/**
 * Handing back what you borrowed, in whole or in part.
 *
 * An ordinary op, and the **borrower's** alone. Giving back what is not yours
 * needs nobody's permission, which is the same argument that keeps `settle_debt`
 * off the negotiated path — and it is safe to leave open for the same reason,
 * because the reducer moves the real thing: the hulls actually leave the
 * borrower's stacks, so this cannot be used to wish an obligation away.
 *
 * A lender **recalling** early is not this op. That needs the borrower to agree,
 * or a contingency written at signature — 86 already builds the trigger half.
 */
export const ReturnLoanOp = z.object({
  op: z.literal('return_loan'),
  loanId: z.string().min(1),
  reason: z.string().default(''),
});

/**
 * The lender stops asking for it back.
 *
 * Unilateral and therefore ordinary, exactly as `forgive_debt` is: a lender
 * needs nobody's permission to make a gift of what is already in somebody
 * else's hands. What was lent becomes the borrower's, and the goodwill is the
 * same `DEBT_FORGIVENESS_GOODWILL` a written-off debt buys.
 */
/**
 * Keeping what you borrowed.
 *
 * This exists because without it a loan is the one instrument in the game that
 * **cannot be betrayed** — the tick hands the squadron back on the due turn
 * whether the borrower likes it or not, which makes the arrangement a scheduled
 * transfer with a fee rather than an obligation. `break_treaty` is in the
 * ordinary vocabulary for exactly this reason: repudiation is genuinely
 * unilateral, and the game's own rule is that *"betrayal is a later move, not a
 * reason to void the deal."*
 *
 * It reaches the same state as simply failing to return — see `LoanStatus`,
 * where the argument for one status rather than two is written down.
 */
export const RepudiateLoanOp = z.object({
  op: z.literal('repudiate_loan'),
  loanId: z.string().min(1),
  reason: z.string().default(''),
});

export const ForgiveLoanOp = z.object({
  op: z.literal('forgive_loan'),
  loanId: z.string().min(1),
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

/**
 * What an accord may produce, as a closed set.
 *
 * The guard used to be one exception: extraction could emit any `issue_order`
 * except a `fleet_movement`. Measured live, that made diplomacy an **unmetered
 * action channel for 13 of the 14 order types** — a channel closed with
 * `actionPoints: {left: 0}` issued a `courier` order and the count stayed at
 * zero. `garrison_raising`, `fortification`, `capital_ship_construction`,
 * `blockade`, `commerce_raiding` and `espionage` were all reachable free, and a
 * refused accord cost no action point either, which fully bypasses the reason
 * the declared path charges for a refusal.
 *
 * The rule is the one `form_treaty` and `establish_debt` already follow, stated
 * once instead of enumerated backwards: **an accord may only produce what needs
 * the other party's agreement, or what is purely a record of the conversation.**
 * Everything else is unilateral work the action economy already prices at the
 * moment it is declared, and it belongs there.
 *
 * A closed allowlist rather than a predicate, for the same reason `OrderEffect`
 * is a closed vocabulary: a predicate has to be right about every op that will
 * ever exist, and a list has to be edited when one is added — which is the
 * failure mode you want, because the edit is where the thinking happens.
 */
export const EXTRACTION_ALLOWED = new Set<string>([
  // Bind a party other than the actor. Consent lives only in a transcript.
  'form_treaty',
  'break_treaty',
  'establish_debt',
  'assign_debt',
  'restructure_debt',
  'establish_commitment',
  'dissolve_commitment',
  // A creditor or debtor acting on what was agreed in the room. Both move real
  // money in the reducer, so neither can be wished into existence.
  'forgive_debt',
  'settle_debt',
  // The relational product of having talked at all.
  'adjust_disposition',
  // A payment agreed across the table.
  'adjust_credits',
  // Lifting a toll is a concession, and a concession is the thing an accord is
  // FOR — "I'll open the Sennex lane to your hulls" produced nothing before,
  // which is the exact class of dead promise this pass keeps finding. The
  // reducer refuses an extraction-sourced policy that ADDS a target: imposing a
  // tariff needs nobody's agreement and belongs on the declared path, where the
  // action economy prices it.
  'set_toll_policy',
  // Handing a thing over, or being handed one. Taking another power's asset
  // needs their agreement, and a transcript is the one place it exists.
  'transfer_asset',
  // And ONE kind of asset an accord may bring into being: a dossier. The
  // reducer refuses every other kind from here, which is where the rule lives —
  // see `DOSSIER_KIND` for why the paper is different from the ore.
  'create_asset',
  // And spending one, because a conversation that ends "then the prisoners walk
  // free" is a real outcome and the release binds nobody but the holder.
  'consume_asset',
  // Lending binds the borrower to give it back; the two unilateral halves —
  // handing it back, and letting them keep it — are reachable here too, since
  // both are ordinary acts a conversation can perfectly well conclude with.
  'establish_loan',
  'return_loan',
  'forgive_loan',
  // The record of what was said.
  'log_narrative',
  'spawn_event',
]);

/**
 * Ops an accord must NOT produce, with the reason a player would be given.
 *
 * Everything absent from `EXTRACTION_ALLOWED` is refused; this only supplies
 * better wording for the cases a negotiation actually reaches for.
 */
export const EXTRACTION_REFUSAL_REASON: Record<string, string> = {
  issue_order:
    'An order is your own work and costs an action to give. A conversation can agree that you will do it; you still have to declare it on your own turn.',
  adjust_fleet:
    'Hulls are laid down by your own yards and billed to your own treasury. Agree the money here and build them as an action.',
  deploy_agent:
    'Covert work is placed by an operation, priced and capped and rolled for. It is not something a conversation delivers.',
  set_doctrine:
    "A power's posture is its own, and changing it costs its own institutions. Nobody agrees to it across a table.",
  adjust_dissent:
    'Your institutions answer to you, not to the other party. That is not theirs to move.',
  adjust_ships:
    'Crews change hands by suborning them, which needs presence and a stat contest. A conversation cannot hand over hulls.',
};

/** Everything the model is allowed to emit. */
export const ModelOpSchema = z.discriminatedUnion('op', [
  AdjustDispositionOp,
  AdjustFleetOp,
  AdjustCreditsOp,
  SetDoctrineOp,
  CreateAssetOp,
  SetStanceOp,
  SetTollPolicyOp,
  SplitAssetOp,
  ConsumeAssetOp,
  TransferAssetOp,
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
  SettleDebtOp,
  // `establish_loan` is ABSENT for the same reason: lending under terms binds
  // the borrower. Giving it back and letting them keep it are unilateral.
  ReturnLoanOp,
  RepudiateLoanOp,
  ForgiveLoanOp,
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
export const ExtractionOpSchema = z.union([
  ModelOpSchema,
  FormTreatyOp,
  EstablishDebtOp,
  AssignDebtOp,
  // Rescheduling needs the creditor's agreement, so it belongs here with the
  // rest of the negotiated vocabulary rather than on the declared path.
  RestructureDebtOp,
  EstablishLoanOp,
]);

/** The full vocabulary, including ops only the reducer may originate. */
export const OpSchema = z.discriminatedUnion('op', [
  TransferControlOp,
  AdjustDispositionOp,
  AdjustFleetOp,
  AdjustCreditsOp,
  SetDoctrineOp,
  CreateAssetOp,
  LogRulingOp,
  SetStanceOp,
  SetTollPolicyOp,
  SplitAssetOp,
  ConsumeAssetOp,
  TransferAssetOp,
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
  AssignDebtOp,
  RestructureDebtOp,
  SettleDebtOp,
  EstablishLoanOp,
  ReturnLoanOp,
  RepudiateLoanOp,
  ForgiveLoanOp,
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
       * red line against an action **hiring a proxy** — the precise inversion,
       * since hiring is the line being honoured. Naming the direction out loud
       * is the cheapest available check on it. Code cannot settle this the way
       * it settles which list a line is on.
       *
       * It was not enough on its own. The same line was inverted again in a
       * later playtest, with two warnings and a worked example about it live in
       * `prompts/appraisal.md`, so the SENTENCE was rewritten prohibition-first
       * — see `src/seed/scenario.ts`. `how` is still the right guard; it is not
       * a substitute for a line that reads the way it means.
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
   *
   * A LIST, because a declaration routinely contains more than one. This was a
   * single object, so an order carrying an assassination *and* a theft produced
   * one `deploy_agent` and a `log_narrative` promising the other "will come on
   * a later tick" — which never did. Every operation named is routed, and each
   * is charged, capped and exposed on its own.
   */
  covert: z
    .array(
      z.object({
        mission: AgentMissionSchema,
        /** Where the operative works — the system the action happens at. */
        systemId: z.string().min(1),
      }),
    )
    .max(4)
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
  covert: z
    .array(z.object({ mission: AgentMissionSchema, systemId: z.string() }))
    .optional(),
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
  /**
   * This power wants to talk, and what about.
   *
   * `openChannel` is set in exactly one place, reachable only from a player
   * POST, so for the whole life of the project **only one of the five powers
   * could ever start a conversation**. The game has a complete consent
   * mechanism — persona, transcript, extraction, treaty formation — and four of
   * the powers it exists to bind could not invoke it.
   *
   * An approach is an *invitation*, not a channel: it appears in the turn the
   * player has just ended, when they cannot act anyway, and they open the
   * channel themselves if they want it. That is deliberate — a channel disables
   * the command line and End Turn, so opening one unbidden would hijack a turn
   * the player did not choose to spend.
   *
   * It rides on the reaction rather than costing a call of its own. The NPC is
   * already speaking at exactly the right moment; asking it separately would
   * pay twice for one thought.
   */
  approach: z
    .object({
      /** One or two sentences, in character, opening the subject. */
      opening: z.string().min(1).max(400),
      /** What they want, in a few words, for the prompt to open with. */
      about: z.string().min(1).max(120),
    })
    .optional(),
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
    | 'unknown_loan'
    | 'unknown_asset'
    | 'doctrine_refusal'
    /** A treaty was declared rather than negotiated; the other party never agreed. */
    | 'needs_consent'
    /**
     * The mirror of `needs_consent`: an op that came out of a negotiation but
     * needs nobody's agreement, so it belongs on the declared path where the
     * action economy prices it. Only `fleet_movement` is in this position.
     */
    | 'declared_only'
    /**
     * A treaty was signed carrying a `voidsOn` condition that was ALREADY true.
     *
     * `voidConditionMet` had exactly one caller, in `tickTurn`, so such a treaty
     * was recorded `active` and died on the next tick — having been announced,
     * shown in the panel, and believed by the power that signed it. Measured
     * live: a 15/turn toll voided on the same tick it was signed, and the
     * counterparty's next reaction described it as a live arrangement it was
     * honouring. Refusing it is what makes the deal get re-expressed rather
     * than quietly evaporate.
     */
    | 'already_void';
  message: string;
}

export function describeRejections(rejections: OpRejection[]): string {
  return rejections
    .map((r, i) => `${i + 1}. [${r.code}] ${r.message}\n   offending op: ${JSON.stringify(r.op)}`)
    .join('\n');
}
