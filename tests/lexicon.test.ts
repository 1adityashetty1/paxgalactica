import { describe, expect, it } from 'vitest';
import { describeStack } from '../src/domain/hulls.js';
import { fleetName } from '../src/domain/fleets.js';
import { serializeArchetypes } from '../src/domain/assets.js';
import { RIM_EVENT_KINDS } from '../src/domain/events.js';
import { worldTypeLabel } from '../src/ui/worldtext.js';
import { eventListLines, shipClassLines } from '../src/ui/helptext.js';
import { lexicon, rimEventTitle, withLexicon } from '../src/skin/lexicon.js';
import { nullLexicon, paxWords } from '../src/skin/null.js';
import { PAX_LEXICON } from '../src/skin/words.js';
import { paxGalactica } from '../src/skin/paxgalactica.js';
import { coreSlotsOf, LexiconSchema, SkinSchema, skinViolations } from '../src/skin/schema.js';
import { createSeedState } from '../src/seed/scenario.js';

describe('the lexicon', () => {
  it('is Pax Galactica outside any scope, and comes back after one that throws', () => {
    expect(lexicon()).toBe(PAX_LEXICON);
    expect(() =>
      withLexicon(nullLexicon(), () => {
        throw new Error('inside');
      }),
    ).toThrow('inside');
    expect(lexicon()).toBe(PAX_LEXICON);
  });

  it('checks as a skin, and so does the null lexicon', () => {
    expect(LexiconSchema.parse(PAX_LEXICON)).toEqual(PAX_LEXICON);
    const nulled = SkinSchema.parse({ ...paxGalactica(), lexicon: nullLexicon() });
    expect(skinViolations(nulled, coreSlotsOf(createSeedState('meridian')))).toEqual([]);
  });

  it('gives the null lexicon no word the default one has', () => {
    const pax = new Set(paxWords().map((w) => w.toLowerCase()));
    expect(pax.size).toBeGreaterThan(100);
    for (const family of Object.values(nullLexicon())) {
      for (const entry of Object.values(family as Record<string, { word: string }>)) expect(pax.has(entry.word.toLowerCase())).toBe(false);
    }
  });
});

describe('what reads it', () => {
  const sentinel = /\bQx[a-zA-Z]+\d+/;

  it('writes a stack, a fleet, a terrain and a Rim event in the lexicon in force', () => {
    expect(describeStack({ battleship: 2, escort: 1 })).toBe('2 battleships, 1 escort');
    withLexicon(nullLexicon(), () => {
      const stack = describeStack({ battleship: 2, escort: 1 });
      expect(stack).not.toMatch(/battleship|escort/);
      expect(stack).toMatch(/^2 Qxunits\d+s, 1 Qxunits\d+$/);
      expect(fleetName('', { number: 3, kind: 'line' })).toMatch(/^3rd Qxfleet/);
      expect(fleetName('', { number: 3, kind: 'listener' })).toMatch(/^Qxfleet\w+ 3$/);
      expect(worldTypeLabel('ice')).toMatch(sentinel);
      for (const k of RIM_EVENT_KINDS) expect(rimEventTitle(k)).toMatch(sentinel);
    });
  });

  it('writes the help pages and the archetype table from it', () => {
    withLexicon(nullLexicon(), () => {
      const ships = shipClassLines().join('\n');
      expect(ships).not.toMatch(/battleship|torpedo boat|lifter/i);
      expect(eventListLines().join(' ')).not.toMatch(/ion storm|derelict|free captains/i);
      expect(serializeArchetypes()).not.toMatch(/\| (crew|chart|fixture) \|/);
    });
  });
});
