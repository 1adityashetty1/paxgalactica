import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { involvedFactions } from '../src/model/serialize.js';
import { touchedBy } from '../src/engine/turn.js';

/** Who answers the player at the end of a turn: the powers the turn reached. */
describe('responders', () => {
  it('a turn spent at home reaches nobody, however strongly the neighbours feel', () => {
    const s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian' && Object.keys(x.ships).every((id) => id === 'meridian'))!;
    const touched = touchedBy(s, [
      { op: 'issue_order', factionId: 'meridian', type: 'fortification', originId: home.id, targetId: home.id },
    ]);
    s.factions.find((f) => f.id === 'vigil')!.disposition.meridian = -95;
    expect(involvedFactions(s, touched.factions, touched.systems, 'meridian')).toEqual([]);
  });

  it('a power is involved when named, when its world is reached, or when its hulls are there', () => {
    const s = createSeedState('meridian');
    const vigilWorld = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const touched = touchedBy(s, [
      { op: 'issue_order', factionId: 'meridian', type: 'fleet_movement', originId: 'sek-4', targetId: vigilWorld.id },
      // Named deep inside an op, not in a field anybody listed.
      { op: 'post_bounty', targetFactionId: 'drajk', amount: 100 },
    ]);
    const who = involvedFactions(s, touched.factions, touched.systems, 'meridian');
    expect(who).toContain('vigil');
    expect(who).toContain('drajk');
    // Named outranks merely present.
    expect(who[0]).toBe('drajk');
    expect(who).not.toContain('freeworlds');
  });

  it('never more than three', () => {
    const s = createSeedState('meridian');
    const touched = touchedBy(s, [
      { op: 'form_treaty', parties: ['vigil', 'ojjul', 'freeworlds', 'drajk'] },
    ]);
    expect(involvedFactions(s, touched.factions, touched.systems, 'meridian')).toHaveLength(3);
  });
});
