/**
 * Model tiering lives here and nowhere else. Changing which model handles
 * resolution, reaction, diplomacy or flavour is a one-line edit in this file.
 */

export type ModelTier = 'reasoning' | 'flavor';

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
  reaction: 'reasoning',
  diplomacy: 'reasoning',
  extraction: 'reasoning',
  // A yes/no about whether two sentences are about the same thing. Cheap tier,
  // and it only runs when a breach was actually named.
  breach_relevance: 'flavor',
  // Once per campaign, and it is the last thing the player reads. The one call
  // where paying for the better tier is unarguable.
  epilogue: 'reasoning',
  flavor: 'flavor',
};

export function modelFor(kind: CallKind): TierConfig {
  return TIERS[ROUTES[kind]];
}
