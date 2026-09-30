import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { statModifier, STAT_NAMES } from '../src/domain/checks.js';
import {
  RALLY_CAP,
  effectiveStats,
  homelandLost,
  rallyBonus,
  terrainBonus,
  type WorldState,
} from '../src/domain/state.js';
import { TREATY_GOODWILL } from '../src/domain/diplomacy.js';
import { serializeState } from '../src/model/serialize.js';

/**
 * Item 123: the two attributes whose descriptions had no mechanism behind them.
 * Resolve rallies a power whose homeland is occupied; influence decides the
 * standing a treaty buys.
 */

const fresh = (): WorldState => createSeedState('meridian');

/** A board with nothing but base stats and terrain feeding `effectiveStats`. */
function plain(s: WorldState, factionId: string, resolve: number): WorldState {
  const f = s.factions.find((x) => x.id === factionId)!;
  f.stats = { might: 10, guile: 10, industry: 10, influence: 10, resolve };
  f.dissent = 0;
  s.commanders = [];
  s.assets = [];
  s.agents = [];
  return s;
}

/** Hand `n` of a power's home worlds to somebody else. */
function occupy(s: WorldState, factionId: string, n: number, by = 'drajk'): WorldState {
  const home = s.systems.filter((x) => x.homeFactionId === factionId);
  for (const w of home.slice(0, n)) w.controllerFactionId = by;
  return s;
}

describe('a people whose homeland is occupied rallies', () => {
  it('opens every power on four home worlds, so the deficit moves in quarters', () => {
    const s = fresh();
    for (const f of s.factions) {
      expect(s.systems.filter((x) => x.homeFactionId === f.id)).toHaveLength(4);
      expect(homelandLost(s, f.id)).toBe(0);
      expect(rallyBonus(s, f.id)).toBe(0);
    }
  });

  it('rallies harder the higher the resolve, one step per home world lost, capped', () => {
    const steps = (resolve: number) =>
      [0, 1, 2, 3, 4].map((n) => rallyBonus(occupy(fresh(), 'vigil', n), 'vigil', resolve));
    // The Iron Vigil at 17 reaches the cap at half its homeland gone;
    // Meridian's 9 needs two worlds lost for its first point.
    expect(steps(17)).toEqual([0, 1, 3, 3, 3]);
    expect(steps(9)).toEqual([0, 0, 1, 2, 3]);
    expect(steps(10)).toEqual([0, 1, 2, 3, 3]);
    for (const r of [1, 10, 20]) expect(Math.max(...steps(r))).toBeLessThanOrEqual(RALLY_CAP);
  });

  it('lifts might, guile, industry and influence — never resolve, which sizes it', () => {
    const s = occupy(plain(fresh(), 'vigil', 17), 'vigil', 2);
    const t = terrainBonus(s, 'vigil');
    const lift = rallyBonus(s, 'vigil', 17 + (t.resolve ?? 0));
    expect(lift).toBeGreaterThan(0);
    const eff = effectiveStats(s, 'vigil');
    for (const stat of STAT_NAMES) {
      const base = stat === 'resolve' ? 17 : 10;
      expect(eff[stat], stat).toBe(base + (t[stat] ?? 0) + (stat === 'resolve' ? 0 : lift));
    }
  });

  it('comes before dissent, so an occupied homeland offsets a bad leader', () => {
    const s = occupy(plain(fresh(), 'vigil', 17), 'vigil', 2);
    const calm = effectiveStats(s, 'vigil');
    s.factions.find((x) => x.id === 'vigil')!.dissent = 100;
    const stormy = effectiveStats(s, 'vigil');
    // Dissent takes its full 8 off the rallied figure rather than the rally
    // vanishing under the floor.
    expect(calm.might - stormy.might).toBe(8);
  });

  it('ends when the homeland is retaken', () => {
    const s = occupy(fresh(), 'vigil', 2);
    expect(rallyBonus(s, 'vigil')).toBeGreaterThan(0);
    for (const w of s.systems.filter((x) => x.homeFactionId === 'vigil')) w.controllerFactionId = 'vigil';
    expect(rallyBonus(s, 'vigil')).toBe(0);
  });

  it('is told to the power, and shown to everyone on the stats line', () => {
    const s = occupy(fresh(), 'vigil', 2);
    const own = serializeState(s, 'vigil');
    expect(own).toMatch(/Your people are rallying/);
    expect(serializeState(fresh(), 'vigil')).not.toMatch(/rallying/);
  });
});

describe('a treaty buys standing by the signer\'s influence', () => {
  const sign = (s: WorldState, legacy = {}) =>
    applyOps(
      s,
      [{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'ojjul'], terms: {} }],
      'extraction',
      'meridian',
      true,
      legacy,
    );

  it('pays each party base goodwill plus the OTHER party\'s influence modifier', () => {
    const s = fresh();
    const before = {
      ojjulOfMeridian: s.factions.find((f) => f.id === 'ojjul')!.disposition['meridian'] ?? 0,
      meridianOfOjjul: s.factions.find((f) => f.id === 'meridian')!.disposition['ojjul'] ?? 0,
    };
    const out = sign(s);
    expect(out.rejections).toHaveLength(0);
    const after = out.state;
    const gainOf = (from: string, toward: string, was: number) =>
      (after.factions.find((f) => f.id === from)!.disposition[toward] ?? 0) - was;
    const expectGain = (signer: string) =>
      Math.max(0, TREATY_GOODWILL + statModifier(effectiveStats(s, signer).influence));
    expect(gainOf('ojjul', 'meridian', before.ojjulOfMeridian)).toBe(expectGain('meridian'));
    expect(gainOf('meridian', 'ojjul', before.meridianOfOjjul)).toBe(expectGain('ojjul'));
  });

  it('makes a persuasive power better liked for the same deal', () => {
    const low = fresh();
    low.factions.find((f) => f.id === 'meridian')!.stats.influence = 4;
    const high = fresh();
    high.factions.find((f) => f.id === 'meridian')!.stats.influence = 18;
    const regard = (s: WorldState) => sign(s).state.factions.find((f) => f.id === 'ojjul')!.disposition['meridian']!;
    expect(regard(high)).toBeGreaterThan(regard(low));
  });

  it('pays the flat figure on a journal from before it', () => {
    const s = fresh();
    const was = s.factions.find((f) => f.id === 'ojjul')!.disposition['meridian'] ?? 0;
    const out = sign(s, { influentialGoodwill: false });
    expect(out.state.factions.find((f) => f.id === 'ojjul')!.disposition['meridian']).toBe(was + TREATY_GOODWILL);
  });
});

describe('the stats line every persona reads', () => {
  it('shows what the dice use, and leaves a rival\'s hidden debuffs hidden', () => {
    const s = fresh();
    // A hidden operative of the Combine's working on a Meridian world.
    const host = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    s.agents.push({
      id: 'agt-x', name: 'Serek Nar Vessat', ownerFactionId: 'ojjul', systemId: host.id,
      mission: 'subversion', effect: { kind: 'stat_debuff', stat: 'influence', magnitude: 3 },
      cover: '', successChance: 50, deployedTurn: 0, exposed: false, operations: 0, timesCaught: 0,
      targetCommanderId: null,
    } as WorldState['agents'][number]);
    const meridianRow = (text: string) =>
      text.split('\n').find((l) => l.includes('Meridian Trade Authority**'))!;
    const statsAfter = (text: string) => {
      const lines = text.split('\n');
      const i = lines.findIndex((l) => l.startsWith('- **Meridian Trade Authority**'));
      return lines.slice(i, i + 4).find((l) => l.trim().startsWith('stats:'))!;
    };
    expect(meridianRow(serializeState(s, 'vigil'))).toBeDefined();
    const seenByRival = statsAfter(serializeState(s, 'vigil'));
    const seenBySelf = statsAfter(serializeState(s, 'meridian'));
    const covertFree = effectiveStats(s, 'meridian', { covert: false }).influence;
    const true_ = effectiveStats(s, 'meridian').influence;
    expect(true_).toBe(covertFree - 3);
    expect(seenByRival).toContain(`influence ${covertFree}`);
    expect(seenBySelf).toContain(`influence ${true_}`);
  });
});
