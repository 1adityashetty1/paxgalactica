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

/** How much of a reply that was not JSON the trace keeps: enough to see its shape. */
const UNPARSED_SAMPLE_CHARS = 600;

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

/**
 * Whether calls ask for JSON in the prompt rather than through structured
 * output. The default since todo 117 closed: on the same ten-turn script it
 * retried nothing where structured output retried 12% of arbiter calls, took a
 * declared action from 44.6s to 15.8s, and cost $4.90 against $7.11.
 * `PAXGALACTICA_RAW_JSON=0` restores structured output, for comparison runs.
 */
export function usesRawJson(): boolean {
  return process.env.PAXGALACTICA_RAW_JSON !== '0';
}

/** Appended to every raw-JSON user message. Exported for the test that pins it. */
export const RAW_JSON_REMINDER =
  'Answer with the JSON object alone: begin with `{` and end with `}`, with nothing before or after it. There is nobody to ask a question of — if something is unclear, decide on the most plausible reading.';

/** Raw single-shot call. Returns whatever the model produced, unvalidated. */
async function rawCall(
  kind: CallKind,
  system: string,
  user: string,
  jsonSchema: Record<string, unknown>,
  metrics: AttemptMetrics = {},
): Promise<{ result: unknown; costUsd: number }> {
  const tier = modelFor(kind);
  const rawJson = usesRawJson();
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
    // Repeated at the END of the user message, where it is read last. A traced
    // run found every raw preamble-then-JSON reply on resolution, whose user
    // message is the longest in the game: a rule stated once, a system prompt
    // and forty thousand characters earlier, is the rule a model drifts off.
    user = `${user}\n\n${RAW_JSON_REMINDER}`;
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
          // Even under json_schema the payload arrives as a string; `readReply`
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
/**
 * Read a model's reply as the JSON object it was asked for.
 *
 * Under structured output the API holds the model to the schema while it
 * writes; raw JSON moves that job here, so this is the transport's contract,
 * stated once. **The reply is the first complete JSON object in the text.**
 * Captured in a traced playtest (`CallRecord.unparsed`): resolution calls wrote
 * the story as prose and THEN the object — at character 92, 573 and 275, one of
 * them inside a ```json fence — and every one of those was a retry that
 * re-sent the whole context for an answer already given. The prose ahead of the
 * object restates its own `narrative`, so nothing is lost by dropping it, and
 * the schema still validates what is kept.
 *
 * A reply with no object in it at all — a persona answering in character, an
 * arbiter asking a question — stays a string, and is a retry: there is nothing
 * to salvage, and guessing a shape would be inventing an answer.
 */
export function readReply(result: unknown): { value: unknown; normalized: string[] } {
  if (typeof result !== 'string') return { value: result, normalized: [] };
  const trimmed = result.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { value: JSON.parse(unfenced), normalized: unfenced !== trimmed ? ['fence'] : [] };
  } catch {
    // Not a bare object; look for one inside the text.
  }
  const found = firstJsonObject(trimmed);
  if (found !== undefined) return { value: found, normalized: ['preamble'] };
  return { value: result, normalized: [] };
}

/**
 * The first balanced `{…}` in a text that parses as a JSON object, respecting
 * strings and escapes. A candidate that does not parse — braces in the prose
 * ahead of the answer — is skipped rather than ending the search.
 */
function firstJsonObject(text: string): Record<string, unknown> | undefined {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          const value: unknown = JSON.parse(text.slice(start, i + 1));
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch {
          // Not JSON; try the next opening brace.
        }
        break;
      }
    }
  }
  return undefined;
}

/**
 * The same object with every `null` property removed, recursively.
 *
 * A model writing JSON without the schema enforced says "none" with `null` as
 * readily as by leaving the key out — measured once in the traced playtest: an
 * arbiter ruling with `null` for its stat, difficulty, breach, covert work and
 * negotiation. Applied only when the strict parse FAILS, so a field where
 * `null` is a real value (`targetCommanderId`, `fromAssetId`) is never touched
 * on an answer that was already valid.
 */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, dropNulls(v)]),
  );
}

/**
 * Brings an answer within the limits its schema states, where the limit has an
 * honest smaller version. Under structured output these limits are enforced
 * while the model writes; in raw JSON nothing enforces them, and a traced run
 * spent retries on a 250-character accord note and on fleets sent with
 * `force: 0`. Each re-sent the whole context to be told a number.
 *
 * - **Text past its cap is cut**, at a word where one is near, and marked
 *   with an ellipsis — the same trim-not-reject the reducer gives an
 *   over-large income: the record is still real at a smaller length.
 * - **An op sending fewer than one ship is dropped.** It is not reduced to
 *   "no force", because an absent `force` means the WHOLE port sails: zero
 *   ships is no order, and reading it as every ship would invert it.
 *
 * Driven by the issues Zod reported rather than a walk of the schema, so it
 * touches only what failed, and the JSON schema a model is shown keeps stating
 * every limit. Anything else is left for the retry.
 */
export function trimToLimits(value: unknown, issues: readonly z.core.$ZodIssue[]): { value: unknown; changed: string[] } {
  const out = structuredClone(value);
  const changed = new Set<string>();
  const dropped = new Map<string, { list: unknown[]; index: number }>();
  const visit = (list: readonly z.core.$ZodIssue[], base: PropertyKey[]) => {
    for (const issue of list) {
      const path = [...base, ...issue.path];
      if (issue.code === 'invalid_union') {
        for (const branch of issue.errors) visit(branch, path);
        continue;
      }
      const parent = walk(out, path.slice(0, -1));
      const key = path.at(-1);
      if (parent === undefined || key === undefined) continue;
      const here = (parent as Record<PropertyKey, unknown>)[key];
      if (issue.code === 'too_big' && issue.origin === 'string' && typeof here === 'string') {
        const max = Number(issue.maximum);
        if (here.length <= max) continue;
        const cut = here.slice(0, max - 1);
        const space = cut.lastIndexOf(' ');
        (parent as Record<PropertyKey, unknown>)[key] = `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
        changed.add('trim');
      } else if (issue.code === 'too_small' && issue.origin === 'number' && key === 'force' && typeof here === 'number' && here < 1) {
        // The op holding the force is the element of the list above it.
        const opPath = path.slice(0, -1);
        const list = walk(out, opPath.slice(0, -1));
        const index = opPath.at(-1);
        if (Array.isArray(list) && typeof index === 'number') {
          dropped.set(opPath.join('.'), { list, index });
          changed.add('empty_force');
        }
      }
    }
  };
  visit(issues, []);
  // Highest index first, so earlier removals do not shift later ones.
  for (const { list, index } of [...dropped.values()].sort((a, b) => b.index - a.index)) {
    list.splice(index, 1);
  }
  return { value: out, changed: [...changed] };
}

function walk(value: unknown, path: readonly PropertyKey[]): unknown {
  let at: unknown = value;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return at;
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

  const rawJson = usesRawJson();
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
    const trace = (outcome: CallOutcome, why?: string, unparsed?: string, normalized: string[] = []) => {
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
        ...(unparsed !== undefined ? { unparsed: unparsed.slice(0, UNPARSED_SAMPLE_CHARS) } : {}),
        ...(normalized.length > 0 ? { normalized } : {}),
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

    const read = readReply(result);
    lastRaw = read.value;
    let normalized = read.normalized;
    let parsed = call.schema.safeParse(lastRaw);
    if (!parsed.success && lastRaw !== null && typeof lastRaw === 'object') {
      // Two lenient passes, each only when what came before still fails, so
      // an answer that was valid as sent is never rewritten.
      const unnulled = dropNulls(lastRaw);
      let lenient = call.schema.safeParse(unnulled);
      let passes = ['nulls'];
      if (!lenient.success) {
        const trimmed = trimToLimits(unnulled, lenient.error.issues);
        if (trimmed.changed.length > 0) {
          lenient = call.schema.safeParse(trimmed.value);
          const hadNulls = JSON.stringify(unnulled) !== JSON.stringify(lastRaw);
          passes = [...(hadNulls ? ['nulls'] : []), ...trimmed.changed];
          if (!lenient.success) passes = [];
        }
      }
      if (lenient.success) {
        parsed = lenient;
        normalized = [...normalized, ...new Set(passes)];
      }
    }
    if (parsed.success) {
      trace('ok', undefined, undefined, normalized);
      record(call.kind, (Date.now() - startedAt) / 1000, totalCost, stats.retries - retriesBefore);
      return { value: parsed.data, attempts: attempt, costUsd: totalCost };
    }

    // A reply that never became a JSON object is kept, briefly, so its cause can
    // be read rather than guessed at — see `CallRecord.unparsed`.
    trace(
      attempt > maxRetries ? 'schema_failed' : 'schema_retry',
      formatIssues(parsed.error),
      typeof lastRaw === 'string' ? lastRaw : undefined,
    );
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
