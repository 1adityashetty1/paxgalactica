import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { isCommodity, isNote, truceBetween } from '../src/domain/diplomacy.js';
import { JOURNAL_VERSION } from '../src/engine/journal.js';

/**
 * The journal-version-12 mechanics that write state from a negotiation —
 * a truce, a note called in, goods carried by an accord — played through a
 * journaled campaign, whose ticks also run the span of control. It must rebuild
 * to the same world.
 */
describe('a campaign under version 12 replays exactly', () => {
  it('with a truce, a note called in, and goods carried', () => {
    const campaign = Campaign.start('meridian', 'v12', new MemoryCampaignStore());
    expect(campaign.toSaveFile().journal.version).toBe(JOURNAL_VERSION);

    // The Vigil and the Confederacy make peace, which leaves a truce.
    campaign.stage(
      [{ op: 'form_treaty', parties: ['vigil', 'drajk'], treatyType: 'ceasefire', terms: {}, durationTurns: 2, summary: 'peace' }],
      'peace',
      '',
      'extraction',
      'vigil',
    );
    // Meridian supplies the Confederacy under an accord.
    campaign.stage(
      [{ op: 'form_treaty', parties: ['meridian', 'drajk'], treatyType: 'trade_accord', terms: { commodities: ['meridian'] }, summary: 'supply' }],
      'supply',
      '',
      'extraction',
    );
    // The Free Worlds hand Meridian their note.
    const sanctuary = campaign.state.assets.find((a) => isNote(a) && a.issuedBy === 'freeworlds')!;
    campaign.stage([{ op: 'transfer_asset', assetId: sanctuary.id, toFactionId: 'meridian' }], 'gift', '', 'model', 'freeworlds');
    campaign.commitTurn();
    campaign.tick();

    campaign.stage([{ op: 'play_note', assetId: sanctuary.id }], 'sanctuary');
    campaign.commitTurn();
    for (let i = 0; i < 3; i++) campaign.tick();

    const s = campaign.state;
    expect(truceBetween(s.truces, s.turn, 'vigil', 'drajk')).toBeDefined();
    expect(s.treaties.some((t) => t.type === 'basing_rights')).toBe(true);
    expect(s.assets.find((a) => a.id === sanctuary.id)!.heldBy).toBe('freeworlds');
    expect(s.assets.some((a) => isCommodity(a) && a.issuedBy === 'ojjul')).toBe(true);

    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
  });
});
