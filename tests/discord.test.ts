import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { MAX_DISCORD_TOTAL, AGENT_COST } from '../src/domain/diplomacy.js';
import type { OpInput } from '../src/domain/ops.js';
import type { WorldState } from '../src/domain/state.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * `discord`: the only mission aimed at a quarrel the buyer is not in (item 113).
 * Ported from the unmerged `no-star-wars` branch (1422762). What it buys is
 * permanent — disposition has no decay — so the rate is small and the real bound
 * is a lifetime ceiling.
 */
describe('setting two other powers against each other', () => {
  const regard = (s: WorldState, who: string, of: string) => s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;
  /** A world the Vigil holds, so Drajk can work on the Vigil against Meridian. */
  const theirs = (s: WorldState) => s.systems.find((x) => x.controllerFactionId === 'vigil')!.id;
  const rich = () => {
    const s = createSeedState('drajk');
    s.factions.find((f) => f.id === 'drajk')!.credits = 5000;
    return s;
  };
  const deploy = (s: WorldState, effect: Record<string, unknown>, systemId?: string) =>
    applyOps(s, [{ op: 'deploy_agent', systemId: systemId ?? theirs(s), mission: 'discord', effect } as OpInput], 'model', 'drajk');
  const planted = (s: WorldState, successChance: number) => {
    s.agents.push({
      id: 'agt-d', ownerFactionId: 'drajk', systemId: theirs(s), mission: 'discord',
      effect: { kind: 'discord', towardFactionId: 'meridian', perTurn: 2 },
      successChance, exposed: false, deployedTurn: 0, cover: '', targetCommanderId: null,
      name: 'Sherrin Greywake', operations: 0, timesCaught: 0,
    });
    return s;
  };
  const ticks = (s: WorldState, n: number) => {
    let st = s;
    for (let i = 0; i < n; i++) st = tickTurn(st).state;
    return st;
  };

  it('moves the host against a third power, and nobody against the buyer', () => {
    // Against a control, because a tick moves disposition for reasons of its own
    // (Drajk's seeded raiding charges reputation every turn).
    const st = ticks(planted(createSeedState('drajk'), 100), 4);
    const control = ticks(createSeedState('drajk'), 4);
    expect(regard(control, 'vigil', 'meridian') - regard(st, 'vigil', 'meridian')).toBe(8);
    expect(regard(st, 'vigil', 'drajk')).toBe(regard(control, 'vigil', 'drajk'));
  });

  it('stops at a lifetime ceiling rather than earning forever', () => {
    const s = planted(createSeedState('drajk'), 100);
    const control = ticks(createSeedState('drajk'), 40);
    const st = ticks(s, 40);
    expect(regard(control, 'vigil', 'meridian') - regard(st, 'vigil', 'meridian')).toBe(MAX_DISCORD_TOTAL);
    expect(st.agents.find((a) => a.id === 'agt-d')!.discordMoved).toBe(MAX_DISCORD_TOTAL);
  });

  it('refuses a quarrel the buyer is in, on either side — and charges nothing for it', () => {
    const s = rich();
    const againstMe = deploy(s, { kind: 'discord', towardFactionId: 'drajk', perTurn: 1 });
    expect(againstMe.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(againstMe.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(5000);
    const mine = s.systems.find((x) => x.controllerFactionId === 'drajk')!.id;
    expect(deploy(s, { kind: 'discord', towardFactionId: 'meridian', perTurn: 1 }, mine).rejections.map((r) => r.code)).toEqual([
      'illegal_value',
    ]);
  });

  it('refuses an unaligned world and an invented power', () => {
    const s = rich();
    const nobodys = s.systems.find((x) => x.controllerFactionId === null)!.id;
    expect(deploy(s, { kind: 'discord', towardFactionId: 'meridian', perTurn: 1 }, nobodys).rejections.map((r) => r.code)).toEqual([
      'no_presence',
    ]);
    expect(deploy(s, { kind: 'discord', towardFactionId: 'nowhere', perTurn: 1 }).rejections.map((r) => r.code)).toEqual([
      'unknown_faction',
    ]);
  });

  it('charges its price when it is placed', () => {
    const out = deploy(rich(), { kind: 'discord', towardFactionId: 'meridian', perTurn: 1 });
    expect(out.rejections).toEqual([]);
    expect(out.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(5000 - AGENT_COST.discord);
  });

  it('costs standing with BOTH powers when it is caught', () => {
    // Every other mission has one victim; the forged letters were about somebody.
    let st = planted(createSeedState('drajk'), 5);
    let caughtAt = -1;
    for (let i = 0; i < 40 && caughtAt < 0; i++) {
      st = tickTurn(st).state;
      if (st.agents.find((a) => a.id === 'agt-d')!.exposed) caughtAt = i + 1;
    }
    expect(caughtAt, 'a 5% operative should be caught inside forty turns').toBeGreaterThan(0);
    const control = ticks(createSeedState('drajk'), caughtAt);
    expect(regard(st, 'vigil', 'drajk')).toBeLessThan(regard(control, 'vigil', 'drajk'));
    expect(regard(st, 'meridian', 'drajk')).toBeLessThan(regard(control, 'meridian', 'drajk'));
  });
});
