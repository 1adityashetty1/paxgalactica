import { describe, expect, it } from 'vitest';
import { replay, type Journal } from '../src/engine/journal.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { dispatch } from '../src/server/router.js';
import { GameSession } from '../src/server/session.js';
import { ROUTES } from '../src/api/contract.js';

/**
 * The strongest evidence the browser port did not corrupt the engine: drive a
 * campaign through the SERVER's own handlers for several turns, then rebuild it
 * from its ops journal with zero model calls and demand byte-identical state.
 *
 * Model-backed routes are unavailable here (PAXGALACTICA_NO_NETWORK=1 makes any
 * real call throw), so declarations are staged directly — the same path
 * `submitAction` uses once resolution returns. What is being tested is the
 * commit/tick/journal pipeline the HTTP layer drives, not the model.
 */

const reach = (session: GameSession): Campaign =>
  (session as unknown as { campaign: Campaign }).campaign;

describe('a server-driven campaign replays exactly', () => {
  it('survives several turns of building, moving and fighting', async () => {
    const store = new MemoryCampaignStore();
    const session = new GameSession(store);
    await dispatch(session, 'POST', ROUTES.newCampaign, {
      factionId: 'freeworlds',
      name: 'parity',
    });
    const campaign = reach(session);

    // Turn 1 — start a shipyard and push a fleet at a neutral world.
    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
          originId: 'ark-1', targetId: 'ark-1', durationTurns: 3, label: 'Arkanis slipway',
          visibility: ['vigil'],
        },
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
          originId: 'ark-3', targetId: 'slu-6', label: 'Drift squadron',
        },
      ],
      'open the campaign',
    );
    await dispatch(session, 'POST', ROUTES.endturn, {});

    // Turn 2 — a treaty, an agent, and ships moved into a rival's system.
    campaign.stage(
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['freeworlds', 'meridian'],
          terms: { incomeShares: [{ systemId: 'slu-3', factionId: 'freeworlds', share: 0.4 }] },
          durationTurns: 6,
          summary: 'Ithaal concession',
        },
        {
          op: 'deploy_agent', ownerFactionId: 'freeworlds', systemId: 'tio-3',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 },
        },
        { op: 'adjust_ships', systemId: 'tio-3', factionId: 'freeworlds', delta: 4 },
      ],
      'open a second front',
    );
    await dispatch(session, 'POST', ROUTES.endturn, {});

    // Turn 3 — declare, then throw one declaration away before it lands.
    // Both inside MAX_NARRATIVE_CREDITS, so this stays a test of staging and
    // discard rather than of the narrative-credit cap.
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -200 }], 'a');
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -240 }], 'b');
    await dispatch(session, 'POST', ROUTES.discardStaged, { index: 0 });
    await dispatch(session, 'POST', ROUTES.endturn, {});

    // Turn 4 — quiet: nothing declared, time simply passes.
    await dispatch(session, 'POST', ROUTES.endturn, {});

    expect(campaign.state.turn).toBe(4);

    // The live campaign agrees with its own journal...
    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);

    // ...and so does a cold rebuild from what was written to the store, which
    // is what `pnpm replay` actually does.
    await campaign.save();
    const saved = await store.load('parity');
    expect(saved).not.toBeNull();
    const rebuilt = replay(saved!.journal as Journal).state;
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(campaign.state));
  });

  it('reproduces the campaign identically on a second rebuild', async () => {
    const store = new MemoryCampaignStore();
    const session = new GameSession(store);
    await dispatch(session, 'POST', ROUTES.newCampaign, { factionId: 'vigil', name: 'twice' });
    const campaign = reach(session);

    campaign.stage(
      [
        {
          op: 'deploy_agent', ownerFactionId: 'vigil', systemId: 'ark-1',
          mission: 'assassination', effect: { kind: 'hull_damage', perTurn: 3 },
        },
      ],
      'a killing',
    );
    await dispatch(session, 'POST', ROUTES.endturn, {});
    await dispatch(session, 'POST', ROUTES.endturn, {});
    await campaign.save();

    const file = (await store.load('twice'))!;
    // Dice, agent resolution and exposure are all seeded from turn number, so
    // two rebuilds of the same journal cannot diverge.
    const a = replay(file.journal as Journal).state;
    const b = replay(file.journal as Journal).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(campaign.state));
  });

  it('keeps a resumed campaign replayable after further turns', async () => {
    const store = new MemoryCampaignStore();
    const first = new GameSession(store);
    await dispatch(first, 'POST', ROUTES.newCampaign, { factionId: 'hutt', name: 'resumed' });
    reach(first).stage(
      [
        {
          op: 'issue_order', factionId: 'hutt', type: 'espionage',
          originId: 'kes-2', targetId: 'slu-1', durationTurns: 2, label: 'listening post',
        },
      ],
      'listen',
    );
    await dispatch(first, 'POST', ROUTES.endturn, {});
    await reach(first).save();

    // A new process picks the campaign up and plays on.
    const second = new GameSession(store);
    await dispatch(second, 'POST', ROUTES.resume, { name: 'resumed' });
    await dispatch(second, 'POST', ROUTES.endturn, {});
    await dispatch(second, 'POST', ROUTES.endturn, {});

    const resumed = reach(second);
    expect(resumed.state.turn).toBe(3);
    const check = resumed.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
  });

  it('records every kind of entry the journal supports', async () => {
    const store = new MemoryCampaignStore();
    const session = new GameSession(store);
    await dispatch(session, 'POST', ROUTES.newCampaign, { factionId: 'krayt', name: 'kinds' });
    const campaign = reach(session);
    campaign.stage([{ op: 'adjust_fleet', factionId: 'krayt', delta: 5 }], 'muster');
    await dispatch(session, 'POST', ROUTES.endturn, {});

    const kinds = new Set(campaign.journal.entries.map((e) => e.kind));
    expect(kinds.has('seed')).toBe(true);
    expect(kinds.has('ops')).toBe(true);
    expect(kinds.has('tick')).toBe(true);
  });
});
