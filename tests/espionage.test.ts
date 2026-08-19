import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { MISSION_PROFILE, type AgentMission } from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';
import { serializeStanding } from '../src/model/serialize.js';
import { routeCovertAction } from '../src/domain/development.js';

/**
 * Agents have to be catchable.
 *
 * `MISSION_PROFILE.exposureRisk` documents a ladder — 1 in 20 for a watcher up
 * to 9 in 20 for an assassin — and for the whole life of the mechanic it fired
 * essentially never. Exposure was tested as `roll <= exposureRisk` inside the
 * failure branch, but a roll SUCCEEDS when `roll * 5 <= successChance`, so
 * rolls `1..floor(successChance / 5)` never reach that branch — exactly the
 * low rolls the test was looking for. `successChance` floors at 5, so a
 * surveillance operative could not be exposed at any stat pairing in the game.
 *
 * Measured before the fix: 80 operatives, five owner/target pairings, 40 turns
 * each, **zero exposures**. Nobody noticed because a burned agent is a
 * non-event — you observe nothing rather than something visibly wrong, which is
 * exactly why this file exists.
 *
 * These are statistical over the real reducer rather than unit tests of the
 * comparison, because the comparison looked correct. Bounds are loose; the
 * point is that the mechanism is alive and ordered, not that it hits a number.
 */

const PAIRINGS = [
  ['meridian', 'vigil'],
  ['hutt', 'meridian'],
  ['krayt', 'freeworlds'],
  ['vigil', 'hutt'],
  ['freeworlds', 'krayt'],
] as const;

/** Place `mission` agents on the target's worlds and run the tick for `turns`. */
function run(mission: AgentMission, turns: number): { placed: number; exposed: number; alive: number } {
  let placed = 0;
  let exposed = 0;
  let aliveTurns = 0;

  for (const [owner, target] of PAIRINGS) {
    let st: WorldState = createSeedState(owner);
    const worlds = st.systems.filter((x) => x.controllerFactionId === target).slice(0, 4);
    st.factions.find((f) => f.id === owner)!.credits = 99_999;
    // 'engine' source: the cap and the cost are not what is under test here.
    st = applyOps(
      st,
      worlds.map((w) => ({
        op: 'deploy_agent', ownerFactionId: owner, systemId: w.id, mission,
        effect: { kind: 'hull_damage', perTurn: 1 }, cover: '',
      })),
      'engine',
    ).state;
    placed += st.agents.length;

    for (let t = 0; t < turns; t += 1) {
      const before = st.eventLog.length;
      st = tickTurn(st).state;
      // One-shot operatives are removed in the tick that spends them, so the
      // log is the only place their exposure is observable.
      exposed += st.eventLog
        .slice(before)
        .filter((e) => /exposes .* operative/.test(e.text)).length;
      // Agent-turns still in place, which is what separates the missions: over
      // a long enough run EVERY operative is eventually caught, so exposure
      // counts saturate and only survival time discriminates.
      aliveTurns += st.agents.filter((a) => !a.exposed).length;
    }
  }
  return { placed, exposed, alive: aliveTurns };
}

describe('an operative can actually be caught', () => {
  it('exposes watchers at all — the regression that measured zero', () => {
    const { placed, exposed } = run('surveillance', 40);
    expect(placed).toBeGreaterThan(0);
    expect(exposed, 'surveillance never fired: the exposure test is dead again').toBeGreaterThan(0);
  });

  it('catches every persistent mission within a long run', () => {
    for (const mission of ['surveillance', 'theft', 'sabotage', 'defection'] as const) {
      const { exposed } = run(mission, 40);
      expect(exposed, `${mission} was never exposed in 40 turns`).toBeGreaterThan(0);
    }
  });

  it('keeps the safer mission in place longer than the riskier one', () => {
    // The ladder is the point: a watcher is rarely caught, a saboteur often is.
    // Compared as SURVIVAL rather than as exposure counts, because over a long
    // run every operative is caught eventually and the counts saturate at the
    // number placed. Comparing the two rather than asserting either pins the
    // ordering without turning a tuning value into a test people ignore.
    const watcher = run('surveillance', 40);
    const saboteur = run('sabotage', 40);
    expect(MISSION_PROFILE.sabotage.exposureRisk).toBeGreaterThan(
      MISSION_PROFILE.surveillance.exposureRisk,
    );
    expect(watcher.alive).toBeGreaterThan(saboteur.alive);
  });

  it('exposes an assassin roughly as often as the profile claims', () => {
    // One-shot, so every placement resolves in a single tick: attempts and
    // exposures are directly comparable.
    const { placed, exposed } = run('assassination', 1);
    const rate = exposed / placed;
    const claimed = MISSION_PROFILE.assassination.exposureRisk / 20;
    expect(rate).toBeGreaterThan(claimed - 0.2);
    expect(rate).toBeLessThan(claimed + 0.2);
  });

  it('leaves competence protecting the operative', () => {
    // Exposure reads the top of the die, so an agent good enough to succeed on
    // everything but a natural 20 is only ever caught on that 20. The bound
    // matters: it is 5%, not the 0% the old comparison produced.
    const risk = MISSION_PROFILE.surveillance.exposureRisk;
    const exposingRolls = [];
    for (let roll = 1; roll <= 20; roll += 1) {
      const succeeded = roll * 5 <= 95;
      if (!succeeded && roll >= 21 - risk) exposingRolls.push(roll);
    }
    expect(exposingRolls).toEqual([20]);
  });
});

/**
 * The cap has to be visible, or the model narrates around it.
 *
 * `maxAgentsFor` had no reader anywhere in `src/model/`, so no call knew a
 * faction was at its limit. Found in a 27-turn playtest: at 3 of 3, an action
 * phrased "buy a clerk in the customs house" produced a full success story and
 * **zero ops** — no rejection, no note, nothing in state — because the model
 * never emitted the op that would have been refused. Same shape as the arbiter
 * never being shown the red lines it was asked to enforce.
 */
describe('the model can see how many operatives it is running', () => {
  it('states the count and the ceiling', () => {
    const state = createSeedState('meridian');
    const block = serializeStanding(state, 'meridian');
    // Meridian: guile 13 -> 2 + 1.
    expect(block).toMatch(/Your operatives: 0 of 3/);
    expect(block).toMatch(/room for 3 more/);
  });

  it('says so plainly when there is no room left', () => {
    let state = createSeedState('meridian');
    const targets = state.systems.filter((x) => x.controllerFactionId === 'vigil').slice(0, 3);
    state = applyOps(
      state,
      targets.map((t) => ({
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: t.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      })),
      'model',
      'meridian',
    ).state;

    const block = serializeStanding(state, 'meridian');
    expect(block).toMatch(/Your operatives: 3 of 3/);
    expect(block).toMatch(/AT YOUR LIMIT/);
  });

  it('counts only live operatives, so a burned one frees a slot', () => {
    let state = createSeedState('meridian');
    const target = state.systems.find((x) => x.controllerFactionId === 'vigil')!;
    state = applyOps(
      state,
      [{
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: target.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      }],
      'model',
      'meridian',
    ).state;
    expect(serializeStanding(state, 'meridian')).toMatch(/Your operatives: 1 of 3/);

    state.agents[0]!.exposed = true;
    expect(serializeStanding(state, 'meridian')).toMatch(/Your operatives: 0 of 3/);
  });
});

/**
 * One act, one mechanism.
 *
 * A declared covert action and a deployed operative were two routes to the same
 * fiction with uncoordinated prices. A deployed assassination costs 150 credits,
 * counts against the cap, is spent after one attempt, is caught about 45% of the
 * time and costs the target 35 disposition undetected or 40 exposed — all in
 * code. A declared "assassinate their raid captain" was priced as an ordinary
 * `guile` check and the resolution call invented the consequences: measured
 * live, −15 with the victim and −6 with an onlooker, for no credits, against no
 * cap, with no exposure roll. The cheaper route was the one a player reaches by
 * typing a sentence.
 */
describe('a declared covert action becomes a deployment', () => {
  const covert = { mission: 'assassination' as const, systemId: 'kes-6' };

  it('places an operative when the resolution call did not', () => {
    const out = routeCovertAction([], 'success', covert, 'meridian');
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0]).toMatchObject({
      op: 'deploy_agent',
      ownerFactionId: 'meridian',
      systemId: 'kes-6',
      mission: 'assassination',
    });
    expect(out.notes[0]).toMatch(/charged and capped/);
  });

  it('leaves the batch alone when it already placed one', () => {
    const ops = [
      { op: 'deploy_agent', ownerFactionId: 'meridian', systemId: 'kes-6',
        mission: 'assassination', effect: { kind: 'hull_damage', perTurn: 3 }, cover: '' },
    ];
    const out = routeCovertAction(ops, 'success', covert, 'meridian');
    expect(out.ops).toBe(ops);
    expect(out.notes).toHaveLength(0);
  });

  it('places nobody on a failure — the man was caught at the door', () => {
    for (const outcome of ['failure', 'critical_failure'] as const) {
      const out = routeCovertAction([], outcome, covert, 'meridian');
      expect(out.ops).toEqual([]);
      expect(out.notes).toHaveLength(0);
    }
  });

  it('does nothing at all to an overt action', () => {
    const ops = [{ op: 'adjust_credits', factionId: 'meridian', delta: -50 }];
    expect(routeCovertAction(ops, 'success', null, 'meridian').ops).toBe(ops);
  });

  it('is then charged, capped and exposed like any other operative', () => {
    // The whole point of routing: the same guards apply. At the cap, the
    // synthesized deployment is rejected rather than quietly landing.
    let state = createSeedState('meridian');
    const targets = state.systems.filter((x) => x.controllerFactionId === 'vigil').slice(0, 3);
    state = applyOps(
      state,
      targets.map((t) => ({
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: t.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      })),
      'model',
      'meridian',
    ).state;

    const routed = routeCovertAction([], 'success', { mission: 'sabotage', systemId: targets[0]!.id }, 'meridian');
    const out = applyOps(state, routed.ops, 'model', 'meridian');
    expect(out.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(out.rejections[0]!.message).toMatch(/already running 3 operatives/);
  });
});
