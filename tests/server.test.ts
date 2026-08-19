import { describe, expect, it, vi } from 'vitest';
import {
  ApiErrorSchema,
  CampaignViewSchema,
  ROUTES,
  ServerEventSchema,
  type ServerEvent,
} from '../src/api/contract.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { dispatch } from '../src/server/router.js';
import { GameSession } from '../src/server/session.js';
import { ApiFailure, parseBody, toApiFailure } from '../src/server/errors.js';
import { serveStatic } from '../src/server/static.js';
import { z } from 'zod';

/**
 * The whole API is exercised through `dispatch`, with no port bound and no
 * node:http involved. Model-backed routes are covered for their guard and
 * validation behaviour only — PAXGALACTICA_NO_NETWORK=1 makes any real call
 * throw, which is the point.
 */

const newSession = () => {
  const events: ServerEvent[] = [];
  const session = new GameSession(new MemoryCampaignStore(), (e) => events.push(e));
  return { session, events };
};

const startedSession = async () => {
  const { session, events } = newSession();
  await session.newCampaign('freeworlds', 'test');
  return { session, events };
};

describe('routing', () => {
  it('404s an unknown route with a structured error', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'GET', '/api/nope', {});
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('lists factions and saves before any campaign exists', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'GET', ROUTES.factions, {});
    expect(res.status).toBe(200);
    const body = res.body as { factions: unknown[]; saves: string[] };
    expect(body.factions).toHaveLength(5);
    expect(body.saves).toEqual([]);
  });

  it('refuses gameplay routes until a campaign is loaded', async () => {
    const { session } = newSession();
    for (const [method, path] of [
      ['GET', ROUTES.campaign],
      ['POST', ROUTES.endturn],
      ['POST', ROUTES.discardStaged],
    ] as const) {
      const res = await dispatch(session, method, path, {});
      expect(res.status, `${method} ${path}`).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe('no_campaign');
    }
  });

  it('creates a campaign and returns a valid view', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'POST', ROUTES.newCampaign, { factionId: 'hutt' });
    expect(res.status).toBe(200);
    const parsed = CampaignViewSchema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(parsed.data!.state.playerFactionId).toBe('hutt');
  });

  it('rejects an unknown faction', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'POST', ROUTES.newCampaign, { factionId: 'ewoks' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed body with field detail', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'POST', ROUTES.newCampaign, { factionId: '' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/factionId/);
  });

  it('resumes a saved campaign and 404s a missing one', async () => {
    const store = new MemoryCampaignStore();
    const first = new GameSession(store);
    await first.newCampaign('vigil', 'saved-run');

    const second = new GameSession(store);
    expect((await dispatch(second, 'POST', ROUTES.resume, { name: 'saved-run' })).status).toBe(200);
    expect((await dispatch(second, 'POST', ROUTES.resume, { name: 'ghost' })).status).toBe(404);
  });

  it('rejects a campaign name that could escape the save directory', async () => {
    const { session } = newSession();
    const res = await dispatch(session, 'POST', ROUTES.resume, { name: '../../etc/passwd' });
    expect(res.status).toBe(400);
  });

  it('rejects a path-like faction id on the talk route', async () => {
    const { session } = await startedSession();
    const res = await dispatch(session, 'POST', '/api/talk/..%2F..%2Fetc', { text: 'hi' });
    expect(res.status).toBe(404);
  });
});

describe('staging', () => {
  it('discards staged actions', async () => {
    const { session } = await startedSession();
    const res = await dispatch(session, 'POST', ROUTES.discardStaged, {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ discarded: 0 });
  });
});

describe('per-item staged discard', () => {
  const withTwo = async () => {
    const { session } = await startedSession();
    const campaign = (session as unknown as { campaign: import('../src/engine/campaign.js').Campaign })
      .campaign;
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -100 }], 'first', 'a');
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -200 }], 'second', 'b');
    return { session, campaign };
  };

  it('drops one declaration and keeps the rest', async () => {
    const { session } = await withTwo();
    expect(session.view().staged).toHaveLength(2);

    const res = await dispatch(session, 'POST', ROUTES.discardStaged, { index: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ discarded: 1 });

    const staged = session.view().staged;
    expect(staged).toHaveLength(1);
    expect(staged[0]!.label).toBe('second');
    // Indices are renumbered so the client can address the survivor.
    expect(staged[0]!.index).toBe(0);
  });

  it('rebuilds the preview from committed state after a removal', async () => {
    const { session } = await withTwo();
    // 1100 − 100 − 200 = 800 with both staged.
    expect(session.view().state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(800);
    await dispatch(session, 'POST', ROUTES.discardStaged, { index: 0 });
    // Removing the first must replay the second against committed state, not
    // merely add 100 back.
    expect(session.view().state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(900);
  });

  it('clears everything when no index is given', async () => {
    const { session } = await withTwo();
    const res = await dispatch(session, 'POST', ROUTES.discardStaged, {});
    expect(res.body).toEqual({ discarded: 2 });
    expect(session.view().staged).toHaveLength(0);
  });

  it('rejects an out-of-range index', async () => {
    const { session } = await withTwo();
    expect((await dispatch(session, 'POST', ROUTES.discardStaged, { index: 9 })).status).toBe(400);
    expect((await dispatch(session, 'POST', ROUTES.discardStaged, { index: -1 })).status).toBe(400);
  });

  it('carries each declaration’s narrative for the UI', async () => {
    const { session } = await withTwo();
    expect(session.view().staged.map((s) => s.narrative)).toEqual(['a', 'b']);
  });
});

describe('resuming restores a briefing', () => {
  it('shows work in progress rather than an empty report', async () => {
    const store = new MemoryCampaignStore();
    const first = new GameSession(store);
    await first.newCampaign('freeworlds', 'resumed');
    const campaign = (first as unknown as { campaign: import('../src/engine/campaign.js').Campaign })
      .campaign;
    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
          originId: 'ark-1', targetId: 'ark-1', durationTurns: 3, label: 'Arkanis slipway',
        },
      ],
      'build',
    );
    campaign.commitTurn();
    campaign.tick();
    await campaign.save();

    const second = new GameSession(store);
    await second.resume('resumed');
    const briefing = second.view().briefing;

    // Without this the panel says "end a turn to see the report" while a
    // shipyard is two turns from completion.
    expect(briefing).not.toBeNull();
    expect(briefing!.inProgress).toHaveLength(1);
    expect(briefing!.inProgress[0]!.label).toBe('Arkanis slipway');
    expect(briefing!.quiet).toBe(false);
    // Nothing completed *this* turn, because no turn has happened yet.
    expect(briefing!.completed).toHaveLength(0);
  });
});

describe('the busy guard', () => {
  it('refuses a second model call while one is in flight', async () => {
    const { session } = await startedSession();

    // Hold the guard open with a call that never resolves on its own.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const inflight = (session as unknown as {
      exclusive: <T>(label: string, work: () => Promise<T>) => Promise<T>;
    }).exclusive('Resolving', async () => {
      await held;
      return 'done';
    });

    expect(session.isBusy).toBe(true);
    const rejected = await dispatch(session, 'POST', ROUTES.action, { text: 'fortify Dolomar' });
    expect(rejected.status).toBe(409);
    expect((rejected.body as { error: { code: string } }).error.code).toBe('conflict');

    release();
    await inflight;
    expect(session.isBusy).toBe(false);
  });

  it('clears the guard even when the work throws', async () => {
    const { session } = await startedSession();
    // A model call under PAXGALACTICA_NO_NETWORK=1 throws; the session must
    // not be left permanently busy by it.
    const res = await dispatch(session, 'POST', ROUTES.action, { text: 'raid Ithaal' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(session.isBusy).toBe(false);
  });
});

describe('the diplomacy boundary is enforced server-side', () => {
  it('blocks actions and end-of-turn while a channel is open', async () => {
    const { session } = await startedSession();
    // Force the channel open without a model call.
    (session as unknown as { openChannel: string | null }).openChannel = 'hutt';

    for (const [path, body] of [
      [ROUTES.action, { text: 'attack' }],
      [ROUTES.endturn, {}],
    ] as const) {
      const res = await dispatch(session, 'POST', path, body);
      expect(res.status, path).toBe(409);
    }
  });

  it('refuses a second, different channel', async () => {
    const { session } = await startedSession();
    (session as unknown as { openChannel: string | null }).openChannel = 'hutt';
    const res = await dispatch(session, 'POST', ROUTES.talk('vigil'), { text: 'hello' });
    expect(res.status).toBe(409);
  });

  it('refuses to open a channel with yourself', async () => {
    const { session } = await startedSession();
    const res = await dispatch(session, 'POST', ROUTES.talk('freeworlds'), { text: 'hi' });
    expect(res.status).toBe(400);
  });

  it('404s an unknown faction', async () => {
    const { session } = await startedSession();
    const res = await dispatch(session, 'POST', ROUTES.talk('gungans'), { text: 'hi' });
    expect(res.status).toBe(404);
  });

  it('endTalk without an open channel is a conflict', async () => {
    const { session } = await startedSession();
    const res = await dispatch(session, 'POST', ROUTES.endtalk('hutt'), {});
    expect(res.status).toBe(409);
  });

  /**
   * `closeChannel` appraises what a transcript agreed and can refuse the whole
   * accord on a red line, or let it stand and charge for a compulsion. Both
   * rulings were computed correctly and then dropped on the floor here, because
   * this handler wrote `refusal: null, defiance: null` literally — so the
   * browser was handed a refused accord as an ordinary narrative and had
   * nothing to draw. The engine is stubbed because the real path is a model
   * call; what is under test is the wiring between it and the response.
   */
  it('passes a channel refusal through to the response', async () => {
    vi.resetModules();
    vi.doMock('../src/engine/turn.js', async () => {
      const actual = await vi.importActual<typeof import('../src/engine/turn.js')>(
        '../src/engine/turn.js',
      );
      return {
        ...actual,
        closeChannel: async () => ({
          narrative: 'The Assembly will not put its name to it.',
          refusal: {
            by: 'the Arkanis Assembly',
            reason: 'It is occupation by another name.',
            violated: 'will never accept occupation',
          },
          staged: 1,
          notes: [],
          rejections: [],
          costUsd: 0,
          ops: [],
        }),
      };
    });
    try {
      const { GameSession: Fresh } = await import('../src/server/session.js');
      const session = new Fresh(new MemoryCampaignStore(), () => {});
      await session.newCampaign('freeworlds', 'refused-accord');
      (session as unknown as { openChannel: string | null }).openChannel = 'vigil';

      const outcome = await session.endTalk('vigil');
      expect(outcome.refusal).toMatchObject({ violated: 'will never accept occupation' });
      expect(outcome.defiance).toBeNull();
    } finally {
      vi.doUnmock('../src/engine/turn.js');
      vi.resetModules();
    }
  });
});

describe('events', () => {
  it('pushes a valid state event when a campaign starts', async () => {
    const { session, events } = newSession();
    await session.newCampaign('krayt', 'evented');
    const stateEvents = events.filter((e) => e.type === 'state');
    expect(stateEvents.length).toBeGreaterThan(0);
    for (const e of events) expect(ServerEventSchema.safeParse(e).success).toBe(true);
  });

  it('brackets a busy operation with progress on and off', async () => {
    const { session, events } = await startedSession();
    await dispatch(session, 'POST', ROUTES.action, { text: 'anything' });
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress.at(0)).toMatchObject({ busy: true });
    expect(progress.at(-1)).toMatchObject({ busy: false });
  });
});

describe('error mapping', () => {
  it('maps auth failures away from a generic 500', () => {
    const failure = toApiFailure(new Error('Claude Code is not signed in, so no model calls'));
    expect(failure.code).toBe('not_authenticated');
    expect(failure.status).toBe(401);
  });

  it('maps a rejected token to auth, not to an upstream error', () => {
    expect(toApiFailure(new Error('API Error: 401 OAuth access token is invalid')).code).toBe(
      'not_authenticated',
    );
  });

  it('preserves an explicit ApiFailure', () => {
    const original = new ApiFailure('conflict', 'busy');
    expect(toApiFailure(original)).toBe(original);
  });

  it('falls back to internal for anything unrecognised', () => {
    expect(toApiFailure(new Error('disk on fire')).status).toBe(500);
  });

  it('parseBody reports the offending field', () => {
    expect(() => parseBody(z.object({ n: z.number() }), { n: 'x' })).toThrow(/n:/);
  });
});

describe('static file serving', () => {
  const fakeRes = () => {
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    return res as unknown as import('node:http').ServerResponse & { writeHead: ReturnType<typeof vi.fn> };
  };

  it('returns false when the client has not been built', () => {
    expect(serveStatic('/tmp/paxgalactica-no-such-web-root', '/', fakeRes())).toBe(false);
  });

  it('refuses to escape the web root', () => {
    // Even against a real directory, `..` must not reach outside it.
    expect(serveStatic(process.cwd(), '/../../../../etc/passwd', fakeRes())).toBe(false);
  });
});
