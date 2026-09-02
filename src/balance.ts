import { applyOps, tickTurn } from './domain/reducer.js';
import { createSeedState } from './seed/scenario.js';
import { BOTS, held } from './domain/initiative.js';
import { fleetStrengthOf, ledgerFor, type WorldState } from './domain/state.js';
import { routeEarnings, tradeRoutes } from './domain/trade.js';

/**
 * Balance harness: five doctrine bots, the real reducer, no model calls.
 *
 * Balancing by staring at turn-0 ledgers was misleading — it measured the
 * opening position rather than the game. What matters is whether a doctrine
 * *pays off when played*: whether the extortionist's tolls actually fund it,
 * whether the smuggler can close the gap by raiding, whether the crusader's
 * conquests outrun their upkeep, and whether anyone runs away with the map.
 *
 * Each bot plays its faction's declared character as literally as the
 * mechanics allow. They are deliberately simple and deterministic — no
 * `Math.random`, no lookahead — because the point is to exercise the ECONOMY,
 * not to play well. A clever bot would hide balance problems by routing around
 * them.
 *
 *   pnpm balance            30 turns, summary table
 *   pnpm balance 50 --trace per-turn trace
 */


/* ------------------------------------------------------------------ */
/* Run                                                                  */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  turn: number;
  perFaction: Record<
    string,
    { net: number; territory: number; routes: number; tolls: number; raided: number;
      fleet: number; credits: number; systems: number }
  >;
  openness: number;
  uncollected: number;
  /** factionId -> how everyone else sees them, for reading the politics. */
  disposition: Record<string, Record<string, number>>;
}

export function runBalance(turns: number, onTurn?: (s: Snapshot) => void): Snapshot[] {
  let state = createSeedState('freeworlds');
  const history: Snapshot[] = [];

  for (let turn = 1; turn <= turns; turn++) {
    // Bots act in a fixed order so the run is reproducible.
    for (const id of Object.keys(BOTS).sort()) {
      const ops = BOTS[id]!({ state, me: id });
      if (ops.length > 0) state = applyOps(state, ops, 'model').state;
    }
    state = tickTurn(state).state;

    const earnings = routeEarnings(state);
    const snap: Snapshot = {
      turn,
      openness: earnings.openness,
      uncollected: earnings.uncollected,
      disposition: Object.fromEntries(
        state.factions.map((f) => [
          f.id,
          Object.fromEntries(
            state.factions.filter((o) => o.id !== f.id).map((o) => [o.id, o.disposition[f.id] ?? 0]),
          ),
        ]),
      ),
      perFaction: Object.fromEntries(
        state.factions.map((f) => {
          const l = ledgerFor(state, f.id);
          return [
            f.id,
            {
              net: l.net, territory: l.territory, routes: l.routes,
              tolls: l.tolls, raided: l.raided,
              fleet: fleetStrengthOf(state, f.id), credits: f.credits,
              systems: held(state, f.id).length,
            },
          ];
        }),
      ),
    };
    history.push(snap);
    onTurn?.(snap);
  }
  return history;
}
