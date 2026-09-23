import { median, quantile, type CallRecord, type PhaseRecord, type TraceRecord } from './telemetry.js';

/**
 * Reading a campaign's trace: what `pnpm trace` prints.
 *
 * Kept in `src/` rather than in the script so the arithmetic is typechecked and
 * tested — a report that misstates a median is how the old console table said
 * "med s" over a mean for as long as it existed.
 */

/** Parse a JSONL trace, skipping any line that is not a record. A torn last line is not fatal. */
export function parseTrace(text: string): TraceRecord[] {
  const out: TraceRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const r = JSON.parse(line) as TraceRecord;
      if (r && (r.type === 'call' || r.type === 'phase')) out.push(r);
    } catch {
      // A line cut off by a crash mid-write. Everything before it still counts.
    }
  }
  return out;
}

export interface KindSummary {
  kind: string;
  /** Logical calls: attempt-1 records. */
  calls: number;
  /** Attempts beyond the first. */
  retries: number;
  /** Retries caused by output that failed validation, the half raw JSON trades on. */
  schemaRetries: number;
  /** Calls that exhausted every attempt. */
  failed: number;
  wallP50: number | null;
  wallP95: number | null;
  /** Wall minus API time: transport the provider does not count as model time. */
  overheadP50: number | null;
  spawnP50: number | null;
  ttftP50: number | null;
  numTurnsP50: number | null;
  inTokP50: number | null;
  outTokP50: number | null;
  /** Cache reads over all input the provider saw, across every attempt. */
  cacheHit: number | null;
  userCharsP50: number | null;
  userCharsMax: number | null;
  costUsd: number;
}

const nums = (rs: CallRecord[], f: (r: CallRecord) => number | undefined): number[] =>
  rs.map(f).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

export function summariseCalls(records: readonly TraceRecord[]): KindSummary[] {
  const calls = records.filter((r): r is CallRecord => r.type === 'call');
  const byKind = new Map<string, CallRecord[]>();
  for (const r of calls) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }
  const out: KindSummary[] = [];
  for (const [kind, rs] of byKind) {
    const input = nums(rs, (r) => (r.inTok ?? 0) + (r.cacheReadTok ?? 0) + (r.cacheWriteTok ?? 0));
    const read = nums(rs, (r) => r.cacheReadTok);
    const seenInput = input.reduce((a, b) => a + b, 0);
    out.push({
      kind,
      calls: rs.filter((r) => r.attempt === 1).length,
      retries: rs.filter((r) => r.attempt > 1).length,
      schemaRetries: rs.filter((r) => r.outcome === 'schema_retry').length,
      failed: rs.filter((r) => r.outcome !== 'ok' && r.attempt >= r.maxAttempts).length,
      wallP50: median(nums(rs, (r) => r.wallMs)),
      wallP95: quantile(nums(rs, (r) => r.wallMs), 0.95),
      overheadP50: median(nums(rs, (r) => (r.apiMs === undefined ? undefined : r.wallMs - r.apiMs))),
      spawnP50: median(nums(rs, (r) => r.spawnMs)),
      ttftP50: median(nums(rs, (r) => r.ttftMs)),
      numTurnsP50: median(nums(rs, (r) => r.numTurns)),
      inTokP50: median(nums(rs, (r) => r.inTok)),
      outTokP50: median(nums(rs, (r) => r.outTok)),
      cacheHit: seenInput > 0 && read.length > 0 ? read.reduce((a, b) => a + b, 0) / seenInput : null,
      userCharsP50: median(nums(rs, (r) => r.userChars)),
      userCharsMax: rs.length > 0 ? Math.max(...rs.map((r) => r.userChars)) : null,
      costUsd: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    });
  }
  // Slowest first by total wall clock: the row you would act on is read first.
  const total = (k: string) => calls.filter((r) => r.kind === k).reduce((a, r) => a + r.wallMs, 0);
  return out.sort((a, b) => total(b.kind) - total(a.kind) || a.kind.localeCompare(b.kind));
}

export interface PhaseSummary {
  phase: string;
  step: string;
  count: number;
  p50: number | null;
  p95: number | null;
}

/** Wall time per (phase, step). A step equal to its phase is the whole phase. */
export function summarisePhases(records: readonly TraceRecord[]): PhaseSummary[] {
  const phases = records.filter((r): r is PhaseRecord => r.type === 'phase');
  const groups = new Map<string, PhaseRecord[]>();
  for (const r of phases) {
    const key = `${r.phase}\u0000${r.step}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((rs) => ({
      phase: rs[0]!.phase,
      step: rs[0]!.step,
      count: rs.length,
      p50: median(rs.map((r) => r.wallMs)),
      p95: quantile(rs.map((r) => r.wallMs), 0.95),
    }))
    .sort((a, b) => a.phase.localeCompare(b.phase) || (a.step === a.phase ? -1 : b.step === b.phase ? 1 : 0) || a.step.localeCompare(b.step));
}

const s = (ms: number | null): string => (ms === null ? '—' : (ms / 1000).toFixed(1));
/** Phases run from milliseconds (a tick) to a minute (reactions), so they get one more place. */
const s2 = (ms: number | null): string => (ms === null ? '—' : (ms / 1000).toFixed(2));
const n = (x: number | null): string => (x === null ? '—' : String(Math.round(x)));
const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function formatReport(records: readonly TraceRecord[], title = 'trace'): string {
  const kinds = summariseCalls(records);
  const phases = summarisePhases(records);
  const calls = records.filter((r) => r.type === 'call') as CallRecord[];
  const turns = new Set(records.map((r) => r.turn).filter((t) => t !== null));
  const rawJson = [...new Set(calls.map((c) => c.rawJson))];
  const lines: string[] = [
    `── ${title}: ${calls.length} attempts over ${turns.size} turns · raw JSON ${rawJson.length === 0 ? '—' : rawJson.join('/')} ──`,
    '',
    'kind             calls retry schema fail  p50 s  p95 s  ovh s spawn s ttft s turns  in tok out tok cache  userKB    cost',
  ];
  for (const k of kinds) {
    lines.push(
      [
        k.kind.padEnd(17),
        String(k.calls).padStart(5),
        String(k.retries).padStart(6),
        String(k.schemaRetries).padStart(7),
        String(k.failed).padStart(5),
        s(k.wallP50).padStart(7),
        s(k.wallP95).padStart(7),
        s(k.overheadP50).padStart(7),
        s(k.spawnP50).padStart(8),
        s(k.ttftP50).padStart(7),
        n(k.numTurnsP50).padStart(6),
        n(k.inTokP50).padStart(8),
        n(k.outTokP50).padStart(8),
        pct(k.cacheHit).padStart(6),
        (k.userCharsP50 === null ? '—' : (k.userCharsP50 / 1024).toFixed(1)).padStart(8),
        `$${k.costUsd.toFixed(3)}`.padStart(8),
      ].join(''),
    );
  }
  if (kinds.length === 0) lines.push('(no model calls recorded)');
  lines.push('', 'phase         step          count    p50 s    p95 s');
  for (const p of phases) {
    lines.push(
      `${p.phase.padEnd(14)}${(p.step === p.phase ? '(whole)' : p.step).padEnd(14)}${String(p.count).padStart(5)}${s2(p.p50).padStart(9)}${s2(p.p95).padStart(9)}`,
    );
  }
  const why = calls.filter((c) => c.outcome !== 'ok' && c.why).slice(-8);
  if (why.length > 0) {
    lines.push('', 'why attempts did not succeed (newest last):');
    for (const c of why) lines.push(`  t${c.turn ?? '?'} ${c.kind} #${c.attempt} ${c.outcome}: ${c.why}`);
  }
  return lines.join('\n');
}

/**
 * Two runs side by side — the tool for deciding whether a transport change
 * (raw JSON today, a provider tomorrow) is worth its trade. Per kind: median
 * wall time, retry rate and schema retries, for A then B.
 */
export function formatComparison(
  a: readonly TraceRecord[],
  b: readonly TraceRecord[],
  labels: [string, string],
): string {
  const ka = new Map(summariseCalls(a).map((k) => [k.kind, k]));
  const kb = new Map(summariseCalls(b).map((k) => [k.kind, k]));
  const kinds = [...new Set([...ka.keys(), ...kb.keys()])].sort();
  const rate = (k?: KindSummary) => (k && k.calls > 0 ? pct(k.retries / k.calls) : '—');
  const lines = [
    `── ${labels[0]} vs ${labels[1]} ──`,
    '',
    'kind              calls A/B    p50 s A/B     retry A/B   schema A/B',
  ];
  for (const kind of kinds) {
    const x = ka.get(kind);
    const y = kb.get(kind);
    lines.push(
      [
        kind.padEnd(17),
        `${x?.calls ?? 0}/${y?.calls ?? 0}`.padStart(10),
        `${s(x?.wallP50 ?? null)}/${s(y?.wallP50 ?? null)}`.padStart(14),
        `${rate(x)}/${rate(y)}`.padStart(14),
        `${x?.schemaRetries ?? 0}/${y?.schemaRetries ?? 0}`.padStart(13),
      ].join(''),
    );
  }
  const endTurn = (rs: readonly TraceRecord[]) =>
    median(rs.filter((r): r is PhaseRecord => r.type === 'phase' && r.phase === 'end_turn' && r.step === 'end_turn').map((r) => r.wallMs));
  const declare = (rs: readonly TraceRecord[]) =>
    median(rs.filter((r): r is PhaseRecord => r.type === 'phase' && r.phase === 'declare' && r.step === 'declare').map((r) => r.wallMs));
  lines.push(
    '',
    `declared action p50: ${s(declare(a))}s / ${s(declare(b))}s    end of turn p50: ${s(endTurn(a))}s / ${s(endTurn(b))}s`,
  );
  return lines.join('\n');
}

/**
 * Chrome Trace Event format, for Perfetto or `chrome://tracing`: a waterfall of
 * every phase and call with no UI of our own to maintain.
 *
 * One process, one thread per phase kind, and model calls on their own thread
 * per concurrency slot so three parallel reactions draw as three bars rather
 * than one smeared over another.
 */
export function toPerfetto(records: readonly TraceRecord[]): {
  traceEvents: Record<string, unknown>[];
  displayTimeUnit: 'ms';
} {
  const t0 = Math.min(...records.map((r) => r.at));
  const events: Record<string, unknown>[] = [];
  for (const r of records) {
    const ts = (r.at - t0) * 1000;
    if (r.type === 'phase') {
      events.push({
        name: r.step === r.phase ? r.phase : `${r.phase}/${r.step}`,
        cat: 'phase',
        ph: 'X',
        ts,
        dur: r.wallMs * 1000,
        pid: 1,
        tid: r.step === r.phase ? 1 : 2,
        args: { turn: r.turn, actionId: r.actionId, ok: r.ok },
      });
    } else {
      const { type: _t, at: _a, ...args } = r;
      events.push({
        name: `${r.kind}${r.attempt > 1 ? ` #${r.attempt}` : ''}`,
        cat: r.outcome,
        ph: 'X',
        ts,
        dur: r.wallMs * 1000,
        pid: 1,
        tid: 10 + Math.max(0, r.concurrent - 1),
        args,
      });
    }
  }
  return { traceEvents: events, displayTimeUnit: 'ms' };
}
