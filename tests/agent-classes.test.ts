import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { AGENT_CLASSES, listedAgentsOf } from '../src/domain/command.js';
import {
  AGENT_MISSIONS,
  CLASS_EXPOSURE_SHIFT,
  CLASS_SUCCESS_SHIFT,
  MISSION_CLASS,
  MISSION_PROFILE,
  classFit,
  exposureRiskOf,
} from '../src/domain/diplomacy.js';
import { proposeFor } from '../src/domain/initiative.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/** Operative classes: a class runs its own missions better and others worse. */
const home = (s: WorldState, f: string) => s.systems.find((x) => x.controllerFactionId === f)!.id;
const target = (s: WorldState) => s.systems.find((x) => x.controllerFactionId === 'vigil')!.id;

function sendAs(agentClass: (typeof AGENT_CLASSES)[number], mission: 'surveillance' | 'sabotage') {
  let s = createSeedState('meridian');
  s = applyOps(s, [{ op: 'recruit_agent', systemId: home(s, 'meridian'), agentClass } as OpInput], 'model', 'meridian').state;
  const effect = mission === 'surveillance' ? { kind: 'intel' } : { kind: 'hull_damage', perTurn: 2 };
  const r = applyOps(s, [{ op: 'deploy_agent', systemId: target(s), mission, effect } as OpInput], 'model', 'meridian');
  expect(r.rejections).toEqual([]);
  return r.state.agents.at(-1)!;
}

describe('operative classes', () => {
  it('file every mission under exactly one class, and every class has a mission', () => {
    for (const m of AGENT_MISSIONS) expect(AGENT_CLASSES).toContain(MISSION_CLASS[m]);
    for (const c of AGENT_CLASSES) expect(AGENT_MISSIONS.some((m) => MISSION_CLASS[m] === c)).toBe(true);
    expect(MISSION_CLASS).toMatchObject({
      surveillance: 'ghost', theft: 'ghost',
      subversion: 'agitator', discord: 'agitator', incitement: 'agitator',
      defection: 'sparrow', seduction: 'sparrow',
      assassination: 'wetworker', sabotage: 'wetworker',
    });
  });

  it('wait one of each on every power’s Lists', () => {
    const s = createSeedState('meridian');
    for (const f of s.factions) {
      expect(listedAgentsOf(s.listedAgents, f.id).map((a) => a.agentClass).sort()).toEqual([...AGENT_CLASSES].sort());
    }
  });

  it('run their own missions at better odds and less risk, and others’ at worse', () => {
    const ghostWatching = sendAs('ghost', 'surveillance');
    const wetworkWatching = sendAs('wetworker', 'surveillance');
    expect(ghostWatching.agentClass).toBe('ghost');
    expect(ghostWatching.successChance - wetworkWatching.successChance).toBe(2 * CLASS_SUCCESS_SHIFT);
    expect(exposureRiskOf(ghostWatching, 'sabotage')).toBe(MISSION_PROFILE.sabotage.exposureRisk + CLASS_EXPOSURE_SHIFT);
    expect(exposureRiskOf({ agentClass: 'wetworker' }, 'sabotage')).toBe(MISSION_PROFILE.sabotage.exposureRisk - CLASS_EXPOSURE_SHIFT);
    // Never below one in twenty.
    expect(exposureRiskOf({ agentClass: 'ghost' }, 'surveillance')).toBe(1);
    // An operative from before classes plays as it always did.
    expect(classFit(undefined, 'sabotage')).toBe(0);
    expect(exposureRiskOf({}, 'sabotage')).toBe(MISSION_PROFILE.sabotage.exposureRisk);
  });

  it('send the mission’s class first when nobody is named, and keep their class through a recall', () => {
    let s = createSeedState('meridian');
    for (const c of ['ghost', 'wetworker'] as const) {
      s = applyOps(s, [{ op: 'recruit_agent', systemId: home(s, 'meridian'), agentClass: c } as OpInput], 'model', 'meridian').state;
    }
    const sent = applyOps(s, [{ op: 'deploy_agent', systemId: target(s), mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 } } as OpInput], 'model', 'meridian').state;
    const saboteur = sent.agents.find((a) => a.mission === 'sabotage')!;
    expect(saboteur.agentClass).toBe('wetworker');
    const back = applyOps(sent, [{ op: 'recall_agent', agentId: saboteur.id, reason: '' } as OpInput], 'model', 'meridian').state;
    expect(listedAgentsOf(back.listedAgents, 'meridian').find((a) => a.name === saboteur.name)?.agentClass).toBe('wetworker');
  });

  it('are what the bots recruit for the job', () => {
    // Over a run, every operative a bot has signed on runs a mission of its own class.
    let s = createSeedState('meridian');
    for (let t = 0; t < 12; t++) {
      for (const f of s.factions) {
        const at = s;
        const proposal = proposeFor(at, f.id, (ops) => applyOps(at, ops, 'model', f.id, true).rejections.length === 0);
        if (proposal) s = applyOps(s, proposal.ops, 'model', f.id).state;
      }
      s = tickTurn(s, { randomEvents: false }).state;
    }
    const working = s.agents.filter((a) => a.mission !== null && a.agentClass);
    expect(working.length).toBeGreaterThan(0);
    for (const a of working) expect(classFit(a.agentClass, a.mission!), `${a.name} on ${a.mission}`).toBe(1);
  });
});
