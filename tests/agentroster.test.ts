import { describe, expect, it } from 'vitest';
import { agentRoster } from '../src/ui/agentroster.js';
import { AgentSchema, AssetSchema } from '../src/domain/diplomacy.js';
import { AGENT_UPKEEP, MAX_AGENTS_BASE, type WorldState } from '../src/domain/state.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * The Agents tab sorts every operative the player can see by what each is
 * doing. These hold the sorting to the rules the game runs on: at work is
 * `atWork`, visible is `agentsVisibleTo`, slots is `maxAgentsFor`'s formula.
 */

const agent = (over: Record<string, unknown>) =>
  AgentSchema.parse({
    id: `agt-${Math.random().toString(36).slice(2, 8)}`,
    ownerFactionId: 'meridian',
    systemId: 'tor-2',
    mission: 'surveillance',
    effect: { kind: 'intel' },
    successChance: 60,
    deployedTurn: 1,
    ...over,
  });

const board = (): WorldState => {
  const s = createSeedState('meridian');
  s.turn = 5;
  s.agents = [];
  s.assets = [];
  return s;
};

describe('the agent roster', () => {
  it('sorts your own people by what they are doing', () => {
    const s = board();
    s.agents.push(
      agent({ id: 'work', name: 'Ana Vel' }),
      agent({ id: 'way', inPlaceFrom: 7 }),
      agent({ id: 'idle', mission: null, effect: null }),
      agent({ id: 'burned', exposed: true }),
    );
    const r = agentRoster(s, 'meridian', 10);
    expect(r.atWork.map((a) => a.id)).toEqual(['work']);
    expect(r.underWay.map((a) => a.id)).toEqual(['way']);
    expect(r.idle.map((a) => a.id)).toEqual(['idle']);
    expect(r.caught.map((c) => c.agent.id)).toEqual(['burned']);
  });

  it('says who holds a caught operative, so they can be ransomed home', () => {
    const s = board();
    s.agents.push(agent({ id: 'burned', exposed: true }));
    s.assets.push(
      AssetSchema.parse({
        id: 'ast-9', kind: 'operative', text: 'a Meridian agent', heldBy: 'vigil', quantity: 1,
        unit: 'person', agentId: 'burned', atSystemId: 'tor-2', acquiredTurn: 4,
      }),
    );
    const [caught] = agentRoster(s, 'meridian', 10).caught;
    expect(caught).toMatchObject({ heldBy: 'vigil', heldAt: 'tor-2' });
  });

  it("shows a rival's people only as the fog allows", () => {
    const s = board();
    s.agents.push(
      agent({ id: 'hidden', ownerFactionId: 'vigil', systemId: 'sek-1' }),
      agent({ id: 'blown', ownerFactionId: 'vigil', systemId: 'sek-1', exposed: true }),
    );
    const r = agentRoster(s, 'meridian', 10);
    expect(r.theirs).toEqual([{ ownerId: 'vigil', agents: [expect.objectContaining({ id: 'blown' })] }]);
  });

  it('counts slots by guile, and upkeep by the people still in service', () => {
    const s = board();
    s.agents.push(agent({ id: 'a' }), agent({ id: 'b', mission: null, effect: null }), agent({ id: 'c', exposed: true }));
    const r = agentRoster(s, 'meridian', 14);
    expect(r.inService).toBe(2);
    expect(r.upkeep).toBe(2 * AGENT_UPKEEP);
    expect(r.slots).toBe(MAX_AGENTS_BASE + 2);
    expect(agentRoster(s, 'meridian', 1).slots).toBe(1);
  });

  it('lists your counter-intelligence sweeps', () => {
    const s = board();
    s.pendingOrders.push({
      id: 'ord-ci', factionId: 'meridian', type: 'counter_intelligence', originId: 'sek-1', targetId: 'sek-1',
      durationTurns: 3, progress: 1, interruptible: true, officers: [], onInterrupt: 'cancel', visibility: [],
      label: 'sweep', durationRationale: '', path: [], force: {}, investedCredits: 0,
    });
    expect(agentRoster(s, 'meridian', 10).sweeps).toEqual([{ systemId: 'sek-1', turnsLeft: 2 }]);
  });
});
