import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { TreatySchema, TruceSchema, PEACE_TREATIES, treatyBetween } from '../src/domain/diplomacy.js';
import { relationBetween, warsFor, WAR_DISPOSITION_THRESHOLD, type WorldState } from '../src/domain/state.js';

function sour(s: WorldState, a: string, b: string, to: number): void {
  s.factions.find((f) => f.id === a)!.disposition[b] = to;
  s.factions.find((f) => f.id === b)!.disposition[a] = to;
}

function sign(s: WorldState, type: string, a: string, b: string): void {
  s.treaties.push(
    TreatySchema.parse({ id: `trt-${type}`, type, parties: [a, b], terms: {}, signedTurn: s.turn, status: 'active' }),
  );
}

/** `relationBetween` is the one reading of war and peace; `warsFor` is a view of it. */
describe('what two powers are to each other', () => {
  it('reads war off regard in either direction', () => {
    const s = createSeedState('meridian');
    sour(s, 'meridian', 'drajk', 0);
    s.factions.find((f) => f.id === 'drajk')!.disposition.meridian = WAR_DISPOSITION_THRESHOLD;
    expect(relationBetween(s, 'meridian', 'drajk').kind).toBe('war');
    expect(relationBetween(s, 'drajk', 'meridian').kind).toBe('war');
    expect(warsFor(s, 'meridian')).toContain('drajk');
  });

  it('names the paper that keeps them out of war, in order', () => {
    const s = createSeedState('meridian');
    sour(s, 'meridian', 'drajk', -90);
    sign(s, 'ceasefire', 'meridian', 'drajk');
    expect(relationBetween(s, 'meridian', 'drajk')).toMatchObject({ kind: 'peace', treatyId: 'trt-ceasefire' });
    sign(s, 'mutual_defense', 'meridian', 'drajk');
    expect(relationBetween(s, 'meridian', 'drajk')).toMatchObject({ kind: 'allied', basing: true });
    expect(warsFor(s, 'meridian')).not.toContain('drajk');
  });

  it('carries a truce under the paper, and names one with nothing over it', () => {
    const s = createSeedState('meridian');
    sour(s, 'meridian', 'drajk', -90);
    s.truces = [TruceSchema.parse({ parties: ['drajk', 'meridian'], treatyId: 'trt-x', signedTurn: 0, untilTurn: 8 })];
    expect(relationBetween(s, 'meridian', 'drajk')).toMatchObject({ kind: 'truce', truceUntil: 8 });
    sign(s, 'non_aggression', 'meridian', 'drajk');
    expect(relationBetween(s, 'meridian', 'drajk')).toMatchObject({ kind: 'peace', truceUntil: 8 });
  });

  it('holds a married pair out of war, as every attack guard already did', () => {
    const s = createSeedState('meridian');
    sour(s, 'meridian', 'drajk', -80);
    sign(s, 'marriage', 'meridian', 'drajk');
    expect(treatyBetween(s.treaties, s.turn, 'meridian', 'drajk', PEACE_TREATIES)).toBeDefined();
    expect(relationBetween(s, 'meridian', 'drajk').kind).toBe('married');
    expect(warsFor(s, 'meridian')).not.toContain('drajk');
  });

  it('keeps the old reading for a journal from before version 39', () => {
    const s = createSeedState('meridian', { marriagePeace: false });
    expect(s.marriagePeace).toBe(false);
    sour(s, 'meridian', 'drajk', -80);
    sign(s, 'marriage', 'meridian', 'drajk');
    expect(warsFor(s, 'meridian')).toContain('drajk');
  });

  it('is neutral with no paper and no war', () => {
    const s = createSeedState('meridian');
    sour(s, 'meridian', 'freeworlds', 5);
    expect(relationBetween(s, 'meridian', 'freeworlds')).toMatchObject({ kind: 'neutral', basing: false });
  });
});
