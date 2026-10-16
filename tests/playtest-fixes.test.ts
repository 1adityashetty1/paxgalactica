import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { heldAs, listsOf, notableById, seatedAt } from '../src/domain/seats.js';
import { ObligationSchema } from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/** The four reducer bugs reproduced from the 2026-10-15 playtest. Journal version 22. */
const named = (s: WorldState, n: string) => s.systems.find((x) => x.name === n)!;
function wed() {
  const s = createSeedState('meridian');
  const seated = seatedAt(s, named(s, 'Brannix').id)[0]!;
  const ward = listsOf(s, 'vigil')[0]!;
  const r = applyOps(
    s,
    [{ op: 'form_treaty', treatyType: 'marriage', parties: ['meridian', 'vigil'], terms: { spouses: [seated.name, ward.name] }, summary: 'm' } as OpInput],
    'extraction',
    'meridian',
  );
  const treaty = r.state.treaties.find((t) => t.type === 'marriage')!;
  return { s: r.state, ward, asset: heldAs(r.state, ward.id)!, treaty };
}

describe('a live marriage keeps its ward (A1, A2)', () => {
  it('cannot be sold, declared or agreed, and the match stands with the ward where it was', () => {
    const { s, ward, asset } = wed();
    for (const source of ['model', 'extraction'] as const) {
      const r = applyOps(s, [{ op: 'transfer_asset', assetId: asset.id, toFactionId: 'drajk' } as OpInput], source, 'meridian');
      expect(r.rejections[0]?.code).toBe('illegal_value');
      expect(heldAs(r.state, ward.id)?.heldBy).toBe('meridian');
    }
    // Before version 22 it could.
    const old = applyOps(s, [{ op: 'transfer_asset', assetId: asset.id, toFactionId: 'drajk' } as OpInput], 'model', 'meridian', false, { wardsStay: false });
    expect(old.rejections).toEqual([]);
  });

  it('is not lost by handing them back and breaking the match in one accord', () => {
    // An accord commits atomically, so the refused sale takes the break with it.
    // A receiver breaking the match on its own still loses the ward, by design.
    const { s, ward, asset, treaty } = wed();
    const r = applyOps(
      s,
      [
        { op: 'transfer_asset', assetId: asset.id, toFactionId: 'vigil' } as OpInput,
        { op: 'break_treaty', treatyId: treaty.id, byFactionId: 'meridian', reason: '' } as OpInput,
      ],
      'extraction',
      'meridian',
      true,
    );
    expect(r.rejections[0]?.code).toBe('illegal_value');
    expect(notableById(r.state, ward.id)).toBeDefined();
    expect(r.state.treaties.find((t) => t.id === treaty.id)!.status).toBe('active');
  });

  it('cannot be written into a treaty or lent either', () => {
    const { s, ward, asset } = wed();
    const ransom = applyOps(
      s,
      [{ op: 'form_treaty', treatyType: 'contract', parties: ['meridian', 'drajk'], terms: { assets: [{ assetId: asset.id, toFactionId: 'drajk' }] }, summary: 'sold' } as OpInput],
      'extraction',
      'meridian',
    );
    expect(heldAs(ransom.state, ward.id)?.heldBy).toBe('meridian');
    const lent = applyOps(
      s,
      [{ op: 'establish_loan', lenderFactionId: 'meridian', borrowerFactionId: 'drajk', lent: { kind: 'asset', assetId: asset.id }, termTurns: 3, rentPerTurn: 0, text: 'a loan' } as OpInput],
      'extraction',
      'meridian',
    );
    expect(lent.rejections[0]?.code).toBe('illegal_value');
  });
});

describe('a favour called to back an ultimatum obeys the hook (A8)', () => {
  const board = () => {
    const s = createSeedState('meridian');
    const hook = (id: string, holder: string, strength: 'weak' | 'strong') =>
      ObligationSchema.parse({ id, debtorFactionId: 'drajk', holderFactionId: holder, strength, origin: 'accord', text: 'owed', establishedTurn: 0 });
    s.obligations.push(hook('o-hook', 'vigil', 'strong'), hook('o-weak', 'meridian', 'weak'));
    return applyOps(
      s,
      [{ op: 'issue_ultimatum', targetFactionId: 'vigil', demand: 'tribute', perTurn: 10, deadlineTurns: 3, text: 'pay' } as OpInput],
      'model',
      'meridian',
    ).state;
  };
  const callIn = (s: WorldState, legacy = {}) =>
    applyOps(s, [{ op: 'call_obligation', obligationId: 'o-weak', call: 'support', demandId: s.demands.at(-1)!.id } as OpInput], 'model', 'meridian', false, legacy);

  it('cannot set a hooked debtor against the power holding the hook', () => {
    const s = board();
    const r = callIn(s);
    expect(r.rejections[0]?.code).toBe('illegal_value');
    expect(r.state.demands.at(-1)!.backers).toEqual([]);
    expect(callIn(s, { hooksHoldOnCall: false }).rejections).toEqual([]);
  });

  it('works when nothing binds the debtor to the target', () => {
    const s = board();
    s.obligations = s.obligations.filter((o) => o.id !== 'o-hook');
    const r = callIn(s);
    expect(r.rejections).toEqual([]);
    expect(r.state.demands.at(-1)!.backers).toEqual([{ factionId: 'drajk', side: 'from' }]);
  });
});

describe('a dissent line is its own power’s business (B7)', () => {
  it('is logged only to the power whose dissent moved', () => {
    const s = createSeedState('meridian');
    const op = { op: 'adjust_dissent', factionId: 'meridian', delta: 8, reason: 'will not close a lane' } as OpInput;
    const line = (st: WorldState) => st.eventLog.findLast((e) => e.text.includes('dissent'))!;
    expect(line(applyOps(s, [op], 'model', 'meridian').state).visibleTo).toEqual(['meridian']);
    expect(line(applyOps(s, [op], 'model', 'meridian', false, { privateDissent: false }).state).visibleTo).toBeNull();
  });
});

describe('narrated regard is capped over the whole batch, and a treaty pays its own (B11)', () => {
  const reg = (s: WorldState, a: string, b: string) => s.factions.find((f) => f.id === a)!.disposition[b] ?? 0;
  const treaty = { op: 'form_treaty', treatyType: 'trade_accord', parties: ['meridian', 'freeworlds'], terms: {}, summary: 'x' } as OpInput;
  const warm = (d: number) => ({ op: 'adjust_disposition', factionId: 'freeworlds', towardFactionId: 'meridian', delta: d, reason: 'a good talk' }) as OpInput;

  it('adds no narrated warmth on top of a treaty between the same two', () => {
    const s = createSeedState('meridian');
    const only = reg(applyOps(s, [treaty], 'extraction', 'meridian', true).state, 'freeworlds', 'meridian');
    expect(reg(applyOps(s, [treaty, warm(25)], 'extraction', 'meridian', true).state, 'freeworlds', 'meridian')).toBe(only);
    expect(reg(applyOps(s, [treaty, warm(25)], 'extraction', 'meridian', true, { narrationCapPerBatch: false }).state, 'freeworlds', 'meridian')).toBe(only + 25);
    // A cooling still lands.
    expect(reg(applyOps(s, [treaty, warm(-10)], 'extraction', 'meridian', true).state, 'freeworlds', 'meridian')).toBe(only - 10);
  });

  it('cannot be stacked past the cap by saying it twice', () => {
    const s = createSeedState('meridian');
    const base = reg(s, 'freeworlds', 'meridian');
    expect(reg(applyOps(s, [warm(25), warm(25)], 'extraction', 'meridian', true).state, 'freeworlds', 'meridian')).toBe(base + 25);
    expect(reg(applyOps(s, [warm(15), warm(15)], 'model', 'meridian', true).state, 'freeworlds', 'meridian')).toBe(base + 25);
  });
});

describe('a toll lifted for a term comes back (B12)', () => {
  const lift = (s: WorldState, extra: Record<string, unknown>) =>
    applyOps(s, [{ op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil', 'freeworlds', 'drajk'], ...extra } as OpInput], 'extraction', 'ojjul').state;
  const charged = (s: WorldState) => s.factions.find((f) => f.id === 'ojjul')!.tollTargets;

  it('after the turns named', () => {
    let s = lift(createSeedState('meridian'), { forTurns: 2 });
    expect(charged(s)).not.toContain('meridian');
    s = tickTurn(s, { randomEvents: false }).state;
    expect(charged(s)).not.toContain('meridian');
    s = tickTurn(s, { randomEvents: false }).state;
    expect(charged(s)).toContain('meridian');
    expect(s.factions.find((f) => f.id === 'ojjul')!.tollLifts).toBeUndefined();
  });

  it('when the treaty it was lifted for ends', () => {
    let s = createSeedState('meridian');
    s = applyOps(
      s,
      [
        { op: 'form_treaty', treatyType: 'trade_accord', parties: ['ojjul', 'meridian'], terms: {}, summary: 'x', durationTurns: 2 } as OpInput,
        { op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil', 'freeworlds', 'drajk'], whileTreaty: 'trade_accord' } as OpInput,
      ],
      'extraction',
      'ojjul',
      true,
    ).state;
    expect(charged(s)).not.toContain('meridian');
    s = tickTurn(s, { randomEvents: false }).state;
    expect(charged(s)).not.toContain('meridian');
    for (let i = 0; i < 3; i++) s = tickTurn(s, { randomEvents: false }).state;
    expect(charged(s)).toContain('meridian');
  });

  it('and a lift with no term is for good, and supersedes a pending one', () => {
    let s = lift(createSeedState('meridian'), {});
    for (let i = 0; i < 4; i++) s = tickTurn(s, { randomEvents: false }).state;
    expect(charged(s)).not.toContain('meridian');
    s = lift(lift(createSeedState('meridian'), { forTurns: 1 }), {});
    expect(s.factions.find((f) => f.id === 'ojjul')!.tollLifts).toBeUndefined();
  });
});

describe('a raid on a power it cannot land on costs nothing and says nothing (B15)', () => {
  it('leaves a trade-accord partner’s regard and the log alone', () => {
    let s = createSeedState('drajk');
    const target = s.systems.find(
      (x) => x.controllerFactionId === 'ojjul' && x.hyperlaneEdges.some((e) => s.systems.find((y) => y.id === e)?.controllerFactionId === 'drajk'),
    )!;
    const from = s.systems.find((y) => target.hyperlaneEdges.includes(y.id) && y.controllerFactionId === 'drajk')!;
    s = applyOps(s, [{ op: 'form_treaty', treatyType: 'trade_accord', parties: ['drajk', 'ojjul'], terms: {}, summary: 'x' } as OpInput], 'extraction', 'drajk').state;
    s = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding', originId: from.id, targetId: target.id, durationTurns: 3, label: 'raid', durationRationale: 'x' } as OpInput],
      'model',
      'drajk',
    ).state;
    const regard = (st: WorldState) => st.factions.find((f) => f.id === 'ojjul')!.disposition['drajk'] ?? 0;
    const run = (legacy = {}) => tickTurn(tickTurn(s, { randomEvents: false, ...legacy }).state, { randomEvents: false, ...legacy }).state;
    const now = run();
    expect(now.eventLog.some((e) => /raid shipping/.test(e.text))).toBe(false);
    const old = run({ raidsLandOnly: false });
    expect(old.eventLog.some((e) => /raid shipping/.test(e.text))).toBe(true);
    expect(regard(now)).toBeGreaterThan(regard(old));
  });
});
