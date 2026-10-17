import { describe, expect, it, vi } from 'vitest';

/**
 * `/advisor <question>`: the leader may put a question to the counsellor in
 * the same action. With nothing after the command the counsellor says what is
 * worrying them, as before. Either way it is one action, and the answer is held
 * to the same rule: what bears on it, never the steps.
 */

const calls: { kind: string; user: string }[] = [];

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    return {
      value: { counsel: 'Vantic is held by the Vigil line, First Elder, and it will not be cheap.' },
      attempts: 1,
      costUsd: 0,
    };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { GameSession } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');
const { dispatch } = await import('../src/server/router.js');
const { ROUTES, AdvisorOutcomeSchema } = await import('../src/api/contract.js');
const { ACTION_POINTS_PER_TURN } = await import('../src/engine/campaign.js');

async function started() {
  const session = new GameSession(new MemoryCampaignStore());
  await session.newCampaign('ojjul', 'advisor-question');
  return session;
}

describe('a question for the advisor', () => {
  it('reaches the counsellor as the leader’s words, and costs one action', async () => {
    calls.length = 0;
    const session = await started();
    const question = 'What is the best way to take over Vantic with minimal losses?';
    const res = await dispatch(session, 'POST', ROUTES.advisor, { question });
    expect(res.status).toBe(200);
    expect(AdvisorOutcomeSchema.parse(res.body).counsel).toContain('Vantic');
    const user = calls.find((c) => c.kind === 'advisor')!.user;
    expect(user).toContain('## Your leader asks');
    expect(user).toContain(`> ${question}`);
    expect(user).toMatch(/do not lay out the steps/);
    expect(session.view().actionPoints.left).toBe(ACTION_POINTS_PER_TURN - 1);
  });

  it('asks the standing question when nothing is asked', async () => {
    for (const body of [{}, { question: '' }, { question: '   ' }]) {
      calls.length = 0;
      const session = await started();
      const res = await dispatch(session, 'POST', ROUTES.advisor, body);
      expect(res.status).toBe(200);
      const user = calls.find((c) => c.kind === 'advisor')!.user;
      expect(user).not.toContain('Your leader asks');
      expect(user).toContain('Name what is pressing');
    }
  });

  it('refuses a question longer than an answer could carry', async () => {
    const session = await started();
    const res = await dispatch(session, 'POST', ROUTES.advisor, { question: 'x'.repeat(401) });
    expect(res.status).toBe(400);
    expect(session.view().actionPoints.left).toBe(ACTION_POINTS_PER_TURN);
  });
});
