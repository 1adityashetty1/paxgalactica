import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import {
  CONCESSION_BUDGET_TURNS,
  CONCESSION_FLOW_TURNS,
  CONCESSION_SCALE_MAX,
  CONCESSION_SCALE_MIN,
  concessionBudget,
  concessionWorth,
  withinBudget,
} from '../src/domain/leverage.js';
import { groundInConcessions } from '../src/engine/turn.js';
import { ConcessionSchema, type Concession } from '../src/domain/diplomacy.js';
import { addShipsAt, INCOME_PER_STRATEGIC_POINT, ledgerFor, SHIP_COST, type WorldState } from '../src/domain/state.js';

/**
 * The concession budget: how much a power will give up in one conversation,
 * set in code by income, standing and leverage. Code owns how much ground; the
 * model owns the words.
 */

const c = (over: Partial<Concession>): Concession => ConcessionSchema.parse({ by: 'ojjul', kind: 'x', text: 'given', ...over });
const setRegard = (s: WorldState, from: string, toward: string, v: number) => {
  s.factions.find((f) => f.id === from)!.disposition[toward] = v;
};

describe('what a concession is worth', () => {
  it('prices everything in one unit', () => {
    const s = createSeedState('meridian');
    const world = s.systems.find((x) => x.id === 'ilv-2')!;
    expect(concessionWorth(s, c({ credits: 100 }))).toBe(100);
    expect(concessionWorth(s, c({ perTurn: 10 }))).toBe(10 * CONCESSION_FLOW_TURNS);
    expect(concessionWorth(s, c({ hulls: 2 }))).toBe(2 * SHIP_COST);
    expect(concessionWorth(s, c({ systems: ['ilv-2'] }))).toBe(world.strategicValue * INCOME_PER_STRATEGIC_POINT * 12);
  });

  it('a thing is worth what it is worth to the power giving it up', () => {
    const s = createSeedState('meridian');
    // Arkane's prisoners: 2 a crew to Arkane, 20 to Drajk.
    const prisoners = s.assets.find((a) => a.kind === 'prisoners')!;
    expect(concessionWorth(s, c({ by: 'freeworlds', assets: [prisoners.id] }))).toBe(2 * prisoners.quantity);
  });
});

describe('the budget', () => {
  it('is turns of the power\'s own income, scaled by standing', () => {
    const s = createSeedState('meridian');
    setRegard(s, 'ojjul', 'meridian', 0);
    const plain = concessionBudget(s, 'ojjul', 'meridian');
    setRegard(s, 'ojjul', 'meridian', 50);
    expect(concessionBudget(s, 'ojjul', 'meridian').budget).toBeGreaterThan(plain.budget);
    setRegard(s, 'ojjul', 'meridian', -50);
    expect(concessionBudget(s, 'ojjul', 'meridian').budget).toBeLessThan(plain.budget);
    expect(plain.budget).toBe(Math.round(ledgerFor(s, 'ojjul').gross * CONCESSION_BUDGET_TURNS * plain.scale));
  });

  it('widens with leverage: a favour owed, a fleet overhead', () => {
    const s = createSeedState('meridian');
    const before = concessionBudget(s, 'ojjul', 'meridian').budget;
    s.obligations.push({
      id: 'obl-x', debtorFactionId: 'ojjul', holderFactionId: 'meridian', strength: 'weak', origin: 'accord',
      text: 'owed', establishedTurn: 0, restsUntil: null, status: 'open',
    });
    const owed = concessionBudget(s, 'ojjul', 'meridian');
    expect(owed.budget).toBeGreaterThan(before);
    expect(owed.because.join(' ')).toMatch(/obligation/);
    addShipsAt(s.systems.find((x) => x.controllerFactionId === 'ojjul')!, 'meridian', 4, 'battleship');
    expect(concessionBudget(s, 'ojjul', 'meridian').budget).toBeGreaterThan(owed.budget);
  });

  it('never falls below a quarter or climbs past three times', () => {
    const s = createSeedState('meridian');
    // Hated, and with no influence to speak of.
    setRegard(s, 'ojjul', 'meridian', -100);
    s.factions.find((f) => f.id === 'meridian')!.stats.influence = 1;
    expect(concessionBudget(s, 'ojjul', 'meridian').scale).toBe(CONCESSION_SCALE_MIN);
    setRegard(s, 'ojjul', 'meridian', 100);
    for (let i = 0; i < 10; i++) {
      s.obligations.push({
        id: `obl-${i}`, debtorFactionId: 'ojjul', holderFactionId: 'meridian', strength: 'strong', origin: 'blackmail',
        text: 'owed', establishedTurn: 0, restsUntil: null, status: 'open',
      });
    }
    expect(concessionBudget(s, 'ojjul', 'meridian').scale).toBe(CONCESSION_SCALE_MAX);
  });
});

describe('holding a channel to it', () => {
  it('keeps what fits in the order it was given, strikes what overruns, and leaves the other side alone', () => {
    const s = createSeedState('meridian');
    const { budget } = concessionBudget(s, 'ojjul', 'meridian');
    const small = c({ kind: 'small', credits: Math.floor(budget / 2) });
    const big = c({ kind: 'big', credits: budget });
    const theirs = c({ by: 'meridian', kind: 'mine', credits: 100000 });
    const held = withinBudget(s, [small, big, theirs], 'ojjul', 'meridian');
    expect(held.kept.map((x) => x.kind)).toEqual(['small', 'mine']);
    expect(held.over.map((x) => x.kind)).toEqual(['big']);
    expect(held.given).toBe(small.credits);
  });
});

describe('grounding the new negotiated ops', () => {
  it('a favour owed by the other power needs it to have conceded something', () => {
    const s = createSeedState('meridian');
    const op = { op: 'establish_obligation', debtorFactionId: 'ojjul', holderFactionId: 'meridian', text: 'owed' };
    expect(groundInConcessions(s, [op], [], 'ojjul').ops).toEqual([]);
    expect(groundInConcessions(s, [op], [c({})], 'ojjul').ops).toEqual([op]);
  });
});
