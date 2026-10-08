import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { warsFor, type StarSystem, type WorldState } from '../src/domain/state.js';
import { regardFor } from '../src/domain/regard.js';
import { REPATRIATION_GOODWILL } from '../src/domain/command.js';
import { GRANT_FAVOUR, MARRIAGE_CONSENT_REGARD, REVOKED_FAVOUR, RESENTFUL, estateOwner } from '../src/domain/estates.js';
import {
  actingFavour,
  favourBaseline,
  heldAs,
  inLawsByWorld,
  marriagesAbroad,
  notableById,
  removeNotable,
  seatedAt,
} from '../src/domain/seats.js';
import type { OpInput } from '../src/domain/ops.js';

/** Marriage between notables, wards and prisoners — `docs/design-2026-10-07-seats.md`. */
const calm: LegacyRules = { randomEvents: false };
const named = (s: WorldState, name: string): StarSystem => s.systems.find((x) => x.name === name)!;
const notableAt = (s: WorldState, world: string) => seatedAt(s, named(s, world).id)[0]!;
const estate = (s: WorldState, id: string) => s.factions.flatMap((f) => f.estates).find((e) => e.id === id)!;
const marry = (s: WorldState, a: string, b: string, extra: Record<string, unknown> = {}) =>
  applyOps(
    s,
    [
      {
        op: 'form_treaty',
        treatyType: 'marriage',
        parties: ['meridian', 'vigil'],
        terms: { spouses: [a, b], ...extra },
        summary: 'a marriage',
      } as OpInput,
    ],
    'extraction',
    'meridian',
  );

describe('a marriage between powers', () => {
  it('weds a notable of each party, by name, and is a peace', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const r = marry(s, m.name, v.name.split(' ').pop()!);
    expect(r.rejections).toEqual([]);
    expect(notableById(r.state, m.id)!.spouseId).toBe(v.id);
    expect(notableById(r.state, v.id)!.spouseId).toBe(m.id);
    const treaty = r.state.treaties.find((t) => t.type === 'marriage')!;
    expect(treaty.terms.spouses).toEqual([m.id, v.id]);
    expect(warsFor(r.state, 'meridian')).not.toContain('vigil');
  });

  it('names its spouses, and only a marriage does', () => {
    const s = createSeedState('meridian');
    expect(marry(s, notableAt(s, 'Brannix').name, 'nobody at all').rejections[0]?.code).toBe('illegal_value');
    const odd = applyOps(
      s,
      [
        {
          op: 'form_treaty',
          treatyType: 'non_aggression',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [notableAt(s, 'Brannix').id, notableAt(s, 'Kalzir').id] },
          summary: 'x',
        } as OpInput,
      ],
      'extraction',
      'meridian',
    );
    expect(odd.rejections[0]?.code).toBe('illegal_value');
    const once = marry(s, notableAt(s, 'Brannix').id, notableAt(s, 'Kalzir').id).state;
    expect(marry(once, notableAt(once, 'Brannix').id, notableAt(once, 'Sarsuma').id).rejections[0]?.message).toMatch(
      /already married/,
    );
  });

  it('counts as a grant for each estate, and draws each world toward the in-laws', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const before = favourBaseline(s, estate(s, m.estateId!)).baseline;
    const wed = marry(s, m.id, v.id).state;
    expect(marriagesAbroad(wed, m.estateId!)).toBe(1);
    expect(favourBaseline(wed, estate(wed, m.estateId!)).baseline).toBe(before + GRANT_FAVOUR);
    expect(inLawsByWorld(wed).get(named(wed, 'Kalzir').id)?.has('meridian')).toBe(true);
    const control = tickTurn(s, calm).state;
    const after = tickTurn(wed, calm).state;
    expect(regardFor(named(after, 'Kalzir'), 'meridian')).toBeGreaterThan(regardFor(named(control, 'Kalzir'), 'meridian'));
    expect(regardFor(named(after, 'Brannix'), 'vigil')).toBeGreaterThan(regardFor(named(control, 'Brannix'), 'vigil'));
  });

  it('keeps a spouse from working against the in-laws who take its world', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    let wed = marry(s, m.id, v.id).state;
    wed = applyOps(wed, [{ op: 'transfer_control', systemId: named(wed, 'Kalzir').id, toFactionId: 'meridian' }], 'engine').state;
    expect(actingFavour(wed, notableById(wed, v.id)!)).toBe(0);
    const stranger = applyOps(s, [{ op: 'transfer_control', systemId: named(s, 'Kalzir').id, toFactionId: 'meridian' }], 'engine').state;
    expect(actingFavour(stranger, notableAt(stranger, 'Kalzir'))).toBe(RESENTFUL);
  });

  it('ends in a divorce at a broken pact’s price, and the breaker’s estate takes it as a grant revoked', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const wed = marry(s, m.id, v.id).state;
    const treaty = wed.treaties.find((t) => t.type === 'marriage')!;
    const r = applyOps(wed, [{ op: 'break_treaty', treatyId: treaty.id, reason: '' }], 'model', 'meridian');
    expect(notableById(r.state, m.id)!.spouseId).toBeNull();
    expect(notableById(r.state, v.id)!.spouseId).toBeNull();
    expect(estate(r.state, m.estateId!).favour).toBe(-REVOKED_FAVOUR);
  });

  it('is voided when a spouse is gone', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const wed = marry(s, m.id, v.id).state;
    removeNotable(wed, notableById(wed, v.id)!);
    const after = tickTurn(wed, calm).state;
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(notableById(after, m.id)!.spouseId).toBeNull();
  });
});

describe('a ward', () => {
  it('leaves their seat for the in-laws’ court, and their estate keeps the seat', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const r = marry(s, m.id, v.id, { ward: v.name });
    expect(r.rejections).toEqual([]);
    const ward = notableById(r.state, v.id)!;
    expect(ward.systemId).toBeNull();
    expect(ward.homeId).toBe(named(r.state, 'Kalzir').id);
    const held = heldAs(r.state, v.id)!;
    expect(held.heldBy).toBe('meridian');
    const refill = seatedAt(r.state, named(r.state, 'Kalzir').id);
    expect(refill).toHaveLength(1);
    expect(refill[0]!.estateId).toBe(v.estateId);
    // The pull goes on from the world they left.
    expect(inLawsByWorld(r.state).get(named(r.state, 'Kalzir').id)?.has('meridian')).toBe(true);
  });

  it('questioned, is a marriage betrayed by the court that held them', () => {
    const s = createSeedState('meridian');
    const m = notableAt(s, 'Brannix');
    const v = notableAt(s, 'Kalzir');
    const wed = marry(s, m.id, v.id, { ward: v.id }).state;
    const held = heldAs(wed, v.id)!;
    const r = applyOps(wed, [{ op: 'consume_asset', assetId: held.id }], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(notableById(r.state, v.id)).toBeUndefined();
    expect(r.state.treaties.find((t) => t.type === 'marriage')!.status).toBe('broken');
    expect(r.state.assets.some((a) => a.kind === 'dossier' && a.heldBy === 'meridian')).toBe(true);
  });
});

describe('marrying into an independent world', () => {
  const sennex = (s: WorldState) => named(s, 'Sennex');

  it('waits on the world’s standing with you', () => {
    const s = createSeedState('meridian');
    const mine = notableAt(s, 'Brannix');
    const op = { op: 'propose_marriage', factionId: 'meridian', notable: mine.name, systemId: sennex(s).id } as OpInput;
    const no = applyOps(s, [op], 'model', 'meridian');
    expect(no.rejections[0]?.message).toMatch(new RegExp(`takes ${MARRIAGE_CONSENT_REGARD}`));
    sennex(s).regard = { ...sennex(s).regard, meridian: MARRIAGE_CONSENT_REGARD };
    const yes = applyOps(s, [op], 'model', 'meridian');
    expect(yes.rejections).toEqual([]);
    const theirs = notableAt(yes.state, 'Sennex');
    expect(theirs.spouseId).toBe(mine.id);
    expect(marriagesAbroad(yes.state, mine.estateId!)).toBe(1);
    expect(inLawsByWorld(yes.state).get(sennex(yes.state).id)?.has('meridian')).toBe(true);
  });

  it('when the world joins, seats its notable for the estate that made the match', () => {
    const s = createSeedState('meridian');
    // Corvid's notable is the Security Directorate's; Sennex's ground would
    // default to Standards & Practices.
    const mine = notableAt(s, 'Corvid');
    sennex(s).regard = { ...sennex(s).regard, meridian: 95 };
    const wed = applyOps(
      s,
      [{ op: 'propose_marriage', factionId: 'meridian', notable: mine.id, systemId: sennex(s).id }],
      'model',
      'meridian',
    ).state;
    const after = tickTurn(wed, calm).state;
    expect(sennex(after).controllerFactionId).toBe('meridian');
    expect(notableAt(after, 'Sennex').estateId).toBe(mine.estateId);
    expect(marriagesAbroad(after, mine.estateId!)).toBe(0);
  });

  it('ends if you take the world by force: its notable is turned out', () => {
    const s = createSeedState('meridian');
    const mine = notableAt(s, 'Brannix');
    sennex(s).regard = { ...sennex(s).regard, meridian: 50 };
    let wed = applyOps(
      s,
      [{ op: 'propose_marriage', factionId: 'meridian', notable: mine.id, systemId: sennex(s).id }],
      'model',
      'meridian',
    ).state;
    wed = applyOps(wed, [{ op: 'transfer_control', systemId: sennex(wed).id, toFactionId: 'meridian' }], 'engine').state;
    expect(notableById(wed, mine.id)!.spouseId).toBeNull();
  });

  it('is only for a world that answers to nobody', () => {
    const s = createSeedState('meridian');
    const r = applyOps(
      s,
      [{ op: 'propose_marriage', factionId: 'meridian', notable: notableAt(s, 'Brannix').id, systemId: named(s, 'Kalzir').id }],
      'model',
      'meridian',
    );
    expect(r.rejections[0]?.message).toMatch(/marriage treaty/);
  });
});

describe('a prisoner', () => {
  const conquered = () => {
    const s = createSeedState('meridian');
    return applyOps(s, [{ op: 'transfer_control', systemId: named(s, 'Kalzir').id, toFactionId: 'meridian' }], 'engine').state;
  };

  it('is taken when a conqueror reseats a foreign notable, and is worth most to their own power', () => {
    const s = conquered();
    const foreign = notableAt(s, 'Kalzir');
    const r = applyOps(
      s,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(s, 'Kalzir').id, estate: 'security' }],
      'model',
      'meridian',
    );
    expect(r.rejections).toEqual([]);
    const held = heldAs(r.state, foreign.id)!;
    expect(held.heldBy).toBe('meridian');
    expect(held.atSystemId).toBe(named(r.state, 'Kalzir').id);
    expect(held.valuePerUnit.vigil).toBeGreaterThan(held.valuePerUnit.ojjul!);
    expect(notableById(r.state, foreign.id)!.systemId).toBeNull();
  });

  it('handed home buys standing, and goes back into a seat for their own estate — never the captor’s', () => {
    const s = conquered();
    const foreign = notableAt(s, 'Kalzir');
    let r = applyOps(
      s,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(s, 'Kalzir').id, estate: 'security' }],
      'model',
      'meridian',
    ).state;
    const held = heldAs(r, foreign.id)!;
    const captorSeats = applyOps(
      r,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(r, 'Brannix').id, estate: 'standards', fromAssetId: held.id }],
      'model',
      'meridian',
    );
    expect(captorSeats.rejections[0]?.code).toBe('illegal_value');
    const goodwill = r.factions.find((f) => f.id === 'vigil')!.disposition.meridian ?? 0;
    r = applyOps(r, [{ op: 'transfer_asset', assetId: held.id, toFactionId: 'vigil', reason: '' }], 'model', 'meridian').state;
    expect(r.factions.find((f) => f.id === 'vigil')!.disposition.meridian).toBe(goodwill + REPATRIATION_GOODWILL);
    const own = foreign.estateId!;
    const home = applyOps(
      r,
      [{ op: 'seat_estate', factionId: 'vigil', systemId: named(r, 'Sarsuma').id, estate: own, fromAssetId: held.id }],
      'model',
      'vigil',
    );
    expect(home.rejections).toEqual([]);
    expect(notableById(home.state, foreign.id)!.systemId).toBe(named(home.state, 'Sarsuma').id);
    expect(heldAs(home.state, foreign.id)).toBeUndefined();
    expect(estateOwner(notableById(home.state, foreign.id)!.estateId!)).toBe('vigil');
  });
});
