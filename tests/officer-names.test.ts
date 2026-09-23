import { describe, expect, it } from 'vitest';
import { resolveCommander } from '../src/domain/command.js';
import type { Commander } from '../src/domain/command.js';

/**
 * Naming an officer the way a player names one.
 *
 * `Commander.name` stores the title baked in — *"Iron Marshal Marcia Galba"* —
 * and a player writes *"Marcia Galba"*, *"M. Galba"* or *"Marshal Galba"*.
 * Before `resolveCommander` every one of those reached `targetCommanderId`
 * matching no record at all, so an assassination was admissible, priced, rolled
 * and then killed nobody while the officer went on commanding battles.
 */
function officer(id: string, factionId: string, name: string): Commander {
  return {
    id,
    factionId,
    name,
    archetype: 'lineofbattle',
    appointedTurn: 0,
    battles: 0,
    status: 'active',
    atSystemId: null,
  };
}

const GALBA = officer('cmd-0-0', 'vigil', 'Iron Marshal Marcia Galba');
const CINNA = officer('cmd-0-1', 'vigil', 'Commodore Caius Cinna');
/** The suffix form, which parses completely differently. */
const HALQ = officer('cmd-1-0', 'ojjul', 'Miral Nar Halq, Hand of the Family');
const ROSTER = [GALBA, CINNA, HALQ];

describe('resolveCommander', () => {
  it.each([
    ['the full stored name', 'Iron Marshal Marcia Galba'],
    ['given and family name', 'Marcia Galba'],
    ['an initial', 'M. Galba'],
    ['rank and family name', 'Marshal Galba'],
    ['the family name alone', 'Galba'],
    ['a possessive a player would type', 'their Iron Marshal'],
  ])('resolves %s', (_label, query) => {
    expect(resolveCommander(ROSTER, query)?.id).toBe(GALBA.id);
  });

  it('resolves the suffix form the Combine uses', () => {
    expect(resolveCommander(ROSTER, 'Miral Nar Halq')?.id).toBe(HALQ.id);
    expect(resolveCommander(ROSTER, 'Hand of the Family')?.id).toBe(HALQ.id);
  });

  it('takes an id unchanged, without tokenising it', () => {
    expect(resolveCommander(ROSTER, 'cmd-1-0')?.id).toBe(HALQ.id);
  });

  /**
   * The bar is *every* token, not *any*. Partial credit is what would let
   * "Galba" land on whichever officer merely shares a title with the one Galba.
   */
  it('refuses a name that only partly matches', () => {
    expect(resolveCommander(ROSTER, 'Marcia Cinna')).toBeNull();
    expect(resolveCommander(ROSTER, 'Valeria Galba')).toBeNull();
  });

  it('refuses a name nobody answers to', () => {
    expect(resolveCommander(ROSTER, 'Kess Coldwake')).toBeNull();
  });

  /**
   * Two officers a query fits equally is a query that has identified nobody,
   * and guessing between them is worse than saying so — the knife would
   * otherwise land on whichever the array happened to hold first.
   */
  it('refuses an ambiguous name rather than picking one', () => {
    const twins = [
      officer('cmd-0-0', 'vigil', 'Iron Marshal Marcia Galba'),
      officer('cmd-0-1', 'vigil', 'Iron Marshal Livia Galba'),
    ];
    expect(resolveCommander(twins, 'Marshal Galba')).toBeNull();
    // Given a discriminating token it resolves again.
    expect(resolveCommander(twins, 'Livia Galba')?.id).toBe('cmd-0-1');
  });

  it('matches only within the eligible set', () => {
    // The knife points outward: an operation run BY the Vigil cannot name a
    // Vigil officer, and scoping is the caller's job rather than the matcher's.
    expect(
      resolveCommander(ROSTER, 'Marcia Galba', (c) => c.factionId !== 'vigil'),
    ).toBeNull();
    expect(
      resolveCommander(ROSTER, 'Miral Nar Halq', (c) => c.factionId !== 'vigil')?.id,
    ).toBe(HALQ.id);
  });

  it('answers nothing for an empty query', () => {
    expect(resolveCommander(ROSTER, '   ')).toBeNull();
    expect(resolveCommander(ROSTER, 'the their our')).toBeNull();
  });
});
