import { describe, expect, it } from 'vitest';
import { LEADER_TITLES, theyThem, theyThemDeep } from '../src/domain/pronouns.js';
import { createSeedState } from '../src/seed/scenario.js';

/** Officers, operatives and notables are they/them, whatever a model writes. */

describe('a generated person', () => {
  it('is they/them, with the verb agreed', () => {
    expect(theyThem('Brigadier Cornelia Galba holds Threx. She has six lifters and her fleet is ready; send her back to Vantic.')).toBe(
      'Brigadier Cornelia Galba holds Threx. They have six lifters and their fleet is ready; send them back to Vantic.',
    );
    expect(theyThem("Galba's squadron is spent. He always sails at dawn, and he carries the lift himself. He's been at Threx since turn 3.")).toBe(
      "Galba's squadron is spent. They always sail at dawn, and they carry the lift themselves. They've been at Threx since turn 3.",
    );
    expect(theyThem("Your governor at Sennex is restless; he doesn't trust the Board and his estate wants grants. Pay him.")).toBe(
      "Your governor at Sennex is restless; they don't trust the Board and their estate wants grants. Pay them.",
    );
  });

  it('is found by a joined family name too', () => {
    expect(theyThem('Galbavarro was taken at Threx; he is held there.')).toBe('Galbavarro was taken at Threx; they are held there.');
  });
});

describe('a leader', () => {
  it('keeps the pronouns on their sheet', () => {
    expect(theyThem('The Chief Executive wants Torrek. He will not wait.')).toBe('The Chief Executive wants Torrek. He will not wait.');
    expect(theyThem('Marcia Galba sailed. The Grand Admiral thanked her.')).toBe('Marcia Galba sailed. The Grand Admiral thanked her.');
  });

  it('is named by the titles the seed gives', () => {
    expect(createSeedState('meridian').factions.map((f) => f.title).sort()).toEqual([...LEADER_TITLES].sort());
  });
});

describe('a reply', () => {
  it('is rewritten throughout, key order kept, and left alone when nothing changes', () => {
    const reply = { counsel: 'Galba is spent; send him home.', recommendation: 'Hold Torrek.', ops: [{ op: 'log_narrative', text: 'She sails.' }] };
    const out = theyThemDeep(reply);
    expect(out.changed).toBe(true);
    expect(out.value.counsel).toBe('Galba is spent; send them home.');
    expect(Object.keys(out.value)).toEqual(['counsel', 'recommendation', 'ops']);
    const clean = { counsel: 'Hold Torrek.' };
    expect(theyThemDeep(clean).value).toBe(clean);
  });
});
