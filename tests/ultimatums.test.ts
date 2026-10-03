import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { ULTIMATUM_RESENTMENT, ULTIMATUM_TERM_TURNS, ULTIMATUM_YIELD_RATIO } from '../src/domain/diplomacy.js';
import { sideStrength } from '../src/domain/leverage.js';
import { proposeFor } from '../src/domain/initiative.js';
import { addShipsAt, WAR_DISPOSITION_THRESHOLD, warsFor, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Ultimatums (journal version 13): a public demand with a deadline. Others may
 * back either side; at the deadline it has been given way to, or it is war.
 */

const calm = { randomEvents: false };
const tick = (s: WorldState, n = 1) => {
  for (let i = 0; i < n; i++) s = tickTurn(s, calm).state;
  return s;
};
const demand = (s: WorldState, from: string, to: string, extra: Record<string, unknown> = {}) =>
  applyOps(
    s,
    [{ op: 'issue_ultimatum', targetFactionId: to, demand: 'tribute', perTurn: 20, deadlineTurns: 2, text: 'pay', ...extra } as OpInput],
    'model',
    from,
  );
const regard = (s: WorldState, from: string, toward: string) =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;
/** Pile `n` battleships onto a power's best world, to settle who outguns whom. */
const arm = (s: WorldState, who: string, n: number) => {
  const home = s.systems.filter((x) => x.controllerFactionId === who).sort((a, b) => b.strategicValue - a.strategicValue)[0]!;
  addShipsAt(home, who, n, 'battleship');
  return s;
};

describe('making a demand', () => {
  it('is public, names its terms, and runs to a deadline', () => {
    const s = createSeedState('meridian');
    const out = demand(s, 'meridian', 'freeworlds');
    expect(out.rejections).toEqual([]);
    expect(out.state.demands.at(-1)).toMatchObject({
      fromFactionId: 'meridian', toFactionId: 'freeworlds', kind: 'tribute', perTurn: 20,
      deadlineTurn: s.turn + 2, status: 'open',
    });
    expect(out.state.eventLog.at(-1)!.visibleTo).toBeNull();
  });

  it('is not made across a peace you have sworn', () => {
    let s = createSeedState('meridian');
    s = applyOps(s, [{ op: 'form_treaty', parties: ['meridian', 'freeworlds'], treatyType: 'non_aggression', terms: {} } as OpInput], 'extraction', 'meridian', true).state;
    expect(demand(s, 'meridian', 'freeworlds').rejections[0]?.message).toMatch(/bound to peace/);
  });

  it('asks for a world the target actually holds', () => {
    const out = demand(createSeedState('meridian'), 'meridian', 'freeworlds', { demand: 'cession', systemId: 'tor-2', perTurn: undefined });
    expect(out.rejections[0]?.message).toMatch(/world/);
  });

  it('one at a time against one power', () => {
    const s = demand(createSeedState('meridian'), 'meridian', 'freeworlds').state;
    expect(demand(s, 'meridian', 'freeworlds').rejections[0]?.message).toMatch(/already has a demand/);
  });
});

describe('giving way', () => {
  it('forms what was demanded, and the target resents it', () => {
    const s = demand(createSeedState('freeworlds'), 'meridian', 'freeworlds').state;
    const out = applyOps(s, [{ op: 'concede_ultimatum', demandId: s.demands.at(-1)!.id } as OpInput], 'model', 'freeworlds');
    expect(out.rejections).toEqual([]);
    const t = out.state.treaties.at(-1)!;
    expect(t).toMatchObject({ type: 'tribute', expiresTurn: s.turn + ULTIMATUM_TERM_TURNS });
    expect(t.terms.incomePerTurn).toEqual({ freeworlds: -20, meridian: 20 });
    expect(out.state.demands.at(-1)!.status).toBe('conceded');
    expect(regard(out.state, 'freeworlds', 'meridian')).toBe(regard(s, 'freeworlds', 'meridian') - ULTIMATUM_RESENTMENT);
  });

  it('is the target\'s to do', () => {
    const s = demand(createSeedState('freeworlds'), 'meridian', 'freeworlds').state;
    const out = applyOps(s, [{ op: 'concede_ultimatum', demandId: s.demands.at(-1)!.id } as OpInput], 'model', 'ojjul');
    expect(out.rejections[0]?.message).toMatch(/Only/);
  });
});

describe('the deadline', () => {
  it('is war when the player lets it run, for everyone on both sides', () => {
    // The player is the target, and backed.
    let s = demand(createSeedState('freeworlds'), 'meridian', 'freeworlds').state;
    s = applyOps(s, [{ op: 'back_ultimatum', demandId: s.demands.at(-1)!.id, side: 'from' } as OpInput], 'model', 'ojjul').state;
    s = tick(s, 2);
    expect(s.demands.at(-1)!.status).toBe('war');
    expect(warsFor(s, 'freeworlds')).toEqual(expect.arrayContaining(['meridian', 'ojjul']));
    expect(regard(s, 'meridian', 'freeworlds')).toBeLessThanOrEqual(WAR_DISPOSITION_THRESHOLD);
  });

  it('is given way to by a bot-run power its issuer outguns', () => {
    let s = arm(createSeedState('freeworlds'), 'vigil', 60);
    s = demand(s, 'vigil', 'ojjul').state;
    expect(sideStrength(s, ['vigil'])).toBeGreaterThanOrEqual(ULTIMATUM_YIELD_RATIO * sideStrength(s, ['ojjul']));
    s = tick(s, 2);
    expect(s.demands.at(-1)!.status).toBe('conceded');
    expect(s.treaties.some((t) => t.type === 'tribute' && t.parties.includes('vigil') && t.parties.includes('ojjul'))).toBe(true);
  });

  it('is war when a bot-run power is not outgunned', () => {
    let s = arm(createSeedState('freeworlds'), 'ojjul', 60);
    s = demand(s, 'meridian', 'ojjul').state;
    s = tick(s, 2);
    expect(s.demands.at(-1)!.status).toBe('war');
  });
});

describe('the sides', () => {
  it('a third power may back either; a hook or a peace keeps it out', () => {
    let s = demand(createSeedState('freeworlds'), 'meridian', 'ojjul').state;
    const id = s.demands.at(-1)!.id;
    const back = (st: WorldState, who: string, side: string) =>
      applyOps(st, [{ op: 'back_ultimatum', demandId: id, side } as OpInput], 'model', who);
    expect(back(s, 'drajk', 'to').rejections).toEqual([]);
    s.obligations.push({
      id: 'obl-x', debtorFactionId: 'drajk', holderFactionId: 'meridian', strength: 'strong', origin: 'blackmail',
      text: 'held', establishedTurn: 0, restsUntil: null, status: 'open',
    });
    expect(back(s, 'drajk', 'to').rejections[0]?.message).toMatch(/hook/);
  });

  it('the bots back the side against a power they are at war with', () => {
    // The Vigil is at war with Drajk; a demand made of Drajk draws it in.
    const s = demand(createSeedState('freeworlds'), 'ojjul', 'drajk').state;
    const ops = proposeFor(s, 'vigil')?.ops ?? [];
    expect(ops.find((o) => o.op === 'back_ultimatum')).toMatchObject({ side: 'from' });
  });

  it('a withdrawn demand answers nothing', () => {
    let s = demand(createSeedState('freeworlds'), 'meridian', 'ojjul').state;
    s = applyOps(s, [{ op: 'withdraw_ultimatum', demandId: s.demands.at(-1)!.id } as OpInput], 'model', 'meridian').state;
    s = tick(s, 3);
    expect(s.demands.at(-1)!.status).toBe('withdrawn');
    expect(warsFor(s, 'meridian')).not.toContain('ojjul');
  });
});
