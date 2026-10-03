import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  COMMODITY_CAP,
  COMMODITY_PER_TURN,
  COMMODITY_VALUE,
  isCommodity,
} from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Commodities (journal version 12): every power makes goods worth nothing to
 * it and `COMMODITY_VALUE` a unit to anyone else, sold at market in the tick
 * after somebody else comes to hold them. A trade accord can name the flow.
 */

const calm = { randomEvents: false };
const tick = (s: WorldState, n = 1): WorldState => {
  for (let i = 0; i < n; i++) s = tickTurn(s, calm).state;
  return s;
};
const goodsOf = (s: WorldState, maker: string) =>
  s.assets.find((a) => isCommodity(a) && a.issuedBy === maker && a.heldBy === maker);
const credits = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;

describe('goods are made at home', () => {
  it('piles up at the best world, worth nothing to the maker and something to everyone else', () => {
    const s = tick(createSeedState('meridian'));
    const goods = goodsOf(s, 'meridian')!;
    expect(goods).toBeDefined();
    expect(goods.quantity).toBe(COMMODITY_PER_TURN);
    expect(goods.kind).toBe(s.factions.find((f) => f.id === 'meridian')!.commodity!.kind);
    const best = s.systems
      .filter((x) => x.controllerFactionId === 'meridian')
      .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0]!;
    expect(goods.atSystemId).toBe(best.id);
    expect(goods.valuePerUnit.meridian).toBe(0);
    expect(goods.valuePerUnit.ojjul).toBe(COMMODITY_VALUE);
  });

  it('stops at the cap, so a power that never trades simply stops making more', () => {
    const s = tick(createSeedState('meridian'), COMMODITY_CAP);
    expect(goodsOf(s, 'meridian')!.quantity).toBe(COMMODITY_CAP);
    expect(s.assets.filter((a) => isCommodity(a) && a.issuedBy === 'meridian')).toHaveLength(1);
  });

  it('is not made in a galaxy from before goods', () => {
    const s = tick(createSeedState('meridian', { commodities: false }), 3);
    expect(s.assets.filter(isCommodity)).toEqual([]);
  });
});

describe('goods pay when somebody else holds them', () => {
  it('a gift is sold at market on the next tick, and the maker loses nothing', () => {
    let s = tick(createSeedState('meridian'), 3);
    const goods = goodsOf(s, 'meridian')!;
    const given = applyOps(
      s,
      [{ op: 'transfer_asset', assetId: goods.id, toFactionId: 'drajk' } as OpInput],
      'model',
      'meridian',
    );
    expect(given.rejections).toEqual([]);
    s = given.state;
    // Against the same tick without the gift, so income falls out of it.
    const without = tick(tick(createSeedState('meridian'), 3));
    const withGift = tick(s);
    expect(credits(withGift, 'drajk') - credits(without, 'drajk')).toBe(goods.quantity * COMMODITY_VALUE);
    expect(credits(withGift, 'meridian')).toBe(credits(without, 'meridian'));
    expect(withGift.assets.some((a) => a.id === goods.id)).toBe(false);
  });

  it('a trade accord carries them across every turn it holds', () => {
    const signed = applyOps(
      createSeedState('meridian'),
      [
        {
          op: 'form_treaty',
          parties: ['meridian', 'drajk'],
          treatyType: 'trade_accord',
          terms: { commodities: ['meridian'] },
          summary: 'Meridian supplies the Confederacy',
        } as OpInput,
      ],
      'extraction',
      'meridian',
      true,
    );
    expect(signed.rejections).toEqual([]);
    const plain = tick(createSeedState('meridian'), 2);
    const flowing = tick(signed.state, 2);
    // Made and carried and sold in the same tick, twice.
    const gain = credits(flowing, 'drajk') - credits(plain, 'drajk');
    expect(gain).toBe(2 * COMMODITY_PER_TURN * COMMODITY_VALUE);
    expect(goodsOf(flowing, 'meridian')).toBeUndefined();
  });

  it('only on a trade accord, and only the signatories\' goods', () => {
    const wrongType = applyOps(
      createSeedState('meridian'),
      [{ op: 'form_treaty', parties: ['meridian', 'drajk'], treatyType: 'non_aggression', terms: { commodities: ['meridian'] } } as OpInput],
      'extraction',
      'meridian',
      true,
    );
    expect(wrongType.rejections[0]?.message).toMatch(/trade_accord/);
    const stranger = applyOps(
      createSeedState('meridian'),
      [{ op: 'form_treaty', parties: ['meridian', 'drajk'], treatyType: 'trade_accord', terms: { commodities: ['ojjul'] } } as OpInput],
      'extraction',
      'meridian',
      true,
    );
    expect(stranger.rejections[0]?.message).toMatch(/did not sign/);
  });
});
