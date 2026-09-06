import { shortestPath } from './graph.js';
import { tonsPresentAt, type StarSystem, type WorldState } from './state.js';

/**
 * Trade as a network on the hyperlane graph.
 *
 * Before this module, income was a property of systems and nothing else: a
 * world paid `strategicValue × 12` to whoever held it, and that was the entire
 * economy. Nothing could be threatened, taxed, redirected or stolen, so a
 * commercial doctrine had nothing to be a doctrine *about* — `tradeEthic` was
 * one multiplier, and `extortionist` was ×1.0, which is to say nothing at all.
 *
 * Here trade flows along lanes between hubs, and the systems it crosses take a
 * cut. That makes geography economic: the seed already put the extortionist
 * Nars on ilv-2, which sits on 74 of the galaxy's 300 shortest paths, and left
 * three more high-traffic junctions unaligned. None of it was read by anything.
 *
 * Everything in this file is pure and derived — routes are recomputed from the
 * graph, never stored — so there is no second source of truth to drift, and
 * replay reproduces every credit.
 */

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** A system this valuable both produces and consumes enough to anchor a lane. */
export const HUB_THRESHOLD = 7;

/** Credits per turn per point of combined endpoint value, before decay. */
export const ROUTE_VALUE_PER_SV = 4;

/**
 * How sharply value falls with distance. Long hauls are worth less per jump,
 * so regional trade beats galaxy-spanning trade and the map has local
 * economies rather than one undifferentiated pool.
 */
export const DISTANCE_DECAY = 0.45;

/**
 * Share of a route's value taken by its two endpoints, as producer and
 * consumer. The rest goes to whoever the lane crosses.
 *
 * Tuned against the balance harness rather than against turn-0 ledgers, which
 * measured the opening position instead of the game. At 0.4 the transit hops
 * dominated, and because the Nars hold the whole Ilvenn spine (ilv-2 and
 * ilv-5 carry 402 between them) that handed them a runaway no toll rate
 * affected. Moving value to the endpoints spreads it over the eight hubs,
 * which are held 2/2/2/1/1 rather than concentrated.
 *
 * Measured over 30 played turns: Meridian stops going insolvent, Drajk's net
 * rises from 6 to 35, the Nars fall from 302 to 268.
 */
export const ENDPOINT_SHARE = 0.6;

/**
 * What an extortionist takes off the top of foreign traffic crossing its
 * space, charged against the route's other beneficiaries.
 */
export const TOLL_RATE = 0.25;

/** What a raider diverts per turn from the transit value of a system it raids. */
export const RAID_SHARE = 0.5;

/** Smugglers raid at double effect — anyone can raid, Drajk is good at it. */
export const SMUGGLER_RAID_MULTIPLIER = 2;

/** Autarkic economies barely touch the network, by choice. */
export const AUTARKIC_ROUTE_FRACTION = 0.35;

/**
 * A monopolist's premium on a lane whose both ends it owns.
 *
 * Lowered from 1.5 when the Iron Vigil was given this doctrine — it had been
 * implemented, tested and owned by nobody, while `autarkic` was held twice.
 * The Vigil holds `tor-3 <-> tor-4`, one of only three lanes in the galaxy with
 * both ends under one power, so the ethic finally has somewhere to apply.
 *
 * Swept over 30 played turns, and the result is a **cliff rather than a
 * gradient**: at 1.4 and above the Vigil's route income funds a fleet that
 * takes `tor-1` off Meridian, which costs Meridian a hub *and* its own
 * both-ends lane, and drives it to -82 net. At 1.3 and below Meridian keeps
 * tor-1 and finishes at +31 — better than the -1 it managed before this change
 * existed. Between those, nothing moves at all: 1.3, 1.25, 1.2 and 1.15 all
 * produce an identical board, because the premium applies to a single lane
 * worth 44 and the discrete question (does Meridian keep tor-1) dominates it.
 *
 * 1.25 rather than the 1.3 that also passes, because 1.3 sits exactly on the
 * boundary and a tuning value on a cliff edge is one unrelated change away from
 * tipping back. The margin is free: the outcome is the same either way.
 */
export const MONOPOLY_BONUS = 1.25;

/**
 * How much better a smuggler is at moving cargo through lawless space, when
 * splitting the trade crossing an unaligned junction. Drajk holds no hub and
 * sits on no lane between them — it is off the network by geography — so this
 * is the trade it *can* reach without conquering anything.
 */
export const SMUGGLER_UNCLAIMED_WEIGHT = 2;

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export interface TradeRoute {
  id: string;
  /** The two hub endpoints, sorted, so a route has one canonical identity. */
  endpoints: [string, string];
  /** Full node path including both endpoints. */
  path: string[];
  jumps: number;
  /** Credits this lane is worth per turn when it runs unimpeded. */
  volume: number;
  /** Systems that sever this route while they are blockaded. */
  blockedAt: string[];
}

/** Hubs, in id order so route ids are stable across runs. */
export function tradeHubs(systems: StarSystem[]): StarSystem[] {
  return systems
    .filter((s) => s.strategicValue >= HUB_THRESHOLD)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every lane in the galaxy, derived from the graph.
 *
 * 28 routes over 25 systems: cheap enough to recompute per tick, and small
 * enough that a player can be told about the ones that matter.
 */
export function tradeRoutes(state: WorldState): TradeRoute[] {
  const hubs = tradeHubs(state.systems);
  const routes: TradeRoute[] = [];

  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const a = hubs[i]!;
      const b = hubs[j]!;
      const path = shortestPath(state.systems, a.id, b.id);
      if (!path || path.length < 2) continue;

      const jumps = path.length - 1;
      const volume = Math.round(
        ((a.strategicValue + b.strategicValue) * ROUTE_VALUE_PER_SV) /
          (1 + jumps * DISTANCE_DECAY),
      );

      routes.push({
        id: `${a.id}~${b.id}`,
        endpoints: [a.id, b.id],
        path,
        jumps,
        volume,
        blockedAt: path.filter((id) => isBlockaded(state, id)),
      });
    }
  }
  return routes;
}

/* ------------------------------------------------------------------ */
/* Interdiction                                                        */
/* ------------------------------------------------------------------ */

/** A live blockade order sitting on this system, whoever placed it. */
export function blockadesOn(state: WorldState, systemId: string): string[] {
  return state.pendingOrders
    .filter((o) => o.type === 'blockade' && o.targetId === systemId && o.progress > 0)
    .map((o) => o.factionId);
}

export function isBlockaded(state: WorldState, systemId: string): boolean {
  return blockadesOn(state, systemId).length > 0;
}

/** Factions raiding this system right now. */
export function raidersOn(state: WorldState, systemId: string): string[] {
  return state.pendingOrders
    .filter((o) => o.type === 'commerce_raiding' && o.targetId === systemId && o.progress > 0)
    .map((o) => o.factionId);
}

/**
 * Whether a faction's traffic still moves through a blockaded system.
 *
 * Two ways through, and both are doctrine made mechanical: smugglers run
 * blockades as a matter of course, and a `trade_accord` exempts its parties
 * from each other's — which is the trade treaty finally being about trade.
 */
export function runsBlockade(
  state: WorldState,
  factionId: string,
  blockaders: string[],
): boolean {
  if (blockaders.length === 0) return true;
  if (blockaders.includes(factionId)) return true; // your own blockade parts for you

  const faction = state.factions.find((f) => f.id === factionId);
  if (faction?.tradeEthic === 'smuggler') return true;

  return blockaders.every((blocker) =>
    (state.treaties ?? []).some(
      (t) =>
        t.status === 'active' &&
        t.type === 'trade_accord' &&
        t.parties.includes(factionId) &&
        t.parties.includes(blocker),
    ),
  );
}

/** Trade-accord partners are also immune to each other's commerce raiding. */
function raidLandsOn(state: WorldState, raider: string, victim: string): boolean {
  if (raider === victim) return false;
  return !(state.treaties ?? []).some(
    (t) =>
      t.status === 'active' &&
      t.type === 'trade_accord' &&
      t.parties.includes(raider) &&
      t.parties.includes(victim),
  );
}

/* ------------------------------------------------------------------ */
/* Who gets paid                                                       */
/* ------------------------------------------------------------------ */

export interface RouteEarnings {
  /** factionId -> credits from routes this turn. */
  shares: Record<string, number>;
  /** Value that reached nobody: unaligned segments and severed lanes. */
  uncollected: number;
  /** factionId -> credits taken specifically as transit tolls. */
  tolls: Record<string, number>;
  /** factionId -> credits taken from someone else by raiding. */
  raided: Record<string, number>;
  /**
   * factionId -> the monopolist premium it has earned, held back from `shares`.
   *
   * Kept out of the split on purpose. `shares` is the conserved pot — what the
   * lanes are worth, divided among the powers with a claim on them — and a test
   * asserts it never pays out more than the network is worth, which is what
   * catches a leak. A monopolist's premium is not a share of the lane, it is
   * extra value that exists *because* one power runs the whole run end to end,
   * so it is reported here and added by `ledgerFor`. That is exactly where the
   * free trader's openness bonus is already applied, for the same reason.
   */
  monopolyPremium: Record<string, number>;
  /** Fraction of all routes running unimpeded, 0–1. What free traders live on. */
  openness: number;
}

const add = (into: Record<string, number>, id: string, amount: number): void => {
  if (amount === 0) return;
  into[id] = (into[id] ?? 0) + amount;
};

/**
 * Divide every route in the galaxy among the powers that carry it.
 *
 * One pass over all routes rather than a per-faction query, because tolls and
 * raids move credits *between* factions: you cannot compute one power's take
 * without resolving everyone else's claim on the same lane.
 */
export function routeEarnings(state: WorldState): RouteEarnings {
  const shares: Record<string, number> = {};
  const tolls: Record<string, number> = {};
  const raided: Record<string, number> = {};
  const monopolyPremium: Record<string, number> = {};
  let uncollected = 0;
  let live = 0;

  const routes = tradeRoutes(state);
  const holderOf = (id: string): string | null =>
    state.systems.find((s) => s.id === id)?.controllerFactionId ?? null;

  const ethicOf = (id: string | null) =>
    id === null ? null : (state.factions.find((f) => f.id === id)?.tradeEthic ?? null);

  for (const route of routes) {
    const [aId, bId] = route.endpoints;
    const holderA = holderOf(aId);
    const holderB = holderOf(bId);

    // A blockade is resolved PER BENEFICIARY, not per lane. Deciding it once
    // for the whole route meant a smuggler only kept its trade when every
    // other party on the lane could also run the blockade — so "smugglers run
    // blockades", the Confederacy's entire economic identity, almost never
    // fired. Now the lane closes for those it closes for, and whoever can slip
    // through still gets paid.
    const blockers = route.path.flatMap((id) => blockadesOn(state, id));
    const carries = (id: string | null): boolean =>
      id !== null && runsBlockade(state, id, blockers);

    if (blockers.length > 0 && !carries(holderA) && !carries(holderB)) {
      uncollected += route.volume;
      continue;
    }
    if (blockers.length === 0) live += 1;

    const endpointPot = route.volume * ENDPOINT_SHARE;
    const transitPot = route.volume - endpointPot;

    /* --- endpoints: producer and consumer --- */
    const monopoly =
      holderA !== null && holderA === holderB && ethicOf(holderA) === 'monopolist';
    for (const holder of [holderA, holderB]) {
      const cut = endpointPot / 2;
      if (holder === null || !carries(holder)) {
        uncollected += cut;
        continue;
      }
      add(shares, holder, cut);
      // The premium rides alongside the share rather than inflating it, so the
      // conserved pot stays conserved. See `monopolyPremium`.
      if (monopoly) add(monopolyPremium, holder, cut * (MONOPOLY_BONUS - 1));
    }

    /* --- transit: whoever the lane crosses --- */
    const middle = route.path.slice(1, -1);
    if (middle.length === 0) {
      // Adjacent hubs: no intermediary, so the endpoints carry it themselves.
      for (const holder of [holderA, holderB]) {
        if (holder === null || !carries(holder)) uncollected += transitPot / 2;
        else add(shares, holder, transitPot / 2);
      }
      continue;
    }

    const perHop = transitPot / middle.length;
    for (const hopId of middle) {
      const holder = holderOf(hopId);

      // An unaligned hop pays whoever is physically moving goods through it.
      // Exactly the rule unaligned *worlds* already follow in `systemIncome`:
      // occupying is cheaper than conquering and collects without owning. It
      // also stops a third of the galaxy's trade value evaporating on the
      // three unaligned junctions the seed left on the busiest lanes.
      if (holder === null) {
        distributeUnclaimed(state, hopId, perHop, shares, (n) => (uncollected += n));
        continue;
      }
      // A carrier that cannot get past the blockade earns nothing on this leg.
      if (!carries(holder)) {
        uncollected += perHop;
        continue;
      }

      let earned = perHop;

      // Extortion: a toll on goods that are not the extortionist's own.
      // Charged to the foreign endpoints, never to itself — the Nars carry a
      // great deal of Meridian and Vigil cargo across Ilvenn, and this is
      // what "commerce owes you for passing through" costs in credits.
      const payers = [holderA, holderB].filter(
        (id): id is string => id !== null && id !== holder,
      );
      if (payers.length > 0 && ethicOf(holder) === 'extortionist') {
        const toll = perHop * TOLL_RATE * (payers.length / 2);
        for (const payer of payers) add(shares, payer, -toll / payers.length);
        add(tolls, holder, toll);
        earned += toll;
      }

      // Raiding: taken from whoever was collecting this hop.
      for (const raider of raidersOn(state, hopId)) {
        if (!raidLandsOn(state, raider, holder)) continue;
        const multiplier =
          ethicOf(raider) === 'smuggler' ? SMUGGLER_RAID_MULTIPLIER : 1;
        const stolen = Math.min(earned, earned * RAID_SHARE * multiplier);
        earned -= stolen;
        add(shares, raider, stolen);
        add(raided, raider, stolen);
      }

      add(shares, holder, earned);
    }
  }

  // Autarkic powers hold themselves apart from the network by choice.
  for (const faction of state.factions) {
    if (faction.tradeEthic !== 'autarkic') continue;
    const held = shares[faction.id];
    if (held === undefined || held <= 0) continue;
    const kept = held * AUTARKIC_ROUTE_FRACTION;
    uncollected += held - kept;
    shares[faction.id] = kept;
  }

  for (const id of Object.keys(shares)) shares[id] = Math.round(shares[id]!);
  for (const id of Object.keys(tolls)) tolls[id] = Math.round(tolls[id]!);
  for (const id of Object.keys(raided)) raided[id] = Math.round(raided[id]!);
  for (const id of Object.keys(monopolyPremium)) {
    monopolyPremium[id] = Math.round(monopolyPremium[id]!);
  }

  return {
    shares,
    uncollected: Math.round(uncollected),
    tolls,
    raided,
    monopolyPremium,
    openness: routes.length === 0 ? 1 : live / routes.length,
  };
}

/** Routes a faction has a stake in, for the UI and for prompts. */
/**
 * Split an unaligned system's trade among the fleets physically present.
 *
 * Anything nobody is there to carry is genuinely uncollected — an empty
 * junction pays no one, which is what makes the three unaligned crossroads on
 * this map worth contesting.
 */
function distributeUnclaimed(
  state: WorldState,
  systemId: string,
  amount: number,
  shares: Record<string, number>,
  spill: (n: number) => void,
): void {
  const system = state.systems.find((s) => s.id === systemId);
  // Weighed in TONS, the same way `systemIncome` splits a contested world.
  // This counted HULLS, so an escort claimed a battleship's share of a lane at
  // half the price and a third of the fighting weight — 2x income per credit,
  // and a lifter 1.33x while contributing nothing to a fight. Two conventions
  // for one rule, and the tonnage half is the one the rest of the game uses.
  const present = tonsPresentAt(system!);
  if (present.length === 0) {
    spill(amount);
    return;
  }

  const weighted = present.map(([id, n]) => {
    const ethic = state.factions.find((f) => f.id === id)?.tradeEthic;
    return [id, n * (ethic === 'smuggler' ? SMUGGLER_UNCLAIMED_WEIGHT : 1)] as const;
  });
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of weighted) add(shares, id, (amount * w) / total);
}

export function routesTouching(state: WorldState, factionId: string): TradeRoute[] {
  return tradeRoutes(state).filter((route) =>
    route.path.some(
      (id) => state.systems.find((s) => s.id === id)?.controllerFactionId === factionId,
    ),
  );
}
