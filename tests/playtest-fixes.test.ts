import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { neighboursOf } from '../src/domain/graph.js';
import { worldAsSeenBy, eventsVisibleTo } from '../src/domain/intel.js';
import { setStackAt, type WorldState } from '../src/domain/state.js';

/**
 * Defects an 8-turn Iron Vigil playtest found, each pinned at the seam it
 * broke. They have nothing in common except that one campaign found all of
 * them in a sitting and the suite found none of them.
 */

const seed = (who = 'vigil'): WorldState => createSeedState(who);
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

describe('an officer who sails between friendly worlds arrives', () => {
  /**
   * `resolveBattle` returned from the friendly-arrival exit before any officer
   * was put on the board, and the order leaves `pendingOrders` on arrival — so
   * the officer was at no system and on no voyage, permanently. The third exit
   * caught doing this, and the commonest: moving between your own worlds takes
   * it every time.
   */
  it('stands on the world they sailed to, and fights no battle doing it', () => {
    const s = seed();
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const to = s.systems.find(
      (x) => x.controllerFactionId === 'vigil' && neighboursOf(s, home.id).includes(x.id),
    )!;
    const officer = s.commanders.find((c) => c.factionId === 'vigil')!;
    officer.atSystemId = home.id;
    const battlesBefore = officer.battles;
    setStackAt(home, 'vigil', { battleship: 4 });

    const issued = applyOps(s, [{
      op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
      originId: home.id, targetId: to.id, force: { battleship: 4 },
      commanderId: officer.id, label: 'redeploy', visibility: [],
    }], 'model', 'vigil', true).state;
    // Aboard, so nowhere on the board while under way.
    expect(issued.commanders.find((c) => c.id === officer.id)!.atSystemId).toBeNull();

    let after = issued;
    for (let i = 0; i < 4 && after.pendingOrders.length > 0; i++) after = tickTurn(after).state;

    const landed = after.commanders.find((c) => c.id === officer.id)!;
    expect(landed.atSystemId).toBe(to.id);
    expect(landed.status).toBe('active');
    // Nothing was fought, so nothing is counted and nobody rolls for death.
    expect(landed.battles).toBe(battlesBefore);
  });
});

describe('an officer can be named the way a person names one', () => {
  /**
   * The resolution call writes what a player says — `commanderId: "Marcia
   * Galba"` — and an id-only match dropped every one of them with "no such
   * officer" while the narrative went on claiming the officer was aboard.
   */
  it('attaches by family name, not only by id', () => {
    const s = seed();
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const officer = s.commanders.find((c) => c.factionId === 'vigil')!;
    officer.atSystemId = home.id;
    const family = officer.name.split(' ').pop()!;
    setStackAt(home, 'vigil', { battleship: 4 });

    const out = applyOps(s, [{
      op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
      originId: home.id, targetId: neighboursOf(s, home.id)[0]!, force: { battleship: 2 },
      commanderId: family, label: 'sortie', visibility: [],
    }], 'model', 'vigil', true);

    expect(out.state.pendingOrders[0]!.commanderId).toBe(officer.id);
    expect(out.notes.join(' ')).not.toMatch(/without a named officer/);
  });

  it('still refuses a name that could only mean a rival officer', () => {
    const s = seed();
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    s.commanders.find((c) => c.factionId === 'vigil')!.atSystemId = home.id;
    const theirs = s.commanders.find((c) => c.factionId === 'ojjul')!;
    setStackAt(home, 'vigil', { battleship: 4 });

    const out = applyOps(s, [{
      op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
      originId: home.id, targetId: neighboursOf(s, home.id)[0]!, force: { battleship: 2 },
      commanderId: theirs.name, label: 'sortie', visibility: [],
    }], 'model', 'vigil', true);

    expect(out.state.pendingOrders[0]!.commanderId).toBeNull();
    expect(out.notes.join(' ')).toMatch(/without a named officer/);
  });
});

describe('the served world hides operatives that have not been caught', () => {
  /**
   * `GET /api/campaign` carried `state.agents` whole — every rival operative,
   * unexposed ones included, with name, world, mission and cover story. A
   * playtest read six off one response, five of them never exposed.
   */
  const withSpies = (): WorldState => {
    let s = seed('vigil');
    const mine = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const theirs = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    // Each power's operative on the OTHER's ground, which is the only place an
    // operative does anything: one on its own world steals from nobody.
    s = applyOps(s, [{
      op: 'deploy_agent', systemId: mine.id, mission: 'surveillance',
      effect: { kind: 'intel' }, cover: 'a grain factor',
    }], 'model', 'ojjul', true).state;
    s = applyOps(s, [{
      op: 'deploy_agent', systemId: theirs.id, mission: 'theft',
      effect: { kind: 'income_penalty', perTurn: 4 }, cover: 'a chandler',
    }], 'model', 'vigil', true).state;
    return s;
  };

  it('keeps your own and drops a rival’s', () => {
    const s = withSpies();
    expect(s.agents).toHaveLength(2);
    const seen = worldAsSeenBy(s, 'vigil');
    expect(seen.agents.map((a) => a.ownerFactionId)).toEqual(['vigil']);
    // A view, not a mutation: the true board is untouched.
    expect(s.agents).toHaveLength(2);
  });

  it('shows a rival’s once it has been burned', () => {
    const s = withSpies();
    s.agents.find((a) => a.ownerFactionId === 'ojjul')!.exposed = true;
    expect(worldAsSeenBy(s, 'vigil').agents).toHaveLength(2);
  });
});

describe('a clamp or a rejection is a note to the power that wrote the order', () => {
  /**
   * Both were public, and `serializeRecentLog` feeds the log into every NPC
   * prompt. Measured: the Vigil's own log carried Drajk's refused
   * `deploy_agent`, naming the attempt and the world.
   */
  it('does not publish a rejected covert op to its target', () => {
    const s = seed('vigil');
    const world = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const out = applyOps(s, [{
      op: 'deploy_agent', ownerFactionId: 'vigil', systemId: world.id,
      mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 },
    }], 'model', 'drajk', true);

    expect(out.rejections.length).toBeGreaterThan(0);
    expect(eventsVisibleTo(out.state, 'drajk').some((e) => e.kind === 'rejection')).toBe(true);
    expect(eventsVisibleTo(out.state, 'vigil').some((e) => e.kind === 'rejection')).toBe(false);
  });

  it('keeps a clamp with the power it clamped', () => {
    const s = seed('vigil');
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    setStackAt(home, 'vigil', { battleship: 4 });
    const out = applyOps(s, [{
      op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
      originId: home.id, targetId: neighboursOf(s, home.id)[0]!, force: { battleship: 2 },
      commanderId: 'nobody at all', label: 'sortie', visibility: [],
    }], 'model', 'vigil', true);

    expect(eventsVisibleTo(out.state, 'vigil').some((e) => e.kind === 'clamp')).toBe(true);
    expect(eventsVisibleTo(out.state, 'ojjul').some((e) => e.kind === 'clamp')).toBe(false);
  });
});

describe('interrupting somebody else’s programme takes being there', () => {
  const withOrder = (): { state: WorldState; orderId: string; where: string } => {
    const s = seed('vigil');
    const theirs = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    const out = applyOps(s, [{
      op: 'issue_order', factionId: 'ojjul', type: 'fortification',
      originId: theirs.id, targetId: theirs.id, durationTurns: 3,
      label: 'harden the approach', visibility: [],
    }], 'model', 'ojjul', true).state;
    return { state: out, orderId: out.pendingOrders[0]!.id, where: theirs.id };
  };

  it('refuses a rival with nothing in the system', () => {
    const { state, orderId } = withOrder();
    const out = applyOps(state, [
      { op: 'interrupt_order', orderId, reason: 'a word in the right ear' },
    ], 'model', 'vigil', true);

    expect(out.rejections[0]?.code).toBe('no_presence');
    expect(out.state.pendingOrders).toHaveLength(1);
  });

  it('allows it with a fleet over the world', () => {
    const { state, orderId, where } = withOrder();
    setStackAt(sys(state, where), 'vigil', { battleship: 3 });
    const out = applyOps(state, [
      { op: 'interrupt_order', orderId, reason: 'guns over the yards' },
    ], 'model', 'vigil', true);

    expect(out.rejections).toEqual([]);
    expect(out.state.pendingOrders).toHaveLength(0);
  });

  it('never stands between a power and its own order', () => {
    const { state, orderId } = withOrder();
    const out = applyOps(state, [
      { op: 'interrupt_order', orderId, reason: 'stood down' },
    ], 'model', 'ojjul', true);

    expect(out.rejections).toEqual([]);
    expect(out.state.pendingOrders).toHaveLength(0);
  });
});

describe('money written into a treasury needs a payer', () => {
  /**
   * The cap bounded one batch and a power declares every turn, so what it
   * bounded was the RATE of invention rather than the fact of it. Measured:
   * two NPCs "sold" one 60-crate lot back and forth over three turns, the
   * seller credited each time and no buyer debited, and the galaxy ended about
   * 600 credits richer on a lot worth at most 480.
   */
  const purse = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;

  it('drops a windfall the actor writes into its own treasury', () => {
    const s = seed('drajk');
    const before = purse(s, 'drajk');
    const out = applyOps(s, [
      { op: 'adjust_credits', factionId: 'drajk', delta: 240, reason: 'sold the crate lot' },
    ], 'model', 'drajk', true);

    expect(out.rejections).toEqual([]);
    expect(purse(out.state, 'drajk')).toBe(before);
    expect(out.notes.join(' ')).toMatch(/came from nobody's treasury/);
  });

  it('drops one an NPC reaction writes for itself', () => {
    // The playtest's minting came from reactions, which commit under the
    // reacting power as actor — the same path, and it must read the same.
    const s = seed('vigil');
    const before = purse(s, 'ojjul');
    const out = applyOps(s, [
      { op: 'adjust_credits', factionId: 'ojjul', delta: 200, reason: 'the sale clears' },
    ], 'model', 'ojjul', true);

    expect(purse(out.state, 'ojjul')).toBe(before);
  });

  it('still lets a power spend its own money', () => {
    const s = seed('drajk');
    const before = purse(s, 'drajk');
    const out = applyOps(s, [
      { op: 'adjust_credits', factionId: 'drajk', delta: -150, reason: 'a bribe paid' },
    ], 'model', 'drajk', true);

    expect(purse(out.state, 'drajk')).toBe(before - 150);
  });

  it('pays a credit that somebody in the same batch actually funded', () => {
    // Conservation, not prohibition: the money moves when a treasury paid it.
    const s = seed('drajk');
    const beforeThem = purse(s, 'ojjul');
    const beforeUs = purse(s, 'drajk');
    const out = applyOps(s, [
      { op: 'adjust_credits', factionId: 'drajk', delta: -100, reason: 'paid over' },
      { op: 'adjust_credits', factionId: 'ojjul', delta: 100, reason: 'received' },
    ], 'model', 'drajk', true);

    expect(purse(out.state, 'drajk')).toBe(beforeUs - 100);
    expect(purse(out.state, 'ojjul')).toBe(beforeThem + 100);
  });

  it('leaves an accord alone, where the buyer’s consent is on the record', () => {
    const s = seed('drajk');
    const beforeThem = purse(s, 'ojjul');
    const beforeUs = purse(s, 'drajk');
    const out = applyOps(s, [
      { op: 'adjust_credits', factionId: 'ojjul', delta: -180, reason: 'the agreed price' },
      { op: 'adjust_credits', factionId: 'drajk', delta: 180, reason: 'the agreed price' },
    ], 'extraction', 'drajk', true);

    expect(purse(out.state, 'ojjul')).toBe(beforeThem - 180);
    expect(purse(out.state, 'drajk')).toBe(beforeUs + 180);
  });
});

describe('a self-credit in a journal written before it needed a payer', () => {
  it('replays as it ran', async () => {
    const { applyOps: apply } = await import('../src/domain/reducer.js');
    const { createSeedState: seed } = await import('../src/seed/scenario.js');
    const s = seed('drajk');
    const before = s.factions.find((f) => f.id === 'drajk')!.credits;
    const op = { op: 'adjust_credits', factionId: 'drajk', delta: 100 } as never;
    const now = apply(s, [op], 'model', 'drajk');
    const then = apply(s, [op], 'model', 'drajk', false, { selfCreditNeedsPayer: false });
    expect(now.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(before);
    expect(then.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(before + 100);
  });
});

describe('spoils are recorded after the battle, not before it', () => {
  /**
   * Measured: a declaration ordering an attack on Threx created "6 crew who
   * laid down arms" AT Threx on the spot — a turn before the fleet arrived and
   * the landing was fought. Had the landing failed, the prisoners would have
   * been held anyway.
   *
   * The presence guard already existed and covered fixtures and producers
   * only, so the ordinary haul walked past it. `atSystemId` is what makes an
   * asset losable, which is exactly as much a claim on ground for a crate of
   * prisoners as for a mine.
   */
  const prisoners = (atSystemId: string) => ({
    op: 'create_asset' as const,
    kind: 'prisoners',
    heldBy: 'vigil',
    quantity: 6,
    unit: 'crew',
    text: 'six crew who laid down arms',
    atSystemId,
  });

  it('refuses a haul on a world the taker has not reached', () => {
    const s = seed('vigil');
    const theirs = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    const out = applyOps(s, [prisoners(theirs.id)], 'model', 'vigil', true);

    expect(out.rejections[0]?.code).toBe('no_presence');
    expect(out.state.assets.some((a) => a.text === 'six crew who laid down arms')).toBe(false);
  });

  it('refuses it while the fleet that would take the world is still in transit', () => {
    // The case as played: the order and the prize in one declaration. A fleet
    // under way is in `order.force` and not in `system.ships`, so the attacker
    // stands nowhere and the guard catches it.
    const s = seed('vigil');
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const target = s.systems.find(
      (x) => x.controllerFactionId === 'ojjul' && neighboursOf(s, home.id).includes(x.id),
    ) ?? s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    setStackAt(home, 'vigil', { battleship: 8, lifter: 4 });

    const out = applyOps(s, [
      {
        op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
        originId: home.id, targetId: target.id, force: { battleship: 8, lifter: 4 },
        label: 'take the world', visibility: [],
      },
      prisoners(target.id),
    ], 'model', 'vigil', false);

    expect(out.rejections.some((r) => r.code === 'no_presence')).toBe(true);
    expect(out.state.assets.some((a) => a.text === 'six crew who laid down arms')).toBe(false);
    // The attack itself is untouched: a failed prize does not cancel the war.
    expect(out.state.pendingOrders).toHaveLength(1);
  });

  it('allows it once the takers are actually there', () => {
    const s = seed('vigil');
    const theirs = s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    setStackAt(theirs, 'vigil', { battleship: 6 });
    const out = applyOps(s, [prisoners(theirs.id)], 'model', 'vigil', true);

    expect(out.rejections).toEqual([]);
    expect(out.state.assets.some((a) => a.text === 'six crew who laid down arms')).toBe(true);
  });

  it('leaves a haul on your own ground alone', () => {
    const s = seed('vigil');
    const home = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const out = applyOps(s, [prisoners(home.id)], 'model', 'vigil', true);

    expect(out.rejections).toEqual([]);
    expect(out.state.assets.some((a) => a.text === 'six crew who laid down arms')).toBe(true);
  });
});
