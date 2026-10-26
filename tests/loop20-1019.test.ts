import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { sendingIsTheAct } from '../src/model/calls.js';

/** Fixes from the twentieth loop of the advisor playtest (2026-10-19). */

describe('a refusal for not being where the act goes', () => {
  it('is false when the act sends ships and the power has some', () => {
    const s = createSeedState('meridian');
    expect(sendingIsTheAct(s, 'Land twelve troops at Var Hollow.', { kind: 'not_present' })).toMatch(/Going there is the act/);
  });

  it('stands for work done where the power must already be, and on other grounds', () => {
    const s = createSeedState('meridian');
    expect(sendingIsTheAct(s, 'Fortify Ithaal.', { kind: 'not_present' })).toBeNull();
    expect(sendingIsTheAct(s, 'Land troops at Var Hollow.', { kind: 'not_held' })).toBeNull();
  });
});
