import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { ModelOpSchema, type OpInput } from '../src/domain/ops.js';
import { MAX_NARRATIVE_CREDITS, type WorldState } from '../src/domain/state.js';

/**
 * Money is written as what it is: a payment from one power to another, or a
 * cost paid to nobody (`docs/design-2026-10-17-intent-ops.md` §2). A signed
 * `adjust_credits` made the reducer infer which, and four of its rules exist
 * only because the op could not say who paid whom.
 */

const seed = (): WorldState => {
  const s = createSeedState('meridian');
  for (const f of s.factions) f.credits = 5_000;
  return s;
};
const credits = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;
const declare = (s: WorldState, ops: OpInput[]) => applyOps(s, ops, 'model', 'meridian', true, {}, 'declared');

describe('pay', () => {
  it('moves the actor’s money to another power, conserved', () => {
    const s = seed();
    const r = declare(s, [{ op: 'pay', factionId: 'meridian', to: 'ojjul', amount: 100, for: 'a word in the right ear' }]);
    expect(r.rejections).toEqual([]);
    expect(credits(r.state, 'meridian')).toBe(credits(s, 'meridian') - 100);
    expect(credits(r.state, 'ojjul')).toBe(credits(s, 'ojjul') + 100);
  });

  it('is held to the declaration’s cap', () => {
    const s = seed();
    const r = declare(s, [{ op: 'pay', factionId: 'meridian', to: 'ojjul', amount: 1_000 }]);
    expect(credits(r.state, 'ojjul')).toBe(credits(s, 'ojjul') + MAX_NARRATIVE_CREDITS);
    expect(credits(r.state, 'meridian')).toBe(credits(s, 'meridian') - MAX_NARRATIVE_CREDITS);
  });

  it('cannot be paid out of another power’s treasury on a declaration', () => {
    const r = declare(seed(), [{ op: 'pay', factionId: 'ojjul', to: 'meridian', amount: 100 }]);
    expect(r.rejections.map((x) => x.code)).toEqual(['illegal_value']);
  });

  it('cannot be paid to oneself', () => {
    const r = declare(seed(), [{ op: 'pay', factionId: 'meridian', to: 'meridian', amount: 100 }]);
    expect(r.rejections.map((x) => x.code)).toEqual(['illegal_value']);
  });

  it('in an accord, may come from either party and is not capped', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'pay', factionId: 'ojjul', to: 'meridian', amount: 1_500, for: 'the price of Ithaal' }], 'extraction', 'meridian', true, {}, 'accord');
    expect(r.rejections).toEqual([]);
    expect(credits(r.state, 'meridian')).toBe(credits(s, 'meridian') + 1_500);
    expect(credits(r.state, 'ojjul')).toBe(credits(s, 'ojjul') - 1_500);
  });
});

describe('spend', () => {
  it('takes the actor’s money to nobody', () => {
    const s = seed();
    const r = declare(s, [{ op: 'spend', factionId: 'meridian', amount: 50, for: 'a dockmaster' }]);
    expect(r.rejections).toEqual([]);
    expect(credits(r.state, 'meridian')).toBe(credits(s, 'meridian') - 50);
  });
});

describe('adjust_credits', () => {
  it('is no longer the model’s to write', () => {
    expect(ModelOpSchema.safeParse({ op: 'adjust_credits', factionId: 'meridian', delta: -50 }).success).toBe(false);
    expect(declare(seed(), [{ op: 'adjust_credits', factionId: 'meridian', delta: -50 }]).rejections.map((x) => x.code)).toEqual(['wrong_path']);
  });
});
