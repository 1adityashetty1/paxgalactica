import type { BattleReport } from '../domain/battle.js';
import type { TurnReport } from '../domain/reducer.js';
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

  const observed = report.advanced.filter((a) => a.factionId !== me).map(toProject);

  return {
    turn: state.turn,
    treasury: getFaction(state, me)?.credits ?? 0,
    ledger: report.ledger,
    completed,
    inProgress,
    observed,
    battles: report.battles,
    // A battle is never a quiet turn, even if nothing else moved.
    quiet:
      completed.length === 0 &&
      inProgress.length === 0 &&
      observed.length === 0 &&
      report.battles.length === 0,
  };
}
