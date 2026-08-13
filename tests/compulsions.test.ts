import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, DISSENT_DECAY } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { driftingCompulsions } from '../src/domain/compulsions.js';
import { serializeCharacter } from '../src/model/serialize.js';
import {
  COMPULSION_DRIFT_DISSENT,
  FactionSchema,
  warsFor,
  type Op,
  type WorldState,
} from '../src/domain/state.js';

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
      'model',
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
    // Meridian, the Nars and the Free Worlds are defined by what they refuse,
    // which refusal already handles. Drift is only for demands.
    const state = fresh();
    for (const id of ['meridian', 'hutt', 'freeworlds']) {
      expect(driftingCompulsions(state, id), id).toEqual([]);
    }
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

describe('retiring a compulsion stops it drifting', () => {
  it('ends the charge for good, which is what the dissent price buys', () => {
    const state = fresh('krayt');
    const line = fac(state, 'krayt').compulsions.find((c) => c.trigger === 'no_plunder')!.text;
    const out = applyOps(
      state,
      [
        {
          op: 'set_doctrine', factionId: 'krayt',
          doctrine: 'We hold ground now, and we sign our name to things.',
          retire: [line],
        } as Op,
      ],
      'model',
      'krayt',
    );
    expect(out.rejections).toHaveLength(0);
    expect(driftingCompulsions(out.state, 'krayt')).toEqual([]);
    const after = tickTurn(out.state).state;
    // Dissent was paid once for the change, and no longer accrues every turn.
    expect(fac(after, 'krayt').dissent).toBeLessThan(fac(out.state, 'krayt').dissent);
  });
});
