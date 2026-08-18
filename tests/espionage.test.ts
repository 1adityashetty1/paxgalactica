import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { MISSION_PROFILE, type AgentMission } from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';

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
