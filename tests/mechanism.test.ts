import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { EstablishesSchema, type OpInput } from '../src/domain/ops.js';
import { commitmentsAsRuled } from '../src/domain/refusals.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * A declared commitment carries the mechanism the arbiter named before the
 * roll (`docs/design-2026-10-17-intent-ops.md` §5). Five declared commitments
 * in the saved campaigns paid their own power an income nobody had ruled.
 */

const seed = (): WorldState => createSeedState('ojjul');
const charter = (extra: Record<string, unknown> = {}): OpInput =>
  ({
    op: 'establish_commitment', kind: 'free_port', factionIds: ['ojjul'],
    text: 'Vosk Marker is open to every hull, tariff-free.', ...extra,
  }) as OpInput;
const declare = (s: WorldState, ops: OpInput[]) => applyOps(s, ops, 'model', 'ojjul', true, {}, 'declared');

describe('the ruling names the mechanism', () => {
  it('is a record unless the arbiter says otherwise', () => {
    expect(EstablishesSchema.parse({ kind: 'free_port', factionIds: ['ojjul'], text: 'A free port.' }).mechanism).toBe('record');
  });

  it('keeps only the commitment it ruled, stamped with its mechanism', () => {
    const r = commitmentsAsRuled([charter(), charter({ kind: 'shalka_scrip' })], { kind: 'free_port', mechanism: 'income' });
    expect(r.ops).toEqual([{ ...charter(), mechanism: 'income' }]);
    expect(r.dropped).toEqual(['shalka_scrip']);
  });

  it('keeps no commitment when nothing was ruled', () => {
    expect(commitmentsAsRuled([charter()], undefined).ops).toEqual([]);
  });
});

describe('the reducer holds a commitment to it', () => {
  it('leaves out an income the ruling did not name', () => {
    const r = declare(seed(), [charter({ incomePerTurn: 20, mechanism: 'record' })]);
    expect(r.rejections).toEqual([]);
    expect(r.state.commitments.find((c) => c.kind === 'free_port')!.incomePerTurn).toBe(0);
    expect(r.notes.join(' ')).toMatch(/without an income of 20/);
  });

  it('keeps an income the ruling named', () => {
    const r = declare(seed(), [charter({ incomePerTurn: 20, mechanism: 'income' })]);
    expect(r.state.commitments.find((c) => c.kind === 'free_port')!.incomePerTurn).toBe(20);
  });

  it('refuses an income the ruling named and the commitment left out', () => {
    expect(declare(seed(), [charter({ mechanism: 'income' })]).rejections.map((x) => x.code)).toEqual(['illegal_value']);
  });

  it('leaves an accord’s commitment, which carries no ruling, to its consent', () => {
    const r = applyOps(seed(), [charter({ incomePerTurn: 20 })], 'extraction', 'ojjul', true, {}, 'accord');
    expect(r.state.commitments.find((c) => c.kind === 'free_port')!.incomePerTurn).toBe(20);
  });
});

describe('a declared charter pays from a world (code-knows §7)', () => {
  const ledger = async (s: WorldState) => (await import('../src/domain/state.js')).ledgerFor(s, 'ojjul').commitmentFlow;
  const shalka = (s: WorldState) => s.systems.find((x) => x.id === 'ilv-2')!;

  it('is chartered on the world named, and pays a quarter of it at most', async () => {
    const { systemIncome } = await import('../src/domain/state.js');
    const r = declare(seed(), [charter({ incomePerTurn: 25, mechanism: 'income', systemId: 'ilv-2' })]);
    expect(r.rejections).toEqual([]);
    const c = r.state.commitments.find((x) => x.kind === 'free_port')!;
    expect(c.atSystemId).toBe('ilv-2');
    const take = systemIncome(r.state, shalka(r.state)).shares.ojjul ?? 0;
    const quarter = Math.floor(take / 4);
    expect(await ledger(r.state)).toBe(Math.min(25, quarter));
    if (quarter < 25) expect(r.notes.join(' ')).toMatch(/at most a quarter/);
  });

  it('is chartered on the richest world when none is named, and says so', () => {
    const r = declare(seed(), [charter({ incomePerTurn: 10, mechanism: 'income' })]);
    expect(r.state.commitments.find((x) => x.kind === 'free_port')!.atSystemId).toBeDefined();
    expect(r.notes.join(' ')).toMatch(/chartered on .*richest world/);
  });

  it('refuses a world its power does not hold', () => {
    const r = declare(seed(), [charter({ incomePerTurn: 10, mechanism: 'income', systemId: 'tor-2' })]);
    expect(r.rejections.map((x) => x.code)).toEqual(['no_presence']);
  });

  it('pays nothing once the world is lost', async () => {
    const r = declare(seed(), [charter({ incomePerTurn: 10, mechanism: 'income', systemId: 'ilv-2' })]);
    expect(await ledger(r.state)).toBeGreaterThan(0);
    shalka(r.state).controllerFactionId = 'vigil';
    expect(await ledger(r.state)).toBe(0);
  });

  it('charters nothing for an accord, or for a journal before version 28', () => {
    const accord = applyOps(seed(), [charter({ incomePerTurn: 20 })], 'extraction', 'ojjul', true, {}, 'accord');
    expect(accord.state.commitments.find((x) => x.kind === 'free_port')!.atSystemId).toBeUndefined();
    const old = applyOps(seed(), [charter({ incomePerTurn: 20, mechanism: 'income' })], 'model', 'ojjul', true, { charterOnWorld: false }, 'declared');
    expect(old.state.commitments.find((x) => x.kind === 'free_port')!.atSystemId).toBeUndefined();
  });
});
