import { z } from 'zod';
import { ModelCallError, NotLoggedInError, SpendCapError } from './errors.js';
import { activeProvider, type AttemptMetrics } from './provider.js';
import type { CallKind } from './router.js';
import { spendCap } from './settings.js';
import {
  callFinished,
  callStarted,
  currentSpan,
  median,
  telemetrySink,
  type CallOutcome,
} from './telemetry.js';

export { ModelCallError, NotLoggedInError, SpendCapError } from './errors.js';
export { CALL_TIMEOUT_MS } from './provider.js';

/**
 * The one typed model client. Every model call in the game goes through here,
 * which is what makes tiering, retry policy, cost accounting and the spend cap
 * single-sited — whichever provider answers (`provider.ts`).
 *
 * Two layers of defence against malformed output:
 *   1. The schema reaches the model — inlined into the prompt under raw JSON,
 *      the default, or handed to the API as structured output.
 *   2. A Zod re-validation with up to `maxRetries` retries, feeding the exact
 *      validation error back into the prompt. Only this layer can catch
 *      semantic problems (an unknown faction id, a duration off the scale)
 *      that no JSON schema can express.
 */

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

/** How much of a reply that was not JSON the trace keeps: enough to see its shape. */
const UNPARSED_SAMPLE_CHARS = 600;

/**
 * The prompt as a provider receives it. Under raw JSON the schema is inlined
 * into the system prompt and the rule restated at the end of the user message;
 * under structured output both go as they are and the provider hands the
 * schema to the API. Done here rather than in each provider, so every provider
 * is asked for exactly the same thing.
 */
function asSent(system: string, user: string, jsonSchema: Record<string, unknown>, rawJson: boolean) {
  if (!rawJson) return { system, user };
  return {
    system: [
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
    ].join('\n'),
    // Repeated at the END of the user message, where it is read last. A traced
    // run found every raw preamble-then-JSON reply on resolution, whose user
    // message is the longest in the game: a rule stated once, a system prompt
    // and forty thousand characters earlier, is the rule a model drifts off.
    user: `${user}\n\n${RAW_JSON_REMINDER}`,
  };
}

/**
 * Stop before a call that would spend past the cap (docs/architecture.md A.5).
 *
 * Under a subscription an overspend is an inconvenience; under a pasted key it
 * is a bill, so this is checked in the one place every call passes through —
 * the same argument that makes tiering and retry policy single-sited. It reads
 * this process's running total, which the attempt that crosses the line still
 * adds to: the cap is the point at which no NEW call starts, which is the only
 * kind of cap a call whose cost is unknown until it returns can honour.
 */
function assertUnderCap(): void {
  const cap = spendCap();
  if (cap !== null && stats.costUsd >= cap) throw new SpendCapError(stats.costUsd, cap);
}

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
  // Chosen once per call, so a key changed mid-call does not split its retries
  // across two providers.
  const provider = activeProvider();
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    assertUnderCap();
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
        provider: provider.id,
      });
    };

    // Transient failures — turn-budget overruns, overload, a dropped stream —
    // get the same retry budget as a schema violation. Previously only Zod
    // failures were retried, so one bad round trip ended the whole action.
    try {
      const sent = asSent(call.system, prompt, jsonSchema, rawJson);
      ({ result, costUsd } = await provider.call(
        { kind: call.kind, system: sent.system, user: sent.user, jsonSchema, rawJson },
        metrics,
      ));
    } catch (err) {
      callFinished();
      // A failed attempt can still have been billed — an error result from the
      // SDK carries its cost — and the cap reads this total.
      stats.costUsd += metrics.costUsd ?? 0;
      totalCost += metrics.costUsd ?? 0;
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
      if (err instanceof NotLoggedInError || err instanceof SpendCapError) throw err;
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
