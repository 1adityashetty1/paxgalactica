import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, INTERDICTION_DISPOSITION_COST, tickTurn } from '../src/domain/reducer.js';
import { DARK_PROOF_TURNS } from '../src/domain/diplomacy.js';
import { secretLive } from '../src/domain/leverage.js';
import { observeOrders } from '../src/domain/intel.js';
import { proposeFor } from '../src/domain/initiative.js';
import { DARK_RAID_YIELD, routeEarnings } from '../src/domain/trade.js';
import { addShipsAt, type WorldState } from '../src/domain/state.js';
import { briefingFromState } from '../src/engine/briefing.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Running dark: a raid whose owner nobody else is told, whose costs are owed
 * rather than charged, which takes half the prizes, and which each power it
 * robs may trace — and then holds proof of.
 */

const calm = { randomEvents: false };
const regard = (s: WorldState, from: string, toward: string) =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;

/** Drajk raiding Oridin, the Combine's, under way. */
function raiding(dark: boolean): WorldState {
  let s = createSeedState('meridian');
  const raid = { ...proposeFor(s, 'drajk')!.ops.find((o) => o.type === 'commerce_raiding')!, dark };
  s = applyOps(s, [raid], 'model', 'drajk').state;
  return tickTurn(s, calm).state;
}
const raidOf = (s: WorldState) => s.pendingOrders.find((o) => o.type === 'commerce_raiding' && o.factionId === 'drajk')!;

describe('a raid run dark', () => {
  it('is a raid, and nothing else can be', () => {
    const s = createSeedState('meridian');
    const out = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'drajk', type: 'blockade', originId: 'tor-3', targetId: 'tor-3', durationTurns: 2, dark: true } as OpInput],
      'model',
      'drajk',
    );
    expect(out.rejections[0]?.message).toMatch(/Only commerce raiding/);
  });

  it('takes half the prizes', () => {
    const open = routeEarnings(raiding(false)).raidedFrom.drajk?.ojjul ?? 0;
    const dark = routeEarnings(raiding(true)).raidedFrom.drajk?.ojjul ?? 0;
    expect(open).toBeGreaterThan(0);
    expect(dark).toBeCloseTo(open * DARK_RAID_YIELD, 0);
  });

  it('is an unowned rumour to everyone but its owner', () => {
    const s = raiding(true);
    const id = raidOf(s).id;
    expect(observeOrders(s, 'drajk').orders.some((o) => o.id === id)).toBe(true);
    for (const who of ['ojjul', 'meridian']) {
      expect(observeOrders(s, who).orders.some((o) => o.id === id)).toBe(false);
      expect(observeOrders(s, who).rumours.some((r) => r.factionId === null && r.systemId === raidOf(s).targetId)).toBe(true);
    }
    expect(briefingFromState(s).rumoured.find((r) => r.factionId === null)?.factionName).toBe('Unknown raiders');
  });

  it('owes its costs instead of paying them, and names nobody', () => {
    const before = raiding(true);
    const after = tickTurn(before, calm).state;
    expect(regard(after, 'ojjul', 'drajk')).toBe(regard(before, 'ojjul', 'drajk'));
    expect(raidOf(after).dark).toMatchObject({ turns: 1 });
    expect(raidOf(after).dark!.heat).toBeGreaterThan(0);
    expect(after.factions.find((f) => f.id === 'drajk')!.heat).toBe(0);
    const line = after.eventLog.filter((e) => e.turn === after.turn && /Raiders take shipping/.test(e.text));
    expect(line).toHaveLength(1);
    expect(line[0]!.text).not.toMatch(/Drajk/);
  });
});

describe('traced', () => {
  /** Tick a dark raid with the Combine listening, until it is traced. */
  function traced(): { before: WorldState; after: WorldState } {
    let s = raiding(true);
    // A raider with no guile to speak of, against the Combine's listening
    // posts, is traced on its first turn of prizes whatever the die says.
    s.factions.find((f) => f.id === 'drajk')!.stats.guile = 1;
    addShipsAt(s.systems.find((x) => x.id === raidOf(s).targetId)!, 'ojjul', 1, 'listener');
    const after = tickTurn(s, calm).state;
    if (raidOf(after)?.dark) throw new Error('not traced');
    return { before: s, after };
  }

  it('hands the victim proof, and the raid runs open from then', () => {
    const { before, after } = traced();
    const owed = raidOf(before).dark!;
    const proof = after.assets.find((a) => a.secret?.kind === 'dark_raid')!;
    expect(proof).toMatchObject({ heldBy: 'ojjul', secret: { subject: 'drajk', ref: raidOf(after).id } });
    // Drajk is a smuggler: piracy is expected of it, open or dark.
    expect(proof.secret!.reputation).toBe(0);
    expect(proof.secret!.heat).toBeGreaterThanOrEqual(2 * owed.heat);
    expect(regard(after, 'ojjul', 'drajk')).toBeLessThanOrEqual(
      Math.max(-100, regard(before, 'ojjul', 'drajk') - 2 * INTERDICTION_DISPOSITION_COST * (owed.turns + 1)),
    );
    const told = after.eventLog.find((e) => /traces the raiders/.test(e.text))!;
    expect(told.visibleTo).toEqual(['ojjul', 'drajk']);
  });

  it('published, costs the raider its doubled heat', () => {
    const { after } = traced();
    const proof = after.assets.find((a) => a.secret?.kind === 'dark_raid')!;
    const out = applyOps(after, [{ op: 'publish_dossier', assetId: proof.id } as OpInput], 'model', 'ojjul');
    expect(out.rejections).toEqual([]);
    expect(out.state.factions.find((f) => f.id === 'drajk')!.heat).toBe(
      Math.min(100, after.factions.find((f) => f.id === 'drajk')!.heat + proof.secret!.heat!),
    );
  });

  it('is news while the raid runs, and for a while after it was filed', () => {
    const { after } = traced();
    const secret = after.assets.find((a) => a.secret?.kind === 'dark_raid')!.secret!;
    const ended = { ...after, pendingOrders: after.pendingOrders.filter((o) => o.id !== secret.ref) };
    expect(secretLive(after, secret)).toBe(true);
    expect(secretLive({ ...ended, turn: secret.filedTurn! + DARK_PROOF_TURNS }, secret)).toBe(true);
    expect(secretLive({ ...ended, turn: secret.filedTurn! + DARK_PROOF_TURNS + 1 }, secret)).toBe(false);
  });
});

describe('the bots', () => {
  it('raid dark where being seen would cost them a friend', () => {
    // The Combine thinks well of the Confederacy, and pays nothing for the raid.
    const raid = proposeFor(createSeedState('meridian'), 'drajk')!.ops.find((o) => o.type === 'commerce_raiding')!;
    expect(raid).toMatchObject({ targetId: 'ilv-5', dark: true });
  });

  it('raid open where nothing is lost by being seen', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'ojjul')!.disposition.drajk = -80;
    const raid = proposeFor(s, 'drajk')!.ops.find((o) => o.type === 'commerce_raiding');
    expect(raid?.dark).toBeUndefined();
  });
});
