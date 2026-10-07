import type { OpInput } from '../src/domain/ops.js';
import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  COVERT_CATEGORIES,
  PUBLIC_CATEGORIES,
  SECRET_CATEGORIES,
  eventsVisibleTo,
  observeOrders,
  ordersVisibleTo,
  visibilityOf,
  worldAsSeenBy,
} from '../src/domain/intel.js';
import { DURATION_CATEGORIES } from '../src/domain/duration.js';
import { proposeFor } from '../src/domain/initiative.js';
import { Campaign } from '../src/engine/campaign.js';
import { replay } from '../src/engine/journal.js';
import {
  hullsAt,
  setShipsAt, setStackAt, fleetStrengthOf, shipsInTransit, type OrderType, type WorldState } from '../src/domain/state.js';

/**
 * Intelligence, from the player's side.
 *
 * Before this existed, `ordersVisibleTo` had one caller — the prompt
 * serializer — and every player-facing path read `state.pendingOrders` whole.
 * A campaign played expressly to spy ran four surveillance operatives for
 * seven turns and produced nothing, because nothing was hidden to find.
 */

const seed = () => createSeedState('ojjul');

/** A world nobody in `ojjul`'s employ can see into: Free Worlds space, no Nar ships. */
const FOREIGN = 'ark-1';

function withOrder(
  type: OrderType,
  opts: { faction?: string; target?: string; visibility?: string[] } = {},
): WorldState {
  return applyOps(seed(), [
    {
      op: 'issue_order',
      factionId: opts.faction ?? 'freeworlds',
      type,
      originId: opts.target ?? FOREIGN,
      targetId: opts.target ?? FOREIGN,
      durationTurns: 3,
      label: 'the thing itself',
      visibility: opts.visibility ?? [],
    },
  ]).state;
}

const seeOne = (s: WorldState, me = 'ojjul') => visibilityOf(s, me, s.pendingOrders[0]!);

describe('the public / secret split', () => {
  it('covers every order type exactly once', () => {
    const all: OrderType[] = ['fleet_movement', ...DURATION_CATEGORIES];
    for (const t of all) {
      const isPublic = PUBLIC_CATEGORIES.has(t);
      const isSecret = SECRET_CATEGORIES.has(t as never);
      // Neither a type that is both, nor one the split forgot — a forgotten
      // type would silently default to secret and nobody would notice.
      expect(isPublic !== isSecret, `${t} is ${isPublic ? 'public' : 'not public'} and ${isSecret ? 'secret' : 'not secret'}`).toBe(true);
    }
  });

  it('treats covert work as a subset of secret work', () => {
    for (const t of COVERT_CATEGORIES) {
      expect(SECRET_CATEGORIES.has(t), `${t} must be secret to be covert`).toBe(true);
    }
  });

  it('shows public work with no operative and no presence', () => {
    // Walls go up in plain sight, on a world a rival holds.
    expect(seeOne(withOrder('fortification'))).toBe('full');
    expect(seeOne(withOrder('blockade'))).toBe('full');
    expect(seeOne(withOrder('fleet_movement'))).toBe('full');
  });

  it('reduces secret work to a rumour', () => {
    expect(seeOne(withOrder('capital_ship_construction'))).toBe('rumour');
    expect(seeOne(withOrder('industrial_conversion'))).toBe('rumour');
  });
});

describe('what presence buys, and what it does not', () => {
  /** Give `ojjul` a hull at the Free Worlds capital, so the world is in its space. */
  const withShips = (s: WorldState): WorldState => {
    const sys = s.systems.find((x) => x.id === FOREIGN)!;
    setShipsAt(sys, 'ojjul', 3);
    return s;
  };

  it('reveals physical work happening in your own space', () => {
    // A rival refitting hulls over a world you stand on is in front of your
    // own dockmasters.
    const s = withShips(withOrder('refit'));
    expect(seeOne(s)).toBe('full');
  });

  it('reveals physical work on a world you control', () => {
    const s = withOrder('retooling', { target: 'ilv-2' }); // a Nar-held world
    expect(s.systems.find((x) => x.id === 'ilv-2')!.controllerFactionId).toBe('ojjul');
    expect(seeOne(s)).toBe('full');
  });

  /**
   * The rule that matters most. An operation whose whole purpose is to be run
   * against someone without their knowledge must not be revealed to them
   * *because* it targets them — that is the mechanic cancelling itself out.
   */
  it('does NOT reveal covert work run against you, even on your own capital', () => {
    for (const t of COVERT_CATEGORIES) {
      let s = seed();
      // No ears at the capital. The Combine opens with listeners at its yards,
      // and a listener sees covert work where it stands — that is the class
      // doing its job, and it is pinned on its own. This pins the covert rule.
      for (const sys of s.systems) {
        const st = sys.ships.ojjul;
        if (st?.listener) setStackAt(sys, 'ojjul', { ...st, listener: 0 });
      }
      // `commerce_raiding` is the one covert category the reducer will not
      // issue without a fleet in reach, so the raider gets one. That is the
      // interesting case rather than an awkward one: the hulls ARE visible in
      // `system.ships`, and the order still is not.
      const staged = s.systems.find((x) => x.id === 'ilv-2')!;
      setShipsAt(staged, 'freeworlds', 4);
      s = applyOps(s, [
        {
          op: 'issue_order',
          factionId: 'freeworlds',
          type: t,
          originId: 'ilv-2',
          targetId: 'ilv-2',
          durationTurns: 3,
          label: 'the thing itself',
          visibility: [],
        },
      ], 'model').state;

      expect(s.pendingOrders, `${t} was not issued`).toHaveLength(1);
      expect(seeOne(s), `${t} on a world ojjul controls`).toBe('rumour');
      // The ships are not redacted, and should not be: you can see raiders
      // gathering without knowing a raid is the plan.
      expect(hullsAt(s.systems.find((x) => x.id === 'ilv-2')!, 'freeworlds')).toBe(4);
    }
  });

  it('does NOT reveal covert work sitting in a system your fleet is in', () => {
    const s = withShips(withOrder('espionage'));
    expect(seeOne(s)).toBe('rumour');
  });
});

describe('what an operative buys', () => {
  const watch = (s: WorldState, systemId: string): WorldState =>
    applyOps(s, [
      {
        op: 'deploy_agent',
        ownerFactionId: 'ojjul',
        systemId,
        mission: 'surveillance',
        effect: { kind: 'intel', revealsOrders: true },
      },
    ], 'model').state;

  it('sees through secret work', () => {
    const s = watch(withOrder('capital_ship_construction'), FOREIGN);
    expect(seeOne(s)).toBe('full');
  });

  /** An operative outranks the covert rule — that is what makes one worth buying. */
  it('sees through covert work', () => {
    const s = watch(withOrder('espionage'), FOREIGN);
    expect(seeOne(s)).toBe('full');
  });

  it('stops seeing once burned', () => {
    const s = watch(withOrder('espionage'), FOREIGN);
    s.agents[0]!.exposed = true;
    expect(seeOne(s)).toBe('rumour');
  });
});

/**
 * SIGINT: the same sight as an operative, at the same price, with every other
 * property inverted. A hull nobody could see through would be a cheaper
 * operative, and a hull that could not be shot would be a free one.
 */
describe('what a listener buys', () => {
  const ears = (s: WorldState, systemId: string): WorldState => {
    const sys = s.systems.find((x) => x.id === systemId)!;
    setStackAt(sys, 'ojjul', { listener: 1 });
    return s;
  };

  it('sees through secret work, exactly as an operative does', () => {
    expect(seeOne(ears(withOrder('capital_ship_construction'), FOREIGN))).toBe('full');
  });

  it('sees through covert work too', () => {
    expect(seeOne(ears(withOrder('espionage'), FOREIGN))).toBe('full');
  });

  it('sees only the world it is standing on', () => {
    // An operative is posted to one system and so is a hull. Buying ears at
    // home does not read a rival's yards a sector away.
    const s = withOrder('espionage');
    const elsewhere = s.systems.find(
      (x) => x.id !== FOREIGN && x.controllerFactionId === 'ojjul',
    )!;
    setStackAt(elsewhere, 'ojjul', { listener: 1 });
    expect(seeOne(s)).toBe('rumour');
  });

  it('stops seeing when the ship is gone, which is the whole trade', () => {
    // An operative is burned by being caught; a listener is simply killed, and
    // it was visible in `system.ships` the entire time it was working.
    const s = ears(withOrder('espionage'), FOREIGN);
    setStackAt(s.systems.find((x) => x.id === FOREIGN)!, 'ojjul', {});
    expect(seeOne(s)).toBe('rumour');
  });

  it('is not a warship wearing a different name', () => {
    // A battleship parked on the same world sees only what presence sees, and
    // presence is explicitly NOT enough for a covert order.
    const s = withOrder('espionage');
    setStackAt(s.systems.find((x) => x.id === FOREIGN)!, 'ojjul', { battleship: 4 });
    expect(seeOne(s)).toBe('rumour');
  });
});

describe('a rumour', () => {
  it('names a place and a clock and nothing else', () => {
    const s = withOrder('capital_ship_construction');
    const { orders, rumours } = observeOrders(s, 'ojjul');

    expect(orders).toHaveLength(0);
    // Duration is the order's own, which `CATEGORY_FLOORS` may have clamped
    // upward from what was asked for — a rumour reports the real clock.
    expect(rumours).toEqual([
      {
        factionId: 'freeworlds',
        systemId: FOREIGN,
        durationTurns: s.pendingOrders[0]!.durationTurns,
        progress: 0,
      },
    ]);
  });

  it('carries no order id, so it cannot be handed to interrupt_order', () => {
    const s = withOrder('espionage');
    const [rumour] = observeOrders(s, 'ojjul').rumours;
    expect(Object.keys(rumour!).sort()).toEqual(
      ['durationTurns', 'factionId', 'progress', 'systemId'],
    );

    // And the reducer refuses the real id anyway when it is not known — but the
    // point is that the player never receives it.
    expect(JSON.stringify(rumour)).not.toContain(s.pendingOrders[0]!.id);
  });

  it('does not leak the label or the type', () => {
    const s = withOrder('capital_ship_construction');
    const json = JSON.stringify(observeOrders(s, 'ojjul').rumours);
    expect(json).not.toContain('the thing itself');
    expect(json).not.toContain('capital_ship_construction');
  });
});

describe('the acting power can choose to be seen', () => {
  it('honours an explicit visibility list even for covert work', () => {
    const s = withOrder('espionage', { visibility: ['ojjul'] });
    expect(seeOne(s)).toBe('full');
  });

  it('always shows you your own orders', () => {
    const s = withOrder('espionage', { faction: 'ojjul' });
    expect(seeOne(s)).toBe('full');
    expect(ordersVisibleTo(s, 'ojjul')).toHaveLength(1);
  });
});

/**
 * Fleet totals are derived from `pendingOrders`, which the player now receives
 * redacted — so they could in principle read low for a rival hiding a
 * movement. They do not, because `fleet_movement` is public, and that is the
 * property that argument was made to buy.
 *
 * Pinned as a tripwire: making movement hideable would silently turn two exact
 * counts into partial ones, which is exactly the kind of number this project
 * refuses to display without saying so.
 */
describe('redaction does not corrupt fleet arithmetic', () => {
  it('keeps every faction’s fleet total exact under a redacted view', () => {
    let s = seed();
    const origin = s.systems.find((x) => (hullsAt(x, 'freeworlds')) > 1)!;
    s = applyOps(s, [
      {
        op: 'issue_order',
        factionId: 'freeworlds',
        type: 'fleet_movement',
        originId: origin.id,
        targetId: FOREIGN,
        durationTurns: 1,
        label: 'a squadron moves',
        visibility: [],
        force: 2,
      },
      // Something genuinely hidden alongside it, so the test would notice a
      // filter that dropped the movement too.
      {
        op: 'issue_order',
        factionId: 'freeworlds',
        type: 'capital_ship_construction',
        originId: FOREIGN,
        targetId: FOREIGN,
        durationTurns: 3,
        label: 'secret slipway',
        visibility: [],
      },
    ], 'model').state;

    const seen = worldAsSeenBy(s, 'ojjul');
    expect(seen.pendingOrders).toHaveLength(1);
    expect(seen.pendingOrders[0]!.type).toBe('fleet_movement');

    for (const f of s.factions) {
      expect(fleetStrengthOf(seen, f.id), f.id).toBe(fleetStrengthOf(s, f.id));
      expect(shipsInTransit(seen, f.id), f.id).toBe(shipsInTransit(s, f.id));
    }
  });
});

/**
 * An operative that reports nothing is indistinguishable from one that is
 * broken — which is exactly how the `intel` effect stayed unreachable for the
 * life of the project. Every live agent now writes one line per turn.
 */
describe('operatives report every turn', () => {
  const deploy = (
    s: WorldState,
    mission: string,
    effect: unknown,
    systemId = FOREIGN,
    owner = 'ojjul',
  ): WorldState =>
    applyOps(s, [
      { op: 'deploy_agent', ownerFactionId: owner, systemId, mission, effect },
    ], 'model').state;

  const intelLines = (s: WorldState) =>
    s.eventLog.filter((e) => e.kind === 'intel').map((e) => e.text);

  it('reports a watcher with nothing to see, rather than saying nothing', () => {
    const s = tickTurn(deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true })).state;
    const lines = intelLines(s);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/surveillance/);
    expect(lines[0]).toMatch(/nothing moving/i);
  });

  it('reports what a watcher can actually see', () => {
    let s = withOrder('capital_ship_construction');
    s = tickTurn(deploy(s, 'surveillance', { kind: 'intel', revealsOrders: true })).state;
    const line = intelLines(s)[0]!;
    expect(line).toMatch(/reports from/i);
    expect(line).toMatch(/the thing itself/);
  });

  /**
   * The three effects that produced no output at all before this: `intel` had
   * no branch, and these two are read where they are used so they never
   * touched the tick.
   */
  it('reports an effect that is applied somewhere else entirely', () => {
    const s = tickTurn(deploy(seed(), 'theft', { kind: 'income_penalty', perTurn: 15 })).state;
    expect(intelLines(s)[0]).toMatch(/skimming 15/);
  });

  it('reports a stat debuff, which mutates nothing on the tick', () => {
    const s = tickTurn(
      deploy(seed(), 'subversion', { kind: 'stat_debuff', stat: 'guile', magnitude: 2 }),
    ).state;
    expect(intelLines(s)[0]).toMatch(/2 guile/);
  });

  /**
   * The event log is shipped to the browser whole, so a rival's watch report
   * would hand the player a transcript of what an enemy spy network can see —
   * the exact opposite of the fog the same tick enforces.
   */
  it('never writes a rival’s intelligence into the player’s log', () => {
    let s = deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true });
    s = deploy(s, 'surveillance', { kind: 'intel', revealsOrders: true }, 'ilv-2', 'freeworlds');
    s = tickTurn(s).state;

    const lines = intelLines(s);
    expect(lines).toHaveLength(1);
    expect(s.eventLog.filter((e) => e.kind === 'intel').every((e) => e.factionId === 'ojjul')).toBe(true);
  });

  it('reports a burned operative as burned', () => {
    let s = deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true });
    s.agents[0]!.exposed = true;
    s = tickTurn(s).state;
    expect(intelLines(s)[0]).toMatch(/burned/i);
  });

  it('says so when the posting has nobody to work against', () => {
    // ilv-4 is unaligned in the seed: nobody to watch.
    const s = tickTurn(
      deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true }, 'ilv-4'),
    ).state;
    expect(intelLines(s)[0]).toMatch(/answers to nobody/i);
  });
});

/**
 * Fog is a property of the whole payload, not of one field.
 *
 * `pendingOrders` was redacted and the event log was not — and the log carried
 * the label, duration, target, payload and price of the very orders being
 * hidden. Measured live in one `GET /api/campaign` response: an order was an
 * anonymous rumour in `rumours` and fully described two lines down in
 * `eventLog`, including a `counter_intelligence` sweep and a rival operative
 * placed on the player's own world.
 */
describe('the event log does not leak what the fog hides', () => {
  const secretOrder = (faction = 'freeworlds') => ({
    op: 'issue_order', factionId: faction, type: 'capital_ship_construction',
    originId: FOREIGN, targetId: FOREIGN, durationTurns: 3,
    label: 'the secret slipway', visibility: [],
  });

  it('hides a secret order’s log line from everyone but its owner', () => {
    const s = applyOps(seed(), [secretOrder()], 'model', 'freeworlds', true).state;
    const line = (id: string) =>
      worldAsSeenBy(s, id).eventLog.some((e) => e.text.includes('the secret slipway'));

    expect(line('freeworlds'), 'its owner must still see its own order').toBe(true);
    expect(line('ojjul'), 'a rival must not read it out of the log').toBe(false);
    // And the redaction of the order itself still holds, so the two agree.
    expect(observeOrders(s, 'ojjul').orders).toHaveLength(0);
    expect(observeOrders(s, 'ojjul').rumours).toHaveLength(1);
  });

  it('leaves a public order in the log for everyone', () => {
    const s = applyOps(seed(), [{
      op: 'issue_order', factionId: 'freeworlds', type: 'fortification',
      originId: FOREIGN, targetId: FOREIGN, durationTurns: 3,
      label: 'walls anyone can see', visibility: [],
    }], 'model', 'freeworlds', true).state;
    for (const id of ['freeworlds', 'ojjul', 'vigil']) {
      expect(worldAsSeenBy(s, id).eventLog.some((e) => e.text.includes('walls anyone can see')), id).toBe(true);
    }
  });

  it('honours an explicit visibility list in the log too', () => {
    const s = applyOps(seed(), [{ ...secretOrder(), visibility: ['ojjul'] }], 'model', 'freeworlds', true).state;
    expect(worldAsSeenBy(s, 'ojjul').eventLog.some((e) => e.text.includes('the secret slipway'))).toBe(true);
    expect(worldAsSeenBy(s, 'vigil').eventLog.some((e) => e.text.includes('the secret slipway'))).toBe(false);
  });

  /**
   * The sharpest case the playtest found: the log told a world's holder that a
   * rival operative had just arrived on it, with the mission and the price.
   */
  it('does not announce a covert placement to the world it was placed on', () => {
    // Recruited at home and sent (version 11): neither the signing nor the
    // sending is the business of the world it is sent to.
    const s = applyOps(seed(), [
      { op: 'recruit_agent', systemId: 'ilv-2' },
      {
        op: 'deploy_agent', ownerFactionId: 'ojjul', systemId: FOREIGN,
        mission: 'surveillance', effect: { kind: 'intel', revealsOrders: true },
      },
    ] as OpInput[], 'model', 'ojjul', true).state;

    const told = (who: string) =>
      worldAsSeenBy(s, who).eventLog.some((e) => /signs on|leaves .* for /.test(e.text));
    expect(told('ojjul')).toBe(true);
    expect(told('freeworlds')).toBe(false);
  });

  /**
   * The line that BEGAN a secret order was scoped, and every line after it was
   * not: a completion, a cancellation, an interruption, a raid ending for want
   * of ships. Seen in a live briefing as a rival Drajk raid's "raid Oridin
   * completed at Oridin", having been a rumour to the reader its whole run.
   */
  describe('nor what becomes of a secret order', () => {
    const readBy = (s: WorldState, who: string, label: string) =>
      eventsVisibleTo(s, who).filter((e) => e.text.includes(label));
    const issued = (type: OrderType, label: string) =>
      applyOps(seed(), [{
        op: 'issue_order', factionId: 'freeworlds', type, originId: FOREIGN, targetId: FOREIGN,
        durationTurns: 5, label, visibility: [],
      }], 'model', 'freeworlds', true).state;
    const runOut = (s: WorldState) => {
      for (let i = 0; i < 6 && s.pendingOrders.length > 0; i++) s = tickTurn(s, { randomEvents: false }).state;
      expect(s.pendingOrders).toHaveLength(0);
      return s;
    };

    // One covert category and one secret yard category: both are rumours to a
    // rival, so both were leaking.
    for (const type of ['espionage', 'capital_ship_construction'] as const) {
      it(`keeps a rival's ${type} completing out of everyone else's log`, () => {
        const s = runOut(issued(type, 'the quiet work'));
        expect(readBy(s, 'freeworlds', 'the quiet work').some((e) => /completed at/.test(e.text))).toBe(true);
        for (const who of ['ojjul', 'vigil', 'meridian', 'drajk']) {
          expect(readBy(s, who, 'the quiet work'), who).toHaveLength(0);
        }
      });
    }

    it('still tells everyone when public work completes', () => {
      const s = runOut(issued('fortification', 'walls anyone saw rise'));
      for (const who of ['freeworlds', 'ojjul', 'drajk']) {
        expect(readBy(s, who, 'walls anyone saw rise').some((e) => /completed at/.test(e.text)), who).toBe(true);
      }
    });

    it('tells whoever the order chose to be seen by that it completed', () => {
      const s = runOut(applyOps(seed(), [{
        op: 'issue_order', factionId: 'freeworlds', type: 'espionage', originId: FOREIGN, targetId: FOREIGN,
        durationTurns: 2, label: 'the shared secret', visibility: ['ojjul'],
      }], 'model', 'freeworlds', true).state);
      expect(readBy(s, 'ojjul', 'the shared secret').some((e) => /completed at/.test(e.text))).toBe(true);
      expect(readBy(s, 'vigil', 'the shared secret')).toHaveLength(0);
    });

    it('keeps a cancellation, an extension and a hurry to their owner', () => {
      let s = issued('espionage', 'the recalled work');
      const id = s.pendingOrders[0]!.id;
      s = applyOps(s, [
        { op: 'extend_order', orderId: id, additionalTurns: 1, reason: 'slow going' },
        { op: 'accelerate_order', orderId: id },
        { op: 'cancel_order', orderId: id, reason: 'called home' },
      ] as OpInput[], 'model', 'freeworlds').state;
      const own = readBy(s, 'freeworlds', 'the recalled work').map((e) => e.text).join('\n');
      expect(own).toMatch(/extended/);
      expect(own).toMatch(/cancelled/);
      expect(readBy(s, 'ojjul', 'the recalled work')).toHaveLength(0);
    });

    it('tells a rival that interrupts one what it reached, and nobody else', () => {
      const s0 = issued('capital_ship_construction', 'the stood-down slipway');
      setShipsAt(s0.systems.find((x) => x.id === FOREIGN)!, 'ojjul', 3);
      const s = applyOps(s0, [
        { op: 'interrupt_order', orderId: s0.pendingOrders[0]!.id, reason: 'a fleet in orbit' },
      ] as OpInput[], 'model', 'ojjul').state;
      expect(s.pendingOrders).toHaveLength(0);
      expect(readBy(s, 'freeworlds', 'the stood-down slipway').some((e) => /broken off/.test(e.text))).toBe(true);
      expect(readBy(s, 'ojjul', 'the stood-down slipway').some((e) => /broken off/.test(e.text))).toBe(true);
      expect(readBy(s, 'vigil', 'the stood-down slipway')).toHaveLength(0);
    });

    it('does not name a dark raider when its ships are gone', () => {
      let s = createSeedState('meridian');
      const raid = { ...proposeFor(s, 'drajk')!.ops.find((o) => o.type === 'commerce_raiding')!, dark: true };
      s = applyOps(s, [raid], 'model', 'drajk').state;
      for (const sys of s.systems) setStackAt(sys, 'drajk', {});
      s = tickTurn(s, { randomEvents: false }).state;
      const ended = s.eventLog.filter((e) => /no longer has ships/.test(e.text));
      expect(ended).toHaveLength(1);
      expect(ended[0]!.visibleTo).toEqual(['drajk']);
    });

    it('replays a journal from before the rule with the lines public', () => {
      const c = Campaign.start('ojjul', 'order-lines-v16');
      c.commit([{
        op: 'issue_order', factionId: 'freeworlds', type: 'espionage', originId: FOREIGN, targetId: FOREIGN,
        durationTurns: 2, label: 'the old secret', visibility: [],
      }], 'model', 'an old secret', 'freeworlds');
      c.tick();
      c.tick();
      const line = (s: WorldState) => s.eventLog.find((e) => e.text.startsWith('the old secret completed'))!;
      expect(line(replay(c.journal).state).visibleTo).toEqual(['freeworlds']);
      expect(line(replay({ ...c.journal, version: 16 }).state).visibleTo).toBeNull();
      expect(c.verifyReplay().ok).toBe(true);
    });
  });

  it('defaults to public, so nothing written before this changed', () => {
    const s = seed();
    expect(s.eventLog.every((e) => e.visibleTo === null)).toBe(true);
    expect(worldAsSeenBy(s, 'drajk').eventLog).toHaveLength(s.eventLog.length);
  });
});
