import { applyOps, tickTurn } from './domain/reducer.js';
import { createSeedState } from './seed/scenario.js';
import {
  HULL_CLASSES,
  battleshipEquivalents,
  hullCost,
  type HullClass,
  type ShipStack,
} from './domain/hulls.js';
import { WorldStateSchema, addShipsAt, fleetTonsOf, orbitalWeightAt, type WarEthic, type WorldState } from './domain/state.js';

/**
 * Does fleet composition actually decide a battle, and which mix wins?
 *
 * `balance.ts` plays five doctrine bots across a whole galaxy to ask whether a
 * *doctrine* pays. This asks a narrower question the same way: **at equal
 * credits, which composition wins?** It exists because the question kept being
 * answered with one-off scripts, and a one-off script answered it wrong three
 * times running — once from a single seeded roll, once from a single defender,
 * and once from a control that was equal in tonnage while being unequal in
 * fighting weight.
 *
 * Every trial goes through the real reducer. What is stripped is the galaxy
 * around the battle: two systems, two factions, no trade network and no agents,
 * which takes a trial from 6.6ms to 0.3ms and makes a 20,000-battle tournament
 * a six-second job rather than a two-minute one.
 *
 * ## Three dimensions, because each of them has already flipped a conclusion
 *
 * - **The roll.** A battle's swing is `(roll - 10.5) / 22`, so it moves each
 *   side by up to 43% and a raw 2:1 lands anywhere from 1.2:1 to 3.4:1. One
 *   battle measures its roll, not the odds.
 * - **The holder's war ethic.** `crusading` never breaks off, so against it
 *   every fight is an exchange and a screen is decisive; against everyone else
 *   the 2:1 break-off usually settles it and a screen buys nothing. Measuring
 *   only the Vigil produced exactly the wrong general claim.
 * - **The garrison.** It decides how much lift has to survive the orbitals,
 *   which is the whole reason the attacker's mix is a decision at all.
 */

/** One side's fleet, and what it cost. */
export interface Composition {
  stack: ShipStack;
  cost: number;
  /** Distinct classes with at least one hull. */
  classes: number;
  label: string;
}

export interface TrialOutcome {
  took: boolean;
  /** Why it ended, for reading the shape of a loss rather than only its fact. */
  why: 'taken' | 'no_lift' | 'no_landing' | 'driven_off' | 'unopposed' | 'other';
  /**
   * Defender tonnage still afloat anywhere, which is its SECOND objective.
   *
   * Holding alone cannot tell a defending composition apart — one linear
   * objective has a pure optimum, and the pure battle line wins it. A stance
   * that lets a defender break off early makes "keep the fleet" a separate
   * thing to want, and that needs a separate number to see.
   */
  defenderTonsLeft: number;
  /**
   * Defender combat weight still afloat.
   *
   * Distinct from tonnage on purpose, and the distinction is the whole test: a
   * withdrawal costs a fixed FRACTION OF TONNAGE and `bleed` spends the loss
   * order, so a screen does not reduce the tonnage lost — it only changes which
   * hulls absorb it. If a screen pays a defender anywhere, it is here.
   */
  defenderWeightLeft: number;
}

/**
 * A two-system galaxy: one world the attacker sails from, one it sails at.
 *
 * Built once and deep-cloned per trial. Trade routes need hubs and there are
 * none, so `tickTurn` does almost no work beyond the battle itself.
 */
function buildArena(): WorldState {
  const full = createSeedState('freeworlds');
  const keep = ['freeworlds', 'ojjul'];
  const origin = full.systems.find((s) => s.id === 'ark-4')!;
  const target = full.systems.find((s) => s.id === 'sek-6')!;
  return WorldStateSchema.parse({
    ...full,
    factions: full.factions
      .filter((f) => keep.includes(f.id))
      .map((f) => ({ ...f, disposition: { [keep.find((x) => x !== f.id)!]: -50 } })),
    systems: [
      { ...origin, hyperlaneEdges: [target.id], ships: {}, controllerFactionId: 'freeworlds' },
      { ...target, hyperlaneEdges: [origin.id], ships: {}, controllerFactionId: 'ojjul' },
    ],
    pendingOrders: [],
    treaties: [],
    agents: [],
    commitments: [],
    debts: [],
    eventLog: [],
  });
}

const ARENA = buildArena();
const ORIGIN = 'ark-4';
const TARGET = 'sek-6';

/** One battle: `attacker` sails against `defender` over a garrison. */
export function trial(
  attacker: ShipStack,
  defender: ShipStack,
  garrison: number,
  turn: number,
  holderEthic: WarEthic,
  /** The holder's standing order on breaking off. Defaults to how it has always played. */
  holderStance: 'hold' | 'stand' | 'withdraw' = 'stand',
): TrialOutcome {
  const state = JSON.parse(JSON.stringify(ARENA)) as WorldState;
  // The turn is what varies the seeded roll, and it costs nothing to change —
  // unlike ticking forward, which would also move income and garrisons.
  state.turn = turn;
  state.factions.find((f) => f.id === 'ojjul')!.warEthic = holderEthic;
  state.factions.find((f) => f.id === 'ojjul')!.stance = holderStance;

  const world = state.systems.find((s) => s.id === TARGET)!;
  world.garrison = garrison;
  world.garrisonMax = Math.max(garrison, 1);
  for (const [hull, n] of Object.entries(defender) as [HullClass, number][]) {
    addShipsAt(world, 'ojjul', n, hull);
  }
  const port = state.systems.find((s) => s.id === ORIGIN)!;
  for (const [hull, n] of Object.entries(attacker) as [HullClass, number][]) {
    addShipsAt(port, 'freeworlds', n, hull);
  }

  const issued = applyOps(state, [
    {
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: ORIGIN, targetId: TARGET, force: attacker,
    },
  ]);
  if (issued.rejections.length > 0) return { took: false, why: 'other', defenderTonsLeft: 0, defenderWeightLeft: 0 };

  let r = tickTurn(issued.state);
  for (let guard = 0; guard < 6 && r.state.pendingOrders.length > 0; guard++) r = tickTurn(r.state);

  const after = r.state.systems.find((s) => s.id === TARGET)!;
  const took = after.controllerFactionId === 'freeworlds';
  const text = r.notes.join(' ');
  const why: TrialOutcome['why'] = took
    ? /unopposed/.test(text) ? 'unopposed' : 'taken'
    : /no troops aboard/.test(text) ? 'no_lift'
      : /still hold the orbitals/.test(text) ? 'no_landing'
        : /driven off/.test(text) ? 'driven_off' : 'other';
  // Anywhere, not just here: a fleet that broke off and reached a refuge is
  // exactly what the withdrawal stance is trying to preserve.
  const defenderTonsLeft = fleetTonsOf(r.state, 'ojjul');
  const defenderWeightLeft = r.state.systems.reduce(
    (n, sys) => n + orbitalWeightAt(sys, 'ojjul'),
    0,
  );
  return { took, why, defenderTonsLeft, defenderWeightLeft };
}

/**
 * Lift counts swept as their own axis, rather than as a share of the budget.
 *
 * **This is the fix for item 79, and the reason it was needed is worth keeping.**
 * A simplex share of a large budget cannot express a small fleet: one share of
 * 3,600 credits over four steps is 900, and 900 credits is exactly twenty
 * transports. So the attacker grid carried `0, 20, 40, 60, 80` lifters and
 * nothing between 1 and 19 — while the thing being measured, a defender
 * converting its own lift into garrison, stops mattering once the attacker
 * carries about ten, because `assault` already beats any garrison it will meet.
 *
 * Every lift-carrying attacker in the old grid sat above that line and every
 * other one carried none, so the harness sampled only the two regions where the
 * mechanism is guaranteed inert: `no_lift` came back 0.0% on every defending
 * composition it tested. Refining the simplex does not reach it either —
 * `steps: 12` costs 455 compositions and still bottoms out at six.
 *
 * The counts are dense where the decision lives (0-10) and sparse above it,
 * where one more transport changes nothing.
 */
export const LIFT_AXIS = [0, 2, 4, 6, 10, 16, 30] as const;

/**
 * The dense axis, for when the question is specifically about small lift arms.
 * `--fine` uses it. Twelve counts rather than seven roughly triples the run.
 */
export const LIFT_AXIS_FINE = [0, 1, 2, 3, 4, 6, 8, 10, 14, 20, 30, 45] as const;

/** Classes the simplex still divides between, once lift is drawn separately. */
const FIGHTING_CLASSES = HULL_CLASSES.filter((h) => h !== 'lifter');

/**
 * Every composition that spends about `budget`.
 *
 * Lift is drawn from `LIFT_AXIS` and the remainder is divided between the
 * fighting classes on a simplex grid, so a fleet carrying two transports is
 * enumerated as readily as one carrying forty. `steps` is how finely that
 * remainder is divided.
 *
 * The grid deliberately includes compositions nobody would build — a defender
 * carrying lift it cannot use, an attacker with no lift at all. A harness that
 * only enumerates sensible fleets cannot tell you that the others are worse.
 */
export function compositions(budget: number, steps = 4, lift: readonly number[] = LIFT_AXIS): Composition[] {
  const out: Composition[] = [];
  for (const lifters of lift) {
    const spentOnLift = lifters * hullCost('lifter');
    if (spentOnLift > budget) continue;
    const rest = budget - spentOnLift;
    const walk = (i: number, left: number, take: number[]): void => {
      if (i === FIGHTING_CLASSES.length - 1) {
        const shares = [...take, left];
        const stack: ShipStack = {};
        if (lifters > 0) stack.lifter = lifters;
        for (const [k, hull] of FIGHTING_CLASSES.entries()) {
          const spend = (rest * shares[k]!) / steps;
          const n = Math.floor(spend / hullCost(hull));
          if (n > 0) stack[hull] = n;
        }
        const cost = HULL_CLASSES.reduce((n, h) => n + (stack[h] ?? 0) * hullCost(h), 0);
        const classes = HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0).length;
        if (classes > 0) {
          out.push({
            stack,
            cost,
            classes,
            label: HULL_CLASSES.filter((h) => (stack[h] ?? 0) > 0)
              .map((h) => `${h}:${stack[h]}`)
              .join(' '),
          });
        }
        return;
      }
      for (let n = 0; n <= left; n++) walk(i + 1, left - n, [...take, n]);
    };
    walk(0, steps, []);
  }
  // Distinct fleets only: two share splits can floor to the same hulls.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = JSON.stringify(c.stack);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface Scored extends Composition {
  trials: number;
  wins: number;
  rate: number;
  /** Outcome shape, so a loss can be read as well as counted. */
  why: Record<string, number>;
}

export interface TournamentResult {
  attackers: Scored[];
  defenders: Scored[];
  battles: number;
  garrisons: number[];
  ethics: WarEthic[];
}

export interface TournamentOptions {
  budget?: number;
  /** The defender spends this; defaults to the attacker's budget. */
  defenceBudget?: number;
  steps?: number;
  /** Lift counts to sweep. Defaults to `LIFT_AXIS`. */
  lift?: readonly number[];
  garrisons?: number[];
  turns?: number[];
  ethics?: WarEthic[];
}

/**
 * Every attacker against every defender, over every garrison, roll and ethic.
 *
 * Attacker score is the share of its battles that took the world; defender
 * score is the share it held. They are the same battles read from both sides,
 * so the two tables are consistent by construction.
 */
/**
 * One worker's slice of the grid, and the reason the whole thing parallelises.
 *
 * Every battle is a pure function of `(attacker, defender, garrison, turn,
 * ethic)` — `trial` builds its own two-system arena and the roll comes from
 * `rollD20(turn, salt)` — so no battle can see another and the answer does not
 * depend on the order they run in. Splitting the attacker axis across cores
 * therefore produces byte-identical results, which is the property that makes
 * this worth doing rather than merely faster.
 *
 * Returns raw tallies rather than rates: a shard holds part of each defender's
 * record, and a rate cannot be averaged back together. `mergeShards` sums.
 */
export function tournamentShard(
  opts: TournamentOptions,
  shardIndex: number,
  shardCount: number,
): ShardTally {
  const { atk, def, garrisons, turns, ethics } = grid(opts);
  const atkTally = atk.map(() => blank());
  const defTally = def.map(() => blank());

  let battles = 0;
  for (let i = shardIndex; i < atk.length; i += shardCount) {
    for (let j = 0; j < def.length; j += 1) {
      for (const garrison of garrisons) {
        for (const turn of turns) {
          for (const ethic of ethics) {
            const r = trial(atk[i]!.stack, def[j]!.stack, garrison, turn, ethic);
            battles += 1;
            const a = atkTally[i]!;
            const d = defTally[j]!;
            a.trials += 1;
            d.trials += 1;
            if (r.took) a.wins += 1;
            else d.wins += 1;
            a.why[r.why] = (a.why[r.why] ?? 0) + 1;
            d.why[r.why] = (d.why[r.why] ?? 0) + 1;
          }
        }
      }
    }
  }
  return { atk: atkTally, def: defTally, battles };
}

export interface Tally {
  trials: number;
  wins: number;
  why: Record<string, number>;
}
export interface ShardTally {
  atk: Tally[];
  def: Tally[];
  battles: number;
}

const blank = (): Tally => ({ trials: 0, wins: 0, why: {} });

/** The grid every shard derives identically, from the same pure inputs. */
function grid(opts: TournamentOptions) {
  const budget = opts.budget ?? 1800;
  const defenceBudget = opts.defenceBudget ?? budget;
  const steps = opts.steps ?? 4;
  const lift = opts.lift ?? LIFT_AXIS;
  return {
    atk: compositions(budget, steps, lift),
    def: compositions(defenceBudget, steps, lift),
    garrisons: opts.garrisons ?? [4, 10, 16],
    turns: opts.turns ?? [1, 3, 5],
    ethics: opts.ethics ?? (['profiteer', 'crusading'] as WarEthic[]),
  };
}

/** Sum shard tallies into the finished result. Order-independent by construction. */
export function mergeShards(opts: TournamentOptions, shards: ShardTally[]): TournamentResult {
  const { atk, def, garrisons, ethics } = grid(opts);
  const add = (into: Tally, from: Tally) => {
    into.trials += from.trials;
    into.wins += from.wins;
    for (const [k, v] of Object.entries(from.why)) into.why[k] = (into.why[k] ?? 0) + v;
  };
  const atkT = atk.map(() => blank());
  const defT = def.map(() => blank());
  let battles = 0;
  for (const shard of shards) {
    battles += shard.battles;
    shard.atk.forEach((t, i) => add(atkT[i]!, t));
    shard.def.forEach((t, i) => add(defT[i]!, t));
  }
  const score = (comps: Composition[], tallies: Tally[]): Scored[] =>
    comps
      .map((c, i) => ({
        ...c,
        ...tallies[i]!,
        rate: tallies[i]!.trials === 0 ? 0 : tallies[i]!.wins / tallies[i]!.trials,
      }))
      .sort((x, y) => y.rate - x.rate || x.label.localeCompare(y.label));
  return {
    attackers: score(atk, atkT),
    defenders: score(def, defT),
    battles,
    garrisons,
    ethics,
  };
}

export function tournament(opts: TournamentOptions = {}): TournamentResult {
  const budget = opts.budget ?? 1800;
  const defenceBudget = opts.defenceBudget ?? budget;
  const steps = opts.steps ?? 4;
  const lift = opts.lift ?? LIFT_AXIS;
  // Sampling was 4 garrisons x 5 rolls x 3 doctrines = 60 battles a pairing,
  // which was affordable when the grid was 35x35 and is not now that lift has
  // its own axis. Trimmed to 3 x 3 x 2 = 18, keeping the ends of each range —
  // a shallow garrison and a deep one, a bad roll and a good one, and the two
  // doctrines that actually change a battle (`crusading` never breaks off,
  // `defensive` digs its garrison in). `profiteer` is the neutral case and is
  // what the other two are measured against, so it stays.
  const garrisons = opts.garrisons ?? [4, 10, 16];
  const turns = opts.turns ?? [1, 3, 5];
  const ethics = opts.ethics ?? (['profiteer', 'crusading'] as WarEthic[]);

  const atk = compositions(budget, steps, lift).map(
    (c): Scored => ({ ...c, trials: 0, wins: 0, rate: 0, why: {} }),
  );
  const def = compositions(defenceBudget, steps, lift).map(
    (c): Scored => ({ ...c, trials: 0, wins: 0, rate: 0, why: {} }),
  );

  let battles = 0;
  for (const a of atk) {
    for (const d of def) {
      for (const garrison of garrisons) {
        for (const turn of turns) {
          for (const ethic of ethics) {
            const r = trial(a.stack, d.stack, garrison, turn, ethic);
            battles += 1;
            a.trials += 1;
            d.trials += 1;
            if (r.took) a.wins += 1;
            else d.wins += 1;
            a.why[r.why] = (a.why[r.why] ?? 0) + 1;
            d.why[r.why] = (d.why[r.why] ?? 0) + 1;
          }
        }
      }
    }
  }
  for (const c of [...atk, ...def]) c.rate = c.trials === 0 ? 0 : c.wins / c.trials;
  atk.sort((x, y) => y.rate - x.rate || x.label.localeCompare(y.label));
  def.sort((x, y) => y.rate - x.rate || x.label.localeCompare(y.label));
  return { attackers: atk, defenders: def, battles, garrisons, ethics };
}

/** Best composition carrying at least `n` distinct classes. */
export function bestWith(scored: Scored[], n: number): Scored | undefined {
  return scored.find((c) => c.classes >= n);
}

/** Best composition carrying at most `n` distinct classes. */
export function bestUpTo(scored: Scored[], n: number): Scored | undefined {
  return scored.find((c) => c.classes <= n);
}

/** Does a mixed fleet actually beat everything simpler, and by how much? */
export function mixedWins(scored: Scored[], classes = 3): {
  mixed?: Scored;
  simple?: Scored;
  mixedIsBest: boolean;
  margin: number;
} {
  const mixed = bestWith(scored, classes);
  const simple = bestUpTo(scored, classes - 1);
  return {
    mixed,
    simple,
    mixedIsBest: (scored[0]?.classes ?? 0) >= classes,
    margin: (mixed?.rate ?? 0) - (simple?.rate ?? 0),
  };
}
