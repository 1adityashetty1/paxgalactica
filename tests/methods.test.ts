import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  AGENT_COST,
  METHOD_AXES,
  METHOD_EASE_STEP,
  MISSION_PROFILE,
  budgetMethod,
  exposureRiskOf,
  type MethodProfile,
} from '../src/domain/diplomacy.js';
import { seatedAt } from '../src/domain/seats.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Methods and groundwork — docs/design-2026-10-16-operations.md. These test the
 * MECHANISM and never a method: the names below are arbitrary on purpose.
 */
const VANTIC = 'tor-3';
const KALZIR = 'tor-2';
const P = (preparation: number, ease: number, noise: number, ifCaught: number): MethodProfile => ({ preparation, ease, noise, ifCaught });

function withSpy(agentClass = 'ghost') {
  let s = createSeedState('meridian');
  const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
  s = applyOps(s, [{ op: 'recruit_agent', systemId: home, agentClass } as OpInput], 'model', 'meridian').state;
  return { s, spy: s.agents.at(-1)! };
}
const send = (s: WorldState, extra: Record<string, unknown> = {}, at = VANTIC) =>
  applyOps(s, [{ op: 'deploy_agent', systemId: at, mission: 'surveillance', effect: { kind: 'intel' }, ...extra } as OpInput], 'model', 'meridian');
const credits = (s: WorldState) => s.factions.find((f) => f.id === 'meridian')!.credits;

describe('the method budget', () => {
  it('holds every profile to a sum of zero or less, clipping ease, then preparation, then noise', () => {
    expect(budgetMethod(P(1, 1, 0, -1))).toEqual({ profile: P(1, 0, 0, -1), clipped: ['ease'] });
    expect(budgetMethod(P(1, 1, 1, 1)).profile).toEqual(P(0, 0, 0, 0));
    expect(budgetMethod(P(-1, 1, 0, 0)).clipped).toEqual([]);
    // Every legal input comes out within budget and within ±1.
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) for (const d of [-1, 0, 1]) {
      const { profile } = budgetMethod(P(a, b, c, d));
      expect(METHOD_AXES.reduce((n, x) => n + profile[x], 0)).toBeLessThanOrEqual(0);
      for (const x of METHOD_AXES) expect(Math.abs(profile[x])).toBeLessThanOrEqual(1);
    }
  });
});

describe('a method on a mission', () => {
  it('moves the price, the odds and the exposure by its profile, whatever it is called', () => {
    const { s } = withSpy();
    const plain = send(s);
    const base = plain.state.agents.at(-1)!;
    for (const text of ['a forged letter', 'a cake with a file in it', 'xyzzy']) {
      const r = send(s, { method: { text, profile: P(1, -1, 1, -1) } });
      expect(r.rejections).toEqual([]);
      const spy = r.state.agents.at(-1)!;
      expect(credits(s) - credits(r.state)).toBe(Math.round(AGENT_COST.surveillance * 0.75));
      expect(spy.successChance).toBe(Math.max(5, base.successChance - METHOD_EASE_STEP));
      expect(spy.method).toEqual({ text, profile: P(1, -1, 1, -1) });
    }
    expect(exposureRiskOf({ method: { text: 'x', profile: P(0, 0, -1, 1) } }, 'sabotage')).toBe(MISSION_PROFILE.sabotage.exposureRisk + 1);
  });

  it('is clipped, with a note, when it asks more than it gives', () => {
    const { s } = withSpy();
    const r = send(s, { method: { text: 'too good', profile: P(1, 1, 1, 0) } });
    expect(r.state.agents.at(-1)!.method!.profile).toEqual(P(0, 0, 0, 0));
    expect(r.notes.join(' ')).toMatch(/held back/);
  });

  it('makes being caught free when deniable, and dearer for everyone when it backfires', () => {
    const caughtWith = (ifCaught: number) => {
      let s = createSeedState('meridian');
      s.agents.push({
        id: 'agt-x', ownerFactionId: 'meridian', systemId: VANTIC, mission: 'sabotage',
        effect: { kind: 'hull_damage', perTurn: 1 }, successChance: 0, deployedTurn: 0, inPlaceFrom: 0,
        exposed: false, cover: '', name: 'Test Person', operations: 0, timesCaught: 0, targetCommanderId: null,
        method: { text: 'x', profile: P(0, 0, -1, ifCaught) },
      } as never);
      // Sweep turns until the roll exposes them.
      for (let t = 0; t < 40; t++) {
        s.turn = t;
        const after = tickTurn(s, { randomEvents: false }).state;
        if (after.agents.find((a) => a.id === 'agt-x')?.exposed) return { before: s, after };
      }
      throw new Error('never exposed');
    };
    const reg = (s: WorldState, a: string) => s.factions.find((f) => f.id === a)!.disposition['meridian'] ?? 0;
    const deniable = caughtWith(1);
    const traced = caughtWith(0);
    const backfire = caughtWith(-1);
    const lost = (r: { before: WorldState; after: WorldState }, f: string) => reg(r.before, f) - reg(r.after, f);
    expect(lost(deniable, 'vigil')).toBeLessThan(lost(traced, 'vigil'));
    expect(lost(backfire, 'vigil')).toBeGreaterThan(lost(traced, 'vigil'));
    expect(lost(backfire, 'drajk')).toBeGreaterThan(lost(traced, 'drajk'));
  });
});

describe('groundwork', () => {
  const lay = (s: WorldState, extra: Record<string, unknown> = {}) =>
    applyOps(s, [{ op: 'lay_groundwork', systemId: VANTIC, text: 'on the dock roster', axis: 'ease', ...extra } as OpInput], 'model', 'meridian');

  it('is laid on the operative, counts from the next turn, and is spent when used', () => {
    const { s, spy } = withSpy();
    const laid = lay(s);
    expect(laid.rejections).toEqual([]);
    const g = laid.state.agents.find((a) => a.id === spy.id)!.groundwork!;
    expect(g).toHaveLength(1);
    // The same turn it is laid, a mission draws nothing from it.
    const now = send(laid.state);
    expect(now.state.agents.find((a) => a.id === spy.id)!.method).toBeUndefined();
    // From the turn after it holds, it adds a step of ease outside any budget.
    let later = laid.state;
    while (later.turn <= g[0]!.madeTurn) later = tickTurn(later, { randomEvents: false }).state;
    const plain = send(withSpyAt(later, spy.id)).state.agents.find((a) => a.id === spy.id)!;
    const used = send(later).state.agents.find((a) => a.id === spy.id)!;
    expect(used.method?.profile.ease).toBe(1);
    expect(used.successChance).toBe(Math.min(95, plain.successChance + METHOD_EASE_STEP));
    expect(used.groundwork).toBeUndefined();
  });

  it('helps only a mission on the same world, at the same target, and is lost by leaving', () => {
    const { s, spy } = withSpy();
    const governor = seatedAt(s, KALZIR)[0]!;
    let st = applyOps(s, [{ op: 'lay_groundwork', systemId: KALZIR, text: 'in the kitchens', axis: 'ease', target: governor.name } as OpInput], 'model', 'meridian').state;
    expect(st.agents.find((a) => a.id === spy.id)!.groundwork![0]!.target).toBe(governor.id);
    while (st.turn <= st.agents.find((a) => a.id === spy.id)!.groundwork![0]!.madeTurn) st = tickTurn(st, { randomEvents: false }).state;
    // Aimed elsewhere on the same world: no help, and the piece is kept.
    const other = applyOps(st, [{ op: 'deploy_agent', agent: spy.id, systemId: KALZIR, mission: 'embezzlement', effect: { kind: 'income_penalty', perTurn: 5 } } as OpInput], 'model', 'meridian').state;
    const o = other.agents.find((a) => a.id === spy.id)!;
    expect(o.method).toBeUndefined();
    expect(o.groundwork).toHaveLength(1);
    // Sent to another world: the piece is lost.
    const away = send(st, { agent: spy.id }).state.agents.find((a) => a.id === spy.id)!;
    expect(away.groundwork).toBeUndefined();
  });

  it('goes stale after a few turns', () => {
    const { s, spy } = withSpy();
    let st = lay(s).state;
    for (let i = 0; i < 8; i++) st = tickTurn(st, { randomEvents: false }).state;
    expect(st.agents.find((a) => a.id === spy.id)?.groundwork).toBeUndefined();
  });

  it('is refused on the acting power’s own world', () => {
    const { s } = withSpy();
    const home = s.systems.find((x) => x.controllerFactionId === 'meridian')!.id;
    expect(applyOps(s, [{ op: 'lay_groundwork', systemId: home, text: 'x', axis: 'ease' } as OpInput], 'model', 'meridian').rejections[0]?.code).toBe('illegal_value');
  });
});

/** The same state with the operative's groundwork removed, for a baseline. */
function withSpyAt(s: WorldState, id: string): WorldState {
  const c = structuredClone(s);
  delete c.agents.find((a) => a.id === id)!.groundwork;
  return c;
}

describe('routing the arbiter’s ruling', () => {
  it('rides the method on the deployment it describes, and lays the groundwork it ruled', async () => {
    const { routeCovertAction } = await import('../src/domain/development.js');
    const method = { text: 'a borrowed uniform', profile: P(0, 1, 0, -1) };
    const out = routeCovertAction(
      [],
      'success',
      [{ mission: 'larceny', systemId: VANTIC, target: 'the drawings', method }],
      'meridian',
      [{ systemId: KALZIR, text: 'on the night watch', axis: 'noise' }],
    );
    const deploy = out.ops.find((o) => (o as { op: string }).op === 'deploy_agent') as { method?: unknown };
    expect(deploy.method).toEqual(method);
    expect(out.ops.some((o) => (o as { op: string }).op === 'lay_groundwork')).toBe(true);
    // A deployment the resolution call wrote itself gets the method too.
    const own = routeCovertAction(
      [{ op: 'deploy_agent', systemId: VANTIC, mission: 'larceny', effect: { kind: 'steal' } }],
      'success',
      [{ mission: 'larceny', systemId: VANTIC, method }],
      'meridian',
    );
    expect((own.ops[0] as { method?: unknown }).method).toEqual(method);
    // A failure lays and places nothing.
    expect(routeCovertAction([], 'failure', [], 'meridian', [{ systemId: KALZIR, text: 'x', axis: 'ease' }]).ops).toEqual([]);
  });

  it('accepts a ruling with a method, groundwork and an unexpressed outcome', async () => {
    const { AppraisalSchema } = await import('../src/domain/ops.js');
    const r = AppraisalSchema.safeParse({
      admissible: true, reason: '', stat: 'guile', difficulty: 14,
      covert: [{ mission: 'assassination', systemId: KALZIR, target: 'the Governor', method: { text: 'poison in a toast', profile: P(0, 0, 1, -1) } }],
      groundwork: [{ systemId: KALZIR, text: 'hired as a cook', axis: 'ease', target: 'the Governor' }],
      unexpressed: 'moving a prisoner between worlds',
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
