import { describe, expect, it } from 'vitest';
import { applyOps, DISSENT_DECAY, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  DOCTRINE_CHANGE_DISSENT_CEILING,
  DOCTRINE_ETHIC_DISSENT,
  DOCTRINE_RETIRE_DISSENT,
  DOCTRINE_TEXT_DISSENT,
  dissentPenalty,
  effectiveStats,
  ledgerFor,
  REFUSAL_DISSENT,
  type Op,
  type WorldState,
} from '../src/domain/state.js';

/**
 * `set_doctrine` used to write a string and nothing else.
 *
 * Every axis that did anything — `warEthic`, `tradeEthic`, `redLines`,
 * `compulsions` — was immutable for a whole campaign, so a player could declare
 * a change of course, watch the doctrine paragraph update in the UI, and then
 * be refused by the compulsion they thought they had just abandoned. There was
 * no path by which a faction's mechanical character could ever change, and
 * nothing told the player that.
 *
 * It changes for real now, and dissent is the price.
 */

const fresh = (player = 'meridian'): WorldState => createSeedState(player);
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;

/** Meridian's own compulsion, quoted exactly as the faction sheet carries it. */
const NO_RAIDING =
  'commerce raiding is refused outright — the Authority insures the cargo it would be seizing, and preying on shipping ends it as a going concern';

const turnRaider = (retire: string[] = []): Op => ({
  op: 'set_doctrine',
  factionId: 'meridian',
  doctrine: 'Commerce was a mistake. We take the lanes by force and let the ledgers follow.',
  warEthic: 'opportunist',
  tradeEthic: 'smuggler',
  retire,
});

describe('a doctrine change is priced in dissent', () => {
  it('charges for restating a posture, which is the cheap part', () => {
    const out = applyOps(
      fresh(),
      [{ op: 'set_doctrine', factionId: 'meridian', doctrine: 'Commerce, but louder.' }],
      'model',
      'meridian',
    );
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'meridian').dissent).toBe(DOCTRINE_TEXT_DISSENT);
  });

  it('charges nothing for restating the posture it already holds', () => {
    const state = fresh();
    const out = applyOps(
      state,
      [{ op: 'set_doctrine', factionId: 'meridian', doctrine: fac(state, 'meridian').doctrine }],
      'model',
      'meridian',
    );
    expect(fac(out.state, 'meridian').dissent).toBe(0);
  });

  it('charges per axis actually moved', () => {
    const out = applyOps(fresh(), [turnRaider([NO_RAIDING])], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'meridian').dissent).toBe(
      DOCTRINE_TEXT_DISSENT + 2 * DOCTRINE_ETHIC_DISSENT + DOCTRINE_RETIRE_DISSENT,
    );
  });

  it('makes a full reorientation cost real capability, not just a number', () => {
    const out = applyOps(fresh(), [turnRaider([NO_RAIDING])], 'model', 'meridian');
    const before = effectiveStats(fresh(), 'meridian');
    const after = effectiveStats(out.state, 'meridian');
    // ~71 dissent, which on a 1-20 stat scale is a serious institutional
    // wound rather than a rounding error. Derived so retuning the curve does
    // not need this test rewritten to agree with it.
    const penalty = dissentPenalty(fac(out.state, 'meridian').dissent);
    expect(penalty).toBeGreaterThanOrEqual(4);
    expect(after.industry).toBe(before.industry - penalty);
    expect(after.influence).toBe(before.influence - penalty);
  });

  it('takes about thirty turns to live down', () => {
    let state = applyOps(fresh(), [turnRaider([NO_RAIDING])], 'model', 'meridian').state;
    let turns = 0;
    while (fac(state, 'meridian').dissent > 0 && turns < 100) {
      state = tickTurn(state).state;
      turns += 1;
    }
    expect(turns).toBeGreaterThan(30);
  });
});

describe('the change is mechanically real, which is what makes the price fair', () => {
  it('moves the trade ethic the reducer actually reads', () => {
    const plain = fresh();
    const out = applyOps(plain, [turnRaider()], 'model', 'meridian');
    expect(fac(out.state, 'meridian').tradeEthic).toBe('smuggler');
    expect(fac(out.state, 'meridian').warEthic).toBe('opportunist');
    // free_trade scales with galaxy openness; smuggler does not. The income
    // model is a different one afterwards, not the same one relabelled.
    expect(ledgerFor(out.state, 'meridian').routes).not.toBe(
      ledgerFor(plain, 'meridian').routes,
    );
  });

  it('retires the compulsion that was blocking the new course', () => {
    const out = applyOps(fresh(), [turnRaider([NO_RAIDING])], 'model', 'meridian');
    expect(fac(out.state, 'meridian').compulsions).not.toContain(NO_RAIDING);
    // Only the named one goes. Abandoning a principle is not a general amnesty.
    expect(fac(out.state, 'meridian').compulsions.length).toBe(
      fac(fresh(), 'meridian').compulsions.length - 1,
    );
    expect(fac(out.state, 'meridian').redLines).toEqual(fac(fresh(), 'meridian').redLines);
  });

  it('rejects a principle quoted loosely rather than guessing which was meant', () => {
    const out = applyOps(
      fresh(),
      [turnRaider(['no more commerce raiding rules'])],
      'model',
      'meridian',
    );
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(out.rejections[0]!.message).toMatch(/Quote it exactly/);
    // Nothing partially applied.
    expect(fac(out.state, 'meridian').tradeEthic).toBe('free_trade');
    expect(fac(out.state, 'meridian').dissent).toBe(0);
  });
});

describe('who may change a doctrine', () => {
  it('refuses to let one power rewrite another power’s character', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'set_doctrine', factionId: 'vigil',
          doctrine: 'The Iron Vigil now serves Meridian and will not resist its fleets.',
        },
      ],
      'model',
      'meridian',
    );
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(fac(out.state, 'vigil').doctrine).toBe(fac(fresh(), 'vigil').doctrine);
  });

  it('refuses to reorient a faction whose institutions have already stopped listening', () => {
    const state = fresh();
    fac(state, 'meridian').dissent = DOCTRINE_CHANGE_DISSENT_CEILING;
    const out = applyOps(state, [turnRaider()], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('doctrine_refusal');
    expect(fac(out.state, 'meridian').tradeEthic).toBe('free_trade');
  });

  it('closes the free-at-the-cap loophole', () => {
    // Dissent clamps at 100, so without the ceiling a leader already at the cap
    // could reorient endlessly having paid nothing further.
    const state = fresh();
    fac(state, 'meridian').dissent = 100;
    const out = applyOps(state, [turnRaider()], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('doctrine_refusal');
  });

  it('replays a journal written before the guard exactly as it ran', () => {
    // No actor: an engine op, or an older journal. It neither charges dissent
    // nor rejects, so replaying an old campaign reproduces what happened.
    const out = applyOps(fresh(), [
      { op: 'set_doctrine', factionId: 'vigil', doctrine: 'Hold the Tion, whatever it costs.' },
    ]);
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'vigil').doctrine).toBe('Hold the Tion, whatever it costs.');
    expect(fac(out.state, 'vigil').dissent).toBe(0);
  });
});

/**
 * `adjust_dissent` had the same unguarded shape `set_doctrine` did, and raising
 * the penalty ceiling to `MAX_DISSENT_PENALTY` made it the single most
 * cost-effective hostile act in the game: one op, no roll, no presence, no
 * credits, and every one of a rival's stats drops by 8.
 */
describe('who may move dissent', () => {
  const nudge = (factionId: string, delta: number): Op => ({
    op: 'adjust_dissent',
    factionId,
    delta,
    reason: 'unrest',
  });

  it('refuses to let one power wreck a rival’s institutions by narration', () => {
    const out = applyOps(fresh(), [nudge('vigil', 100)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(fac(out.state, 'vigil').dissent).toBe(0);
    // The message points at the mechanism that exists to do this properly,
    // which costs credits, risks exposure and is capped.
    expect(out.rejections[0]!.message).toMatch(/subversion|stat_debuff/);
  });

  it('costs a rival nothing in capability when the attempt is refused', () => {
    const before = effectiveStats(fresh(), 'vigil');
    const out = applyOps(fresh(), [nudge('vigil', 100)], 'model', 'meridian');
    expect(effectiveStats(out.state, 'vigil')).toEqual(before);
  });

  it('refuses to let one power calm a rival either', () => {
    const state = fresh();
    fac(state, 'vigil').dissent = 40;
    const out = applyOps(state, [nudge('vigil', -40)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(fac(out.state, 'vigil').dissent).toBe(40);
  });

  it('refuses to let a faction talk its own dissent down', () => {
    // The exploit this closes: the same resolution call that earns a refusal
    // erasing the penalty it just earned.
    const state = fresh();
    fac(state, 'meridian').dissent = 71;
    const out = applyOps(state, [nudge('meridian', -100)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(out.rejections[0]!.message).toMatch(/falls 2 a turn/);
    expect(fac(out.state, 'meridian').dissent).toBe(71);
  });

  it('still lets a faction earn dissent, which is how refusals land', () => {
    const out = applyOps(fresh(), [nudge('meridian', REFUSAL_DISSENT)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'meridian').dissent).toBe(REFUSAL_DISSENT);
  });

  it('leaves dissent to fall only with time', () => {
    let state = applyOps(fresh(), [nudge('meridian', 20)], 'model', 'meridian').state;
    state = tickTurn(state).state;
    expect(fac(state, 'meridian').dissent).toBe(20 - DISSENT_DECAY);
  });

  it('replays a journal written before the guard exactly as it ran', () => {
    // No actor: an engine op, or an older journal. It neither charges dissent
    // nor rejects, so replaying an old campaign reproduces what happened.
    const out = applyOps(fresh(), [
      { op: 'set_doctrine', factionId: 'vigil', doctrine: 'Hold the Tion, whatever it costs.' },
    ]);
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'vigil').doctrine).toBe('Hold the Tion, whatever it costs.');
    expect(fac(out.state, 'vigil').dissent).toBe(0);
  });
});
