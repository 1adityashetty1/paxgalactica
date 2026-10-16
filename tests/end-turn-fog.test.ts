import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { endTurn } from '../src/engine/turn.js';

/**
 * The end-turn response is printed in the player's feed, so it may carry only
 * what the player may read — playtest 2026-10-16 found every rival's operative
 * postings in it.
 */
describe('the end-turn notes', () => {
  it('carry nothing the log keeps from the player, over a run of quiet turns', async () => {
    const c = Campaign.start('meridian', 'fog', new MemoryCampaignStore());
    const me = c.state.playerFactionId;
    for (let i = 0; i < 12; i++) {
      const from = c.state.eventLog.length;
      const out = await endTurn(c);
      const hidden = new Set(
        c.state.eventLog.slice(from).filter((e) => e.visibleTo && !e.visibleTo.includes(me)).map((e) => e.text),
      );
      for (const note of out.notes) expect(hidden.has(note), note).toBe(false);
      // No rival operative's posting reaches the feed.
      for (const note of out.notes) expect(note, note).not.toMatch(/ leaves .+ for .+ on [a-z]+, for \d+ credits/);
    }
  }, 60_000);
});
