import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { AGENT_COST, RIDER_DISCORD, RIDER_EXPOSURE, exposureRiskOf } from '../src/domain/diplomacy.js';
import { checkGround } from '../src/domain/refusals.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * The rest of `docs/design-2026-10-16-ruling-schema.md`: riders (a second
 * outcome on one operative's order), `relocate_asset`, refusal grounds checked
 * against the board, and every mission holding its own effects.
 */
const VANTIC = 'tor-3'; // the Vigil's
const DRAWINGS = 'ast-0-1'; // the Vigil's Imperial drawings, held at Vantic
const credits = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;
const regard = (s: WorldState, who: string, of: string) => s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;
const tick = (s: WorldState) => tickTurn(s, { randomEvents: false }).state;

function send(op: Record<string, unknown>, sure: boolean) {
  let s = createSeedState('meridian');
  s.factions.find((f) => f.id === 'meridian')!.credits = 5000;
  const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
  s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
  const before = credits(s, 'meridian');
  const r = applyOps(s, [{ op: 'deploy_agent', systemId: VANTIC, ...op } as OpInput], 'model', 'meridian');
  expect(r.rejections).toEqual([]);
  s = r.state;
  const spy = s.agents.at(-1)!;
  spy.inPlaceFrom = s.turn;
  spy.successChance = sure ? 100 : 0;
  return { s, spy, paid: before - credits(s, 'meridian') };
}

describe('a rider: one operative, two outcomes', () => {
  const larcenyWithFrame = {
    mission: 'larceny',
    effect: { kind: 'steal', assetId: DRAWINGS, copy: false },
    rider: { mission: 'discord', towardFactionId: 'Drajk' },
  };

  it('is priced at its own mission, resolves a power named in words, and makes the order louder', () => {
    const { spy, paid } = send(larcenyWithFrame, true);
    expect(paid).toBe(AGENT_COST.larceny + AGENT_COST.discord);
    expect(spy.rider).toMatchObject({ mission: 'discord', towardFactionId: 'drajk', paid: AGENT_COST.discord });
    expect(exposureRiskOf(spy, 'larceny')).toBe(exposureRiskOf({ ...spy, rider: undefined }, 'larceny') + RIDER_EXPOSURE);
  });

  it('lands once, when the primary does', () => {
    const { s } = send(larcenyWithFrame, true);
    const after = tick(s);
    expect(after.assets.find((a) => a.id === DRAWINGS)!.heldBy).toBe('meridian');
    const control = tick(send({ ...larcenyWithFrame, rider: undefined }, true).s);
    expect(regard(after, 'vigil', 'drajk')).toBe(Math.max(-100, regard(control, 'vigil', 'drajk') - RIDER_DISCORD));
    expect(after.agents.at(-1)?.rider).toBeUndefined();
  });

  it('is refunded when the primary ends without it', () => {
    const { s } = send(larcenyWithFrame, false);
    const after = tick(s);
    const control = tick(send({ ...larcenyWithFrame, rider: undefined }, false).s);
    // It paid the rider's price at the send and had it back: the treasuries meet.
    expect(credits(after, 'meridian')).toBe(credits(control, 'meridian'));
    expect(after.eventLog.some((e) => e.text.includes('credits back'))).toBe(true);
  });

  it('cannot ride on its own mission, or frame the power whose world it is', () => {
    let s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
    const twice = applyOps(s, [{
      op: 'deploy_agent', systemId: VANTIC, mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 },
      rider: { mission: 'sabotage' },
    } as OpInput], 'model', 'meridian');
    expect(twice.rejections).toHaveLength(1);
    const self = applyOps(s, [{ ...larcenyWithFrame, op: 'deploy_agent', systemId: VANTIC, rider: { mission: 'discord', towardFactionId: 'vigil' } } as OpInput], 'model', 'meridian');
    expect(self.rejections[0]?.message).toMatch(/against itself/);
  });
});

describe('relocate_asset', () => {
  it('moves a thing between the holder’s own worlds, and nowhere else', () => {
    const s = createSeedState('vigil');
    const mine = s.systems.filter((x) => x.controllerFactionId === 'vigil');
    const next = mine.find((m) => m.id !== VANTIC && m.hyperlaneEdges.includes(VANTIC)) ??
      mine.find((m) => m.id !== VANTIC && s.systems.find((x) => x.id === VANTIC)!.hyperlaneEdges.includes(m.id))!;
    const moved = applyOps(s, [{ op: 'relocate_asset', assetId: DRAWINGS, toSystemId: next.id } as OpInput], 'model', 'vigil');
    expect(moved.rejections).toEqual([]);
    expect(moved.state.assets.find((a) => a.id === DRAWINGS)!.atSystemId).toBe(next.id);
    const foreign = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    expect(applyOps(s, [{ op: 'relocate_asset', assetId: DRAWINGS, toSystemId: foreign.id } as OpInput], 'model', 'vigil').rejections).toHaveLength(1);
    expect(applyOps(s, [{ op: 'relocate_asset', assetId: DRAWINGS, toSystemId: next.id } as OpInput], 'model', 'meridian').rejections).toHaveLength(1);
  });
});

describe('a refusal’s ground is checked on the board', () => {
  const s = createSeedState('ojjul');
  it('holds when the fact is so', () => {
    expect(checkGround(s, 'ojjul', { kind: 'no_such_entity', name: 'Quentin Zarbo', entity: 'person' })).toBeNull();
    expect(checkGround(s, 'ojjul', { kind: 'not_present', systemId: 'ark-1' })).toBeNull();
    expect(checkGround(s, 'ojjul', { kind: 'not_held', name: 'Imperial drawings' })).toBeNull();
  });
  it('fails when the board says otherwise', () => {
    const someone = s.notables![0]!.name;
    expect(checkGround(s, 'ojjul', { kind: 'no_such_entity', name: someone, entity: 'person' })).toMatch(/does exist/);
    expect(checkGround(s, 'ojjul', { kind: 'no_such_entity', name: 'Vantic', entity: 'world' })).toMatch(/does exist/);
    const home = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    expect(checkGround(s, 'ojjul', { kind: 'not_present', systemId: home.id })).toMatch(/present/);
    expect(checkGround(s, 'ojjul', { kind: 'commitment_conflict', id: 'nothing-like-it' })).toMatch(/no treaty/);
    expect(checkGround(s, 'ojjul', { kind: 'already_so', ref: 'nothing-like-it' })).toMatch(/no record/);
  });
});

describe('every mission holds its own effects', () => {
  it('replaces an effect a mission does not carry with its own', () => {
    let s = createSeedState('meridian');
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    s = applyOps(s, [{ op: 'recruit_agent', systemId: home } as OpInput], 'model', 'meridian').state;
    const r = applyOps(s, [{
      op: 'deploy_agent', systemId: VANTIC, mission: 'assassination', effect: { kind: 'turn_notable' },
    } as OpInput], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(r.state.agents.at(-1)!.effect?.kind).not.toBe('turn_notable');
  });
});
