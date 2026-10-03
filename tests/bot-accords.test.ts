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
    expect(ops.some((o) => o.op === 'deploy_agent')).toBe(false);
  });

  it('is not waged on a power it is not at war with', () => {
    const s = createSeedState('meridian');
    // Meridian is at war with nobody on the opening board.
    expect(warsFor(s, 'meridian')).toEqual([]);
    expect((proposeFor(s, 'meridian')?.ops ?? []).some((o) => o.op === 'deploy_agent')).toBe(false);
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
