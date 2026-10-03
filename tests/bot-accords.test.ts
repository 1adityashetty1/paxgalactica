import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  BOT_PEACE_TURNS,
  BOT_SABOTEUR_RESERVE,
  EXCHANGE_STANDING,
  brokeredAccords,
  proposeFor,
} from '../src/domain/initiative.js';
import { isCommodity, truceBetween } from '../src/domain/diplomacy.js';
import { ENVOYS_QUIET_TURNS } from '../src/domain/events.js';
import { warsFor, type WorldState } from '../src/domain/state.js';

/**
 * What the bots do with the mechanics of journal version 12: trade their goods
 * with a power on good terms, make peace in a war gone quiet, and wage the
 * covert half of a war — wrecking an enemy's fixtures and mending their own.
 */

const calm = { randomEvents: false };
const tick = (s: WorldState, n = 1): WorldState => {
  for (let i = 0; i < n; i++) s = tickTurn(s, calm).state;
  return s;
};
const setRegard = (s: WorldState, from: string, toward: string, v: number) => {
  s.factions.find((f) => f.id === from)!.disposition[toward] = v;
};
const apply = (s: WorldState) => {
  for (const accord of brokeredAccords(s)) s = applyOps(s, accord.ops, 'engine', undefined, true).state;
  return s;
};

describe('an exchange of goods', () => {
  it('runs between two powers on good terms, each handing over its own stock', () => {
    // The Combine and the Confederacy open at 35 and 40; a tick makes the goods.
    const s = tick(createSeedState('meridian'));
    const accords = brokeredAccords(s).filter((a) => a.label.startsWith('exchange'));
    expect(accords.map((a) => a.parties)).toEqual([['drajk', 'ojjul']]);
    const after = apply(s);
    const held = (maker: string) => after.assets.find((a) => isCommodity(a) && a.issuedBy === maker)!.heldBy;
    expect(held('drajk')).toBe('ojjul');
    expect(held('ojjul')).toBe('drajk');
  });

  it('needs both to think well of the other — it is a trade, never a gift', () => {
    const s = tick(createSeedState('meridian'));
    setRegard(s, 'ojjul', 'drajk', EXCHANGE_STANDING - 1);
    expect(brokeredAccords(s).filter((a) => a.label.startsWith('exchange'))).toEqual([]);
  });

  it('trades each power with one partner a turn, its best', () => {
    const s = tick(createSeedState('meridian'));
    setRegard(s, 'drajk', 'freeworlds', 90);
    setRegard(s, 'freeworlds', 'drajk', 90);
    const pairs = brokeredAccords(s)
      .filter((a) => a.label.startsWith('exchange'))
      .map((a) => a.parties);
    expect(pairs).toEqual([['drajk', 'freeworlds']]);
  });

  it('never involves the player, whose trades are made in a channel', () => {
    const s = tick(createSeedState('ojjul'));
    expect(brokeredAccords(s).some((a) => a.parties.includes('ojjul'))).toBe(false);
  });
});

describe('a peace in a war gone quiet', () => {
  /** Meridian and the Combine at war, with nothing between them for a while. */
  const quietWar = (): WorldState => {
    const s = createSeedState('freeworlds');
    setRegard(s, 'meridian', 'ojjul', -80);
    setRegard(s, 'ojjul', 'meridian', -80);
    s.turn = ENVOYS_QUIET_TURNS;
    return s;
  };

  it('is a ceasefire that leaves a truce', () => {
    const s = quietWar();
    expect(warsFor(s, 'meridian')).toContain('ojjul');
    const peace = brokeredAccords(s).find((a) => a.label === 'peace:meridian:ojjul');
    expect(peace).toBeDefined();
    const after = apply(s);
    const t = after.treaties.find((x) => x.type === 'ceasefire')!;
    expect(t.expiresTurn).toBe(s.turn + BOT_PEACE_TURNS);
    expect(truceBetween(after.truces, after.turn, 'meridian', 'ojjul')).toBeDefined();
    expect(warsFor(after, 'meridian')).not.toContain('ojjul');
  });

  it('waits for the war to go quiet', () => {
    const s = quietWar();
    s.lastClash = { [['meridian', 'ojjul'].sort().join('|')]: s.turn - 1 };
    expect(brokeredAccords(s).some((a) => a.label.startsWith('peace'))).toBe(false);
  });

  it('is not made while either has a fleet under way at the other', () => {
    const s = quietWar();
    const target = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    s.pendingOrders.push({
      id: 'ord-x', factionId: 'meridian', type: 'fleet_movement', originId: target.id, targetId: target.id,
      durationTurns: 2, progress: 0, interruptible: true, officers: [], onInterrupt: 'cancel', visibility: [],
      label: 'strike', durationRationale: '', path: [], force: {}, investedCredits: 0,
    });
    expect(brokeredAccords(s).some((a) => a.label.startsWith('peace'))).toBe(false);
  });

  it('is not made where a power\'s own compulsions bar it', () => {
    // The Vigil and the Confederacy open at war, and the Vigil's sheet will
    // entertain no accommodation with pirates.
    const s = createSeedState('meridian');
    s.turn = ENVOYS_QUIET_TURNS * 3;
    expect(warsFor(s, 'vigil')).toContain('drajk');
    expect(brokeredAccords(s).some((a) => a.label === 'peace:drajk:vigil')).toBe(false);
  });
});

describe('the covert half of a war', () => {
  it('sends a saboteur at an enemy\'s fixtures, recruited and sent in one batch', () => {
    // The Vigil is at war with Drajk, whose plant stands at Tulgarn.
    const s = createSeedState('meridian');
    const ops = proposeFor(s, 'vigil')!.ops;
    const recruit = ops.find((o) => o.op === 'recruit_agent');
    const sent = ops.find((o) => o.op === 'deploy_agent');
    expect(recruit).toBeDefined();
    expect(sent).toMatchObject({ mission: 'sabotage', effect: { kind: 'fixture_damage' } });
    const out = applyOps(s, ops, 'model', 'vigil');
    expect(out.state.agents.some((a) => a.ownerFactionId === 'vigil' && a.mission === 'sabotage')).toBe(true);
  });

  it('keeps a reserve, so covert war never eats the navy\'s money', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'vigil')!.credits = BOT_SABOTEUR_RESERVE - 1;
    const ops = proposeFor(s, 'vigil')?.ops ?? [];
    expect(ops.some((o) => o.op === 'deploy_agent' && o.mission === 'sabotage')).toBe(false);
  });

  it('is not waged on a power it is not at war with', () => {
    const s = createSeedState('meridian');
    // Meridian is at war with nobody on the opening board.
    expect(warsFor(s, 'meridian')).toEqual([]);
    expect((proposeFor(s, 'meridian')?.ops ?? []).some((o) => o.op === 'deploy_agent' && o.mission === 'sabotage')).toBe(false);
  });

  it('mends what a saboteur broke', () => {
    const s = createSeedState('meridian');
    s.assets.find((a) => a.kind === 'power_plant')!.damage = 2;
    const ops = proposeFor(s, 'drajk')?.ops ?? [];
    expect(ops.find((o) => (o.onComplete as { kind?: string } | undefined)?.kind === 'repair_fixture')).toMatchObject({
      targetId: 'ark-5',
      onComplete: { kind: 'repair_fixture', magnitude: 2, fixtureKind: 'power_plant' },
    });
  });
});

describe('the leverage the bots reach for', () => {
  it('a power whose doctrine takes money demands tribute of a neighbour it outguns', () => {
    const s = createSeedState('freeworlds');
    // Pile the Combine's fleet high enough that a neighbour must give way.
    const home = s.systems.filter((x) => x.controllerFactionId === 'ojjul').sort((a, b) => b.strategicValue - a.strategicValue)[0]!;
    home.ships.ojjul = { ...(home.ships.ojjul ?? {}), battleship: 200 };
    const ops = proposeFor(s, 'ojjul')?.ops ?? [];
    expect(ops.find((o) => o.op === 'issue_ultimatum')).toMatchObject({ demand: 'tribute', deadlineTurns: 3 });
  });

  it('the Vigil does not: being bought is the insult, and tribute is that', () => {
    const s = createSeedState('freeworlds');
    const home = s.systems.filter((x) => x.controllerFactionId === 'vigil')[0]!;
    home.ships.vigil = { ...(home.ships.vigil ?? {}), battleship: 200 };
    expect((proposeFor(s, 'vigil')?.ops ?? []).some((o) => o.op === 'issue_ultimatum')).toBe(false);
  });

  it('keeps a watcher on the power it trusts least', () => {
    const s = createSeedState('freeworlds');
    const ops = proposeFor(s, 'meridian')?.ops ?? [];
    const sent = ops.find((o) => o.op === 'deploy_agent' && o.mission === 'surveillance');
    expect(sent).toBeDefined();
    // Meridian trusts the Vigil least on the opening board (−55).
    expect(s.systems.find((x) => x.id === sent!.systemId)!.controllerFactionId).toBe('vigil');
  });

  it('publishes proof against an enemy and blackmails anyone else with it', () => {
    const s = createSeedState('freeworlds');
    const file = (subject: string) => ({
      id: `ast-p-${subject}`, kind: 'dossier', text: 'proof', heldBy: 'vigil', quantity: 1, unit: 'file',
      commanderId: null, agentId: null, divisible: false, valuePerUnit: {}, speculative: false, valueRange: {},
      uses: null, atSystemId: null, portable: true, yield: null, acquiredTurn: 0,
      secret: { kind: 'default' as const, subject, ref: 'x' },
    });
    // A live default: Drajk is delinquent on its debt to the Combine.
    const debt = s.debts.find((d) => d.debtorFactionId === 'drajk')!;
    expect(debt.status).toBe('delinquent');
    s.assets.push({ ...file('drajk'), secret: { kind: 'default', subject: 'drajk', ref: debt.id } });
    const ops = proposeFor(s, 'vigil')?.ops ?? [];
    // The Vigil is at war with Drajk.
    expect(ops.find((o) => o.assetId === 'ast-p-drajk')?.op).toBe('publish_dossier');
  });
});
