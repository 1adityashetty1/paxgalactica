import { z } from 'zod';
import { StatNameSchema } from './checks.js';
import {
  AgentEffectSchema,
  AgentMissionSchema,
  MethodSchema,
  RiderSchema,
  METHOD_AXES,
  AssetYieldSchema,
  TreatyTermsSchema,
  TreatyTypeSchema,
  VoidConditionSchema,
  DemandKindSchema,
  OBLIGATION_SIGNABLE,
  ULTIMATUM_MAX_DEADLINE,
} from './diplomacy.js';
import { CATEGORY_FLOORS, FibScaleSchema, type DurationCategory } from './duration.js';
import { LentSchema } from './loan.js';
import { HullClassSchema, TypedStackSchema } from './hulls.js';
import { CheatSchema } from './cheats.js';
import { AgentClassSchema, CommanderArchetypeSchema } from './command.js';
import {
  OnInterruptSchema,
  OrderEffectSchema,
  OrderTypeSchema,
  TradeEthicSchema,
  WarEthicSchema,
} from './state.js';


/**
 * An optional string where a model says "none" by sending an empty one.
 *
 * Every model-facing schema here is handed to the model as JSON Schema, and a
 * model asked for an optional field routinely writes `""` rather than leaving
 * it out. A `min(1)` on that field then rejects an honest answer and costs a
 * retry for nothing — measured in a traced playtest, where a covert action aimed
 * at nobody in particular sent `target: ""`. Blank means absent, here, once.
 */
export function absentWhenBlank(max: number) {
  return z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));
}

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

/**
 * A cheat from the in-game menu. **Reducer-only in the strictest sense**: absent
 * from every schema a model is handed, and refused from any source but `cheat`,
 * which only the server's cheat route uses. See `src/domain/cheats.ts`.
 */
export const CheatOp = z.object({
  op: z.literal('cheat'),
  cheat: CheatSchema,
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

/**
 * Credits from one power to another: `factionId` pays, `to` receives. On a
 * declaration the payer is the acting power; in an accord either party may pay,
 * because the transcript is where the payer agreed. Conserved by construction —
 * a payment cannot invent the money it moves (intent-ops §2).
 */
export const PayOp = z.object({
  op: z.literal('pay'),
  factionId: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().int().min(1),
  /** What it buys, in a phrase: a bribe, a ransom, the price of a world. */
  for: z.string().default(''),
});

/**
 * What an influence check that worked moves: how `whom` sees the actor. The
 * engine sizes it by the band (`SWAY_BY_BAND`) and drops it when the check was
 * not influence or did not work; a model never chooses the amount (intent-ops §3).
 */
export const SwayOp = z.object({
  op: z.literal('sway'),
  factionId: z.string().min(1),
  whom: z.string().min(1),
  /** Written by the engine from the roll. */
  amount: z.number().int().min(1).max(15).optional(),
  reason: z.string().default(''),
});

/**
 * A reacting power's own view of another moves, for a reason from a closed
 * list; the size is the table's (`REGARD_BECAUSE`), never the model's.
 */
export const RegardOp = z.object({
  op: z.literal('regard'),
  factionId: z.string().min(1),
  toward: z.string().min(1),
  because: z.enum(['slight', 'insult', 'threat', 'promise_broken', 'deference', 'promise_kept', 'aid']),
  reason: z.string().default(''),
});

/** Credits given to another power, which buy its regard at a published rate (`GIFT_RATE`). */
export const GiftOp = z.object({
  op: z.literal('gift'),
  factionId: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().int().min(1),
  for: z.string().default(''),
});

/** The acting power's credits to nobody on the board: a bribe, a hire, materials. */
export const SpendOp = z.object({
  op: z.literal('spend'),
  factionId: z.string().min(1),
  amount: z.number().int().min(1),
  for: z.string().default(''),
});

/** Internal standing with your own institutions. Reducer-driven, not narrative. */
export const AdjustDissentOp = z.object({
  op: z.literal('adjust_dissent'),
  factionId: z.string().min(1),
  delta: z.number().int().min(-100).max(100),
  reason: z.string().default(''),
});

/**
 * The same op as the model may write it: upward only.
 *
 * A model-sourced `adjust_dissent` has never been allowed to lower anybody's
 * standing — the reducer rejects it with "dissent cannot be talked down", and
 * for good reason, since the same call that earns a refusal could otherwise
 * erase the penalty it just earned. But the model was handed a schema saying
 * `-100..100`, so it kept writing the one half it could never use.
 *
 * Constrained here rather than only in the reducer because `ModelOpSchema` is
 * what becomes the JSON schema handed to the model: a floor of zero makes the
 * rejected half **ungeneratable**, which is layer 1 doing the work layer 2 was
 * paying a correction call for. `AdjustDissentOp` keeps the full range, so
 * journals written before this still parse and still reach the same verdicts.
 */
export const ModelAdjustDissentOp = AdjustDissentOp.extend({
  delta: z.number().int().min(0).max(100),
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
   * One setting for the whole navy; there is no per-world or per-fleet stance.
   *
   * `hold` never breaks off — the world at any price.
   * `stand` breaks off at two to one, which is how every campaign has played.
   * `withdraw` leaves the moment it is outmatched, keeping the fleet.
   */
  stance: z.enum(['hold', 'stand', 'withdraw']),
});

/**
 * Pay one of your estates a stipend, or stop paying it — see `seats.ts`.
 *
 * A stipend is `GRANT_COST` a turn and lifts the estate's favour baseline by
 * `GRANT_FAVOUR`; an estate holds at most `MAX_GRANTS` grants, a marriage
 * abroad counting as one. Revoking costs `REVOKED_FAVOUR` at once. Your own
 * estates only. `estate` is its id or its name — "the Blue Bloods".
 */
export const GrantStipendOp = z.object({
  op: z.literal('grant_stipend'),
  factionId: z.string().min(1),
  estate: z.string().min(1),
});
export const RevokeStipendOp = z.object({
  op: z.literal('revoke_stipend'),
  factionId: z.string().min(1),
  estate: z.string().min(1),
});

/**
 * Appoint someone off your Lists to a seat on a world you hold: name the
 * notable, or name an estate and its first listed notable goes. An empty seat
 * — a conquest, a killing, a world grown into a hub — is filled at no cost
 * beyond the action. A full one is taken from whoever sits it, the estate with
 * the most seats first, and they go back on the Lists; one estate's gain is
 * visibly another's loss, and the world's regard for you drops
 * `RESEAT_REGARD`. `office` picks the governor's seat or a hub's chancellor's.
 */
export const SeatEstateOp = z.object({
  op: z.literal('seat_estate'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  /** The estate the seat goes to; its first listed notable, unless `notable` names one. */
  estate: z.string().min(1).optional(),
  /** A notable on your Lists, by id or name. */
  notable: z.string().min(1).optional(),
  office: z.enum(['governor', 'chancellor']).optional(),
});

/**
 * Marry one of your notables off the Lists to the notable of a world that
 * answers to nobody; yours goes to live there. No channel — an independent
 * world has nobody to talk for it — and its standing with you is its answer:
 * it accepts at `MARRIAGE_CONSENT_REGARD` or better. A marriage with another
 * POWER needs its consent and is a `marriage` treaty, agreed in a channel.
 */
export const ProposeMarriageOp = z.object({
  op: z.literal('propose_marriage'),
  factionId: z.string().min(1),
  /** Your notable on the Lists, by id or name — they go to live on that world. */
  notable: z.string().min(1),
  /** The independent world whose notable is asked. */
  systemId: z.string().min(1),
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
  /**
   * A toll lifted for a term rather than for good: the powers taken off the
   * list go back on after this many turns. A lift with no term is permanent.
   */
  forTurns: z.number().int().min(1).max(30).optional(),
  /**
   * …or while a live treaty of this type binds this power to each power lifted
   * — "while the accord holds". Both may be given; whichever ends first ends it.
   */
  whileTreaty: TreatyTypeSchema.optional(),
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
 * Move a portable thing this power holds to another of its worlds, along a
 * path through its own space. Unrolled: it is moving your own property inside
 * your own space. Without a verb for it a model improvises one out of
 * destructive ops (playtest 2026-10-16). A person moves by `decide_fate`.
 */
export const RelocateAssetOp = z.object({
  op: z.literal('relocate_asset'),
  assetId: z.string().min(1),
  toSystemId: z.string().min(1),
});

/**
 * What becomes of a person this power holds.
 *
 * A person's fate is one named choice, never a side effect of a generic verb.
 * `consume_asset` on a prisoner used to interrogate them, and a playtest
 * (2026-10-16) watched resolution write "move the prisoner" as a consume and a
 * fresh `create_asset`: the notable was questioned out of play and a lookalike
 * minted. Each fate here is priced and checked by the reducer.
 */
export const DecideFateOp = z.object({
  op: z.literal('decide_fate'),
  assetId: z.string().min(1),
  fate: z.enum(['interrogate', 'release', 'execute', 'relocate']),
  /** For `relocate`: a world the holder holds, reached through its own space. */
  toSystemId: z.string().min(1).optional(),
  reason: z.string().max(240).default(''),
});

/**
 * Call in a promissory note this power holds — see `NOTE_KINDS`.
 *
 * Needs nobody's consent: the issuer gave it when it wrote the note, which is
 * what a note is. The arrangement it names comes into force between holder and
 * issuer for `NOTE_TERM_TURNS`, and the note goes home to its issuer.
 */
export const PlayNoteOp = z.object({
  op: z.literal('play_note'),
  assetId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/**
 * A favour owed, agreed across a table — see `ObligationSchema`. Extraction
 * only, like `establish_debt`: it binds the debtor, and a transcript is where
 * its consent lives. Always weak; a strong hook is only ever bought with a
 * secret.
 */
export const EstablishObligationOp = z.object({
  op: z.literal('establish_obligation'),
  debtorFactionId: z.string().min(1),
  holderFactionId: z.string().min(1),
  /** One sentence: what is owed, in the words the parties used. */
  text: z.string().min(1).max(240),
});

/**
 * Call in an obligation you hold. Needs nobody's consent — the debtor gave it
 * when it incurred the obligation. `sign` names a treaty from a closed list;
 * `support` names an open ultimatum of yours.
 */
export const CallObligationOp = z.object({
  op: z.literal('call_obligation'),
  obligationId: z.string().min(1),
  call: z.enum(['sign', 'support']),
  /** For `sign`: the treaty the debtor enters with you. */
  treatyType: z.enum(OBLIGATION_SIGNABLE).optional(),
  /** For `support`: the ultimatum of yours it backs. */
  demandId: z.string().min(1).optional(),
  reason: z.string().max(240).default(''),
});

/** Walk away from an obligation you owe — priced like breaking a pact, in public. */
export const RepudiateObligationOp = z.object({
  op: z.literal('repudiate_obligation'),
  obligationId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/**
 * Let a debtor off a favour owed to you. Holder only, and it costs the holder
 * its own claim and nothing else, so it is declarable — and reachable from an
 * accord, where giving a favour up is the price of something else.
 */
export const ReleaseObligationOp = z.object({
  op: z.literal('release_obligation'),
  obligationId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/**
 * Sell a favour owed to you to a third power, as `assign_debt` sells a debt.
 * Extraction only: the buyer takes it on, and a transcript is where it says so.
 * Weak favours only — see `ObligationSchema`.
 */
export const AssignObligationOp = z.object({
  op: z.literal('assign_obligation'),
  obligationId: z.string().min(1),
  toHolderFactionId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/** Publish a secret a watcher found: its subject loses standing with every power. */
export const PublishDossierOp = z.object({
  op: z.literal('publish_dossier'),
  assetId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/** Spend a secret for a strong hook on its subject — see `ObligationSchema`. */
export const BlackmailOp = z.object({
  op: z.literal('blackmail'),
  assetId: z.string().min(1),
  reason: z.string().max(240).default(''),
});

/**
 * Make a public demand of another power, with a deadline — see `DemandSchema`.
 * Unanswered at the deadline, it is war.
 */
export const IssueUltimatumOp = z.object({
  op: z.literal('issue_ultimatum'),
  targetFactionId: z.string().min(1),
  demand: DemandKindSchema,
  /** `tribute`: credits a turn. */
  perTurn: z.number().int().min(1).max(1000).optional(),
  /** `cession`: a world the target holds. */
  systemId: z.string().min(1).optional(),
  /** `break_treaty`: a live treaty the target holds with a third power. */
  treatyId: z.string().min(1).optional(),
  /** Turns until it is answered, 1–5. */
  deadlineTurns: z.number().int().min(1).max(ULTIMATUM_MAX_DEADLINE),
  /** The demand in the issuer's words. */
  text: z.string().min(1).max(240),
});

/** Declare for a side of somebody else's ultimatum. */
export const BackUltimatumOp = z.object({
  op: z.literal('back_ultimatum'),
  demandId: z.string().min(1),
  side: z.enum(['from', 'to']),
});

/** Give the issuer what it demanded, before the deadline makes it war. */
export const ConcedeUltimatumOp = z.object({
  op: z.literal('concede_ultimatum'),
  demandId: z.string().min(1),
});

/** Take your own demand back. Nothing is owed, and nobody goes to war. */
export const WithdrawUltimatumOp = z.object({
  op: z.literal('withdraw_ultimatum'),
  demandId: z.string().min(1),
});

/**
 * Put a price on another power — see `BountySchema`. Your own credits go into
 * escrow, paid out to whoever raids the target or destroys its hulls. Posting
 * again against the same power tops your bounty up.
 */
export const PostBountyOp = z.object({
  op: z.literal('post_bounty'),
  targetFactionId: z.string().min(1),
  /** Credits into escrow. Trimmed to what the treasury holds. */
  credits: z.number().int().min(1).max(100000),
  reason: z.string().max(240).default(''),
});

/** Take back what is left of a bounty you posted. The target's grievance stays. */
export const WithdrawBountyOp = z.object({
  op: z.literal('withdraw_bounty'),
  bountyId: z.string().min(1),
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
  /**
   * Officers sailing with this fleet, by name — a family name is enough — or
   * by id. `fleet_movement` only.
   *
   * An officer is a unit of the fleet that weighs nothing, so they sail the way
   * its hulls do: named here, or aboard when the WHOLE port sails (`force`
   * omitted). They must be yours, active, and standing at the origin; one who
   * is not is left behind with a note and the fleet still sails.
   */
  officers: z.array(z.string().min(1)).max(5).default([]),
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
  /**
   * Run a `commerce_raiding` order dark: nobody else is told whose it is, its
   * costs are owed rather than charged, and it takes `DARK_RAID_YIELD` of the
   * prizes. Refused on any other order.
   */
  dark: z.boolean().optional(),
  /**
   * The power whose pact, truce, accord or contract this order knowingly
   * breaks. An NPC's reaction that attacks, blockades or raids a power it is
   * bound to is held back unless it names that power here: betrayal stays a
   * move, but a deliberate one. The price is unchanged — charged on arrival by
   * `acts.ts`, as any attack under a pact is.
   */
  breaks: z.string().min(1).optional(),
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
  /**
   * Whether this arrangement forecloses another of its type with anyone else.
   *
   * The arbiter's ruling to make, the same division that already governs
   * `establish_commitment`: *the arbiter rules that a marriage is exclusive and
   * the reducer enforces it.* Refused at signature when either side is already
   * bound exclusively to a third power — see `conflictingTreaty`.
   */
  exclusive: z.boolean().default(false),
  summary: z.string().default(''),
});

export const BreakTreatyOp = z.object({
  op: z.literal('break_treaty'),
  treatyId: z.string().min(1),
  reason: z.string().default(''),
});

/** A rider as the arbiter writes it: the price is the engine's. */
export const RiderPartSchema = RiderSchema.omit({ paid: true });

/**
 * Send an operative on a mission (journal version 11 on): one the power already
 * has, recruited by `recruit_agent`. Recruiting and sending are two actions, so
 * a covert attempt needs somebody already on the books. The operative travels
 * `AGENT_JUMPS_PER_TURN` jumps a turn from where they stand and goes to work on
 * arrival. Before version 11 this op recruited and placed in one step, at once,
 * anywhere — and a journal written then replays that way.
 */
export const DeployAgentOp = z.object({
  op: z.literal('deploy_agent'),
  /**
   * Which of your operatives to send, by id or by name. Omitted, the nearest
   * one awaiting orders goes; one already on a mission is only re-tasked when
   * named, so a watch is never ended by accident.
   */
  agent: z.string().min(1).nullable().default(null),
  /**
   * Whose operative it is — and there is exactly one right answer, so it is
   * optional and defaults to the acting faction.
   *
   * It used to be required, and it is the single largest source of rejected
   * ops in the game: 31 across 129 played turns, every one of them the same
   * mistake. On a hostile mission the sentence is about the VICTIM —
   * "sabotage the Vigil garrison" — so the field gets anchored to the Vigil,
   * and an operative owned by its own target can never act. `resolution.md`
   * has warned about it in bold for as long as the guard has existed and the
   * rate did not move, which is the evidence that prose was not the fix: the
   * model was being asked to restate a fact `applyOps` already holds as
   * `actor`, and a field that can only ever have one correct value should not
   * be asked for at all.
   *
   * Still accepted when supplied, and still rejected when it disagrees with
   * the actor — journals written before this carry it, and replay has to
   * reach the same verdicts it did then.
   */
  ownerFactionId: z.string().min(1).optional(),
  systemId: z.string().min(1),
  mission: AgentMissionSchema,
  effect: AgentEffectSchema,
  cover: z.string().default(''),
  /**
   * An officer to aim an `assassination` at, by id.
   *
   * Ignored by every other mission. Killing one takes a **17 or better** on a
   * roll of its own, on top of the operation succeeding at all — see
   * `ASSASSINATION_KILL_ROLL`. Before this, "assassinate their Iron Marshal"
   * was admissible, priced, rolled, and then damaged some hulls: the officer
   * named in the sentence went on commanding battles, which is the inert
   * success this codebase closes everywhere else.
   */
  targetCommanderId: z.string().nullable().default(null),
  /**
   * A NOTABLE the operation is aimed at, by id or name — see `seats.ts`. A
   * subversion aimed at one turns them against their holder; a seduction
   * must name one; an assassination may. They must sit the world the
   * operative is sent to.
   */
  targetNotable: z.string().min(1).optional(),
  /**
   * A captured operative of your own to put back in the field, rather than a
   * new one to recruit.
   *
   * The twin of `recruit_commander`'s `fromAssetId`, and the half that was
   * missing: an officer could be ransomed home and restored to post, while a
   * ransomed operative sat in the warehouse as a person you owned and could not
   * employ. **Redeployment clears `exposed`** — a face the enemy caught is not
   * a person who has stopped existing — and charges no `AGENT_COST`, because
   * the ransom was the cost and they are already trained. Their record comes
   * with them, and so does the mark.
   */
  fromAssetId: z.string().nullable().default(null),
  /**
   * How it is done, scored rather than named — the player's words and four axes
   * of −1..+1. Held to a budget in code. See `MethodProfileSchema`.
   */
  method: MethodSchema.optional(),
  /**
   * A second outcome on the same order — a frame on a killing, a fire behind a
   * theft. Priced, louder, and lands only if the primary does. See `RiderSchema`.
   */
  rider: RiderPartSchema.optional(),
});

/**
 * Recruit an operative, at a world the power holds, awaiting orders. Its own
 * action: a declaration that recruits does nothing else, and the mission is
 * a second one (`deploy_agent`). Free in credits — the mission is what is
 * priced — but it takes a slot under `maxAgentsFor` and draws `AGENT_UPKEEP`
 * from the turn it signs on.
 */
export const RecruitAgentOp = z.object({
  op: z.literal('recruit_agent'),
  /** Whose operative; defaults to the acting power, as `deploy_agent` does. */
  factionId: z.string().min(1).optional(),
  /** Where they sign on. Must be a world the power holds. */
  systemId: z.string().min(1),
  /**
   * A captured operative of your own, ransomed home, back on the books rather
   * than a new face. Their record comes with them, and so does the mark.
   */
  fromAssetId: z.string().nullable().default(null),
  /**
   * Which operative off the power's Lists, by name or id (journal version 22).
   * Omitted, the first one listed comes.
   */
  agent: z.string().min(1).optional(),
  /** Or which class: the first of it waiting comes. See `AGENT_CLASSES`. */
  agentClass: AgentClassSchema.optional(),
  cover: z.string().default(''),
});

/**
 * Lay groundwork: an operative gets into position for a later act — undercover
 * in the kitchens, owed a favour by the night watch — and that preparation is
 * recorded on them (`GroundworkSchema`). One axis, one step, worth it to a later
 * mission by the same operative on the same world. The action point is its
 * whole price; it counts from the next turn.
 */
export const LayGroundworkOp = z.object({
  op: z.literal('lay_groundwork'),
  /** Which operative, by name or id; named nobody, the nearest awaiting orders. */
  agent: z.string().min(1).nullable().default(null),
  systemId: z.string().min(1),
  /** The player's own words. */
  text: z.string().min(1).max(160),
  /** The one axis it improves: preparation, ease, noise or ifCaught. */
  axis: z.enum(METHOD_AXES),
  /** Who or what it is aimed at, by name — a notable, an officer, a thing, a power. Omitted, it helps anything there. */
  target: z.string().min(1).max(80).optional(),
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
  /**
   * The mechanism the arbiter's ruling named for it, written by the engine on
   * a declared commitment. Absent on an accord's, and on every commitment
   * written before journal version 25.
   */
  mechanism: z.enum(['income', 'record']).optional(),
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

/**
 * Hire an officer, or bring a captured one home to their post.
 *
 * **Ordinary, not extraction-only.** Appointing your own officers needs nobody
 * else's agreement — the same argument that makes `settle_debt` and
 * `forgive_debt` ordinary while `establish_debt` is not.
 *
 * `fromAssetId` names a captured officer you are **holding**, which is the whole
 * of how a taken commander comes back: they are an `Asset` from the moment they are
 * taken, they move like one — ransomed, traded, ceded, won back — and they only
 * stops being one when the power they belong to puts their back in post. So the
 * return trip needs no second mechanism; it is this op reading an asset instead
 * of minting a person.
 */
export const RecruitCommanderOp = z.object({
  op: z.literal('recruit_commander'),
  factionId: z.string().min(1),
  /** Where they report. Must be a world the faction holds. */
  systemId: z.string().min(1),
  /**
   * An officer on your Lists, by id or name. From journal version 20 every
   * appointment comes off the Lists: name the officer, or a `school` and its
   * first listed goes.
   */
  officer: z.string().min(1).optional(),
  /** A school of command — `lineofbattle`, `gunnery`, `convoy` or `assault` — whose first listed officer goes. */
  school: CommanderArchetypeSchema.optional(),
  /**
   * A captured officer to restore, rather than a new one to hire.
   *
   * Only ever your own: turning somebody else's admiral is a different idea and
   * a much larger one, and nothing here should make it look built.
   */
  fromAssetId: z.string().nullable().default(null),
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
  /**
   * Written for the actor alone. Set by the engine on a secret batch — covert
   * work, or an order the actor's own institutions refused — and never needed
   * from a model: the only thing it can do is hide the actor's own note.
   *
   * Absent is public, which is every note ever journaled before this existed,
   * so old campaigns replay exactly.
   */
  private: z.boolean().optional(),
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
  // A payment agreed across the table — `pay`, and `adjust_credits` only so
  // accords journaled before `pay` existed replay.
  'pay',
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
  // "We will owe you one." Binds the debtor; consent lives in the transcript.
  'establish_obligation',
  // And a favour held is consideration: let off as one side's price, or sold
  // to the other party. Calling one in is NOT here — it needs nobody's
  // agreement, so from a channel it would be the declared act minus its cost.
  'release_obligation',
  'assign_obligation',
  // A target giving way to a demand in the room, which is the other party's
  // consent written down — grounded like any concession.
  'concede_ultimatum',
  // The record of what was said.
  'log_narrative',
  // No model can write this any more (intent-ops §6: it left `ModelOpSchema`),
  // but accords journaled before that carry it, and refusing it here would
  // sink those whole batches on replay.
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

/**
 * **Ships change only through intent ops** (journal version 22). A model never
 * writes ship arithmetic: `adjust_ships` and `adjust_fleet` are the reducer's
 * mechanism, and what a model may say is one of these, or a fleet movement.
 * The reducer used to infer intent from who was acting, whose hulls they were
 * and the sign of the number — so a casualty a model invented beside a fleet
 * movement read as an attempt to suborn, was refused for it, and sank the
 * movement with it.
 */

/** Lay down new hulls of your own, now, billed by displacement and held to your yards' capacity. */
/**
 * What every piece of work carries, as an order does. Every one is optional
 * with a default, and every one is used: models set `label` on most orders,
 * `onInterrupt` on a fifth of them (`partial` refunds the unspent money), and
 * `visibility` when a power chooses to be seen.
 */
const WorkFields = {
  label: z.string().default(''),
  /** 1, 2, 3 or 5 turns. Omitted, the kind's own: its category floor, and two for an envoy. */
  durationTurns: FibScaleSchema.optional(),
  durationRationale: z.string().default(''),
  interruptible: z.boolean().default(true),
  onInterrupt: OnInterruptSchema.default('cancel'),
  visibility: z.array(z.string()).default([]),
};

export const BuildShipsOp = z.object({
  op: z.literal('build_ships'),
  factionId: z.string().min(1),
  hull: HullClassSchema,
  count: z.number().int().min(1),
  /** A world you hold; omitted, your best one. A programme needs one named. */
  systemId: z.string().min(1).optional(),
  reason: z.string().default(''),
  /**
   * Built out of sight instead of laid down now: a hidden, interruptible yard
   * programme, paid at issue and delivered on completion. Counted against the
   * same berths as an open build.
   */
  programme: z.boolean().default(false),
  ...WorkFields,
});

/**
 * Move ships of your own — to your own world, against a rival's, onto ground
 * nobody holds. One jump between two worlds you hold, with no rival over the
 * target, lands at once; anything else sails a turn a jump and is settled on
 * arrival. The reducer decides which.
 */
export const MoveOp = z.object({
  op: z.literal('move'),
  factionId: z.string().min(1),
  originId: z.string().min(1),
  targetId: z.string().min(1),
  /** A count, drawn proportionally, or a composition. Omitted, the whole port and its officers. */
  force: z.union([z.number().int().min(1), TypedStackSchema]).optional(),
  officers: z.array(z.string().min(1)).max(5).default([]),
  /** The power whose pact, truce, accord or contract this knowingly breaks. */
  breaks: z.string().min(1).optional(),
  label: z.string().default(''),
  interruptible: z.boolean().default(true),
  onInterrupt: OnInterruptSchema.default('cancel'),
  visibility: z.array(z.string()).default([]),
});

/** Raise a world's garrison ceiling. Permanent, and it defends whoever holds the world next. */
export const FortifyOp = z.object({
  op: z.literal('fortify'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  magnitude: z.number().int().min(1).max(99),
  ...WorkFields,
});

/** Raise troops on a world, up to its ceiling. */
export const RaiseGarrisonOp = z.object({
  op: z.literal('raise_garrison'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  magnitude: z.number().int().min(1).max(99),
  ...WorkFields,
});

/** Develop a world: strategic value up, and at 7 it becomes a trade hub. Priced by what it is worth. */
export const DevelopOp = z.object({
  op: z.literal('develop'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  magnitude: z.number().int().min(1).max(99),
  ...WorkFields,
});

/** Raise a fixture of a catalogue kind on a world you hold, if its ground takes it and a slot is free. */
export const FoundFixtureOp = z.object({
  op: z.literal('found_fixture'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  kind: z.string().min(1),
  ...WorkFields,
});

/** Mend a fixture a saboteur has hit. */
export const RepairFixtureOp = z.object({
  op: z.literal('repair_fixture'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  kind: z.string().min(1).optional(),
  magnitude: z.number().int().min(1).max(99),
  ...WorkFields,
});

/** Send an envoy to court a world — one you hold, or an independent one you border or orbit. */
export const SendEnvoyOp = z.object({
  op: z.literal('send_envoy'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  magnitude: z.number().int().min(1).max(99).default(2),
  ...WorkFields,
});

/** Close every lane through a world your fleet already sits over. */
export const BlockadeOp = z.object({
  op: z.literal('blockade'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  originId: z.string().min(1).optional(),
  breaks: z.string().min(1).optional(),
  ...WorkFields,
});

/** Raid the shipping through a world, from a fleet on it or a jump out. `dark` runs it unowned. */
export const RaidOp = z.object({
  op: z.literal('raid'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  originId: z.string().min(1).optional(),
  dark: z.boolean().optional(),
  breaks: z.string().min(1).optional(),
  ...WorkFields,
});

/** Sweep a world of your own for rival operatives: counter-intelligence, read while it runs. */
export const SweepOp = z.object({
  op: z.literal('sweep'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  ...WorkFields,
});

/** The ops that are work: each one an order, with the reducer choosing its category. */
export const WORK_OPS = [
  'move', 'fortify', 'raise_garrison', 'develop', 'found_fixture', 'repair_fixture',
  'send_envoy', 'blockade', 'raid', 'sweep',
] as const;

/**
 * The order a piece of work means, as an `issue_order` would have written it —
 * or null when the op is not work. One conversion, read by the reducer and by
 * every reader of a batch (payload bounding, the fog's public test, the treaty
 * filter), so none of them restates which category a kind of work is filed
 * under (`docs/design-2026-10-17-intent-ops.md` §1).
 *
 * A `build_ships` is work only as a `programme`. An `issue_order` is returned as
 * it is: the engine, the bots' legacy shapes and old journals still write it.
 */
export function orderFor(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.op === 'issue_order') return o;
  const work = (type: string, systemId: unknown, onComplete?: Record<string, unknown>, duration?: unknown) => ({
    op: 'issue_order',
    factionId: o.factionId,
    type,
    originId: o.originId ?? systemId,
    targetId: systemId,
    ...(duration !== undefined ? { durationTurns: duration } : {}),
    durationRationale: o.durationRationale ?? '',
    interruptible: o.interruptible ?? true,
    onInterrupt: o.onInterrupt ?? 'cancel',
    visibility: o.visibility ?? [],
    label: o.label ?? '',
    ...(onComplete ? { onComplete } : {}),
  });
  const floor = (type: DurationCategory) => o.durationTurns ?? CATEGORY_FLOORS[type];
  switch (o.op) {
    case 'move':
      return {
        op: 'issue_order',
        factionId: o.factionId,
        type: 'fleet_movement',
        originId: o.originId,
        targetId: o.targetId,
        ...(o.force !== undefined ? { force: o.force } : {}),
        officers: o.officers ?? [],
        ...(o.breaks !== undefined ? { breaks: o.breaks } : {}),
        interruptible: o.interruptible ?? true,
        onInterrupt: o.onInterrupt ?? 'cancel',
        visibility: o.visibility ?? [],
        label: o.label ?? '',
      };
    case 'fortify':
      return work('fortification', o.systemId, { kind: 'fortify', magnitude: o.magnitude }, floor('fortification'));
    case 'raise_garrison':
      return work('garrison_raising', o.systemId, { kind: 'raise_garrison', magnitude: o.magnitude }, floor('garrison_raising'));
    case 'develop':
      return work('construction_infrastructure', o.systemId, { kind: 'develop_system', magnitude: o.magnitude }, floor('construction_infrastructure'));
    case 'found_fixture':
      return work('construction_infrastructure', o.systemId, { kind: 'found_fixture', magnitude: 1, fixtureKind: o.kind }, floor('construction_infrastructure'));
    case 'repair_fixture':
      return work(
        'construction_infrastructure',
        o.systemId,
        { kind: 'repair_fixture', magnitude: o.magnitude, ...(o.kind !== undefined ? { fixtureKind: o.kind } : {}) },
        floor('construction_infrastructure'),
      );
    case 'send_envoy':
      // Two turns: every envoy in the saved campaigns was estimated at two
      // against a floor of one, and the floor alone would double their pace.
      return work('political_maneuver', o.systemId, { kind: 'court', magnitude: o.magnitude ?? 2 }, o.durationTurns ?? 2);
    case 'blockade':
      return { ...work('blockade', o.systemId, undefined, floor('blockade')), ...(o.breaks !== undefined ? { breaks: o.breaks } : {}) };
    case 'raid':
      return {
        ...work('commerce_raiding', o.systemId, undefined, floor('commerce_raiding')),
        ...(o.dark !== undefined ? { dark: o.dark } : {}),
        ...(o.breaks !== undefined ? { breaks: o.breaks } : {}),
      };
    case 'sweep':
      return work('counter_intelligence', o.systemId, undefined, floor('counter_intelligence'));
    case 'build_ships':
      if (o.programme !== true) return null;
      // Filed as capital ship construction; the reducer re-files a lighter hull
      // as a refit (`commissionCategory`).
      return work(
        'capital_ship_construction',
        o.systemId,
        { kind: 'commission_ships', magnitude: o.count, hull: o.hull },
        o.durationTurns ?? CATEGORY_FLOORS[o.hull === 'battleship' ? 'capital_ship_construction' : 'refit'],
      );
    default:
      return null;
  }
}

/**
 * Talk another power's crews into changing sides where they stand — at a world
 * you have ships at or next to, or an operative on. Their resolve against your
 * guile decides how many will; the cheapest hulls go first, they are paid for
 * by the ton, and it costs standing with them and everyone watching.
 */
export const SubornCrewsOp = z.object({
  op: z.literal('suborn_crews'),
  factionId: z.string().min(1),
  /** The power whose crews are turned. */
  fromFactionId: z.string().min(1),
  systemId: z.string().min(1),
  count: z.number().int().min(1),
  reason: z.string().default(''),
});

/** Scuttle or strike off hulls of your own at a world. Never another power's. */
export const ScuttleShipsOp = z.object({
  op: z.literal('scuttle_ships'),
  factionId: z.string().min(1),
  systemId: z.string().min(1),
  count: z.number().int().min(1),
  /** Which class; omitted, the cheapest go first. */
  hull: HullClassSchema.optional(),
  reason: z.string().default(''),
});

/** Everything the model is allowed to emit. */
export const ModelOpSchema = z.discriminatedUnion('op', [
  SwayOp,
  RegardOp,
  GiftOp,
  BuildShipsOp,
  MoveOp,
  FortifyOp,
  RaiseGarrisonOp,
  DevelopOp,
  FoundFixtureOp,
  RepairFixtureOp,
  SendEnvoyOp,
  BlockadeOp,
  RaidOp,
  SweepOp,
  SubornCrewsOp,
  ScuttleShipsOp,
  PayOp,
  SpendOp,
  SetDoctrineOp,
  CreateAssetOp,
  SetStanceOp,
  GrantStipendOp,
  RevokeStipendOp,
  SeatEstateOp,
  ProposeMarriageOp,
  SetTollPolicyOp,
  SplitAssetOp,
  ConsumeAssetOp,
  DecideFateOp,
  RelocateAssetOp,
  TransferAssetOp,
  PlayNoteOp,
  CallObligationOp,
  RepudiateObligationOp,
  ReleaseObligationOp,
  PublishDossierOp,
  BlackmailOp,
  IssueUltimatumOp,
  BackUltimatumOp,
  ConcedeUltimatumOp,
  WithdrawUltimatumOp,
  PostBountyOp,
  WithdrawBountyOp,
  CancelOrderOp,
  InterruptOrderOp,
  ExtendOrderOp,
  AccelerateOrderOp,
  // `form_treaty` is deliberately ABSENT — see `ExtractionOpSchema`. A treaty
  // binds another power, and a resolution call reached by a single player
  // declaration has nobody's consent but the player's.
  BreakTreatyOp,
  DeployAgentOp,
  RecruitAgentOp,
  RecallAgentOp,
  LayGroundworkOp,
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
  RecruitCommanderOp,
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
  // An accord's regard is still narrated, held to the batch cap and to a
  // treaty's own goodwill (intent-ops §3); a declaration and a reaction write
  // `sway`, `regard` and `gift` instead.
  AdjustDispositionOp,
  FormTreatyOp,
  EstablishDebtOp,
  AssignDebtOp,
  // Rescheduling needs the creditor's agreement, so it belongs here with the
  // rest of the negotiated vocabulary rather than on the declared path.
  RestructureDebtOp,
  EstablishLoanOp,
  // A favour owed binds the debtor, so it is agreed in a channel or not at all.
  EstablishObligationOp,
  // Selling one binds the buyer to having bought it.
  AssignObligationOp,
]);

/** The full vocabulary, including ops only the reducer may originate. */
export const OpSchema = z.discriminatedUnion('op', [
  TransferControlOp,
  CheatOp,
  AdjustDispositionOp,
  SwayOp,
  RegardOp,
  GiftOp,
  AdjustFleetOp,
  BuildShipsOp,
  MoveOp,
  FortifyOp,
  RaiseGarrisonOp,
  DevelopOp,
  FoundFixtureOp,
  RepairFixtureOp,
  SendEnvoyOp,
  BlockadeOp,
  RaidOp,
  SweepOp,
  SubornCrewsOp,
  ScuttleShipsOp,
  AdjustCreditsOp,
  PayOp,
  SpendOp,
  SetDoctrineOp,
  CreateAssetOp,
  LogRulingOp,
  SetStanceOp,
  GrantStipendOp,
  RevokeStipendOp,
  SeatEstateOp,
  ProposeMarriageOp,
  SetTollPolicyOp,
  SplitAssetOp,
  ConsumeAssetOp,
  DecideFateOp,
  RelocateAssetOp,
  TransferAssetOp,
  PlayNoteOp,
  CallObligationOp,
  RepudiateObligationOp,
  ReleaseObligationOp,
  PublishDossierOp,
  BlackmailOp,
  IssueUltimatumOp,
  BackUltimatumOp,
  ConcedeUltimatumOp,
  WithdrawUltimatumOp,
  PostBountyOp,
  WithdrawBountyOp,
  IssueOrderOp,
  CancelOrderOp,
  InterruptOrderOp,
  ExtendOrderOp,
  AccelerateOrderOp,
  FormTreatyOp,
  BreakTreatyOp,
  DeployAgentOp,
  RecruitAgentOp,
  RecallAgentOp,
  LayGroundworkOp,
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
  EstablishObligationOp,
  AssignObligationOp,
  RecruitCommanderOp,
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

/**
 * The path a batch came by. `source` says whether a model wrote it; this says
 * which writer, because a declared action, an NPC's reaction and a bot's turn
 * all arrive as `model` and are bounded very differently before they get here:
 * the player by the arbiter, the roll and two actions a turn, a bot by its
 * post-filters, and a reaction by nothing but the reducer
 * (`docs/design-2026-10-17-intent-ops.md` §7).
 */
export const OP_PATHS_LIST = ['declared', 'reaction', 'bot', 'accord', 'engine', 'cheat'] as const;
export type OpPath = (typeof OP_PATHS_LIST)[number];

const D = 'declared';
const R = 'reaction';
const B = 'bot';
const A = 'accord';
const E = 'engine';
/** What an NPC may do: everything the player may, less what only the arbiter bounds. */
const NPC = [R, B] as const;

/**
 * Which paths may write each op. Typed over every op name, so an op added later
 * does not compile until it is given its paths — the closed-allowlist argument
 * `EXTRACTION_ALLOWED` makes, of which this table's `accord` column is a copy
 * held equal by a test. A batch with no path (an old journal, a test building a
 * board) is checked against nothing here.
 *
 * Player only, never an NPC's reaction or a bot:
 * - `lay_groundwork`, whose whole price is the player's action point;
 * - `create_asset`, bounded by the arbiter's ruling and the roll;
 * - `set_doctrine`, since an NPC's doctrine is an authored character sheet.
 *
 * The engine alone: `adjust_dissent` (its own charges for a refusal, a breach,
 * an objection), the ship arithmetic and the reducer's own ops. `spawn_event`
 * is the engine's and a bot's rationale line.
 */
export const OP_PATHS: Record<Op['op'], readonly OpPath[]> = {
  transfer_control: [E],
  cheat: ['cheat'],
  log_ruling: [E],
  // Regard is written as `sway` (a declaration's influence payoff), `regard` (a
  // reaction's own view, for a listed reason) or `gift`; an accord still
  // narrates it (intent-ops §3).
  adjust_disposition: [A, E],
  sway: [D],
  regard: [R, E],
  gift: [D, R],
  adjust_fleet: [E],
  adjust_ships: [E],
  build_ships: [D, ...NPC, E],
  suborn_crews: [D, ...NPC, E],
  scuttle_ships: [D, ...NPC, E],
  // Money is written as `pay` or `spend` (intent-ops §2). An accord keeps it
  // only so accords journaled before that replay.
  adjust_credits: [A, E],
  pay: [D, ...NPC, A, E],
  spend: [D, ...NPC, E],
  set_doctrine: [D, E],
  create_asset: [D, A, E],
  set_stance: [D, ...NPC, E],
  grant_stipend: [D, ...NPC, E],
  revoke_stipend: [D, ...NPC, E],
  seat_estate: [D, ...NPC, E],
  propose_marriage: [D, ...NPC, E],
  set_toll_policy: [D, ...NPC, A, E],
  split_asset: [D, ...NPC, E],
  consume_asset: [D, ...NPC, A, E],
  decide_fate: [D, ...NPC, E],
  relocate_asset: [D, ...NPC, E],
  transfer_asset: [D, ...NPC, A, E],
  play_note: [D, ...NPC, E],
  call_obligation: [D, ...NPC, E],
  repudiate_obligation: [D, ...NPC, E],
  release_obligation: [D, ...NPC, A, E],
  publish_dossier: [D, ...NPC, E],
  blackmail: [D, ...NPC, E],
  issue_ultimatum: [D, ...NPC, E],
  back_ultimatum: [D, ...NPC, E],
  concede_ultimatum: [D, ...NPC, A, E],
  withdraw_ultimatum: [D, ...NPC, E],
  post_bounty: [D, ...NPC, E],
  withdraw_bounty: [D, ...NPC, E],
  // Work is written as its own op (`move`, `fortify`, …); the order is the engine's.
  issue_order: [E],
  move: [D, ...NPC, E],
  fortify: [D, ...NPC, E],
  raise_garrison: [D, ...NPC, E],
  develop: [D, ...NPC, E],
  found_fixture: [D, ...NPC, E],
  repair_fixture: [D, ...NPC, E],
  send_envoy: [D, ...NPC, E],
  blockade: [D, ...NPC, E],
  raid: [D, ...NPC, E],
  sweep: [D, ...NPC, E],
  cancel_order: [D, ...NPC, E],
  interrupt_order: [D, ...NPC, E],
  extend_order: [D, ...NPC, E],
  accelerate_order: [D, ...NPC, E],
  form_treaty: [A, E],
  break_treaty: [D, ...NPC, A, E],
  deploy_agent: [D, ...NPC, E],
  recruit_agent: [D, ...NPC, E],
  recall_agent: [D, ...NPC, E],
  lay_groundwork: [D],
  adjust_dissent: [E],
  establish_commitment: [D, ...NPC, A, E],
  dissolve_commitment: [D, ...NPC, A, E],
  establish_debt: [A, E],
  forgive_debt: [D, ...NPC, A, E],
  assign_debt: [A, E],
  restructure_debt: [A, E],
  settle_debt: [D, ...NPC, A, E],
  establish_loan: [A, E],
  return_loan: [D, ...NPC, A, E],
  repudiate_loan: [D, ...NPC, E],
  forgive_loan: [D, ...NPC, A, E],
  establish_obligation: [A, E],
  assign_obligation: [A, E],
  recruit_commander: [D, ...NPC, E],
  spawn_event: [B, A, E],
  log_narrative: [D, ...NPC, A, E],
};

/** Standard envelope for every model call that produces state change. */
export const ModelTurnOutputSchema = z.object({
  narrative: z.string().min(1),
  // Nothing to emit is an answer, not an omission.
  ops: z.array(ModelOpSchema).default([]),
});
export type ModelTurnOutput = z.infer<typeof ModelTurnOutputSchema>;

/** What `/endtalk` extraction returns: the ordinary vocabulary plus treaties. */
export const ExtractionOutputSchema = z.object({
  narrative: z.string().min(1),
  /**
   * Which recorded concessions the two powers actually agreed, each as
   * `by:kind`. The engine builds every transfer they name — a payment, a thing
   * handed over, a favour let go, a world ceded, a toll lifted — from the
   * record itself (`docs/design-2026-10-18-code-knows.md` §3). Deciding which
   * terms on the table were agreed is the judgement; the ids were settled when
   * each power wrote its concession down.
   */
  accepted: z.array(z.string().min(1)).default([]),
  // "Nothing was agreed" is the commonest honest outcome of a conversation.
  ops: z.array(ExtractionOpSchema).default([]),
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

/** A ruling that an act breaks one of the acting power's own principles — see `AppraisalSchema.breach`. */
export const BreachSchema = z
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
    });
export type Breach = z.infer<typeof BreachSchema>;

/**
 * What makes a DECLARED commitment more than a record, named by the arbiter
 * before the roll (intent-ops §5): an income per turn, or nothing beyond the
 * record. A declared commitment binds the actor alone, so a share of a lane flow
 * or a contingency — each needing two parties bound — is an accord's to write,
 * and a declaration that needs one is a negotiation. In the saved campaigns five
 * declared commitments carried an income nobody ruled (+20, +20, +25, −20, −25).
 */
export const COMMITMENT_MECHANISMS = ['income', 'record'] as const;
export const CommitmentMechanismSchema = z.enum(COMMITMENT_MECHANISMS);

/** A durable arrangement an act would create if it succeeds — see `AppraisalSchema.establishes`. */
export const EstablishesSchema = z
    .object({
      kind: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
      factionIds: z.array(z.string().min(1)).min(1).max(5),
      text: z.string().min(1).max(240),
      exclusive: z.boolean().default(false),
      /** What gives it force, if anything. `record` for the arrangement and nothing more. */
      mechanism: CommitmentMechanismSchema.default('record'),
    });

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
  /**
   * The price: which stat the attempt tests and how hard it is. **Only when a
   * roll will happen.** An inadmissible action is not attempted, an action
   * redirected to a conversation is not rolled, and an accord is never rolled
   * at all — and the schema used to demand a price for all three, so the model
   * either invented one or was sent back to. Measured on a traced playtest: 7 of
   * raw JSON's 8 arbiter retries, and 4 of the SDK's hidden ones, were an honest
   * `{ admissible: false, reason }` refused for lacking a stat. Required on the
   * declared path by `DeclaredAppraisalSchema` exactly when it will be used.
   */
  stat: StatNameSchema.optional(),
  difficulty: z.number().int().min(1).max(30).optional(),
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
  breach: BreachSchema.optional(),
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
        /**
         * The **person**, when the operation is aimed at one, written as the
         * player named them.
         *
         * A name, never an id. `Commander.name` stores the title baked in and a
         * player writes "Marcia Galba" or "M. Galba", so requiring an id here
         * would be asking a model to do a lookup — the half of the work it is
         * measurably worst at, and the reason `classifyPrinciple` exists.
         * `resolveCommander` does the matching in code.
         *
         * Without this the fallback routing built a `deploy_agent` with no
         * target at all, so an assassination the resolution call did not place
         * itself came out aimed at the power rather than at the officer the
         * player asked for.
         */
        target: absentWhenBlank(60),
        /**
         * How the player said it is done, scored on four axes of −1..+1 — see
         * `MethodProfileSchema`. Omitted when they described no method.
         */
        method: MethodSchema.optional(),
        /** The operative, by name, when the ruling named one. */
        agent: absentWhenBlank(60),
        /** A second outcome riding on the same order — see `RiderSchema`. */
        rider: RiderPartSchema.optional(),
      }),
    )
    .max(4)
    .optional(),
  /**
   * Preparation for a later act by the same operative — getting into
   * position, not acting. See `GroundworkSchema`.
   */
  groundwork: z
    .array(
      z.object({
        /** The operative, by name; omitted, the nearest awaiting orders. */
        agent: absentWhenBlank(60),
        systemId: z.string().min(1),
        text: z.string().min(1).max(160),
        axis: z.enum(METHOD_AXES),
        target: absentWhenBlank(80),
      }),
    )
    .max(2)
    .optional(),
  /**
   * An outcome the player asked for that no mission produces. Stated rather
   * than refused with an invented rule: the act is turned away without costing
   * an action, and the reason is kept so the next mission comes from play.
   */
  unexpressed: absentWhenBlank(240),
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
  establishes: EstablishesSchema.optional(),
  /** The prizes the overt part could yield, named before the roll. See `OvertPartSchema.yields`. */
  yields: z.array(z.string()).optional(),
  /**
   * Read off a `DeclaredRulingSchema` ruling: whether the act has an overt part
   * (which is rolled), which of the actor's operatives that part involves, and
   * the checkable ground a refusal cites. Absent on the old flat shape.
   */
  overt: z.boolean().optional(),
  involves: z.array(z.string()).optional(),
  ground: z.lazy(() => RefusalGroundSchema).optional(),
});
export type Appraisal = z.infer<typeof AppraisalSchema>;

/**
 * The arbiter's ruling on a DECLARED action: priced whenever a roll will follow.
 *
 * A roll follows an admissible action that is not a redirect to a conversation
 * and not covert work. Covert work is sent, not rolled: the operative's own
 * chance is rolled on the tick, so a price here would be a second roll. Anything
 * else carries no price, and asking for one is asking the model to invent a
 * number nothing reads. The accord path uses `AppraisalSchema` as it stands,
 * since an accord is never rolled.
 */
export const DeclaredAppraisalSchema = AppraisalSchema.superRefine((a, ctx) => {
  if (!a.admissible || a.negotiation) return;
  if ((a.covert?.length ?? 0) > 0 || (a.groundwork?.length ?? 0) > 0 || a.unexpressed) return;
  if (a.stat === undefined) {
    ctx.addIssue({ code: 'custom', path: ['stat'], message: 'An action that can be attempted needs the stat it tests.' });
  }
  if (a.difficulty === undefined) {
    ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'An action that can be attempted needs a difficulty.' });
  }
});

/* ------------------------------------------------------------------ */
/* The declared ruling — docs/design-2026-10-16-ruling-schema.md §1, §2 */
/* ------------------------------------------------------------------ */

/**
 * One part of an act, each a tagged choice, so the arbiter cannot leave a part
 * unclassified. The guards built on the old flat shape read fields the model
 * could simply omit — a retried ruling that dropped `covert` sent an
 * assassination down the rolled path (playtest 2026-10-16).
 */
export const OvertPartSchema = z.object({
  kind: z.literal('overt'),
  /** What this part does, in a clause. */
  what: z.string().min(1).max(240),
  stat: StatNameSchema,
  difficulty: z.number().int().min(1).max(30),
  rationale: z.string().default(''),
  /** The acting power's own operatives this part involves, by name. Usually none. */
  involves: z.array(z.string().min(1).max(60)).max(4).default([]),
  establishes: EstablishesSchema.optional(),
  /**
   * The kinds of thing this part could come away with if it works — `salvage`,
   * `prisoners`, `dossier` — named BEFORE the roll. A prize is minted only of a
   * kind named here, sized by the band; empty for nearly every act
   * (intent-ops §4).
   */
  yields: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(4).default([]),
});
export const CovertPartSchema = z.object({
  kind: z.literal('covert'),
  /** The operative, by name; omitted, the nearest one awaiting orders. */
  agent: absentWhenBlank(60),
  mission: AgentMissionSchema,
  systemId: z.string().min(1),
  target: absentWhenBlank(80),
  method: MethodSchema.optional(),
  /** A second outcome on the same order, at most one. */
  rider: RiderPartSchema.optional(),
});
export const GroundworkPartSchema = z.object({
  kind: z.literal('groundwork'),
  agent: absentWhenBlank(60),
  systemId: z.string().min(1),
  text: z.string().min(1).max(160),
  axis: z.enum(METHOD_AXES),
  target: absentWhenBlank(80),
});
export const UnexpressedPartSchema = z.object({
  kind: z.literal('unexpressed'),
  /** The outcome no mission produces, in one sentence. */
  outcome: z.string().min(1).max(240),
});
export const PartSchema = z.discriminatedUnion('kind', [
  OvertPartSchema,
  CovertPartSchema,
  GroundworkPartSchema,
  UnexpressedPartSchema,
]);
export type Part = z.infer<typeof PartSchema>;

/**
 * What a refusal stands on: a fact code can check on the board. There is no
 * ground for an operative's class, "there is no mechanic", or "that is not
 * yours to decide" — a ruling cannot cite them because the type has no slot.
 * See `checkGround`.
 */
export const RefusalGroundSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('no_such_entity'),
    /** The name looked for, as the player wrote it. */
    name: z.string().min(1).max(80),
    entity: z.enum(['person', 'world', 'thing', 'power']),
  }),
  z.object({
    kind: z.literal('not_present'),
    systemId: z.string().min(1),
    /** Whose presence is missing; omitted, the acting power's. */
    factionId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('not_held'),
    /** The thing, by name or id. */
    name: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('commitment_conflict'),
    /** The treaty or commitment that forecloses it, by id. */
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('already_so'),
    /** The record that already makes it true, by id. */
    ref: z.string().min(1),
  }),
]);
export type RefusalGround = z.infer<typeof RefusalGroundSchema>;

/**
 * The arbiter's ruling on a declared action: an act made of parts, a
 * conversation, or a refusal on a checkable ground.
 */
export const DeclaredRulingSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('act'),
      parts: z.array(PartSchema).min(1).max(6),
      breach: BreachSchema.optional(),
      /** A one-clause note on the ruling. */
      note: z.string().default(''),
    }),
    z.object({
      kind: z.literal('negotiation'),
      withFactionIds: z.array(z.string().min(1)).min(1).max(4),
      what: z.string().min(1).max(240),
      supported: z.boolean().default(true),
      breach: BreachSchema.optional(),
    }),
    z.object({
      kind: z.literal('inadmissible'),
      ground: RefusalGroundSchema,
      /** The sentence the player reads: what blocks it, and what they could do instead. */
      reason: z.string().min(1).max(400),
      breach: BreachSchema.optional(),
    }),
  ])
  .superRefine((r, ctx) => {
    if (r.kind !== 'act') return;
    if (r.parts.filter((p) => p.kind === 'overt').length > 1) {
      ctx.addIssue({ code: 'custom', path: ['parts'], message: 'An act has at most one overt part: its open work is one check.' });
    }
  });
export type DeclaredRuling = z.infer<typeof DeclaredRulingSchema>;

/**
 * A declared ruling as the engine reads it, in the flat shape the rest of
 * resolution was built on. Anything without a `kind` is already that shape (an
 * older caller, or a test scripting one) and passes through.
 */
export function rulingToAppraisal(value: unknown): Appraisal {
  const r = value as { kind?: unknown };
  if (!r || typeof r !== 'object' || typeof r.kind !== 'string') return value as Appraisal;
  const ruling = value as DeclaredRuling;
  if (ruling.kind === 'negotiation') {
    return {
      admissible: true,
      reason: '',
      rationale: '',
      negotiation: { withFactionIds: ruling.withFactionIds, what: ruling.what, supported: ruling.supported },
      ...(ruling.breach ? { breach: ruling.breach } : {}),
    } as Appraisal;
  }
  if (ruling.kind === 'inadmissible') {
    return {
      admissible: false,
      reason: ruling.reason,
      rationale: '',
      ground: ruling.ground,
      ...(ruling.breach ? { breach: ruling.breach } : {}),
    } as Appraisal;
  }
  const overt = ruling.parts.find((p): p is z.infer<typeof OvertPartSchema> => p.kind === 'overt');
  const covert = ruling.parts.filter((p): p is z.infer<typeof CovertPartSchema> => p.kind === 'covert');
  const groundwork = ruling.parts.filter((p): p is z.infer<typeof GroundworkPartSchema> => p.kind === 'groundwork');
  const unexpressed = ruling.parts.filter((p): p is z.infer<typeof UnexpressedPartSchema> => p.kind === 'unexpressed');
  return {
    admissible: true,
    reason: ruling.note,
    rationale: overt?.rationale ?? '',
    overt: overt !== undefined,
    ...(overt ? { stat: overt.stat, difficulty: overt.difficulty, involves: overt.involves } : {}),
    ...(overt?.establishes ? { establishes: overt.establishes } : {}),
    ...(overt?.yields && overt.yields.length > 0 ? { yields: overt.yields } : {}),
    ...(covert.length > 0
      ? {
          covert: covert.map((c) => ({
            mission: c.mission,
            systemId: c.systemId,
            ...(c.target ? { target: c.target } : {}),
            ...(c.method ? { method: c.method } : {}),
            ...(c.agent ? { agent: c.agent } : {}),
            ...(c.rider ? { rider: c.rider } : {}),
          })),
        }
      : {}),
    ...(groundwork.length > 0 ? { groundwork: groundwork.map(({ kind: _k, ...g }) => g) } : {}),
    ...(unexpressed.length > 0 ? { unexpressed: unexpressed.map((u) => u.outcome).join('; ') } : {}),
    ...(ruling.breach ? { breach: ruling.breach } : {}),
  } as Appraisal;
}

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
    .array(
      z.object({
        mission: AgentMissionSchema,
        systemId: z.string(),
        target: absentWhenBlank(60),
        method: MethodSchema.optional(),
      }),
    )
    .optional(),
  /** Set by the engine, never by the model: groundwork the arbiter ruled on. */
  groundwork: z
    .array(
      z.object({
        agent: absentWhenBlank(60),
        systemId: z.string(),
        text: z.string(),
        axis: z.enum(METHOD_AXES),
        target: absentWhenBlank(80),
      }),
    )
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

/**
 * A prose field that is trimmed rather than rejected when it runs long.
 *
 * A length cap on NARRATIVE is a readability rule, not a correctness one — so
 * paying a whole correction call to re-generate a sentence that was forty
 * characters over is the wrong trade. Under `outputFormat: json_schema` it
 * never came up, because constrained decoding enforced the cap while the model
 * wrote. Measured the moment structured output was taken away: three of three
 * reaction calls retried on exactly this, turning the fastest configuration
 * into the slowest.
 *
 * Trimmed at a sentence end where there is one in the last quarter, so the cut
 * reads as a full stop rather than a truncation.
 */
export function cappedProse(max: number) {
  return z
    .string()
    .min(1)
    .transform((t) => {
      if (t.length <= max) return t;
      const cut = t.slice(0, max);
      const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      return stop > max * 0.75 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1)}…`;
    });
}

export const ReactionSchema = z.object({
  factionId: z.string().min(1),
  /**
   * 1-3 sentences, and the cap is there because it was not being kept to.
   * Measured across a ten-turn campaign: a 546-character median against a
   * brief that asks for one to three sentences, with a longest of 847. Three
   * of these are generated a turn, so the overrun is paid three times.
   */
  narrative: cappedProse(420),
  // A power that chooses to wait sends nothing, and that is an answer.
  ops: z.array(ModelOpSchema).default([]),
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
      opening: z.string().max(400),
      /** What they want, in a few words, for the prompt to open with. */
      about: z.string().max(120),
    })
    .optional()
    // "No approach" arrives as empty strings as often as as nothing at all —
    // measured three times in one traced playtest. Blank means none.
    .transform((a) => (a && a.opening.trim() !== '' && a.about.trim() !== '' ? a : undefined)),
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
    | 'unknown_obligation'
    | 'unknown_demand'
    | 'unknown_bounty'
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
    | 'already_void'
    /**
     * A party is already bound by an exclusive treaty of that type to somebody
     * else. The treaty counterpart of `commitment_conflict`, and the answer to
     * the one thing a treaty could not previously say — see
     * `conflictingTreaty`. A renegotiation between the SAME parties is not this:
     * that supersedes.
     */
    | 'treaty_conflict'
    | 'wrong_path';
  message: string;
}

export function describeRejections(rejections: OpRejection[]): string {
  return rejections
    .map((r, i) => `${i + 1}. [${r.code}] ${r.message}\n   offending op: ${JSON.stringify(r.op)}`)
    .join('\n');
}
