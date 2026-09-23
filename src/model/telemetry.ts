import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Where a turn's time goes, recorded as data rather than printed.
 *
 * A turn is almost entirely model latency — the reducer is flat at a few
 * milliseconds (see `pnpm perf`) — and for most of this project's life the only
 * account of that latency was a cumulative table printed under an opt-in flag.
 * So the one decision the architecture notes leave open on latency, whether
 * `PAXGALACTICA_RAW_JSON=1` becomes the default (~98s a turn against ~37s), had
 * no data to be decided on: it turns on retries and rejections per call kind,
 * and nothing kept those per call.
 *
 * Two record types, one line of JSON each, appended to
 * `saves/<campaign>.trace.jsonl`:
 *
 * - a **call** record per model-call ATTEMPT — a retry is its own line, which is
 *   the point, since from outside the process a retry looks exactly like one
 *   slow call and the two want opposite fixes;
 * - a **phase** record per span of a turn: declaring an action, ending a turn
 *   and each step inside it, a channel message, closing a channel.
 *
 * **Not game state, on purpose.** Nothing here reaches `WorldState`, the
 * journal, the save file or an export archive: timings are a fact about one
 * machine on one afternoon, and anything in state is something replay would
 * have to reproduce. `verifyReplay` cannot see this file.
 *
 * **Always on**, because an opt-in flag is exactly why this data did not exist.
 * A record is a dozen numbers and no prompt text, about fifteen lines a turn.
 * The default sink records nothing, so the suite — and anything else that has
 * not been handed a campaign — writes no files; the server installs a file sink
 * when a campaign starts or resumes.
 *
 * The call record is shaped for the provider seam in `docs/architecture.md`
 * A.1 rather than for the SDK: token counts and wall time are universal, and
 * the SDK-only timings (`spawnMs`, `ttftMs`, `numTurns`) are optional, so an
 * HTTP provider fills the same record with those left out.
 */

/** What a turn was doing when a call was made. Carried implicitly; see `span`. */
export interface SpanContext {
  turn: number;
  /** The top-level phase: `declare`, `end_turn`, `talk`, `end_talk`, `advisor`, `epilogue`. */
  phase: string;
  /** Distinguishes two declared actions in one turn. Unset outside an action. */
  actionId?: string;
}

export type CallOutcome = 'ok' | 'schema_retry' | 'schema_failed' | 'transport_error' | 'timeout';

export interface CallRecord {
  type: 'call';
  /** Epoch milliseconds when the attempt started. */
  at: number;
  turn: number | null;
  phase: string | null;
  actionId: string | null;
  kind: string;
  label: string;
  /** 1-based. A second attempt at the same call is a retry. */
  attempt: number;
  /** The attempts this call was allowed, so a failed last attempt reads as the call failing. */
  maxAttempts: number;
  outcome: CallOutcome;
  /** Why it was not `ok`, bounded. */
  why?: string;
  /** Measured here, around the whole attempt. */
  wallMs: number;
  /** From the provider, when it says. `wallMs - apiMs` is the transport floor. */
  apiMs?: number;
  /**
   * Time to first token, as the SDK reports it. Clocked from a different start
   * than `apiMs` — measured live at 1220ms against an `apiMs` of 1112 — so it
   * is not a slice of API time and should not be subtracted from it.
   */
  ttftMs?: number;
  /**
   * Spawn to request sent. Declared by the SDK and **not populated** by
   * 0.3.225, checked live; kept so a version that sends it is recorded. The
   * transport floor is `wallMs - apiMs` until then, measured at 1.6-1.9s.
   */
  spawnMs?: number;
  /** Agentic round trips; structured output costs one more than raw JSON. */
  numTurns?: number;
  /**
   * Schema rejections the SDK made INSIDE this attempt, in its own words —
   * `/ops/0/type: must be equal to one of the allowed values`. Under
   * `outputFormat: json_schema` the SDK validates each StructuredOutput call
   * and, on a miss, feeds the error back and lets the model try again within
   * the same attempt, so a call that "succeeded" in four turns failed the
   * schema twice and nothing above the SDK could tell. Absent when there were
   * none. Bounded in count and length.
   */
  sdkRejections?: string[];
  /**
   * The top-level keys of each output the SDK rejected, parallel to
   * `sdkRejections` — `reaction` or `factionId,narrative,ops`. A validator
   * reports what is MISSING, so a model that wrapped its answer in a key of its
   * own invention reads as "no factionId, no narrative, no ops" and the wrapper
   * itself is never named. Keys only: no values, so no prompt or game text.
   */
  sdkRejectedKeys?: string[];
  inTok?: number;
  outTok?: number;
  cacheReadTok?: number;
  cacheWriteTok?: number;
  costUsd: number;
  /** What was sent, in characters — prompt growth, without keeping the prompt. */
  systemChars: number;
  userChars: number;
  /** Calls in flight when this one started, itself included. */
  concurrent: number;
  /** Whether the experimental raw-JSON transport was on, for comparing runs. */
  rawJson: boolean;
}

export interface PhaseRecord {
  type: 'phase';
  at: number;
  turn: number;
  /** The top-level phase this step belongs to. */
  phase: string;
  /** The step itself: `commit`, `reactions`, `bots`, `tick`, … or the phase again for the whole. */
  step: string;
  actionId: string | null;
  wallMs: number;
  ok: boolean;
}

export type TraceRecord = CallRecord | PhaseRecord;

export interface TelemetrySink {
  write(record: TraceRecord): void;
}

/** Records nothing. The default, so a process that was handed no campaign writes no files. */
export const NULL_SINK: TelemetrySink = { write: () => {} };

/**
 * Appends one JSON line per record.
 *
 * Synchronous on purpose: fifteen short lines a turn is nothing against a
 * twenty-second model call, and a synchronous append cannot interleave two
 * records from concurrent reactions into one garbled line. A failed write is
 * swallowed — losing a trace line must never cost the player a turn.
 */
export class FileSink implements TelemetrySink {
  constructor(readonly path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // Reported by the first failed write, which is also swallowed.
    }
  }

  write(record: TraceRecord): void {
    try {
      appendFileSync(this.path, JSON.stringify(record) + '\n');
    } catch {
      // Diagnostics must not be able to fail the game.
    }
  }
}

let sink: TelemetrySink = NULL_SINK;

export function setTelemetrySink(next: TelemetrySink): void {
  sink = next;
}

export function telemetrySink(): TelemetrySink {
  return sink;
}

const context = new AsyncLocalStorage<SpanContext>();

/** The span a call is being made inside, if any. */
export function currentSpan(): SpanContext | undefined {
  return context.getStore();
}

/**
 * Run `fn` inside a span, and record how long it took.
 *
 * The context is carried by `AsyncLocalStorage` rather than threaded through
 * every signature, so a model call deep inside `resolveAction` knows which
 * turn and which declared action it belongs to without either being passed
 * down. `Promise.all` children inherit it, which is what keeps three parallel
 * reactions attributed to the end of the turn that fired them.
 *
 * A span nested in another keeps the outer phase and actionId and records its
 * own `step`, so the report can draw end-of-turn as commit, reactions, bots,
 * tick and save rather than one opaque bar.
 */
export async function span<T>(
  step: string,
  ctx: Partial<SpanContext> & { turn: number },
  fn: () => Promise<T> | T,
): Promise<T> {
  const outer = context.getStore();
  const inner: SpanContext = {
    turn: ctx.turn,
    phase: ctx.phase ?? outer?.phase ?? step,
    ...(ctx.actionId ?? outer?.actionId ? { actionId: ctx.actionId ?? outer?.actionId } : {}),
  };
  const at = Date.now();
  let ok = false;
  try {
    const out = await context.run(inner, fn);
    ok = true;
    return out;
  } finally {
    sink.write({
      type: 'phase',
      at,
      turn: inner.turn,
      phase: inner.phase,
      step,
      actionId: inner.actionId ?? null,
      wallMs: Date.now() - at,
      ok,
    });
  }
}

/** Calls currently in flight. Read at the start of each, for contention. */
let inFlight = 0;

export function callStarted(): number {
  inFlight += 1;
  return inFlight;
}

export function callFinished(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** Median of a list of numbers; `null` when there are none. Shared with the report. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The value at a quantile (nearest rank); `null` when there are none. */
export function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[rank]!;
}
