import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/engine/campaign.js';

describe('End Turn notes', () => {
  it('do not repeat a batch that landed nothing, which was reported when it was declared', () => {
    const campaign = Campaign.start('meridian', 'commit-notes');
    // Atomic: the unknown faction sinks the whole batch, as a failed first attempt does.
    const failed = campaign.stage(
      [
        { op: 'log_narrative', text: 'A first draft.' },
        { op: 'pay', factionId: 'meridian', to: 'nobody', amount: 10 },
      ],
      'declared:first',
    );
    expect(failed.notes.some((n) => n.startsWith('Nothing in this batch was applied'))).toBe(true);
    campaign.stage([{ op: 'log_narrative', text: 'The corrected order.' }], 'declared:correction');
    const { notes } = campaign.commitTurn();
    expect(notes.some((n) => n.startsWith('Nothing in this batch was applied'))).toBe(false);
    // Both are journaled, so replay reproduces the rejection.
    expect(campaign.verifyReplay().ok).toBe(true);
  });
});

describe('a correction said once', () => {
  it('names each thing left out once, however many batches noted it', async () => {
    const { draftWithCorrection } = await import('../src/engine/turn.js');
    const note = 'A lasting arrangement is recorded only when the arbiter ruled one: left out fleet_reorganization.';
    expect(draftWithCorrection('Story.', [note, note], [])).toBe(`Story.\n\nNot as told: ${note}`);
  });
});
