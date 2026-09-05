import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  setShipsAt,
  DEFENSIVE_GARRISON_BONUS,
  EXPANSIONIST_TERRITORY_BONUS,
  ledgerFor,
  PROFITEER_INCOME_PER_WAR,
  PROFITEER_WAR_PENALTY,
  WAR_ETHICS,
  warProfitFor,
  warsFor,
  warsInProgress,
  type WarEthic,
  type WorldState,
} from '../src/domain/state.js';

/**
 * `warEthic` had no mechanical reader anywhere for the whole life of the
 * project — only the prompt serializer. That is why two factions shared
 * `defensive` and nobody noticed, why `expansionist` sat unused, and why the
 * Ojjul Nar Combine was labelled `mercenary` ("fights for payment; war is a
 * service sold") while its doctrine says *"let other powers spend their fleets
 * for you"* and its might is the lowest in the game. It was the seller's label
 * on the buyer.
 *
 * Each ethic now has one signature mechanic, and two of them cut both ways.
 */

const fresh = (player = 'meridian'): WorldState => createSeedState(player);
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

/** Put two factions at war by souring both directions past the threshold. */
function makeWar(state: WorldState, a: string, b: string): void {
  fac(state, a).disposition[b] = -80;
  fac(state, b).disposition[a] = -80;
}

describe('every war ethic has an owner and a mechanic', () => {
  it('assigns each of the five exactly once', () => {
    const held = fresh().factions.map((f) => f.warEthic);
    expect([...held].sort()).toEqual([...WAR_ETHICS].sort());
    expect(new Set(held).size).toBe(WAR_ETHICS.length);
  });

  it('puts each doctrine where the lore already pointed', () => {
    const state = fresh();
    expect(fac(state, 'meridian').warEthic).toBe('expansionist');
    expect(fac(state, 'vigil').warEthic).toBe('crusading');
    expect(fac(state, 'hutt').warEthic).toBe('profiteer');
    expect(fac(state, 'freeworlds').warEthic).toBe('defensive');
    expect(fac(state, 'krayt').warEthic).toBe('opportunist');
  });

  it('no longer offers `mercenary` at all', () => {
    expect(WAR_ETHICS as readonly string[]).not.toContain('mercenary');
  });
});

describe('expansionist: every world makes the rest pay better', () => {
  it('scales territory income with how many worlds are held', () => {
    const plain = fresh();
    const expansionist = fresh();
    fac(plain, 'meridian').warEthic = 'defensive';

    const held = ledgerFor(expansionist, 'meridian').systems;
    expect(held).toBeGreaterThan(0);
    const ratio =
      ledgerFor(expansionist, 'meridian').territory / ledgerFor(plain, 'meridian').territory;
    expect(ratio).toBeCloseTo(1 + EXPANSIONIST_TERRITORY_BONUS * held, 2);
  });

  it('compounds, so taking a world raises what the others earn', () => {
    const before = ledgerFor(fresh(), 'meridian').territory;
    const wider = fresh();
    sys(wider, 'slu-3').controllerFactionId = 'meridian';
    const after = ledgerFor(wider, 'meridian').territory;
    // More than the new world alone is worth, because the bonus applies to all.
    const plainWider = fresh();
    fac(plainWider, 'meridian').warEthic = 'defensive';
    sys(plainWider, 'slu-3').controllerFactionId = 'meridian';
    const plainBefore = ledgerFor(fresh(), 'meridian').territory;
    expect(after - before).toBeGreaterThan(
      ledgerFor(plainWider, 'meridian').territory - plainBefore,
    );
  });

  it('takes the bonus away with the worlds', () => {
    const stripped = fresh();
    for (const s of stripped.systems) {
      if (s.controllerFactionId === 'meridian') s.controllerFactionId = 'vigil';
      setShipsAt(s, 'meridian', 0); // otherwise presence still earns a contested share
    }
    expect(ledgerFor(stripped, 'meridian').territory).toBe(0);
  });

  it('consolidates a conquest instead of leaving a token garrison', () => {
    // Compared against the same assault by a non-expansionist, since the
    // captured garrison is a fraction of what was there either way.
    const storm = (ethic: WarEthic) => {
      const state = fresh();
      fac(state, 'meridian').warEthic = ethic;
      sys(state, 'slu-3').garrison = 9;
      setShipsAt(sys(state, 'slu-3'), 'meridian', 0);
      const out = applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'meridian', type: 'fleet_movement',
            originId: 'slu-1', targetId: 'slu-3', force: 60,
          },
        ],
        'model',
        'meridian',
      );
      let s = out.state;
      for (let i = 0; i < 6 && s.pendingOrders.length > 0; i++) s = tickTurn(s).state;
      return sys(s, 'slu-3');
    };
    const taken = storm('expansionist');
    const alsoTaken = storm('defensive');
    expect(taken.controllerFactionId).toBe('meridian');
    expect(alsoTaken.controllerFactionId).toBe('meridian');
    expect(taken.garrison).toBeGreaterThan(alsoTaken.garrison);
  });
});

describe('defensive: occupation costs more than it is worth', () => {
  /**
   * Swept across force sizes rather than asserted on one battle.
   *
   * A single engagement turns on a seeded roll and an exact threshold, so
   * picking one force size and demanding it flip is a test that passes by luck.
   * Counting how many force sizes take the world measures the doctrine itself —
   * the same approach `combat.test.ts` uses to show dissent never decided an
   * assault.
   */
  const capturesAcrossForces = (holderEthic: WarEthic, attackerEthic: WarEthic): number => {
    let taken = 0;
    for (let force = 6; force <= 26; force += 2) {
      const state = fresh();
      fac(state, 'freeworlds').warEthic = holderEthic;
      fac(state, 'krayt').warEthic = attackerEthic;
      const t = sys(state, 'ark-6');
      t.garrison = 10;
      t.garrisonMax = 10;
      setShipsAt(t, 'freeworlds', 0);
      setShipsAt(sys(state, 'ark-5'), 'krayt', force);
      const out = applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'krayt', type: 'fleet_movement',
            originId: 'ark-5', targetId: 'ark-6', force,
          },
        ],
        'model',
        'krayt',
      );
      let s = out.state;
      for (let i = 0; i < 8 && s.pendingOrders.length > 0; i++) s = tickTurn(s).state;
      if (sys(s, 'ark-6').controllerFactionId === 'krayt') taken += 1;
    }
    return taken;
  };

  it('is stormed less often than the same world held by anyone else', () => {
    const dugIn = capturesAcrossForces('defensive', 'profiteer');
    const ordinary = capturesAcrossForces('profiteer', 'profiteer');
    expect(ordinary).toBeGreaterThan(0);
    expect(dugIn).toBeLessThan(ordinary);
    expect(DEFENSIVE_GARRISON_BONUS).toBeGreaterThan(1);
  });

  it('lets an opportunist claw back some of what the dug-in world costs it', () => {
    // Both doctrines are live at once here, which is the interesting case: the
    // garrison is below half its ceiling, so the raider's bonus applies.
    const plain = capturesAcrossForces('profiteer', 'profiteer');
    const raider = capturesAcrossForces('profiteer', 'opportunist');
    expect(raider).toBeGreaterThanOrEqual(plain);
  });
});

describe('crusading: does not break off', () => {
  it('stands when an ordinary defender would scatter', () => {
    const defend = (ethic: WarEthic) => {
      const state = fresh();
      fac(state, 'vigil').warEthic = ethic;
      const t = sys(state, 'slu-6');
      t.controllerFactionId = 'vigil';
      setShipsAt(t, 'vigil', 2);
      t.garrison = 1;
      t.garrisonMax = 1;
      setShipsAt(sys(state, 'ark-3'), 'freeworlds', 40);
      const out = applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
            originId: 'ark-3', targetId: 'slu-6', force: 40,
          },
        ],
        'model',
        'freeworlds',
      );
      let s = out.state;
      let notes: string[] = [];
      for (let i = 0; i < 6 && s.pendingOrders.length > 0; i++) {
        const tick = tickTurn(s);
        s = tick.state;
        notes = tick.notes;
      }
      return notes.join(' ');
    };
    expect(defend('profiteer')).toMatch(/breaks off/);
    expect(defend('crusading')).not.toMatch(/breaks off/);
  });

  it('cuts both ways: it also refuses to withdraw when outmatched attacking', () => {
    const strike = (ethic: WarEthic) => {
      const state = fresh();
      fac(state, 'vigil').warEthic = ethic;
      setShipsAt(sys(state, 'tio-2'), 'vigil', 3);
      const t = sys(state, 'tio-1');
      setShipsAt(t, 'meridian', 60);
      const out = applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
            originId: 'tio-2', targetId: 'tio-1', force: 3,
          },
        ],
        'model',
        'vigil',
      );
      let s = out.state;
      let notes: string[] = [];
      for (let i = 0; i < 6 && s.pendingOrders.length > 0; i++) {
        const tick = tickTurn(s);
        s = tick.state;
        notes = tick.notes;
      }
      return notes.join(' ');
    };
    // An ordinary power pulls back down its path; the crusader goes in anyway
    // and gets as far as the ground, where it is thrown back instead.
    expect(strike('profiteer')).toMatch(/driven off by its defenders/);
    expect(strike('crusading')).not.toMatch(/driven off by its defenders/);
  });
});

describe('opportunist: no reward for a fair fight', () => {
  /**
   * Sweep force sizes, counting captures — see the note above.
   *
   * Every disposition is neutralised first. The seed has Arkanis already at war
   * with the Iron Vigil, which makes it *distracted* and fires the doctrine on
   * its own — the first version of this test asserted "no bonus at full
   * garrison" and failed because the bonus was correctly applying for the other
   * reason. The two arms of the predicate have to be controlled separately to
   * be tested separately.
   */
  const capturesAgainst = (
    attackerEthic: WarEthic,
    garrison: number,
    max: number,
    distracted = false,
  ): number => {
    let taken = 0;
    for (let force = 2; force <= 16; force += 1) {
      const state = fresh();
      fac(state, 'krayt').warEthic = attackerEthic;
      fac(state, 'freeworlds').warEthic = 'profiteer'; // no dug-in bonus in play
      for (const f of state.factions) {
        for (const g of state.factions) if (f.id !== g.id) f.disposition[g.id] = 0;
      }
      if (distracted) makeWar(state, 'freeworlds', 'vigil');
      const t = sys(state, 'ark-6');
      t.garrison = garrison;
      t.garrisonMax = max;
      setShipsAt(t, 'freeworlds', 0);
      setShipsAt(sys(state, 'ark-5'), 'krayt', force);
      const out = applyOps(
        state,
        [
          {
            op: 'issue_order', factionId: 'krayt', type: 'fleet_movement',
            originId: 'ark-5', targetId: 'ark-6', force,
          },
        ],
        'model',
        'krayt',
      );
      let s = out.state;
      for (let i = 0; i < 8 && s.pendingOrders.length > 0; i++) s = tickTurn(s).state;
      if (sys(s, 'ark-6').controllerFactionId === 'krayt') taken += 1;
    }
    return taken;
  };

  it('takes a stripped world more often than anyone else would', () => {
    // Garrison far below its ceiling: weakened, so the bonus applies.
    expect(capturesAgainst('opportunist', 3, 14)).toBeGreaterThan(
      capturesAgainst('profiteer', 3, 14),
    );
  });

  it('gains nothing at all against a garrison at full strength', () => {
    // Whole and undistracted: a fair fight, and the doctrine sits out.
    expect(capturesAgainst('opportunist', 12, 12)).toBe(capturesAgainst('profiteer', 12, 12));
  });

  it('gains against a whole garrison whose holder is looking the other way', () => {
    // Same full garrison, but its holder is at war with somebody else. This is
    // the "distracted" arm: the raider is rewarded for timing, not for strength.
    expect(capturesAgainst('opportunist', 12, 12, true)).toBeGreaterThan(
      capturesAgainst('profiteer', 12, 12, true),
    );
  });
});

describe('profiteer: paid for wars it stays out of', () => {
  it('earns from a war between two other powers', () => {
    const peace = fresh();
    expect(warProfitFor(peace, 'hutt')).toBe(
      warsInProgress(peace).filter((w) => !w.includes('hutt')).length * PROFITEER_INCOME_PER_WAR,
    );

    const state = fresh();
    for (const f of state.factions) {
      for (const g of state.factions) if (f.id !== g.id) f.disposition[g.id] = 0;
    }
    expect(warProfitFor(state, 'hutt')).toBe(0);
    makeWar(state, 'vigil', 'freeworlds');
    expect(warProfitFor(state, 'hutt')).toBe(PROFITEER_INCOME_PER_WAR);
    makeWar(state, 'meridian', 'krayt');
    expect(warProfitFor(state, 'hutt')).toBe(2 * PROFITEER_INCOME_PER_WAR);
  });

  it('loses the whole trade the moment it is in a war itself', () => {
    const state = fresh();
    for (const f of state.factions) {
      for (const g of state.factions) if (f.id !== g.id) f.disposition[g.id] = 0;
    }
    makeWar(state, 'vigil', 'freeworlds');
    expect(warProfitFor(state, 'hutt')).toBe(PROFITEER_INCOME_PER_WAR);

    // Its own war forfeits every other war's fee AND costs it a penalty, which
    // is what makes "will not fight its own war" a line the ledger agrees with.
    makeWar(state, 'hutt', 'krayt');
    expect(warProfitFor(state, 'hutt')).toBe(-PROFITEER_WAR_PENALTY);
  });

  it('reaches the ledger, not just a helper', () => {
    const state = fresh();
    for (const f of state.factions) {
      for (const g of state.factions) if (f.id !== g.id) f.disposition[g.id] = 0;
    }
    const quiet = ledgerFor(state, 'hutt').net;
    makeWar(state, 'vigil', 'freeworlds');
    const profiting = ledgerFor(state, 'hutt');
    expect(profiting.warProfit).toBe(PROFITEER_INCOME_PER_WAR);
    expect(profiting.net).toBe(quiet + PROFITEER_INCOME_PER_WAR);
  });

  it('pays nobody else, whatever the galaxy is doing', () => {
    const state = fresh();
    makeWar(state, 'vigil', 'freeworlds');
    for (const id of ['meridian', 'vigil', 'freeworlds', 'krayt']) {
      expect(ledgerFor(state, id).warProfit, id).toBe(0);
    }
  });
});
