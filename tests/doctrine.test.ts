import { describe, expect, it } from 'vitest';
import { applyOps, DISSENT_DECAY, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  DOCTRINE_CHANGE_DISSENT_CEILING,
  DOCTRINE_ETHIC_DISSENT,
  DOCTRINE_TEXT_DISSENT,
  dissentPenalty,
  effectiveStats,
  COMPULSION_BREACH_DISSENT,
  ledgerFor,
  MAX_NARRATIVE_CREDITS,
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

const turnRaider = (): Op => ({
  op: 'set_doctrine',
  factionId: 'meridian',
  doctrine: 'Commerce was a mistake. We take the lanes by force and let the ledgers follow.',
  warEthic: 'opportunist',
  tradeEthic: 'smuggler',
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
    const out = applyOps(fresh(), [turnRaider()], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'meridian').dissent).toBe(
      DOCTRINE_TEXT_DISSENT + 2 * DOCTRINE_ETHIC_DISSENT,
    );
  });

  it('cannot touch a red line or a compulsion, by this op or any other', () => {
    // There is no `retire` any more. A `retire` field existed briefly and was
    // the wrong shape: the model narrated a retirement while emitting an empty
    // array, so the sheet and the story disagreed. Principles are permanent now,
    // and acting against one is priced instead — see the defiance tests below.
    const out = applyOps(fresh(), [turnRaider()], 'model', 'meridian');
    expect(fac(out.state, 'meridian').redLines).toEqual(fac(fresh(), 'meridian').redLines);
    expect(fac(out.state, 'meridian').compulsions).toEqual(
      fac(fresh(), 'meridian').compulsions,
    );
    // And the op schema has no way to ask.
    expect(Object.keys(turnRaider())).not.toContain('retire');
  });

  it('makes a full reorientation cost real capability, not just a number', () => {
    const out = applyOps(fresh(), [turnRaider()], 'model', 'meridian');
    const before = effectiveStats(fresh(), 'meridian');
    const after = effectiveStats(out.state, 'meridian');
    // ~71 dissent, which on a 1-20 stat scale is a serious institutional
    // wound rather than a rounding error. Derived so retuning the curve does
    // not need this test rewritten to agree with it.
    const penalty = dissentPenalty(fac(out.state, 'meridian').dissent);
    expect(penalty).toBeGreaterThanOrEqual(2);
    expect(after.industry).toBe(before.industry - penalty);
    expect(after.influence).toBe(before.influence - penalty);
  });

  it('takes twenty-odd turns to live down', () => {
    let state = applyOps(fresh(), [turnRaider()], 'model', 'meridian').state;
    let turns = 0;
    while (fac(state, 'meridian').dissent > 0 && turns < 100) {
      state = tickTurn(state).state;
      turns += 1;
    }
    expect(turns).toBeGreaterThan(20);
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

  it('leaves the compulsion standing, so the raid still costs every time', () => {
    // The compulsion that refuses commerce raiding survives the doctrine
    // change. Under the old design it could be retired for 25 once; now the
    // raid itself is what costs, and it costs again on the next raid.
    const out = applyOps(fresh(), [turnRaider()], 'model', 'meridian');
    expect(fac(out.state, 'meridian').compulsions.map((c) => c.text)).toContain(NO_RAIDING);
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

/**
 * Narrative money. Every large credit movement in this game has a mechanism
 * that owns its price and debits the treasury directly — `SHIP_COST` through
 * `billConstruction`, `AGENT_COST`, `developmentCost`, treaty and commitment
 * flows, tolls, raiding. None of them route through `adjust_credits`, so what is
 * left for that op is a bribe, a fine or a windfall.
 *
 * The live playtest found it unbounded: a failed construction attempt charged
 * 380 with no order created, and a correctly priced 156-credit programme arrived
 * with a freeform 180 riding alongside it.
 */
describe('adjust_credits is bounded narrative money', () => {
  const move = (factionId: string, delta: number): Op => ({
    op: 'adjust_credits',
    factionId,
    delta,
    reason: 'a matter of contractors',
  });

  it('trims a charge past the cap rather than refusing it', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(state, [move('meridian', -380)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'meridian').credits).toBe(before - MAX_NARRATIVE_CREDITS);
    expect(out.notes.join(' ')).toMatch(/Trimmed a charge of 380/);
    expect(out.state.eventLog.some((e) => e.kind === 'clamp')).toBe(true);
  });

  it('trims an invented windfall the same way, which is the worse direction', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(state, [move('meridian', 9000)], 'model', 'meridian');
    expect(fac(out.state, 'meridian').credits).toBe(before + MAX_NARRATIVE_CREDITS);
  });

  it('leaves an ordinary sum alone', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(state, [move('meridian', -75)], 'model', 'meridian');
    expect(fac(out.state, 'meridian').credits).toBe(before - 75);
    expect(out.notes).toEqual([]);
  });

  it('refuses to take credits out of a rival treasury', () => {
    const state = fresh();
    const before = fac(state, 'vigil').credits;
    const out = applyOps(state, [move('vigil', -500)], 'model', 'meridian');
    expect(out.rejections[0]!.code).toBe('illegal_value');
    expect(out.rejections[0]!.message).toMatch(/income_penalty|toll|raid/);
    expect(fac(out.state, 'vigil').credits).toBe(before);
  });

  it('still lets one power pay another', () => {
    const state = fresh();
    const before = fac(state, 'vigil').credits;
    const out = applyOps(state, [move('vigil', 100)], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(fac(out.state, 'vigil').credits).toBe(before + 100);
  });

  it('leaves engine ops and older journals unbounded, so replay is exact', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(state, [move('meridian', -380)]);
    expect(fac(out.state, 'meridian').credits).toBe(before - 380);
  });
});

/**
 * Defiance: the third outcome, between "done" and "refused".
 *
 * A red line is absolute and produces a refusal, so nothing happens. A
 * compulsion is a demand a leader may overrule, so the order stands and the
 * institutions charge for having been overruled. This replaced retiring
 * principles, which desynced the sheet from the story the one time a live model
 * touched it.
 */
describe('a compulsion is a price, not a wall', () => {
  it('costs more than being refused, because it actually happened', () => {
    expect(COMPULSION_BREACH_DISSENT).toBeGreaterThan(REFUSAL_DISSENT);
  });

  it('reaches the cap in four, and stops there', () => {
    const state = fresh();
    for (let i = 0; i < 6; i++) {
      const out = applyOps(
        state,
        [
          {
            op: 'adjust_dissent', factionId: 'meridian',
            delta: COMPULSION_BREACH_DISSENT, reason: 'the Council was overruled',
          },
        ],
        'model',
        'meridian',
      );
      Object.assign(state, out.state);
    }
    expect(4 * COMPULSION_BREACH_DISSENT).toBeGreaterThanOrEqual(100);
    expect(fac(state, 'meridian').dissent).toBe(100);
    expect(dissentPenalty(100)).toBe(8);
  });

  it('leaves the compulsion in place, so the next breach costs the same again', () => {
    const state = fresh();
    const before = fac(state, 'meridian').compulsions.length;
    const out = applyOps(
      state,
      [
        {
          op: 'adjust_dissent', factionId: 'meridian',
          delta: COMPULSION_BREACH_DISSENT, reason: 'overruled again',
        },
      ],
      'model',
      'meridian',
    );
    expect(fac(out.state, 'meridian').compulsions).toHaveLength(before);
  });
});
