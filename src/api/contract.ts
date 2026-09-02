import { z } from 'zod';
import { BattleReportSchema } from '../domain/battle.js';
import { CheckOutcomeSchema, StatNameSchema } from '../domain/checks.js';
import { EpilogueViewSchema } from '../engine/epilogue.js';
import { OrderRumourSchema } from '../domain/intel.js';
import { WorldStateSchema } from '../domain/state.js';

/**
 * The client/server contract, Zod-first.
 *
 * Schemas rather than hand-written interfaces, for the same reason the game
 * state is Zod-first: there is then exactly ONE definition of every message.
 * The server validates real input against it (a browser is untrusted input like
 * any other), the client infers its types from it, and the two cannot drift —
 * a mismatch becomes a type error rather than a runtime surprise in a request
 * body.
 *
 * Domain schemas are imported, never restated. If `WorldState` gains a field,
 * it appears here automatically.
 */

/* ------------------------------------------------------------------ */
/* Shared fragments                                                     */
/* ------------------------------------------------------------------ */

export const OpRejectionSchema = z.object({
  code: z.string(),
  message: z.string(),
  op: z.unknown(),
});

export const CheckResultSchema = z.object({
  stat: StatNameSchema,
  roll: z.number().int(),
  modifier: z.number().int(),
  total: z.number().int(),
  difficulty: z.number().int(),
  outcome: CheckOutcomeSchema,
  margin: z.number().int(),
});

export const LedgerSchema = z.object({
  gross: z.number().int(),
  upkeep: z.number().int(),
  net: z.number().int(),
  systems: z.number().int(),
  treatyFlow: z.number().int(),
  espionageLoss: z.number().int(),
  /** What this faction's own live operatives cost it per turn. */
  agentUpkeep: z.number().int(),
  /** Standing arrangements: positive receives, negative pays. */
  commitmentFlow: z.number().int(),
  /** A profiteer's take from other powers' wars, or what its own cost it. */
  warProfit: z.number().int(),
  /** What a faction's own worlds pay it. */
  territory: z.number().int(),
  /** What the lane network pays it, after tolls levied and raids suffered. */
  routes: z.number().int(),
  tolls: z.number().int(),
  raided: z.number().int(),
  /**
   * Scheduled debt service: positive receives, negative pays. Deliberately not
   * part of `net` — a debt is settled as a transfer during the tick, because a
   * rate cannot know whether the debtor could afford it.
   */
  debtService: z.number().int(),
});

export const BriefingProjectSchema = z.object({
  id: z.string(),
  label: z.string(),
  where: z.string(),
  factionId: z.string(),
  factionName: z.string(),
  color: z.number().int(),
  progress: z.number().int(),
  duration: z.number().int(),
  remaining: z.number().int(),
  completesNextTurn: z.boolean(),
  isMovement: z.boolean(),
});

/**
 * A rival programme known to exist and nothing more — see `domain/intel.ts`.
 * No label, no type and no order id: a rumour names a place worth watching,
 * and shipping the id would let the player interrupt work they cannot see.
 */
export const BriefingRumourSchema = z.object({
  where: z.string(),
  factionId: z.string(),
  factionName: z.string(),
  color: z.number().int(),
  progress: z.number().int(),
  duration: z.number().int(),
  remaining: z.number().int(),
  completesNextTurn: z.boolean(),
});

/** One of the player's own operatives, and what it can see. */
export const BriefingWatchSchema = z.object({
  where: z.string(),
  systemId: z.string(),
  mission: z.string(),
  effect: z.string(),
  successChance: z.number().int(),
  sees: z.array(z.string()),
});

export const BriefingCompletionSchema = z.object({
  label: z.string(),
  where: z.string(),
  outcome: z.string(),
  factionId: z.string(),
  factionName: z.string(),
  color: z.number().int(),
  mine: z.boolean(),
});

export const BriefingSchema = z.object({
  turn: z.number().int(),
  treasury: z.number().int(),
  ledger: LedgerSchema,
  completed: z.array(BriefingCompletionSchema),
  inProgress: z.array(BriefingProjectSchema),
  observed: z.array(BriefingProjectSchema),
  /** Work you know is happening and cannot identify. */
  rumoured: z.array(BriefingRumourSchema),
  /** Your operatives, and what each of them has to say. */
  watch: z.array(BriefingWatchSchema),
  /** Battles fought this turn, with the arithmetic that decided them. */
  battles: z.array(BattleReportSchema),
  quiet: z.boolean(),
});

/** A declared-but-not-landed action, shown so staging is visible. */
export const StagedItemSchema = z.object({
  index: z.number().int().min(0),
  label: z.string(),
  narrative: z.string(),
});

export const ReactionViewSchema = z.object({
  factionId: z.string(),
  factionName: z.string(),
  color: z.number().int(),
  narrative: z.string(),
  /**
   * This power is asking to talk. An invitation the player may take up by
   * opening a channel — never a channel opened on their behalf, because a
   * channel disables the command line and End Turn.
   */
  approach: z
    .object({ opening: z.string(), about: z.string() })
    .nullable()
    .default(null),
});

export const ChatMessageSchema = z.object({
  speaker: z.enum(['player', 'faction']),
  text: z.string(),
});

/* ------------------------------------------------------------------ */
/* Responses                                                            */
/* ------------------------------------------------------------------ */

/** Everything the client needs to draw the whole game. */
export const CampaignViewSchema = z.object({
  /**
   * The world **as the player sees it**: `pendingOrders` carries only the work
   * they can actually observe, so everything the client derives from it — the
   * map's in-transit fleets, the orders panel, a system's activity — narrows
   * with it rather than each component having to remember to filter.
   *
   * The server serves a redacted view rather than the campaign's own state.
   * See `domain/intel.ts` for what that costs: a rival's fleet total reads low
   * by whatever it has under way in secret, which is the fog working and must
   * be labelled as partial rather than presented as a count.
   */
  state: WorldStateSchema,
  /** Rival work known to exist and not identifiable. Never carries an order id. */
  rumours: z.array(OrderRumourSchema),
  staged: z.array(StagedItemSchema),
  /** Null before the first turn has been ended. */
  briefing: BriefingSchema.nullable(),
  /** Faction id of an open diplomatic channel, if any. */
  openChannel: z.string().nullable(),
  channelHistory: z.array(ChatMessageSchema),
  /**
   * Actions left this turn, and the allowance. Not part of `WorldState`: this
   * is a pacing rule about the player's turn, not a fact about the galaxy.
   */
  actionPoints: z.object({ left: z.number().int().min(0), perTurn: z.number().int().min(1) }),
  name: z.string(),
  /** Turns this campaign runs for, or null for one with no ending. */
  maxTurns: z.number().int().nullable(),
  /** Set once time has run out. While it is present the campaign is read-only. */
  epilogue: EpilogueViewSchema.nullable(),
});
export type CampaignView = z.infer<typeof CampaignViewSchema>;
export { EpilogueViewSchema };
export type { EpilogueView } from '../engine/epilogue.js';

/**
 * How many messages the player may send in one diplomatic channel.
 *
 * Diplomacy is deliberately unmetered by action points — a channel already
 * blocks the command line and End Turn, which is its own pacing — but
 * "unmetered" turned out to mean "unbounded", and an unbounded channel is a
 * hazard rather than a freedom. Every message re-sends the whole transcript
 * plus the persona (the Legate's voice alone is ~14k characters), so cost per
 * reply climbs with the length of the conversation, and the transcript the
 * extraction pass must read afterwards grows with it.
 *
 * Ten is chosen to sit well clear of any real negotiation: the live ones run
 * three or four exchanges, and the longest deliberately padded test reached
 * seven before it had plainly stopped going anywhere. This is a guard rail for
 * the accident — a player who keeps typing into a conversation that has
 * finished — not a budget anyone should feel.
 *
 * Counted in PLAYER messages, not entries, so it reads the way the player
 * experiences it: the faction's replies are not the player's to ration.
 */
export const MAX_CHANNEL_MESSAGES = 10;

/** Your own faction declining to carry out the order. */
export const RefusalViewSchema = z.object({
  by: z.string(),
  reason: z.string(),
  violated: z.string(),
});

export const ActionOutcomeSchema = z.object({
  narrative: z.string(),
  refusal: RefusalViewSchema.nullable().default(null),
  /**
   * The institutions objected and carried the order out anyway — a compulsion
   * defied rather than a red line crossed. Distinct from `refusal`, where
   * nothing happens at all.
   */
  defiance: RefusalViewSchema.nullable().default(null),
  /**
   * The action needs another power's agreement, so it was not rolled for and
   * nothing was staged. A treaty binds someone who is not the actor, and the
   * only place consent exists in this game is a transcript — so the arbiter
   * points at the channel instead of pricing a roll for someone else's assent.
   */
  negotiation: z
    .object({
      withFactionIds: z.array(z.string()),
      what: z.string(),
      supported: z.boolean(),
      channels: z.string(),
    })
    .nullable()
    .default(null),
  /**
   * The arbiter ruled the action cannot be attempted at all. The world does not
   * permit it — distinct from permitting it and having it fail. Carries the
   * arbiter's reason.
   */
  inadmissible: z.string().nullable().default(null),
  /**
   * The turn's actions are spent. The one non-outcome that is about the
   * player's turn rather than the world, which is why it carries the allowance
   * rather than a reason.
   */
  outOfActions: z.object({ perTurn: z.number().int().min(1) }).nullable().default(null),
  staged: z.number().int(),
  notes: z.array(z.string()),
  rejections: z.array(OpRejectionSchema),
  check: CheckResultSchema.nullable(),
  costUsd: z.number(),
  /**
   * The ops this declaration actually staged, as applied.
   *
   * Returned because the highest-value bug class in this project is a narrative
   * that claims something the ops do not do — a battle resolved in prose, an
   * agent owned by its own victim, a doctrine retirement announced with an empty
   * `retire`. Every one of those was found by reading the on-disk journal,
   * because this response used to carry narrative, check and counts only. They
   * are already in memory; withholding them only made the game harder to test
   * than to play.
   */
  ops: z.array(z.unknown()),
});
export type ActionOutcomeResponse = z.infer<typeof ActionOutcomeSchema>;

export const TurnOutcomeSchema = z.object({
  applied: z.number().int(),
  reactions: z.array(ReactionViewSchema),
  notes: z.array(z.string()),
  rejections: z.array(OpRejectionSchema),
  briefing: BriefingSchema,
  costUsd: z.number(),
});
export type TurnOutcomeResponse = z.infer<typeof TurnOutcomeSchema>;

export const PlayableFactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().int(),
  doctrine: z.string(),
});

export const FactionListSchema = z.object({
  factions: z.array(PlayableFactionSchema),
  /** Saved campaigns available to resume. */
  saves: z.array(z.string()),
});

export const ChatReplySchema = z.object({ reply: z.string(), costUsd: z.number() });

export const OkSchema = z.object({ ok: z.literal(true) });

/** Errors are structured, never bare strings, so the client can branch. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'bad_request',
      'not_found',
      'conflict',
      'no_campaign',
      'model_error',
      'not_authenticated',
      'internal',
    ]),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Requests                                                             */
/* ------------------------------------------------------------------ */

export const NewCampaignRequestSchema = z.object({
  factionId: z.string().min(1),
  name: z.string().regex(/^[\w.-]+$/).default('campaign'),
  /**
   * How many turns the campaign runs before it ends.
   *
   * Bounded at both ends on purpose: below 10 there is not enough time for a
   * multi-turn programme to land, and past 100 the ending stops being a
   * horizon the player can plan against. Omit for a campaign with no ending,
   * which is what every campaign was before this existed.
   */
  maxTurns: z.number().int().min(10).max(100).optional(),
});

export const ActionRequestSchema = z.object({
  text: z.string().min(1).max(2000),
});

export const TalkRequestSchema = z.object({
  text: z.string().min(1).max(2000),
});

/** Omit `index` to clear everything; supply it to drop one declaration. */
export const DiscardRequestSchema = z.object({
  index: z.number().int().min(0).optional(),
});

export const ResumeRequestSchema = z.object({
  name: z.string().regex(/^[\w.-]+$/),
});

/**
 * An uploaded campaign archive, base64 in JSON.
 *
 * Base64 rather than multipart: it keeps every request on this API a single
 * Zod-validated JSON body, and archives are a few KB — a journal is extremely
 * repetitive and gzips hard. The 8 MB cap is far above any real campaign and
 * exists so a stray file cannot be buffered into memory.
 */
export const ImportRequestSchema = z.object({
  archiveBase64: z.string().min(1).max(8 * 1024 * 1024),
  /** Save it under a different name; defaults to the name in the manifest. */
  name: z.string().regex(/^[\w.-]+$/).optional(),
});

/** What an archive turned out to contain, reported after it is verified. */
export const ImportOutcomeSchema = z.object({
  name: z.string(),
  turn: z.number().int(),
  playerFactionId: z.string(),
  exportedAt: z.string(),
  journalEntries: z.number().int(),
  view: CampaignViewSchema,
});
export type ImportOutcome = z.infer<typeof ImportOutcomeSchema>;

/* ------------------------------------------------------------------ */
/* Server-sent events                                                   */
/* ------------------------------------------------------------------ */

/**
 * Model calls take 5–15 seconds. Without progress the browser looks broken
 * while working perfectly, so the server narrates what it is doing.
 */
export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), label: z.string(), busy: z.boolean() }),
  z.object({ type: z.literal('state'), view: CampaignViewSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('hello'), turn: z.number().int() }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

/** Single source of truth for paths, so client and server cannot disagree. */
export const ROUTES = {
  campaign: '/api/campaign',
  newCampaign: '/api/campaign/new',
  resume: '/api/campaign/resume',
  exportCampaign: '/api/campaign/export',
  importCampaign: '/api/campaign/import',
  factions: '/api/factions',
  action: '/api/action',
  endturn: '/api/endturn',
  discardStaged: '/api/staged/discard',
  talk: (factionId: string) => `/api/talk/${factionId}`,
  endtalk: (factionId: string) => `/api/endtalk/${factionId}`,
  events: '/api/events',
} as const;

export const DEFAULT_PORT = 4173;
