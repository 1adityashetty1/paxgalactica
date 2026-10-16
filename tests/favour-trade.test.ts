import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { ConcessionSchema, FAVOUR_WORTH } from '../src/domain/diplomacy.js';
import { EXTRACTION_ALLOWED, ExtractionOpSchema, ModelOpSchema } from '../src/domain/ops.js';
import { concessionWorth } from '../src/domain/leverage.js';
import { groundInConcessions } from '../src/engine/turn.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * A favour held is consideration: let off as one side's price
 * (`release_obligation`), or sold to a third power (`assign_obligation`).
 * Calling one in stays on the declared path.
 */
const owe = (s: WorldState, debtor: string, holder: string): WorldState =>
  applyOps(
    s,
    [{ op: 'establish_obligation', debtorFactionId: debtor, holderFactionId: holder, text: 'we owe you one' } as OpInput],
    'extraction',
    holder,
  ).state;
const last = (s: WorldState) => s.obligations.at(-1)!;

describe('giving a favour up', () => {
  it('is reachable from an accord, and calling one in still is not', () => {
    expect(EXTRACTION_ALLOWED.has('release_obligation')).toBe(true);
    expect(EXTRACTION_ALLOWED.has('assign_obligation')).toBe(true);
    expect(EXTRACTION_ALLOWED.has('call_obligation')).toBe(false);
    const release = { op: 'release_obligation', obligationId: 'obl-1' };
    const assign = { op: 'assign_obligation', obligationId: 'obl-1', toHolderFactionId: 'vigil' };
    expect(ModelOpSchema.safeParse(release).success).toBe(true);
    expect(ModelOpSchema.safeParse(assign).success).toBe(false);
    expect(ExtractionOpSchema.safeParse(assign).success).toBe(true);
  });

  it('lets the debtor off when the holder releases it, declared or agreed, and moves no standing', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    const before = structuredClone(s.factions.map((f) => f.disposition));
    const declared = applyOps(s, [{ op: 'release_obligation', obligationId: last(s).id } as OpInput], 'model', 'meridian');
    expect(declared.rejections).toEqual([]);
    expect(last(declared.state).status).toBe('released');
    expect(declared.state.factions.map((f) => f.disposition)).toEqual(before);
    // Agreed in the debtor's own channel: the holder across the table let it off.
    const agreed = applyOps(s, [{ op: 'release_obligation', obligationId: last(s).id } as OpInput], 'extraction', 'ojjul');
    expect(agreed.rejections).toEqual([]);
    expect(last(agreed.state).status).toBe('released');
  });

  it('cannot be released by the debtor on its own say, nor by a third power', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    const id = last(s).id;
    expect(applyOps(s, [{ op: 'release_obligation', obligationId: id } as OpInput], 'model', 'ojjul').rejections[0]?.code).toBe('illegal_value');
    expect(applyOps(s, [{ op: 'release_obligation', obligationId: id } as OpInput], 'extraction', 'vigil').rejections[0]?.code).toBe('illegal_value');
    const spent = applyOps(s, [{ op: 'release_obligation', obligationId: id } as OpInput], 'model', 'meridian').state;
    expect(applyOps(spent, [{ op: 'release_obligation', obligationId: id } as OpInput], 'model', 'meridian').rejections[0]?.code).toBe('illegal_value');
  });

  it('sells a weak favour to the buyer in the room, and the buyer can call it in', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    const id = last(s).id;
    const sold = applyOps(s, [{ op: 'assign_obligation', obligationId: id, toHolderFactionId: 'freeworlds' } as OpInput], 'extraction', 'meridian');
    expect(sold.rejections).toEqual([]);
    expect(last(sold.state)).toMatchObject({ holderFactionId: 'freeworlds', debtorFactionId: 'ojjul', status: 'open' });
    const called = applyOps(sold.state, [{ op: 'call_obligation', obligationId: id, call: 'sign', treatyType: 'trade_accord' } as OpInput], 'model', 'freeworlds');
    expect(called.rejections).toEqual([]);
    expect(applyOps(sold.state, [{ op: 'call_obligation', obligationId: id, call: 'sign', treatyType: 'trade_accord' } as OpInput], 'model', 'meridian').rejections[0]?.code).toBe('illegal_value');
  });

  it('is never sold by declaration, to its debtor, or when it is a hook', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    const id = last(s).id;
    const assign = (to: string, src: 'model' | 'extraction' = 'extraction', actor = 'meridian') =>
      applyOps(s, [{ op: 'assign_obligation', obligationId: id, toHolderFactionId: to } as OpInput], src, actor).rejections[0]?.code;
    expect(assign('freeworlds', 'model')).toBe('needs_consent');
    expect(assign('ojjul')).toBe('illegal_value');
    expect(assign('meridian')).toBe('illegal_value');
    expect(assign('freeworlds', 'extraction', 'vigil')).toBe('illegal_value');
    last(s).strength = 'strong';
    last(s).origin = 'blackmail';
    expect(assign('freeworlds')).toBe('illegal_value');
  });

  it('is worth something given up, and twice that for a hook', () => {
    const s = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    const c = ConcessionSchema.parse({ by: 'meridian', kind: 'favour_forgiven', text: 'Forget what you owe us.', obligations: [last(s).id] });
    expect(concessionWorth(s, c)).toBe(FAVOUR_WORTH);
    last(s).strength = 'strong';
    expect(concessionWorth(s, c)).toBe(2 * FAVOUR_WORTH);
    // A favour named by somebody who does not hold it is worth nothing.
    expect(concessionWorth(s, { ...c, by: 'vigil' })).toBe(0);
  });

  it('moves out of the other party’s hands only if that party put it on the table', () => {
    const s = owe(createSeedState('meridian'), 'meridian', 'ojjul');
    const id = last(s).id;
    const ops = [{ op: 'release_obligation', obligationId: id }];
    const ungranted = groundInConcessions(s, ops, [], 'ojjul');
    expect(ungranted.ops).toHaveLength(0);
    expect(ungranted.dropped[0]).toContain('never put it on the table');
    const granted = groundInConcessions(
      s,
      ops,
      [ConcessionSchema.parse({ by: 'ojjul', kind: 'favour_forgiven', text: 'Consider it paid.', obligations: [id] })],
      'ojjul',
    );
    expect(granted.ops).toHaveLength(1);
    // The player giving up their own needs no record.
    const mine = owe(createSeedState('meridian'), 'ojjul', 'meridian');
    expect(groundInConcessions(mine, [{ op: 'release_obligation', obligationId: last(mine).id }], [], 'ojjul').ops).toHaveLength(1);
  });
});
