import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { REGARD_BECAUSE } from '../src/domain/acts.js';
import type { OpInput } from '../src/domain/ops.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * An accord's warmth is priced (`docs/design-2026-10-18-code-knows.md` §8,
 * journal version 28): it writes `regard` for a reason off the closed list,
 * once a direction, none beside a treaty's goodwill and none for a
 * conversation that agreed nothing. Narrated `adjust_disposition` is refused.
 */

const seed = (): WorldState => createSeedState('meridian');
const accord = (s: WorldState, ops: unknown[], legacy = {}) => applyOps(s, ops, 'extraction', 'meridian', true, legacy, 'accord');
const view = (s: WorldState, a: string, b: string) => s.factions.find((f) => f.id === a)!.disposition[b] ?? 0;
const regard = (factionId: string, toward: string, because: string) => ({ op: 'regard', factionId, toward, because }) as OpInput;
const deal = { op: 'establish_commitment', kind: 'harbour_courtesy', factionIds: ['meridian', 'vigil'], text: 'Each harbour takes the other’s hulls.' } as OpInput;

describe('an accord moves regard for a listed reason', () => {
  it('refuses narrated warmth, and keeps it for a journal before version 28', () => {
    const narrated = { op: 'adjust_disposition', factionId: 'vigil', towardFactionId: 'meridian', delta: 20 };
    expect(accord(seed(), [deal, narrated]).rejections.map((r) => r.code)).toEqual(['wrong_path']);
    const old = accord(seed(), [deal, narrated], { pricedWarmth: false });
    expect(old.rejections).toEqual([]);
  });

  it('moves either party’s view of the other by the table, and nobody else’s', () => {
    const s = seed();
    const r = accord(s, [deal, regard('vigil', 'meridian', 'promise_kept'), regard('meridian', 'vigil', 'deference')]);
    expect(r.rejections).toEqual([]);
    // The commitment's own goodwill moves both ways too; the regard sits on top.
    const goodwill = accord(s, [deal]).state;
    expect(view(r.state, 'vigil', 'meridian') - view(goodwill, 'vigil', 'meridian')).toBe(REGARD_BECAUSE.promise_kept);
    expect(view(r.state, 'meridian', 'vigil') - view(goodwill, 'meridian', 'vigil')).toBe(REGARD_BECAUSE.deference);
    expect(accord(s, [deal, regard('vigil', 'drajk', 'insult')]).rejections.map((x) => x.code)).toEqual(['illegal_value']);
  });

  it('warms nobody when nothing was agreed, and still cools', () => {
    const s = seed();
    const warm = accord(s, [regard('vigil', 'meridian', 'promise_kept')]);
    expect(view(warm.state, 'vigil', 'meridian')).toBe(view(s, 'vigil', 'meridian'));
    expect(warm.notes.join(' ')).toMatch(/agreed nothing/);
    const sour = accord(s, [regard('vigil', 'meridian', 'insult')]);
    expect(view(sour.state, 'vigil', 'meridian')).toBe(view(s, 'vigil', 'meridian') + REGARD_BECAUSE.insult);
  });

  it('moves a direction once, adds nothing beside a treaty, and leaves out aid', () => {
    const s = seed();
    const goodwill = accord(s, [deal]).state;
    const twice = accord(s, [deal, regard('vigil', 'meridian', 'promise_kept'), regard('vigil', 'meridian', 'aid'), regard('vigil', 'meridian', 'deference')]);
    expect(view(twice.state, 'vigil', 'meridian') - view(goodwill, 'vigil', 'meridian')).toBe(REGARD_BECAUSE.promise_kept);
    expect(twice.notes.join(' ')).toMatch(/aid is what a gift or a payment buys/);
    expect(twice.notes.join(' ')).toMatch(/moved once for this accord/);

    const treaty = { op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'vigil'], terms: {}, summary: 'peace' } as OpInput;
    const only = accord(s, [treaty]).state;
    const beside = accord(s, [treaty, regard('vigil', 'meridian', 'promise_kept')]);
    expect(view(beside.state, 'vigil', 'meridian')).toBe(view(only, 'vigil', 'meridian'));
    expect(beside.notes.join(' ')).toMatch(/treaty's own goodwill/);
  });
});
