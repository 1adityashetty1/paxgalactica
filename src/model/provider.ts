import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { buildAuthEnv } from './auth.js';
import { ModelCallError, NotLoggedInError } from './errors.js';
import { costFor } from './pricing.js';
import { apiTierFor, modelFor, type ApiTierConfig, type CallKind } from './router.js';
import {
  chosenProvider,
  readSettings,
  resolveKey,
  type KeyedProvider,
  type ProviderId,
  type Settings,
} from './settings.js';

/**
 * The provider seam (docs/architecture.md A.1).
 *
 * Every model call used to reach Anthropic through one function that spawned
 * the bundled Claude Code binary under subscription auth, so the cost of
 * playing — and, more to the point, of TESTING — was denominated in Claude
 * subscription usage and nothing else. This interface is that function's
 * signature with the binary taken out of it.
 *
 * What a provider does: send one system prompt and one user message, return
 * what the model wrote and what it cost, and fill in whatever it learned about
 * the attempt. What it does not do is everything above that line — the retry
 * budget, the Zod re-validation, the correction prompt, `stats`, the trace —
 * which stays in `callStructured`, single-sited, and identical whoever answers.
 *
 * Replay is untouched: the journal records ops, not reasoning, so a campaign
 * played against any provider replays byte-identically.
 */

export interface ProviderRequest {
  kind: CallKind;
  /** Already carrying the inline schema when `rawJson` is on — see `callStructured`. */
  system: string;
  user: string;
  /** The schema, for a provider that can enforce it while the model writes. */
  jsonSchema: Record<string, unknown>;
  rawJson: boolean;
}

export interface ProviderReply {
  /** Whatever the model produced, unvalidated. A string, or an object under structured output. */
  result: unknown;
  costUsd: number;
}

/**
 * What the provider reported about one attempt. Filled in place rather than
 * returned, so an attempt that ends in an error still reports what it cost and
 * how long the API took — which is exactly the attempt worth seeing.
 */
export interface AttemptMetrics {
  apiMs?: number;
  ttftMs?: number;
  spawnMs?: number;
  numTurns?: number;
  inTok?: number;
  outTok?: number;
  cacheReadTok?: number;
  cacheWriteTok?: number;
  costUsd?: number;
  sdkRejections?: string[];
  sdkRejectedKeys?: string[];
  /** The model id asked for, for the trace. */
  model?: string;
}

export interface Provider {
  readonly id: ProviderId;
  call(request: ProviderRequest, metrics: AttemptMetrics): Promise<ProviderReply>;
}

/**
 * How long one attempt may wait before it is abandoned.
 *
 * The SDK's `query()` has no timeout of its own: if the spawned binary hangs —
 * a dropped stream, a wedged child process — the await never settles and the
 * turn waits forever. Measured in the playtest of 2026-09-09: one declared
 * action sat for **923 seconds** and returned no response at all, and a second
 * took 117s while costing $0.10, which is a tenth of the money for four times
 * the time and therefore not generation. Both killed the agent driving the
 * campaign.
 *
 * 180s against measured medians of 15s (appraisal), 24s (resolution) and 30s
 * (reaction) — six times the slowest legitimate call, so a timeout means
 * something is wrong rather than something is slow. Abandoning is safe because
 * `callStructured` treats it as any other transient failure and retries.
 *
 * Per MESSAGE on the subscription path, which streams; per request on the HTTP
 * providers, which do not.
 */
export const CALL_TIMEOUT_MS = 180_000;

/** The one wording `callStructured` reads a timeout by. */
function silentFor(ms: number): ModelCallError {
  return new ModelCallError(`the call went silent for ${ms / 1000}s and was abandoned`, 1);
}

/* ------------------------------------------------------------------ */
/* The subscription: the Agent SDK and its bundled binary               */
/* ------------------------------------------------------------------ */

/** How much of a rejection the trace keeps. */
const MAX_SDK_REJECTIONS = 8;
const MAX_SDK_REJECTION_CHARS = 400;

/** The top-level keys of the last StructuredOutput the model sent, or '' before one. */
function structuredOutputKeys(message: Record<string, unknown>): string | undefined {
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content as Record<string, unknown>[]) {
    if (block?.type !== 'tool_use' || block.name !== 'StructuredOutput') continue;
    const input = block.input;
    return input && typeof input === 'object' ? Object.keys(input).join(',').slice(0, 120) : typeof input;
  }
  return undefined;
}

/**
 * Collect the schema rejections the SDK fed back to the model mid-attempt.
 *
 * They arrive as `user` messages carrying a `tool_result` with `is_error` —
 * the reply to the model's StructuredOutput call — and are otherwise consumed
 * by the SDK's own loop. Checked live: a forced miss produced
 * `Output does not match required schema: /x: must be >= 1000, /word: must
 * match pattern "^[a-z]{41}$"`, then a second try in the same attempt.
 */
function noteSdkRejections(message: Record<string, unknown>, out: AttemptMetrics, sentKeys: string): void {
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as Record<string, unknown>[]) {
    if (block?.type !== 'tool_result' || block.is_error !== true) continue;
    const raw = block.content;
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map((c) => (typeof (c as { text?: unknown })?.text === 'string' ? (c as { text: string }).text : '')).join(' ')
          : '';
    const list = (out.sdkRejections ??= []);
    if (list.length < MAX_SDK_REJECTIONS) {
      list.push(text.replace(/^Output does not match required schema:\s*/i, '').trim().slice(0, MAX_SDK_REJECTION_CHARS));
      (out.sdkRejectedKeys ??= []).push(sentKeys);
    }
  }
}

/**
 * Pull timings and token counts off an SDK result message. Every field is
 * optional in the SDK's own type or absent on some result subtypes — an error
 * result carries no time-to-first-token — so each is copied only when present,
 * and a record never states a zero it was not told.
 */
function readResultMetrics(message: Record<string, unknown>, out: AttemptMetrics): void {
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const set = <K extends 'apiMs' | 'ttftMs' | 'spawnMs' | 'numTurns' | 'costUsd'>(k: K, v: number | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('apiMs', num(message.duration_api_ms));
  set('ttftMs', num(message.ttft_ms));
  set('spawnMs', num(message.time_to_request_from_spawn_ms));
  set('numTurns', num(message.num_turns));
  set('costUsd', num(message.total_cost_usd));
  // `modelUsage` covers every model the call touched and is what the SDK says
  // to account from; `usage` is the main loop only.
  const perModel = message.modelUsage;
  if (perModel && typeof perModel === 'object') {
    let inTok = 0, outTok = 0, read = 0, write = 0, seen = false;
    for (const u of Object.values(perModel as Record<string, Record<string, unknown>>)) {
      seen = true;
      inTok += num(u.inputTokens) ?? 0;
      outTok += num(u.outputTokens) ?? 0;
      read += num(u.cacheReadInputTokens) ?? 0;
      write += num(u.cacheCreationInputTokens) ?? 0;
    }
    if (seen) {
      out.inTok = inTok;
      out.outTok = outTok;
      out.cacheReadTok = read;
      out.cacheWriteTok = write;
    }
  }
}

export const subscriptionProvider: Provider = {
  id: 'subscription',
  async call({ kind, system, user, jsonSchema, rawJson }, metrics) {
    const tier = modelFor(kind);
    metrics.model = tier.model;
    let result: unknown;
    let costUsd = 0;
    let errorText: string | undefined;

    const q = query({
      prompt: user,
      options: {
        model: tier.model,
        systemPrompt: system,
        maxTurns: tier.maxTurns,
        // See TierConfig. The SDK defaults to 'high' effort with thinking on,
        // which is deep-reasoning behaviour this game's bounded calls do not
        // need and was costing most of the latency.
        effort: tier.effort,
        ...(tier.thinking ? { thinking: tier.thinking } : {}),
        // This is a pure text-in/JSON-out call. No tools, no filesystem, no
        // agentic loop — the game engine is the only thing that touches state.
        tools: [],
        allowedTools: [],
        // Do not inherit the developer's CLAUDE.md or settings: campaign output
        // must depend only on this repo's versioned prompts.
        settingSources: [],
        persistSession: false,
        // Injects the stored subscription token and strips API-key variables, so
        // a key exported from the user's shell profile can neither shadow the
        // subscription nor bill an API account. A property of THIS provider:
        // the keyed providers below exist to use a key.
        env: buildAuthEnv(),
        // Raw JSON is the default; PAXGALACTICA_RAW_JSON=0 restores structured
        // output. Decided on two traced ten-turn campaigns (docs/todo.md 117).
        //
        // Under `outputFormat: json_schema` the SDK returns the result through
        // an end-turn tool — a tool_use/tool_result pair — which costs a second
        // agentic round trip that re-sends the whole context. That carrier is
        // most of the ~7-8s floor on every call. Without it the model answers in
        // one turn, and `readReply` + the Zod retry loop become the only validator:
        // layer 1 is traded for however many extra corrections layer 2 then has
        // to make.
        //
        // Roughly cost-neutral on input either way — the schema is sent as
        // `outputFormat` there and inlined into the system prompt here.
        ...(rawJson ? {} : { outputFormat: { type: 'json_schema', schema: jsonSchema } }),
      },
    });

    // A hung call has to be abandoned rather than waited on. Racing each `next()`
    // rather than the whole loop, so the deadline is per MESSAGE: a long call that
    // is still streaming is healthy and a silent one is not, and a single budget
    // for the whole call cannot tell those apart.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = () =>
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(silentFor(CALL_TIMEOUT_MS)), CALL_TIMEOUT_MS);
      });

    let sentKeys = '';
    try {
      const it = q[Symbol.asyncIterator]();
      for (;;) {
        const step = await Promise.race([it.next(), deadline()]);
        clearTimeout(timer);
        if (step.done) break;
        const message = step.value;
        if (message.type === 'assistant') sentKeys = structuredOutputKeys(message as unknown as Record<string, unknown>) ?? sentKeys;
        if (message.type === 'user') noteSdkRejections(message as unknown as Record<string, unknown>, metrics, sentKeys);
        if (message.type === 'result') {
          costUsd = message.total_cost_usd ?? 0;
          readResultMetrics(message as unknown as Record<string, unknown>, metrics);
          if (message.subtype === 'success') {
            // Even under json_schema the payload arrives as a string; `readReply`
            // parses it. An is_error success carries the failure text in-band.
            if (message.is_error) errorText = message.result;
            else result = message.result;
          } else if (message.subtype === 'error_max_structured_output_retries') {
            errorText =
              'the model could not produce output matching the required schema (structured-output retries exhausted)';
          } else if (message.subtype === 'error_max_turns') {
            errorText = `the call exceeded its turn budget (${tier.maxTurns}); see TierConfig.maxTurns in router.ts`;
          } else {
            errorText = message.errors.join('; ') || message.subtype;
          }
        }
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (/not logged in|\/login/i.test(text)) throw new NotLoggedInError();
      if (errorText === undefined) throw err;
    } finally {
      clearTimeout(timer);
      // Release the child process. Without this an abandoned call leaves a
      // binary running and its output going nowhere.
      try {
        await q.return?.(undefined);
      } catch {
        // Nothing useful to do if the teardown itself fails.
      }
    }

    if (errorText !== undefined) {
      if (/not logged in|\/login/i.test(errorText)) throw new NotLoggedInError();
      throw new ModelCallError(`Model call failed: ${errorText}`, 1);
    }

    return { result, costUsd };
  },
};

/* ------------------------------------------------------------------ */
/* The keyed providers                                                  */
/* ------------------------------------------------------------------ */

const NAMES: Record<KeyedProvider, string> = { anthropic: 'Anthropic', openrouter: 'OpenRouter' };

/** The keyed providers' sign-in message: the settings screen, never a package manager. */
export function missingKeyMessage(provider: KeyedProvider, rejected = false): string {
  return rejected
    ? `${NAMES[provider]} rejected the API key, so no model calls can be made. Paste a working key in Settings. Nothing you declared this turn was lost — only the model call failed.`
    : `No ${NAMES[provider]} API key is set, so no model calls can be made. Paste one in Settings. Nothing you declared this turn was lost — only the model call failed.`;
}

function requireKey(provider: KeyedProvider, settings: Settings): string {
  const resolved = resolveKey(provider, settings);
  if (!resolved) throw new NotLoggedInError(missingKeyMessage(provider));
  return resolved.key;
}

/**
 * Structured output, said the API's way. `$schema` is dropped because it is a
 * statement about the document rather than a constraint on it, and `strict` is
 * NOT set: it requires every property in `required`, which contradicts
 * `z.toJSONSchema(..., { io: 'input' })` advertising defaulted fields as
 * optional (docs/architecture.md A.1).
 */
function bareSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = jsonSchema;
  return rest;
}

/**
 * The Anthropic API, through the official SDK. One request, no agentic loop and
 * no binary — the call the subscription path makes in two turns, made in one.
 *
 * The system prompt carries a cache breakpoint. Every call kind's system prompt
 * is identical turn to turn (`resolution.md` alone is ~8.5k tokens), which is
 * exactly the prefix caching exists for, and the architecture document names
 * it the main cost lever once a call is billed per token. `cacheReadTok` in the
 * trace is what says whether it is working.
 */
export function anthropicProvider(
  settingsOf: () => Settings = readSettings,
  makeClient: (apiKey: string) => Pick<Anthropic, 'messages'> = (apiKey) =>
    new Anthropic({ apiKey, maxRetries: 0, timeout: CALL_TIMEOUT_MS }),
): Provider {
  return {
    id: 'anthropic',
    async call({ kind, system, user, jsonSchema, rawJson }, metrics) {
      const settings = settingsOf();
      const apiKey = requireKey('anthropic', settings);
      const tier = apiTierFor('anthropic', kind, settings.models.anthropic);
      metrics.model = tier.model;
      metrics.numTurns = 1;

      const outputConfig: Anthropic.OutputConfig = {
        ...(tier.effort ? { effort: tier.effort } : {}),
        ...(rawJson ? {} : { format: { type: 'json_schema', schema: bareSchema(jsonSchema) } }),
      };
      const startedAt = Date.now();
      let response: Anthropic.Message;
      try {
        response = await makeClient(apiKey).messages.create({
          model: tier.model,
          max_tokens: tier.maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
          ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
          ...(tier.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new NotLoggedInError(missingKeyMessage('anthropic', true));
        }
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw silentFor(CALL_TIMEOUT_MS);
        if (err instanceof Anthropic.APIError) {
          throw new ModelCallError(`Model call failed: Anthropic API ${err.status ?? ''} ${err.message}`.trim(), 1);
        }
        throw err;
      }
      metrics.apiMs = Date.now() - startedAt;

      const usage = response.usage;
      metrics.inTok = usage.input_tokens;
      metrics.outTok = usage.output_tokens;
      metrics.cacheReadTok = usage.cache_read_input_tokens ?? 0;
      metrics.cacheWriteTok = usage.cache_creation_input_tokens ?? 0;
      const costUsd =
        costFor(response.model || tier.model, {
          inTok: metrics.inTok,
          outTok: metrics.outTok,
          cacheReadTok: metrics.cacheReadTok,
          cacheWriteTok: metrics.cacheWriteTok,
        }) ?? 0;
      metrics.costUsd = costUsd;

      if (response.stop_reason === 'refusal') {
        throw new ModelCallError('Model call failed: the model declined the request (stop_reason: refusal)', 1);
      }
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      // A reply cut off at `max_tokens` is returned as it is: it fails the
      // schema, which is a retry with the error fed back, the same as any other
      // malformed answer.
      return { result: text, costUsd };
    },
  };
}

/* ---------------- OpenRouter ---------------- */

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** What OpenRouter returns, as far as this client reads it. */
interface OpenRouterResponse {
  model?: string;
  choices?: { message?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  error?: { message?: string; code?: number | string };
}

function openRouterReasoning(tier: ApiTierConfig): Record<string, unknown> | undefined {
  // Disabled wins over an effort: the narrative tier is "the same model,
  // thinking less hard — and not at all".
  if (tier.thinking === 'disabled') return { enabled: false };
  if (tier.effort) return { effort: tier.effort };
  return undefined;
}

/**
 * OpenRouter, over its OpenAI-compatible chat endpoint. Chosen over its
 * Anthropic-shaped endpoint because the point of OpenRouter is the models that
 * are NOT Anthropic's — the hedge the architecture document describes, routing
 * `resolution` and `extraction` to whatever is best this month — and the chat
 * endpoint is the one every model on it speaks.
 *
 * `usage.cost` is what OpenRouter actually charged and is preferred to the
 * local price table. Caching is asked for the Anthropic way, with a breakpoint
 * on the system block, and only on Anthropic models: whether OpenRouter passes
 * the cached-input tier through was the open question (A.1), and
 * `cacheReadTok` in the trace now answers it per call.
 */
export function openRouterProvider(
  settingsOf: () => Settings = readSettings,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Provider {
  return {
    id: 'openrouter',
    async call({ kind, system, user, jsonSchema, rawJson }, metrics) {
      const settings = settingsOf();
      const apiKey = requireKey('openrouter', settings);
      const tier = apiTierFor('openrouter', kind, settings.models.openrouter);
      metrics.model = tier.model;
      metrics.numTurns = 1;

      const anthropicModel = tier.model.startsWith('anthropic/');
      const reasoning = openRouterReasoning(tier);
      const body = {
        model: tier.model,
        max_tokens: tier.maxTokens,
        messages: [
          {
            role: 'system',
            content: anthropicModel
              ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
              : system,
          },
          { role: 'user', content: user },
        ],
        usage: { include: true },
        ...(reasoning ? { reasoning } : {}),
        ...(rawJson
          ? {}
          : {
              response_format: {
                type: 'json_schema',
                json_schema: { name: kind, strict: false, schema: bareSchema(jsonSchema) },
              },
            }),
      };

      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // OpenRouter's attribution headers. Neither carries anything about
            // the player.
            'HTTP-Referer': 'http://127.0.0.1',
            'X-Title': 'Pax Galactica',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
          throw silentFor(CALL_TIMEOUT_MS);
        }
        throw new ModelCallError(
          `Model call failed: could not reach OpenRouter (${err instanceof Error ? err.message : String(err)})`,
          1,
        );
      }

      let parsed: OpenRouterResponse = {};
      const raw = await res.text();
      try {
        parsed = JSON.parse(raw) as OpenRouterResponse;
      } catch {
        // Not JSON — handled by the status check below.
      }
      metrics.apiMs = Date.now() - startedAt;

      if (res.status === 401 || res.status === 403) {
        throw new NotLoggedInError(missingKeyMessage('openrouter', true));
      }
      if (!res.ok || parsed.error) {
        const why = parsed.error?.message ?? raw.slice(0, 200);
        if (res.status === 402) {
          throw new ModelCallError(
            `Model call failed: OpenRouter says the account is out of credit (402). Add credit at openrouter.ai, or lower the tier models in Settings. ${why}`.trim(),
            1,
          );
        }
        throw new ModelCallError(`Model call failed: OpenRouter ${res.status} ${why}`.trim(), 1);
      }

      const usage = parsed.usage ?? {};
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      const written = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
      metrics.inTok = Math.max(0, (usage.prompt_tokens ?? 0) - cached - written);
      metrics.outTok = usage.completion_tokens ?? 0;
      metrics.cacheReadTok = cached;
      metrics.cacheWriteTok = written;
      const costUsd =
        typeof usage.cost === 'number' && Number.isFinite(usage.cost)
          ? usage.cost
          : (costFor(tier.model, {
              inTok: metrics.inTok,
              outTok: metrics.outTok,
              cacheReadTok: cached,
              cacheWriteTok: written,
            }) ?? 0);
      metrics.costUsd = costUsd;

      const choice = parsed.choices?.[0];
      const content = choice?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '')).join('')
          : '';
      if (text.length === 0 && choice?.finish_reason) {
        throw new ModelCallError(`Model call failed: OpenRouter returned no text (finish_reason: ${choice.finish_reason})`, 1);
      }
      return { result: text, costUsd };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Which one answers                                                    */
/* ------------------------------------------------------------------ */

let override: Provider | null = null;

/** Test seam: answer every call with this provider until cleared with `null`. */
export function setProviderOverride(provider: Provider | null): void {
  override = provider;
}

/**
 * The provider for the next call. Read on every call, not cached at startup,
 * so a key pasted on the settings screen takes effect on the very next action
 * without restarting anything.
 */
export function activeProvider(settings: Settings = readSettings()): Provider {
  if (override) return override;
  switch (chosenProvider(settings).id) {
    case 'anthropic':
      return anthropicProvider(() => settings);
    case 'openrouter':
      return openRouterProvider(() => settings);
    default:
      return subscriptionProvider;
  }
}

/* ------------------------------------------------------------------ */
/* Checking a key                                                       */
/* ------------------------------------------------------------------ */

export type KeyCheck =
  | { status: 'ok'; detail: string }
  | { status: 'rejected'; detail: string }
  /** The check could not be made — offline, or the suite. The key is still stored. */
  | { status: 'unchecked'; detail: string };

/**
 * Ask the provider whether it accepts a key, without spending anything: the
 * Anthropic models list and OpenRouter's key endpoint are both free. This is
 * the "is there a key, and does the endpoint answer it" that replaces the
 * binary's auth probe for a keyed provider (A.5).
 */
export async function checkKey(
  provider: KeyedProvider,
  key: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<KeyCheck> {
  if (process.env.PAXGALACTICA_NO_NETWORK === '1') {
    return { status: 'unchecked', detail: 'not checked: the network is off in this process' };
  }
  const request =
    provider === 'anthropic'
      ? fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(15_000),
        })
      : fetchImpl(`${OPENROUTER_BASE}/key`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15_000),
        });
  try {
    const res = await request;
    if (res.ok) return { status: 'ok', detail: `${NAMES[provider]} accepted the key` };
    if (res.status === 401 || res.status === 403) {
      return { status: 'rejected', detail: `${NAMES[provider]} rejected the key (HTTP ${res.status})` };
    }
    return { status: 'unchecked', detail: `${NAMES[provider]} answered HTTP ${res.status}; the key was not confirmed` };
  } catch (err) {
    return {
      status: 'unchecked',
      detail: `could not reach ${NAMES[provider]} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
