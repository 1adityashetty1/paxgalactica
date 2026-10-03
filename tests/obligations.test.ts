import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, type LegacyRules } from '../src/domain/reducer.js';
import {
  OBLIGATION_REST_TURNS,
  OBLIGATION_TERM_TURNS,
  PACT_BREAKING_REPUTATION_COST,
  truceBetween,
} from '../src/domain/diplomacy.js';
import { proposeFor } from '../src/domain/initiative.js';
import { warsFor, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Obligations (journal version 13): a favour owed, which the holder calls in
 * for a pact or for backing in an ultimatum. Made in an accord, by forgiving a
 * debt, or by blackmail.
 */

const owe = (s: WorldState, debtor: string, holder: string, legacy: LegacyRules = {}) =>
  applyOps(
    s,
    [{ op: 'establish_obligation', debtorFactionId: debtor, holderFactionId: holder, text: 'we owe you one' } as OpInput],
    'extraction',
    holder,
    true,
    legacy,
  );
const call = (s: WorldState, actor: string, extra: Record<string, unknown>) =>
  applyOps(s, [{ op: 'call_obligation', obligationId: s.obligations.at(-1)!.id, ...extra } as OpInput], 'model', actor);
const regard = (s: WorldState, from: string, toward: string) =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;

describe('a favour owed', () => {
  it('is agreed in a channel, never declared', () => {
    const declared = applyOps(
      createSeedState('meridian'),
      [{ op: 'establish_obligation', debtorFactionId: 'ojjul', holderFactionId: 'meridian', text: 'x' } as OpInput],
      'model',
      'meridian',
    );
    expect(declared.rejections[0]?.code).toBe('needs_consent');
    const agreed = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    expect(agreed.rejections).toEqual([]);
    expect(agreed.state.obligations.at(-1)).toMatchObject({ debtorFactionId: 'ojjul', holderFactionId: 'meridian', strength: 'weak', origin: 'accord', status: 'open' });
  });

  it('is left by a forgiven debt — the Combine\'s instrument, run backwards', () => {
    const s = createSeedState('ojjul');
    const debt = s.debts.find((d) => d.creditorFactionId === 'ojjul')!;
    const out = applyOps(s, [{ op: 'forgive_debt', debtId: debt.id } as OpInput], 'model', 'ojjul');
    expect(out.rejections).toEqual([]);
    expect(out.state.obligations.at(-1)).toMatchObject({
      debtorFactionId: debt.debtorFactionId,
      holderFactionId: 'ojjul',
      origin: 'forgiven_debt',
    });
  });

  it('is not left by a forgiven debt in a journal from before obligations', () => {
    const s = createSeedState('ojjul');
    const debt = s.debts.find((d) => d.creditorFactionId === 'ojjul')!;
    const out = applyOps(s, [{ op: 'forgive_debt', debtId: debt.id } as OpInput], 'model', 'ojjul', false, { obligations: false });
    expect(out.state.obligations).toEqual([]);
  });
});

describe('calling it in', () => {
  it('makes the debtor sign the pact named, for the term, and spends a weak favour', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian').state;
    const out = call(s, 'meridian', { call: 'sign', treatyType: 'non_aggression' });
    expect(out.rejections).toEqual([]);
    const t = out.state.treaties.at(-1)!;
    expect(t).toMatchObject({ type: 'non_aggression', expiresTurn: s.turn + OBLIGATION_TERM_TURNS });
    expect(t.parties.sort()).toEqual(['meridian', 'ojjul']);
    expect(out.state.obligations.at(-1)!.status).toBe('called');
  });

  it('forces a peace on a power at war, which leaves a truce', () => {
    const s = owe(createSeedState('meridian'), 'drajk', 'vigil').state;
    expect(warsFor(s, 'vigil')).toContain('drajk');
    const out = call(s, 'vigil', { call: 'sign', treatyType: 'ceasefire' });
    expect(out.rejections).toEqual([]);
    expect(truceBetween(out.state.truces, out.state.turn, 'vigil', 'drajk')).toBeDefined();
  });

  it('is called by the holder and nobody else', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian').state;
    expect(call(s, 'ojjul', { call: 'sign', treatyType: 'trade_accord' }).rejections[0]?.message).toMatch(/only it can call/);
  });

  it('a strong hook rests and stays rather than being spent', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian').state;
    s.obligations.at(-1)!.strength = 'strong';
    const once = call(s, 'meridian', { call: 'sign', treatyType: 'trade_accord' }).state;
    const hook = once.obligations.at(-1)!;
    expect(hook.status).toBe('open');
    expect(hook.restsUntil).toBe(s.turn + OBLIGATION_REST_TURNS);
    expect(call(once, 'meridian', { call: 'sign', treatyType: 'non_aggression' }).rejections[0]?.message).toMatch(/rests/);
  });

  it('buys backing in an ultimatum of the holder\'s own', () => {
    let s = owe(createSeedState('meridian'), 'ojjul', 'meridian').state;
    s = applyOps(
      s,
      [{ op: 'issue_ultimatum', targetFactionId: 'freeworlds', demand: 'trade_accord', deadlineTurns: 3, text: 'open the Drift' } as OpInput],
      'model',
      'meridian',
    ).state;
    const out = call(s, 'meridian', { call: 'support', demandId: s.demands.at(-1)!.id });
    expect(out.rejections).toEqual([]);
    expect(out.state.demands.at(-1)!.backers).toEqual([{ factionId: 'ojjul', side: 'from' }]);
  });
});

describe('walking away from one', () => {
  it('costs what breaking a pact costs, in public', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian').state;
    const out = applyOps(s, [{ op: 'repudiate_obligation', obligationId: s.obligations.at(-1)!.id } as OpInput], 'model', 'ojjul');
    expect(out.rejections).toEqual([]);
    expect(out.state.obligations.at(-1)!.status).toBe('repudiated');
    expect(regard(out.state, 'meridian', 'ojjul')).toBe(Math.max(-100, regard(s, 'meridian', 'ojjul') - 25));
    expect(regard(out.state, 'vigil', 'ojjul')).toBe(Math.max(-100, regard(s, 'vigil', 'ojjul') - PACT_BREAKING_REPUTATION_COST));
  });
});

describe('the bots', () => {
  it('call in a favour owed by an enemy for a ceasefire', () => {
    const s = owe(createSeedState('meridian'), 'drajk', 'vigil').state;
    const ops = proposeFor(s, 'vigil')?.ops ?? [];
    expect(ops.find((o) => o.op === 'call_obligation')).toMatchObject({ call: 'sign', treatyType: 'ceasefire' });
  });
});
