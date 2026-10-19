import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { linesCrossed } from '../src/domain/acts.js';
import { honourLines } from '../src/domain/initiative.js';
import { ConcessionSchema } from '../src/domain/diplomacy.js';

/**
 * A line reads the acts it forbids (`docs/design-2026-10-18-code-knows.md` §1,
 * journal version 27): the reducer reports what a batch does, the seed tags
 * each line with what it forbids, and `linesCrossed` matches the two.
 */

const seed = () => createSeedState('meridian');
const declare = (s: ReturnType<typeof seed>, ops: unknown[]) => applyOps(s, ops, 'model', 'meridian', true, {}, 'declared');

describe('the reducer reports the acts a batch commits', () => {
  it('a blockade, a raid and an invasion', () => {
    const r = declare(seed(), [
      { op: 'blockade', factionId: 'meridian', systemId: 'tor-1' },
      { op: 'move', factionId: 'meridian', originId: 'tor-1', targetId: 'tor-2', force: { battleship: 4, lifter: 2 } },
    ]);
    expect(r.rejections).toEqual([]);
    expect(r.acts.map((a) => a.kind)).toEqual(['blockade_ordered', 'invasion_launched']);
    expect(r.acts[1]).toMatchObject({ actor: 'meridian', with: ['vigil'], opIndex: 1 });
  });

  it('nothing for a batch held back', () => {
    const r = declare(seed(), [{ op: 'blockade', factionId: 'meridian', systemId: 'tor-1' }, { op: 'nonsense' }]);
    expect(r.acts).toEqual([]);
  });
});

describe('the seed tags each line with what it forbids', () => {
  it('names only lines the sheet carries', () => {
    for (const f of seed().factions) {
      const lines = [...f.redLines, ...f.compulsions.map((c) => c.text)];
      for (const tag of f.lineActs ?? []) expect(lines, `${f.id}: ${tag.text}`).toContain(tag.text);
    }
  });

  it('keeps the old wording, and no tags, for a journal before version 27', () => {
    const old = createSeedState('meridian', { lineActs: false }).factions.find((f) => f.id === 'drajk')!;
    expect(old.lineActs).toBeUndefined();
    expect(old.redLines.join(' ')).toMatch(/written treaty/);
    expect(seed().factions.find((f) => f.id === 'drajk')!.redLines.join(' ')).toMatch(/bound in public/);
  });
});

describe('linesCrossed', () => {
  it('a red line and a compulsion, each once', () => {
    const s = seed();
    const r = declare(s, [{ op: 'blockade', factionId: 'meridian', systemId: 'tor-1' }]);
    const hits = linesCrossed(s.factions, r.acts, ['meridian']);
    expect(hits.map((h) => h.kind)).toEqual(['red_line']);
    expect(hits[0]!.principle).toMatch(/will not close a lane/);
  });

  it('holds a `with` line only toward the powers it names', () => {
    const s = seed();
    const act = (other: string) => ({ kind: 'treaty_signed' as const, actor: 'vigil', with: [other], opIndex: 0 });
    expect(linesCrossed(s.factions, [act('drajk')], ['vigil'])).toHaveLength(1);
    expect(linesCrossed(s.factions, [act('meridian')], ['vigil'])).toHaveLength(0);
  });

  it('holds an untagged sheet to nothing', () => {
    const old = createSeedState('meridian', { lineActs: false });
    const act = { kind: 'blockade_ordered' as const, actor: 'meridian', with: [], opIndex: 0 };
    expect(linesCrossed(old.factions, [act], ['meridian'])).toEqual([]);
  });
});

describe('a bot holds back what its own line forbids', () => {
  it('drops the op that crosses it', () => {
    const s = seed();
    const ops = [
      { op: 'blockade', factionId: 'meridian', systemId: 'tor-1' },
      { op: 'log_narrative', text: 'kept' },
    ];
    const out = honourLines(s, 'meridian', ops, (batch) => applyOps(s, batch, 'model', 'meridian', false, {}, 'bot').acts);
    expect(out.ops).toEqual([{ op: 'log_narrative', text: 'kept' }]);
    expect(out.withheld.join(' ')).toMatch(/close a lane/);
  });
});

describe('what an accord does as a whole', async () => {
  const { accordActs } = await import('../src/engine/turn.js');
  it('payment for a peace, and a gift for nothing', () => {
    const s = seed();
    const peace = accordActs(
      s,
      [
        { op: 'pay', factionId: 'meridian', to: 'vigil', amount: 300 },
        { op: 'form_treaty', treatyType: 'non_aggression', parties: ['meridian', 'vigil'], terms: {} },
      ],
      [],
      'meridian',
      'vigil',
    );
    expect(peace.map((a) => [a.kind, a.actor])).toContainEqual(['paid_for_peace', 'vigil']);
    const gift = accordActs(
      s,
      [{ op: 'set_toll_policy', factionId: 'ojjul', targets: ['vigil'] }],
      [ConcessionSchema.parse({ by: 'ojjul', kind: 'toll_lift', text: 'The toll comes off.' })],
      'meridian',
      'ojjul',
    );
    expect(gift.map((a) => [a.kind, a.actor])).toEqual([['given_for_nothing', 'ojjul']]);
  });
});
