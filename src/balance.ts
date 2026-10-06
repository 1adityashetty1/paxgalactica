import { applyOps, tickTurn, type LegacyRules } from './domain/reducer.js';
import type { RimEvent } from './domain/events.js';
import { createSeedState } from './seed/scenario.js';
import { BOTS, brokeredAccords, held, proposeFor } from './domain/initiative.js';
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
    { net: number; territory: number; routes: number; tolls: number; raided: number; internal: number;
      fleet: number; credits: number; systems: number }
  >;
  openness: number;
  uncollected: number;
  /** factionId -> how everyone else sees them, for reading the politics. */
  disposition: Record<string, Record<string, number>>;
  /** What the Rim did on its own this turn (item 124): at most one. */
  events: RimEvent[];
  /** viewer -> subject -> how well it knows them, at the end of this turn. */
  intel: Record<string, Record<string, number>>;
  /** Counter-intelligence sweeps running at the end of this turn. */
  sweeps: number;
  /** Operatives taken so far, by owner. */
  caught: Record<string, number>;
  /** Rows of memory held, all powers together. */
  sightings: number;
}

export function runBalance(
  turns: number,
  onTurn?: (s: Snapshot) => void,
  /**
   * Rules to tick under. `{ randomEvents: false }` is the control a sweep of the
   * events is measured against — the board the bots produce on their own.
   */
  legacy: LegacyRules = {},
): Snapshot[] {
  let state = createSeedState('freeworlds');
  const history: Snapshot[] = [];

  for (let turn = 1; turn <= turns; turn++) {
    // Bots act in a fixed order so the run is reproducible.
    //
    // Through `proposeFor`, not `BOTS[id]` directly, because that is the path
    // `endTurn` takes — and calling the bot raw skipped BOTH post-filters. So
    // the one tool that plays the bots for thirty turns was the one place
    // `honourTreaties` had never run, and a standing gate measured against it
    // would have reported a board it could not have changed. `honourTreaties`
    // is still inert here, since nobody in the harness signs anything; the
    // point is that the harness now exercises whatever guard the game does.
    for (const id of Object.keys(BOTS).sort()) {
      const proposal = proposeFor(
        state,
        id,
        (ops) => applyOps(state, ops, 'model', id, true, legacy).rejections.length === 0,
      );
      if (proposal) state = applyOps(state, proposal.ops, 'model', id).state;
    }
    // What the bots agree between themselves, as `endTurn` applies it.
    for (const accord of brokeredAccords(state)) {
      state = applyOps(state, accord.ops, 'engine', undefined, true).state;
    }
    const ticked = tickTurn(state, legacy);
    state = ticked.state;

    const earnings = routeEarnings(state);
    const snap: Snapshot = {
      turn,
      events: ticked.report.events,
      intel: Object.fromEntries(state.factions.map((f) => [f.id, { ...(f.intel ?? {}) }])),
      sweeps: state.pendingOrders.filter((o) => o.type === 'counter_intelligence').length,
      caught: state.agents.reduce<Record<string, number>>(
        (n, a) => (a.exposed ? { ...n, [a.ownerFactionId]: (n[a.ownerFactionId] ?? 0) + 1 } : n),
        {},
      ),
      sightings: state.sightings.length,
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
          // One settlement of the lanes for all five, not five identical ones.
          const l = ledgerFor(state, f.id, earnings);
          return [
            f.id,
            {
              net: l.net, territory: l.territory, routes: l.routes,
              tolls: l.tolls, raided: l.raided, internal: l.internalMarket,
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
