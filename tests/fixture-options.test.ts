import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { FIXTURE_COST, FIXTURE_UPKEEP } from '../src/domain/diplomacy.js';
import { WORLD_TYPE_STAT, fixturesRunBy } from '../src/domain/state.js';
import { fixtureOptions, foundingLine } from '../src/ui/fixtureoptions.js';
import type { OpInput } from '../src/domain/ops.js';

/** The System tab's list of what a held world could still be built into. */
describe('what can be built here', () => {
  it('only on a world the player holds', () => {
    const s = createSeedState('meridian');
    const rival = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    expect(fixtureOptions(s, rival.id)).toBeNull();
  });

  it('lists every kind its ground allows, the pure one first, each naming the ground', () => {
    const s = createSeedState('meridian');
    const site = s.systems.find((x) => x.controllerFactionId === 'meridian' && x.id !== 'sek-4')!;
    const opts = fixtureOptions(s, site.id)!;
    const ground = WORLD_TYPE_STAT[site.worldType];
    expect(opts.ground).toBe(ground);
    // One pure kind and the four splits that pair the ground with another stat.
    expect(opts.kinds).toHaveLength(5);
    expect(opts.kinds[0]!.spread).toEqual([{ stat: ground, points: 2 }]);
    for (const k of opts.kinds) expect(k.spread.map((x) => x.stat)).toContain(ground);
  });

  it('refuses a kind already standing, and counts a world full when both slots are taken', () => {
    const s = createSeedState('meridian');
    // Brannix opens with a chamber of commerce.
    const opts = fixtureOptions(s, 'sek-4')!;
    expect(opts.room).toBe(1);
    expect(opts.kinds.find((k) => k.kind === 'chamber_of_commerce')!.refusal).toMatch(/already has/);
    const other = opts.kinds.find((k) => k.refusal === null)!;
    const raising = applyOps(
      s,
      [{
        op: 'issue_order', factionId: 'meridian', type: 'construction_infrastructure',
        originId: 'sek-4', targetId: 'sek-4', durationTurns: 3,
        onComplete: { kind: 'found_fixture', magnitude: 1, fixtureKind: other.kind },
      } as OpInput],
      'model',
      'meridian',
    ).state;
    const full = fixtureOptions(raising, 'sek-4')!;
    expect(full.room).toBe(0);
    expect(full.kinds.every((k) => k.refusal !== null)).toBe(true);
  });

  it('prices the next one against the player\'s own count', () => {
    const s = createSeedState('meridian');
    const opts = fixtureOptions(s, 'sek-4')!;
    const n = fixturesRunBy(s, 'meridian');
    expect(opts.cost).toBe(FIXTURE_COST);
    expect(opts.ordinal).toBe(n + 1);
    expect(opts.upkeepAdded).toBe(FIXTURE_UPKEEP * (n + 1));
  });

  it('writes the sentence the help text teaches', () => {
    expect(foundingLine('power_plant', 'Tulgarn')).toBe('Build a power plant at Tulgarn.');
  });
});
