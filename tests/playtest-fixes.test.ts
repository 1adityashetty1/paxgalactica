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
