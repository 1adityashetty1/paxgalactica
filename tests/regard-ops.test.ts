import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { GIFT_MAX_REGARD, GIFT_RATE, REGARD_BECAUSE, SWAY_BY_BAND } from '../src/domain/acts.js';
import { swaysAsRolled } from '../src/domain/refusals.js';
import { MAX_NARRATIVE_CREDITS, type WorldState } from '../src/domain/state.js';

/**
 * A model judges that a power's view moved and why; the table says how much
 * (`docs/design-2026-10-17-intent-ops.md` §3). Narrated `adjust_disposition`
 * was the largest model-written op in the saved campaigns — 310 of them — and
 * the reducer could bound its size and never its cause.
 */

const seed = (): WorldState => {
  const s = createSeedState('meridian');
  for (const f of s.factions) f.credits = 5_000;
  return s;
};
const view = (s: WorldState, who: string, toward: string) => s.factions.find((f) => f.id === who)!.disposition[toward] ?? 0;

describe('a sway is sized by the roll', () => {
  const sway = { op: 'sway', factionId: 'meridian', whom: 'ojjul' };

  it('moves nothing unless the check was influence and it worked', () => {
    expect(swaysAsRolled([sway], 'influence', 'failure').ops).toEqual([]);
    expect(swaysAsRolled([sway], 'guile', 'success').ops).toEqual([]);
    expect(swaysAsRolled([sway], undefined, undefined).ops).toEqual([]);
  });

  it('is stamped with the band’s amount, whatever the model wrote', () => {
    expect(swaysAsRolled([{ ...sway, amount: 15 }], 'influence', 'partial').ops).toEqual([{ ...sway, amount: SWAY_BY_BAND.partial }]);
    expect(swaysAsRolled([sway], 'influence', 'critical_success').ops).toEqual([{ ...sway, amount: SWAY_BY_BAND.critical_success }]);
  });

  it('moves a power once a declaration', () => {
    expect(swaysAsRolled([sway, sway], 'influence', 'success').ops).toHaveLength(1);
  });

  it('lands on the other power’s view of the actor', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'sway', factionId: 'meridian', whom: 'ojjul', amount: 6 }], 'model', 'meridian', true, {}, 'declared');
    expect(view(r.state, 'ojjul', 'meridian')).toBe(view(s, 'ojjul', 'meridian') + 6);
    expect(view(r.state, 'meridian', 'ojjul')).toBe(view(s, 'meridian', 'ojjul'));
  });
});

describe('regard is priced by its reason', () => {
  it('moves the reacting power’s own view by the table', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'regard', factionId: 'vigil', toward: 'meridian', because: 'threat' }], 'model', 'vigil', true, {}, 'reaction');
    expect(r.rejections).toEqual([]);
    expect(view(r.state, 'vigil', 'meridian')).toBe(Math.max(-100, view(s, 'vigil', 'meridian') + REGARD_BECAUSE.threat));
  });

  it('cools and warms, so a vocabulary of grievances alone does not ratchet the galaxy to war', () => {
    expect(Object.values(REGARD_BECAUSE).some((v) => v > 0)).toBe(true);
    expect(Object.values(REGARD_BECAUSE).some((v) => v < 0)).toBe(true);
  });
});

describe('a gift', () => {
  it('moves the money and buys regard at the published rate', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'gift', factionId: 'meridian', to: 'ojjul', amount: 100 }], 'model', 'meridian', true, {}, 'declared');
    expect(r.rejections).toEqual([]);
    expect(r.state.factions.find((f) => f.id === 'ojjul')!.credits).toBe(5_100);
    expect(view(r.state, 'ojjul', 'meridian')).toBe(view(s, 'ojjul', 'meridian') + 100 / GIFT_RATE);
  });

  it('buys no more than the cap, however large', () => {
    const s = seed();
    const r = applyOps(s, [{ op: 'gift', factionId: 'meridian', to: 'ojjul', amount: 5_000 }], 'model', 'meridian', true, {}, 'declared');
    expect(view(r.state, 'ojjul', 'meridian')).toBe(view(s, 'ojjul', 'meridian') + Math.min(GIFT_MAX_REGARD, Math.floor(MAX_NARRATIVE_CREDITS / GIFT_RATE)));
  });
});
