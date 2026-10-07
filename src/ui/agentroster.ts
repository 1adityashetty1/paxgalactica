import { statModifier } from '../domain/checks.js';
import { atWork, type Agent } from '../domain/diplomacy.js';
import {
  AGENT_UPKEEP,
  MAX_AGENTS_BASE,
  agentsVisibleTo,
  liveAgentsOf,
  type WorldState,
} from '../domain/state.js';

/**
 * The Agents tab, as data: every operative the player can see, sorted into
 * what each is doing.
 *
 * Operatives were listed twice and tracked nowhere. The Treaties tab carried a
 * flat list beside the treaties and wars, and the System tab listed the ones on
 * the selected world; neither said how many slots were in use, which were
 * still travelling, which stood idle on the books, or that one of yours was a
 * prisoner somebody could ransom back. A network a player cannot see the shape
 * of is a network they stop running.
 *
 * Pure and DOM-free, beside `layout.ts` and `help.ts`, so the sorting is tested.
 * It reads the served view, so it shows exactly what the fog allows: your own
 * people, and a rival's only once burned or known well enough
 * (`agentsVisibleTo`).
 */

export interface CaughtOperative {
  agent: Agent;
  /** Who holds them now, and where, if they were taken alive. */
  heldBy: string | null;
  heldAt: string | null;
}

export interface AgentRoster {
  /** On a mission and at work this turn. */
  atWork: Agent[];
  /** Sent, and still travelling. */
  underWay: Agent[];
  /** Recruited and awaiting orders. */
  idle: Agent[];
  /** Yours, burned. */
  caught: CaughtOperative[];
  /** Rival operatives you can see, by owner, unburned first. */
  theirs: { ownerId: string; agents: Agent[] }[];
  /** Counter-intelligence programmes you are running. */
  sweeps: { systemId: string; turnsLeft: number }[];
  /** Operatives you are paying for, against how many you can run. */
  inService: number;
  slots: number;
  upkeep: number;
}

/**
 * `guile` is the player's EFFECTIVE guile as the server reads it: the served
 * view hides a rival's debuff on it, and the slots figure must not read higher
 * than the one `maxAgentsFor` enforces — the reason `CampaignView.effective`
 * exists at all.
 */
export function agentRoster(state: WorldState, me: string, guile: number): AgentRoster {
  const place = (a: Agent) => state.systems.find((s) => s.id === a.systemId)?.name ?? a.systemId;
  const byPlace = (a: Agent, b: Agent) => place(a).localeCompare(place(b)) || a.id.localeCompare(b.id);
  const visible = agentsVisibleTo(state, me);
  const mine = visible.filter((a) => a.ownerFactionId === me);
  const live = mine.filter((a) => !a.exposed);

  const caught = mine
    .filter((a) => a.exposed)
    .sort(byPlace)
    .map((agent) => {
      const held = (state.assets ?? []).find((x) => x.agentId === agent.id && x.quantity > 0);
      return { agent, heldBy: held?.heldBy ?? null, heldAt: held?.atSystemId ?? null };
    });

  const owners = [...new Set(visible.filter((a) => a.ownerFactionId !== me).map((a) => a.ownerFactionId))].sort();
  const inService = liveAgentsOf(state, me).length;
  return {
    atWork: live.filter((a) => atWork(a, state.turn)).sort(byPlace),
    underWay: live.filter((a) => a.mission !== null && !atWork(a, state.turn)).sort(byPlace),
    idle: live.filter((a) => a.mission === null).sort(byPlace),
    caught,
    theirs: owners.map((ownerId) => ({
      ownerId,
      agents: visible
        .filter((a) => a.ownerFactionId === ownerId)
        .sort((a, b) => Number(a.exposed) - Number(b.exposed) || byPlace(a, b)),
    })),
    sweeps: state.pendingOrders
      .filter((o) => o.factionId === me && o.type === 'counter_intelligence')
      .map((o) => ({ systemId: o.targetId, turnsLeft: Math.max(0, o.durationTurns - o.progress) }))
      .sort((a, b) => a.systemId.localeCompare(b.systemId)),
    inService,
    slots: Math.max(1, MAX_AGENTS_BASE + statModifier(guile)),
    upkeep: inService * AGENT_UPKEEP,
  };
}
