import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { AGENT_COST, KIDNAP_RESENTMENT, MISSION_CLASS } from '../src/domain/diplomacy.js';
import { SEAT_VACATED_FAVOUR } from '../src/domain/estates.js';
import { heldAs, notableById, seatedAt, whereabouts } from '../src/domain/seats.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/** Kidnapping: one attempt to seize a named person on a world, held as the kidnapper's prisoner. */
const KALZIR = 'tor-2';
const regard = (s: WorldState, a: string, b: string) => s.factions.find((f) => f.id === a)!.disposition[b] ?? 0;
const favour = (s: WorldState, estateId: string) => s.factions.flatMap((f) => f.estates).find((e) => e.id === estateId)!.favour;

function sendKidnapper(target: Record<string, unknown>, at = KALZIR, setup?: (s: WorldState) => void) {
  let s = createSeedState('meridian');
  setup?.(s);
  const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
  s = applyOps(s, [{ op: 'recruit_agent', systemId: home, agentClass: 'wetworker' } as OpInput], 'model', 'meridian').state;
  const r = applyOps(s, [{ op: 'deploy_agent', systemId: at, mission: 'kidnapping', effect: { kind: 'kidnap' }, ...target } as OpInput], 'model', 'meridian');
  return { r, before: s };
}
function sure(s: WorldState) {
  const spy = s.agents.at(-1)!;
  spy.inPlaceFrom = s.turn;
  spy.successChance = 100;
  return spy;
}

describe('kidnapping', () => {
  it('is a wetworker mission, dearer than larceny and cheaper than a knife', () => {
    expect(MISSION_CLASS.kidnapping).toBe('wetworker');
    expect(AGENT_COST.kidnapping).toBeGreaterThan(AGENT_COST.larceny);
    expect(AGENT_COST.kidnapping).toBeLessThan(AGENT_COST.assassination);
  });

  it('seizes a seated notable: held on the kidnapper’s world, the seat empty, the estate and the power aggrieved', () => {
    const s0 = createSeedState('meridian');
    const governor = seatedAt(s0, KALZIR)[0]!;
    const { r } = sendKidnapper({ targetNotable: governor.name });
    expect(r.rejections).toEqual([]);
    const s = r.state;
    const spy = sure(s);
    const was = regard(s, 'vigil', 'meridian');
    const ticked = tickTurn(s, { randomEvents: false });
    const after = ticked.state;
    // Said the turn it happens, under the mission it was (bughunt 2026-10-28).
    expect(ticked.notes.some((n) => n.includes('(kidnapping, ') && n.includes(governor.name))).toBe(true);
    expect(after.eventLog.some((e) => e.kind === 'intel' && e.text.startsWith('[kidnapping · '))).toBe(true);
    const n = notableById(after, governor.id)!;
    expect(whereabouts(after, n)).toBe('held');
    const held = heldAs(after, governor.id)!;
    expect(held.heldBy).toBe('meridian');
    expect(after.systems.find((x) => x.id === held.atSystemId)?.controllerFactionId).toBe('meridian');
    expect(seatedAt(after, KALZIR).some((x) => x.id === governor.id)).toBe(false);
    expect(regard(after, 'vigil', 'meridian')).toBeLessThanOrEqual(was - KIDNAP_RESENTMENT);
    expect(favour(after, governor.estateId!)).toBeLessThanOrEqual(favour(s, governor.estateId!) - SEAT_VACATED_FAVOUR + 2);
    expect(after.agents.find((a) => a.id === spy.id)!.mission).toBeNull();
  });

  it('seizes an officer standing on the world, as a captured officer the kidnapper holds', () => {
    let officerName = '';
    const { r } = sendKidnapper({}, KALZIR, (s) => {
      const o = s.commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!;
      o.atSystemId = KALZIR;
      officerName = o.name;
    });
    expect(r.rejections[0]?.code).toBe('illegal_value'); // nobody named
    const named = sendKidnapper({ targetCommanderId: '' }, KALZIR, (s) => {
      const o = s.commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!;
      o.atSystemId = KALZIR;
    });
    expect(named.r.rejections.length).toBeGreaterThan(0);
    const ok = sendKidnapper({ targetCommanderId: officerName }, KALZIR, (s) => {
      const o = s.commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!;
      o.atSystemId = KALZIR;
    });
    expect(ok.r.rejections).toEqual([]);
    sure(ok.r.state);
    const after = tickTurn(ok.r.state, { randomEvents: false }).state;
    const o = after.commanders.find((c) => c.name === officerName)!;
    expect(o.status).toBe('captured');
    expect(after.assets.find((a) => a.commanderId === o.id)?.heldBy).toBe('meridian');
  });

  it('finds nobody when the officer has sailed, and the operative comes away free', () => {
    const officerName = createSeedState('meridian').commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!.name;
    const ok = sendKidnapper({ targetCommanderId: officerName }, KALZIR, (s) => {
      const o = s.commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!;
      o.atSystemId = KALZIR;
    });
    const s = ok.r.state;
    sure(s);
    s.commanders.find((c) => c.name === officerName)!.atSystemId = 'tor-3';
    const after = tickTurn(s, { randomEvents: false }).state;
    expect(after.commanders.find((c) => c.name === officerName)!.status).toBe('active');
    expect(after.agents.at(-1)!.mission).toBeNull();
  });

  it('refuses a name that is nobody there, before any price', () => {
    const { r, before } = sendKidnapper({ targetNotable: 'Nobody Atall' });
    expect(r.rejections[0]?.code).toBe('illegal_value');
    expect(r.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(before.factions.find((f) => f.id === 'meridian')!.credits);
  });
});
