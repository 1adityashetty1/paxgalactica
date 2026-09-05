import { describe, expect, it } from 'vitest';
import { compositions, mixedWins, tournament, trial } from '../src/fleetlab.js';
import { HULL_CLASSES, hullCost, type ShipStack } from '../src/domain/hulls.js';
import type { WarEthic } from '../src/domain/state.js';

/**
 * Composition has to be a decision, and the harness that says so has to be
 * trustworthy — the question was answered wrong three times by one-off scripts
 * before this existed, each time from a sample too narrow to support it.
 *
 * Small grids here: the point is that the property holds and the tool works,
 * not to re-derive the whole tournament on every test run. `pnpm fleetlab` is
 * the full version.
 */
const FAST = {
  budget: 3600,
  defenceBudget: 1200,
  steps: 3,
  garrisons: [6, 12],
  turns: [1, 2, 3],
  ethics: ['profiteer', 'crusading'] as WarEthic[],
};

describe('the composition grid', () => {
  it('spends about the budget on every entry', () => {
    for (const c of compositions(1200, 4)) {
      expect(c.cost, c.label).toBeLessThanOrEqual(1200);
      // Flooring to whole hulls cannot lose more than one of each class.
      const slack = HULL_CLASSES.reduce((n, h) => Math.max(n, hullCost(h)), 0) * c.classes;
      expect(c.cost, c.label).toBeGreaterThan(1200 - slack);
    }
  });

  it('includes the fleets nobody would build, so they can be shown to lose', () => {
    const grid = compositions(1200, 4);
    expect(grid.some((c) => c.classes === 1)).toBe(true);
    expect(grid.some((c) => (c.stack.lifter ?? 0) === 0)).toBe(true);
    expect(grid.some((c) => c.classes >= 3)).toBe(true);
  });

  it('lists each distinct fleet once', () => {
    const grid = compositions(1200, 4);
    expect(new Set(grid.map((c) => JSON.stringify(c.stack))).size).toBe(grid.length);
  });
});

describe('a trial reads the battle it actually fought', () => {
  const line: ShipStack = { battleship: 20 };
  it('reports no_lift when a pure warfleet clears an orbit', () => {
    const r = trial({ battleship: 40 }, {}, 4, 3, 'profiteer');
    expect(r.took).toBe(false);
    expect(r.why).toBe('no_lift');
  });

  it('takes an undefended world with lift aboard', () => {
    const r = trial({ battleship: 20, lifter: 6 }, {}, 2, 3, 'profiteer');
    expect(r.took).toBe(true);
  });

  it('varies with the roll, which is why one battle proves nothing', () => {
    const outcomes = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((t) => trial({ battleship: 14, lifter: 4 }, line, 8, t, 'profiteer').why),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

/**
 * The property the classes exist for: **at a budget that can actually take a
 * world, the best attacking fleet carries three classes.**
 *
 * An attacker needs local superiority for this question to be well posed. At
 * equal credits the defender holds ~100% of the time and no composition can be
 * told from any other, which is what the first version of this measurement got
 * wrong.
 */
describe('composition decides an invasion', () => {
  it('makes a three-class fleet the best attacker', () => {
    const r = tournament(FAST);
    const m = mixedWins(r.attackers, 3);
    expect(m.mixedIsBest, `best was ${r.attackers[0]!.classes} classes: ${r.attackers[0]!.label}`).toBe(true);
    expect(m.mixed!.rate).toBeGreaterThan(0.4);
  });

  it('leaves a fleet with no lift unable to take anything at all', () => {
    const r = tournament(FAST);
    for (const c of r.attackers.filter((x) => (x.stack.lifter ?? 0) === 0)) {
      expect(c.rate, c.label).toBe(0);
    }
  });

  it('rewards the battle line and the screen for different reasons', () => {
    // A fleet heavy in line fails by losing its transports; a fleet heavy in
    // screen fails by never clearing the orbit. That both failure modes exist
    // is what makes the mix a decision rather than a ratio to solve once.
    const r = tournament(FAST);
    const heaviestLine = r.attackers
      .filter((c) => (c.stack.lifter ?? 0) > 0)
      .sort((a, b) => (b.stack.battleship ?? 0) - (a.stack.battleship ?? 0))[0]!;
    const heaviestScreen = r.attackers
      .filter((c) => (c.stack.lifter ?? 0) > 0)
      .sort((a, b) => (b.stack.escort ?? 0) - (a.stack.escort ?? 0))[0]!;
    expect(heaviestLine.why['no_lift'] ?? 0).toBeGreaterThan(0);
    expect(heaviestScreen.why['no_landing'] ?? 0).toBeGreaterThan(0);
  });
});
