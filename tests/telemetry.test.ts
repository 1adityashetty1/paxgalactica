import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * The performance trace: one record per model-call attempt and per phase of a
 * turn, written beside the save and never into it.
 *
 * The SDK is mocked, so no call leaves the process: each test scripts what the
 * spawned binary would have answered, down to the timing fields on its result
 * message, and reads back the line the client wrote.
 */

type Scripted =
  | { kind: 'result'; message: Record<string, unknown>; delayMs?: number }
  | { kind: 'throw'; error: Error };

const script: Scripted[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    const step = script.shift();
    let done = false;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (done || !step) return { done: true, value: undefined };
            done = true;
            if (step.kind === 'throw') throw step.error;
            if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
            return { done: false, value: step.message };
          },
        };
      },
      async return() {
        return { done: true, value: undefined };
      },
    };
  },
}));
vi.mock('../src/model/auth.js', () => ({ buildAuthEnv: () => ({}) }));

const { callStructured } = await import('../src/model/client.js');
const telemetry = await import('../src/model/telemetry.js');
const { NULL_SINK, setTelemetrySink, span, FileSink } = telemetry;
const report = await import('../src/model/trace-report.js');
type TraceRecord = import('../src/model/telemetry.js').TraceRecord;
type CallRecord = import('../src/model/telemetry.js').CallRecord;

/** A sink that keeps what it was handed. */
function memorySink(): { records: TraceRecord[]; write: (r: TraceRecord) => void } {
  const records: TraceRecord[] = [];
  return { records, write: (r) => void records.push(r) };
}

const success = (result: unknown, extra: Record<string, unknown> = {}): Scripted => ({
  kind: 'result',
  message: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: JSON.stringify(result),
    total_cost_usd: 0.02,
    duration_ms: 9000,
    duration_api_ms: 6500,
    ttft_ms: 1800,
    time_to_request_from_spawn_ms: 2100,
    num_turns: 2,
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 900, outputTokens: 300, cacheReadInputTokens: 7000, cacheCreationInputTokens: 100 },
      'claude-haiku-4-5': { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    },
    ...extra,
  },
});

const Answer = z.object({ answer: z.number() });

const ask = (label = 'probe') =>
  callStructured({ kind: 'appraisal', system: 'S'.repeat(40), user: 'U'.repeat(25), schema: Answer, label });

let sink: ReturnType<typeof memorySink>;

beforeEach(() => {
  script.length = 0;
  sink = memorySink();
  setTelemetrySink(sink);
  // The client refuses to call out under the suite's no-network guard. Lifted
  // here only because `query` is mocked above: nothing can leave the process.
  vi.stubEnv('PAXGALACTICA_NO_NETWORK', '0');
  vi.stubEnv('PAXGALACTICA_RAW_JSON', '');
});

afterEach(() => {
  setTelemetrySink(NULL_SINK);
  vi.unstubAllEnvs();
});

const calls = () => sink.records.filter((r): r is CallRecord => r.type === 'call');

describe('a model call leaves one record per attempt', () => {
  it('carries what the provider reported, and where in the turn it happened', async () => {
    script.push(success({ answer: 1 }));
    await span('declare', { turn: 4, phase: 'declare', actionId: '4.1' }, () => ask());

    const [rec] = calls();
    expect(rec).toMatchObject({
      type: 'call', turn: 4, phase: 'declare', actionId: '4.1',
      kind: 'appraisal', label: 'probe', attempt: 1, maxAttempts: 3, outcome: 'ok',
      apiMs: 6500, ttftMs: 1800, spawnMs: 2100, numTurns: 2,
      costUsd: 0.02, systemChars: 40, userChars: 25, concurrent: 1, rawJson: false,
    });
    // Summed across every model the call touched — `modelUsage`, which the SDK
    // says to account from, rather than the main-loop-only `usage`.
    expect(rec).toMatchObject({ inTok: 1000, outTok: 320, cacheReadTok: 7000, cacheWriteTok: 100 });
    expect(rec!.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('records a retry as its own line, with why — the thing a stopwatch cannot see', async () => {
    script.push(success({ answer: 'not a number' }), success({ answer: 2 }));
    await ask();

    const lines = calls();
    expect(lines.map((r) => [r.attempt, r.outcome])).toEqual([[1, 'schema_retry'], [2, 'ok']]);
    expect(lines[0]!.why).toMatch(/answer/);
    // The correction prompt is the original plus the rejected output, so the
    // second attempt sent more — which is what a retry costs.
    expect(lines[1]!.userChars).toBeGreaterThan(lines[0]!.userChars);
  });

  it('marks the attempt that exhausts the budget as the call failing', async () => {
    script.push(success({ answer: 'x' }), success({ answer: 'y' }), success({ answer: 'z' }));
    await expect(ask()).rejects.toThrow(/failed validation/);
    const last = calls().at(-1)!;
    expect(last).toMatchObject({ attempt: 3, maxAttempts: 3, outcome: 'schema_failed' });
  });

  it('keeps what an error result reported, even though the attempt threw', async () => {
    script.push(
      {
        kind: 'result',
        message: {
          type: 'result', subtype: 'error_max_turns', is_error: true, errors: [],
          total_cost_usd: 0.01, duration_ms: 5000, duration_api_ms: 4000, num_turns: 6,
          modelUsage: { m: { inputTokens: 50, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
        },
      },
      success({ answer: 3 }),
    );
    await ask();
    const [failed] = calls();
    expect(failed).toMatchObject({ outcome: 'transport_error', numTurns: 6, apiMs: 4000, inTok: 50, costUsd: 0.01 });
    // An error result carries no time-to-first-token, and a record does not
    // state a zero it was not told.
    expect(failed).not.toHaveProperty('ttftMs');
  });

  it('tells a timeout from any other transport failure', async () => {
    script.push(
      { kind: 'throw', error: new Error('the call went silent for 180s and was abandoned') },
      { kind: 'throw', error: new Error('stream dropped') },
      success({ answer: 4 }),
    );
    await ask();
    expect(calls().map((r) => r.outcome)).toEqual(['timeout', 'transport_error', 'ok']);
  });

  it('counts how many calls were in flight, which is what contention costs', async () => {
    script.push(success({ answer: 1 }, {}), success({ answer: 2 }, {}));
    (script[0] as { delayMs?: number }).delayMs = 20;
    (script[1] as { delayMs?: number }).delayMs = 20;
    await Promise.all([ask('a'), ask('b')]);
    expect(calls().map((r) => r.concurrent).sort()).toEqual([1, 2]);
  });

  it('writes nothing when no campaign has installed a sink', async () => {
    setTelemetrySink(NULL_SINK);
    script.push(success({ answer: 1 }));
    await ask();
    expect(sink.records).toEqual([]);
  });
});

describe('spans', () => {
  it('nest a step inside the phase that opened it', async () => {
    await span('end_turn', { turn: 7, phase: 'end_turn' }, async () => {
      await span('reactions', { turn: 7 }, async () => {
        script.push(success({ answer: 1 }));
        await ask();
      });
    });
    const phases = sink.records.filter((r) => r.type === 'phase');
    expect(phases.map((p) => [p.phase, p.step])).toEqual([
      ['end_turn', 'reactions'],
      ['end_turn', 'end_turn'],
    ]);
    // A call inside a step is attributed to the top-level phase and its turn.
    expect(calls()[0]).toMatchObject({ turn: 7, phase: 'end_turn' });
  });

  it('record a phase that threw, and still throw', async () => {
    await expect(span('declare', { turn: 1, phase: 'declare' }, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(sink.records[0]).toMatchObject({ type: 'phase', step: 'declare', ok: false });
  });
});

describe('the file sink', () => {
  it('appends one parseable line per record, and a torn last line costs nothing else', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pg-trace-')), 'nested', 'c.trace.jsonl');
    const file = new FileSink(path);
    file.write({ type: 'phase', at: 1, turn: 1, phase: 'declare', step: 'declare', actionId: null, wallMs: 5, ok: true });
    file.write({ type: 'phase', at: 2, turn: 1, phase: 'declare', step: 'declare', actionId: null, wallMs: 7, ok: true });
    const text = readFileSync(path, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(report.parseTrace(text + '{"type":"pha')).toHaveLength(2);
  });
});

describe('the report', () => {
  const call = (over: Partial<CallRecord>): CallRecord => ({
    type: 'call', at: 0, turn: 1, phase: 'declare', actionId: null, kind: 'appraisal', label: 'x',
    attempt: 1, maxAttempts: 3, outcome: 'ok', wallMs: 1000, costUsd: 0.01,
    systemChars: 10, userChars: 10, concurrent: 1, rawJson: false, ...over,
  });

  it('states medians, retries, failures and the cache hit rate', () => {
    const rs: TraceRecord[] = [
      call({ wallMs: 8000, apiMs: 6000, inTok: 100, cacheReadTok: 900 }),
      call({ wallMs: 10000, outcome: 'schema_retry' }),
      call({ wallMs: 30000, attempt: 2, apiMs: 27000, inTok: 100, cacheReadTok: 0 }),
      call({ wallMs: 12000, attempt: 3, outcome: 'schema_failed' }),
    ];
    const [k] = report.summariseCalls(rs);
    expect(k).toMatchObject({ kind: 'appraisal', calls: 2, retries: 2, schemaRetries: 1, failed: 1 });
    expect(k!.wallP50).toBe(11000);
    expect(k!.overheadP50).toBe(2500);
    expect(k!.cacheHit).toBeCloseTo(900 / 1100);
  });

  it('puts two runs side by side', () => {
    const out = report.formatComparison([call({ wallMs: 30000 })], [call({ wallMs: 9000, rawJson: true })], ['json', 'raw']);
    expect(out).toMatch(/json vs raw/);
    expect(out).toMatch(/appraisal\s+1\/1\s+30\.0\/9\.0/);
  });

  it('draws concurrent calls on separate tracks for Perfetto', () => {
    const t = report.toPerfetto([call({ at: 100, concurrent: 1 }), call({ at: 100, concurrent: 2 })]);
    expect(t.traceEvents.map((e) => e.tid)).toEqual([10, 11]);
    expect(t.traceEvents[0]).toMatchObject({ ph: 'X', ts: 0, dur: 1_000_000 });
  });
});

describe('a played turn writes its trace beside the save, and nowhere else', () => {
  it('records each step of ending a turn, and leaves the save and the replay alone', async () => {
    const { GameSession } = await import('../src/server/session.js');
    const { FileCampaignStore } = await import('../src/engine/store.js');
    const dir = mkdtempSync(join(tmpdir(), 'pg-trace-session-'));
    const store = new FileCampaignStore(dir);
    const session = new GameSession(store);
    await session.newCampaign('meridian', 'traced');
    // A quiet turn: nothing staged, so no model call — but the bots still move
    // and the tick still runs, which is exactly what the phase records are for.
    await session.endTurn();

    const path = join(dir, 'traced.trace.jsonl');
    expect(existsSync(path)).toBe(true);
    const phases = report.parseTrace(readFileSync(path, 'utf8')).filter((r) => r.type === 'phase');
    expect(phases.map((p) => p.step)).toEqual(['commit', 'bots', 'tick', 'save', 'end_turn']);
    expect(new Set(phases.map((p) => p.phase))).toEqual(new Set(['end_turn']));
    expect(new Set(phases.map((p) => p.turn)).size).toBe(1);

    // Not game state: the save carries no trace, a trace is not a campaign,
    // and the campaign still replays byte for byte.
    expect(readFileSync(join(dir, 'traced.json'), 'utf8')).not.toMatch(/wallMs|trace/);
    expect(await store.list()).toEqual(['traced']);
    const { Campaign } = await import('../src/engine/campaign.js');
    const loaded = await Campaign.load('traced', store);
    expect(loaded!.verifyReplay().ok).toBe(true);
  });

  it('writes no file for a store without a disk', async () => {
    const { GameSession } = await import('../src/server/session.js');
    const { MemoryCampaignStore } = await import('../src/engine/store.js');
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'untraced');
    expect(telemetry.telemetrySink()).toBe(NULL_SINK);
  });
});
