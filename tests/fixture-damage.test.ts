import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { boundPayloadsToOutcome, EFFECT_COST } from '../src/domain/development.js';
import { fixtureIntegrity, workingStats, type Agent, type Asset } from '../src/domain/diplomacy.js';
import { fixtureBonus, fixtureUpkeepFor, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Fixtures that can be hurt: a sabotage operative strikes a point off a
 * fixture's yield each turn it succeeds, the fixture still costs its upkeep,
 * and a repair programme puts it back.
 *
 * The seed's Confederacy plant at Tulgarn (ark-5) is a split fixture — a point
 * of industry and a point of resolve.
 */

const calm = { randomEvents: false };
const SITE = 'ark-5';
const plant = (s: WorldState): Asset => s.assets.find((a) => a.kind === 'power_plant')!;

/** A saboteur already at work at Tulgarn, who never misses. */
function saboteur(s: WorldState, perTurn = 1): WorldState {
  const agent: Agent = {
    id: 'agt-test',
    ownerFactionId: 'meridian',
    systemId: SITE,
    mission: 'sabotage',
    effect: { kind: 'fixture_damage', perTurn },
    inPlaceFrom: 0,
    successChance: 100,
    deployedTurn: 0,
    exposed: false,
    cover: '',
    name: 'Test Saboteur',
    operations: 0,
    timesCaught: 0,
    targetCommanderId: null,
  };
  return { ...s, agents: [...s.agents, agent] };
}

describe('what a damaged fixture yields', () => {
  it('loses a point of yield per point of damage, off the last attribute first', () => {
    const s = createSeedState('drajk');
    const p = plant(s);
    expect(fixtureIntegrity(p)).toBe(2);
    expect(workingStats(p)).toEqual([
      { stat: 'industry', points: 1 },
      { stat: 'resolve', points: 1 },
    ]);
    expect(workingStats({ ...p, damage: 1 })).toEqual([{ stat: 'industry', points: 1 }]);
    expect(workingStats({ ...p, damage: 2 })).toEqual([]);
  });
});

describe('a saboteur', () => {
  it('strikes the fixture and the holder feels it in its stats', () => {
    const s = createSeedState('drajk');
    const before = fixtureBonus(s, 'drajk');
    const hit = tickTurn(saboteur(s), calm).state;
    expect(plant(hit).damage).toBe(1);
    expect(fixtureBonus(hit, 'drajk').resolve ?? 0).toBe((before.resolve ?? 0) - 1);
    expect(fixtureBonus(hit, 'drajk').industry).toBe(before.industry);
  });

  it('wrecks it in the end, and the holder still pays to run it', () => {
    const s = createSeedState('drajk');
    let t = saboteur(s);
    for (let i = 0; i < 3; i++) t = tickTurn(t, calm).state;
    expect(plant(t).damage).toBe(fixtureIntegrity(plant(t)));
    expect(workingStats(plant(t))).toEqual([]);
    expect(fixtureUpkeepFor(t, 'drajk')).toBe(fixtureUpkeepFor(s, 'drajk'));
  });

  it('finds nothing to strike on a world with nothing built', () => {
    const s = createSeedState('drajk');
    const agent = saboteur(s).agents.at(-1)!;
    const elsewhere = { ...saboteur(s), agents: [{ ...agent, systemId: 'ilv-7' }] };
    const after = tickTurn(elsewhere, calm).state;
    expect(after.assets.filter((a) => (a.damage ?? 0) > 0)).toEqual([]);
  });
});

describe('a repair programme', () => {
  const repair = (s: WorldState, magnitude = 2, actor = 'drajk', at = SITE) =>
    applyOps(
      s,
      [
        {
          op: 'issue_order',
          factionId: actor,
          type: 'construction_infrastructure',
          originId: at,
          targetId: at,
          durationTurns: 2,
          label: 'mend the plant',
          onComplete: { kind: 'repair_fixture', magnitude },
        } as OpInput,
      ],
      'model',
      actor,
    );

  it('is paid for at issue and puts the fixture back when it lands', () => {
    let s = tickTurn(tickTurn(saboteur(createSeedState('drajk')), calm).state, calm).state;
    s = { ...s, agents: [] };
    expect(plant(s).damage).toBe(2);
    const credits = s.factions.find((f) => f.id === 'drajk')!.credits;
    const out = repair(s);
    expect(out.rejections).toEqual([]);
    expect(out.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(credits - 2 * EFFECT_COST.repair_fixture);
    let t = out.state;
    for (let i = 0; i < 3; i++) t = tickTurn(t, calm).state;
    expect(plant(t).damage ?? 0).toBe(0);
    expect(workingStats(plant(t))).toHaveLength(2);
  });

  it('needs something broken', () => {
    expect(repair(createSeedState('drajk')).rejections[0]?.message).toMatch(/Nothing standing at .* is damaged/);
  });

  it('is the holder\'s work', () => {
    const s = tickTurn(saboteur(createSeedState('drajk')), calm).state;
    const out = repair(s, 1, 'meridian');
    expect(out.rejections[0]?.code).toBe('no_presence');
  });

  it('is halved by a partial result and stripped by a failure, like any programme', () => {
    const op = {
      op: 'issue_order',
      type: 'construction_infrastructure',
      onComplete: { kind: 'repair_fixture', magnitude: 2 },
    };
    const partial = boundPayloadsToOutcome([op], 'partial', 'industry').ops[0] as typeof op;
    expect(partial.onComplete.magnitude).toBe(1);
    const failed = boundPayloadsToOutcome([op], 'failure', 'industry').ops[0] as Partial<typeof op>;
    expect(failed.onComplete).toBeUndefined();
  });
});
