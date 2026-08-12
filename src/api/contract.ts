import { z } from 'zod';
import { CheckOutcomeSchema, StatNameSchema } from '../domain/checks.js';
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
  /** What a faction's own worlds pay it. */
  territory: z.number().int(),
  /** What the lane network pays it, after tolls levied and raids suffered. */
  routes: z.number().int(),
  tolls: z.number().int(),
  raided: z.number().int(),
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
  state: WorldStateSchema,
  staged: z.array(StagedItemSchema),
  /** Null before the first turn has been ended. */
  briefing: BriefingSchema.nullable(),
  /** Faction id of an open diplomatic channel, if any. */
  openChannel: z.string().nullable(),
  channelHistory: z.array(ChatMessageSchema),
  name: z.string(),
});
export type CampaignView = z.infer<typeof CampaignViewSchema>;

/** Your own faction declining to carry out the order. */
export const RefusalViewSchema = z.object({
  by: z.string(),
  reason: z.string(),
  violated: z.string(),
});

export const ActionOutcomeSchema = z.object({
  narrative: z.string(),
  refusal: RefusalViewSchema.nullable().default(null),
  staged: z.number().int(),
  notes: z.array(z.string()),
  rejections: z.array(OpRejectionSchema),
  check: CheckResultSchema.nullable(),
  costUsd: z.number(),
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
