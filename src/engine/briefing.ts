import type { BattleReport } from '../domain/battle.js';
import type { TurnReport } from '../domain/reducer.js';
import { describeEffect } from '../domain/diplomacy.js';
import { observeOrders } from '../domain/intel.js';
import { getFaction, ledgerFor, type Ledger, type WorldState } from '../domain/state.js';

/**
 * The standing brief: everything running, reported without being asked for.
 *
 * The player should never have to open a panel to discover that a shipyard is
 * one turn from completion or that a fleet arrives next turn. Multi-turn work
 * is the whole point of the duration system, and it only lands as a decision if
 * its state is in front of you when you decide.
 *
 * This returns DATA, not formatted lines. Presentation belongs to whichever
 * frontend is drawing — a terminal feed and a browser panel want very different
 * things from the same facts.
 */

export interface BriefingProject {
  id: string;
  label: string;
  where: string;
  factionId: string;
  factionName: string;
  /** ANSI 256 index; convert per-frontend. */
  color: number;
  progress: number;
  duration: number;
  remaining: number;
  completesNextTurn: boolean;
  isMovement: boolean;
}

/**
 * A rival programme you know exists and nothing more.
 *
 * Deliberately carries no label and no type: the whole value of a rumour is
 * that it names a place worth putting an operative, not a thing to react to.
 */
export interface BriefingRumour {
  where: string;
  factionId: string;
  factionName: string;
  color: number;
  progress: number;
  duration: number;
  remaining: number;
  completesNextTurn: boolean;
}

/**
 * One of your operatives, and what it is doing.
 *
 * Derived from state rather than from the tick, so it is correct on a resumed
 * campaign and correct on a turn that produced no report at all. The running
 * account lives in the event log under `kind: 'intel'`; this is the standing
 * one, in front of the player rather than scrolled past.
 *
 * Only ever the player's own — see the reducer's watch pass for why a rival's
 * intelligence has no business in the player's briefing.
 */
export interface BriefingWatch {
  where: string;
  systemId: string;
  mission: string;
  /** What the effect does, in the same words the treaties panel uses. */
  effect: string;
  successChance: number;
  /**
   * What this operative can see at its posting right now, one line each.
   * Empty means nothing is moving there — which is a report, not a blank.
   */
  sees: string[];
}

export interface BriefingCompletion {
  label: string;
  where: string;
  outcome: string;
  factionId: string;
  factionName: string;
  color: number;
  mine: boolean;
}

export interface Briefing {
  turn: number;
  treasury: number;
  ledger: Ledger;
  /** Finished this turn — yours first, then anything you witnessed. */
  completed: BriefingCompletion[];
  /** Your work still running, soonest first. */
  inProgress: BriefingProject[];
  /** Rival projects you can actually observe. Never everything they have. */
  observed: BriefingProject[];
  /**
   * Work you know is happening and cannot identify.
   *
   * This is the hook the whole intelligence mechanic hangs on: without it a
   * secret programme is invisible, a player never learns there is anything to
   * look at, and surveillance stays as unmotivated as it was when four
   * operatives ran seven turns and reported nothing. See `domain/intel.ts`.
   */
  rumoured: BriefingRumour[];
  /** Your operatives, and what each of them has to say. Never a rival's. */
  watch: BriefingWatch[];
  /**
   * Battles fought this turn, with the arithmetic attached.
   *
   * Empty on a resumed campaign: a report is derived from a tick that already
   * happened, and `briefingFromState` has no tick behind it. The event log still
   * carries the prose, which is what a resumed player had before.
   */
  battles: BattleReport[];
  /** Nothing completed, nothing running, nothing visible. */
  quiet: boolean;
}

/**
 * A briefing derived from state alone, with no turn behind it.
 *
 * Used after loading a save: the real briefing is a by-product of a tick, so a
 * resumed campaign would otherwise show "end a turn to see the report" while
 * three projects were quietly running. Completions are necessarily empty —
 * nothing completed *this* turn, because no turn has happened yet.
 */
export function briefingFromState(state: WorldState): Briefing {
  return buildBriefing(state, {
    completed: [],
    advanced: state.pendingOrders.map((o) => ({
      id: o.id,
      label: o.label,
      factionId: o.factionId,
      progress: o.progress,
      duration: o.durationTurns,
      remaining: o.durationTurns - o.progress,
      where: state.systems.find((s) => s.id === o.targetId)?.name ?? o.targetId,
      isMovement: o.type === 'fleet_movement',
    })),
    ledger: ledgerFor(state, state.playerFactionId),
    arrivals: [],
    battles: [],
  });
}

export function buildBriefing(state: WorldState, report: TurnReport): Briefing {
  const me = state.playerFactionId;

  const describe = (factionId: string): { name: string; color: number } => {
    const f = getFaction(state, factionId);
    return { name: f?.name ?? factionId, color: f?.displayColor ?? 245 };
  };

  const completed: BriefingCompletion[] = report.completed
    .map((c) => {
      const { name, color } = describe(c.factionId);
      return {
        label: c.label,
        where: c.where,
        outcome: c.outcome,
        factionId: c.factionId,
        factionName: name,
        color,
        mine: c.factionId === me,
      };
    })
    // Yours first: it is the thing you were waiting on.
    .sort((a, b) => Number(b.mine) - Number(a.mine));

  const toProject = (a: TurnReport['advanced'][number]): BriefingProject => {
    const { name, color } = describe(a.factionId);
    return {
      id: a.id,
      label: a.label,
      where: a.where,
      factionId: a.factionId,
      factionName: name,
      color,
      progress: a.progress,
      duration: a.duration,
      remaining: a.remaining,
      completesNextTurn: a.remaining === 1,
      isMovement: a.isMovement,
    };
  };

  const inProgress = report.advanced
    .filter((a) => a.factionId === me)
    .map(toProject)
    .sort((a, b) => a.remaining - b.remaining);

  // What the player can actually see. `report.advanced` is the board's truth —
  // every order in the world — and reading it directly is what made the
  // intelligence mechanic unreachable. See `domain/intel.ts`.
  const seen = observeOrders(state, me);
  const visible = new Set(seen.orders.map((o) => o.id));
  const observed = report.advanced
    .filter((a) => a.factionId !== me && visible.has(a.id))
    .map(toProject);

  const rumoured: BriefingRumour[] = seen.rumours.map((r) => {
    const { name, color } = describe(r.factionId);
    const remaining = r.durationTurns - r.progress;
    return {
      where: state.systems.find((sys) => sys.id === r.systemId)?.name ?? r.systemId,
      factionId: r.factionId,
      factionName: name,
      color,
      progress: r.progress,
      duration: r.durationTurns,
      remaining,
      completesNextTurn: remaining === 1,
    };
  });

  // Your operatives, standing rather than scrolling. An agent that reports
  // nothing still appears, because an idle watcher must be visibly idle — the
  // whole `intel` effect was unreachable for the life of the project and
  // nobody noticed, precisely because silence looked the same as absence.
  const watch: BriefingWatch[] = (state.agents ?? [])
    .filter((a) => a.ownerFactionId === me && !a.exposed)
    .map((a) => ({
      where: state.systems.find((sys) => sys.id === a.systemId)?.name ?? a.systemId,
      systemId: a.systemId,
      mission: a.mission,
      effect: describeEffect(a.effect),
      successChance: a.successChance,
      sees: state.pendingOrders
        .filter(
          (o) =>
            o.factionId !== me && (o.originId === a.systemId || o.targetId === a.systemId),
        )
        .map((o) => {
          const { name } = describe(o.factionId);
          return `${name}: ${o.label || o.type} (${o.progress}/${o.durationTurns})`;
        }),
    }));

  return {
    turn: state.turn,
    treasury: getFaction(state, me)?.credits ?? 0,
    ledger: report.ledger,
    completed,
    inProgress,
    observed,
    rumoured,
    watch,
    battles: report.battles,
    // A battle is never a quiet turn, even if nothing else moved.
    quiet:
      completed.length === 0 &&
      inProgress.length === 0 &&
      observed.length === 0 &&
      rumoured.length === 0 &&
      report.battles.length === 0,
  };
}

/**
 * Re-derive the parts of a briefing that are facts about the board rather than
 * about the turn that produced it.
 *
 * `watch` and `rumoured` are computed from state, but the briefing itself is
 * only rebuilt on a tick — so an action that deployed or recalled an operative
 * left them describing the board as it was one turn ago. Seen live: `watch`
 * named a recalled operative's old posting and omitted the new one while
 * `state.agents` was correct, two views of one fact disagreeing inside a single
 * response.
 *
 * Completions and battles are deliberately untouched: those ARE facts about the
 * turn, and re-deriving them from state is impossible by construction.
 */
export function withCurrentIntel(briefing: Briefing, state: WorldState): Briefing {
  const fresh = buildBriefing(state, {
    completed: [],
    advanced: state.pendingOrders.map((o) => ({
      id: o.id,
      label: o.label,
      factionId: o.factionId,
      progress: o.progress,
      duration: o.durationTurns,
      remaining: o.durationTurns - o.progress,
      where: state.systems.find((s) => s.id === o.targetId)?.name ?? o.targetId,
      isMovement: o.type === 'fleet_movement',
    })),
    ledger: ledgerFor(state, state.playerFactionId),
    arrivals: [],
    battles: [],
  });
  return { ...briefing, watch: fresh.watch, rumoured: fresh.rumoured };
}
