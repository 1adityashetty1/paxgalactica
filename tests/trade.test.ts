import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  hullsAt,
  setShipsAt,
  ledgerFor,
  subornLimit,
  systemIncome,
  TRADE_INCOME_MULTIPLIER,
  type WorldState,
} from '../src/domain/state.js';
import {
  isBlockaded,
  raidersOn,
  routeEarnings,
  runsBlockade,
  tradeHubs,
  tradeRoutes,
} from '../src/domain/trade.js';
import type { Treaty, TreatyType } from '../src/domain/diplomacy.js';

/**
 * Trade is the first part of this game's economy that is a *network* rather
 * than a per-system number, so what these tests mostly guard is that value is
 * conserved, that every commercial doctrine measurably differs from the
 * others, and that a lane can be fought over without a battle.
 */

const fresh = (player = 'freeworlds'): WorldState => createSeedState(player);
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;

function pact(type: TreatyType, parties: [string, string], pledged: Record<string, number> = {}): Treaty {
  return {
    id: `t-${type}`,
    type,
    parties,
    terms: {
      territory: [],
      shipsPledged: pledged,
      incomePerTurn: {},
      incomeShares: [],
      mutualDefenseTrigger: '',
      voidsOn: [],
    },
    signedTurn: 0,
    expiresTurn: null,
    effectiveTurn: null,
    status: 'active',
    summary: type,
  };
}

/** Run an order to completion, however many turns it needs. */
function untilArrived(state: WorldState) {
  let r = tickTurn(state);
  let guard = 0;
  while (r.state.pendingOrders.some((o) => o.type === 'fleet_movement') && guard++ < 12) {
    r = tickTurn(r.state);
  }
  return r;
}

describe('the lane network', () => {
  it('derives routes from the graph, identically every time', () => {
    const a = tradeRoutes(fresh());
    const b = tradeRoutes(fresh());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it('runs a lane between every pair of hubs', () => {
    const state = fresh();
    const hubs = tradeHubs(state.systems);
    expect(tradeRoutes(state)).toHaveLength((hubs.length * (hubs.length - 1)) / 2);
  });

  it('routes along the same path a fleet would fly', () => {
    for (const route of tradeRoutes(fresh())) {
      expect(route.path[0]).toBe(route.endpoints[0]);
      expect(route.path[route.path.length - 1]).toBe(route.endpoints[1]);
      expect(route.jumps).toBe(route.path.length - 1);
    }
  });

  it('is worth less per jump the further the goods travel', () => {
    // Otherwise the map has one undifferentiated pool instead of regions.
    const routes = tradeRoutes(fresh()).filter((r) => r.jumps > 0);
    const near = routes.filter((r) => r.jumps === 1);
    const far = routes.filter((r) => r.jumps >= 4);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    const avg = (rs: typeof routes) => rs.reduce((n, r) => n + r.volume, 0) / rs.length;
    expect(avg(near)).toBeGreaterThan(avg(far));
  });

  it('never pays out more than the lanes are worth', () => {
    // The conservation law. Tolls move credits between factions and raids
    // move them again, so the total must still balance against volume.
    const state = fresh();
    const earnings = routeEarnings(state);
    const paid = Object.values(earnings.shares).reduce((n, v) => n + v, 0);
    const volume = tradeRoutes(state).reduce((n, r) => n + r.volume, 0);
    expect(paid + earnings.uncollected).toBeLessThanOrEqual(volume + 2); // rounding
    expect(paid).toBeGreaterThan(0);
  });

  it('leaves an empty unaligned junction paying nobody', () => {
    const state = fresh();
    // sek-6 is unaligned and on several lanes; with no fleet there its cut of
    // the traffic reaches no one, which is what makes it worth taking.
    expect(sys(state, 'sek-6').controllerFactionId).toBeNull();
    expect(routeEarnings(state).uncollected).toBeGreaterThan(0);
  });

  it('pays an unaligned junction to whoever parks a fleet on it', () => {
    // Exactly the rule unaligned worlds already follow for territory income.
    const before = routeEarnings(fresh());
    const occupied = applyOps(fresh(), [
      { op: 'adjust_ships', systemId: 'sek-6', factionId: 'drajk', delta: 5 },
    ]).state;
    const after = routeEarnings(occupied);
    expect(after.shares['drajk'] ?? 0).toBeGreaterThan(before.shares['drajk'] ?? 0);
    expect(after.uncollected).toBeLessThan(before.uncollected);
  });

  it('splits an unaligned junction by tonnage, not by hull count', () => {
    // `distributeUnclaimed` weighed `presentAt`, which counts HULLS, while
    // `systemIncome` has always split a contested world by TONS. Two
    // conventions for one rule, and the hull one reopens exactly the exploit
    // per-ton pricing exists to close: an escort is half a battleship's price
    // and a third of its fighting weight, so counting hulls paid it the same
    // share -- 2x income per credit -- and a lifter 1.33x for contributing
    // nothing to a fight at all.
    //
    // Isolated as a DELTA on one faction rather than a comparison between two.
    // `shares[id]` is a faction's route income across the whole galaxy, so
    // comparing two factions' totals says nothing about one junction: the
    // Vigil holds hubs and out-earns a raider whatever is parked at sek-6.
    // Holding Meridian's opponent fixed and changing only what MERIDIAN brings
    // -- four escorts against four battleships, the same hull count either way
    // -- moves nothing at all under hull counting.
    const junction = (hull: 'escort' | 'battleship') =>
      routeEarnings(
        applyOps(fresh(), [
          { op: 'adjust_ships', systemId: 'sek-6', factionId: 'meridian', delta: 4, hull },
          { op: 'adjust_ships', systemId: 'sek-6', factionId: 'vigil', delta: 4, hull: 'battleship' },
        ]).state,
      ).shares['meridian'] ?? 0;

    const withEscorts = junction('escort');
    const withLine = junction('battleship');
    expect(withEscorts).toBeGreaterThan(0);
    // Four battleships outweigh four escorts two to one, so they take two
    // thirds of the junction where the escorts take one third. Under hull
    // counting both arrangements are four hulls against four and these are
    // the same number.
    expect(withLine).toBeGreaterThan(withEscorts);
  });

  it('reports full openness on a galaxy with nothing interdicted', () => {
    expect(routeEarnings(fresh()).openness).toBe(1);
  });
});

describe('every commercial doctrine differs measurably', () => {
  /** The same faction, same map, different beliefs. */
  const asEthic = (ethic: WorldState['factions'][number]['tradeEthic']) => {
    const state = fresh();
    fac(state, 'meridian').tradeEthic = ethic;
    return ledgerFor(state, 'meridian');
  };

  it('gives an autarkist its territory and a free trader the network', () => {
    // The territorial multiplier runs the OTHER way on purpose: an autarkist
    // wrings more out of its own worlds precisely because it has renounced the
    // network, so comparing the two on territory alone measures the wrong half
    // of each doctrine.
    expect(TRADE_INCOME_MULTIPLIER.autarkic).toBeGreaterThan(TRADE_INCOME_MULTIPLIER.free_trade);

    const closed = asEthic('autarkic');
    const open = asEthic('free_trade');
    expect(closed.territory).toBeGreaterThan(open.territory);
    expect(open.routes).toBeGreaterThan(closed.routes);
    // On a hub-rich holding the network is worth more than the premium at
    // home, which is why Meridian is the free trader and not the recluse.
    expect(open.gross).toBeGreaterThan(closed.gross);
  });

  it('pays an extortionist a toll on other powers’ goods', () => {
    const state = fresh();
    const ojjul = ledgerFor(state, 'ojjul');
    // The Nars hold ilv-2, the greatest chokepoint on the map. Their
    // doctrine used to be a ×1.0 multiplier, i.e. nothing whatsoever.
    expect(ojjul.tolls).toBeGreaterThan(0);

    const neutered = fresh();
    fac(neutered, 'ojjul').tradeEthic = 'free_trade';
    expect(ledgerFor(neutered, 'ojjul').tolls).toBe(0);
  });

  it('charges the toll to the powers whose cargo it is', () => {
    const withOjjuls = fresh();
    const without = fresh();
    fac(without, 'ojjul').tradeEthic = 'free_trade';
    // Meridian ships a great deal through Ilvenn; it pays for the privilege.
    expect(ledgerFor(withOjjuls, 'meridian').routes).toBeLessThan(
      ledgerFor(without, 'meridian').routes,
    );
  });

  it('rewards a monopolist for owning both ends of a lane', () => {
    // Measured through `ledgerFor`, because that is where the premium lands.
    // It is deliberately NOT in `routeEarnings().shares`: that is the conserved
    // pot, and a test below asserts it never pays out more than the network is
    // worth. The premium is extra value created by running a lane end to end,
    // so it rides alongside — the same treatment the free trader's openness
    // bonus gets. Reading `shares` here would now measure nothing at all.
    const at = (ethic: 'monopolist' | 'autarkic') => {
      const state = fresh();
      for (const id of ['ilv-1', 'ilv-2']) sys(state, id).controllerFactionId = 'ojjul';
      fac(state, 'ojjul').tradeEthic = ethic;
      return { premium: routeEarnings(state).monopolyPremium['ojjul'] ?? 0, ledger: ledgerFor(state, 'ojjul') };
    };
    const monopoly = at('monopolist');
    expect(monopoly.premium).toBeGreaterThan(0);
    expect(monopoly.ledger.routes).toBeGreaterThan(at('autarkic').ledger.routes);
  });

  it('pays the premium only to a power holding both ends', () => {
    const state = fresh();
    // The Nars hold ilv-1 and ilv-2; hand one end to someone else.
    fac(state, 'ojjul').tradeEthic = 'monopolist';
    expect(routeEarnings(state).monopolyPremium['ojjul'] ?? 0).toBeGreaterThan(0);
    sys(state, 'ilv-1').controllerFactionId = 'drajk';
    expect(routeEarnings(state).monopolyPremium['ojjul'] ?? 0).toBe(0);
  });

  it('scales a free trader’s take with the openness of the whole galaxy', () => {
    // Meridian profits from everyone else's peace, which is its reason to
    // broker other powers' ceasefires rather than merely approve of them.
    const calm = fresh();
    const closed = fresh();
    setShipsAt(sys(closed, 'ilv-2'), 'vigil', 9);
    const blockaded = tickTurn(
      applyOps(closed, [
        {
          op: 'issue_order', factionId: 'vigil', type: 'blockade',
          originId: 'tor-3', targetId: 'ilv-2', durationTurns: 3, label: 'strangle',
        },
      ]).state,
    ).state;
    expect(routeEarnings(blockaded).openness).toBeLessThan(routeEarnings(calm).openness);
  });
});

describe('blockade', () => {
  const blockading = (blocker: string, at: string, from: string) => {
    const state = fresh();
    setShipsAt(sys(state, at), blocker, 9);
    const issued = applyOps(state, [
      {
        op: 'issue_order', factionId: blocker, type: 'blockade',
        originId: from, targetId: at, durationTurns: 3, label: `close ${at}`,
      },
    ]);
    expect(issued.rejections).toHaveLength(0);
    return tickTurn(issued.state).state;
  };

  it('cannot be declared without a fleet on station', () => {
    const res = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'ojjul', type: 'blockade',
        originId: 'ilv-2', targetId: 'sek-6', durationTurns: 3, label: 'by decree',
      },
    ]);
    expect(res.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(res.rejections[0]!.message).toMatch(/must sit on the system it closes/);
  });

  it('closes the lanes that cross it', () => {
    const state = blockading('vigil', 'ilv-2', 'tor-3');
    expect(isBlockaded(state, 'ilv-2')).toBe(true);
    expect(routeEarnings(state).openness).toBeLessThan(1);
    // The Nars' commerce runs through Shalka; strangling it shows.
    expect(ledgerFor(state, 'ojjul').routes).toBeLessThan(ledgerFor(fresh(), 'ojjul').routes);
  });

  it('lets a smuggler through while it closes for everyone else', () => {
    // Resolved per beneficiary, not per lane. Deciding it once for the whole
    // route meant the smuggler only kept its trade when every other party
    // could also run the blockade — so the doctrine never fired.
    const state = blockading('vigil', 'ilv-2', 'tor-3');
    const before = routeEarnings(fresh()).shares;
    const during = routeEarnings(state).shares;
    expect(fac(state, 'drajk').tradeEthic).toBe('smuggler');
    expect(during['drajk'] ?? 0).toBeGreaterThanOrEqual(before['drajk'] ?? 0);
    expect(during['ojjul'] ?? 0).toBeLessThan(before['ojjul'] ?? 0);
  });

  it('parts for a trade accord partner', () => {
    const blockers = ['vigil'];
    const state = fresh();
    expect(runsBlockade(state, 'meridian', blockers)).toBe(false);
    state.treaties.push(pact('trade_accord', ['meridian', 'vigil']));
    expect(runsBlockade(state, 'meridian', blockers)).toBe(true);
  });

  it('costs the blockader standing with everyone it strangles', () => {
    const before = fac(fresh(), 'ojjul').disposition['vigil'] ?? 0;
    const state = blockading('vigil', 'ilv-2', 'tor-3');
    const after = tickTurn(state).state;
    expect(fac(after, 'ojjul').disposition['vigil']).toBeLessThan(before);
  });

  it('ends the moment the blockading fleet is gone', () => {
    const state = blockading('vigil', 'ilv-2', 'tor-3');
    setShipsAt(sys(state, 'ilv-2'), 'vigil', 0);
    const res = tickTurn(state);
    expect(res.state.pendingOrders.filter((o) => o.type === 'blockade')).toHaveLength(0);
    expect(res.notes.join(' ')).toMatch(/no longer has ships/);
  });
});

describe('commerce raiding', () => {
  const raiding = () => {
    const state = fresh('drajk');
    setShipsAt(sys(state, 'ilv-3'), 'drajk', 6);
    const issued = applyOps(state, [
      {
        op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
        originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 5, label: 'the Riqel run',
      },
    ]);
    expect(issued.rejections).toHaveLength(0);
    return tickTurn(issued.state).state;
  };

  it('needs a squadron within one jump, but not in the system itself', () => {
    // A raid must not require beating the defenders first: that would make
    // commerce raiding something only the strong could do to the weak, which
    // is the exact inversion of what it is for.
    const far = applyOps(fresh('drajk'), [
      {
        op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
        originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 2, label: 'by decree',
      },
    ]);
    expect(far.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(far.rejections[0]!.message).toMatch(/within one jump/);

    // ilv-4 is unaligned and adjacent to the Nar-held ilv-3.
    const lurking = fresh('drajk');
    setShipsAt(sys(lurking, 'ilv-4'), 'drajk', 6);
    const near = applyOps(lurking, [
      {
        op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
        originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 3, label: 'prey on the Riqel run',
      },
    ]);
    expect(near.rejections).toHaveLength(0);
  });

  it('lets a weak power raid a stronger one it could never beat in orbit', () => {
    const state = fresh('drajk');
    setShipsAt(sys(state, 'ilv-4'), 'drajk', 6);
    const raiding = tickTurn(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
          originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 3, label: 'raid',
        },
      ]).state,
    ).state;
    // The Nars still hold Riqel and still have their fleet; they are simply
    // losing the trade that crosses it.
    expect(sys(raiding, 'ilv-3').controllerFactionId).toBe('ojjul');
    expect(ledgerFor(raiding, 'drajk').raided).toBeGreaterThan(0);
  });

  it('takes trade from the power that was carrying it', () => {
    const state = raiding();
    expect(raidersOn(state, 'ilv-3')).toEqual(['drajk']);
    expect(ledgerFor(state, 'drajk').raided).toBeGreaterThan(0);
    expect(ledgerFor(state, 'ojjul').routes).toBeLessThan(ledgerFor(fresh(), 'ojjul').routes);
  });

  it('is worth more to a smuggler than to anyone else', () => {
    const asSmuggler = ledgerFor(raiding(), 'drajk').raided;
    const state = fresh('drajk');
    fac(state, 'drajk').tradeEthic = 'autarkic';
    setShipsAt(sys(state, 'ilv-3'), 'drajk', 6);
    const plain = tickTurn(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
          originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 5, label: 'raid',
        },
      ]).state,
    ).state;
    expect(asSmuggler).toBeGreaterThan(ledgerFor(plain, 'drajk').raided);
  });

  it('costs the raider standing with its victim, every turn', () => {
    let state = raiding();
    const first = fac(state, 'ojjul').disposition['drajk'] ?? 0;
    state = tickTurn(state).state;
    const second = fac(state, 'ojjul').disposition['drajk'] ?? 0;
    state = tickTurn(state).state;
    expect(second).toBeLessThan(first);
    expect(fac(state, 'ojjul').disposition['drajk']).toBeLessThan(second);
  });

  it('spares a trade accord partner', () => {
    const state = fresh('drajk');
    state.treaties.push(pact('trade_accord', ['drajk', 'ojjul']));
    setShipsAt(sys(state, 'ilv-3'), 'drajk', 6);
    const raided = tickTurn(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
          originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 5, label: 'raid',
        },
      ]).state,
    ).state;
    expect(ledgerFor(raided, 'drajk').raided).toBe(0);
  });

  it('costs a non-smuggler its standing with the whole Rim, and Drajk nothing', () => {
    // Raiding is not banned to anyone — a cornered power turning pirate is a
    // real strategic story. But it is the Confederacy's declared trade, so
    // only an unexpected pirate pays a reputation for it.
    const raidWith = (factionId: string, from: string, at: string) => {
      const state = fresh(factionId);
      setShipsAt(sys(state, at), factionId, 6);
      let s2 = applyOps(state, [
        {
          op: 'issue_order', factionId, type: 'commerce_raiding',
          originId: from, targetId: at, durationTurns: 5, label: 'raid',
        },
      ]).state;
      s2 = tickTurn(s2).state;
      s2 = tickTurn(s2).state;
      return s2;
    };

    // Arkane is uninvolved in the Ilvenn run either way, so its opinion is a
    // clean read on reputation rather than on grievance.
    const byPirate = raidWith('vigil', 'tor-3', 'ilv-3');
    expect(fac(byPirate, 'freeworlds').disposition['vigil']).toBeLessThan(
      fac(fresh(), 'freeworlds').disposition['vigil'] ?? 0,
    );

    const byDrajk = raidWith('drajk', 'ilv-6', 'ilv-3');
    expect(fac(byDrajk, 'freeworlds').disposition['drajk']).toBe(
      fac(fresh(), 'freeworlds').disposition['drajk'],
    );
  });

  it('ends when the raiding squadron is destroyed', () => {
    const state = raiding();
    setShipsAt(sys(state, 'ilv-3'), 'drajk', 0);
    expect(tickTurn(state).state.pendingOrders.filter((o) => o.type === 'commerce_raiding')).toHaveLength(0);
  });
});

describe('treaties with mechanical force', () => {
  it('lets an ally put in to port instead of storming it', () => {
    // Without basing rights a fleet could not be stationed in friendly space
    // at all: any movement into a partner's system resolved as an attack.
    const send = (withRights: boolean) => {
      const state = fresh();
      if (withRights) state.treaties.push(pact('basing_rights', ['freeworlds', 'meridian']));
      setShipsAt(sys(state, 'ark-4'), 'freeworlds', 20);
      return untilArrived(
        applyOps(state, [
          {
            op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
            originId: 'ark-4', targetId: 'sek-1', force: 8, label: 'port call',
          },
        ]).state,
      );
    };

    const attacked = send(false);
    expect(attacked.notes.join(' ')).toMatch(/driven off|storms|thrown back|Fleets engage/);

    const welcomed = send(true);
    expect(welcomed.notes.join(' ')).toMatch(/puts in at .* under basing rights/);
    const port = welcomed.state.systems.find((s) => s.id === 'sek-1')!;
    expect(port.controllerFactionId).toBe('meridian');
    expect(hullsAt(port, 'freeworlds')).toBe(8);
  });

  it('brings pledged hulls to the battle', () => {
    const state = fresh('vigil');
    state.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    setShipsAt(sys(state, 'tor-3'), 'vigil', 30);
    // Count only the Nars' OWN worlds. The global total is a battle outcome —
    // how many of the pledged hulls survived — which is a die roll, not the
    // property being tested.
    const atHome = (s: WorldState) =>
      s.systems
        .filter((x) => x.controllerFactionId === 'ojjul')
        .reduce((n, x) => n + (hullsAt(x, 'ojjul')), 0);
    const before = atHome(state);

    const res = untilArrived(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
          originId: 'tor-3', targetId: 'tor-1', force: 25, label: 'seize it',
        },
      ]).state,
    );

    expect(res.state.eventLog.some((e) => /honours its mutual defence/.test(e.text))).toBe(true);

    // Pledging is a COST, asserted by comparison rather than by arithmetic on
    // the final position. The dispatched hulls fight, and survivors of a
    // break-off fly home again — so "before - 12" was only ever true for one
    // particular battle outcome, not for the mechanic.
    const withoutPact = untilArrived(
      applyOps(
        (() => {
          const bare = fresh('vigil');
          setShipsAt(sys(bare, 'tor-3'), 'vigil', 30);
          return bare;
        })(),
        [
          {
            op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
            originId: 'tor-3', targetId: 'tor-1', force: 25, label: 'seize it',
          },
        ],
      ).state,
    );
    const ojjulTotal = (s: WorldState) => s.systems.reduce((n, x) => n + (hullsAt(x, 'ojjul')), 0);
    expect(ojjulTotal(res.state)).toBeLessThan(ojjulTotal(withoutPact.state));
  });

  it('does not call in a pledge against the pledger', () => {
    const state = fresh('ojjul');
    state.treaties.push(pact('mutual_defense', ['meridian', 'ojjul'], { ojjul: 12 }));
    setShipsAt(sys(state, 'ilv-1'), 'ojjul', 30);
    const res = untilArrived(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'ojjul', type: 'fleet_movement',
          originId: 'ilv-1', targetId: 'ark-1', force: 20, label: 'attack',
        },
      ]).state,
    );
    expect(res.state.eventLog.some((e) => /honours its mutual defence/.test(e.text))).toBe(false);
  });

  it('makes attacking a pact partner a betrayal the whole Rim sees', () => {
    const state = fresh('vigil');
    state.treaties.push(pact('non_aggression', ['vigil', 'meridian']));
    const before = Object.fromEntries(
      state.factions.map((f) => [f.id, f.disposition['vigil'] ?? 0]),
    );
    setShipsAt(sys(state, 'tor-3'), 'vigil', 30);

    const res = untilArrived(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
          originId: 'tor-3', targetId: 'tor-1', force: 25, label: 'break it',
        },
      ]).state,
    );

    expect(res.state.treaties[0]!.status).toBe('broken');
    // The injured party feels a grievance...
    expect(fac(res.state, 'meridian').disposition['vigil']).toBe(before['meridian']! - 25);
    // ...and every onlooker revises its opinion of a power that does this.
    for (const witness of ['ojjul', 'freeworlds', 'drajk']) {
      expect(fac(res.state, witness).disposition['vigil'], witness).toBe(before[witness]! - 10);
    }
  });

  it('costs nothing extra to attack someone you never swore peace with', () => {
    const state = fresh('vigil');
    const before = fac(state, 'drajk').disposition['vigil'] ?? 0;
    setShipsAt(sys(state, 'tor-3'), 'vigil', 30);
    const res = untilArrived(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
          originId: 'tor-3', targetId: 'tor-1', force: 25, label: 'attack',
        },
      ]).state,
    );
    expect(fac(res.state, 'drajk').disposition['vigil']).toBe(before);
  });
});

describe('trade stays deterministic', () => {
  it('replays a blockaded, raided galaxy identically', () => {
    const build = () => {
      let state = fresh('drajk');
      setShipsAt(sys(state, 'ilv-3'), 'drajk', 6);
      setShipsAt(sys(state, 'ilv-2'), 'vigil', 9);
      state = applyOps(state, [
        {
          op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding',
          originId: 'ilv-6', targetId: 'ilv-3', durationTurns: 5, label: 'raid',
        },
        {
          op: 'issue_order', factionId: 'vigil', type: 'blockade',
          originId: 'tor-3', targetId: 'ilv-2', durationTurns: 5, label: 'blockade',
        },
      ]).state;
      for (let i = 0; i < 4; i++) state = tickTurn(state).state;
      return state;
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('arbitration: rulings the op vocabulary cannot express', () => {
  const marry = (state: WorldState, partner: string) =>
    applyOps(state, [
      {
        op: 'establish_commitment',
        kind: 'dynastic_marriage',
        factionIds: ['freeworlds', partner],
        text: `The Free Worlds seal an alliance with ${partner} by marriage.`,
        exclusive: true,
      },
    ]);

  it('records an arrangement that is nothing else in the game', () => {
    const res = marry(fresh(), 'ojjul');
    expect(res.rejections).toHaveLength(0);
    expect(res.state.commitments).toHaveLength(1);
    expect(res.state.commitments[0]).toMatchObject({
      kind: 'dynastic_marriage',
      exclusive: true,
      status: 'active',
      establishedTurn: 0,
    });
  });

  it('refuses a second exclusive commitment, in the reducer', () => {
    // The point of holding these in world state: the arbiter would have to
    // remember turn 3 on turn 4, and a prompt is exactly what cannot be
    // relied on for that.
    const once = marry(fresh(), 'ojjul').state;
    const twice = marry(once, 'meridian');
    expect(twice.rejections.map((r) => r.code)).toEqual(['commitment_conflict']);
    expect(twice.state.commitments).toHaveLength(1);
    // The rejection names the blocker so the player can act on it.
    expect(twice.rejections[0]!.message).toMatch(/Already bound/);
    expect(twice.rejections[0]!.message).toMatch(/dissolve that one first/);
  });

  it('allows the second once the first is dissolved', () => {
    const once = marry(fresh(), 'ojjul').state;
    const freed = applyOps(once, [
      { op: 'dissolve_commitment', commitmentId: once.commitments[0]!.id, reason: 'annulled' },
    ]).state;
    expect(marry(freed, 'meridian').rejections).toHaveLength(0);
  });

  it('does not block a different kind, or an unrelated faction', () => {
    const state = marry(fresh(), 'ojjul').state;
    const charter = applyOps(state, [
      {
        op: 'establish_commitment', kind: 'exclusive_charter',
        factionIds: ['freeworlds', 'drajk'], text: 'Sole carrier rights in the Drift.',
        exclusive: true,
      },
    ]);
    expect(charter.rejections).toHaveLength(0);

    const others = applyOps(state, [
      {
        op: 'establish_commitment', kind: 'dynastic_marriage',
        factionIds: ['vigil', 'drajk'], text: 'An Imperial match.', exclusive: true,
      },
    ]);
    expect(others.rejections).toHaveLength(0);
  });

  it('lets a non-exclusive arrangement repeat', () => {
    let state = fresh();
    for (const partner of ['ojjul', 'meridian', 'drajk']) {
      const res = applyOps(state, [
        {
          op: 'establish_commitment', kind: 'friendship_accord',
          factionIds: ['freeworlds', partner], text: `Warm words with ${partner}.`,
          exclusive: false,
        },
      ]);
      expect(res.rejections).toHaveLength(0);
      state = res.state;
    }
    expect(state.commitments).toHaveLength(3);
  });

  it('rejects a malformed kind rather than storing an unmatchable slug', () => {
    // Exclusivity is checked on this string, so an inconsistent slug would
    // silently disable the whole mechanism.
    const res = applyOps(fresh(), [
      {
        op: 'establish_commitment', kind: 'Marriage To The Nars',
        factionIds: ['freeworlds'], text: 'x', exclusive: true,
      },
    ]);
    expect(res.rejections.map((r) => r.code)).toEqual(['schema_invalid']);
  });

  it('survives replay, because commitments are world state', async () => {
    const { Campaign } = await import('../src/engine/campaign.js');
    const { MemoryCampaignStore } = await import('../src/engine/store.js');
    const campaign = Campaign.start('freeworlds', 'vows', new MemoryCampaignStore());
    campaign.commit(
      [
        {
          op: 'establish_commitment', kind: 'dynastic_marriage',
          factionIds: ['freeworlds', 'ojjul'], text: 'A match with the Combine.',
          exclusive: true,
        },
      ],
      'model',
      'marriage',
    );
    campaign.tick();
    expect(campaign.verifyReplay().ok).toBe(true);
    expect(campaign.state.commitments).toHaveLength(1);
  });
});

describe('suborning crews: presence and a stat contest, not a sentence', () => {
  const totalShips = (s: WorldState, f: string) =>
    s.systems.reduce((n, x) => n + (hullsAt(x, f)), 0);

  /** The op shape a playtest actually produced, as the acting faction. */
  const suborn = (s: WorldState, at: string, from: string, n: number, actor = 'drajk') =>
    applyOps(
      s,
      [
        { op: 'adjust_ships', systemId: at, factionId: from, delta: -n },
        { op: 'adjust_ships', systemId: at, factionId: actor, delta: n },
      ],
      'model',
      actor,
    );

  it('refuses a faction with no ships and no agent there', () => {
    // The original hole: this moved thirty hulls from across the galaxy.
    const res = suborn(fresh('drajk'), 'ilv-2', 'ojjul', 30);
    expect(res.rejections.map((r) => r.code)).toContain('no_presence');
    expect(totalShips(res.state, 'ojjul')).toBe(totalShips(fresh(), 'ojjul'));
  });

  it('allows it where you have ships, capped by guile against resolve', () => {
    const state = fresh('drajk');
    setShipsAt(sys(state, 'ilv-2'), 'drajk', 3);
    const limit = subornLimit(state, 'drajk', 'ojjul');
    expect(limit).toBeGreaterThan(0);

    const res = suborn(state, 'ilv-2', 'ojjul', 30);
    expect(res.rejections.filter((r) => r.code === 'no_presence')).toHaveLength(0);
    // Asked for 30, got the limit — trimmed, and said so, rather than rejected.
    expect(totalShips(state, 'ojjul') - totalShips(res.state, 'ojjul')).toBe(limit);
    expect(res.notes.join(' ')).toMatch(/could only talk \d+ of 30/);
  });

  it('allows it where you have an agent instead of a fleet', () => {
    const state = fresh('drajk');
    state.agents.push({
      id: 'a1', ownerFactionId: 'drajk', systemId: 'ilv-2', mission: 'defection',
      effect: { kind: 'crew_defection', perTurn: 2 },
      successChance: 60, exposed: false, deployedTurn: 0, cover: 'a quiet word',
    });
    const res = suborn(state, 'ilv-2', 'ojjul', 2);
    expect(res.rejections).toHaveLength(0);
    expect(totalShips(res.state, 'drajk')).toBe(totalShips(state, 'drajk') + 2);
  });

  it('cannot suborn a resolute power at all, however much guile', () => {
    // Iron Vigil resolve 17, Arkane 19. Their crews do not defect, which is
    // what a defining stat ought to mean.
    const state = fresh('drajk');
    setShipsAt(sys(state, 'tor-3'), 'drajk', 5);
    expect(subornLimit(state, 'drajk', 'vigil')).toBe(0);
    const res = suborn(state, 'tor-3', 'vigil', 3);
    expect(res.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(totalShips(res.state, 'vigil')).toBe(totalShips(state, 'vigil'));
  });

  it('leaves a faction free to move its own ships as before', () => {
    const state = fresh('drajk');
    const res = applyOps(
      state,
      [
        { op: 'adjust_ships', systemId: 'ilv-6', factionId: 'drajk', delta: -5 },
        { op: 'adjust_ships', systemId: 'ilv-7', factionId: 'drajk', delta: 5 },
      ],
      'model',
      'drajk',
    );
    expect(res.rejections).toHaveLength(0);
    expect(totalShips(res.state, 'drajk')).toBe(totalShips(state, 'drajk'));
  });

  it('holds NPCs to the same rule as the player', () => {
    const res = suborn(fresh('drajk'), 'sek-1', 'meridian', 6, 'ojjul');
    expect(res.rejections.map((r) => r.code)).toContain('no_presence');
  });

  it('still applies no guard when no actor is known, so old journals replay', () => {
    const res = applyOps(
      fresh('drajk'),
      [{ op: 'adjust_ships', systemId: 'ilv-2', factionId: 'ojjul', delta: -5 }],
      'model',
    );
    expect(res.rejections).toHaveLength(0);
  });

  it('scales the limit off the two stats, not a constant', () => {
    const state = fresh('drajk');
    const before = subornLimit(state, 'drajk', 'ojjul');
    fac(state, 'drajk').stats.guile = 20;
    expect(subornLimit(state, 'drajk', 'ojjul')).toBeGreaterThan(before);
    fac(state, 'ojjul').stats.resolve = 20;
    expect(subornLimit(state, 'drajk', 'ojjul')).toBeLessThan(
      subornLimit(fresh('drajk'), 'drajk', 'meridian') + 99,
    );
  });
});

describe('the defection agent mission', () => {
  const withAgent = (perTurn: number, target = 'ojjul', at = 'ilv-2') => {
    const state = fresh('drajk');
    state.agents.push({
      id: 'a1', ownerFactionId: 'drajk', systemId: at, mission: 'defection',
      effect: { kind: 'crew_defection', perTurn },
      successChance: 100, exposed: false, deployedTurn: 0, cover: 'quiet words',
    });
    return { state, target };
  };

  it('moves hulls across rather than destroying them', () => {
    const { state } = withAgent(2);
    const ojjulBefore = state.systems.reduce((n, s) => n + (hullsAt(s, 'ojjul')), 0);
    const drajkBefore = state.systems.reduce((n, s) => n + (hullsAt(s, 'drajk')), 0);

    const after = tickTurn(state).state;
    const ojjulAfter = after.systems.reduce((n, s) => n + (hullsAt(s, 'ojjul')), 0);
    const drajkAfter = after.systems.reduce((n, s) => n + (hullsAt(s, 'drajk')), 0);

    expect(ojjulBefore - ojjulAfter).toBeGreaterThan(0);
    expect(drajkAfter - drajkBefore).toBe(ojjulBefore - ojjulAfter);
  });

  it('never exceeds the stat contest, however greedy the effect', () => {
    const { state } = withAgent(4);
    const limit = subornLimit(state, 'drajk', 'ojjul');
    const before = state.systems.reduce((n, s) => n + (hullsAt(s, 'ojjul')), 0);
    const after = tickTurn(state).state;
    expect(before - after.systems.reduce((n, s) => n + (hullsAt(s, 'ojjul')), 0)).toBeLessThanOrEqual(limit);
  });

  it('charges for the hulls, so it is not a free shipyard', () => {
    const { state } = withAgent(2);
    const purse = fac(state, 'drajk').credits;
    const after = tickTurn(state).state;
    expect(fac(after, 'drajk').credits).toBeLessThan(purse);
  });

  it('finds no takers against a resolute power', () => {
    const { state } = withAgent(3, 'vigil', 'tor-3');
    const before = state.systems.reduce((n, s) => n + (hullsAt(s, 'vigil')), 0);
    const res = tickTurn(state);
    expect(res.state.systems.reduce((n, s) => n + (hullsAt(s, 'vigil')), 0)).toBe(before);
    expect(res.state.eventLog.some((e) => /find no takers/.test(e.text))).toBe(true);
  });

  it('is a humiliation the victim remembers', () => {
    const { state } = withAgent(2);
    const before = fac(state, 'ojjul').disposition['drajk'] ?? 0;
    expect(fac(tickTurn(state).state, 'ojjul').disposition['drajk']).toBeLessThan(before);
  });
});

describe('an invited fleet is a guest, not a rival', () => {
  const withFleet = (treatyType: TreatyType | null) => {
    const state = fresh('meridian');
    if (treatyType) state.treaties.push(pact(treatyType, ['meridian', 'freeworlds']));
    return applyOps(
      state,
      [{ op: 'adjust_ships', systemId: 'sek-1', factionId: 'freeworlds', delta: 8 }],
      'engine',
    ).state;
  };
  const income = (s: WorldState) => systemIncome(s, sys(s, 'sek-1'));

  it('contests a world when nothing permits the visit', () => {
    const inc = income(withFleet(null));
    expect(inc.contested).toBe(true);
    expect(inc.shares['freeworlds']).toBeGreaterThan(0);
  });

  it('takes nothing where basing rights were granted', () => {
    // The treaty exists to let an ally station ships with you. Making that
    // ally skim your income made it actively harmful to sign.
    const inc = income(withFleet('basing_rights'));
    expect(inc.contested).toBe(false);
    expect(inc.shares['freeworlds']).toBeUndefined();
    expect(inc.shares['meridian']).toBe(income(fresh('meridian')).shares['meridian']);
  });

  it('does not tax a power for being defended', () => {
    // `mutual_defense` DISPATCHES an ally's hulls into your system. Honouring
    // the pact, taking losses and saving the world should not end with your
    // rescuer contesting your income.
    const inc = income(withFleet('mutual_defense'));
    expect(inc.contested).toBe(false);
    expect(inc.shares['freeworlds']).toBeUndefined();
  });

  it('still contests under pacts that grant no right to be there', () => {
    // A trade accord is about lanes; a non-aggression pact is a promise not to
    // attack. Neither is permission to sit in someone's orbit, so a fleet
    // there remains leverage.
    for (const type of ['trade_accord', 'non_aggression'] as const) {
      expect(income(withFleet(type)).contested, type).toBe(true);
    }
  });

  it('is not mutual by accident: the guest earns nothing, the holder loses nothing', () => {
    const guested = withFleet('basing_rights');
    expect(ledgerFor(guested, 'freeworlds').territory).toBe(
      ledgerFor(fresh('meridian'), 'freeworlds').territory,
    );
  });

  it('lapses with the treaty', () => {
    const state = fresh('meridian');
    const expiring = pact('basing_rights', ['meridian', 'freeworlds']);
    expiring.expiresTurn = 1;
    state.treaties.push(expiring);
    state.turn = 5; // well past expiry
    const withShips = applyOps(
      state,
      [{ op: 'adjust_ships', systemId: 'sek-1', factionId: 'freeworlds', delta: 8 }],
      'engine',
    ).state;
    expect(systemIncome(withShips, sys(withShips, 'sek-1')).contested).toBe(true);
  });

  it('does not make a guest immune to being counted in a battle', () => {
    // Guest status is an ECONOMIC rule. An ally in orbit still defends the
    // world it is sitting on, which is the safe default in `resolveBattle`.
    const state = fresh('vigil');
    state.treaties.push(pact('basing_rights', ['meridian', 'freeworlds']));
    setShipsAt(sys(state, 'sek-1'), 'freeworlds', 20);
    setShipsAt(sys(state, 'ark-2'), 'vigil', 12);
    const res = untilArrived(
      applyOps(state, [
        {
          op: 'issue_order', factionId: 'vigil', type: 'fleet_movement',
          originId: 'ark-2', targetId: 'sek-1', force: 10, label: 'strike',
        },
      ]).state,
    );
    // The Free Worlds squadron fought for its host rather than watching.
    expect(res.notes.join(' ')).toMatch(/driven off|breaks off|Fleets engage|still hold/);
    expect(sys(res.state, 'sek-1').controllerFactionId).toBe('meridian');
  });
});

describe('suborning is statecraft, not combat', () => {
  const totalShips = (s: WorldState, f: string) =>
    s.systems.reduce((n, x) => n + (hullsAt(x, f)), 0);
  const disp = (s: WorldState, a: string, b: string) =>
    s.factions.find((f) => f.id === a)!.disposition[b] ?? 0;

  /** Drajk lurking at the unaligned ilv-4, which is adjacent to Nar ilv-3. */
  const fromNextDoor = (n = 3) => {
    const state = fresh('drajk');
    setShipsAt(sys(state, 'ilv-4'), 'drajk', 8);
    return {
      before: state,
      res: applyOps(
        state,
        [
          { op: 'adjust_ships', systemId: 'ilv-3', factionId: 'ojjul', delta: -n },
          { op: 'adjust_ships', systemId: 'ilv-4', factionId: 'drajk', delta: n },
        ],
        'model',
        'drajk',
      ),
    };
  };

  it('reaches one jump out, so you need not win a battle first', () => {
    // Requiring ships IN the system meant suborning was something you did to a
    // power you had already beaten — the same inversion that made commerce
    // raiding useless to the weak.
    const { before, res } = fromNextDoor();
    expect(res.rejections).toHaveLength(0);
    expect(totalShips(res.state, 'ojjul')).toBeLessThan(totalShips(before, 'ojjul'));
  });

  it('fights nothing: the world, its holder and its garrison are untouched', () => {
    const { before, res } = fromNextDoor();
    const target = sys(res.state, 'ilv-3');
    expect(target.controllerFactionId).toBe('ojjul');
    expect(target.garrison).toBe(sys(before, 'ilv-3').garrison);
    expect(res.notes.join(' ')).not.toMatch(/engage|storms|driven off|thrown back/);
    expect(res.notes.join(' ')).toMatch(/without a shot fired/);
  });

  it('bills the victim per hull and every onlooker for the act', () => {
    const { before, res } = fromNextDoor(3);
    expect(disp(res.state, 'ojjul', 'drajk')).toBe(disp(before, 'ojjul', 'drajk') - 6 * 3);
    for (const witness of ['meridian', 'vigil', 'freeworlds']) {
      expect(disp(res.state, witness, 'drajk'), witness).toBe(
        disp(before, witness, 'drajk') - 2,
      );
    }
  });

  it('costs the same however you do it, fleet or agent', () => {
    // Two routes to one outcome should not be priced differently, or the
    // cheaper one is the only one anybody uses.
    const byFleet = fromNextDoor(2);
    const perHullFleet =
      (disp(byFleet.before, 'ojjul', 'drajk') - disp(byFleet.res.state, 'ojjul', 'drajk')) / 2;

    const withAgent = fresh('drajk');
    withAgent.agents.push({
      id: 'a1', ownerFactionId: 'drajk', systemId: 'ilv-2', mission: 'defection',
      effect: { kind: 'crew_defection', perTurn: 2 },
      successChance: 100, exposed: false, deployedTurn: 0, cover: 'quiet words',
    });
    const beforeAgent = disp(withAgent, 'ojjul', 'drajk');
    const ticked = tickTurn(withAgent).state;
    const turned = totalShips(withAgent, 'ojjul') - totalShips(ticked, 'ojjul');
    const perHullAgent = (beforeAgent - disp(ticked, 'ojjul', 'drajk')) / turned;

    expect(perHullFleet).toBe(perHullAgent);
  });

  it('is still refused from two jumps away', () => {
    const state = fresh('drajk');
    setShipsAt(sys(state, 'ilv-6'), 'drajk', 20); // ilv-6 is not adjacent to ilv-2
    const res = applyOps(
      state,
      [{ op: 'adjust_ships', systemId: 'ilv-2', factionId: 'ojjul', delta: -3 }],
      'model',
      'drajk',
    );
    expect(res.rejections.map((r) => r.code)).toContain('no_presence');
  });

  it('charges nothing to a faction moving its own ships', () => {
    const state = fresh('drajk');
    const before = disp(state, 'ojjul', 'drajk');
    const res = applyOps(
      state,
      [
        { op: 'adjust_ships', systemId: 'ilv-6', factionId: 'drajk', delta: -4 },
        { op: 'adjust_ships', systemId: 'ilv-7', factionId: 'drajk', delta: 4 },
      ],
      'model',
      'drajk',
    );
    expect(disp(res.state, 'ojjul', 'drajk')).toBe(before);
    expect(res.notes.join(' ')).not.toMatch(/without a shot fired/);
  });
});

describe('a guest is paid by its treaty, never by presence', () => {
  const hosted = (shares: { systemId: string; factionId: string; share: number }[]) => {
    const state = fresh('meridian');
    const treaty = pact('basing_rights', ['meridian', 'freeworlds']);
    treaty.terms.incomeShares = shares;
    state.treaties.push(treaty);
    return applyOps(
      state,
      [{ op: 'adjust_ships', systemId: 'sek-1', factionId: 'freeworlds', delta: 8 }],
      'engine',
    ).state;
  };

  it('pays a guest nothing when the treaty says nothing', () => {
    const inc = systemIncome(hosted([]), sys(hosted([]), 'sek-1'));
    expect(inc.shares['freeworlds']).toBeUndefined();
  });

  it('pays a guest exactly what the treaty negotiated, and marks it as such', () => {
    // One mechanism for "a treaty moves income", not two. A garrisoning ally
    // is paid by agreement, never by helping itself to a contest share.
    const state = hosted([{ systemId: 'sek-1', factionId: 'freeworlds', share: 0.2 }]);
    const inc = systemIncome(state, sys(state, 'sek-1'));
    expect(inc.byTreaty).toContain('freeworlds');
    expect(inc.shares['freeworlds']).toBe(Math.round(inc.base * 0.2));
    // And the host keeps the rest in full — presence took nothing extra.
    expect(inc.shares['meridian']).toBeGreaterThan(0);
    expect(inc.contested).toBe(false);
  });

  it('never pays out more than the world is worth', () => {
    const state = hosted([{ systemId: 'sek-1', factionId: 'freeworlds', share: 0.5 }]);
    const inc = systemIncome(state, sys(state, 'sek-1'));
    const paid = Object.values(inc.shares).reduce((n, v) => n + v, 0);
    expect(paid).toBeLessThanOrEqual(inc.base + 1);
  });
});
