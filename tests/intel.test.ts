import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  COVERT_CATEGORIES,
  PUBLIC_CATEGORIES,
  SECRET_CATEGORIES,
  observeOrders,
  ordersVisibleTo,
  visibilityOf,
  worldAsSeenBy,
} from '../src/domain/intel.js';
import { DURATION_CATEGORIES } from '../src/domain/duration.js';
import {
  hullsAt,
  setShipsAt, fleetStrengthOf, shipsInTransit, type OrderType, type WorldState } from '../src/domain/state.js';

/**
 * Intelligence, from the player's side.
 *
 * Before this existed, `ordersVisibleTo` had one caller — the prompt
 * serializer — and every player-facing path read `state.pendingOrders` whole.
 * A campaign played expressly to spy ran four surveillance operatives for
 * seven turns and produced nothing, because nothing was hidden to find.
 */

const seed = () => createSeedState('hutt');

/** A world nobody in `hutt`'s employ can see into: Free Worlds space, no Nar ships. */
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

const seeOne = (s: WorldState, me = 'hutt') => visibilityOf(s, me, s.pendingOrders[0]!);

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
  /** Give `hutt` a hull at the Free Worlds capital, so the world is in its space. */
  const withShips = (s: WorldState): WorldState => {
    const sys = s.systems.find((x) => x.id === FOREIGN)!;
    setShipsAt(sys, 'hutt', 3);
    return s;
  };

  it('reveals physical work happening in your own space', () => {
    // A rival refitting hulls over a world you stand on is in front of your
    // own dockmasters.
    const s = withShips(withOrder('refit'));
    expect(seeOne(s)).toBe('full');
  });

  it('reveals physical work on a world you control', () => {
    const s = withOrder('retooling', { target: 'kes-2' }); // a Nar-held world
    expect(s.systems.find((x) => x.id === 'kes-2')!.controllerFactionId).toBe('hutt');
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
      // `commerce_raiding` is the one covert category the reducer will not
      // issue without a fleet in reach, so the raider gets one. That is the
      // interesting case rather than an awkward one: the hulls ARE visible in
      // `system.ships`, and the order still is not.
      const staged = s.systems.find((x) => x.id === 'kes-2')!;
      setShipsAt(staged, 'freeworlds', 4);
      s = applyOps(s, [
        {
          op: 'issue_order',
          factionId: 'freeworlds',
          type: t,
          originId: 'kes-2',
          targetId: 'kes-2',
          durationTurns: 3,
          label: 'the thing itself',
          visibility: [],
        },
      ], 'model').state;

      expect(s.pendingOrders, `${t} was not issued`).toHaveLength(1);
      expect(seeOne(s), `${t} on a world hutt controls`).toBe('rumour');
      // The ships are not redacted, and should not be: you can see raiders
      // gathering without knowing a raid is the plan.
      expect(hullsAt(s.systems.find((x) => x.id === 'kes-2')!, 'freeworlds')).toBe(4);
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
        ownerFactionId: 'hutt',
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

describe('a rumour', () => {
  it('names a place and a clock and nothing else', () => {
    const s = withOrder('capital_ship_construction');
    const { orders, rumours } = observeOrders(s, 'hutt');

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
    const [rumour] = observeOrders(s, 'hutt').rumours;
    expect(Object.keys(rumour!).sort()).toEqual(
      ['durationTurns', 'factionId', 'progress', 'systemId'],
    );

    // And the reducer refuses the real id anyway when it is not known — but the
    // point is that the player never receives it.
    expect(JSON.stringify(rumour)).not.toContain(s.pendingOrders[0]!.id);
  });

  it('does not leak the label or the type', () => {
    const s = withOrder('capital_ship_construction');
    const json = JSON.stringify(observeOrders(s, 'hutt').rumours);
    expect(json).not.toContain('the thing itself');
    expect(json).not.toContain('capital_ship_construction');
  });
});

describe('the acting power can choose to be seen', () => {
  it('honours an explicit visibility list even for covert work', () => {
    const s = withOrder('espionage', { visibility: ['hutt'] });
    expect(seeOne(s)).toBe('full');
  });

  it('always shows you your own orders', () => {
    const s = withOrder('espionage', { faction: 'hutt' });
    expect(seeOne(s)).toBe('full');
    expect(ordersVisibleTo(s, 'hutt')).toHaveLength(1);
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

    const seen = worldAsSeenBy(s, 'hutt');
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
    owner = 'hutt',
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
    s = deploy(s, 'surveillance', { kind: 'intel', revealsOrders: true }, 'kes-2', 'freeworlds');
    s = tickTurn(s).state;

    const lines = intelLines(s);
    expect(lines).toHaveLength(1);
    expect(s.eventLog.filter((e) => e.kind === 'intel').every((e) => e.factionId === 'hutt')).toBe(true);
  });

  it('reports a burned operative as burned', () => {
    let s = deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true });
    s.agents[0]!.exposed = true;
    s = tickTurn(s).state;
    expect(intelLines(s)[0]).toMatch(/burned/i);
  });

  it('says so when the posting has nobody to work against', () => {
    // kes-4 is unaligned in the seed: nobody to watch.
    const s = tickTurn(
      deploy(seed(), 'surveillance', { kind: 'intel', revealsOrders: true }, 'kes-4'),
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
    expect(line('hutt'), 'a rival must not read it out of the log').toBe(false);
    // And the redaction of the order itself still holds, so the two agree.
    expect(observeOrders(s, 'hutt').orders).toHaveLength(0);
    expect(observeOrders(s, 'hutt').rumours).toHaveLength(1);
  });

  it('leaves a public order in the log for everyone', () => {
    const s = applyOps(seed(), [{
      op: 'issue_order', factionId: 'freeworlds', type: 'fortification',
      originId: FOREIGN, targetId: FOREIGN, durationTurns: 3,
      label: 'walls anyone can see', visibility: [],
    }], 'model', 'freeworlds', true).state;
    for (const id of ['freeworlds', 'hutt', 'vigil']) {
      expect(worldAsSeenBy(s, id).eventLog.some((e) => e.text.includes('walls anyone can see')), id).toBe(true);
    }
  });

  it('honours an explicit visibility list in the log too', () => {
    const s = applyOps(seed(), [{ ...secretOrder(), visibility: ['hutt'] }], 'model', 'freeworlds', true).state;
    expect(worldAsSeenBy(s, 'hutt').eventLog.some((e) => e.text.includes('the secret slipway'))).toBe(true);
    expect(worldAsSeenBy(s, 'vigil').eventLog.some((e) => e.text.includes('the secret slipway'))).toBe(false);
  });

  /**
   * The sharpest case the playtest found: the log told a world's holder that a
   * rival operative had just arrived on it, with the mission and the price.
   */
  it('does not announce a covert placement to the world it was placed on', () => {
    const s = applyOps(seed(), [{
      op: 'deploy_agent', ownerFactionId: 'hutt', systemId: FOREIGN,
      mission: 'surveillance', effect: { kind: 'intel', revealsOrders: true },
    }], 'model', 'hutt', true).state;

    expect(worldAsSeenBy(s, 'hutt').eventLog.some((e) => /places an agent/.test(e.text))).toBe(true);
    expect(worldAsSeenBy(s, 'freeworlds').eventLog.some((e) => /places an agent/.test(e.text))).toBe(false);
  });

  it('defaults to public, so nothing written before this changed', () => {
    const s = seed();
    expect(s.eventLog.every((e) => e.visibleTo === null)).toBe(true);
    expect(worldAsSeenBy(s, 'krayt').eventLog).toHaveLength(s.eventLog.length);
  });
});
