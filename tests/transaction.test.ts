import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  addShipsAt,
  hullsAt,
  setShipsAt,
  subornLimit,
  MAX_NARRATIVE_CREDITS,
  type WorldState,
} from '../src/domain/state.js';

/**
 * A BATCH IS A TRANSACTION.
 *
 * `applyOps` prices each op on its own, which is right when ops are
 * independent and wrong for the common case where they are one action's parts.
 * Three defects found in one playtest were all this same gap:
 *
 * - a suborn is a take and a give, and the ceiling sat inside one op, so
 *   asking three times took three times as many crews;
 * - a purchase is a cession and a price, and only the price was capped, so
 *   seven worlds changed hands for 1,200 credits against 13,950 agreed;
 * - a commission is an order that debits and a narrative charge beside it, and
 *   the trimmed duplicate was applied on top of the real bill.
 *
 * `billConstruction` and `capSelfInflictedLosses` already treat the batch as
 * the unit. These are the same move for money and for crews.
 */

const fresh = (player = 'meridian'): WorldState => createSeedState(player);
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

describe('a ceiling belongs to the declaration, not to the op', () => {
  it('counts every crew one declaration turns against one subornLimit', () => {
    const state = fresh();
    const at = 'ilv-2';
    setShipsAt(sys(state, at), 'ojjul', 0);
    addShipsAt(sys(state, at), 'ojjul', 4, 'escort');
    addShipsAt(sys(state, at), 'ojjul', 4, 'battleship');
    addShipsAt(sys(state, at), 'meridian', 6, 'battleship'); // presence to suborn from
    const limit = subornLimit(state, 'meridian', 'ojjul');
    expect(limit).toBeGreaterThan(0);

    const before = hullsAt(sys(state, at), 'ojjul');
    // The playtest's exact shape: one action, split by hull class, each op
    // individually inside the cap.
    const out = applyOps(
      state,
      [
        { op: 'adjust_ships', systemId: at, factionId: 'ojjul', delta: -limit, hull: 'escort' },
        { op: 'adjust_ships', systemId: at, factionId: 'ojjul', delta: -limit, hull: 'escort' },
        { op: 'adjust_ships', systemId: at, factionId: 'ojjul', delta: -limit, hull: 'battleship' },
      ],
      'model',
      'meridian',
    );
    const turned = before - hullsAt(sys(out.state, at), 'ojjul');
    expect(turned).toBe(limit);
  });

  it('gives one declaration one allowance of narrative money', () => {
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(
      state,
      [
        { op: 'adjust_credits', factionId: 'meridian', delta: MAX_NARRATIVE_CREDITS },
        { op: 'adjust_credits', factionId: 'meridian', delta: MAX_NARRATIVE_CREDITS },
        { op: 'adjust_credits', factionId: 'meridian', delta: MAX_NARRATIVE_CREDITS },
      ],
      'model',
      'meridian',
    );
    expect(fac(out.state, 'meridian').credits - before).toBe(MAX_NARRATIVE_CREDITS);
  });
});

describe('a price is charged once', () => {
  it('refunds a narrative charge the yards had already billed', () => {
    // The measured case: `commissions 80 tons for 1200` with a freeform 510
    // riding alongside, trimmed to 240 and applied anyway — 1,440 for 1,200.
    const withBoth = applyOps(
      fresh(),
      [
        { op: 'adjust_fleet', factionId: 'meridian', delta: 10, hull: 'battleship' },
        { op: 'adjust_credits', factionId: 'meridian', delta: -510 },
      ],
      'model',
      'meridian',
    );
    const yardsOnly = applyOps(
      fresh(),
      [{ op: 'adjust_fleet', factionId: 'meridian', delta: 10, hull: 'battleship' }],
      'model',
      'meridian',
    );
    expect(fac(withBoth.state, 'meridian').credits).toBe(
      fac(yardsOnly.state, 'meridian').credits,
    );
  });

  it('still trims an invented sum that no mechanism priced', () => {
    // The other half of the cap's own comment, and it must keep working: a
    // charge with nothing beside it is not a duplicate, it is a made-up number.
    const before = fac(fresh(), 'meridian').credits;
    const out = applyOps(
      fresh(),
      [{ op: 'adjust_credits', factionId: 'meridian', delta: -510 }],
      'model',
      'meridian',
    );
    expect(before - fac(out.state, 'meridian').credits).toBe(MAX_NARRATIVE_CREDITS);
  });
});

describe('a cession and its price are two halves of one deal', () => {
  const purchase = (payment: Record<string, number>) =>
    applyOps(
      fresh(),
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['meridian', 'ojjul'],
          summary: 'Ilvenn Approach',
          terms: { territory: ['ilv-1'], payment },
        },
      ],
      'extraction',
      'meridian',
    );

  it('moves the agreed price, not a narrative fraction of it', () => {
    const before = fac(fresh(), 'meridian').credits;
    const out = purchase({ meridian: -3000, ojjul: 3000 });
    expect(out.rejections).toHaveLength(0);
    expect(sys(out.state, 'ilv-1').controllerFactionId).toBe('meridian');
    const paid = before - fac(out.state, 'meridian').credits;
    // The world moved in full, so the price must too. Capping this at
    // MAX_NARRATIVE_CREDITS is what made a world cost 240.
    expect(paid).toBeGreaterThan(MAX_NARRATIVE_CREDITS);
  });

  it('conserves: the seller receives exactly what the buyer paid', () => {
    const start = fresh();
    const out = purchase({ meridian: -3000, ojjul: 3000 });
    const paid = fac(start, 'meridian').credits - fac(out.state, 'meridian').credits;
    const got = fac(out.state, 'ojjul').credits - fac(start, 'ojjul').credits;
    expect(got).toBe(paid);
  });

  it('pays only what the buyer holds, and trims the receipt to match', () => {
    const start = fresh();
    const treasury = fac(start, 'meridian').credits;
    const out = purchase({ meridian: -(treasury * 10), ojjul: treasury * 10 });
    expect(fac(out.state, 'meridian').credits).toBe(0);
    expect(fac(out.state, 'ojjul').credits - fac(start, 'ojjul').credits).toBe(treasury);
  });

  it('drops a payment that pays nobody, the way a treaty flow is dropped', () => {
    const start = fresh();
    const out = purchase({ meridian: 3000, ojjul: 3000 });
    expect(fac(out.state, 'meridian').credits).toBe(fac(start, 'meridian').credits);
    expect(fac(out.state, 'ojjul').credits).toBe(fac(start, 'ojjul').credits);
  });
});
