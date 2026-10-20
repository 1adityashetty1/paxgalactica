import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { boundPayloadsToOutcome } from '../src/domain/development.js';

/**
 * Band-aids from the second loop of the advisor playtest (2026-10-19), each
 * reproducing what that playtest hit.
 */

describe('a levy on a full garrison', () => {
  const levy = { op: 'raise_garrison', factionId: 'meridian', systemId: 'tor-1', magnitude: 3 };

  it('raises nobody and costs nothing, and says how to raise the ceiling', () => {
    const s = createSeedState('meridian');
    const before = s.factions.find((f) => f.id === 'meridian')!.credits;
    const r = applyOps(s, [levy], 'model', 'meridian', true, {}, 'declared');
    expect(r.rejections).toEqual([]);
    expect(r.state.pendingOrders).toHaveLength(0);
    expect(r.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(before);
    expect(r.notes.join(' ')).toMatch(/barracks are already full \(9\/9\).*Fortify/);
  });

  it('is taken as before for a journal before version 30', () => {
    const r = applyOps(createSeedState('meridian'), [levy], 'model', 'meridian', true, { fullBarracksRefused: false }, 'declared');
    expect(r.state.pendingOrders).toHaveLength(1);
  });
});

describe('an open build is held to the band', () => {
  const build = { op: 'build_ships', factionId: 'meridian', systemId: 'tor-1', hull: 'battleship', count: 5 };
  it('lays down half on a partial and nothing on a failure', () => {
    expect(boundPayloadsToOutcome([build], 'partial').ops).toEqual([{ ...build, count: 2 }]);
    expect(boundPayloadsToOutcome([build], 'failure').ops).toEqual([]);
    expect(boundPayloadsToOutcome([build], 'success').ops).toEqual([build]);
  });
});

describe('structural fixes from loop 2', async () => {
  const { pressuresOn } = await import('../src/domain/pressures.js');
  const { AdvisorReplySchema } = await import('../src/model/calls.js');

  it('L9: the staff flags the odds of attacking a hostile base, in the battle’s own reckoning', () => {
    const s = createSeedState('meridian');
    const flagged = pressuresOn(s, 'meridian').join('\n');
    expect(flagged).toMatch(/An attack on (Kalzir|Vantic) \(Iron Vigil Remnant\) with what stands at Torrek Anchorage would be [\d.]+:1/);
    expect(flagged).toMatch(/it never breaks off/);
  });

  it('L8: the counsellor may recommend one act, never a sequence', () => {
    const counsel = 'Chief Executive, the Vigil has lift a jump from Torrek.';
    expect(AdvisorReplySchema.safeParse({ counsel, recommendation: 'Raise the walls at Torrek Anchorage.' }).success).toBe(true);
    expect(AdvisorReplySchema.safeParse({ counsel, recommendation: 'Raise the walls at Torrek, then strike Kalzir.' }).success).toBe(false);
    expect(AdvisorReplySchema.safeParse({ counsel }).success).toBe(true);
  });
});
