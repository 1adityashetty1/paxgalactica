import { describe, expect, it } from 'vitest';
import { outcomeKind } from '../src/api/contract.js';
import { whatCameOf } from '../src/server/session.js';

/** One word for what came of a declaration or an accord, read once on the server. */
describe('outcomeKind', () => {
  const base = { staged: 0 };
  it('reads a declaration in one order', () => {
    expect(outcomeKind({ ...base, outOfActions: { perTurn: 2 }, refusal: {} }, 'declared')).toBe('out_of_actions');
    expect(outcomeKind({ ...base, staged: 1, refusal: { by: 'x' } }, 'declared')).toBe('refused');
    expect(outcomeKind({ ...base, inadmissible: 'no' }, 'declared')).toBe('inadmissible');
    expect(outcomeKind({ ...base, inadmissible: 'no', unexpressed: true }, 'declared')).toBe('unexpressed');
    expect(outcomeKind({ ...base, negotiation: {} }, 'declared')).toBe('negotiation');
    expect(outcomeKind({ staged: 2, negotiation: {}, check: {} }, 'declared')).toBe('rolled');
    expect(outcomeKind({ staged: 1 }, 'declared')).toBe('sent');
  });

  it('reads an accord as agreed, refused or nothing', () => {
    expect(outcomeKind({ staged: 3 }, 'accord')).toBe('agreed');
    expect(outcomeKind({ staged: 0 }, 'accord')).toBe('nothing_agreed');
    expect(outcomeKind({ staged: 1, refusal: { by: 'x' } }, 'accord')).toBe('refused');
  });

  it("is what the counsellor's record of an act is written from", () => {
    expect(whatCameOf({ outOfActions: {}, refusal: { by: 'x', violated: 'y' } })).toBe('not attempted: the turn was spent');
    expect(whatCameOf({ inadmissible: 'no such world', unexpressed: true })).toBe('could not be attempted: no such world');
  });
});
