import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import { AssetSchema } from '../src/domain/diplomacy.js';
import type { OpInput } from '../src/domain/ops.js';
import type { WorldState } from '../src/domain/state.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * What a power does with the people it holds moves standing. Ported from the
 * unmerged `no-star-wars` branch (4a4f44c), and widened to the treaty route,
 * which that branch did not have: a ransom is most naturally written as a
 * treaty, and a rule on one route alone makes the other the free one.
 */

function withPrisoner(heldBy: string) {
  const s = createSeedState('drajk');
  const them = s.commanders.find((c) => c.factionId === 'freeworlds')!;
  them.status = 'captured';
  them.atSystemId = null;
  s.assets.push(
    AssetSchema.parse({
      id: 'ast-p', kind: 'officer', text: 'them', heldBy,
      quantity: 1, unit: 'person', commanderId: them.id, agentId: null,
      divisible: false, valuePerUnit: { freeworlds: 450 }, speculative: false,
      valueRange: {}, uses: null, atSystemId: null, portable: true,
      yield: null, acquiredTurn: 0,
    }),
  );
  return s;
}

const regard = (s: WorldState, who: string, of: string) =>
  s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;

const give = (to: string): OpInput => ({ op: 'transfer_asset', assetId: 'ast-p', toFactionId: to } as OpInput);

describe('what a power does with the people it holds', () => {
  it('buys goodwill for handing somebody home', () => {
    const s = withPrisoner('drajk');
    const out = applyOps(s, [give('freeworlds')], 'model', 'drajk');
    expect(out.rejections).toHaveLength(0);
    expect(regard(out.state, 'freeworlds', 'drajk')).toBeGreaterThan(regard(s, 'freeworlds', 'drajk'));
  });

  it('costs standing with their power and every onlooker to sell them on', () => {
    const s = withPrisoner('drajk');
    const out = applyOps(s, [give('vigil')], 'model', 'drajk');
    expect(regard(out.state, 'freeworlds', 'drajk')).toBeLessThan(regard(s, 'freeworlds', 'drajk'));
    expect(regard(out.state, 'meridian', 'drajk')).toBeLessThan(regard(s, 'meridian', 'drajk'));
    // The buyer took part; it is not an onlooker.
    expect(regard(out.state, 'vigil', 'drajk')).toBe(regard(s, 'vigil', 'drajk'));
  });

  it('costs standing with their power to question them', () => {
    const s = withPrisoner('drajk');
    const out = applyOps(s, [{ op: 'consume_asset', assetId: 'ast-p', quantity: 1 } as OpInput], 'model', 'drajk');
    expect(out.rejections).toHaveLength(0);
    expect(regard(out.state, 'freeworlds', 'drajk')).toBeLessThan(regard(s, 'freeworlds', 'drajk'));
  });

  it('prices a ransom written as a treaty the same as one written as a transfer', () => {
    const s = withPrisoner('drajk');
    const treaty = {
      op: 'form_treaty', treatyType: 'contract', parties: ['drajk', 'freeworlds'],
      terms: { assets: [{ assetId: 'ast-p', toFactionId: 'freeworlds' }], payment: { freeworlds: -100, drajk: 100 } },
      summary: 'An officer home for a hundred.',
    } as OpInput;
    const byTreaty = applyOps(s, [treaty], 'extraction', 'drajk', true);
    expect(byTreaty.rejections).toEqual([]);
    expect(byTreaty.state.assets.find((a) => a.id === 'ast-p')!.heldBy).toBe('freeworlds');
    const byTransfer = applyOps(s, [give('freeworlds')], 'model', 'drajk');
    // The treaty also pays TREATY_GOODWILL, so compare the person's share only:
    // the treaty route must move standing by at least what the transfer does.
    const moved = (st: WorldState) => regard(st, 'freeworlds', 'drajk') - regard(s, 'freeworlds', 'drajk');
    expect(moved(byTreaty.state)).toBeGreaterThanOrEqual(moved(byTransfer.state));
  });

  it('says nothing about a cargo that names nobody', () => {
    // Anonymous crews and ore are commerce: a power cannot resent the sale of
    // people it cannot name.
    const s = createSeedState('drajk');
    const cargo = s.assets.find((a) => a.portable && a.commanderId === null && a.agentId === null)!;
    const holder = cargo.heldBy;
    const others = s.factions.filter((f) => f.id !== holder).map((f) => f.id);
    const out = applyOps(s, [{ op: 'transfer_asset', assetId: cargo.id, toFactionId: others[0]! } as OpInput], 'model', holder);
    expect(out.rejections).toHaveLength(0);
    expect(others.map((o) => regard(out.state, o, holder))).toEqual(others.map((o) => regard(s, o, holder)));
  });

  it('moves nothing when replaying a journal written before the rule', () => {
    const s = withPrisoner('drajk');
    const out = applyOps(s, [give('vigil')], 'model', 'drajk', false, { peopleStanding: false });
    expect(s.factions.map((f) => f.disposition)).toEqual(out.state.factions.map((f) => f.disposition));
  });
});
