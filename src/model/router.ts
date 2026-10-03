/**
 * Model tiering lives here and nowhere else. Changing which model handles
 * resolution, reaction, diplomacy or flavour is a one-line edit in this file —
 * for every provider: `ROUTES` maps calls to tiers once, and each provider has
 * its tier table beside the others (`TIERS` for the subscription's Agent SDK,
 * `API_TIERS` and `OPENROUTER_TIERS` for the keyed providers).
 */

export type ModelTier = 'reasoning' | 'narrative' | 'flavor';

export type CallKind =
  | 'resolution'
  | 'reaction'
  | 'diplomacy'
  | 'extraction'
  | 'appraisal'
  /**
   * The second opinion on whether a quoted principle is about the act at hand.
   * Its own kind rather than `flavor` so it can be tiered independently — and
   * so a test scripting colour text cannot accidentally answer it.
   */
  | 'breach_relevance'
  /**
   * The narrator that closes a campaign. Its own kind because it runs exactly
   * once, is the longest single piece of prose the game produces, and is the
   * one call whose failure must never reach the player — see
   * `fallbackEpilogue`.
   */
  | 'epilogue'
  /**
   * The counsellor at the leader's shoulder.
   *
   * Its own kind so it can be re-tiered in one line, which is the argument for
   * every entry on this list. It sits on the **reasoning** tier because the job
   * is a judgement about a whole board rather than a bounded classification
   * against a rubric — and because it costs the player an action point, which
   * is the design's own answer to it being expensive: advice that were free
   * would be a solved-once optimum every player opens every turn.
   */
  | 'advisor'
  /**
   * The line a random event (item 124) is dressed in for the player. Its own
   * kind so it can be re-tiered in one line, and so a test scripting any other
   * call cannot answer it by accident.
   */
  | 'event_flavour'
  | 'flavor';

export interface TierConfig {
  model: string;
  /**
   * Agentic round trips allowed per call.
   *
   * NOT 1, despite these being single-shot JSON calls. Under
   * `outputFormat: json_schema` the SDK delivers the result through an
   * end-turn tool — a tool_use/tool_result carrier — which costs a round trip
   * of its own. With a budget of 1, any preamble the model writes before the
   * carrier exhausts it and the call dies with "Reached maximum number of
   * turns (1)", which showed up constantly mid-diplomacy.
   *
   * There is no risk of a runaway loop: `tools: []` means no real tools exist,
   * so the only turns available are the model's own output and the carrier.
   */
  maxTurns: number;
  /**
   * How hard the model thinks before answering. The SDK defaults to `'high'`,
   * which is deep reasoning — appropriate for open-ended agentic work and
   * badly mismatched to what this game asks for. Every call here is a single
   * bounded judgement against a state document, and measured live the default
   * was costing roughly half the latency for no visible quality gain.
   */
  effort: 'low' | 'medium' | 'high';
  /**
   * Extended thinking. Measured live, this was the single biggest cost in the
   * game: arbitration was emitting ~2,700 output tokens of thinking to return
   * two numbers and a clause, and took 37 seconds doing it. Turning it off
   * took the same call to 11s and ~670 tokens with no change in its rulings.
   *
   * Left ON for the reasoning tier, where the output is a narrative that has
   * to stay consistent with a settled outcome and a dozen mechanics.
   */
  thinking?: { type: 'disabled' };
}

export const TIERS: Record<ModelTier, TierConfig> = {
  // Judgement calls: what an action does, how factions respond, what a
  // transcript actually committed anyone to.
  // Narrative and ops: real judgement, but a bounded one against a state
  // document that already tells it the outcome.
  reasoning: { model: 'claude-sonnet-5', maxTurns: 6, effort: 'medium' },
  /**
   * The same model, thinking less hard.
   *
   * Measured: the whole reasoning tier at `low` took a turn from ~118s to
   * ~72s, with resolution going 30.6s -> 7.0s and each reaction 24.3s -> 13.7s
   * — and on that sample there were no rejections, the check and the ops were
   * sound, and the prose stayed in voice. The bulk of what these calls
   * generate is thinking, not narrative, which is why effort moves them and
   * capping their prose barely does.
   *
   * It is a tier rather than a blanket change because the exposure is not the
   * same everywhere. A reaction is narrative plus a modest op or two, and
   * three of them run every turn — most of the saving, on the calls that can
   * afford it. Resolution decides what the player's own action actually did,
   * and extraction decides what a negotiation bound anybody to; those keep
   * `medium`, where a worse judgement is a worse world rather than a flatter
   * sentence.
   *
   * **And with thinking off**, measured the same way one step further: the
   * same three turns replayed from a saved campaign, the same three powers,
   * two samples of nine reactions per setting.
   *
   * |                                  | medium | low      | low, no thinking |
   * |----------------------------------|--------|----------|------------------|
   * | reaction, median                 | 24.6s  | 12.6-16s | 7-9s             |
   * | end of turn waits on the slowest | 40-123s| 16-76s   | 9-13s            |
   * | effect ops written (18 reactions)| —      | 26       | 24               |
   * | reactions that only talked       | —      | 5        | 4                |
   *
   * The NPCs act as often and stay in voice; what goes is the tail, because
   * end of turn waits for the slowest of three and the slow ones were thinking.
   * Medium did not buy judgement either — it wrote more ops and had half of
   * them rejected (a sale the buyer never agreed to, a battle's outcome written
   * in as a payload). Untested: a turn where the player attacks someone, which
   * is where a power that thought less would show it.
   *
   * It also stops a transport quirk: with thinking on, the model kept nesting
   * its answer under the SDK's own `StructuredOutput` key, which the SDK
   * rejects and retries — 4 of 9 reactions paid a round trip for it.
   */
  narrative: { model: 'claude-sonnet-5', maxTurns: 6, effort: 'low', thinking: { type: 'disabled' } },
  // Colour that must be cheap and fast: system descriptions, NPC names.
  // Classification and colour. Arbitration lives here too: it returns two
  // numbers and a clause, which is not a thinking problem.
  flavor: {
    model: 'claude-haiku-4-5-20251001',
    maxTurns: 4,
    effort: 'low',
    thinking: { type: 'disabled' },
  },
};

export const ROUTES: Record<CallKind, ModelTier> = {
  resolution: 'reasoning',
  // Pricing an action is a small, bounded judgement — two numbers and a
  // clause — so it does not need the reasoning tier. Splitting it out costs
  // about a tenth of a cent and is what makes the roll honest.
  appraisal: 'flavor',
  reaction: 'narrative',
  diplomacy: 'reasoning',
  extraction: 'reasoning',
  // A yes/no about whether two sentences are about the same thing. Cheap tier,
  // and it only runs when a breach was actually named.
  breach_relevance: 'flavor',
  // Once per campaign, and it is the last thing the player reads. The one call
  // where paying for the better tier is unarguable.
  epilogue: 'reasoning',
  // Moved down from `reasoning`, and the original argument is what moves it.
  // Thinking was kept on that tier for "a narrative that has to stay consistent
  // with a settled outcome and a dozen mechanics" — and the advisor has no
  // settled outcome to be consistent with. It reads a board and says what is
  // pressing, which is a judgement the voice sheet does most of the work for.
  // Measured: 21s on the reasoning tier for counsel the player said was too
  // long to read.
  advisor: 'flavor',
  // One sentence of colour over a fact already decided. The cheap tier, and
  // it never blocks the turn — see `GameSession.dressEvents`.
  event_flavour: 'flavor',
  flavor: 'flavor',
};

/** The subscription provider's tier for a call: the SDK table above. */
export function modelFor(kind: CallKind): TierConfig {
  return TIERS[ROUTES[kind]];
}

/* ------------------------------------------------------------------ */
/* The keyed providers                                                  */
/* ------------------------------------------------------------------ */

/**
 * One tier on a provider that is called over HTTP rather than through the
 * Agent SDK. `TierConfig` above mixes the one field every provider shares
 * (`model`) with three that exist only because the SDK runs an agentic loop
 * (`maxTurns`) or shapes its own request (`effort`, `thinking`); this is the
 * shared part plus what an HTTP request needs instead.
 *
 * The same three tiers, the same `ROUTES` — so which call goes where is decided
 * once, above, for every provider.
 */
export interface ApiTierConfig {
  model: string;
  /** A ceiling, not a target: the longest reply in the game is the epilogue. */
  maxTokens: number;
  /**
   * `output_config.effort`. Absent where the model rejects it: the API returns
   * an error for `effort` on Haiku 4.5, which the flavour tier's `effort: 'low'`
   * in the SDK table would have sent verbatim (docs/architecture.md A.1).
   */
  effort?: 'low' | 'medium' | 'high';
  /**
   * `'disabled'` sends `thinking: {type: 'disabled'}`. Absent means the
   * model's default — adaptive on Sonnet 5, none on Haiku 4.5, whose disabled
   * form is to omit the parameter. `budget_tokens` is never sent: it is a 400
   * on Sonnet 5.
   */
  thinking?: 'disabled';
}

/**
 * The Anthropic API. Each line is the SDK table's line said in the API's terms.
 * `claude-haiku-4-5` carries no date suffix: the dated id the SDK table uses is
 * an alias the binary resolves, and the current API id is the bare one.
 */
export const API_TIERS: Record<ModelTier, ApiTierConfig> = {
  reasoning: { model: 'claude-sonnet-5', maxTokens: 16_000, effort: 'medium' },
  narrative: { model: 'claude-sonnet-5', maxTokens: 8_000, effort: 'low', thinking: 'disabled' },
  flavor: { model: 'claude-haiku-4-5', maxTokens: 4_000 },
};

/**
 * OpenRouter. The same models under OpenRouter's slugs, checked against its
 * live catalogue (`GET /api/v1/models`, 2026-10-03): `anthropic/claude-sonnet-5`
 * and `anthropic/claude-haiku-4.5`, which takes no `reasoning_effort`.
 *
 * Defaulting to the models this game's prompts were developed against is
 * deliberate — a bug on these is a bug rather than a model difference. Routing
 * a tier somewhere cheaper is what the settings screen's model fields are for.
 */
export const OPENROUTER_TIERS: Record<ModelTier, ApiTierConfig> = {
  reasoning: { model: 'anthropic/claude-sonnet-5', maxTokens: 16_000, effort: 'medium' },
  narrative: { model: 'anthropic/claude-sonnet-5', maxTokens: 8_000, effort: 'low', thinking: 'disabled' },
  flavor: { model: 'anthropic/claude-haiku-4.5', maxTokens: 4_000 },
};

export const API_TIER_TABLES = { anthropic: API_TIERS, openrouter: OPENROUTER_TIERS } as const;

/**
 * The tier a keyed provider uses for a call, with the player's model override
 * applied. An override replaces only the model: effort and thinking stay as the
 * table says, except that a model the table did not choose is not assumed to
 * accept either, since what Sonnet 5 accepts says nothing about what a model
 * routed in its place will.
 */
export function apiTierFor(
  provider: keyof typeof API_TIER_TABLES,
  kind: CallKind,
  overrides: Partial<Record<ModelTier, string>> = {},
): ApiTierConfig & { tier: ModelTier } {
  const tier = ROUTES[kind];
  const base = API_TIER_TABLES[provider][tier];
  const model = overrides[tier];
  if (!model || model === base.model) return { ...base, tier };
  return { model, maxTokens: base.maxTokens, tier };
}
