import { describe, expect, it } from 'vitest';
import { ROUTES, type CampaignView } from '../src/api/contract.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { BUILD_ID, GameSession, type SessionSnapshot } from '../src/server/session.js';
import { handleStateless } from '../src/server/stateless.js';

/**
 * The server keeps nothing between requests: the browser carries the session.
 * Every request here gets a FRESH store and a fresh `GameSession`, so the only
 * thing one request can learn from another is the snapshot passed between
 * them — exactly as it would be across two Cloud Run instances.
 */

const call = (path: string, session: unknown, body: unknown = {}, extra: object = {}) =>
  handleStateless('POST', path, { session, body, ...extra }, { store: new MemoryCampaignStore() });

async function started(): Promise<SessionSnapshot> {
  const res = await call(ROUTES.newCampaign, null, { factionId: 'freeworlds', name: 'roam' });
  expect(res.result.status).toBe(200);
  expect(res.session).not.toBeNull();
  return res.session!;
}

/** Stage without a model call, by restoring, reaching past the API, and snapshotting. */
function withStaged(snapshot: SessionSnapshot): SessionSnapshot {
  const s = new GameSession(new MemoryCampaignStore());
  s.restore(snapshot);
  const campaign = (s as unknown as { campaign: Campaign }).campaign;
  campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -100 }], 'spend');
  campaign.spendActionPoint();
  return s.snapshot()!;
}

const credits = (view: CampaignView) => view.state.factions.find((f) => f.id === 'freeworlds')!.credits;

describe('a stateless server', () => {
  it('starts a campaign from nothing and hands the session back', async () => {
    const session = await started();
    expect(session.campaign.name).toBe('roam');
    expect(session.campaign.build).toBe(BUILD_ID);
  });

  it('serves a read from the session alone, on a server that has never seen it', async () => {
    const session = await started();
    const res = await call(ROUTES.campaign, session);
    expect(res.result.status).toBe(200);
    expect((res.result.body as CampaignView).name).toBe('roam');
  });

  it('refuses to guess without one', async () => {
    const res = await call(ROUTES.campaign, null);
    expect(res.result.status).toBe(409);
    expect((res.result.body as { error: { code: string } }).error.code).toBe('no_campaign');
  });

  it('carries a turn in progress: staged declarations and spent action points', async () => {
    const session = withStaged(await started());
    const view = (await call(ROUTES.campaign, session)).result.body as CampaignView;
    expect(view.staged.map((b) => b.label)).toEqual(['spend']);
    expect(view.actionPoints.left).toBe(view.actionPoints.perTurn - 1);
    // The preview is rebuilt from committed state plus what was staged.
    expect(credits(view)).toBe(1000);
  });

  it('lands staged declarations when the turn ends, in a later request', async () => {
    const session = withStaged(await started());
    const ended = await call(ROUTES.endturn, session);
    expect(ended.result.status).toBe(200);
    const next = ended.session!;
    expect(next.campaign.staged).toEqual([]);
    expect(next.campaign.save.journal.entries.some((e) => (e as { label?: string }).label === 'spend')).toBe(true);

    // The world it hands back is the one its journal rebuilds.
    const s = new GameSession(new MemoryCampaignStore());
    s.restore(next);
    expect((s as unknown as { campaign: Campaign }).campaign.verifyReplay().ok).toBe(true);
  });

  it('replays a snapshot written by another build instead of trusting its world', async () => {
    const session = withStaged(await started());
    // A world from another build is ignored: nothing it says is read.
    const foreign: SessionSnapshot = {
      ...session,
      campaign: { ...session.campaign, build: 'some-older-revision', committed: { junk: true } },
    };
    const view = (await call(ROUTES.campaign, foreign)).result.body as CampaignView;
    expect(credits(view)).toBe(1000);
    expect(view.staged).toHaveLength(1);
  });

  it('falls back to replay when this build’s world does not parse', async () => {
    const session = await started();
    const broken = { ...session, campaign: { ...session.campaign, committed: { junk: true } } };
    const res = await call(ROUTES.campaign, broken);
    expect(res.result.status).toBe(200);
  });

  it('turns an unreadable session into no_campaign, so the browser can start over', async () => {
    const res = await call(ROUTES.campaign, { v: 1, nonsense: true });
    expect(res.result.status).toBe(409);
    expect(res.session).toBeNull();
  });

  it('keeps an open channel open across requests', async () => {
    const session = await started();
    const open: SessionSnapshot = {
      ...session,
      channel: { ...session.channel, open: 'ojjul', history: [{ speaker: 'player', text: 'hello' }] },
    };
    const res = await call(ROUTES.endturn, open);
    // The diplomacy boundary is enforced on a restored session exactly as on a
    // live one: no ending the turn with a channel open.
    expect(res.result.status).toBe(409);
    expect(res.session!.channel.open).toBe('ojjul');
  });

  it('returns a save file as data, which loads on another server', async () => {
    const session = withStaged(await started());
    const exported = await call(ROUTES.exportCampaign, session);
    const { archiveBase64, filename } = exported.result.body as { archiveBase64: string; filename: string };
    expect(filename).toMatch(/^roam-.*\.tar\.gz$/);

    const loaded = await call(ROUTES.importCampaign, null, { archiveBase64 });
    expect(loaded.result.status).toBe(200);
    expect(loaded.session!.campaign.staged.map((b) => b.label)).toEqual(['spend']);
  });

  it('hands a campaign the server was started with to the first page that boots', async () => {
    const store = new MemoryCampaignStore();
    const origin = Campaign.start('vigil', 'resumed', store);
    await origin.save();
    let pending: string | null = 'resumed';
    const takeAutoload = () => {
      const name = pending;
      pending = null;
      return name;
    };
    const boot = (session: unknown) =>
      handleStateless('POST', ROUTES.campaign, { session, boot: true }, { store, takeAutoload });

    const first = await boot(null);
    expect((first.result.body as CampaignView).name).toBe('resumed');
    // Once only: a reload after that keeps whatever the browser now holds.
    const second = await boot(null);
    expect(second.result.status).toBe(409);
  });
});
