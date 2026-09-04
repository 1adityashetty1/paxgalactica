import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, DISSENT_DECAY } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  breachContradictsState, driftingCompulsions } from '../src/domain/compulsions.js';
import { serializeCharacter } from '../src/model/serialize.js';
import {
  COMPULSION_DRIFT_DISSENT,
  FactionSchema,
  warsFor,
  type WorldState,
} from '../src/domain/state.js';
import type { OpInput as Op } from '../src/domain/ops.js';

/**
 * Compulsions had one enforcement path — the resolution call refusing a
 * declared action — and it could only ever catch a leader *doing* something.
 * Four lines in the seed promised consequences for the passage of time and had
 * none: the Drajk captains taking their ships elsewhere after a stretch of
 * quiet, the Iron Vigil's officer corps answering an insult "without you",
 * Meridian's Trade Council calling a vote of no confidence over an unprofitable
 * quarter. Nothing measured time, income or idleness.
 *
 * These are the triggers that replaced them: pure predicates on world state,
 * checked once per faction per turn.
 */

const fresh = (player = 'meridian'): WorldState => createSeedState(player);
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const triggers = (s: WorldState, id: string) => driftingCompulsions(s, id).map((d) => d.trigger);

/** A pending order, injected directly so the predicate is tested in isolation. */
const order = (factionId: string, type: string, targetId: string) => ({
  id: `ord-test-${type}`,
  factionId,
  type,
  originId: targetId,
  targetId,
  durationTurns: 3,
  progress: 0,
  interruptible: true,
  onInterrupt: 'cancel' as const,
  visibility: [],
  label: type,
  durationRationale: '',
  path: [],
  force: type === 'fleet_movement' ? 5 : 0,
  investedCredits: 0,
});

describe('each trigger watches something real', () => {
  it('fires on an unprofitable quarter, and only then', () => {
    const state = fresh();
    // Meridian opens comfortably in the black.
    expect(triggers(state, 'meridian')).not.toContain('unprofitable');

    const broke = fresh();
    for (const s of broke.systems) if (s.controllerFactionId === 'meridian') s.strategicValue = 0;
    expect(triggers(broke, 'meridian')).toContain('unprofitable');
    expect(driftingCompulsions(broke, 'meridian')[0]!.why).toMatch(/net income is -\d+/);
  });

  it('fires on a war nobody is prosecuting', () => {
    const state = fresh();
    // The Iron Vigil opens at war and with nothing under way.
    expect(warsFor(state, 'vigil').length).toBeGreaterThan(0);
    expect(triggers(state, 'vigil')).toContain('idle_at_war');

    // A fleet under way is prosecuting it.
    const moving = fresh();
    moving.pendingOrders.push(order('vigil', 'fleet_movement', 'tio-2') as never);
    expect(triggers(moving, 'vigil')).not.toContain('idle_at_war');
  });

  it('does not call peace a war', () => {
    const state = fresh();
    for (const f of state.factions) {
      if (f.id !== 'vigil') f.disposition['vigil'] = 0;
      fac(state, 'vigil').disposition[f.id] = 0;
    }
    expect(warsFor(state, 'vigil')).toEqual([]);
    expect(triggers(state, 'vigil')).not.toContain('idle_at_war');
  });

  it('fires when a rival sits on your world and nothing is sent', () => {
    const state = fresh();
    sys(state, 'tio-2').ships['hutt'] = 4;
    expect(triggers(state, 'vigil')).toContain('unanswered_incursion');
    expect(driftingCompulsions(state, 'vigil').find((d) => d.trigger === 'unanswered_incursion')!.why)
      .toMatch(/Kalzir/);
  });

  it('does not count an invited fleet as an incursion', () => {
    const state = fresh();
    sys(state, 'tio-2').ships['hutt'] = 4;
    const guested = applyOps(
      state,
      [
        {
          op: 'form_treaty', treatyType: 'basing_rights', parties: ['vigil', 'hutt'],
          terms: {}, summary: 'The Combine may berth in the Tion.',
        },
      ],
      'extraction',
    ).state;
    // A guest is not an insult, which is the same line `systemIncome` draws.
    expect(triggers(guested, 'vigil')).not.toContain('unanswered_incursion');
  });

  it('fires when the captains have no plunder, and stops when they do', () => {
    const state = fresh();
    expect(triggers(state, 'krayt')).toContain('no_plunder');

    const raiding = fresh();
    raiding.pendingOrders.push(order('krayt', 'commerce_raiding', 'kes-2') as never);
    expect(triggers(raiding, 'krayt')).not.toContain('no_plunder');
  });

  it('leaves a faction whose compulsions are all prohibitions entirely alone', () => {
    // Meridian and the Free Worlds are defined by what they refuse, which
    // refusal already handles. Drift is only for demands.
    //
    // The Combine used to be in this list and no longer is: *"an unpaid debt
    // must be pursued"* is a demand, and now that debts are real it has a
    // trigger. See the debt suite.
    const state = fresh();
    for (const id of ['meridian', 'freeworlds']) {
      expect(driftingCompulsions(state, id), id).toEqual([]);
    }
  });

  it('fires when a debtor has defaulted and nothing has been sent', () => {
    // The seed puts Drajk in default to the Combine on turn 0, so the line the
    // faction is built on is a live question from the first turn rather than a
    // rule waiting for something to happen.
    const state = fresh();
    expect(triggers(state, 'hutt')).toContain('debt_unpursued');
  });

  it('stops the moment the creditor actually applies pressure', () => {
    const sent = fresh();
    // Drajk holds tul-1; a fleet under way at it is pursuit.
    const target = sent.systems.find((s) => s.controllerFactionId === 'krayt')!;
    sent.pendingOrders.push(order('hutt', 'fleet_movement', target.id) as never);
    expect(triggers(sent, 'hutt')).not.toContain('debt_unpursued');
  });

  it('counts an operative in their space as pursuit too', () => {
    const spied = fresh();
    const target = spied.systems.find((s) => s.controllerFactionId === 'krayt')!;
    spied.agents.push({
      id: 'agt-x',
      ownerFactionId: 'hutt',
      systemId: target.id,
      mission: 'surveillance',
      effect: { kind: 'intel', perTurn: 1 },
      successChance: 50,
      exposed: false,
      cover: '',
      placedTurn: 0,
    } as never);
    expect(triggers(spied, 'hutt')).not.toContain('debt_unpursued');
  });

  it('does not fire for a debt that is being paid', () => {
    // Meridian is current on its Combine paper, so it is not a grievance.
    const state = fresh();
    state.debts = state.debts.filter((d) => d.debtorFactionId === 'meridian');
    expect(triggers(state, 'hutt')).not.toContain('debt_unpursued');
  });
});

describe('drift is charged every turn it continues', () => {
  it('adds per drifting compulsion, and nets against the decay', () => {
    const state = fresh();
    const before = fac(state, 'krayt').dissent;
    const after = tickTurn(state).state;
    // One drifting compulsion, minus the turn's decay (which floors at 0 here).
    expect(fac(after, 'krayt').dissent).toBe(before + COMPULSION_DRIFT_DISSENT);
    expect(COMPULSION_DRIFT_DISSENT).toBeGreaterThan(DISSENT_DECAY);
  });

  it('charges two ignored compulsions twice over', () => {
    const state = fresh();
    sys(state, 'tio-2').ships['hutt'] = 4;
    expect(driftingCompulsions(state, 'vigil')).toHaveLength(2);
    const after = tickTurn(state).state;
    expect(fac(after, 'vigil').dissent).toBe(2 * COMPULSION_DRIFT_DISSENT);
  });

  it('stops the moment the faction complies, and then the decay wins', () => {
    let state = fresh();
    state = tickTurn(state).state;
    state = tickTurn(state).state;
    const drifted = fac(state, 'krayt').dissent;
    expect(drifted).toBeGreaterThan(0);

    // Put a raid under way: the compulsion is satisfied and dissent recedes.
    state.pendingOrders.push(order('krayt', 'commerce_raiding', 'kes-2') as never);
    const complied = tickTurn(state).state;
    expect(fac(complied, 'krayt').dissent).toBe(drifted - DISSENT_DECAY);
  });

  it('holds NPCs to their character, which nothing did before', () => {
    // The player is Meridian. The Vigil and Drajk are NPCs, and reactions have
    // no refusal channel — so until this, four of five powers could act wholly
    // against type at no cost whatsoever.
    const state = fresh('meridian');
    const after = tickTurn(state).state;
    expect(fac(after, 'vigil').dissent).toBeGreaterThan(0);
    expect(fac(after, 'krayt').dissent).toBeGreaterThan(0);
    expect(fac(after, 'meridian').dissent).toBe(0);
  });

  it('explains itself in the log rather than moving a number silently', () => {
    const ticked = tickTurn(fresh());
    const said = ticked.state.eventLog.map((e) => e.text).join(' ');
    expect(said).toMatch(/no raid under way and nothing taken/);
    expect(said).toMatch(/dissent \+\d+/);
  });

  it('never pushes past the ceiling', () => {
    const state = fresh();
    fac(state, 'krayt').dissent = 100;
    expect(fac(tickTurn(state).state, 'krayt').dissent).toBeLessThanOrEqual(100);
  });

  it('is a pure function of state, so it replays exactly', () => {
    const state = fresh();
    const a = tickTurn(state).state;
    const b = tickTurn(state).state;
    expect(JSON.stringify(a.factions)).toBe(JSON.stringify(b.factions));
  });
});

describe('the compulsion shape', () => {
  it('accepts a bare string, so saves written before triggers still load', () => {
    const parsed = FactionSchema.parse({
      id: 'x', name: 'X', displayColor: 1, disposition: {}, credits: 0,
      doctrine: 'd', stats: { might: 10, guile: 10, industry: 10, influence: 10, resolve: 10 },
      voice: 'v', warEthic: 'defensive', tradeEthic: 'free_trade',
      compulsions: ['an old compulsion, stored as a plain string'],
    });
    expect(parsed.compulsions[0]!.text).toBe('an old compulsion, stored as a plain string');
    expect(parsed.compulsions[0]!.trigger).toBeUndefined();
  });

  it('never drifts on an untriggered compulsion, only refuses', () => {
    const state = fresh();
    fac(state, 'meridian').compulsions = [{ text: 'something with no trigger at all' }];
    expect(driftingCompulsions(state, 'meridian')).toEqual([]);
  });

  it('shows the model the text, not the object wrapping it', () => {
    // TypeScript happily interpolates an object into a template literal, so
    // this is the only thing standing between the model and a character sheet
    // reading "[object Object]" for every compulsion it has.
    const sheet = serializeCharacter(fac(fresh(), 'krayt'));
    expect(sheet).not.toMatch(/\[object Object\]/);
    expect(sheet).toMatch(/the captains require plunder/);
  });
});

describe('a faction states each of its principles once', () => {
  /**
   * Five lines used to be written twice — once correctly as a red line, once
   * again as a compulsion saying the same thing. That is not free: `retire`
   * matches exact strings, so changing course meant retiring both copies, and
   * Drajk going legitimate cost 50 dissent instead of 25 purely because the
   * same rule appeared in two places.
   *
   * The categories are not interchangeable. A red line is a prohibition
   * ("will not"); a compulsion is a demand ("your institutions require"). Every
   * one of the five duplicates was a prohibition miscategorised as a demand.
   */
  it('never states the same line as both a prohibition and a demand', () => {
    for (const f of fresh().factions) {
      const lines = [...f.redLines, ...f.compulsions.map((c) => c.text)];
      expect(new Set(lines).size, `${f.id} repeats a line verbatim`).toBe(lines.length);
    }
  });

  it('keeps every power recognisable on both axes', () => {
    for (const f of fresh().factions) {
      expect(f.redLines.length, `${f.id} red lines`).toBeGreaterThan(0);
      expect(f.compulsions.length, `${f.id} compulsions`).toBeGreaterThan(0);
    }
  });

  it('leaves the surviving line carrying what the duplicate added', () => {
    const state = fresh();
    const red = (id: string) => state.factions.find((f) => f.id === id)!.redLines.join(' ');
    // Drajk's compulsion contributed being besieged. Matched on the idea rather
    // than the sentence: the line was later reworded to stop forbidding a
    // garrison, which the engine grows passively on every world Drajk holds, and
    // this assertion is about the merge surviving, not about the phrasing.
    expect(red('krayt')).toMatch(/besieged/);
    // ...Meridian's contributed embargoes and closed borders...
    expect(red('meridian')).toMatch(/embargo/);
    // ...and the Free Worlds' contributed abandonment to occupation.
    expect(red('freeworlds')).toMatch(/abandon one to occupation/);
  });
});

describe('a compulsion cannot be retired, so drift never stops on its own', () => {
  it('keeps charging every turn the condition holds, with no way to switch it off', () => {
    // `retire` is gone. Under the old design Drajk could pay 25 once and its
    // no_plunder compulsion stopped drifting forever; the model narrated exactly
    // that retirement while emitting an empty array, so the sheet and the story
    // disagreed. A principle is permanent now — the only way to stop the drift
    // is to satisfy the compulsion.
    const state = fresh('krayt');
    expect(triggers(state, 'krayt')).toContain('no_plunder');

    // A doctrine change does not touch it, however sweeping the words.
    const out = applyOps(
      state,
      [
        {
          op: 'set_doctrine', factionId: 'krayt',
          doctrine: 'We hold ground now, and we sign our name to things.',
          warEthic: 'defensive',
        } as Op,
      ],
      'model',
      'krayt',
    );
    expect(out.rejections).toHaveLength(0);
    expect(triggers(out.state, 'krayt')).toContain('no_plunder');

    // And it is still charging on the next tick.
    const before = fac(out.state, 'krayt').dissent;
    const after = tickTurn(out.state).state;
    expect(fac(after, 'krayt').dissent).toBeGreaterThan(before - COMPULSION_DRIFT_DISSENT);
  });

  it('stops the moment the compulsion is satisfied instead', () => {
    const state = fresh('krayt');
    state.pendingOrders.push(order('krayt', 'commerce_raiding', 'kes-2') as never);
    expect(triggers(state, 'krayt')).not.toContain('no_plunder');
  });
});

describe('a faction states each principle at ONE severity', () => {
  /**
   * The verbatim check above is not enough. The Combine's red line *"will not
   * forgive an unpaid debt"* and its compulsion *"an unpaid debt must be
   * pursued — forgiving one invites every client to test the next"* were not
   * identical strings, but both covered **forgiving a debt** — so the same act
   * was stated twice, once as absolute and once as a price.
   *
   * That is not cosmetic now that the arbiter quotes lines and code classifies
   * them: whichever copy it happened to reach for decided whether forgiving a
   * debt was blocked outright or cost 15 dissent and landed. Measured across
   * three live appraisals of one action, it quoted the red line once and the
   * compulsion twice.
   */
  it('leaves forgiving a debt to the red line alone', () => {
    const combine = fresh().factions.find((f) => f.id === 'hutt')!;
    expect(combine.redLines.join(' ')).toMatch(/forgive an unpaid debt/);
    for (const c of combine.compulsions) {
      expect(c.text, 'a compulsion restates the forgiveness red line').not.toMatch(/forgiv/i);
    }
  });

  it('keeps what the compulsion is actually for: pursuit', () => {
    const combine = fresh().factions.find((f) => f.id === 'hutt')!;
    expect(combine.compulsions.map((c) => c.text).join(' ')).toMatch(/must be pursued/);
  });
});

/**
 * A compulsion with a trigger has two enforcement paths — a model judging a
 * breach from prose, and code evaluating a predicate — and they can disagree.
 * Measured live: 15 dissent charged for "no raid under way and nothing taken
 * from anyone" while a `commerce_raiding` order was staged and a fleet was in
 * transit to storm a world.
 */
describe('a breach ruling is checked against the board where the board can answer', () => {
  const drajkPlunder = () =>
    createSeedState('krayt').factions.find((f) => f.id === 'krayt')!
      .compulsions.find((c) => c.trigger === 'no_plunder')!.text;

  it('drops a breach the faction is demonstrably not committing', () => {
    let s = createSeedState('krayt');
    const base = s.systems.find((x) => (x.ships.krayt ?? 0) > 0)!;
    s = applyOps(s, [{
      op: 'issue_order', factionId: 'krayt', type: 'commerce_raiding',
      originId: base.id, targetId: base.id, durationTurns: 3, label: 'raid', visibility: [],
    }], 'model', 'krayt', true).state;

    // The predicate says it is complying, so the ruling is not charged.
    expect(driftingCompulsions(s, 'krayt').map((d) => d.trigger)).not.toContain('no_plunder');
    expect(breachContradictsState(s, 'krayt', drajkPlunder())).toBe(true);
  });

  it('keeps a breach the board agrees with', () => {
    const s = createSeedState('krayt');
    expect(driftingCompulsions(s, 'krayt').map((d) => d.trigger)).toContain('no_plunder');
    expect(breachContradictsState(s, 'krayt', drajkPlunder())).toBe(false);
  });

  /**
   * A compulsion with no trigger is not a state question. Refusal was built for
   * exactly that case, and the ruling stands on its own.
   */
  it('never contradicts a compulsion that has no trigger', () => {
    const s = createSeedState('meridian');
    const untriggered = s.factions
      .find((f) => f.id === 'meridian')!
      .compulsions.find((c) => !c.trigger);
    if (untriggered) expect(breachContradictsState(s, 'meridian', untriggered.text)).toBe(false);
  });

  it('says nothing about a line that is not on the sheet', () => {
    const s = createSeedState('krayt');
    expect(breachContradictsState(s, 'krayt', 'a principle nobody holds')).toBe(false);
  });
});
