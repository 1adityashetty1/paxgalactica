import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import { MAX_NARRATIVE_DISPOSITION } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * `adjust_disposition` checked only that both factions existed and differed:
 * no actor test, and a magnitude bounded only by the ±100 clamp. Ported from
 * the unmerged `no-star-wars` branch (832b303), with a journal-version
 * exemption the original did not carry — see `LegacyRules.narratedDisposition`.
 */
describe('a power may not decide what two others think of each other', () => {
  const move = (actor: string | undefined, factionId: string, towardFactionId: string, delta: number, legacy = {}) =>
    applyOps(
      createSeedState('drajk'),
      [{ op: 'adjust_disposition', factionId, towardFactionId, delta } as OpInput],
      'model',
      actor,
      false,
      legacy,
    );
  const regard = (s: ReturnType<typeof createSeedState>, who: string, of: string) =>
    s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;

  it('allows your opinion of them, and theirs of you', () => {
    expect(move('drajk', 'drajk', 'meridian', -10).rejections).toHaveLength(0);
    expect(move('drajk', 'meridian', 'drajk', -10).rejections).toHaveLength(0);
  });

  it('refuses a movement between two powers that are neither, and names all three', () => {
    const out = move('ojjul', 'freeworlds', 'meridian', -15);
    expect(out.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(out.rejections[0]!.message).toMatch(/cannot decide what/);
    expect(regard(out.state, 'freeworlds', 'meridian')).toBe(regard(createSeedState('drajk'), 'freeworlds', 'meridian'));
  });

  it('trims a swing larger than any act the reducer charges for, with a note', () => {
    const out = move('drajk', 'drajk', 'meridian', -100);
    expect(out.rejections).toHaveLength(0);
    expect(regard(createSeedState('drajk'), 'drajk', 'meridian') - regard(out.state, 'drajk', 'meridian')).toBe(
      MAX_NARRATIVE_DISPOSITION,
    );
    expect(out.notes.join(' ')).toMatch(/Trimmed/);
  });

  it('leaves an actorless batch alone — engine ops', () => {
    expect(move(undefined, 'freeworlds', 'meridian', -15).rejections).toHaveLength(0);
  });

  it('replays a journal written before the rule as it ran — both halves', () => {
    const old = { narratedDisposition: false };
    expect(move('ojjul', 'freeworlds', 'meridian', -15, old).rejections).toHaveLength(0);
    const big = move('drajk', 'drajk', 'meridian', -60, old);
    expect(regard(createSeedState('drajk'), 'drajk', 'meridian') - regard(big.state, 'drajk', 'meridian')).toBe(60);
  });
});
