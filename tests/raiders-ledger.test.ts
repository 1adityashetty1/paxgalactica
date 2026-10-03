import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  BOUNTY_MIN,
  BOUNTY_RESENTMENT,
  MAX_COMMISSION_SHARE,
  raidLandsOn,
} from '../src/domain/diplomacy.js';
import { brokeredAccords, proposeFor } from '../src/domain/initiative.js';
import { routeEarnings, runsBlockade } from '../src/domain/trade.js';
import { addShipsAt, ledgerFor, type WorldState } from '../src/domain/state.js';
import { groundInConcessions } from '../src/engine/turn.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * The raider's ledger (journal version 14): bounties in escrow, protection
 * bought from a raider, and letters of marque commissioning one.
 */

const calm = { randomEvents: false };
const regard = (s: WorldState, from: string, toward: string) =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;
const credits = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;
const post = (s: WorldState, by: string, target: string, amount: number) =>
  applyOps(s, [{ op: 'post_bounty', targetFactionId: target, credits: amount } as OpInput], 'model', by);
const contract = (s: WorldState, parties: [string, string], terms: Record<string, unknown>) =>
  applyOps(
    s,
    [{ op: 'form_treaty', treatyType: 'contract', parties, terms, summary: 'a deal' } as OpInput],
    'extraction',
    parties[0],
    true,
  );

/** Drajk raiding Oridin, the Combine's junction, with the raid under way. */
function raiding(s = createSeedState('meridian')): WorldState {
  const raid = proposeFor(s, 'drajk')!.ops.find((o) => o.type === 'commerce_raiding')!;
  s = applyOps(s, [raid], 'model', 'drajk').state;
  return tickTurn(s, calm).state;
}

describe('a bounty', () => {
  it('goes into escrow, and the target resents whoever priced it', () => {
    const s = createSeedState('meridian');
    const out = post(s, 'meridian', 'vigil', 300);
    expect(out.rejections).toEqual([]);
    expect(credits(out.state, 'meridian')).toBe(credits(s, 'meridian') - 300);
    expect(out.state.bounties.at(-1)).toMatchObject({ postedBy: 'meridian', targetFactionId: 'vigil', pool: 300, status: 'open' });
    expect(regard(out.state, 'vigil', 'meridian')).toBe(Math.max(-100, regard(s, 'vigil', 'meridian') - BOUNTY_RESENTMENT));
    expect(out.state.eventLog.at(-1)!.visibleTo).toBeNull();
  });

  it('tops up rather than posting twice, and the insult is not repeated', () => {
    const once = post(createSeedState('meridian'), 'meridian', 'vigil', 100).state;
    const twice = post(once, 'meridian', 'vigil', 50).state;
    expect(twice.bounties).toHaveLength(1);
    expect(twice.bounties[0]!.pool).toBe(150);
    expect(regard(twice, 'vigil', 'meridian')).toBe(regard(once, 'vigil', 'meridian'));
  });

  it('is trimmed to what the treasury holds, and has a floor', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'drajk')!.credits = 80;
    expect(post(s, 'drajk', 'vigil', 500).state.bounties.at(-1)!.pool).toBe(80);
    s.factions.find((f) => f.id === 'drajk')!.credits = BOUNTY_MIN - 1;
    expect(post(s, 'drajk', 'vigil', 500).rejections[0]?.code).toBe('insufficient_credits');
  });

  it('can be withdrawn by its poster, and the grievance stays', () => {
    const s = post(createSeedState('meridian'), 'meridian', 'vigil', 200).state;
    const id = s.bounties[0]!.id;
    const withdraw = (who: string) => applyOps(s, [{ op: 'withdraw_bounty', bountyId: id } as OpInput], 'model', who);
    expect(withdraw('ojjul').rejections[0]?.message).toMatch(/Only/);
    const back = withdraw('meridian').state;
    expect(credits(back, 'meridian')).toBe(credits(s, 'meridian') + 200);
    expect(back.bounties[0]!.status).toBe('withdrawn');
    expect(regard(back, 'vigil', 'meridian')).toBe(regard(s, 'vigil', 'meridian'));
  });

  it('pays a raider out of escrow for the prizes it takes, credit for credit', () => {
    let s = raiding();
    const taken = routeEarnings(s).raidedFrom.drajk?.ojjul ?? 0;
    expect(taken).toBeGreaterThan(0);
    s = post(s, 'meridian', 'ojjul', 1000).state;
    // The ledger shows it as income, and the tick draws the escrow down by it.
    expect(ledgerFor(s, 'drajk').bounties).toBe(taken);
    const after = tickTurn(s, calm).state;
    expect(after.bounties[0]).toMatchObject({ pool: 1000 - taken, paidOut: taken });
  });

  it('never pays its own poster', () => {
    let s = raiding();
    s = post(s, 'drajk', 'ojjul', 100).state;
    expect(ledgerFor(s, 'drajk').bounties).toBe(0);
  });

  it('pays whoever destroys the target\'s hulls in battle', () => {
    const attack = (withBounty: boolean) => {
      let s = createSeedState('meridian');
      addShipsAt(s.systems.find((x) => x.id === 'tor-3')!, 'vigil', 30, 'battleship');
      if (withBounty) s = post(s, 'meridian', 'drajk', 2000).state;
      s = applyOps(
        s,
        [{ op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-3', targetId: 'tor-6', force: { battleship: 30 }, label: 'take Threx' } as OpInput],
        'model',
        'vigil',
      ).state;
      return tickTurn(s, calm).state;
    };
    const paid = attack(true).bounties[0]!.paidOut;
    expect(paid).toBeGreaterThan(0);
    expect(credits(attack(true), 'vigil') - credits(attack(false), 'vigil')).toBe(paid);
  });
});

describe('protection', () => {
  it('keeps the raider\'s raids and blockades off the power that pays for it', () => {
    let s = raiding();
    s = contract(s, ['ojjul', 'drajk'], { incomePerTurn: { ojjul: -20, drajk: 20 }, protection: ['ojjul'] }).state;
    expect(raidLandsOn(s.treaties, s.turn, 'drajk', 'ojjul')).toBe(false);
    expect(routeEarnings(s).raidedFrom.drajk?.ojjul ?? 0).toBe(0);
    expect(runsBlockade(s, 'ojjul', ['drajk'])).toBe(true);
    // And a bot keeps its word: no raid on the power it protects.
    const ops = proposeFor(s, 'drajk')?.ops ?? [];
    const raids = ops.filter((o) => o.type === 'commerce_raiding');
    expect(raids.every((o) => s.systems.find((x) => x.id === o.targetId)?.controllerFactionId !== 'ojjul')).toBe(true);
  });

  it('rides on a contract and names a party', () => {
    const s = createSeedState('meridian');
    const accord = applyOps(
      s,
      [{ op: 'form_treaty', treatyType: 'trade_accord', parties: ['ojjul', 'drajk'], terms: { protection: ['ojjul'] }, summary: 'x' } as OpInput],
      'extraction',
      'ojjul',
      true,
    );
    expect(accord.rejections[0]?.message).toMatch(/contract/);
    expect(contract(s, ['ojjul', 'drajk'], { protection: ['vigil'] }).rejections[0]?.message).toMatch(/did not sign/);
  });
});

describe('a letter of marque', () => {
  const marque = (s: WorldState, share = 25) =>
    contract(s, ['ojjul', 'drajk'], {
      incomePerTurn: { ojjul: -10, drajk: 10 },
      commission: { raider: 'drajk', against: ['vigil'], share },
    });

  it('stops the raider raiding its paymaster', () => {
    const s = marque(raiding()).state;
    expect(raidLandsOn(s.treaties, s.turn, 'drajk', 'ojjul')).toBe(false);
    expect(routeEarnings(s).raidedFrom.drajk?.ojjul ?? 0).toBe(0);
  });

  it('pays its share of what is taken from the named enemy, out of the paymaster\'s treasury', () => {
    // Drajk raids Vantic, the Vigil's, from Threx next door.
    let s = createSeedState('meridian');
    s = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding', originId: 'tor-3', targetId: 'tor-3', durationTurns: 3, label: 'raid Vantic' } as OpInput],
      'model',
      'drajk',
    ).state;
    s = tickTurn(s, calm).state;
    s = marque(s).state;
    const taken = routeEarnings(s).raidedFrom.drajk?.vigil ?? 0;
    expect(taken).toBeGreaterThan(0);
    const out = tickTurn(s, calm);
    expect(out.notes.join('\n')).toMatch(new RegExp(`pays Drajk Confederacy ${Math.floor((taken * 25) / 100)} on its letter of marque`));
  });

  it('names powers outside the contract, and its share is trimmed', () => {
    const s = createSeedState('meridian');
    expect(
      contract(s, ['ojjul', 'drajk'], { commission: { raider: 'drajk', against: ['ojjul'], share: 10 } }).rejections[0]?.message,
    ).toMatch(/outside the contract/);
    const trimmed = marque(s, 80).state;
    expect(trimmed.treaties.at(-1)!.terms.commission!.share).toBe(MAX_COMMISSION_SHARE);
  });
});

describe('agreed in a channel', () => {
  it('protection binding the other power needs it to have conceded something', () => {
    const s = createSeedState('meridian');
    const op = {
      op: 'form_treaty', treatyType: 'contract', parties: ['meridian', 'drajk'],
      terms: { incomePerTurn: { meridian: -20, drajk: 20 }, protection: ['meridian'] }, summary: 'x',
    };
    expect(groundInConcessions(s, [op], [], 'drajk').ops).toEqual([]);
  });
});

describe('the bots', () => {
  it('commission a raider they like against a power they hate', () => {
    const accords = brokeredAccords(createSeedState('freeworlds'));
    const letter = accords.find((a) => a.label === 'marque:ojjul:drajk');
    expect(letter).toBeDefined();
    expect((letter!.ops[0] as { terms: { commission: unknown } }).terms.commission).toMatchObject({ raider: 'drajk', against: ['vigil'] });
  });

  it('buy protection from a raider they are not at war with', () => {
    const s = raiding(createSeedState('freeworlds'));
    // No grudge deep enough to commission anybody, so the Combine buys instead.
    for (const id of Object.keys(s.factions.find((f) => f.id === 'ojjul')!.disposition)) {
      s.factions.find((f) => f.id === 'ojjul')!.disposition[id] = Math.max(-10, regard(s, 'ojjul', id));
    }
    const deal = brokeredAccords(s).find((a) => a.label === 'protection:ojjul:drajk');
    expect(deal).toBeDefined();
    expect((deal!.ops[0] as { terms: { protection: string[] } }).terms.protection).toEqual(['ojjul']);
  });

  it('post a bounty on an enemy out of a full treasury', () => {
    const s = createSeedState('freeworlds');
    s.factions.find((f) => f.id === 'meridian')!.disposition.vigil = -90;
    s.factions.find((f) => f.id === 'vigil')!.disposition.meridian = -90;
    const ops = proposeFor(s, 'meridian')?.ops ?? [];
    expect(ops.find((o) => o.op === 'post_bounty')).toMatchObject({ targetFactionId: 'vigil' });
  });
});
