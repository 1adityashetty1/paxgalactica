import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildAuthEnv } from './auth.js';
import { modelFor, type CallKind } from './router.js';

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
}

export const stats: CallStats = { calls: 0, costUsd: 0, retries: 0 };

function assertNetworkAllowed(): void {
  if (process.env.PAXGALACTICA_NO_NETWORK === '1') {
    throw new Error(
      'A model call was attempted while PAXGALACTICA_NO_NETWORK=1. The reducer and replay suites must be pure — this is a bug in the test, not in the client.',
    );
  }
}

/** Raw single-shot call. Returns whatever the model produced, unvalidated. */
async function rawCall(
  kind: CallKind,
  system: string,
  user: string,
  jsonSchema: Record<string, unknown>,
): Promise<{ result: unknown; costUsd: number }> {
  const tier = modelFor(kind);

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
      outputFormat: { type: 'json_schema', schema: jsonSchema },
    },
  });

  try {
    for await (const message of q) {
      if (message.type === 'result') {
        costUsd = message.total_cost_usd ?? 0;
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

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let result: unknown;
    let costUsd = 0;

    // Transient failures — turn-budget overruns, overload, a dropped stream —
    // get the same retry budget as a schema violation. Previously only Zod
    // failures were retried, so one bad round trip ended the whole action.
    try {
      ({ result, costUsd } = await rawCall(call.kind, call.system, prompt, jsonSchema));
    } catch (err) {
      if (err instanceof NotLoggedInError) throw err;
      lastError = err;
      stats.calls += 1;
      if (attempt > maxRetries) break;
      stats.retries += 1;
      continue;
    }

    totalCost += costUsd;
    stats.calls += 1;
    stats.costUsd += costUsd;

    lastRaw = coerce(result);
    const parsed = call.schema.safeParse(lastRaw);
    if (parsed.success) {
      return { value: parsed.data, attempts: attempt, costUsd: totalCost };
    }

    if (attempt > maxRetries) {
      throw new ModelCallError(
        `${label}: output failed validation after ${attempt} attempts.\n${formatIssues(parsed.error)}`,
        attempt,
        lastRaw,
      );
    }

    stats.retries += 1;
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
