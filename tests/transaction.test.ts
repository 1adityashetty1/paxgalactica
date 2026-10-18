import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import type { OpInput } from '../src/domain/ops.js';
import { createSeedState } from '../src/seed/scenario.js';
import { fleetStrengthOf, setStackAt, stackAt } from '../src/domain/state.js';
import { hullsIn, subtractStack, type ShipStack } from '../src/domain/hulls.js';
import { maxCommitmentIncomeFor } from '../src/domain/state.js';
import { MAX_COMMITMENT_INCOME } from '../src/domain/arbitration.js';
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
    // The playtest's shape: one action asking three times, each ask
    // individually inside the cap.
    const ask = { op: 'suborn_crews', factionId: 'meridian', fromFactionId: 'ojjul', systemId: at, count: limit } as OpInput;
    const out = applyOps(state, [ask, ask, ask], 'model', 'meridian');
    const turned = before - hullsAt(sys(out.state, at), 'ojjul');
    expect(turned).toBe(limit);
  });

  it('gives one declaration one allowance of narrative money', () => {
    // Charges, because a windfall no longer lands at all: money written into a
    // treasury needs a payer, and saying it three times names no more payers
    // than saying it once. The allowance is still the BATCH's.
    const state = fresh();
    const before = fac(state, 'meridian').credits;
    const out = applyOps(
      state,
      [
        { op: 'adjust_credits', factionId: 'meridian', delta: -MAX_NARRATIVE_CREDITS },
        { op: 'adjust_credits', factionId: 'meridian', delta: -MAX_NARRATIVE_CREDITS },
        { op: 'adjust_credits', factionId: 'meridian', delta: -MAX_NARRATIVE_CREDITS },
      ],
      'model',
      'meridian',
    );
    expect(before - fac(out.state, 'meridian').credits).toBe(MAX_NARRATIVE_CREDITS);
  });
});

describe('a price is charged once', () => {
  it('refunds a narrative charge the yards had already billed', () => {
    // The measured case: `commissions 80 tons for 1200` with a freeform 510
    // riding alongside, trimmed to 240 and applied anyway — 1,440 for 1,200.
    const withBoth = applyOps(
      fresh(),
      [
        { op: 'build_ships', factionId: 'meridian', count: 10, hull: 'battleship' } as OpInput,
        { op: 'adjust_credits', factionId: 'meridian', delta: -510 },
      ],
      'model',
      'meridian',
    );
    const yardsOnly = applyOps(
      fresh(),
      [{ op: 'build_ships', factionId: 'meridian', count: 10, hull: 'battleship' } as OpInput],
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
          treatyType: 'cession',
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

describe('an accord can move money between the parties', () => {
  const settle = (movement: Record<string, number>, source: 'extraction' | 'model' = 'extraction') => {
    const start = fresh();
    const ops = Object.entries(movement).map(([factionId, delta]) => ({
      op: 'adjust_credits', factionId, delta,
    }));
    const out = applyOps(start, ops as never, source, 'meridian');
    return {
      out,
      moved: (id: string) => fac(out.state, id).credits - fac(start, id).credits,
      held: (id: string) => fac(start, id).credits,
    };
  };

  it('debits the payer and credits the payee, past the narrative ceiling', () => {
    // The measured case: Arkane agreed a 450-credit settlement, the creditor's
    // debit was refused by the "cannot take credits out of another treasury"
    // guard, and both sides left believing the money had moved. That guard is
    // right for a DECLARED action and wrong for an accord — extraction is the
    // one pass that has read a transcript.
    const { out, moved } = settle({ ojjul: -450, meridian: 450 });
    expect(out.rejections).toHaveLength(0);
    expect(moved('meridian')).toBe(450);
    expect(moved('ojjul')).toBe(-450);
    // Uncapped on purpose: a transfer cannot invent a credit, so what needs
    // guarding is its conservation, not its size.
    expect(moved('meridian')).toBeGreaterThan(MAX_NARRATIVE_CREDITS);
  });

  it('still refuses a declared action reaching into another treasury', () => {
    const { out, moved } = settle({ ojjul: -450, meridian: 450 }, 'model');
    expect(out.rejections.some((r) => r.code === 'illegal_value')).toBe(true);
    expect(moved('ojjul')).toBe(0);
  });

  it('drops a settlement nobody is paying', () => {
    // Both positive is money from nowhere — the same ruling `incomePerTurn`
    // and `terms.payment` get, and dropped rather than flipped because which
    // party to flip is a coin toss.
    const { moved } = settle({ ojjul: 450, meridian: 450 });
    expect(moved('meridian')).toBe(0);
    expect(moved('ojjul')).toBe(0);
  });

  it('pays only what the payer holds, and trims the receipt to match', () => {
    const start = fresh();
    const purse = fac(start, 'drajk').credits;
    const { moved } = settle({ drajk: -(purse * 10), meridian: purse * 10 });
    expect(moved('drajk')).toBe(-purse);
    expect(moved('meridian')).toBe(purse);
  });
});

describe('a commitment says when its yield will not be paid', () => {
  it('warns at signature that the influence ceiling will withhold it', () => {
    // Two ceilings compound and only one of them ever spoke. `ledgerFor` caps
    // total commitment earnings by `maxCommitmentIncomeFor` at READ time, so it
    // produces no note by construction: 60 agreed, trimmed to 25 here, paid 10,
    // and the negotiating party told of neither step.
    const state = fresh();
    const ceiling = maxCommitmentIncomeFor(state, 'drajk');
    const out = applyOps(
      state,
      [{
        op: 'establish_commitment', kind: 'war_chest_stipend', factionIds: ['drajk'],
        text: 'a stipend', exclusive: false, incomePerTurn: ceiling + MAX_COMMITMENT_INCOME,
      }] as never,
      'extraction',
      'drajk',
    );
    // Once. Two blocks used to answer this in different words (item 116).
    const said = out.notes.filter((n) => /a turn from standing arrangements/.test(n));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/can draw at most \d+ a turn from standing arrangements/);
  });

  it('measures the ceiling on gross earnings, as ledgerFor does', () => {
    // A cost the power has agreed to pay makes no room under the ceiling,
    // because `commitmentIncomeFor` caps what is EARNED and adds what is owed
    // afterwards. The note has to read the same figure the ledger caps.
    const state = fresh();
    const ceiling = maxCommitmentIncomeFor(state, 'drajk');
    state.commitments.push(...([
      { id: 'com-earn', kind: 'charter', factionIds: ['drajk'], text: 'earns', exclusive: false, incomePerTurn: ceiling, contingencies: [], establishedTurn: 0, status: 'active' },
      { id: 'com-owe', kind: 'levy', factionIds: ['drajk'], text: 'owes', exclusive: false, incomePerTurn: -2 * ceiling, contingencies: [], establishedTurn: 0, status: 'active' },
    ] as never[]));
    const out = applyOps(
      state,
      [{
        op: 'establish_commitment', kind: 'small_stipend', factionIds: ['drajk'],
        text: 'a stipend', exclusive: false, incomePerTurn: 1,
      }] as never,
      'extraction',
      'drajk',
    );
    expect(out.notes.join(' ')).toMatch(/worth 0 to it rather than 1/);
  });

  it('says nothing when the arrangement fits under the ceiling', () => {
    const out = applyOps(
      fresh(),
      [{
        op: 'establish_commitment', kind: 'small_charter', factionIds: ['meridian'],
        text: 'a charter', exclusive: false, incomePerTurn: 1,
      }] as never,
      'extraction',
      'meridian',
    );
    expect(out.notes.join(' ')).not.toMatch(/can draw/);
  });
});
/**
 * The event log is the one part of the world a batch can only append to, and it
 * is 61% of what `clone` copies. Sharing the entries is safe exactly while
 * nothing edits one in place — so that is what this asserts, rather than the
 * timing, which is not a property a test should own.
 */
describe('cloning a world shares the log it cannot change', () => {
  it('does not let a batch reach the caller world', () => {
    const s = createSeedState('meridian');
    const before = s.eventLog.length;
    const res = applyOps(
      s,
      [{ op: 'log_narrative', text: 'A courier arrives.' }],
      'model',
      'meridian',
    );
    expect(res.state.eventLog.length).toBe(before + 1);
    // `applyOps` never mutates its input — the array is copied even though its
    // entries are not.
    expect(s.eventLog.length).toBe(before);
  });

  it('never edits an existing entry, which is what makes sharing sound', () => {
    const s = createSeedState('meridian');
    s.eventLog.push({ turn: 0, kind: 'narrative', factionId: null, text: 'original', visibleTo: null });
    const mine = s.eventLog.at(-1)!;

    const res = applyOps(
      s,
      [{ op: 'log_narrative', text: 'and another' }],
      'model',
      'meridian',
    );
    // The entry survives unchanged in both worlds. If a future writer starts
    // editing entries in place instead of appending, this is where it shows up.
    expect(res.state.eventLog.find((e) => e.text === 'original')?.text).toBe('original');
    expect(mine.text).toBe('original');
  });
});
