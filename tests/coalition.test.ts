import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import {
  BOT_COALITION_PLEDGE,
  COALITION_GRIEVANCE,
  COALITION_STANDING,
  brokeredAccords,
} from '../src/domain/initiative.js';
import {
  COALITION_RESENTMENT,
  TreatySchema,
  pactAnswers,
  type Treaty,
  type TreatyType,
} from '../src/domain/diplomacy.js';
import {
  EXHAUSTION_INDEMNITY_SHARE,
  EXHAUSTION_RATIO,
  concessionBudget,
  exhaustion,
  sideStrength,
} from '../src/domain/leverage.js';
import { ENVOYS_QUIET_TURNS } from '../src/domain/events.js';
import { clashKey } from '../src/domain/pulse.js';
import {
  WAR_DISPOSITION_THRESHOLD,
  hullsAt,
  setShipsAt,
  setStackAt,
  stackAt,
  warsFor,
  type WorldState,
} from '../src/domain/state.js';

/**
 * A mutual defence pact and a coalition are two treaty types, distinct in the
 * schema: one answers an attack by anyone, the other only by the powers it
 * names. Either calls its ally to war with the attacker and sends warships from
 * within reach, once a turn. And a bot weighs its whole position — its line and
 * its money against every enemy together — when it decides to sue for peace.
 */

const calm: LegacyRules = { randomEvents: false };
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const fac = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!;
const setRegard = (s: WorldState, from: string, toward: string, v: number) => {
  fac(s, from).disposition[toward] = v;
};

function pact(
  type: TreatyType,
  parties: [string, string],
  pledged: Record<string, number> = {},
  against?: string[],
): Treaty {
  return TreatySchema.parse({
    id: `t-${type}-${parties.join('-')}`,
    type,
    parties,
    terms: { shipsPledged: pledged, ...(against ? { against } : {}) },
    signedTurn: 0,
    status: 'active',
    summary: type,
  });
}

/** Run until no fleet is under way, ticking calm. */
function untilArrived(state: WorldState, legacy: LegacyRules = calm) {
  let r = tickTurn(state, legacy);
  let guard = 0;
  while (r.state.pendingOrders.some((o) => o.type === 'fleet_movement') && guard++ < 12) {
    r = tickTurn(r.state, legacy);
  }
  return r;
}

const attack = (state: WorldState, from: string, to: string, force = 25): WorldState =>
  applyOps(state, [
    {
      op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
      originId: from, targetId: to, force, label: `strike ${to}`,
    },
  ]).state;

const answered = (s: WorldState) => s.eventLog.filter((e) => / answers its /.test(e.text));
const honoured = (s: WorldState) => s.eventLog.filter((e) => / honours its /.test(e.text));

/** The Vigil, ready to strike Meridian's Torrek Anchorage (tor-1) from tor-3. */
const board = (): WorldState => {
  const s = createSeedState('vigil');
  setShipsAt(sys(s, 'tor-3'), 'vigil', 30);
  return s;
};

describe('a coalition is its own treaty type', () => {
  const sign = (s: WorldState, treatyType: TreatyType, terms: Record<string, unknown>) =>
    applyOps(
      s,
      [{ op: 'form_treaty', treatyType, parties: ['meridian', 'freeworlds'], terms, summary: 'pact' }],
      'extraction',
      'meridian',
    );

  it('names whom it is against, and must', () => {
    const none = sign(createSeedState('meridian'), 'coalition', {});
    expect(none.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(none.rejections[0]!.message).toMatch(/mutual_defense/);
  });

  it('cannot be against one of its own members, or a power that does not exist', () => {
    expect(sign(createSeedState('meridian'), 'coalition', { against: ['meridian'] }).rejections).toHaveLength(1);
    expect(sign(createSeedState('meridian'), 'coalition', { against: ['nobody'] }).rejections).toHaveLength(1);
  });

  it('is the only treaty that may name an enemy: a mutual defence pact is against anyone', () => {
    const named = sign(createSeedState('meridian'), 'mutual_defense', { against: ['vigil'] });
    expect(named.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(named.rejections[0]!.message).toMatch(/coalition/);
  });

  it('answers only the powers it names, where a mutual defence pact answers anyone', () => {
    const coalition = pact('coalition', ['meridian', 'ojjul'], {}, ['vigil']);
    const defence = pact('mutual_defense', ['meridian', 'ojjul']);
    expect(pactAnswers(coalition, 'vigil')).toBe(true);
    expect(pactAnswers(coalition, 'drajk')).toBe(false);
    expect(pactAnswers(defence, 'vigil')).toBe(true);
    expect(pactAnswers(defence, 'drajk')).toBe(true);
    expect(pactAnswers(pact('non_aggression', ['meridian', 'ojjul']), 'vigil')).toBe(false);
  });

  it('is resented by the power it is against, once', () => {
    const s = createSeedState('meridian');
    const before = { ...fac(s, 'vigil').disposition };
    const first = sign(s, 'coalition', { against: ['vigil'] });
    expect(first.rejections).toHaveLength(0);
    const vigil = fac(first.state, 'vigil').disposition;
    expect(vigil['meridian']).toBe(Math.max(-100, (before['meridian'] ?? 0) - COALITION_RESENTMENT));
    expect(vigil['freeworlds']).toBe(Math.max(-100, (before['freeworlds'] ?? 0) - COALITION_RESENTMENT));
    // The target hears of it, though the treaty is not its own.
    expect(first.state.eventLog.some((e) => /bind themselves against/.test(e.text) && e.visibleTo?.includes('vigil'))).toBe(true);

    // A renewal binds nobody afresh.
    const again = sign(first.state, 'coalition', { against: ['vigil'] });
    expect(fac(again.state, 'vigil').disposition['meridian']).toBe(vigil['meridian']);
  });

  it('keeps its members at peace with each other, and their fleets guests', () => {
    const s = createSeedState('meridian');
    setRegard(s, 'meridian', 'freeworlds', -90);
    const signed = sign(s, 'coalition', { against: ['vigil'] }).state;
    expect(warsFor(signed, 'meridian')).not.toContain('freeworlds');
  });
});

describe('a defence pact calls its ally to war', () => {
  it('puts the ally at war with the attacker, which the pact alone never did', () => {
    const s = board();
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    expect(warsFor(s, 'ojjul')).not.toContain('vigil');
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(fac(after, 'ojjul').disposition['vigil']).toBeLessThanOrEqual(WAR_DISPOSITION_THRESHOLD);
    expect(warsFor(after, 'ojjul')).toContain('vigil');
    expect(answered(after)).toHaveLength(1);
  });

  it('calls a coalition only against the powers it names', () => {
    const s = board();
    s.treaties.push(pact('coalition', ['meridian', 'ojjul'], { ojjul: 12 }, ['drajk']));
    const regard = fac(s, 'ojjul').disposition['vigil'];
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(answered(after)).toHaveLength(0);
    expect(honoured(after)).toHaveLength(0);
    expect(fac(after, 'ojjul').disposition['vigil']).toBe(regard);
  });

  it('calls a coalition against the power it names', () => {
    const s = board();
    s.treaties.push(pact('coalition', ['meridian', 'ojjul'], { ojjul: 12 }, ['vigil']));
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(warsFor(after, 'ojjul')).toContain('vigil');
    expect(honoured(after)).toHaveLength(1);
  });

  it('does not call an ally that has made its own peace with the attacker', () => {
    // How a coalition comes apart: a member that settles separately is not
    // dragged back in.
    const s = board();
    s.treaties.push(pact('coalition', ['meridian', 'ojjul'], { ojjul: 12 }, ['vigil']));
    s.treaties.push(pact('non_aggression', ['ojjul', 'vigil']));
    const regard = fac(s, 'ojjul').disposition['vigil'];
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(answered(after)).toHaveLength(0);
    expect(honoured(after)).toHaveLength(0);
    expect(fac(after, 'ojjul').disposition['vigil']).toBe(regard);
  });

  it('calls nobody when the member is the one attacking — a holder sweeping its own orbit', () => {
    const s = createSeedState('vigil');
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    setShipsAt(sys(s, 'tor-1'), 'vigil', 3);
    setShipsAt(sys(s, 'sek-2'), 'meridian', 30);
    const atIlv5 = stackAt(sys(s, 'ilv-5'), 'ojjul');
    const swept = applyOps(s, [
      {
        op: 'issue_order', factionId: 'meridian', type: 'fleet_movement',
        originId: 'sek-2', targetId: 'tor-1', force: 25, label: 'clear the orbit',
      },
    ]).state;
    const after = untilArrived(swept).state;
    expect(answered(after)).toHaveLength(0);
    expect(honoured(after)).toHaveLength(0);
    expect(stackAt(sys(after, 'ilv-5'), 'ojjul')).toEqual(atIlv5);
  });
});

describe('a pledge is warships from within reach, once a turn', () => {
  it('sends the line and its screen, never transports, freighters or listeners', () => {
    const s = board();
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    // ilv-5 is two jumps from Torrek Anchorage.
    setStackAt(sys(s, 'ilv-5'), 'ojjul', { lifter: 5, freighter: 3, listener: 2, battleship: 2, escort: 4 });
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(honoured(after)[0]!.text).toMatch(/commits 6 warships/);
    const left = stackAt(sys(after, 'ilv-5'), 'ojjul');
    expect(left).toMatchObject({ lifter: 5, freighter: 3, listener: 2 });
    expect(left.battleship ?? 0).toBe(0);
    expect(left.escort ?? 0).toBe(0);
  });

  it('comes from nowhere further than PLEDGE_REACH', () => {
    const s = board();
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    // Clear everything within two jumps; ilv-3 is three away.
    setShipsAt(sys(s, 'ilv-5'), 'ojjul', 0);
    const far = stackAt(sys(s, 'ilv-3'), 'ojjul');
    const after = untilArrived(attack(s, 'tor-3', 'tor-1')).state;
    expect(honoured(after)).toHaveLength(0);
    expect(stackAt(sys(after, 'ilv-3'), 'ojjul')).toEqual(far);
    // Still called to war: the obligation is not the squadron.
    expect(warsFor(after, 'ojjul')).toContain('vigil');
  });

  it('answers once a turn however many of the member’s worlds are struck', () => {
    const s = createSeedState('vigil');
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 6 }));
    // Both strikes are two jumps and land on the same tick; the ally's ships
    // stand at sek-1, within reach of both targets.
    setShipsAt(sys(s, 'tor-2'), 'vigil', 30);
    setShipsAt(sys(s, 'tor-3'), 'vigil', 30);
    setStackAt(sys(s, 'sek-1'), 'ojjul', { battleship: 20 });
    const ordered = applyOps(s, [
      { op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-2', targetId: 'sek-2', force: 25, label: 'a' },
      { op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-3', targetId: 'sek-4', force: 25, label: 'b' },
    ]).state;
    const after = untilArrived(ordered).state;
    expect(honoured(after)).toHaveLength(1);
    expect(hullsAt(sys(after, 'sek-1'), 'ojjul')).toBe(14);
  });

  it('replays a journal from before version 19 under the old rule', () => {
    const s = board();
    s.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    const regard = fac(s, 'ojjul').disposition['vigil'];
    const after = untilArrived(attack(s, 'tor-3', 'tor-1'), { ...calm, battleRules: { callToArms: false } }).state;
    expect(answered(after)).toHaveLength(0);
    expect(after.eventLog.some((e) => /honours its mutual defence pact and commits 12 ships/.test(e.text))).toBe(true);
    expect(fac(after, 'ojjul').disposition['vigil']).toBe(regard);
  });
});

describe('exhaustion: a power weighs every war it is in', () => {
  /** Meridian at war with the Combine and the Free Worlds, a battle last turn. */
  const twoFronts = (): WorldState => {
    const s = createSeedState('vigil');
    for (const e of ['ojjul', 'freeworlds']) {
      setRegard(s, 'meridian', e, -80);
      setRegard(s, e, 'meridian', -80);
    }
    s.turn = ENVOYS_QUIET_TURNS + 2;
    s.lastClash = {
      [clashKey('meridian', 'ojjul')]: s.turn - 1,
      [clashKey('meridian', 'freeworlds')]: s.turn - 1,
    };
    return s;
  };
  const strip = (s: WorldState, id: string) => {
    for (const x of s.systems) if (x.ships[id]) setShipsAt(x, id, 1);
  };

  it('is nothing to a power at peace', () => {
    const s = createSeedState('vigil');
    for (const f of s.factions) for (const o of s.factions) if (f.id !== o.id) f.disposition[o.id] = 0;
    expect(exhaustion(s, 'meridian')).toBeNull();
  });

  it('reads every enemy together: two it could face alone can outweigh it', () => {
    const s = twoFronts();
    const spent = exhaustion(s, 'meridian')!;
    expect(spent.enemies.sort()).toEqual(['freeworlds', 'ojjul']);
    expect(spent.theirs).toBeGreaterThan(0);
    expect(spent.outmatched).toBe(spent.theirs >= spent.mine * EXHAUSTION_RATIO);
    strip(s, 'meridian');
    expect(exhaustion(s, 'meridian')!.outmatched).toBe(true);
  });

  it('counts a war it cannot pay for, whatever its fleet', () => {
    const s = twoFronts();
    fac(s, 'meridian').credits = 0;
    // Make it run at a loss: a fleet far larger than its income carries.
    setShipsAt(sys(s, 'sek-1'), 'meridian', 600);
    const spent = exhaustion(s, 'meridian')!;
    expect(spent.broke).toBe(true);
    expect(spent.exhausted).toBe(true);
  });

  it('sues the strongest enemy it can settle with, and pays for the peace', () => {
    const s = twoFronts();
    strip(s, 'meridian');
    fac(s, 'meridian').credits = 1000;
    const peace = brokeredAccords(s).find((a) => a.label.startsWith('peace:') && a.label.endsWith(':meridian'));
    expect(peace, 'an exhausted power sues even in a war that is not quiet').toBeDefined();
    const enemy = peace!.parties.find((p) => p !== 'meridian')!;
    const other = enemy === 'ojjul' ? 'freeworlds' : 'ojjul';
    expect(sideStrength(s, [enemy])).toBeGreaterThanOrEqual(sideStrength(s, [other]));

    const before = fac(s, enemy).credits;
    const after = applyOps(s, peace!.ops, 'engine', undefined, true);
    expect(after.rejections).toHaveLength(0);
    const indemnity = Math.floor(1000 * EXHAUSTION_INDEMNITY_SHARE);
    expect(fac(after.state, 'meridian').credits).toBe(1000 - indemnity);
    expect(fac(after.state, enemy).credits).toBe(before + indemnity);
    // One peace: it consolidates against the rest rather than settling every war.
    expect(warsFor(after.state, 'meridian')).toContain(other);
  });

  it('does not sue where a compulsion bars the peace', () => {
    // The Vigil will entertain no accommodation with the Confederacy or the Nars.
    const s = createSeedState('meridian');
    for (const f of s.factions) for (const o of s.factions) if (f.id !== o.id) f.disposition[o.id] = 0;
    setRegard(s, 'drajk', 'vigil', -90);
    setRegard(s, 'vigil', 'drajk', -90);
    strip(s, 'vigil');
    s.turn = ENVOYS_QUIET_TURNS + 2;
    s.lastClash = { [clashKey('drajk', 'vigil')]: s.turn - 1 };
    expect(exhaustion(s, 'vigil')!.exhausted).toBe(true);
    expect(brokeredAccords(s).some((a) => a.label.startsWith('peace:'))).toBe(false);
  });

  it('is leverage at the table', () => {
    const s = twoFronts();
    const before = concessionBudget(s, 'meridian', 'ojjul').scale;
    strip(s, 'meridian');
    const spent = concessionBudget(s, 'meridian', 'ojjul');
    expect(spent.scale).toBeGreaterThan(before);
    expect(spent.because.join(' ')).toMatch(/war you are losing/);
  });
});

describe('the bots bind against the power they fear', () => {
  /** Meridian and the Free Worlds on good terms, both hating a third. */
  const warmPair = (player: string, target: string): WorldState => {
    const s = createSeedState(player);
    for (const f of s.factions) for (const o of s.factions) if (f.id !== o.id) f.disposition[o.id] = 0;
    setRegard(s, 'meridian', 'freeworlds', COALITION_STANDING);
    setRegard(s, 'freeworlds', 'meridian', COALITION_STANDING);
    setRegard(s, 'meridian', target, COALITION_GRIEVANCE);
    setRegard(s, 'freeworlds', target, COALITION_GRIEVANCE);
    setShipsAt(sys(s, s.systems.find((x) => x.controllerFactionId === target)!.id), target, 400);
    return s;
  };

  it('sign a coalition against a stronger power both hate, pledging warships', () => {
    const s = warmPair('ojjul', 'vigil');
    const coalition = brokeredAccords(s).find((a) => a.label.startsWith('coalition:'));
    expect(coalition?.label).toBe('coalition:freeworlds:meridian:vigil');
    const after = applyOps(s, coalition!.ops, 'engine', undefined, true);
    expect(after.rejections).toHaveLength(0);
    const t = after.state.treaties.find((x) => x.type === 'coalition')!;
    expect(t.terms.against).toEqual(['vigil']);
    expect(t.terms.shipsPledged).toEqual({ freeworlds: BOT_COALITION_PLEDGE, meridian: BOT_COALITION_PLEDGE });
  });

  it('may be against the player', () => {
    const s = warmPair('vigil', 'vigil');
    expect(brokeredAccords(s).some((a) => a.label === 'coalition:freeworlds:meridian:vigil')).toBe(true);
  });

  it('do not bind against a power no stronger than they are alone', () => {
    const s = warmPair('ojjul', 'vigil');
    for (const x of s.systems) if (x.ships['vigil']) setShipsAt(x, 'vigil', 1);
    expect(brokeredAccords(s).some((a) => a.label.startsWith('coalition:'))).toBe(false);
  });

  it('do not bind short of the standing or the grievance', () => {
    const cool = warmPair('ojjul', 'vigil');
    setRegard(cool, 'meridian', 'freeworlds', COALITION_STANDING - 1);
    expect(brokeredAccords(cool).some((a) => a.label.startsWith('coalition:'))).toBe(false);
    const mild = warmPair('ojjul', 'vigil');
    setRegard(mild, 'freeworlds', 'vigil', COALITION_GRIEVANCE + 1);
    expect(brokeredAccords(mild).some((a) => a.label.startsWith('coalition:'))).toBe(false);
  });

  it('never include a profiteer, which pays for every war it is in', () => {
    const s = warmPair('meridian', 'vigil');
    // The Combine and the Confederacy, warm and both hating the Vigil.
    setRegard(s, 'ojjul', 'drajk', 50);
    setRegard(s, 'drajk', 'ojjul', 50);
    setRegard(s, 'ojjul', 'vigil', COALITION_GRIEVANCE);
    setRegard(s, 'drajk', 'vigil', COALITION_GRIEVANCE);
    expect(brokeredAccords(s).some((a) => a.label.startsWith('coalition:') && a.parties.includes('ojjul'))).toBe(false);
  });
});
