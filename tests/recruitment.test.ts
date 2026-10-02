import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { effectiveStats, maxAgentsFor, type WorldState } from '../src/domain/state.js';
import { AGENT_COST, AGENT_JUMPS_PER_TURN, atWork } from '../src/domain/diplomacy.js';
import { recruitmentAlone } from '../src/engine/turn.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Recruiting and sending are two acts, and an operative travels.
 *
 * An operative used to be recruited, placed anywhere in the galaxy and at work
 * on the same End Turn — one declaration, any world, no road. Now `recruit_agent`
 * signs one on at a world the power holds, awaiting orders; `deploy_agent` sends
 * one already on the books, three jumps a turn; and a declaration that recruits
 * does nothing else. Pinned to journal version 11 (`operativesTravel`).
 */

// Meridian holds Brannix (sek-4). From there: Vantic (tor-3) is 2 jumps,
// Gorrun Deep (tor-4) 3, Ilvenn Approach... and Vergesse (ilv-6) 4.
const HOME = 'sek-4';
const NEAR = 'tor-3';
const FAR = 'ilv-6';

const fresh = (): WorldState => {
  const s = createSeedState('meridian');
  s.factions.find((f) => f.id === 'meridian')!.credits = 5000;
  return s;
};
const apply = (s: WorldState, ops: unknown[]) => applyOps(s, ops as OpInput[], 'model', 'meridian');
const recruit = (s: WorldState, at = HOME) => apply(s, [{ op: 'recruit_agent', systemId: at }]);
const send = (s: WorldState, systemId: string, extra: Record<string, unknown> = {}) =>
  apply(s, [
    {
      op: 'deploy_agent', systemId, mission: 'subversion',
      effect: { kind: 'stat_debuff', stat: 'influence', magnitude: 2 }, ...extra,
    },
  ]);

describe('recruiting an operative', () => {
  it('signs one on at home, awaiting orders, for nothing', () => {
    const s = fresh();
    const out = recruit(s);
    expect(out.rejections).toEqual([]);
    const spy = out.state.agents[0]!;
    expect(spy).toMatchObject({ ownerFactionId: 'meridian', systemId: HOME, mission: null, effect: null });
    expect(spy.name).not.toBe('');
    expect(out.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(5000);
    expect(atWork(spy, out.state.turn)).toBe(false);
  });

  it('only on a world the power holds', () => {
    expect(recruit(fresh(), NEAR).rejections[0]?.code).toBe('no_presence');
  });

  it('is held to the ceiling', () => {
    let s = fresh();
    for (let i = 0; i < maxAgentsFor(s, 'meridian'); i++) s = recruit(s).state;
    expect(recruit(s).rejections[0]?.message).toMatch(/already running/);
  });
});

describe('sending one', () => {
  it('needs somebody on the books', () => {
    const out = send(fresh(), NEAR);
    expect(out.rejections[0]?.message).toMatch(/no operative awaiting orders/);
    expect(out.state.agents).toHaveLength(0);
  });

  it('charges the mission, and travels three jumps a turn', () => {
    const s = recruit(fresh()).state;
    const near = send(s, NEAR);
    expect(near.rejections).toEqual([]);
    expect(near.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(5000 - AGENT_COST.subversion);
    expect(near.state.agents[0]!.inPlaceFrom).toBe(s.turn + Math.ceil(2 / AGENT_JUMPS_PER_TURN));
    const far = send(s, FAR);
    expect(far.state.agents[0]!.inPlaceFrom).toBe(s.turn + Math.ceil(4 / AGENT_JUMPS_PER_TURN));
  });

  it('within three jumps, is at work by the End Turn it was sent on — not before', () => {
    // The way a fleet a jump out fights on the End Turn it sails: the road is
    // walked in the tick, and the work starts on arrival.
    const s = send(recruit(fresh()).state, NEAR).state;
    const vigilInfluence = effectiveStats(fresh(), 'vigil').influence;
    expect(effectiveStats(s, 'vigil').influence).toBe(vigilInfluence);
    const after = tickTurn(s, { randomEvents: false }).state;
    expect(atWork(after.agents[0]!, after.turn)).toBe(true);
    expect(effectiveStats(after, 'vigil').influence).toBe(vigilInfluence - 2);
  });

  it('further out, a turn later for every three jumps more', () => {
    const s = send(recruit(fresh()).state, FAR).state;
    const one = tickTurn(s, { randomEvents: false }).state;
    expect(atWork(one.agents[0]!, one.turn)).toBe(false);
    const two = tickTurn(one, { randomEvents: false }).state;
    expect(atWork(two.agents[0]!, two.turn)).toBe(true);
  });

  it('re-tasks one already on a mission only when it is named', () => {
    const s = send(recruit(fresh()).state, NEAR).state;
    const spy = s.agents[0]!;
    expect(send(s, FAR).rejections[0]?.message).toMatch(/no operative awaiting orders/);
    const named = send(s, FAR, { agent: spy.name.split(' ').at(-1) });
    expect(named.rejections).toEqual([]);
    expect(named.state.agents[0]!.systemId).toBe(FAR);
  });

  it('replays a journal from before it as one step, anywhere, at once', () => {
    const out = applyOps(
      fresh(),
      [{ op: 'deploy_agent', systemId: FAR, mission: 'subversion', effect: { kind: 'stat_debuff', stat: 'resolve', magnitude: 2 } }] as OpInput[],
      'model',
      'meridian',
      false,
      { operativesTravel: false },
    );
    expect(out.rejections).toEqual([]);
    expect(atWork(out.state.agents[0]!, out.state.turn)).toBe(true);
  });
});

describe('a declaration that recruits does nothing else', () => {
  it('keeps the recruitment and its note, and drops the rest with a reason', () => {
    for (const recruitOp of [
      { op: 'recruit_agent', systemId: HOME },
      { op: 'recruit_commander', factionId: 'meridian', systemId: HOME },
    ]) {
      const out = recruitmentAlone([
        { op: 'log_narrative', text: '[check] ...' },
        recruitOp,
        { op: 'issue_order', factionId: 'meridian', type: 'fleet_movement', originId: HOME, targetId: NEAR },
      ]);
      expect(out.ops.map((o) => (o as { op: string }).op)).toEqual(['log_narrative', recruitOp.op]);
      expect(out.notes[0]).toMatch(/Recruiting is an action of its own.*issue_order/);
    }
  });

  it('leaves a declaration with no recruitment alone', () => {
    const ops = [{ op: 'issue_order' }, { op: 'deploy_agent' }];
    expect(recruitmentAlone(ops).ops).toBe(ops);
  });
});
