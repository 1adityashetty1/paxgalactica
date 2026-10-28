import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The band-aids from the adversarial playtest of 2026-10-18
 * (`docs/playtest-2026-10-18.md`, audited in `docs/audit-2026-10-18.md`). Each
 * reducer rule is shown both ways: the old rule reproduces the bug, the new one
 * closes it.
 */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { applyOps, tickTurn } = await import('../src/domain/reducer.js');
const { createSeedState } = await import('../src/seed/scenario.js');
const { DemandSchema, ConcessionSchema } = await import('../src/domain/diplomacy.js');
const { secretsAbout } = await import('../src/domain/leverage.js');
const { holdToRuling } = await import('../src/domain/refusals.js');
const { SWAY_BY_BAND } = await import('../src/domain/acts.js');
const { COUNTERPARTY_BREACH_DISSENT, fleetTonsOf, ledgerFor } = await import('../src/domain/state.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { closeChannel, groundInConcessions, submitAction } = await import('../src/engine/turn.js');
const { serializeConcessionRecord } = await import('../src/model/calls.js');

type World = ReturnType<typeof createSeedState>;
const seed = (): World => createSeedState('meridian');
const system = (s: World, id: string) => s.systems.find((x) => x.id === id)!;
const faction = (s: World, id: string) => s.factions.find((f) => f.id === id)!;
const declare = (s: World, ops: unknown[], legacy = {}) =>
  applyOps(s, ops, 'model', 'meridian', true, legacy, 'declared');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('A1 — a cession under ultimatum comes out of the target’s hands', () => {
  // Meridian demands Kalzir of the Vigil, then takes it by force before the
  // Vigil gives way.
  const board = (): World => {
    const s = seed();
    s.demands = [
      DemandSchema.parse({
        id: 'dem-1-0', fromFactionId: 'meridian', toFactionId: 'vigil', kind: 'cession', systemId: 'tor-2',
        issuedTurn: 0, deadlineTurn: 2, text: 'Cede Kalzir.',
      }),
    ];
    system(s, 'tor-2').controllerFactionId = 'meridian';
    return s;
  };
  const concede = (legacy = {}) =>
    applyOps(board(), [{ op: 'concede_ultimatum', demandId: 'dem-1-0' }], 'model', 'vigil', true, legacy, 'reaction');

  it('ceded the issuer’s own world back to the target under the old rule', () => {
    expect(system(concede({ cessionFromTarget: false }).state, 'tor-2').controllerFactionId).toBe('vigil');
  });

  it('moves nothing when the target no longer holds the world', () => {
    const r = concede();
    expect(r.rejections).toEqual([]);
    expect(system(r.state, 'tor-2').controllerFactionId).toBe('meridian');
    expect(r.notes.join(' ')).toMatch(/no longer holds Kalzir/);
  });
});

describe('B1, B5 — a filter’s stamp is kept when it dropped nothing', () => {
  const bounds = {
    covert: [], groundwork: [], stat: 'influence', outcome: 'success',
    establishes: { kind: 'free_port', mechanism: 'record' }, yields: [], sentOnly: false,
  };

  it('stamps a sway with the band’s figure', () => {
    const held = holdToRuling([{ op: 'sway', factionId: 'meridian', whom: 'vigil', amount: 9 }], bounds);
    expect(held.ops).toEqual([{ op: 'sway', factionId: 'meridian', whom: 'vigil', amount: SWAY_BY_BAND.success }]);
  });

  it('stamps a commitment with its ruled mechanism', () => {
    const op = { op: 'establish_commitment', kind: 'free_port', factionIds: ['meridian'], text: 'A free port.', incomePerTurn: 60 };
    // A ruled income is stamped; a record on its own is no longer recorded from
    // a declaration at all (loop 15).
    const income = { ...bounds, establishes: { kind: 'free_port', mechanism: 'income' } };
    expect(holdToRuling([op], income).ops).toEqual([{ ...op, mechanism: 'income' }]);
    expect(holdToRuling([op], bounds).ops).toEqual([]);
  });
});

describe('B2 — one-jump moves do not chain in a batch', () => {
  const chain = [
    { op: 'move', factionId: 'meridian', originId: 'tor-1', targetId: 'sek-2', force: { battleship: 5 } },
    { op: 'move', factionId: 'meridian', originId: 'sek-2', targetId: 'sek-1', force: { battleship: 9 } },
  ];

  it('crossed two jumps at once under the old rule', () => {
    const r = declare(seed(), chain, { oneJumpOnce: false });
    expect(system(r.state, 'sek-1').ships.meridian!.battleship).toBe(16);
  });

  it('lands the first leg and sails the second', () => {
    const r = declare(seed(), chain);
    expect(r.rejections).toEqual([]);
    expect(system(r.state, 'sek-1').ships.meridian!.battleship).toBe(7);
    const sailing = r.state.pendingOrders.find((o) => o.factionId === 'meridian' && o.targetId === 'sek-1');
    expect(sailing?.type).toBe('fleet_movement');
  });
});

describe('B11 — the yard note and the bill say which limit bound', () => {
  it('still says the treasury was short when it was', () => {
    const s = seed();
    faction(s, 'meridian').credits = 300;
    const r = applyOps(s, [{ op: 'adjust_fleet', factionId: 'meridian', delta: 8 }], 'model');
    expect(r.notes.join(' ')).toMatch(/could only pay for/);
  });
});

describe('C4 — an accord may lift the other party’s toll', () => {
  const lift = [{ op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil', 'freeworlds', 'drajk'] }];
  const accord = (legacy = {}) => applyOps(seed(), lift, 'extraction', 'meridian', true, legacy, 'accord');

  it('was refused under the old rule', () => {
    expect(accord({ counterpartyTolls: false }).rejections.map((r) => r.code)).toEqual(['illegal_value']);
  });

  it('lifts it', () => {
    const r = accord();
    expect(r.rejections).toEqual([]);
    expect(faction(r.state, 'ojjul').tollTargets).not.toContain('meridian');
  });

  it('still refuses an accord that adds a target', () => {
    const s = seed();
    faction(s, 'ojjul').tollTargets = ['vigil'];
    const r = applyOps(s, [{ op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil', 'meridian'] }], 'extraction', 'meridian', true, {}, 'accord');
    expect(r.rejections.map((x) => x.code)).toEqual(['declared_only']);
  });

  it('holds the lift to the power that conceded it', () => {
    const conceded = [ConcessionSchema.parse({ by: 'ojjul', kind: 'toll_lift', text: 'The toll on Meridian comes off.' })];
    const ops = [...lift, { op: 'set_toll_policy', factionId: 'vigil', targets: [] }];
    expect(groundInConcessions(seed(), ops, conceded, 'ojjul').ops).toEqual(lift);
    expect(groundInConcessions(seed(), lift, [], 'ojjul').ops).toEqual([]);
  });
});

describe('D1 — a thief is aimed at a rival’s thing', () => {
  const sendAt = (assetId: string, legacy = {}) => {
    const s = declare(seed(), [{ op: 'recruit_agent', systemId: 'sek-1', agentClass: 'ghost' }]).state;
    return declare(
      s,
      [{ op: 'deploy_agent', systemId: 'tor-3', mission: 'larceny', effect: { kind: 'steal', assetId } }],
      legacy,
    );
  };

  it('kept the thief’s own asset as its mark under the old rule', () => {
    const r = sendAt('ast-0-0', { stealNamesARivalsThing: false });
    expect(r.state.agents.find((a) => a.ownerFactionId === 'meridian')!.effect).toMatchObject({ assetId: 'ast-0-0' });
  });

  it('drops the name and goes for what is worth most there', () => {
    const r = sendAt('ast-0-0');
    expect(r.rejections).toEqual([]);
    expect(r.state.agents.find((a) => a.ownerFactionId === 'meridian')!.effect).toMatchObject({ assetId: null });
    expect(r.notes.join(' ')).toMatch(/already yours/);
  });

  it('keeps a name that is a rival’s thing on that world', () => {
    const r = sendAt('ast-0-1');
    expect(r.state.agents.find((a) => a.ownerFactionId === 'meridian')!.effect).toMatchObject({ assetId: 'ast-0-1' });
  });
});

describe('D2 — what everyone sees is no secret', () => {
  const board = (visibility: string[]) => {
    const s = seed();
    s.pendingOrders.push({
      id: 'ord-1-0', factionId: 'meridian', type: 'capital_ship_construction', originId: 'sek-1', targetId: 'sek-1',
      durationTurns: 5, progress: 1, interruptible: true, onInterrupt: 'partial', visibility, label: 'the yards',
      durationRationale: '', path: [], officers: [], force: {}, investedCredits: 0,
    } as World['pendingOrders'][number]);
    return s;
  };

  it('files no proof of a programme every other power sees', () => {
    const all = board(['vigil', 'ojjul', 'freeworlds', 'drajk']);
    expect(secretsAbout(all, 'meridian').some((x) => x.ref === 'ord-1-0')).toBe(false);
    expect(secretsAbout(all, 'meridian', false).some((x) => x.ref === 'ord-1-0')).toBe(true);
  });

  it('still files one that somebody cannot see', () => {
    expect(secretsAbout(board(['vigil']), 'meridian').some((x) => x.ref === 'ord-1-0')).toBe(true);
  });
});

describe('D3 — a fleet under way is met, not stood down', () => {
  const board = () => {
    const sailing = applyOps(
      seed(),
      [{ op: 'move', factionId: 'vigil', originId: 'tor-3', targetId: 'tor-1', force: { battleship: 2 } }],
      'model', 'vigil', true, {}, 'bot',
    ).state;
    const order = sailing.pendingOrders.find((o) => o.factionId === 'vigil' && o.type === 'fleet_movement')!;
    return { sailing, order };
  };

  it('was stood down by an order under the old rule', () => {
    const { sailing, order } = board();
    const r = declare(sailing, [{ op: 'interrupt_order', orderId: order.id, reason: 'a flourish' }], { fleetsMeetInBattle: false });
    expect(r.state.pendingOrders.some((o) => o.id === order.id)).toBe(false);
  });

  it('is refused', () => {
    const { sailing, order } = board();
    const r = declare(sailing, [{ op: 'interrupt_order', orderId: order.id, reason: 'a flourish' }]);
    expect(r.rejections.map((x) => x.code)).toEqual(['illegal_value']);
    expect(r.state.pendingOrders.some((o) => o.id === order.id)).toBe(true);
  });
});

describe('E — the turn’s ledger counts the hulls that arrived in it', () => {
  // Two jumps through Meridian's own worlds sail, and land on the second tick.
  const sail = () =>
    declare(seed(), [{ op: 'move', factionId: 'meridian', originId: 'tor-1', targetId: 'sek-1', force: { battleship: 5 } }]).state;

  it('missed them under the old rule', () => {
    const landed = tickTurn(tickTurn(sail(), { ledgerAfterArrivals: false }).state, { ledgerAfterArrivals: false });
    expect(landed.report.ledger.upkeep).toBeLessThan(ledgerFor(landed.state, 'meridian').upkeep);
  });

  it('reads them', () => {
    const landed = tickTurn(tickTurn(sail()).state);
    expect(landed.report.ledger.upkeep).toBe(ledgerFor(landed.state, 'meridian').upkeep);
    expect(fleetTonsOf(landed.state, 'meridian')).toBeGreaterThan(0);
  });
});

describe('C7, C8 — the extraction pass is shown what each side conceded', () => {
  it('names a conceded thing by id and holder', () => {
    const s = seed();
    const record = serializeConcessionRecord(s, [
      ConcessionSchema.parse({ by: 'vigil', kind: 'sell_drawings', text: 'The drawings are yours.', assets: ['ast-0-1'] }),
    ]);
    expect(record).toContain('`ast-0-1`');
    expect(record).toContain('held by vigil');
    expect(record).toContain('`vigil:sell_drawings`');
    expect(record).toMatch(/accepted/);
  });
});

describe('D4 — reactions hear what landed', () => {
  it('chooses responders by the ops that landed, and carries a correction', () => {
    const campaign = Campaign.start('meridian', 'pt1018-d4');
    campaign.stage(
      [{ op: 'suborn_crews', factionId: 'meridian', fromFactionId: 'vigil', systemId: 'tor-3', count: 1 }],
      'turn a crew', 'The Vigil crew comes over.', 'model', 'meridian', { path: 'declared' },
    );
    campaign.stage([{ op: 'log_narrative', text: 'Nobody came over.' }], 'turn a crew:correction', '', 'model', 'meridian', { path: 'declared' });
    campaign.amendLastNarrative('Correction: the crew did not come over.');
    const brief = campaign.reactionBrief();
    expect(brief.ops.some((o) => (o as { op: string }).op === 'suborn_crews')).toBe(false);
    expect(brief.summary).toContain('Correction: the crew did not come over.');
  });
});

describe('C1, C2, C3, C13 — the other power’s charge for signing an accord', () => {
  const NO_GIFTS =
    'the Combine requires that nothing be given away for nothing; a gift, a waiver or a favour with no consideration is refused as ruinous precedent — a deal on any terms, however cheap, is not a gift';
  // Untagged, so the model's reading of it stands; NO_GIFTS is read off the acts.
  const PURSUE_DEBTS =
    'an unpaid debt must be pursued — a client left owing without consequence teaches every other client to try it';
  const NO_CLOSED_LANES =
    'will not close a lane — no blockade of civilian traffic, no embargo, no shut border; closed lanes are bad for everyone, including the closer';
  const said = [
    { speaker: 'player' as const, text: 'Four hundred to lift the toll.' },
    { speaker: 'faction' as const, text: 'Done.' },
  ];
  // The record is the deal (design §3): the payment and the lift are built
  // from what each side wrote down, and extraction only says they were agreed.
  const conceded = [
    ConcessionSchema.parse({ by: 'ojjul', kind: 'toll_lift', text: 'The Combine lifts its toll on Meridian.', lifts: ['meridian'] }),
    ConcessionSchema.parse({ by: 'meridian', kind: 'fee', text: 'Four hundred to the Combine.', credits: 400 }),
  ];
  const extraction = {
    narrative: 'Meridian pays four hundred and the Combine lifts its toll.',
    accepted: ['ojjul:toll_lift', 'meridian:fee'],
    ops: [],
  };
  const clean = { admissible: true, reason: '', stat: 'influence', difficulty: 10, rationale: '' };
  const breach = (principle: string, kind: string) => ({
    ...clean,
    breach: { kind, principles: [principle], how: 'it does', by: 'the council', reason: 'No.' },
  });
  const ojjul = (c: { state: World }) => faction(c.state, 'ojjul').dissent;

  it('C2: charges nothing when the player’s own side refused the accord', async () => {
    queue = {
      extraction: [extraction],
      appraisal: [breach(NO_CLOSED_LANES, 'red_line')],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-c2');
    const out = await closeChannel(campaign, 'ojjul', said, conceded);
    expect(out.refusal).not.toBeNull();
    expect(ojjul(campaign)).toBe(0);
    expect(calls.filter((c) => c.kind === 'appraisal')).toHaveLength(1);
  });

  it('C3: charges nothing for a line that is not about the deal', async () => {
    queue = {
      extraction: [extraction],
      appraisal: [clean, breach(NO_GIFTS, 'compulsion')],
      breach_relevance: [{ relevant: false, why: 'it was paid for' }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-c3');
    await closeChannel(campaign, 'ojjul', said, conceded);
    expect(ojjul(campaign)).toBe(0);
    // And the deal itself landed, the toll lift included (C4).
    expect(faction(campaign.state, 'ojjul').tollTargets).not.toContain('meridian');
  });

  it('C1, C13: the charge goes with the accord, and the conversation is told', async () => {
    queue = {
      extraction: [extraction],
      appraisal: [clean, breach(PURSUE_DEBTS, 'compulsion')],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-c1');
    await closeChannel(campaign, 'ojjul', said, conceded);
    expect(ojjul(campaign)).toBe(COUNTERPARTY_BREACH_DISSENT.compulsion);
    expect(campaign.stagedBindings()).toContain('attached');

    const at = campaign.stagedLabels().findIndex((l) => l.startsWith('accord with'));
    expect(campaign.discardStagedAt(at)).toBe(true);
    expect(ojjul(campaign)).toBe(0);
    expect(campaign.stagedBindings()).not.toContain('attached');
    const last = campaign.transcripts.ojjul!.at(-1)!;
    expect(last.at(-1)).toMatchObject({ speaker: 'record', text: expect.stringMatching(/WITHDRAWN/) });
  });

  it('C1: the charge cannot be withdrawn on its own', async () => {
    queue = {
      extraction: [extraction],
      appraisal: [clean, breach(PURSUE_DEBTS, 'compulsion')],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-c1b');
    await closeChannel(campaign, 'ojjul', said, conceded);
    const at = campaign.stagedBindings().indexOf('attached');
    expect(campaign.discardStagedAt(at)).toBe('attached');
    expect(ojjul(campaign)).toBe(COUNTERPARTY_BREACH_DISSENT.compulsion);
  });

  it('charges nothing on a line code reads off the acts, whatever a reading of one side says (bughunt 2026-10-28)', async () => {
    queue = {
      extraction: [extraction],
      appraisal: [clean, breach(NO_GIFTS, 'compulsion')],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-tagged');
    await closeChannel(campaign, 'ojjul', said, conceded);
    expect(ojjul(campaign)).toBe(0);
  });
});

describe('B9 — open work is not turned away for its covert half', () => {
  it('goes ahead without the sending when nobody is on the books', async () => {
    queue = {
      appraisal: [
        {
          kind: 'act',
          parts: [
            { kind: 'overt', what: 'lay down hulls', stat: 'industry', difficulty: 8 },
            { kind: 'covert', mission: 'surveillance', systemId: 'tor-3' },
          ],
        },
      ],
      resolution: [{ narrative: 'The yards go to work.', ops: [] }],
    };
    const campaign = Campaign.start('meridian', 'pt1018-b9');
    const out = await submitAction(campaign, 'Lay down four battleships at Sekkar Gate and put a watcher into Vantic.');
    expect(out.inadmissible ?? null).toBeNull();
    expect(out.check).not.toBeNull();
    expect(out.notes.join(' ')).toMatch(/nobody on the books to send/);
  });
});
