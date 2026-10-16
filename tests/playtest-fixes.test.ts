import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
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
