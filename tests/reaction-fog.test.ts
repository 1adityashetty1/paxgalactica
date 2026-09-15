import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

/**
 * Every reaction call sent `serializeState(state, state.playerFactionId)` —
 * the PLAYER'S fog, not the reacting faction's own. So the Vigil reasoned
 * from what Meridian can see: it read Meridian's own observable orders, and
 * every other power's disposition toward MERIDIAN rather than toward itself.
 * `serializeOrders(state, id)`, two lines below in the same function, was
 * already scoped correctly — only the much larger block built around it was
 * not. Same class of defect `worldAsSeenBy` exists to name: fog is a property
 * of the whole payload, and half of it was leaking one faction's view into
 * five others' heads.
 *
 * Pinned at the seam `gatherReactions` actually calls, with `callStructured`
 * mocked so no model call is made and the exact `user` string reaching the
 * model is inspectable.
 */

const calls: { kind: string; user: string }[] = [];

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    return {
      value: { reactions: [{ factionId: 'vigil', narrative: 'The Legate reads the dispatch.', ops: [] }] },
      attempts: 1,
      costUsd: 0,
    };
  },
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
}));

const { gatherReactions } = await import('../src/model/calls.js');
const { createSeedState } = await import('../src/seed/scenario.js');

describe('a reaction reasons from its own faction\'s board', () => {
  it('gives the Vigil its own viewpoint, not the player\'s', async () => {
    calls.length = 0;
    const state = createSeedState('meridian');

    await gatherReactions(state, ['vigil'], 'Meridian moved a fleet.');

    expect(calls).toHaveLength(1);
    const { user } = calls[0]!;

    // `serializeState`'s own header names the viewer directly — the single
    // strongest signal of which fog was actually sent.
    expect(user).toContain('Viewpoint: **Iron Vigil Remnant** (`vigil`)');
    expect(user).not.toContain('Viewpoint: **Meridian Trade Authority** (`meridian`)');
  });

  it('shows the Vigil its own disposition toward every other power, not the player\'s', async () => {
    calls.length = 0;
    const state = createSeedState('meridian');
    // A live, asymmetric disposition, so "toward vigil" and "toward meridian"
    // cannot coincidentally read the same.
    state.factions.find((f) => f.id === 'ojjul')!.disposition.vigil = -77;
    state.factions.find((f) => f.id === 'ojjul')!.disposition.meridian = 42;

    await gatherReactions(state, ['vigil'], 'Meridian moved a fleet.');

    const { user } = calls[0]!;
    // serializeFactions reports, for each OTHER faction, its disposition
    // TOWARD THE VIEWER. With the viewer fixed to `vigil`, the Combine's row
    // must show its stance on the Vigil (-77), not on the player (42).
    expect(user).toMatch(/Ojjul Nar Combine[\s\S]{0,200}toward vigil: -77/);
    expect(user).not.toMatch(/Ojjul Nar Combine[\s\S]{0,200}toward meridian: 42/);
  });

  it('still tells the faction how it itself feels about the player', async () => {
    // `serializeFactions` suppresses the "toward" column on the viewer's own
    // row, so nowhere in the main state block says how the Vigil feels about
    // Meridian. That line has to survive the fix, from a different serializer.
    calls.length = 0;
    const state = createSeedState('meridian');
    state.factions.find((f) => f.id === 'vigil')!.disposition.meridian = -60;

    await gatherReactions(state, ['vigil'], 'Meridian moved a fleet.');

    const { user } = calls[0]!;
    expect(user).toContain('Disposition toward the player (meridian): -60');
  });

  it('does not send the same "orders in progress" section twice', async () => {
    // Before the fix, the per-faction block explicitly restated
    // `serializeOrders(state, id)` under its own heading — real duplication
    // once the main state block was ALSO scoped to that faction, since both
    // calls became `serializeOrders(state, 'vigil')` verbatim.
    calls.length = 0;
    const state = createSeedState('meridian');

    await gatherReactions(state, ['vigil'], 'Meridian moved a fleet.');

    const { user } = calls[0]!;
    const headings = user.match(/orders in progress/gi) ?? [];
    expect(headings).toHaveLength(1);
  });
});
