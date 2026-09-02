import { observeOrders } from '../src/domain/intel.js';
import { describe, expect, it } from 'vitest';
import {
  ActionRequestSchema,
  BriefingSchema,
  CampaignViewSchema,
  NewCampaignRequestSchema,
  ROUTES,
  ServerEventSchema,
} from '../src/api/contract.js';
import { buildBriefing } from '../src/engine/briefing.js';
import { Campaign, ACTION_POINTS_PER_TURN } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';

const campaignWithTurn = () => {
  const campaign = Campaign.start('freeworlds', 'contract', new MemoryCampaignStore());
  campaign.stage(
    [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 3, label: 'Arkanis slipway',
        visibility: ['vigil'],
      },
    ],
    'build a slipway',
    'Work begins on the slipway.',
  );
  campaign.commitTurn();
  const { report } = campaign.tick();
  return { campaign, report };
};

/** A campaign whose turn actually contained a battle, not just a build order. */
const campaignWithBattle = () => {
  const campaign = Campaign.start('krayt', 'contract-battle', new MemoryCampaignStore());
  const origin = campaign.state.systems.find((s) => s.id === 'ark-5')!;
  origin.ships['krayt'] = 20;
  campaign.stage(
    [
      {
        op: 'issue_order', factionId: 'krayt', type: 'fleet_movement',
        originId: 'ark-5', targetId: 'ark-6', force: 20,
      },
    ],
    'raid Pell Reach',
  );
  campaign.commitTurn();
  let report = campaign.tick().report;
  for (let i = 0; i < 5 && report.battles.length === 0; i++) report = campaign.tick().report;
  return { campaign, report };
};

describe('the contract accepts real engine output', () => {
  it('validates a briefing carrying a real battle report', () => {
    // The drift risk `BattleReportSchema` exists to catch: the domain type and
    // the wire schema are the same definition, so a field added to a battle in
    // the reducer either appears here or fails this test.
    const { campaign, report } = campaignWithBattle();
    expect(report.battles.length, 'no battle was fought').toBeGreaterThan(0);
    const parsed = BriefingSchema.safeParse(buildBriefing(campaign.state, report));
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 4))).toBe(true);

    const battle = parsed.success ? parsed.data.battles[0]! : null;
    expect(battle?.rounds.length).toBeGreaterThan(0);
    expect(battle?.roll).toBeGreaterThanOrEqual(1);
  });

  it('validates a full campaign view built from live state', () => {
    // The point of a Zod-first contract is that it is checked against the real
    // thing, not against a hand-written fixture that agrees with it by design.
    const { campaign, report } = campaignWithTurn();
    // Built the way the server builds it: the client is served the world as
    // the player sees it, not the campaign's own state.
    const seen = observeOrders(campaign.state, campaign.state.playerFactionId);
    const view = {
      state: { ...campaign.state, pendingOrders: seen.orders },
      rumours: seen.rumours,
      staged: [],
      briefing: buildBriefing(campaign.state, report),
      openChannel: null,
      channelHistory: [],
      actionPoints: { left: campaign.actionPointsLeft, perTurn: ACTION_POINTS_PER_TURN },
      name: campaign.name,
      maxTurns: campaign.maxTurns,
      epilogue: campaign.epilogue,
    };
    const parsed = CampaignViewSchema.safeParse(view);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 4))).toBe(true);
  });

  it('validates a briefing produced by the engine', () => {
    const { campaign, report } = campaignWithTurn();
    const parsed = BriefingSchema.safeParse(buildBriefing(campaign.state, report));
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 4))).toBe(true);
  });

  it('survives a JSON round trip, which is how it will actually travel', () => {
    const { campaign, report } = campaignWithTurn();
    const seen = observeOrders(campaign.state, campaign.state.playerFactionId);
    const view = {
      state: { ...campaign.state, pendingOrders: seen.orders },
      rumours: seen.rumours,
      staged: [{ index: 0, label: 'x', narrative: 'y' }],
      briefing: buildBriefing(campaign.state, report),
      openChannel: null,
      channelHistory: [{ speaker: 'player' as const, text: 'hello' }],
      actionPoints: { left: 1, perTurn: ACTION_POINTS_PER_TURN },
      name: 'contract',
      maxTurns: campaign.maxTurns,
      epilogue: campaign.epilogue,
    };
    const wire = JSON.parse(JSON.stringify(view));
    expect(CampaignViewSchema.safeParse(wire).success).toBe(true);
  });
});

describe('request validation', () => {
  it('rejects an empty action', () => {
    expect(ActionRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(ActionRequestSchema.safeParse({ text: 'fortify Dolomar' }).success).toBe(true);
  });

  it('caps action length so a paste cannot blow up a prompt', () => {
    expect(ActionRequestSchema.safeParse({ text: 'x'.repeat(5000) }).success).toBe(false);
  });

  it('rejects a campaign name that could escape the save directory', () => {
    expect(NewCampaignRequestSchema.safeParse({ factionId: 'hutt', name: '../etc' }).success).toBe(
      false,
    );
    expect(NewCampaignRequestSchema.safeParse({ factionId: 'hutt', name: 'run-2' }).success).toBe(
      true,
    );
  });

  it('defaults the campaign name', () => {
    const parsed = NewCampaignRequestSchema.parse({ factionId: 'krayt' });
    expect(parsed.name).toBe('campaign');
  });
});

describe('server events', () => {
  it('accepts each event variant and rejects an unknown one', () => {
    expect(
      ServerEventSchema.safeParse({ type: 'progress', label: 'Resolving', busy: true }).success,
    ).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'error', message: 'boom' }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'hello', turn: 0 }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'nonsense' }).success).toBe(false);
  });
});

describe('routes', () => {
  it('are all under /api so static files can be served from the root', () => {
    const paths = [
      ROUTES.campaign,
      ROUTES.newCampaign,
      ROUTES.resume,
      ROUTES.factions,
      ROUTES.action,
      ROUTES.endturn,
      ROUTES.discardStaged,
      ROUTES.events,
      ROUTES.talk('hutt'),
      ROUTES.endtalk('hutt'),
    ];
    for (const p of paths) expect(p.startsWith('/api/')).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
