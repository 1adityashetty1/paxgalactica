import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { paperOf } from '../src/domain/pressures.js';

/** Fixes from the sixth loop of the advisor playtest (2026-10-19). */

describe('the counsellor’s paper', () => {
  it('states the ledger and which demands are pressing, so a profitable quarter is not read as red ink', () => {
    const paper = paperOf(createSeedState('meridian'), 'meridian').join('\n');
    expect(paper).toMatch(/Your ledger: \+\d+ a turn net \(\d+ in, \d+ upkeep, \d+ debt service\); the quarter is in the black/);
    expect(paper).toMatch(/Demands of your institutions not being met now: none/);
  });

  it('names a demand that is not being met', () => {
    const s = createSeedState('meridian');
    // A navy its income cannot carry.
    s.systems.find((x) => x.id === 'sek-1')!.ships.meridian = { battleship: 400 };
    const paper = paperOf(s, 'meridian').join('\n');
    expect(paper).toMatch(/running at a loss/);
    expect(paper).toMatch(/Demands of your institutions not being met now: "/);
  });
});
