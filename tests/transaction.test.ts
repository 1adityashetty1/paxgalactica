import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
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

describe('one squadron described twice is one squadron', () => {
  const build = (ops: unknown[]) => {
    const state = fresh();
    const before = fleetStrengthOf(state, 'meridian');
    const at = (w: WorldState, id: string) => stackAt(sys(w, id), 'meridian').lifter ?? 0;
    // Measured as a DELTA: the seed now opens every power with a doctrine-shaped
    // squadron, so Meridian already has transports at these worlds and an
    // absolute count would be asserting the seed rather than the reconciliation.
    const opening = new Map(['sek-1', 'sek-4'].map((id) => [id, at(state, id)]));
    const out = applyOps(state, ops as never, 'model', 'meridian');
    const lifters = (id: string) => at(out.state, id) - (opening.get(id) ?? 0);
    return { gained: fleetStrengthOf(out.state, 'meridian') - before, lifters };
  };

  // `adjust_fleet` commissions and bases at the best holding; `adjust_ships`
  // puts hulls at a named world. A model describing one squadron reaches for
  // both, and the reducer counted them as two — twice the hulls the narrative
  // claimed, and twice the bill. Same defect as 58/61/63 one field over.
  it('does not mint a second squadron when the placement names the base', () => {
    // Meridian's best holding IS sek-1, which is what made the first fix fail:
    // a "different system" guard skipped the relocation and still added.
    const { gained, lifters } = build([
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_ships', systemId: 'sek-1', factionId: 'meridian', delta: 6, hull: 'lifter' },
    ]);
    expect(gained).toBe(6);
    expect(lifters('sek-1')).toBe(6);
  });

  it('moves them when the placement names somewhere else', () => {
    const { gained, lifters } = build([
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_ships', systemId: 'sek-4', factionId: 'meridian', delta: 6, hull: 'lifter' },
    ]);
    expect(gained).toBe(6);
    expect(lifters('sek-4')).toBe(6);
    expect(lifters('sek-1')).toBe(0);
  });

  it('reconciles the other emission order too', () => {
    const { gained, lifters } = build([
      { op: 'adjust_ships', systemId: 'sek-4', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
    ]);
    expect(gained).toBe(6);
    expect(lifters('sek-4')).toBe(6);
  });

  it('delivers the surplus when the placement asks for more than was built', () => {
    const { gained } = build([
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_ships', systemId: 'sek-4', factionId: 'meridian', delta: 10, hull: 'lifter' },
    ]);
    expect(gained).toBe(10);
  });

  it('leaves two genuine programmes alone', () => {
    // Two `adjust_fleet` ops are two builds, not one described twice. The rule
    // must not make a fleet cheaper to buy by splitting the order.
    expect(build([
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
    ]).gained).toBe(12);
  });

  it('does not reconcile across hull classes', () => {
    expect(build([
      { op: 'adjust_fleet', factionId: 'meridian', delta: 6, hull: 'lifter' },
      { op: 'adjust_ships', systemId: 'sek-4', factionId: 'meridian', delta: 6, hull: 'escort' },
    ]).gained).toBe(12);
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
    expect(out.notes.join(' ')).toMatch(/can draw \d+ a turn from standing arrangements/);
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
 * A BARE `adjust_ships` PAIR IS A MOVE, NOT A REFIT.
 *
 * `-N` spends the loss order and `+N` mints the class named, which defaults to
 * `battleship`. So the obvious way to write a reposition — take six from here,
 * put six down there — scrapped six escorts at the origin and commissioned six
 * battleships at the destination. `billConstruction` charged the difference
 * correctly, which is exactly what made it hard to see: the money was right and
 * the fleet was wrong. The narrative said the squadron sailed and a different
 * squadron arrived.
 */
describe('a reposition keeps the fleet it moved', () => {
  /** Six escorts and two battleships at `originId`, an empty world at `destId`. */
  const mixed = (): { s: WorldState; originId: string; destId: string } => {
    const s = createSeedState('meridian');
    const [from, to] = s.systems.filter((x) => x.controllerFactionId === 'meridian');
    setStackAt(from!, 'meridian', { escort: 6, battleship: 2 });
    setStackAt(to!, 'meridian', {});
    return { s, originId: from!.id, destId: to!.id };
  };

  const at = (s: WorldState, id: string): ShipStack =>
    stackAt(s.systems.find((x) => x.id === id)!, 'meridian');

  it('lands exactly the hulls it lifted when no class was named', () => {
    const { s, originId, destId } = mixed();
    const before = at(s, originId);

    const res = applyOps(
      s,
      [
        { op: 'adjust_ships', systemId: originId, factionId: 'meridian', delta: -4 },
        { op: 'adjust_ships', systemId: destId, factionId: 'meridian', delta: 4 },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections).toEqual([]);

    // The property is not "four escorts arrived" — an unnamed removal takes
    // two battleships and then two escorts. It is that WHAT LEFT IS WHAT
    // ARRIVED. Before this, four battleships arrived whatever had left.
    const gone = subtractStack(before, at(res.state, originId));
    expect(at(res.state, destId)).toEqual(gone);
    expect(hullsIn(gone)).toBe(4);

    // And because nothing was built, nothing was billed.
    const paid =
      s.factions.find((f) => f.id === 'meridian')!.credits -
      res.state.factions.find((f) => f.id === 'meridian')!.credits;
    expect(paid).toBe(0);
  });

  it('still obeys an explicitly named class', () => {
    // The pool must never override an op that said what it wanted. `hull` is
    // read off the raw op precisely so "the model asked for battleships" is
    // distinguishable from "the model said nothing".
    const { s, originId, destId } = mixed();
    const res = applyOps(
      s,
      [
        { op: 'adjust_ships', systemId: originId, factionId: 'meridian', delta: -2, hull: 'escort' },
        { op: 'adjust_ships', systemId: destId, factionId: 'meridian', delta: 2, hull: 'battleship' },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections).toEqual([]);
    expect(at(res.state, destId)).toEqual({ battleship: 2 });
  });

  it('bills only the surplus past what was lifted', () => {
    const { s, originId, destId } = mixed();
    const res = applyOps(
      s,
      [
        { op: 'adjust_ships', systemId: originId, factionId: 'meridian', delta: -2, hull: 'escort' },
        { op: 'adjust_ships', systemId: destId, factionId: 'meridian', delta: 5 },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections).toEqual([]);
    // Two escorts moved; three battleships past them are a genuine build.
    expect(at(res.state, destId)).toEqual({ escort: 2, battleship: 3 });
  });

  it('lets a suborned crew keep the hull it was standing on', () => {
    // Turning three escorts used to deliver three battleships — paid for at
    // battleship rates, so never free, but not what was turned either, and the
    // opposite of what CLAUDE.md says about pricing a defection by class.
    const s = createSeedState('ojjul');
    const host = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    setStackAt(host, 'meridian', { escort: 4 });
    setStackAt(host, 'ojjul', { battleship: 1 });
    expect(subornLimit(s, 'ojjul', 'meridian')).toBeGreaterThanOrEqual(2);

    const res = applyOps(
      s,
      [
        { op: 'adjust_ships', systemId: host.id, factionId: 'meridian', delta: -2 },
        { op: 'adjust_ships', systemId: host.id, factionId: 'ojjul', delta: 2 },
      ],
      'model',
      'ojjul',
    );
    expect(res.rejections).toEqual([]);
    const after = stackAt(res.state.systems.find((x) => x.id === host.id)!, 'ojjul');
    expect(after.escort).toBe(2);
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
