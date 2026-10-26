import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { paperOf } from '../src/domain/pressures.js';
import { ACT_WORDS } from '../src/domain/acts.js';

/** Fixes from the ninth loop of the advisor playtest (2026-10-19). */

describe('the counsellor’s paper', () => {
  it('lists the work actually under way, and says when there is none', () => {
    const s = createSeedState('meridian');
    expect(paperOf(s, 'meridian').join('\n')).toMatch(/Your work under way: none/);
    const r = applyOps(s, [{ op: 'send_envoy', factionId: 'meridian', systemId: 'sek-3', magnitude: 2, label: 'envoy to Ithaal' }], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(paperOf(r.state, 'meridian').join('\n')).toMatch(/Your work under way \(nothing else is\): envoy to Ithaal at Ithaal, \d+ turns? to go/);
  });
});

describe('walking away from an arrangement', () => {
  it('is named as one sworn with another power, which is the only kind the reducer charges', () => {
    expect(ACT_WORDS.commitment_walked).toBe('walk away from an arrangement sworn with another power');
  });
});
