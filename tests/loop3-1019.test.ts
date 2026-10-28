import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixes from the third loop of the advisor playtest (2026-10-19). */

const calls: { kind: string; user: string; schema: { safeParse: (v: unknown) => { success: boolean } } }[] = [];
let queue: Record<string, unknown[]> = {};
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string; schema: { safeParse: (v: unknown) => { success: boolean } } }) => {
    calls.push(call);
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { ConcessionSchema } = await import('../src/domain/diplomacy.js');
const { transfersFromRecord } = await import('../src/engine/turn.js');
const { pressuresOn } = await import('../src/domain/pressures.js');
const { GameSession } = await import('../src/server/session.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('a ceasefire naming worlds is not a cession', () => {
  it('builds a cession only of worlds the ceder holds, and never from `about`', () => {
    const s = createSeedState('meridian');
    const ceasefire = ConcessionSchema.parse({ by: 'vigil', kind: 'ceasefire', text: 'The Vigil holds Kalzir and Torrek quiet.', about: ['tor-2', 'tor-1'] });
    expect(transfersFromRecord(s, [ceasefire], 'meridian', 'vigil').ops).toEqual([]);
    // Misfiled in `systems`: Torrek is not the Vigil's to hand over, so only Kalzir would move.
    const misfiled = ConcessionSchema.parse({ by: 'vigil', kind: 'ceasefire', text: 'Quiet at Torrek.', systems: ['tor-1'] });
    expect(transfersFromRecord(s, [misfiled], 'meridian', 'vigil').ops).toEqual([]);
  });
});

describe('the staff’s flags', () => {
  it('open with whose worlds are whose, and give no odds for a world with no battle line', () => {
    const s = createSeedState('meridian');
    const tor1 = s.systems.find((x) => x.id === 'tor-1')!;
    tor1.ships.meridian = { lifter: 2 };
    const flags = pressuresOn(s, 'meridian');
    expect(flags[0]).toMatch(/^Worlds you hold: .*Torrek Anchorage.*do not make the world theirs/);
    expect(flags.join('\n')).not.toMatch(/what stands at Torrek Anchorage/);
  });

  it('count the defender’s ships a jump from the target', () => {
    const s = createSeedState('meridian');
    const before = pressuresOn(s, 'meridian').find((f) => f.includes('attacked Kalzir'))!;
    s.systems.find((x) => x.id === 'tor-4')!.ships.vigil = { battleship: 30 };
    const after = pressuresOn(s, 'meridian').find((f) => f.includes('attacked Kalzir'))!;
    const ratio = (t: string) => Number(/it would be ([\d.]+):1/.exec(t)![1]);
    expect(ratio(after)).toBeLessThan(ratio(before));
  });
});

describe('the counsellor', () => {
  it('hears what it said last time', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'counsel-memory');
    queue = { advisor: [{ counsel: 'The Vigil masses at Vantic: fortify Torrek Anchorage.' }, { counsel: 'Torrek still matters.' }] };
    await session.advisor('What should we do?');
    await session.advisor('And now?');
    expect(calls[1]!.user).toMatch(/What you told your leader earlier this turn[\s\S]*The Vigil masses at Vantic: fortify Torrek Anchorage/);
    expect(session.snapshot()!.lastCounsel).toMatchObject({ counsel: 'Torrek still matters.' });
  });
});
