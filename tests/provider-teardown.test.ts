import { describe, expect, it, vi } from 'vitest';

/**
 * A silent call is abandoned at `CALL_TIMEOUT_MS`, and abandoning it must not
 * then wait on the hung process. The teardown awaited `q.return()`, which the
 * hung binary never answered: a call the trace said "went silent for 180s"
 * ran 542s before the turn could go on (bughunt 2026-10-29).
 */
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => ({
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(() => {}) };
    },
    return: () => new Promise(() => {}),
  }),
}));

const { subscriptionProvider, CALL_TIMEOUT_MS } = await import('../src/model/provider.js');

describe('a hung subscription call', () => {
  it('is given up at the deadline, whether or not its process answers the teardown', async () => {
    vi.useFakeTimers();
    try {
      const call = subscriptionProvider.call({ kind: 'appraisal', system: 's', user: 'u', jsonSchema: {}, rawJson: true }, {});
      const settled = call.then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 10_000);
      const outcome = await Promise.race([settled, Promise.resolve('still waiting')]);
      expect(outcome).toMatch(/went silent/);
    } finally {
      vi.useRealTimers();
    }
  });
});
