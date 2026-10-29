import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An accord is built from the record and lands whole
 * (`docs/design-2026-10-18-code-knows.md` §2–3). Each power writes down what it
 * gives as it speaks, with ids; extraction says which terms were agreed, and
 * the engine builds every transfer they name.
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

const { createSeedState } = await import('../src/seed/scenario.js');
const { applyOps } = await import('../src/domain/reducer.js');
const { ConcessionSchema } = await import('../src/domain/diplomacy.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { closeChannel, transfersFromRecord, withoutRecordTransfers } = await import('../src/engine/turn.js');

const c = (by: string, kind: string, extra: Record<string, unknown> = {}) =>
  ConcessionSchema.parse({ by, kind, text: `${by} gives ${kind}.`, ...extra });
const clean = { admissible: true, reason: '', stat: 'influence', difficulty: 10, rationale: '' };
const said = [
  { speaker: 'player' as const, text: 'Your drawings for five hundred.' },
  { speaker: 'faction' as const, text: 'Done.' },
];

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

describe('the engine builds the transfers the record names', () => {
  it('a payment, a thing, a toll lifted for a term', () => {
    const s = createSeedState('meridian');
    const built = transfersFromRecord(
      s,
      [
        c('vigil', 'sell_drawings', { assets: ['ast-0-1'] }),
        c('meridian', 'price', { credits: 500 }),
      ],
      'meridian',
      'vigil',
    );
    expect(built.ops).toContainEqual({ op: 'pay', factionId: 'meridian', to: 'vigil', amount: 500, for: 'the terms agreed' });
    expect(built.ops).toContainEqual({ op: 'transfer_asset', assetId: 'ast-0-1', toFactionId: 'meridian', reason: '(under the terms agreed)' });
    const lift = transfersFromRecord(s, [c('ojjul', 'toll_lift', { lifts: ['meridian'], liftTurns: 5 })], 'meridian', 'ojjul');
    expect(lift.ops).toEqual([{ op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil', 'freeworlds', 'drajk'], forTurns: 5 }]);
    // Only the two powers at the table: a third power's term builds nothing.
    expect(transfersFromRecord(s, [c('ojjul', 'toll_lift', { lifts: ['meridian'] })], 'meridian', 'vigil').ops).toEqual([]);
  });

  it('a world ceded carries what the other side gave as its price', () => {
    const s = createSeedState('meridian');
    const built = transfersFromRecord(
      s,
      [c('vigil', 'cede', { systems: ['tor-2'] }), c('meridian', 'price', { credits: 800 }), c('meridian', 'salvage', { assets: ['ast-0-0'] })],
      'meridian',
      'vigil',
    );
    expect(built.ops).toHaveLength(1);
    expect(built.ops[0]).toMatchObject({
      op: 'form_treaty',
      treatyType: 'cession',
      parties: ['vigil', 'meridian'],
      terms: { territory: ['tor-2'], payment: { meridian: -800, vigil: 800 }, assets: [{ assetId: 'ast-0-0', toFactionId: 'vigil' }] },
    });
  });

  it('a world bought with a thing, not credits, passes the cession guard', () => {
    const s = createSeedState('meridian');
    const built = transfersFromRecord(s, [c('vigil', 'cede', { systems: ['tor-2'] }), c('meridian', 'salvage', { assets: ['ast-0-0'] })], 'meridian', 'vigil');
    const r = applyOps(s, built.ops, 'extraction', 'meridian', true, {}, 'accord');
    expect(r.rejections).toEqual([]);
    expect(r.state.systems.find((x) => x.id === 'tor-2')!.controllerFactionId).toBe('meridian');
  });
});

describe('extraction no longer writes them', () => {
  it('drops the transfers, a cession and a sale written as a contract, and strips the rest', () => {
    const out = withoutRecordTransfers([
      { op: 'pay', factionId: 'meridian', to: 'vigil', amount: 5 },
      { op: 'transfer_asset', assetId: 'ast-0-1', toFactionId: 'meridian' },
      { op: 'form_treaty', treatyType: 'cession', parties: ['a', 'b'], terms: { territory: ['x'] } },
      { op: 'form_treaty', treatyType: 'contract', parties: ['a', 'b'], terms: { assets: [{ assetId: 'z', toFactionId: 'a' }], payment: { a: -5, b: 5 } } },
      { op: 'form_treaty', treatyType: 'non_aggression', parties: ['a', 'b'], terms: { payment: { a: -5, b: 5 } } },
    ]);
    expect(out.ops).toEqual([{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['a', 'b'], terms: {} }]);
    expect(out.dropped).toHaveLength(4);
  });
});

describe('an accord built from the record', () => {
  it('moves the other power’s thing and the price together (C7, C8)', async () => {
    queue = {
      extraction: [
        {
          narrative: 'The drawings change hands for five hundred.',
          accepted: ['vigil:sell_drawings', 'meridian:price'],
          // The old mistake, written anyway: a fresh dossier and a loose payment.
          ops: [
            { op: 'pay', factionId: 'meridian', to: 'vigil', amount: 500 },
            { op: 'transfer_asset', assetId: 'ast-0-1', toFactionId: 'meridian' },
          ],
        },
      ],
      appraisal: [clean, clean],
    };
    const campaign = Campaign.start('meridian', 'record-sale');
    const before = campaign.state.factions.find((f) => f.id === 'meridian')!.credits;
    const out = await closeChannel(campaign, 'vigil', said, [
      c('vigil', 'sell_drawings', { assets: ['ast-0-1'] }),
      c('meridian', 'price', { credits: 500 }),
    ]);
    expect(out.rejections).toEqual([]);
    expect(campaign.state.assets.find((a) => a.id === 'ast-0-1')!.heldBy).toBe('meridian');
    // Paid once, not twice: the extraction's own payment was left out.
    expect(before - campaign.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(500);
    expect(out.notes.join(' ')).toMatch(/record writes the transfers/);
  });

  it('builds nothing from a term on the table that was not agreed', async () => {
    queue = { extraction: [{ narrative: 'No deal.', accepted: [], ops: [] }] };
    const campaign = Campaign.start('meridian', 'record-none');
    await closeChannel(campaign, 'vigil', said, [c('vigil', 'sell_drawings', { assets: ['ast-0-1'] })]);
    expect(campaign.state.assets.find((a) => a.id === 'ast-0-1')!.heldBy).toBe('vigil');
  });

  it('fails whole when a built transfer cannot be carried out, and says so', async () => {
    queue = {
      extraction: [
        {
          narrative: 'Meridian pays four hundred for a thing the Vigil does not have.',
          accepted: ['vigil:ghost', 'meridian:price'],
          ops: [{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'vigil'], terms: {} }],
        },
      ],
      appraisal: [clean, clean],
    };
    const campaign = Campaign.start('meridian', 'record-fails');
    const before = campaign.state.factions.find((f) => f.id === 'meridian')!.credits;
    const out = await closeChannel(campaign, 'vigil', said, [
      c('vigil', 'ghost', { assets: ['ast-9-9'] }),
      c('meridian', 'price', { credits: 400 }),
    ]);
    expect(out.rejections.length).toBeGreaterThan(0);
    // No correction was asked for: a refused transfer cannot be reworded.
    expect(calls.some((x) => x.kind === 'resolution')).toBe(false);
    expect(campaign.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(before);
    expect(campaign.state.treaties.some((t) => t.type === 'non_aggression' && t.parties.includes('meridian') && t.parties.includes('vigil'))).toBe(false);
    expect(campaign.transcripts.vigil!.at(-1)!.at(-1)).toMatchObject({ speaker: 'record', text: expect.stringMatching(/Nothing agreed above took effect/) });
  });

  it('fails whole when a correction drops a term', async () => {
    queue = {
      extraction: [
        {
          narrative: 'A pact, and a marriage nobody can make.',
          accepted: ['meridian:price'],
          ops: [
            { op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'vigil'], terms: {} },
            { op: 'form_treaty', treatyType: 'marriage', parties: ['meridian', 'vigil'], terms: { spouses: ['nobody', 'noone'] } },
          ],
        },
      ],
      appraisal: [clean, clean],
      // The correction drops the marriage and keeps the pact.
      resolution: [{ narrative: 'The pact alone.', ops: [{ op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'vigil'], terms: {} }] }],
    };
    const campaign = Campaign.start('meridian', 'record-dropped');
    const before = campaign.state.factions.find((f) => f.id === 'meridian')!.credits;
    const out = await closeChannel(campaign, 'vigil', said, [c('meridian', 'price', { credits: 100 })]);
    expect(out.notes.join(' ')).toMatch(/may fix a term, not drop one/);
    expect(campaign.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(before);
  });
});

describe('a treaty ended across the table (bughunt 2026-10-28)', () => {
  const marque = () => {
    const s = createSeedState('vigil');
    const out = applyOps(
      s,
      [
        {
          op: 'form_treaty',
          parties: ['ojjul', 'drajk'],
          treatyType: 'contract',
          terms: { incomePerTurn: { ojjul: -10, drajk: 10 }, commission: { raider: 'drajk', against: ['vigil'], share: 25 } },
          durationTurns: 10,
          summary: 'Ojjul Nar Combine commissions Drajk Confederacy to raid Iron Vigil Remnant',
        },
      ],
      'engine',
    );
    const id = out.state.treaties.find((t) => t.type === 'contract' && t.parties.includes('drajk'))!.id;
    return { s: out.state, id };
  };

  it('is broken by the power that conceded it, at the price of a breach', () => {
    const { s, id } = marque();
    const built = transfersFromRecord(s, [c('ojjul', 'end_letter_of_marque', { ends: [id] }), c('vigil', 'price', { credits: 150 })], 'vigil', 'ojjul');
    expect(built.ops).toContainEqual({ op: 'break_treaty', treatyId: id, factionId: 'ojjul', reason: 'ojjul gives end_letter_of_marque.' });
    const before = s.factions.find((f) => f.id === 'drajk')!.disposition.ojjul ?? 0;
    const out = applyOps(s, built.ops, 'extraction', 'vigil');
    expect(out.rejections).toEqual([]);
    expect(out.state.treaties.find((t) => t.id === id)!.status).toBe('broken');
    expect(out.state.factions.find((f) => f.id === 'drajk')!.disposition.ojjul ?? 0).toBeLessThan(before);
  });

  it('builds nothing for a treaty the conceder is not bound by', () => {
    const { s, id } = marque();
    const built = transfersFromRecord(s, [c('meridian', 'end_it', { ends: [id] })], 'vigil', 'meridian');
    expect(built.ops).toEqual([]);
    expect(built.notes[0]).toMatch(/No treaty/);
  });

  it('cannot be broken on another power’s behalf by a declaration', () => {
    const { s, id } = marque();
    const out = applyOps(s, [{ op: 'break_treaty', treatyId: id, factionId: 'ojjul' }], 'model', 'vigil');
    expect(out.rejections[0]?.code).toBe('illegal_value');
  });
});

describe('a line code reads off the acts (bughunt 2026-10-28)', () => {
  it('does not refuse the letter of marque the line itself allows', async () => {
    const s = createSeedState('drajk');
    const line = s.factions.find((f) => f.id === 'drajk')!.lineActs!.find((t) => t.forbids.includes('alliance_signed'))!.text;
    queue = {
      extraction: [
        {
          narrative: 'The Combine commissions the Pack against the Vigil.',
          accepted: ['ojjul:letter_of_marque'],
          ops: [
            {
              op: 'form_treaty',
              parties: ['ojjul', 'drajk'],
              treatyType: 'contract',
              terms: { incomePerTurn: { ojjul: -15, drajk: 15 }, commission: { raider: 'drajk', against: ['vigil'], share: 50 } },
              durationTurns: 10,
              summary: 'a letter of marque against the Vigil',
            },
          ],
        },
      ],
      appraisal: [
        { ...clean, breach: { kind: 'red_line', principles: [line], how: 'it binds', by: 'the captains', reason: 'An alliance by another name.' } },
        clean,
      ],
      breach_relevance: [{ relevant: true, why: '' }],
    };
    const campaign = Campaign.start('drajk', 'marque-allowed');
    const out = await closeChannel(campaign, 'ojjul', said, [c('ojjul', 'letter_of_marque', { perTurn: 15 })]);
    expect(out.refusal ?? null).toBeNull();
    expect(out.rejections).toEqual([]);
    expect(campaign.state.treaties.some((t) => t.type === 'contract' && t.terms.commission?.raider === 'drajk')).toBe(true);
  });
});

describe('a debt paid down across the table (bughunt 2026-10-28)', () => {
  it('is paid once, though extraction settles it and the record pays it', async () => {
    const s = createSeedState('drajk');
    const debt = s.debts.find((d) => d.debtorFactionId === 'drajk')!;
    queue = {
      extraction: [
        {
          narrative: 'Drajk pays down 100 of its debt.',
          accepted: ['drajk:debt_paydown', 'ojjul:goodwill'],
          ops: [{ op: 'settle_debt', debtId: debt.id, amount: 100, reason: 'paid down' }],
        },
      ],
      appraisal: [clean, clean],
    };
    const campaign = Campaign.start('drajk', 'debt-once');
    const before = campaign.state.factions.find((f) => f.id === 'drajk')!.credits;
    const owed = campaign.state.debts.find((d) => d.id === debt.id)!.balance;
    const out = await closeChannel(campaign, 'ojjul', said, [c('drajk', 'debt_paydown', { credits: 100 }), c('ojjul', 'goodwill')]);
    expect(out.rejections).toEqual([]);
    expect(before - campaign.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(Math.min(100, owed));
    expect(campaign.state.debts.find((d) => d.id === debt.id)!.balance).toBe(Math.max(0, owed - 100));
  });
});
