import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/engine/campaign.js';
import { FileCampaignStore, MemoryCampaignStore } from '../src/engine/store.js';
import { replay, type Journal } from '../src/engine/journal.js';

describe('MemoryCampaignStore', () => {
  it('round-trips a save', async () => {
    const store = new MemoryCampaignStore();
    expect(await store.load('nope')).toBeNull();
    expect(await store.exists('nope')).toBe(false);

    const campaign = Campaign.start('ojjul', 'demo', store);
    campaign.stage([{ op: 'adjust_credits', factionId: 'ojjul', delta: -100 }], 'spend');
    campaign.commitTurn();
    await campaign.save();

    expect(await store.exists('demo')).toBe(true);
    expect(await store.list()).toEqual(['demo']);

    const file = await store.load('demo');
    expect(file?.version).toBe(1);
    expect(file?.journal.entries.length).toBeGreaterThan(1);
  });

  it('isolates stored data from the caller’s object', async () => {
    // A real file cannot be mutated by whoever wrote it; the memory store
    // must not behave differently, or tests would pass for the wrong reason.
    const store = new MemoryCampaignStore();
    const campaign = Campaign.start('drajk', 'iso', store);
    await campaign.save();

    const first = (await store.load('iso'))!;
    first.journal.entries.push({ kind: 'tick' });

    const second = (await store.load('iso'))!;
    expect(second.journal.entries).toHaveLength(1);
  });

  it('lists saves in a stable order', async () => {
    const store = new MemoryCampaignStore();
    for (const name of ['zeta', 'alpha', 'mid']) {
      await Campaign.start('vigil', name, store).save();
    }
    expect(await store.list()).toEqual(['alpha', 'mid', 'zeta']);
  });
});

describe('FileCampaignStore', () => {
  it('refuses a name that would escape the save directory', async () => {
    const store = new FileCampaignStore('/tmp/paxgalactica-test-does-not-exist');
    // Nothing untrusted reaches this today, but an HTTP route is one step away.
    await expect(store.load('../../etc/passwd')).rejects.toThrow(/Invalid campaign name/);
    await expect(store.save('a/b', {} as never)).rejects.toThrow(/Invalid campaign name/);
  });

  it('returns null for a missing campaign rather than throwing', async () => {
    const store = new FileCampaignStore('/tmp/paxgalactica-test-does-not-exist');
    expect(await store.load('absent')).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});

describe('Campaign with an injected store', () => {
  it('loads back to identical committed state', async () => {
    const store = new MemoryCampaignStore();
    const original = Campaign.start('meridian', 'reload', store);

    original.stage(
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'construction_infrastructure',
          originId: 'sek-1', targetId: 'sek-1', durationTurns: 3, label: 'Sekkar slipway',
        },
      ],
      'build',
    );
    original.commitTurn();
    original.tick();
    original.recordTranscript('ojjul', [{ speaker: 'player', text: 'Terms?' }]);
    await original.save();

    const loaded = await Campaign.load('reload', store);
    expect(loaded).not.toBeNull();
    expect(JSON.stringify(loaded!.state)).toBe(JSON.stringify(original.state));
    expect(loaded!.priorTranscripts('ojjul')).toHaveLength(1);
    expect(loaded!.verifyReplay().ok).toBe(true);
  });

  it('returns null when loading a campaign that does not exist', async () => {
    expect(await Campaign.load('ghost', new MemoryCampaignStore())).toBeNull();
  });

  it('never persists staged actions — they are not world state', async () => {
    const store = new MemoryCampaignStore();
    const campaign = Campaign.start('freeworlds', 'staged', store);
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: 500 }], 'windfall');
    await campaign.save();

    const reloaded = await Campaign.load('staged', store);
    expect(reloaded!.stagedCount).toBe(0);
    expect(reloaded!.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(1100);
  });

  it('produces a save file whose journal replays byte-identically', async () => {
    const store = new MemoryCampaignStore();
    const campaign = Campaign.start('vigil', 'determinism', store);
    campaign.stage(
      [{ op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-2', targetId: 'tor-4' }],
      'move',
    );
    campaign.commitTurn();
    campaign.tick();
    campaign.tick();

    const file = campaign.toSaveFile();
    const rebuilt = replay(file.journal as Journal).state;
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(campaign.state));
  });
});
