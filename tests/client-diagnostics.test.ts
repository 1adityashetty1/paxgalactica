import { beforeEach, describe, expect, it } from 'vitest';
import { CALL_TIMEOUT_MS, stats, timingReport } from '../src/model/client.js';

/**
 * The parts of the model client that exist to answer "where did the turn go".
 *
 * The playtest of 2026-09-09 had to derive its timings from `curl` outside the
 * process, which cannot see a retry — and a retried call looks exactly like a
 * slow one from there, while the two want opposite fixes.
 */
describe('call timings are visible from inside the process', () => {
  beforeEach(() => {
    stats.calls = 0;
    stats.costUsd = 0;
    stats.retries = 0;
    stats.byKind = {};
    stats.failures = [];
  });

  it('says so plainly when nothing has run', () => {
    expect(timingReport()).toMatch(/no model calls/i);
  });

  it('reports each kind with its own wall clock and retries', () => {
    stats.byKind['resolution'] = { calls: 2, seconds: 48, costUsd: 0.11, retries: 0 };
    stats.byKind['appraisal'] = { calls: 6, seconds: 88, costUsd: 0.12, retries: 2 };
    const out = timingReport();
    // Slowest first: the line you would act on should not be the last one read.
    expect(out.indexOf('appraisal')).toBeLessThan(out.indexOf('resolution'));
    expect(out).toMatch(/appraisal\s+6\s+88\.0\s+14\.7\s+2/);
  });

  it('shows why a call was retried, not merely that it was', () => {
    stats.byKind['appraisal'] = { calls: 1, seconds: 12, costUsd: 0.01, retries: 1 };
    stats.failures.push({
      kind: 'appraisal',
      label: 'the arbiter considers it',
      why: '(root): Invalid input: expected object, received string',
    });
    expect(timingReport()).toContain('expected object, received string');
  });
});

describe('a call that goes silent is abandoned', () => {
  it('waits far longer than any legitimate call, and not forever', () => {
    // `query()` has no timeout of its own, so a wedged child process is waited
    // on until something else gives up: measured live, one action sat for 923s
    // and returned nothing at all. The budget has to clear the slowest real
    // call by a wide margin — reaction ran a 29-31s median — so that a timeout
    // means something is wrong rather than something is slow.
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(120_000);
    expect(CALL_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});
