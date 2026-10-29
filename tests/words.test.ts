import { describe, expect, it } from 'vitest';
import { asSentence, count, possessive } from '../src/domain/words.js';

/** The small words every note is built from (bughunt 2026-10-28). */
describe('words', () => {
  it('makes a name possessive', () => {
    expect(possessive('Meridian Trade Authority')).toBe("Meridian Trade Authority's");
    expect(possessive('Arkane Free Worlds')).toBe("Arkane Free Worlds'");
  });

  it('puts a reason as a sentence of its own', () => {
    expect(asSentence('a price on an enemy')).toBe('A price on an enemy.');
    expect(asSentence('Already one.')).toBe('Already one.');
    expect(asSentence('  ')).toBe('');
    expect(asSentence(undefined)).toBe('');
  });

  it('counts', () => {
    expect(count(1, 'hull')).toBe('1 hull');
    expect(count(3, 'hull')).toBe('3 hulls');
    expect(count(2, 'person', 'people')).toBe('2 people');
  });
});
