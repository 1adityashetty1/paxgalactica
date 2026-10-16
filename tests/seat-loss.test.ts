import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, type LegacyRules } from '../src/domain/reducer.js';
import { SEAT_VACATED_FAVOUR } from '../src/domain/estates.js';
import { inOffice, removeNotable, seatedAt, vacatedSeats } from '../src/domain/seats.js';
import type { StarSystem, WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * An estate loses favour when one of its notables leaves a seat on its own
 * power's world, however they leave it. Journal version 22.
 */
const named = (s: WorldState, name: string): StarSystem => s.systems.find((x) => x.name === name)!;
const favour = (s: WorldState, estateId: string) =>
  s.factions.flatMap((f) => f.estates).find((e) => e.id === estateId)!.favour;

describe('a seat lost costs the estate', () => {
  it('when its notable is replaced — fired, by its own power', () => {
    const s = createSeedState('meridian');
    const brannix = named(s, 'Brannix');
    const sitting = seatedAt(s, brannix.id)[0]!;
    const other = s.factions.find((f) => f.id === 'meridian')!.estates.find((e) => e.id !== sitting.estateId)!;
    const fire = (legacy: LegacyRules = {}) =>
      applyOps(s, [{ op: 'seat_estate', factionId: 'meridian', systemId: brannix.id, estate: other.id } as OpInput], 'model', 'meridian', false, legacy).state;
    expect(favour(fire(), sitting.estateId!)).toBe(favour(s, sitting.estateId!) - SEAT_VACATED_FAVOUR);
    expect(favour(fire({ seatLossCostsFavour: false }), sitting.estateId!)).toBe(favour(s, sitting.estateId!));
    // The line reaches the power whose estate it is, and nobody else.
    const line = fire().eventLog.findLast((e) => e.text.includes('lose a seat'))!;
    expect(line.visibleTo).toEqual(['meridian']);
  });

  it('when the world is taken, for every seat on it', () => {
    const s = createSeedState('meridian');
    const kalzir = named(s, 'Kalzir');
    const seated = seatedAt(s, kalzir.id);
    expect(seated.length).toBeGreaterThan(0);
    const r = applyOps(s, [{ op: 'transfer_control', systemId: kalzir.id, toFactionId: 'meridian' } as OpInput], 'engine');
    for (const n of seated) expect(favour(r.state, n.estateId!)).toBe(favour(s, n.estateId!) - SEAT_VACATED_FAVOUR);
  });

  it('when the notable is killed or carried off, by the same rule', () => {
    const s = createSeedState('meridian');
    const before = inOffice(s);
    const victim = seatedAt(s, named(s, 'Brannix').id)[0]!;
    removeNotable(s, victim);
    const lines = vacatedSeats(s, before);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.factionId).toBe('meridian');
    expect(favour(s, victim.estateId!)).toBe(-SEAT_VACATED_FAVOUR + favour(createSeedState('meridian'), victim.estateId!));
  });

  it('and costs nothing when no seat empties', () => {
    const s = createSeedState('meridian');
    const est = s.factions.find((f) => f.id === 'meridian')!.estates[0]!;
    const r = applyOps(s, [{ op: 'grant_stipend', factionId: 'meridian', estate: est.id } as OpInput], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(r.state.eventLog.some((e) => e.text.includes('lose a seat'))).toBe(false);
  });
});
