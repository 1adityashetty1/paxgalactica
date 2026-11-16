import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { runBalance } from '../src/balance.js';
import type { WorldState } from '../src/domain/state.js';
import { TreatySchema, type Treaty } from '../src/domain/diplomacy.js';
import {
  machinesOf,
  OFFICER_MOVES,
  reachable,
  TREATY_MOVES,
  transitionViolations,
  watchMachines,
  worldViolations,
} from '../src/domain/transitions.js';

const seed = () => createSeedState('meridian');
const later = (s: WorldState): WorldState => ({ ...structuredClone(s), turn: s.turn + 1 });
const moved = (before: WorldState, after: WorldState) => transitionViolations(machinesOf(before), machinesOf(after));

const treaty = (s: WorldState, id: string, status: Treaty['status']) => {
  s.treaties.push(TreatySchema.parse({ id, type: 'non_aggression', parties: ['meridian', 'vigil'], terms: {}, signedTurn: s.turn, status }));
};

describe('the lifecycles', () => {
  it('reach through any number of steps and never out of a terminal status', () => {
    expect(reachable(TREATY_MOVES, 'pending', 'expired')).toBe(true);
    expect(reachable(TREATY_MOVES, 'broken', 'active')).toBe(false);
    expect(reachable(OFFICER_MOVES, 'captured', 'active')).toBe(true);
    expect(reachable(OFFICER_MOVES, 'listed', 'lost')).toBe(true);
    expect(reachable(OFFICER_MOVES, 'lost', 'listed')).toBe(false);
  });
});

describe('one world', () => {
  it('finds nothing wrong with the opening board', () => {
    expect(worldViolations(seed())).toEqual([]);
  });

  it('catches a record twice, a regard for oneself, and a seat held twice', () => {
    const s = seed();
    s.debts.push({ ...s.debts[0]! });
    s.factions[0]!.disposition[s.factions[0]!.id] = 10;
    const seated = s.notables.filter((n) => n.systemId !== null);
    seated[1]!.systemId = seated[0]!.systemId;
    seated[1]!.seat = seated[0]!.seat;
    const found = worldViolations(s);
    expect(found).toContain(`debt ${s.debts[0]!.id} appears twice`);
    expect(found).toContain(`${s.factions[0]!.id} holds a regard for itself`);
    expect(found.some((v) => v.includes(`both hold seat ${seated[0]!.seat} at ${seated[0]!.systemId}`))).toBe(true);
  });

  it('catches two live truces between one pair, and one past its last turn', () => {
    const s = seed();
    const truce = { parties: ['meridian', 'vigil'], treatyId: 'trt-x', signedTurn: 0, untilTurn: 8, status: 'active' as const };
    s.truces.push(truce, { ...truce, treatyId: 'trt-y' });
    expect(worldViolations(s)).toContain('2 truces hold between meridian and vigil');
    s.truces = [{ ...truce, untilTurn: 0 }];
    expect(worldViolations(s).some((v) => v.startsWith('the truce between meridian and vigil is active on turn 0'))).toBe(true);
  });

  it('catches a live debt owing nothing, an empty open bounty and an order past its term', () => {
    const s = seed();
    s.debts[0]!.balance = 0;
    s.bounties.push({ id: 'bnt-x', postedBy: 'meridian', targetFactionId: 'drajk', pool: 0, paidOut: 0, postedTurn: 0, status: 'open', note: '' });
    s.pendingOrders.push({
      id: 'ord-x', factionId: 'meridian', type: 'fortification', originId: 'sek-4', targetId: 'sek-4', durationTurns: 3, progress: 4,
    } as WorldState['pendingOrders'][number]);
    const found = worldViolations(s);
    expect(found).toContain('order ord-x is 4 of 3 turns along');
    expect(found).toContain(`debt ${s.debts[0]!.id} is ${s.debts[0]!.status} with nothing owed`);
    expect(found).toContain('bounty bnt-x is open with an empty pool');
  });

  it('catches two fixtures of one kind on a world, and damage past the budget', () => {
    const s = seed();
    const fixture = s.assets.find((a) => !a.portable && a.yield?.kind === 'stat')!;
    s.assets.push({ ...fixture, id: 'ast-x' });
    fixture.damage = 9;
    const found = worldViolations(s);
    expect(found).toContain(`${fixture.atSystemId} carries two fixtures of one kind`);
    expect(found.some((v) => v.startsWith(`fixture ${fixture.id} has 9 damage`))).toBe(true);
  });
});

describe('two worlds', () => {
  it('lets a treaty go live, lapse and break, and never come back', () => {
    const a = seed();
    treaty(a, 'trt-p', 'pending');
    const b = later(a);
    b.treaties.find((t) => t.id === 'trt-p')!.status = 'active';
    expect(moved(a, b)).toEqual([]);
    const c = later(b);
    c.treaties.find((t) => t.id === 'trt-p')!.status = 'broken';
    expect(moved(b, c)).toEqual([]);
    const d = later(c);
    d.treaties.find((t) => t.id === 'trt-p')!.status = 'active';
    expect(moved(c, d)).toEqual(['treaty trt-p went from broken to active']);
  });

  it('keeps the lost lost, the settled settled, and every debt on the books', () => {
    const a = seed();
    const officer = a.commanders.find((c) => c.status === 'active')!;
    officer.status = 'lost';
    officer.atSystemId = null;
    a.debts[0]!.status = 'settled';
    a.debts[0]!.balance = 0;
    const b = later(a);
    b.commanders.find((c) => c.id === officer.id)!.status = 'active';
    b.debts[0]!.status = 'current';
    b.debts.splice(1, 1);
    expect(moved(a, b)).toEqual(
      expect.arrayContaining([
        `debt ${a.debts[1]!.id} was ${a.debts[1]!.status} and is gone`,
        `debt ${a.debts[0]!.id} went from settled to current`,
        `officer ${officer.id} went from lost to active`,
      ]),
    );
  });

  it('allows a captured officer home, and a defaulted loan made good', () => {
    const a = seed();
    const officer = a.commanders.find((c) => c.status === 'active')!;
    officer.status = 'captured';
    a.loans.push({
      id: 'lon-x',
      lenderFactionId: 'meridian',
      borrowerFactionId: 'drajk',
      lent: { kind: 'credits', amount: 100 },
      outstanding: null,
      rentPerTurn: 5,
      dueTurn: 3,
      status: 'defaulted',
      missedPayments: 1,
      establishedTurn: 0,
    } as WorldState['loans'][number]);
    const b = later(a);
    b.commanders.find((c) => c.id === officer.id)!.status = 'listed';
    b.loans[b.loans.length - 1]!.status = 'returned';
    expect(moved(a, b)).toEqual([]);
    const c = later(b);
    c.loans[c.loans.length - 1]!.status = 'current';
    expect(moved(b, c)).toEqual(['loan lon-x went from returned to current']);
  });

  it('holds fixed facts fixed: who a treaty binds, where a fixture stands, which estate a notable serves', () => {
    const a = seed();
    treaty(a, 'trt-f', 'active');
    const b = later(a);
    b.treaties.find((t) => t.id === 'trt-f')!.parties = ['meridian', 'drajk'];
    const fixture = b.assets.find((f) => !f.portable)!;
    const elsewhere = b.systems.find((s) => s.id !== fixture.atSystemId)!.id;
    fixture.atSystemId = elsewhere;
    const notable = b.notables.find((n) => n.estateId !== null)!;
    const other = b.factions.flatMap((f) => f.estates ?? []).find((e) => e.id !== notable.estateId)!;
    const was = notable.estateId;
    notable.estateId = other.id;
    expect(moved(a, b)).toEqual(
      expect.arrayContaining([
        'treaty trt-f changed from non_aggression meridian~vigil to non_aggression drajk~meridian',
        expect.stringContaining(`fixture ${fixture.id} moved from`),
        `notable ${notable.id} moved from ${was} to ${other.id}`,
      ]),
    );
  });

  it('lets an independent notable take an estate when its world joins, and give it up when it rises', () => {
    const a = seed();
    const notable = a.notables.find((n) => n.estateId === null && n.systemId !== null)!;
    const b = later(a);
    b.notables.find((n) => n.id === notable.id)!.estateId = b.factions[0]!.estates![0]!.id;
    expect(moved(a, b)).toEqual([]);
    const c = later(b);
    c.notables.find((n) => n.id === notable.id)!.estateId = null;
    expect(moved(b, c)).toEqual([]);
  });

  it('never lets an order that ended come back, or one still running run backwards', () => {
    const w = watchMachines();
    const a = seed();
    const order = {
      id: 'ord-x',
      factionId: 'meridian',
      type: 'fortification',
      originId: 'sek-4',
      targetId: 'sek-4',
      durationTurns: 3,
      progress: 1,
    } as WorldState['pendingOrders'][number];
    a.pendingOrders = [order];
    expect(w.step(a)).toEqual([]);
    const b = later(a);
    b.pendingOrders[0]!.progress = 0;
    expect(w.step(b)).toContain('order ord-x ran back from 1 to 0');
    const c = later(b);
    c.pendingOrders = [];
    expect(w.step(c)).toEqual([]);
    const d = later(c);
    d.pendingOrders = [structuredClone(order)];
    expect(w.step(d)).toContain('order ord-x ended and is back');
  });
});

describe('the spine', () => {
  it('holds over sixty turns of the bots, every machine and every person', () => {
    const w = watchMachines();
    const broken: string[] = [];
    runBalance(60, (snap, state) => {
      for (const v of w.step(state)) broken.push(`turn ${snap.turn}: ${v}`);
    });
    expect(broken).toEqual([]);
  }, 60_000);
});
