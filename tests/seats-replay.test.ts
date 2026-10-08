import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { JOURNAL_VERSION } from '../src/engine/journal.js';
import { seatedAt } from '../src/domain/seats.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { BOTS, brokeredAccords, proposeFor } from '../src/domain/initiative.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * The court through a journaled campaign — journal version 20 — must rebuild
 * to the same world: stipends, a reseating that takes a prisoner, a marriage
 * with a ward, and the ticks that move favour and regard — and the bots'
 * courts, matches and seducers over twenty turns.
 */
describe('a campaign under version 20 replays exactly', () => {
  it('with stipends, a conquest reseated, and a marriage with its ward', () => {
    const campaign = Campaign.start('meridian', 'v20', new MemoryCampaignStore());
    expect(campaign.toSaveFile().journal.version).toBe(JOURNAL_VERSION);
    const s0 = campaign.state;
    const named = (name: string) => s0.systems.find((x) => x.name === name)!;
    const notableAt = (name: string) => seatedAt(campaign.state, named(name).id)[0]!;

    campaign.stage([{ op: 'grant_stipend', factionId: 'meridian', estate: 'Standards & Practices' }], 'stipend', '', 'model', 'meridian');
    campaign.stage(
      [
        {
          op: 'form_treaty',
          treatyType: 'marriage',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [notableAt('Brannix').id, notableAt('Sarsuma').id], ward: notableAt('Sarsuma').id },
          summary: 'a marriage',
        },
      ],
      'marriage',
      '',
      'extraction',
      'meridian',
    );
    campaign.commitTurn();
    campaign.tick();

    // Kalzir taken (as the engine would on an arrival), then reseated.
    campaign.stage([{ op: 'transfer_control', systemId: named('Kalzir').id, toFactionId: 'meridian' }], 'taken', '', 'engine');
    campaign.commitTurn();
    campaign.stage(
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named('Kalzir').id, estate: 'security' }],
      'reseat',
      '',
      'model',
      'meridian',
    );
    campaign.commitTurn();
    for (let i = 0; i < 4; i++) campaign.tick();

    const s = campaign.state;
    expect(s.assets.some((a) => a.notableId)).toBe(true);
    expect(s.treaties.some((t) => t.type === 'marriage')).toBe(true);
    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
  });

  it('with the bots keeping their courts for twenty turns', () => {
    // Played the way `endTurn` plays the bots, then rebuilt from the journal
    // the harness keeps: every court op the bots chose replays to one world.
    const campaign = Campaign.start('freeworlds', 'bots20', new MemoryCampaignStore());
    for (let turn = 0; turn < 20; turn++) {
      for (const id of Object.keys(BOTS).sort()) {
        if (id === 'freeworlds') continue;
        const p = proposeFor(campaign.state, id, (ops) => applyOps(campaign.state, ops, 'model', id, true).rejections.length === 0);
        if (p) campaign.stage(p.ops, `bot ${id}`, '', 'model', id);
        campaign.commitTurn();
      }
      for (const accord of brokeredAccords(campaign.state)) campaign.stage(accord.ops, accord.label, '', 'engine');
      campaign.commitTurn();
      campaign.tick();
    }
    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
    expect(campaign.state.factions.some((f) => f.estates.some((e) => e.favour !== 0))).toBe(true);
  });

  it('rebuilds a journal from before version 20 with no court at all', () => {
    const old = createSeedState('meridian', { seats: false });
    const after = tickTurn(old, { randomEvents: false }).state;
    expect(after.notables).toEqual([]);
    expect(after.factions.every((f) => f.estates.length === 0)).toBe(true);
  });
});
