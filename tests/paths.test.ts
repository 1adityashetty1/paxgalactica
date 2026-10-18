import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { EXTRACTION_ALLOWED, OP_PATHS, type OpInput, type OpPath } from '../src/domain/ops.js';
import { honourTreaties } from '../src/domain/initiative.js';
import { Campaign } from '../src/engine/campaign.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * Who may write what (`docs/design-2026-10-17-intent-ops.md` §7). A declared
 * action, a reaction and a bot all arrive as `model`; the path says which, and
 * the reducer holds each to what its writer is bounded by.
 */

const seed = (): WorldState => createSeedState('ojjul');
const codes = (s: WorldState, ops: OpInput[], actor: string, path: OpPath) =>
  applyOps(s, ops, 'model', actor, true, {}, path).rejections.map((r) => r.code);

describe('the path table', () => {
  it('holds its accord column equal to EXTRACTION_ALLOWED', () => {
    const accord = Object.entries(OP_PATHS).filter(([, paths]) => paths.includes('accord')).map(([op]) => op).sort();
    expect(accord).toEqual([...EXTRACTION_ALLOWED].sort());
  });

  it('keeps groundwork, prizes and doctrine on the player’s declared path', () => {
    for (const op of ['lay_groundwork', 'create_asset', 'set_doctrine'] as const) {
      expect(OP_PATHS[op]).toContain('declared');
      expect(OP_PATHS[op]).not.toContain('reaction');
      expect(OP_PATHS[op]).not.toContain('bot');
    }
  });

  it('gives dissent to the engine alone', () => {
    expect(OP_PATHS.adjust_dissent).toEqual(['engine']);
  });
});

describe('a reaction is held to what it is bounded by', () => {
  it('cannot change its doctrine, mint a prize or charge dissent', () => {
    const s = seed();
    expect(codes(s, [{ op: 'set_doctrine', factionId: 'vigil', doctrine: 'Peace in our time.' }], 'vigil', 'reaction')).toEqual(['wrong_path']);
    expect(
      codes(s, [{ op: 'create_asset', kind: 'salvage', heldBy: 'vigil', quantity: 3, unit: 'tons', text: 'Wreckage off Kalzir.', valuePerUnit: { ojjul: 10 } }], 'vigil', 'reaction'),
    ).toEqual(['wrong_path']);
    expect(codes(s, [{ op: 'adjust_dissent', factionId: 'vigil', delta: 5 }], 'vigil', 'reaction')).toEqual(['wrong_path']);
  });

  it('records its own view of a power by a listed reason, never by a figure', () => {
    const s = seed();
    expect(codes(s, [{ op: 'regard', factionId: 'vigil', toward: 'ojjul', because: 'insult' }], 'vigil', 'reaction')).toEqual([]);
    expect(codes(s, [{ op: 'regard', factionId: 'ojjul', toward: 'vigil', because: 'insult' }], 'vigil', 'reaction')).toEqual(['illegal_value']);
    expect(codes(s, [{ op: 'adjust_disposition', factionId: 'vigil', towardFactionId: 'ojjul', delta: -5 }], 'vigil', 'reaction')).toEqual(['wrong_path']);
  });
});

describe('a declaration', () => {
  it('moves how another power sees the actor by a sway the roll sized, never by a figure', () => {
    const s = seed();
    expect(codes(s, [{ op: 'sway', factionId: 'ojjul', whom: 'vigil', amount: 6 }], 'ojjul', 'declared')).toEqual([]);
    expect(codes(s, [{ op: 'sway', factionId: 'ojjul', whom: 'vigil' }], 'ojjul', 'declared')).toEqual(['illegal_value']);
    expect(codes(s, [{ op: 'adjust_disposition', factionId: 'vigil', towardFactionId: 'ojjul', delta: 5 }], 'ojjul', 'declared')).toEqual(['wrong_path']);
  });

  it('cannot write dissent; the engine’s charge on the player can', () => {
    const s = seed();
    expect(codes(s, [{ op: 'adjust_dissent', factionId: 'ojjul', delta: 8 }], 'ojjul', 'declared')).toEqual(['wrong_path']);
    expect(codes(s, [{ op: 'adjust_dissent', factionId: 'ojjul', delta: 8 }], 'ojjul', 'engine')).toEqual([]);
  });
});

describe('a batch with no path', () => {
  it('is checked against nothing, as an old journal or a test board is', () => {
    const s = seed();
    expect(applyOps(s, [{ op: 'set_doctrine', factionId: 'vigil', doctrine: 'Peace in our time.' }], 'model', 'vigil', true).rejections).toEqual([]);
  });
});

describe('the path is journaled', () => {
  it('replays a staged batch under the path it was staged with', () => {
    const c = Campaign.start('ojjul', 'paths');
    const ops: OpInput[] = [{ op: 'adjust_disposition', factionId: 'ojjul', towardFactionId: 'vigil', delta: 5 }];
    expect(c.stage(ops, 'declared, own view', '', 'model', 'ojjul', { path: 'declared' }).rejections.map((r) => r.code)).toEqual(['wrong_path']);
    c.commitTurn();
    const entry = c.toSaveFile().journal.entries.at(-1) as { path?: string };
    expect(entry.path).toBe('declared');
    expect(c.verifyReplay().ok).toBe(true);
  });
});

describe('a reaction honours its own paper', () => {
  const bound = (): WorldState =>
    applyOps(seed(), [
      { op: 'form_treaty', parties: ['vigil', 'ojjul'], treatyType: 'non_aggression', terms: {}, summary: 'signed' },
    ], 'extraction', 'vigil', true).state;
  const oridin = (s: WorldState) => s.systems.find((x) => x.name === 'Oridin')!;
  const attack = (s: WorldState, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-3', targetId: oridin(s).id, force: 5, label: 'punish', ...extra,
  });

  it('holds back an attack on a pact partner', () => {
    const s = bound();
    const r = honourTreaties(s, 'vigil', [attack(s)]);
    expect(r.ops).toEqual([]);
    expect(r.withheld.join(' ')).toMatch(/pact/);
  });

  it('lets it through when the order names the power it breaks with', () => {
    const s = bound();
    const r = honourTreaties(s, 'vigil', [attack(s, { breaks: 'ojjul' })]);
    expect(r.ops).toHaveLength(1);
    expect(r.withheld).toEqual([]);
  });
});
