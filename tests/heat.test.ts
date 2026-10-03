import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { AgentSchema, type Agent } from '../src/domain/diplomacy.js';
import {
  HEAT_ANSWERED,
  HEAT_DECAY,
  HEAT_FOR_MISSION,
  HEAT_NOTORIOUS,
  HEAT_PACT_BROKEN,
  HEAT_PER_RAID,
} from '../src/domain/heat.js';
import { eligibleRimEvents, primeRimSandbox } from '../src/domain/pulse.js';
import { proposeFor } from '../src/domain/initiative.js';
import { routeEarnings } from '../src/domain/trade.js';
import { fleetTonsOf, tonsAt, type WorldState } from '../src/domain/state.js';
import type { RimEventKind } from '../src/domain/events.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Heat (journal version 14): dirty work makes a power notorious, notoriety
 * fades slowly, and past `HEAT_NOTORIOUS` the Rim answers.
 */

const calm = { randomEvents: false };
const heat = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.heat;
const setHeat = (s: WorldState, id: string, n: number) => {
  s.factions.find((f) => f.id === id)!.heat = n;
};

describe('what runs hot', () => {
  it('a mission sent, by what it is', () => {
    const s = createSeedState('meridian');
    const send = (mission: string, legacy: LegacyRules = {}) =>
      applyOps(
        s,
        [
          { op: 'recruit_agent', systemId: 'sek-4' },
          { op: 'deploy_agent', systemId: 'tor-2', mission, effect: { kind: 'intel', revealsOrders: true } },
        ] as OpInput[],
        'model',
        'meridian',
        false,
        legacy,
      ).state;
    expect(heat(send('surveillance'), 'meridian')).toBe(HEAT_FOR_MISSION.surveillance);
    expect(heat(send('assassination'), 'meridian')).toBe(HEAT_FOR_MISSION.assassination);
    // A journal from before heat ran nobody hot.
    expect(heat(send('assassination', { heat: false }), 'meridian')).toBe(0);
  });

  it('a pact torn up, by the power that tore it', () => {
    let s = createSeedState('meridian');
    s = applyOps(
      s,
      [{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'ojjul'], terms: {}, summary: 'x' } as OpInput],
      'extraction',
      'meridian',
      true,
    ).state;
    const out = applyOps(s, [{ op: 'break_treaty', treatyId: s.treaties.at(-1)!.id } as OpInput], 'model', 'meridian').state;
    expect(heat(out, 'meridian')).toBe(HEAT_PACT_BROKEN);
    expect(heat(out, 'ojjul')).toBe(0);
  });

  it('a raid no commission licenses, per power robbed, and none for one that is', () => {
    let s = createSeedState('meridian');
    const raid = proposeFor(s, 'drajk')!.ops.find((o) => o.type === 'commerce_raiding')!;
    s = applyOps(s, [raid], 'model', 'drajk').state;
    s = tickTurn(s, calm).state;
    const robbed = Object.keys(routeEarnings(s).raidedFrom.drajk ?? {}).length;
    expect(robbed).toBeGreaterThan(0);
    const before = heat(s, 'drajk');
    const unlicensed = tickTurn(s, calm).state;
    expect(heat(unlicensed, 'drajk')).toBe(Math.max(0, before - HEAT_DECAY) + robbed * HEAT_PER_RAID);

    // Commissioned against everyone it robs, it runs no heat for them.
    const victims = Object.keys(routeEarnings(s).raidedFrom.drajk ?? {});
    const paymaster = ['meridian', 'vigil', 'ojjul', 'freeworlds'].find((id) => !victims.includes(id))!;
    const licensed = applyOps(
      s,
      [
        {
          op: 'form_treaty', treatyType: 'contract', parties: [paymaster, 'drajk'],
          terms: { commission: { raider: 'drajk', against: victims, share: 0 } }, summary: 'x',
        } as OpInput,
      ],
      'extraction',
      paymaster,
      true,
    ).state;
    expect(heat(tickTurn(licensed, calm).state, 'drajk')).toBe(Math.max(0, before - HEAT_DECAY));
  });

  it('fades every turn, and never below nothing', () => {
    const s = createSeedState('meridian');
    setHeat(s, 'vigil', 10);
    const t = tickTurn(s, calm).state;
    expect(heat(t, 'vigil')).toBe(10 - HEAT_DECAY);
    expect(heat(t, 'meridian')).toBe(0);
  });
});

describe('the Rim answers the notorious', () => {
  /** A power's operative at work on a rival world. */
  const spy = (over: Partial<Agent>): Agent =>
    AgentSchema.parse({
      id: 'agt-h', ownerFactionId: 'meridian', systemId: 'tor-2', mission: 'surveillance',
      effect: { kind: 'intel', revealsOrders: true }, successChance: 50, deployedTurn: 0, name: 'A Clerk',
      ...over,
    });

  it('only past the threshold', () => {
    const s = createSeedState('meridian');
    s.agents.push(spy({}));
    const notoriety = (st: WorldState) =>
      eligibleRimEvents(st).filter((e) => ['crackdown', 'bounty_posted', 'turned_contact', 'show_of_force'].includes(e.kind));
    setHeat(s, 'meridian', HEAT_NOTORIOUS - 1);
    expect(notoriety(s)).toEqual([]);
    setHeat(s, 'meridian', HEAT_NOTORIOUS);
    expect(notoriety(s).map((e) => e.kind)).toContain('crackdown');
  });

  /** One notoriety event, fired at the player the sandbox way. */
  const answered = (kind: RimEventKind) => {
    const before = primeRimSandbox(createSeedState('freeworlds'), kind);
    const out = tickTurn(before, { rimSandbox: kind });
    expect(out.report.events.map((e) => e.kind)).toEqual([kind]);
    return { before, after: out.state };
  };

  it('a crackdown takes an operative, and the answer cools the power', () => {
    const { after } = answered('crackdown');
    const taken = after.assets.find((a) => a.kind === 'operative' && a.agentId?.startsWith('agt-sandbox'));
    expect(taken).toBeDefined();
    expect(after.agents.find((a) => a.id === taken!.agentId)!.exposed).toBe(true);
    expect(heat(after, 'freeworlds')).toBeLessThanOrEqual(100 - HEAT_ANSWERED);
  });

  it('a price on its head is the merchants\', and nobody can take it back', () => {
    const { after } = answered('bounty_posted');
    const bounty = after.bounties.find((b) => b.targetFactionId === 'freeworlds')!;
    expect(bounty).toMatchObject({ postedBy: null, status: 'open' });
    expect(bounty.pool).toBeGreaterThan(0);
    const out = applyOps(after, [{ op: 'withdraw_bounty', bountyId: bounty.id } as OpInput], 'model', 'freeworlds');
    expect(out.rejections[0]?.message).toMatch(/merchants/);
  });

  it('a turned contact works for the power it was spying on, and talks', () => {
    const { before, after } = answered('turned_contact');
    const turned = after.agents.find(
      (a) => a.id.startsWith('agt-sandbox') && a.ownerFactionId !== 'freeworlds',
    )!;
    expect(turned.mission).toBeNull();
    const host = before.systems.find((x) => x.id === turned.systemId)!.controllerFactionId;
    expect(turned.ownerFactionId).toBe(host);
    // The other contacts it knew of are proof in its new masters' hands.
    expect(after.assets.some((a) => a.heldBy === host && a.secret?.subject === 'freeworlds')).toBe(true);
  });

  it('a show of force brings a neighbour\'s hulls to the border, and makes none', () => {
    const { before, after } = answered('show_of_force');
    const event = after.rimEvents.at(-1)!;
    const by = before.systems.find((x) => x.id === event.systemId)!.controllerFactionId!;
    expect(fleetTonsOf(after, by)).toBe(fleetTonsOf(before, by));
    const border = (st: WorldState) => tonsAt(st.systems.find((x) => x.id === event.systemId)!, by);
    expect(border(after)).toBeGreaterThan(border(before));
  });
});
