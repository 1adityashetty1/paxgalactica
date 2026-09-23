import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { ledgerFor, stackAt, type WorldState } from '../src/domain/state.js';
import type { HullClass } from '../src/domain/hulls.js';

/**
 * The opening board: each power's auxiliaries go where its skill is, and
 * nobody opens a campaign losing money.
 */
const board = createSeedState('meridian');

function count(s: WorldState, who: string, hull: HullClass): number {
  return s.systems.reduce((n, sys) => n + (stackAt(sys, who)[hull] ?? 0), 0);
}

describe('opening fleets', () => {
  it('gives the free trader the most freighters', () => {
    const meridian = count(board, 'meridian', 'freighter');
    expect(meridian).toBeGreaterThan(0);
    for (const f of board.factions) {
      if (f.id === 'meridian') continue;
      expect(count(board, f.id, 'freighter'), f.id).toBeLessThan(meridian);
    }
  });

  it('gives the Combine listeners, and more of them than anyone', () => {
    const ojjul = count(board, 'ojjul', 'listener');
    expect(ojjul).toBeGreaterThan(0);
    for (const f of board.factions) {
      if (f.id === 'ojjul') continue;
      expect(count(board, f.id, 'listener'), f.id).toBeLessThan(ojjul);
    }
  });

  it('leaves the fighting line where the bots can still read it', () => {
    // Auxiliaries weigh almost nothing in battleship-equivalents, which is how
    // Drajk's raiding once went to zero. Every power keeps a real line.
    for (const f of board.factions) {
      expect(count(board, f.id, 'battleship'), f.id).toBeGreaterThanOrEqual(10);
    }
  });

  it('opens nobody in deficit, debt service included', () => {
    for (const f of board.factions) {
      const l = ledgerFor(board, f.id);
      expect(l.net, `${f.id} net`).toBeGreaterThan(0);
      // Debt service sits outside `net` because it is settled as a transfer;
      // a debtor paying it out of a thin net is still a debtor in deficit.
      expect(l.net + Math.min(0, l.debtService), `${f.id} after debt`).toBeGreaterThan(0);
    }
  });
});
