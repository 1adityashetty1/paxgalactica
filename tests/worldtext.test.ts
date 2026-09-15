import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { WORLD_TYPES, WORLD_TYPE_STAT } from '../src/domain/state.js';
import { FLAVOUR_KEYS, worldFlavour } from '../src/ui/worldtext.js';

/**
 * A line about what a world is like, keyed on what it is and who settled it.
 *
 * The panel said `Arid` and `counts toward: might` and joined neither to the
 * other. What these pin is that the table stays in step with the seed — a world
 * with no line falls back to a generic one, which is safe and is also the way
 * this stops being noticed.
 */
describe('a world says what it is', () => {
  const seed = () => createSeedState('drajk');

  it('has a written line for every world on the board', () => {
    // The fallback exists so the panel can never render a hole, not so the
    // table can be left behind. A new seed world should fail this.
    for (const sys of seed().systems) {
      const key = `${sys.worldType}|${sys.homeFactionId ?? 'unaligned'}`;
      expect(FLAVOUR_KEYS, `${sys.id} (${sys.name})`).toContain(key);
    }
  });

  it('falls back rather than rendering nothing', () => {
    for (const type of WORLD_TYPES) {
      const line = worldFlavour('nowhere', type, 'a-power-that-does-not-exist');
      expect(line.length).toBeGreaterThan(20);
    }
  });

  it('says the same thing about the same world every time', () => {
    // A world's character is a property of the place, not of the turn — the
    // picker is seeded on the id alone for exactly this reason.
    const a = seed().systems.map((s) => worldFlavour(s.id, s.worldType, s.homeFactionId));
    const b = seed().systems.map((s) => worldFlavour(s.id, s.worldType, s.homeFactionId));
    expect(a).toEqual(b);
  });

  it('does not repeat itself where one pair covers several worlds', () => {
    // Three unaligned ice worlds reading identically is the failure the variant
    // lists exist for, and it is the one a reader would call a bug.
    const s = seed();
    const ice = s.systems.filter(
      (x) => x.worldType === 'ice' && x.homeFactionId === null,
    );
    expect(ice.length).toBeGreaterThan(1);
    const lines = ice.map((x) => worldFlavour(x.id, x.worldType, x.homeFactionId));
    expect(new Set(lines).size).toBeGreaterThan(1);
  });

  it('keeps its line after the world changes hands', () => {
    // Keyed on `homeFactionId`, which never moves. A world does not stop being
    // an Imperial fuel depot because somebody else took it — that is the whole
    // of what the occupation cost is charging for.
    const s = seed();
    const vigilWorld = s.systems.find((x) => x.homeFactionId === 'vigil')!;
    const before = worldFlavour(vigilWorld.id, vigilWorld.worldType, vigilWorld.homeFactionId);
    vigilWorld.controllerFactionId = 'drajk';
    expect(worldFlavour(vigilWorld.id, vigilWorld.worldType, vigilWorld.homeFactionId)).toBe(before);
  });

  it('is prose rather than a restatement of the stat', () => {
    // If the line just named the stat there would be no reason to write it —
    // the panel already prints the stat on the next row.
    for (const sys of seed().systems) {
      const line = worldFlavour(sys.id, sys.worldType, sys.homeFactionId);
      expect(line.toLowerCase(), sys.id).not.toContain(WORLD_TYPE_STAT[sys.worldType]);
      expect(line.length).toBeGreaterThan(40);
    }
  });
});
