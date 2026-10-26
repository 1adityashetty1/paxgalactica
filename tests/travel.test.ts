import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { travelLine, travelTo } from '../src/ui/travel.js';

describe('travel time on the map', () => {
  const s = createSeedState('meridian');
  const name = (id: string) => s.systems.find((x) => x.id === id)!.name;

  it('is nothing where your ships already stand', () => {
    const t = travelTo(s, 'meridian', 'sek-1')!;
    expect(t.jumps).toBe(0);
    expect(travelLine(t)).toBe('Your ships are here.');
  });

  it('is a turn a jump to a world you do not hold', () => {
    const t = travelTo(s, 'meridian', 'tor-2')!;
    expect(t.jumps).toBeGreaterThan(0);
    expect(t.turns).toBe(t.jumps);
    expect(travelLine(t)).toMatch(new RegExp(`^From .+: ${t.jumps} jumps?, arrives in ${t.turns} turns?\\.$`));
  });

  it('lands at once one jump inside your own space', () => {
    // An unoccupied world of yours a jump from another: clear its orbit so the nearest fleet is a jump away.
    const held = s.systems.filter((x) => x.controllerFactionId === 'meridian');
    const target = held.find((x) => held.some((y) => y.id !== x.id && y.hyperlaneEdges.includes(x.id)))!;
    const board = structuredClone(s);
    board.systems.find((x) => x.id === target.id)!.ships = {};
    const t = travelTo(board, 'meridian', target.id)!;
    expect(t.jumps).toBe(1);
    expect(t.atOnce).toBe(true);
    expect(t.turns).toBe(0);
    expect(travelLine(t)).toContain('lands the turn it is ordered');
    expect(name(t.fromId)).toBe(t.fromName);
  });

  it('says so when no fleet can reach', () => {
    const board = structuredClone(s);
    for (const x of board.systems) delete x.ships['meridian'];
    expect(travelLine(travelTo(board, 'meridian', 'sek-1'))).toBe('No fleet of yours can reach here.');
  });
});
