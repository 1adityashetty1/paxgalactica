import { applyOps, tickTurn } from './domain/reducer.js';
import { createSeedState } from './seed/scenario.js';
import {
  HULL_CLASSES,
  battleshipEquivalents,
  hullCost,
  type HullClass,
  type ShipStack,
} from './domain/hulls.js';
import { WorldStateSchema, addShipsAt, type WarEthic, type WorldState } from './domain/state.js';

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
): TrialOutcome {
  const state = JSON.parse(JSON.stringify(ARENA)) as WorldState;
  // The turn is what varies the seeded roll, and it costs nothing to change —
  // unlike ticking forward, which would also move income and garrisons.
  state.turn = turn;
  state.factions.find((f) => f.id === 'ojjul')!.warEthic = holderEthic;

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
  if (issued.rejections.length > 0) return { took: false, why: 'other' };

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
  return { took, why };
}

/**
 * Every composition that spends about `budget`, on a simplex grid.
 *
 * `steps` is how finely the budget is divided: each class takes a whole number
 * of steps and the shares sum to `steps`. A step of 4 gives 35 compositions per
 * side, which is a 35x35 round robin — coarse enough to run in seconds and fine
 * enough to separate a screen from a battle line.
 *
 * The grid deliberately includes compositions nobody would build — a defender
 * carrying lift it cannot use, an attacker with no lift at all. A harness that
 * only enumerates sensible fleets cannot tell you that the others are worse.
 */
export function compositions(budget: number, steps = 4): Composition[] {
  const out: Composition[] = [];
  const walk = (i: number, left: number, take: number[]): void => {
    if (i === HULL_CLASSES.length - 1) {
      const shares = [...take, left];
      const stack: ShipStack = {};
      for (const [k, hull] of HULL_CLASSES.entries()) {
        const spend = (budget * shares[k]!) / steps;
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
export function tournament(opts: TournamentOptions = {}): TournamentResult {
  const budget = opts.budget ?? 1800;
  const defenceBudget = opts.defenceBudget ?? budget;
  const steps = opts.steps ?? 4;
  const garrisons = opts.garrisons ?? [4, 8, 12, 16];
  const turns = opts.turns ?? [1, 2, 3, 4, 5];
  const ethics = opts.ethics ?? (['profiteer', 'crusading', 'defensive'] as WarEthic[]);

  const atk = compositions(budget, steps).map(
    (c): Scored => ({ ...c, trials: 0, wins: 0, rate: 0, why: {} }),
  );
  const def = compositions(defenceBudget, steps).map(
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
