import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FactionListSchema, DeleteSaveResultSchema, ROUTES } from '../src/api/contract.js';
import { FileCampaignStore, MemoryCampaignStore, summarise } from '../src/engine/store.js';
import { dispatch } from '../src/server/router.js';
import { GameSession } from '../src/server/session.js';

/** The title screen lists saves with whose, how far and when, and can delete one. */

describe('a save summary', () => {
  it('is read off the journal', () => {
    const entries = [{ kind: 'seed', playerFactionId: 'drajk', maxTurns: 10 }, { kind: 'tick' }, { kind: 'ops' }, { kind: 'tick' }];
    expect(summarise('x', { journal: { entries } }, null)).toEqual({
      name: 'x', playerFactionId: 'drajk', turn: 2, maxTurns: 10, savedAt: null, finished: false,
    });
    expect(summarise('y', { journal: { entries }, epilogue: {} }, null).finished).toBe(true);
    expect(summarise('z', null, null)).toMatchObject({ name: 'z', playerFactionId: null, turn: 0 });
  });
});

describe('the saves route', () => {
  it('lists saves newest first with their power, and deletes one', async () => {
    const store = new MemoryCampaignStore();
    await new GameSession(store).newCampaign('meridian', 'older', 20);
    await new Promise((r) => setTimeout(r, 5));
    await new GameSession(store).newCampaign('drajk', 'newer');
    const list = FactionListSchema.parse((await dispatch(new GameSession(store), 'GET', ROUTES.factions, {})).body);
    expect(list.saveDetails.map((s) => [s.name, s.playerFactionId, s.maxTurns])).toEqual([
      ['newer', 'drajk', null],
      ['older', 'meridian', 20],
    ]);
    expect(list.saves).toEqual(['newer', 'older']);

    const res = await dispatch(new GameSession(store), 'POST', ROUTES.deleteSave, { name: 'older' });
    const out = DeleteSaveResultSchema.parse(res.body);
    expect(out.deleted).toBe(true);
    expect(out.saveDetails.map((s) => s.name)).toEqual(['newer']);
    expect(await store.exists('older')).toBe(false);
  });

  it('refuses a name that could leave the save directory', async () => {
    const res = await dispatch(new GameSession(new MemoryCampaignStore()), 'POST', ROUTES.deleteSave, { name: '../x' });
    expect(res.status).toBe(400);
  });
});

describe('a file store', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('deletes the save and its trace together', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pax-saves-'));
    const store = new FileCampaignStore(dir);
    await new GameSession(store).newCampaign('freeworlds', 'gone');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(store.tracePath('gone'), '{}\n');
    expect((await store.describe())[0]).toMatchObject({ name: 'gone', turn: 0 });
    expect(await store.remove('gone')).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect(await store.remove('gone')).toBe(false);
  });
});
