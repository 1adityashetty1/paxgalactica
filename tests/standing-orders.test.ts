import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A power is played by its doctrine on the turns the player does not reach it,
 * and by a model reaction on the turns it does. The reaction is now handed the
 * plan its doctrine would carry out, and the trace says whether it kept it.
 */

let queue: Record<string, unknown[]> = {};
const calls: { kind: string; user: string }[] = [];
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { Campaign } = await import('../src/engine/campaign.js');
const { endTurn } = await import('../src/engine/turn.js');
const { intentKeys, proposeFor } = await import('../src/domain/initiative.js');
const { setTelemetrySink, NULL_SINK } = await import('../src/model/telemetry.js');
type TraceRecord = import('../src/model/telemetry.js').TraceRecord;

beforeEach(() => {
  queue = {};
  calls.length = 0;
});

describe("a reaction is told its doctrine's plan", () => {
  it('reads the standing orders, and the trace says whether it kept them', async () => {
    const records: TraceRecord[] = [];
    setTelemetrySink({ write: (r) => records.push(r) });
    try {
      const campaign = Campaign.start('meridian', 'standing');
      const plan = proposeFor(campaign.state, 'vigil');
      expect(plan).not.toBeNull();
      campaign.stage([{ op: 'pay', factionId: 'meridian', to: 'vigil', amount: 10 }], 'a gift', '', 'model', 'meridian', { path: 'declared' });
      queue = { reaction: [{ factionId: 'vigil', narrative: 'Noted.', ops: [] }, { factionId: 'vigil', narrative: 'Noted.', ops: [] }] };
      await endTurn(campaign);

      const asked = calls.find((c) => c.kind === 'reaction' && c.user.includes('`vigil`'));
      expect(asked?.user).toMatch(/Your standing orders this turn/);
      expect(asked?.user).toContain(plan!.rationale);

      const doctrine = records.filter((r) => r.type === 'doctrine');
      expect(doctrine).toContainEqual(
        expect.objectContaining({ factionId: 'vigil', proposed: intentKeys(plan!.ops), acted: [], kept: intentKeys(plan!.ops).length === 0 }),
      );
    } finally {
      setTelemetrySink(NULL_SINK);
    }
  });
});

describe('intentKeys', () => {
  it('reads orders, builds and sendings the same way for a bot and a reaction', () => {
    expect(
      intentKeys([
        { op: 'move', factionId: 'vigil', originId: 'tor-2', targetId: 'tor-1', force: { battleship: 3 } },
        { op: 'build_ships', factionId: 'vigil', hull: 'escort', count: 2, systemId: 'tor-2' },
        { op: 'deploy_agent', factionId: 'vigil', systemId: 'sek-4', mission: 'surveillance' },
        { op: 'log_narrative', text: 'nothing' },
      ]),
    ).toEqual(['build_ships@tor-2', 'deploy_agent@sek-4', 'fleet_movement@tor-1']);
  });
});
