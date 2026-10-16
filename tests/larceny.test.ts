import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { AGENT_COST, DOSSIER_KIND, MISSION_CLASS } from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Larceny: one attempt at a named thing held on a world, the original or a
 * copy of paper, and the operative is free again. And `theft` is now
 * `embezzlement`, which old journals still read.
 */
const VANTIC = 'tor-3';
const DRAWINGS = 'ast-0-1'; // the Vigil's Imperial line-of-battle drawings, held at Vantic

function sendThief(effect: Record<string, unknown>, sure = true) {
  let s = createSeedState('meridian');
  const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
  s = applyOps(s, [{ op: 'recruit_agent', systemId: home, agentClass: 'ghost' } as OpInput], 'model', 'meridian').state;
  const r = applyOps(s, [{ op: 'deploy_agent', systemId: VANTIC, mission: 'larceny', effect: { kind: 'steal', ...effect } } as OpInput], 'model', 'meridian');
  expect(r.rejections).toEqual([]);
  s = r.state;
  const spy = s.agents.at(-1)!;
  spy.inPlaceFrom = s.turn;
  spy.successChance = sure ? 100 : 0;
  return { s, spy };
}
const asset = (s: WorldState, id: string) => s.assets.find((a) => a.id === id);

describe('larceny', () => {
  it('is a ghost mission, priced like one', () => {
    expect(MISSION_CLASS.larceny).toBe('ghost');
    expect(AGENT_COST.larceny).toBeGreaterThan(AGENT_COST.embezzlement);
  });

  it('takes the named original, carries it home, and frees the operative', () => {
    const { s, spy } = sendThief({ assetId: DRAWINGS });
    const after = tickTurn(s, { randomEvents: false }).state;
    const drawings = asset(after, DRAWINGS)!;
    expect(drawings.heldBy).toBe('meridian');
    expect(after.systems.find((x) => x.id === drawings.atSystemId)?.controllerFactionId).toBe('meridian');
    const thief = after.agents.find((a) => a.id === spy.id)!;
    expect(thief.mission).toBeNull();
    expect(thief.systemId).toBe(VANTIC);
    // The Vigil learns it is gone, not who took it.
    const told = after.eventLog.find((e) => e.text.includes('nobody can say who took it'))!;
    expect(told.visibleTo).toEqual(['vigil']);
  });

  it('finds the thing by the words the player used', () => {
    const { s } = sendThief({ assetId: 'the line-of-battle drawings' });
    expect(asset(tickTurn(s, { randomEvents: false }).state, DRAWINGS)!.heldBy).toBe('meridian');
  });

  it('copies paper: a dossier for the thief, the original left where it was', () => {
    const { s } = sendThief({ assetId: DRAWINGS, copy: true });
    const after = tickTurn(s, { randomEvents: false }).state;
    expect(asset(after, DRAWINGS)!.heldBy).toBe('vigil');
    const copy = after.assets.find((a) => a.kind === DOSSIER_KIND && a.heldBy === 'meridian')!;
    expect(copy.text).toContain('a copy of');
  });

  it('comes away empty and free on a failure that is not caught', () => {
    const { s, spy } = sendThief({ assetId: DRAWINGS }, false);
    const after = tickTurn(s, { randomEvents: false }).state;
    expect(asset(after, DRAWINGS)!.heldBy).toBe('vigil');
    const thief = after.agents.find((a) => a.id === spy.id)!;
    if (!thief.exposed) expect(thief.mission).toBeNull();
  });

  it('takes no person, no fixture and no promissory note', () => {
    let s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
    // The Kalzir academy is a fixture: nothing to carry off.
    s = applyOps(s, [{ op: 'deploy_agent', systemId: 'tor-2', mission: 'larceny', effect: { kind: 'steal', assetId: 'ast-0-5' } } as OpInput], 'model', 'meridian').state;
    const spy = s.agents.at(-1)!;
    spy.inPlaceFrom = s.turn;
    spy.successChance = 100;
    const after = tickTurn(s, { randomEvents: false }).state;
    expect(asset(after, 'ast-0-5')!.heldBy).toBe('vigil');
  });

  it('holds every mission to its own effect: an embezzler skims, and only a thief steals', () => {
    let s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
    const r = applyOps(s, [{ op: 'deploy_agent', systemId: VANTIC, mission: 'embezzlement', effect: { kind: 'intel' } } as OpInput], 'model', 'meridian');
    expect(r.state.agents.at(-1)!.effect?.kind).toBe('income_penalty');
    const old = applyOps(s, [{ op: 'deploy_agent', systemId: VANTIC, mission: 'embezzlement', effect: { kind: 'intel' } } as OpInput], 'model', 'meridian', false, { missionEffectsHeld: false });
    expect(old.state.agents.at(-1)!.effect?.kind).toBe('intel');
  });

  it('reads an old journal’s `theft` as embezzlement', () => {
    let s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
    const r = applyOps(s, [{ op: 'deploy_agent', systemId: VANTIC, mission: 'theft', effect: { kind: 'income_penalty', perTurn: 5 } } as OpInput], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(r.state.agents.at(-1)!.mission).toBe('embezzlement');
  });
});
