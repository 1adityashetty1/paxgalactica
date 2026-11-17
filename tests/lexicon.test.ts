import { describe, expect, it } from 'vitest';
import { describeStack } from '../src/domain/hulls.js';
import { fleetName } from '../src/domain/fleets.js';
import { serializeArchetypes } from '../src/domain/assets.js';
import { RIM_EVENT_KINDS } from '../src/domain/events.js';
import { worldTypeLabel } from '../src/ui/worldtext.js';
import { eventListLines, shipClassLines } from '../src/ui/helptext.js';
import { lexicon, rimEventTitle, say, SAY_TOKENS, withLexicon } from '../src/skin/lexicon.js';
import { nullLexicon, paxWords } from '../src/skin/null.js';
import { PAX_LEXICON } from '../src/skin/words.js';
import { paxGalactica } from '../src/skin/paxgalactica.js';
import { coreSlotsOf, LexiconSchema, SkinSchema, skinViolations } from '../src/skin/schema.js';
import { ACT_WORDS } from '../src/domain/acts.js';
import { bandOf, HEAT_BANDS } from '../src/domain/bands.js';
import { STAT_MEANINGS } from '../src/domain/checks.js';
import { AGENT_CLASS_MEANING, AGENT_MISSION_MEANING, NOTE_ESCORT_HULLS, NOTE_MEANING, TREATY_TYPE_MEANING } from '../src/domain/diplomacy.js';
import { TRADE_ETHIC_MEANING, WAR_ETHIC_MEANING } from '../src/domain/state.js';
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
    for (const [name, family] of Object.entries(nullLexicon())) {
      if (name === 'meanings') continue;
      for (const entry of Object.values(family as Record<string, { word?: string; base?: string }>)) {
        expect(pax.has((entry.word ?? entry.base)!.toLowerCase())).toBe(false);
      }
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

describe('say', () => {
  it('fills its tokens from the lexicon in force, capitalised where the token is', () => {
    const n = 3;
    expect(say`{Worlds} you hold pay ${n} {credits} across {rim}; {torpedo_boats} strike first`).toBe(
      'Worlds you hold pay 3 credits across the Rim; torpedo boats strike first',
    );
    expect(say`{Rim}`).toBe('The Rim');
    expect(say`{Warships} {sailed} and {landing} went well`).toBe('Warships sailed and landing went well');
    withLexicon(nullLexicon(), () => {
      expect(say`{Worlds} you hold pay ${n} {credits} across {rim}`).toMatch(/^Qxplaces\d+s you hold pay 3 Qxaccounts\d+s across Qxplaces\d+$/);
    });
  });

  it('leaves what is interpolated alone, and throws on a token it does not know', () => {
    expect(say`${'{world}'} stays`).toBe('{world} stays');
    expect(() => say`{planet}`).toThrow('{planet}');
  });

  it('has a token for every place, force, account and hull class', () => {
    for (const t of ['world', 'worlds', 'lanes', 'orbit', 'yards', 'rim', 'space', 'hulls', 'warships', 'fleets', 'navies', 'credits', 'tons', 'battleships', 'courier', 'sails', 'landing']) {
      expect(SAY_TOKENS).toContain(t);
    }
  });
});

describe('the meanings', () => {
  it('are the skin\'s sentences, read where the domain reads them, with the core\'s numbers in', () => {
    expect(NOTE_MEANING.escort).toContain(`${NOTE_ESCORT_HULLS} of the issuer's hulls`);
    expect(Object.keys(STAT_MEANINGS)).toEqual(['might', 'guile', 'industry', 'influence', 'resolve']);
    expect(bandOf(HEAT_BANDS, 0).band.means).toBe(PAX_LEXICON.meanings.bands['heat.quiet']);
    withLexicon(nullLexicon(), () => {
      for (const table of [STAT_MEANINGS, WAR_ETHIC_MEANING, TRADE_ETHIC_MEANING, TREATY_TYPE_MEANING, NOTE_MEANING, AGENT_CLASS_MEANING, AGENT_MISSION_MEANING, ACT_WORDS]) {
        for (const text of Object.values(table)) expect(text).toMatch(/^Qx\w+\d+$/);
      }
      expect(bandOf(HEAT_BANDS, 99).band.means).toMatch(/^Qxbands\d+$/);
    });
  });

  it('refuse a sentence with a number the core does not give', () => {
    expect(() => withLexicon({ ...PAX_LEXICON, meanings: { ...PAX_LEXICON.meanings, stats: { ...PAX_LEXICON.meanings.stats, might: 'up to {n} guns' } } }, () => STAT_MEANINGS.might)).toThrow('{n}');
  });
});

