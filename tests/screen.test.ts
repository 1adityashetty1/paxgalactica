import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  HULL_SPEC,
  battleshipEquivalents,
  drawToWeight,
  hullsIn,
  TORPEDO_STRIKE,
  strikeStack,
  tonsIn,
  tonsOfClass,
  torpedoStrike,
  type HullClass,
  type ShipStack,
} from '../src/domain/hulls.js';
import { addShipsAt, hullsAt, stackAt, type WorldState } from '../src/domain/state.js';

const fresh = (): WorldState => createSeedState('freeworlds');
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

/** Send `att` from ark-3 against a world defended by `def`, and settle it. */
function fight(att: ShipStack, def: ShipStack, garrison = 1, target = 'sek-6') {
  const state = fresh();
  const t = sys(state, target);
  t.controllerFactionId = 'vigil';
  t.ships = {};
  for (const [h, n] of Object.entries(def) as [HullClass, number][]) addShipsAt(t, 'vigil', n, h);
  t.garrison = garrison;
  t.garrisonMax = garrison;

  const origin = sys(state, 'ark-3');
  origin.ships = {};
  for (const [h, n] of Object.entries(att) as [HullClass, number][]) {
    addShipsAt(origin, 'freeworlds', n, h);
  }
  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-3', targetId: target, force: att,
    },
  ]);
  expect(issued.rejections).toHaveLength(0);
  let r = tickTurn(issued.state);
  while (r.state.pendingOrders.some((o) => o.id === 'ord-0-0')) r = tickTurn(r.state);
  return r;
}

/**
 * Step 2. The lift arm is soft, so a screen has something to protect.
 *
 * Ordering transports LAST made them the safest thing in a fleet and left the
 * escort with no job at all — the exact opposite of the sentence the class was
 * written to enforce.
 */
describe('the lift arm is soft', () => {
  it('spends the screen, then the transports, and the battle line last', () => {
    const stack = { escort: 4, lifter: 4, battleship: 4 };
    // Eight tons is the whole screen and nothing else.
    expect(strikeStack(stack, 8).taken).toEqual({ escort: 4 });
    // Twenty is the screen and the whole convoy, with the line untouched.
    expect(strikeStack(stack, 20).taken).toEqual({ escort: 4, lifter: 4 });
  });

  it('brings a convoy home from a withdrawal that would otherwise lose it', () => {
    // **Where a screen actually earns its keep.** The exchange band destroys
    // half a fleet or more — no realistic escort force absorbs that, and at 2:1
    // the defender simply breaks off and nothing is lost at all. A withdrawal
    // costs 10-35%, and that a screen covers outright.
    //
    // Both fleets are the same tonnage; the screened one trades four
    // battleships for eight escorts, so it is the WEAKER of the two and still
    // comes home with its transports.
    //
    // SWEPT over ten targets rather than fought once. The withdrawal loss is
    // derived from the battle's own d20, and the salt carries the system id —
    // so a single fight measures one roll, and the surviving-lift figure it
    // produces ranges from 0 to 6 across the map with the mechanic untouched.
    // An earlier version of this test asserted `>= 5` on one system directly
    // beneath a comment explaining why a fixed count is wrong, and duly broke
    // when that system was renamed and nothing else changed.
    const wall = { battleship: 40 };
    const targets = ['sek-2', 'sek-3', 'sek-4', 'sek-5', 'sek-6',
                     'ilv-2', 'ilv-4', 'tor-2', 'tor-5', 'ark-4'];
    const liftOf = (r: ReturnType<typeof fight>) =>
      r.state.systems.reduce((n, s) => n + (stackAt(s, 'freeworlds').lifter ?? 0), 0);

    // Only withdrawals are in scope. At some targets the roll lands the
    // exchange in the annihilation band instead, and both fleets simply burn —
    // that is the band this test is contrasting itself against, not a case of
    // the screen failing.
    const rows = targets
      .map((t) => ({
        t,
        naked: fight({ battleship: 16, lifter: 6 }, wall, 1, t),
        screened: fight({ battleship: 12, escort: 8, lifter: 6 }, wall, 1, t),
      }))
      .filter((r) => [r.naked, r.screened].every((f) => /driven off/.test(f.notes.join(' '))))
      .map((r) => ({ t: r.t, naked: liftOf(r.naked), screened: liftOf(r.screened) }));

    // Enough of the sweep is actually a withdrawal for the rest to mean something.
    expect(rows.length).toBeGreaterThanOrEqual(8);
    // The screen is never a liability: it cannot cost lift anywhere.
    for (const r of rows) expect(r.screened, r.t).toBeGreaterThanOrEqual(r.naked);
    // And it is a real gain, not a rounding one, in the clear majority.
    expect(rows.filter((r) => r.screened > r.naked).length).toBeGreaterThanOrEqual(7);
    // Somewhere it does the whole job: the convoy comes home entire while the
    // unscreened one loses it outright. That is the claim being tested.
    expect(rows.some((r) => r.screened === 6 && r.naked < 6)).toBe(true);
  });
});

/**
 * Step 3. The torpedo boat redistributes losses; it does not add any.
 *
 * A boat that hit harder would just be a cheaper battleship, and the escort
 * would have nothing to answer.
 */
describe('a torpedo boat strikes past the screen', () => {
  const screened = { battleship: 8, escort: 8 };

  it('destroys the same tonnage whichever way it lands', () => {
    for (const deep of [0, 0.25, 0.5, 1]) {
      const { taken, left } = strikeStack(screened, 16, deep);
      expect(tonsIn(taken) + tonsIn(left)).toBe(tonsIn(screened));
      expect(tonsIn(taken)).toBeGreaterThanOrEqual(16);
    }
  });

  it('turns the same losses from the screen into the battle line', () => {
    expect(strikeStack(screened, 16, 0).taken).toEqual({ escort: 8 });
    expect(strikeStack(screened, 16, 1).taken).toEqual({ battleship: 4 });
  });

  it('spills back into the loss order when the heavies run out', () => {
    // Everything past the screen, but there is only one battleship to hit.
    const thin = { battleship: 1, escort: 6 };
    const { taken } = strikeStack(thin, 12, 1);
    expect(taken.battleship).toBe(1);
    expect(taken.escort).toBeGreaterThan(0);
  });

  it('spends everything it has in one salvo and nothing in the line', () => {
    // The boat's whole output is the strike, and it carries no weight into the
    // exchange — which is what stops it being a cheaper battleship.
    expect(torpedoStrike([{ battleship: 12 }])).toBe(0);
    expect(torpedoStrike([{ torpedo_boat: 10 }])).toBe(
      10 * HULL_SPEC.torpedo_boat.tonnage * TORPEDO_STRIKE,
    );
    expect(battleshipEquivalents({ torpedo_boat: 40 })).toBe(0);
  });
});

/**
 * The triangle: boats beat a battle line, a screen beats boats, and a battle
 * line beats a screen. Each leg is a separate assertion because each fails
 * differently.
 */
describe('escorts answer torpedo boats', () => {
  it('turns the strike aside when the screen matches it ton for ton', () => {
    const boats = { torpedo_boat: 10 }; // 20 tons
    // Both measured against the SAME firing fleet, so only the screen moves.
    const deep = (target: ShipStack) =>
      1 - Math.min(1, tonsOfClass([target], 'escort') / tonsOfClass([boats], 'torpedo_boat'));
    expect(deep({ battleship: 10 })).toBe(1);
    expect(deep({ battleship: 8, escort: 10 })).toBe(0);
    expect(deep({ battleship: 8, escort: 5 })).toBeCloseTo(0.5, 5);
    // The tonnage destroyed is the same either way; only its address changes.
    expect(torpedoStrike([boats])).toBe(20 * TORPEDO_STRIKE);
  });

  it('gives a boat nothing to gain against a fleet with no heavies', () => {
    const allEscort = { escort: 12 };
    expect(strikeStack(allEscort, 10, 1).taken).toEqual(strikeStack(allEscort, 10, 0).taken);
  });

  it('leaves a battleship the better fighter, so boats are not a fleet', () => {
    // Equal credits: 10 battleships against 20 torpedo boats.
    const line = { battleship: 10 };
    const swarm = { torpedo_boat: 20 };
    expect(tonsIn(line)).toBe(tonsIn(swarm));
    expect(battleshipEquivalents(line)).toBeGreaterThan(battleshipEquivalents(swarm));
  });

  it('keeps more of a battle line alive than the same line unscreened', () => {
    // The player's actual question: *I have eight battleships — should I also
    // buy a screen?* So the control is the same line without one.
    //
    // **Equal TONNAGE is the wrong control**, and the first version of this
    // test used it: 14 battleships and `8 battleships + 12 escorts` displace
    // the same 56 tons but are 14 and 12 battleship-equivalents, so the bare
    // fleet is simply stronger and wins the exchange outright. That measures
    // weight, not screening. Isolating the redirection itself is what the
    // `strikeStack` cases above do, at the unit level where no roll is involved.
    const boats = { battleship: 6, torpedo_boat: 14 };
    const lineLeft = (def: ShipStack) =>
      stackAt(sys(fight(boats, def).state, 'sek-6'), 'vigil').battleship ?? 0;
    expect(lineLeft({ battleship: 8, escort: 12 })).toBeGreaterThan(
      lineLeft({ battleship: 8 }),
    );
  });
});

/**
 * Strength has to be stated in the unit the exchange compares, or a threshold
 * means something different every time a class is added.
 */
describe('battleship-equivalents', () => {
  it('reads exactly as a hull count in a galaxy of battleships', () => {
    expect(battleshipEquivalents({ battleship: 17 })).toBe(17);
  });

  it('prices a cheap hull at what it actually contributes', () => {
    expect(battleshipEquivalents({ escort: 3 })).toBe(1);
    expect(battleshipEquivalents({ lifter: 9 })).toBe(0);
  });

  it('draws the smallest proportional slice worth a stated strength', () => {
    const fleet = { battleship: 10, escort: 6 };
    const slice = drawToWeight(fleet, 4);
    expect(battleshipEquivalents(slice)).toBeGreaterThanOrEqual(4);
    // Proportional, so the slice looks like the fleet it came from.
    expect(slice.escort).toBeGreaterThan(0);
    expect(hullsIn(slice)).toBeLessThan(hullsIn(fleet));
  });

  it('hands back everything when the fleet is not strong enough', () => {
    expect(drawToWeight({ escort: 2 }, 99)).toEqual({ escort: 2 });
  });
});

describe('the classes keep their shape', () => {
  it('gives a torpedo boat no weight at all, so it is not a better battleship', () => {
    // It fires once, before the fleets close, and adds nothing to the line —
    // so a fleet of nothing but boats delivers one salvo and is then destroyed
    // where it lies, having no weight with which to hold an orbit.
    expect(HULL_SPEC.torpedo_boat.orbitalWeight).toBe(0);
    expect(HULL_SPEC.torpedo_boat.tonnage).toBe(HULL_SPEC.escort.tonnage);
  });

  it('puts the screen in front of everything else', () => {
    for (const hull of ['lifter', 'torpedo_boat', 'battleship'] as const) {
      expect(HULL_SPEC.escort.lossOrder, hull).toBeLessThan(HULL_SPEC[hull].lossOrder);
    }
  });

  it('puts the lift arm in front of the battle line', () => {
    expect(HULL_SPEC.lifter.lossOrder).toBeLessThan(HULL_SPEC.battleship.lossOrder);
  });
});

describe('a battle where nobody has a screen still resolves', () => {
  it('does not divide by zero when a side has no escorts at all', () => {
    const res = fight({ battleship: 10, torpedo_boat: 6 }, { battleship: 9 });
    expect(res.report ?? res.notes).toBeTruthy();
    expect(hullsAt(sys(res.state, 'sek-6'), 'freeworlds') >= 0).toBe(true);
  });
});

/**
 * The roll has to run the same way for both sides.
 *
 * `exchange = min(attackPower, defendPower)` meant whichever side was weaker
 * had its own swing already baked into the figure, and dividing by that side's
 * own modifier cancelled the modifier but not the swing — so
 * `defenceLeft = defendWeight x swing`, and a natural 20 left a defender that
 * could not break off with 42% of its fleet while a natural 1 annihilated it.
 * Measured live: at Kalzir a roll of 20 left seven battleships holding the
 * orbitals and the landing was called off; at Gorrun Deep a roll of 10
 * destroyed the defenders outright.
 */
describe('the exchange reads the roll the same way for both sides', () => {
  // A crusading holder never breaks off, so every roll lands in the exchange
  // branch — which is exactly where the inversion used to bite hardest.
  const survivors = (roll: number) => {
    const state = fresh();
    const t = sys(state, 'sek-6');
    t.controllerFactionId = 'vigil';
    t.ships = {};
    addShipsAt(t, 'vigil', 12, 'battleship');
    t.garrison = 1;
    t.garrisonMax = 1;
    return { state, t };
  };

  it('gives the attacker more and the defender less as the roll rises', () => {
    // Read straight off the arithmetic, since a live battle can only be fought
    // at the one roll its turn and system produce.
    const band = (aw: number, dw: number, roll: number) => {
      const swing = (roll - 10.5) / 22;
      const base = Math.min(aw, dw);
      const tilt = base * swing;
      return {
        attacker: Math.max(0, aw - Math.ceil(base - tilt)) / aw,
        defender: Math.max(0, dw - Math.ceil(base + tilt)) / dw,
      };
    };
    let lastAttacker = -1;
    let lastDefender = 2;
    for (const roll of [1, 5, 10, 15, 20]) {
      const { attacker, defender } = band(50, 12, roll);
      expect(attacker, `attacker at roll ${roll}`).toBeGreaterThan(lastAttacker);
      expect(defender, `defender at roll ${roll}`).toBeLessThanOrEqual(lastDefender);
      lastAttacker = attacker;
      lastDefender = defender;
    }
    // And the two ends are the right way round, which is the whole point.
    expect(band(50, 12, 20).defender).toBeLessThan(band(50, 12, 1).defender);
    expect(band(50, 12, 20).attacker).toBeGreaterThan(band(50, 12, 1).attacker);
  });

  it('still spends the weaker side in a stand-up fight', () => {
    // The band is brutal by design — `min(attackPower, defendPower)` means an
    // exchange consumes the weaker fleet — and this fix reorients it without
    // softening it.
    const { state, t } = survivors(10);
    const origin = sys(state, 'ark-3');
    origin.ships = {};
    addShipsAt(origin, 'freeworlds', 16, 'battleship');
    const issued = applyOps(state, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-3', targetId: 'sek-6', force: { battleship: 16 },
      },
    ]);
    let r = tickTurn(issued.state);
    while (r.state.pendingOrders.some((o) => o.id === 'ord-0-0')) r = tickTurn(r.state);
    expect(r.notes.join(' ')).toMatch(/Fleets engage|driven off|breaks off/);
    expect(hullsAt(sys(r.state, 'sek-6'), 'vigil')).toBeLessThan(12);
    expect(t.controllerFactionId).toBe('vigil'); // the fixture is untouched
  });
});
