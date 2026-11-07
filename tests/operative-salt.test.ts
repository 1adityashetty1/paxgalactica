import { describe, expect, it } from 'vitest';
import { lastLogWord } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';

/** An operative's roll is salted with its id and the last word in the log (journal version 37). */
describe('the last word in the log', () => {
  it('is the final word of the latest entry, bare of punctuation', () => {
    const s = createSeedState('meridian');
    s.eventLog = [];
    expect(lastLogWord(s)).toBe('');
    const log = (text: string) => s.eventLog.push({ turn: 0, kind: 'narrative', factionId: null, text, visibleTo: null } as never);
    log('Fleets engage over Threx.');
    expect(lastLogWord(s)).toBe('Threx');
    log('The Combine’s factor is "turned".');
    expect(lastLogWord(s)).toBe('turned');
  });
});
