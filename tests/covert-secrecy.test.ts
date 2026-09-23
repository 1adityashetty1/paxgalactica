import { describe, expect, it, vi } from 'vitest';

/**
 * Covert work stays with the power that did it.
 *
 * Three leaks, all measured in one live save:
 *
 * - **What reactions were told.** `endTurn` handed every responder the whole
 *   staged summary verbatim, and chose responders by what the player's ops
 *   touched — so the Iron Vigil was told the Combine had directed an
 *   assassination of its Iron Marshal, and answered by name.
 * - **The player's own notes.** A declared action's `log_narrative` was
 *   written public, so the failed attempt's account went into the log every
 *   NPC prompt reads.
 * - **An NPC's reaction text.** Drajk's reaction told the player it had
 *   "inserted a theft operative into Vigil-held Vantic".
 *
 * `callStructured` is stubbed, so this runs a real end of turn with no model.
 */

const reactionCalls: { user: string; factionId: string }[] = [];

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string; label: string }) => {
    const factionId = /reaction \((\w+)\)/.exec(call.label)?.[1] ?? '';
    reactionCalls.push({ user: call.user, factionId });
    const reactions =
      factionId === 'drajk'
        ? [
            {
              factionId: 'drajk',
              narrative: 'The Huntmaster slips a theft operative onto Vantic.',
              ops: [
                { op: 'log_narrative', text: 'Drajk inserts a theft operative into Vantic.' },
                {
                  op: 'deploy_agent',
                  systemId: 'tor-3',
                  mission: 'theft',
                  effect: { kind: 'income_penalty', perTurn: 5 },
                  cover: 'a chandler',
                },
              ],
            },
          ]
        : [{ factionId, narrative: `${factionId} watches.`, ops: [] }];
    // One reaction per call: each reaction call answers for a single power.
    return { value: reactions[0], attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
  timingReport: () => '',
}));

const { Campaign } = await import('../src/engine/campaign.js');
const { endTurn } = await import('../src/engine/turn.js');
const { eventsVisibleTo } = await import('../src/domain/intel.js');
type BattleReport = import('../src/domain/battle.js').BattleReport;

const ASSASSINATION = 'Direct an operative to assassinate the Iron Marshal';

function withCovertDeclaration() {
  const campaign = Campaign.start('ojjul', 'covert-secrecy');
  const home = campaign.state.systems.find((s) => s.controllerFactionId === 'ojjul')!;
  // A declared covert action as `submitAction` stages it: secret, rolled, with
  // the resolution call's own account of the attempt as a note.
  campaign.stage(
    [
      { op: 'log_narrative', text: "Dovic's attempt on the Iron Marshal at Vantic fails." },
      { op: 'adjust_credits', factionId: 'ojjul', delta: -50, reason: 'the attempt cost this' },
    ],
    ASSASSINATION,
    'The attempt fails in the dark.',
    'model',
    'ojjul',
    { binding: 'rolled', secret: true },
  );
  // And an ordinary public declaration beside it.
  campaign.stage(
    [{ op: 'log_narrative', text: 'The Combine opens its ledgers at Shalka.' }],
    'Open the ledgers',
    'Shalka trades.',
    'model',
    'ojjul',
    { binding: 'rolled' },
  );
  return { campaign, home };
}

describe('covert work stays with the power that did it', () => {
  it('tells no reacting power about a secret declaration', async () => {
    reactionCalls.length = 0;
    const { campaign } = withCovertDeclaration();
    await endTurn(campaign);

    expect(reactionCalls.length).toBeGreaterThan(0);
    for (const { user } of reactionCalls) {
      expect(user).not.toContain(ASSASSINATION);
      expect(user).not.toContain('The attempt fails in the dark.');
      // The public one still reaches them.
      expect(user).toContain('Open the ledgers');
    }
  });

  it('says nothing happened rather than listing nothing, when all of it was secret', async () => {
    reactionCalls.length = 0;
    const campaign = Campaign.start('ojjul', 'covert-only');
    campaign.stage(
      [{ op: 'adjust_credits', factionId: 'ojjul', delta: -50 }],
      ASSASSINATION, '', 'model', 'ojjul', { binding: 'rolled', secret: true },
    );
    await endTurn(campaign);
    for (const { user } of reactionCalls) {
      expect(user).not.toMatch(/acted this turn:\s*\n\s*\n\s*(---|$)/);
      expect(user).toContain('did nothing this turn that you could see');
    }
  });

  it("writes a secret declaration's notes for its actor alone, and replays them so", async () => {
    const { campaign } = withCovertDeclaration();
    await endTurn(campaign);

    const attempt = (who: string) =>
      eventsVisibleTo(campaign.state, who).some((e) => e.text.includes("Dovic's attempt"));
    expect(attempt('ojjul')).toBe(true);
    expect(attempt('vigil')).toBe(false);
    // The public note is still public.
    expect(
      eventsVisibleTo(campaign.state, 'vigil').some((e) => e.text.includes('opens its ledgers')),
    ).toBe(true);
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it("withholds an NPC reaction that places an operative, while its ops still land", async () => {
    reactionCalls.length = 0;
    const { campaign } = withCovertDeclaration();
    // A public act that touches Drajk, so Drajk is a responder and the stubbed
    // operative exists at all.
    campaign.stage(
      [{ op: 'adjust_disposition', factionId: 'ojjul', towardFactionId: 'drajk', delta: 5 }],
      'Warm to the Confederacy', '', 'model', 'ojjul', { binding: 'rolled' },
    );
    const seen: string[] = [];
    const outcome = await endTurn(campaign, (v) => seen.push(v.factionId));
    expect(reactionCalls.some((c) => c.factionId === 'drajk')).toBe(true);

    expect(outcome.reactions.map((r) => r.factionId)).not.toContain('drajk');
    expect(seen).not.toContain('drajk');
    expect(JSON.stringify(outcome)).not.toContain('theft operative');
    // The operative is real.
    expect(campaign.state.agents.some((a) => a.ownerFactionId === 'drajk')).toBe(true);
    // And its note is Drajk's alone.
    const note = (who: string) =>
      eventsVisibleTo(campaign.state, who).some((e) => e.text.includes('Drajk inserts'));
    expect(note('drajk')).toBe(true);
    expect(note('ojjul')).toBe(false);
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('still wakes the power an attack lands on, when the attack rides with covert work', () => {
    // Battles are public: a fleet under way is seen by everyone, so the part of
    // a secret declaration that sails counts toward who reacts. Only the
    // operative, and the prose, are withheld.
    const campaign = Campaign.start('ojjul', 'covert-attack');
    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'ojjul', type: 'fleet_movement',
          originId: 'ilv-2', targetId: 'tor-3', force: 4,
        },
        {
          op: 'deploy_agent', systemId: 'tor-3', mission: 'sabotage',
          effect: { kind: 'hull_damage', perTurn: 2 },
        },
      ],
      'Strike Vantic and plant a saboteur', 'narr', 'model', 'ojjul',
      { binding: 'rolled', secret: true },
    );
    const brief = campaign.reactionBrief();
    expect(brief.summary).toBe('');
    const kinds = brief.ops.map((o) => (o as { op: string }).op);
    expect(kinds).toEqual(['issue_order']);
  });

  it('fights the battle an attack in a secret declaration sails into', async () => {
    // The fix touches what reactions are told, which notes are private, and
    // what may be discarded — none of which a battle reads. Pinned end to end
    // anyway: an attack staged inside a secret, rolled batch must still sail,
    // arrive, fight, report and replay, and must not be withdrawable.
    const campaign = Campaign.start('freeworlds', 'covert-battle');
    const origin = campaign.state.systems.find((x) => x.id === 'ark-3')!;
    const target = campaign.state.systems.find((x) => x.id === 'sek-6')!;
    origin.ships = { freeworlds: { battleship: 12, lifter: 4 } };
    target.controllerFactionId = 'vigil';
    target.garrison = 3;
    target.garrisonMax = 3;
    target.ships = {};
    // The committed world is the one that fights; mirror the edit there too.
    (campaign as unknown as { committed: typeof campaign.state }).committed = campaign.state;

    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
          originId: 'ark-3', targetId: 'sek-6', force: { battleship: 12, lifter: 4 },
        },
        { op: 'log_narrative', text: 'The strike force slips its moorings under a false manifest.' },
      ],
      'Strike Sekkar under cover', '', 'model', 'freeworlds',
      { binding: 'rolled', secret: true },
    );
    expect(campaign.discardStaged()).toBe(0);
    expect(campaign.state.pendingOrders.some((o) => o.type === 'fleet_movement')).toBe(true);

    // The strike's OWN battle, not merely the first on the board: main's bots
    // read disposition, and Meridian's storms a Vigil-held Neth one jump from
    // Sekkar on turn 1 — before a two-jump strike from Arkane can arrive. The
    // strike then fights whoever holds it.
    const battles: BattleReport[] = [];
    const ours = () =>
      battles.filter((b) => b.rounds.some((r) => r.attackers.some((a) => a.factionId === 'freeworlds')));
    for (let i = 0; i < 4 && ours().length === 0; i++) {
      const out = await endTurn(campaign);
      battles.push(...(out.report?.battles ?? []));
    }
    expect(ours().length).toBeGreaterThan(0);
    expect(campaign.state.systems.find((x) => x.id === 'sek-6')!.controllerFactionId).toBe('freeworlds');
    // No replay check here: the board above was arranged by hand, outside the
    // journal. Replay parity for secret batches is pinned by the tests above.
  });
});
