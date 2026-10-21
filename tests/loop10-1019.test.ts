import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { serializeCharacter } from '../src/model/serialize.js';

/** Fixes from the tenth loop of the advisor playtest (2026-10-19). */

describe('the counsellor’s copy of its power’s voice', () => {
  it('carries no sample speech, whose facts are invented, for any power', () => {
    for (const f of createSeedState('meridian').factions) {
      expect(f.voice).toMatch(/Sample:/);
      const sheet = serializeCharacter(f, { enumerates: false, sample: false });
      expect(sheet).not.toMatch(/Sample:/);
      expect(sheet).toMatch(/How you speak: \S/);
    }
    const meridian = serializeCharacter(createSeedState('meridian').factions.find((f) => f.id === 'meridian')!, { enumerates: false, sample: false });
    expect(meridian).not.toMatch(/Neth|eleven quarters|harbour was quieted last season/);
  });

  it('keeps the sample for every other reader', () => {
    const f = createSeedState('meridian').factions[0]!;
    expect(serializeCharacter(f)).toMatch(/Sample:/);
  });
});
