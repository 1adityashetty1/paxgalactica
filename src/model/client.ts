import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildAuthEnv } from './auth.js';
import { modelFor, type CallKind } from './router.js';
import {
  callFinished,
  callStarted,
  currentSpan,
  median,
  telemetrySink,
  type CallOutcome,
} from './telemetry.js';

/**
 * The one typed model client. Every model call in the game goes through here,
 * which is what makes tiering, retry policy and cost accounting single-sited.
 *
 * Two layers of defence against malformed output:
 *   1. `outputFormat: json_schema` — the schema is handed to the model, so the
 *      shape is enforced at generation time rather than hoped for.
 *   2. A Zod re-validation with up to `maxRetries` retries, feeding the exact
 *      validation error back into the prompt. Layer 1 guarantees shape; only
 *      layer 2 can catch semantic problems (an unknown faction id, a duration
 *      off the Fibonacci scale) that no JSON schema can express.
 */

export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastRaw?: unknown,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

export class NotLoggedInError extends ModelCallError {
  constructor() {
    super(
      [
        'Claude Code is not signed in, so no model calls can be made.',
        '',
        'Quit with :quit, then run these in the project directory:',
        '',
        '    pnpm login     sign in with your Claude Pro/Max subscription',
        '    pnpm auth      confirm it worked',
        '',
        'Then `pnpm play:web` again. Nothing you have declared this turn was lost from',
        'the save — only the model call failed.',
      ].join('\n'),
      0,
    );
    this.name = 'NotLoggedInError';
  }
}

export interface StructuredCall<T> {
  kind: CallKind;
  /** System rules for this call. Built from versioned prompt files. */
  system: string;
  /** The turn-specific payload: serialized state, the action, the transcript. */
  user: string;
  schema: z.ZodType<T>;
  /** Retries AFTER the first attempt. Spec calls for 2. */
  maxRetries?: number;
  /** Label used in error messages and the debug log. */
  label?: string;
}

export interface StructuredResult<T> {
  value: T;
  attempts: number;
  costUsd: number;
}

export interface CallStats {
  calls: number;
  costUsd: number;
  retries: number;
  /**
   * The same figures split by call kind, plus the wall clock each kind spent.
   *
   * Latency in this game is almost entirely model latency, and until this
   * existed there was no way to say WHICH call a slow turn was waiting on —
   * the playtest of 2026-09-09 had to derive it from curl timings outside the
   * process, which cannot see a retry. A retried call looks exactly like a slow
   * one from the outside, and the two want opposite fixes.
   */
  byKind: Record<
    string,
    { calls: number; seconds: number; costUsd: number; retries: number; durations: number[] }
  >;
  /** What went wrong on each retried call, bounded and newest last. */
  failures: { kind: string; label: string; why: string }[];
}

export const stats: CallStats = { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] };

/**
 * Why a call had to be retried, most recent last.
 *
 * A retry is invisible from outside the process — it looks exactly like one
 * slow call — so the playtest of 2026-09-09 could see that appraisal retried
 * twice in six calls and had no way to find out why. Each retry is another full
 * round trip, so this is the difference between "the tier is slow" and "the
 * schema is wrong", which want opposite fixes.
 *
 * Bounded, because a long campaign should not accumulate a leak in the name of
 * diagnostics.
 */
const MAX_RECORDED_FAILURES = 40;

function recordFailure(kind: CallKind, label: string, why: string): void {
  stats.failures.push({ kind, label, why: why.replace(/\s+/g, ' ').trim().slice(0, 300) });
  if (stats.failures.length > MAX_RECORDED_FAILURES) stats.failures.shift();
}

/**
 * Durations kept per kind so the table can print a real median. Bounded for
 * the same reason `failures` is: the per-call record is `telemetry.ts`, and
 * this is only the console's rolling view of it.
 */
const MAX_DURATIONS = 200;

function record(kind: CallKind, seconds: number, costUsd: number, retries: number): void {
  const row = (stats.byKind[kind] ??= { calls: 0, seconds: 0, costUsd: 0, retries: 0, durations: [] });
  row.calls += 1;
  row.seconds += seconds;
  row.durations.push(seconds);
  if (row.durations.length > MAX_DURATIONS) row.durations.shift();
  row.costUsd += costUsd;
  row.retries += retries;
}

/** Wall clock and retries per call kind, slowest first. */
export function timingReport(): string {
  const rows = Object.entries(stats.byKind).sort((a, b) => b[1].seconds - a[1].seconds);
  if (rows.length === 0) return 'No model calls yet.';
  return [
    'kind             calls   total s    med s   retries    cost',
    ...rows.map(
      ([kind, r]) =>
        // A MEDIAN. This column was labelled "med s" and computed
        // seconds / calls — a mean, which one 117-second outlier drags far
        // enough to misdescribe every other call of that kind.
        `${kind.padEnd(17)}${String(r.calls).padStart(4)}${r.seconds.toFixed(1).padStart(10)}${(median(r.durations) ?? 0).toFixed(1).padStart(9)}${String(r.retries).padStart(10)}${('$' + r.costUsd.toFixed(3)).padStart(9)}`,
    ),
    ...(stats.failures.length > 0
      ? ['', 'why calls were retried (newest last):',
         ...stats.failures.map((f) => `  ${f.label}: ${f.why}`)]
      : []),
  ].join('\n');
}

function assertNetworkAllowed(): void {
  if (process.env.PAXGALACTICA_NO_NETWORK === '1') {
    throw new Error(
      'A model call was attempted while PAXGALACTICA_NO_NETWORK=1. The reducer and replay suites must be pure — this is a bug in the test, not in the client.',
    );
  }
}

/**
 * How long one attempt may take before it is abandoned.
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
 */
export const CALL_TIMEOUT_MS = 180_000;

/**
 * What the provider reported about one attempt. Filled in place rather than
 * returned, so an attempt that ends in an error result still reports what it
 * cost and how long the API took — which is exactly the attempt worth seeing.
 */
interface AttemptMetrics {
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
}

/** Enough to see a pattern without a pathological attempt bloating the trace. */
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
  const set = <K extends Exclude<keyof AttemptMetrics, 'sdkRejections' | 'sdkRejectedKeys'>>(k: K, v: number | undefined) => {
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

/** Raw single-shot call. Returns whatever the model produced, unvalidated. */
async function rawCall(
  kind: CallKind,
  system: string,
  user: string,
  jsonSchema: Record<string, unknown>,
  metrics: AttemptMetrics = {},
): Promise<{ result: unknown; costUsd: number }> {
  const tier = modelFor(kind);
  const rawJson = process.env.PAXGALACTICA_RAW_JSON === '1';
  if (rawJson) {
    system = [
      system,
      '',
      '---',
      '',
      '## Output format',
      '',
      'Reply with a single JSON object and nothing else — no prose before or',
      'after it, no markdown fence. It must validate against this schema:',
      '',
      '```json',
      JSON.stringify(jsonSchema),
      '```',
    ].join('\n');
  }

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
      // subscription nor bill an API account.
      env: buildAuthEnv(),
      // EXPERIMENT (PAXGALACTICA_RAW_JSON=1): drop structured output and ask
      // for JSON in the prompt instead.
      //
      // Under `outputFormat: json_schema` the SDK returns the result through
      // an end-turn tool — a tool_use/tool_result pair — which costs a second
      // agentic round trip that re-sends the whole context. That carrier is
      // most of the ~7-8s floor on every call. Without it the model answers in
      // one turn, and `coerce` + the Zod retry loop become the only validator:
      // layer 1 is traded for however many extra corrections layer 2 then has
      // to make.
      //
      // Roughly cost-neutral on input either way — the schema is sent as
      // `outputFormat` today and inlined into the system prompt here.
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
      timer = setTimeout(
        () => reject(new ModelCallError(`the call went silent for ${CALL_TIMEOUT_MS / 1000}s and was abandoned`, 1)),
        CALL_TIMEOUT_MS,
      );
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
          // Even under json_schema the payload arrives as a string; `coerce`
          // parses it. An is_error success carries the failure text in-band.
          if (message.is_error) errorText = message.result;
          else result = message.result;
        } else if (message.subtype === 'error_max_structured_output_retries') {
          errorText =
            'the model could not produce output matching the required schema (structured-output retries exhausted)';
        } else if (message.subtype === 'error_max_turns') {
          errorText = `the call exceeded its turn budget (${modelFor(kind).maxTurns}); see TierConfig.maxTurns in router.ts`;
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
}

/** Structured output arrives as an object, but tolerate a JSON string. */
function coerce(result: unknown): unknown {
  if (typeof result !== 'string') return result;
  const trimmed = result.trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(fenced);
  } catch {
    return result;
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

export async function callStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  assertNetworkAllowed();
  const startedAt = Date.now();
  const retriesBefore = stats.retries;

  const maxRetries = call.maxRetries ?? 2;
  const label = call.label ?? call.kind;
  // `io: 'input'` so that fields carrying a Zod default are advertised as
  // optional — the model may omit them and the reducer fills them in.
  const jsonSchema = z.toJSONSchema(call.schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>;

  let prompt = call.user;
  let lastRaw: unknown;
  let totalCost = 0;

  let lastError: unknown;

  const rawJson = process.env.PAXGALACTICA_RAW_JSON === '1';
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let result: unknown;
    let costUsd = 0;
    const metrics: AttemptMetrics = {};
    const attemptAt = Date.now();
    const concurrent = callStarted();
    // One line per ATTEMPT, written however the attempt ends. Built here
    // rather than inside `rawCall` because only this loop knows whether the
    // output then passed validation, which is the half of a retry that
    // matters most and the half `rawCall` cannot see.
    const trace = (outcome: CallOutcome, why?: string) => {
      const at = currentSpan();
      telemetrySink().write({
        type: 'call',
        at: attemptAt,
        turn: at?.turn ?? null,
        phase: at?.phase ?? null,
        actionId: at?.actionId ?? null,
        kind: call.kind,
        label,
        attempt,
        maxAttempts: maxRetries + 1,
        outcome,
        ...(why !== undefined ? { why: why.replace(/\s+/g, ' ').trim().slice(0, 300) } : {}),
        wallMs: Date.now() - attemptAt,
        ...metrics,
        costUsd: metrics.costUsd ?? costUsd,
        systemChars: call.system.length,
        userChars: prompt.length,
        concurrent,
        rawJson,
      });
    };

    // Transient failures — turn-budget overruns, overload, a dropped stream —
    // get the same retry budget as a schema violation. Previously only Zod
    // failures were retried, so one bad round trip ended the whole action.
    try {
      ({ result, costUsd } = await rawCall(call.kind, call.system, prompt, jsonSchema, metrics));
    } catch (err) {
      callFinished();
      const message = err instanceof Error ? err.message : String(err);
      // An attempt the SDK ended because the model kept missing the schema —
      // its structured-output retries ran out, or its turn budget did while it
      // was still retrying — is a schema failure that happened a layer down,
      // not a transport one. It was recorded as `transport_error`, which
      // hid the one number the raw-JSON decision turns on.
      const schemaMiss = (metrics.sdkRejections?.length ?? 0) > 0 || /structured-output retries exhausted/.test(message);
      trace(
        /went silent/.test(message)
          ? 'timeout'
          : schemaMiss
            ? attempt > maxRetries ? 'schema_failed' : 'schema_retry'
            : 'transport_error',
        schemaMiss && metrics.sdkRejections?.length ? metrics.sdkRejections.at(-1) : message,
      );
      if (err instanceof NotLoggedInError) throw err;
      lastError = err;
      stats.calls += 1;
      recordFailure(call.kind, label, message);
      if (attempt > maxRetries) break;
      stats.retries += 1;
      continue;
    }
    callFinished();

    totalCost += costUsd;
    stats.calls += 1;
    stats.costUsd += costUsd;

    lastRaw = coerce(result);
    const parsed = call.schema.safeParse(lastRaw);
    if (parsed.success) {
      trace('ok');
      record(call.kind, (Date.now() - startedAt) / 1000, totalCost, stats.retries - retriesBefore);
      return { value: parsed.data, attempts: attempt, costUsd: totalCost };
    }

    trace(attempt > maxRetries ? 'schema_failed' : 'schema_retry', formatIssues(parsed.error));
    if (attempt > maxRetries) {
      throw new ModelCallError(
        `${label}: output failed validation after ${attempt} attempts.\n${formatIssues(parsed.error)}`,
        attempt,
        lastRaw,
      );
    }

    stats.retries += 1;
    recordFailure(call.kind, label, formatIssues(parsed.error));
    prompt = [
      call.user,
      '',
      '## Your previous response was rejected',
      '',
      'It did not satisfy the required schema. The validation errors were:',
      '',
      formatIssues(parsed.error),
      '',
      'This was your rejected output:',
      '',
      '```json',
      JSON.stringify(lastRaw, null, 2).slice(0, 4000),
      '```',
      '',
      'Emit a corrected response that fixes exactly these problems. Change nothing else.',
    ].join('\n');
  }

  if (lastError instanceof Error) {
    throw new ModelCallError(
      `${label}: failed after ${maxRetries + 1} attempts. ${lastError.message}`,
      maxRetries + 1,
      lastRaw,
    );
  }
  throw new ModelCallError(`${label}: exhausted retries.`, maxRetries + 1, lastRaw);
}
