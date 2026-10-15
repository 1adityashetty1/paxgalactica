import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { effectiveStats, ledgerFor, type StarSystem, type WorldState } from '../src/domain/state.js';
import { STAT_NAMES } from '../src/domain/checks.js';
import { familyOf } from '../src/domain/command.js';
import { regardFor } from '../src/domain/regard.js';
import {
  BITTER,
  GRANT_FAVOUR,
  MAX_GRANTS,
  RESEAT_REGARD,
  RESENTFUL,
  REVOKED_FAVOUR,
  driftToward,
  estateOwner,
  favourModifier,
  seatOffice,
} from '../src/domain/estates.js';
import {
  actingFavour,
  courtRecorded,
  emptySeats,
  favourBaseline,
  findEstate,
  heldAs,
  listedFor,
  listsOf,
  notableById,
  notablesAct,
  removeNotable,
  seatedAt,
  seatsFor,
  whereabouts,
  withheldFor,
} from '../src/domain/seats.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Estates, seats and notables — `docs/design-2026-10-07-seats.md`, journal
 * version 20.
 */
const calm: LegacyRules = { randomEvents: false };
const named = (s: WorldState, name: string): StarSystem => s.systems.find((x) => x.name === name)!;
const faction = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!;
const estate = (s: WorldState, id: string) => s.factions.flatMap((f) => f.estates).find((e) => e.id === id)!;
const apply = (s: WorldState, ops: OpInput[], actor?: string) => applyOps(s, ops, actor ? 'model' : 'engine', actor);
const take = (s: WorldState, world: string, to: string | null) =>
  apply(s, [{ op: 'transfer_control', systemId: named(s, world).id, toFactionId: to }]).state;

describe('the opening court', () => {
  const s = createSeedState('meridian');

  it('gives every power three estates on its three weakest base stats, and none on its two strongest', () => {
    expect(courtRecorded(s)).toBe(true);
    for (const f of s.factions) {
      expect(f.estates, f.id).toHaveLength(3);
      const ranked = [...STAT_NAMES].sort((a, b) => f.stats[b] - f.stats[a]);
      const peaks = ranked.slice(0, 2);
      for (const e of f.estates) {
        expect(peaks, `${f.id}: ${e.name} sits on a peak`).not.toContain(e.stat);
        expect(estateOwner(e.id)).toBe(f.id);
        expect(e.favour).toBe(0);
      }
      expect(new Set(f.estates.map((e) => e.stat)).size).toBe(3);
    }
  });

  it('seats every world, two on a hub, and an independent world with a notable of its own', () => {
    for (const world of s.systems) {
      const seated = seatedAt(s, world.id);
      expect(seated, world.name).toHaveLength(seatsFor(world));
      for (const n of seated) {
        if (world.controllerFactionId === null) expect(n.estateId).toBeNull();
        else expect(estateOwner(n.estateId!)).toBe(world.controllerFactionId);
      }
    }
    // Every power holds at least one hub, so every power has a two-seat world.
    for (const f of s.factions) {
      expect(s.systems.some((w) => w.controllerFactionId === f.id && seatsFor(w) === 2), f.id).toBe(true);
    }
  });

  it('names every notable with a family nobody else carries', () => {
    const families = s.notables.map((n) => familyOf(n.name));
    expect(families.every((f) => f !== null)).toBe(true);
    const everyone = [...families, ...s.commanders.map((c) => familyOf(c.name))];
    expect(new Set(everyone).size).toBe(everyone.length);
  });

  it('keeps none of it for a board from before version 20, and the tick seats nobody', () => {
    const old = createSeedState('meridian', { seats: false });
    expect(courtRecorded(old)).toBe(false);
    expect(old.notables).toEqual([]);
    const after = tickTurn(old, calm).state;
    expect(after.notables).toEqual([]);
    expect(ledgerFor(after, 'vigil').stipends).toBe(0);
  });
});

describe('favour', () => {
  it('is a straight modifier on the estate stat, by one table', () => {
    expect([100, 80, 79, 40, 39, 0, -39, -40, -79, -80, -100].map(favourModifier)).toEqual([
      2, 2, 1, 1, 0, 0, 0, -1, -1, -2, -2,
    ]);
  });

  it('reaches effectiveStats, before dissent', () => {
    const s = createSeedState('meridian');
    const before = effectiveStats(s, 'vigil').influence;
    estate(s, 'vigil:bluebloods').favour = 85;
    expect(effectiveStats(s, 'vigil').influence).toBe(before + 2);
    estate(s, 'vigil:bluebloods').favour = -45;
    expect(effectiveStats(s, 'vigil').influence).toBe(Math.max(1, before - 1));
    // Never the peaks: no estate stands behind them.
    const might = effectiveStats(s, 'vigil').might;
    for (const e of faction(s, 'vigil').estates) e.favour = 100;
    expect(effectiveStats(s, 'vigil').might).toBe(might);
  });

  it('drifts a tenth of the way to a baseline of seats against a fair share', () => {
    const s = createSeedState('meridian');
    const blue = estate(s, 'vigil:bluebloods');
    const { seats, fairShare, baseline } = favourBaseline(s, blue);
    expect(seats).toBeGreaterThan(fairShare);
    expect(baseline).toBeGreaterThan(0);
    const after = tickTurn(s, calm).state;
    expect(estate(after, 'vigil:bluebloods').favour).toBe(driftToward(0, baseline));
  });

  it('a stipend lifts the baseline, three grants at most, and revoking one stings', () => {
    let s = createSeedState('meridian');
    const before = favourBaseline(s, estate(s, 'vigil:intelligentsia')).baseline;
    for (let i = 0; i < MAX_GRANTS; i++) {
      const r = apply(s, [{ op: 'grant_stipend', factionId: 'vigil', estate: 'the Intelligentsia' }], 'vigil');
      expect(r.rejections).toEqual([]);
      s = r.state;
    }
    expect(favourBaseline(s, estate(s, 'vigil:intelligentsia')).baseline).toBe(before + MAX_GRANTS * GRANT_FAVOUR);
    expect(ledgerFor(s, 'vigil').stipends).toBeGreaterThan(0);
    const fourth = apply(s, [{ op: 'grant_stipend', factionId: 'vigil', estate: 'intelligentsia' }], 'vigil');
    expect(fourth.rejections[0]?.code).toBe('illegal_value');
    const revoked = apply(s, [{ op: 'revoke_stipend', factionId: 'vigil', estate: 'Intelligentsia' }], 'vigil').state;
    expect(estate(revoked, 'vigil:intelligentsia').favour).toBe(-REVOKED_FAVOUR);
    expect(estate(revoked, 'vigil:intelligentsia').stipends).toBe(MAX_GRANTS - 1);
  });

  it('is your own to pay: nobody grants a rival estate a stipend', () => {
    const s = createSeedState('meridian');
    const r = apply(s, [{ op: 'grant_stipend', factionId: 'vigil', estate: 'the Blue Bloods' }], 'meridian');
    expect(r.rejections[0]?.code).toBe('illegal_value');
  });

  it('finds an estate by what a person would call it', () => {
    const s = createSeedState('meridian');
    const m = faction(s, 'meridian');
    for (const q of ['Standards & Practices', 'standards and practices', 'meridian:standards', 'standards']) {
      expect(findEstate(m, q)?.id, q).toBe('meridian:standards');
    }
    expect(findEstate(m, 'the Blue Bloods')).toBeUndefined();
  });
});

describe('when a world changes hands', () => {
  it('takes whoever sits a conquered world prisoner, and its seat stands empty, doing nothing', () => {
    const before = createSeedState('meridian');
    const governor = seatedAt(before, named(before, 'Kalzir').id)[0]!;
    const s = take(before, 'Kalzir', 'meridian');
    const kalzir = named(s, 'Kalzir');
    expect(seatedAt(s, kalzir.id)).toHaveLength(0);
    expect(emptySeats(s, kalzir)).toEqual([0]);
    expect(heldAs(s, governor.id)!.heldBy).toBe('meridian');
    expect(withheldFor(s, 'meridian')).toBe(0);
    const regard = regardFor(kalzir, 'meridian');
    notablesAct(s);
    expect(regardFor(kalzir, 'meridian')).toBe(regard);
  });

  it('costs the old estate its seat, and gives the conqueror none until it appoints', () => {
    const before = createSeedState('meridian');
    const s = take(before, 'Kalzir', 'meridian');
    const owner = seatedAt(before, named(before, 'Kalzir').id)[0]!.estateId!;
    expect(favourBaseline(s, estate(s, owner)).seats).toBe(favourBaseline(before, estate(before, owner)).seats - 1);
    for (const e of faction(s, 'meridian').estates) {
      expect(favourBaseline(s, e).seats).toBe(favourBaseline(before, estate(before, e.id)).seats);
    }
  });

  it('sends a ceded world’s notable home to the ceder’s Lists', () => {
    const before = createSeedState('meridian');
    const governor = seatedAt(before, named(before, 'Kalzir').id)[0]!;
    const s = apply(before, [
      {
        op: 'form_treaty',
        treatyType: 'cession',
        parties: ['vigil', 'meridian'],
        terms: { territory: [named(before, 'Kalzir').id] },
        summary: 'Kalzir ceded',
      } as OpInput,
    ]).state;
    expect(named(s, 'Kalzir').controllerFactionId).toBe('meridian');
    expect(whereabouts(s, notableById(s, governor.id)!)).toBe('listed');
    expect(seatedAt(s, named(s, 'Kalzir').id)).toHaveLength(0);
  });

  it('turns an independent notable out of a conquered world, and leaves the seat for the conqueror to fill', () => {
    const before = createSeedState('meridian');
    const old = seatedAt(before, named(before, 'Sennex').id)[0]!;
    const s = take(before, 'Sennex', 'meridian');
    expect(seatedAt(s, named(s, 'Sennex').id)).toHaveLength(0);
    expect(s.notables.some((n) => n.id === old.id)).toBe(false);
  });

  it('retaken: the governor held there is freed onto the Lists, and whoever is appointed displaces nobody', () => {
    let s = createSeedState('meridian');
    const old = seatedAt(s, named(s, 'Kalzir').id)[0]!;
    s = take(s, 'Kalzir', 'meridian');
    s = take(s, 'Kalzir', 'vigil');
    // A prisoner is held where they were taken, so retaking the world frees them.
    expect(whereabouts(s, notableById(s, old.id)!)).toBe('listed');
    expect(seatedAt(s, named(s, 'Kalzir').id)).toHaveLength(0);
    const stranger = listedFor(s, old.estateId!).find((n) => n.id !== old.id)!;
    const r = apply(s, [{ op: 'seat_estate', factionId: 'vigil', systemId: named(s, 'Kalzir').id, notable: stranger.name }], 'vigil');
    expect(r.rejections).toEqual([]);
    expect(seatOffice(seatedAt(r.state, named(r.state, 'Kalzir').id)[0]!)).toBe('Governor');
    expect(whereabouts(r.state, notableById(r.state, old.id)!)).toBe('listed');
  });

  it('lets a world joining a power bring its notable into the default estate', () => {
    const s = createSeedState('meridian');
    const sennex = named(s, 'Sennex');
    sennex.regard = { ...sennex.regard, meridian: 95 };
    const after = tickTurn(s, calm).state;
    expect(named(after, 'Sennex').controllerFactionId).toBe('meridian');
    const [n] = seatedAt(after, sennex.id);
    // Sennex is ice — resolve — and Standards & Practices stand behind Meridian's resolve.
    expect(n!.estateId).toBe('meridian:standards');
  });

  it('lets a bitter estate give up a world that is not content, and its notable speaks for it alone', () => {
    const s = createSeedState('meridian');
    const kalzir = named(s, 'Kalzir');
    const [n] = seatedAt(s, kalzir.id);
    estate(s, n!.estateId!).favour = BITTER - 10;
    kalzir.regard = { ...kalzir.regard, vigil: 0 };
    const after = tickTurn(s, calm).state;
    expect(named(after, 'Kalzir').controllerFactionId).toBeNull();
    expect(seatedAt(after, kalzir.id)[0]!.estateId).toBeNull();
    expect(after.eventLog.some((e) => e.text.includes('will not hold Kalzir'))).toBe(true);
  });

  it('leaves a content world alone, however bitter its notable', () => {
    const s = createSeedState('meridian');
    const kalzir = named(s, 'Kalzir');
    estate(s, seatedAt(s, kalzir.id)[0]!.estateId!).favour = -100;
    const after = tickTurn(s, calm).state;
    expect(named(after, 'Kalzir').controllerFactionId).toBe('vigil');
  });
});

describe('reseating', () => {
  it('fills an empty seat off the Lists at no cost, and an estate is never left with nobody listed', () => {
    const s = take(createSeedState('meridian'), 'Kalzir', 'meridian');
    const kalzir = named(s, 'Kalzir');
    const regard = regardFor(kalzir, 'meridian');
    const listed = listedFor(s, 'meridian:security');
    const r = apply(
      s,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: kalzir.id, estate: 'the Security Directorate' }],
      'meridian',
    );
    expect(r.rejections).toEqual([]);
    const [n] = seatedAt(r.state, kalzir.id);
    expect(n!.id).toBe(listed[0]!.id);
    expect(seatOffice(n!)).toBe('Governor');
    expect(regardFor(named(r.state, 'Kalzir'), 'meridian')).toBe(regard);
    expect(listedFor(r.state, 'meridian:security').length).toBeGreaterThan(0);
  });

  it('takes a filled seat at a little of the world’s regard, and the one displaced goes back on the Lists', () => {
    const s = createSeedState('meridian');
    const brannix = named(s, 'Brannix');
    const sitting = seatedAt(s, brannix.id)[0]!;
    const other = faction(s, 'meridian').estates.find((e) => e.id !== sitting.estateId)!;
    const regard = regardFor(brannix, 'meridian');
    const r = apply(s, [{ op: 'seat_estate', factionId: 'meridian', systemId: brannix.id, estate: other.id }], 'meridian');
    expect(r.rejections).toEqual([]);
    expect(seatedAt(r.state, brannix.id)[0]!.estateId).toBe(other.id);
    expect(regardFor(named(r.state, 'Brannix'), 'meridian')).toBe(regard - RESEAT_REGARD);
    expect(whereabouts(r.state, notableById(r.state, sitting.id)!)).toBe('listed');
  });

  it('appoints only someone off your own Lists', () => {
    const s = take(createSeedState('meridian'), 'Kalzir', 'meridian');
    const kalzir = named(s, 'Kalzir');
    const rival = listsOf(s, 'vigil')[0]!;
    const r = apply(s, [{ op: 'seat_estate', factionId: 'meridian', systemId: kalzir.id, notable: rival.name }], 'meridian');
    expect(r.rejections[0]?.code).toBe('illegal_value');
    const none = apply(s, [{ op: 'seat_estate', factionId: 'meridian', systemId: kalzir.id }], 'meridian');
    expect(none.rejections[0]?.code).toBe('illegal_value');
  });

  it('on a hub, displaces the estate holding the most seats', () => {
    const s = createSeedState('meridian');
    const vantic = named(s, 'Vantic');
    const r = apply(s, [{ op: 'seat_estate', factionId: 'vigil', systemId: vantic.id, estate: 'the Blue Bloods' }], 'vigil');
    expect(r.rejections).toEqual([]);
    const estates = seatedAt(r.state, vantic.id).map((n) => n.estateId);
    expect(estates).toContain('vigil:bluebloods');
    expect(estates).toHaveLength(2);
  });

  it('is only for a world you hold', () => {
    const s = createSeedState('meridian');
    const r = apply(
      s,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(s, 'Kalzir').id, estate: 'standards' }],
      'meridian',
    );
    expect(r.rejections[0]?.code).toBe('illegal_value');
  });
});

describe('a hub’s two offices', () => {
  it('seats a governor and a chancellor; one killed leaves that office empty, and the next appointment fills it', () => {
    const s = createSeedState('meridian');
    const hub = s.systems.find((w) => w.controllerFactionId === 'meridian' && seatedAt(s, w.id).length === 2)!;
    const [a, b] = [...seatedAt(s, hub.id)].sort((x, y) => x.seat - y.seat);
    expect([seatOffice(a!), seatOffice(b!)]).toEqual(['Governor', 'Chancellor']);
    const plain = s.systems.find((w) => seatedAt(s, w.id).length === 1)!;
    expect(seatOffice(seatedAt(s, plain.id)[0]!)).toBe('Governor');
    removeNotable(s, a!);
    expect(emptySeats(s, hub)).toEqual([0]);
    const r = apply(s, [{ op: 'seat_estate', factionId: 'meridian', systemId: hub.id, estate: a!.estateId! }], 'meridian');
    expect(r.rejections).toEqual([]);
    const now = seatedAt(r.state, hub.id);
    expect(seatOffice(now.find((n) => n.id !== b!.id)!)).toBe('Governor');
    expect(seatOffice(now.find((n) => n.id === b!.id)!)).toBe('Chancellor');
  });
});

describe('the Lists', () => {
  it('open with someone waiting for every estate', () => {
    const s = createSeedState('meridian');
    for (const f of s.factions) {
      for (const e of f.estates) expect(listedFor(s, e.id).length).toBeGreaterThan(0);
    }
  });

  it('hold nobody an operative can reach', () => {
    const s = createSeedState('meridian');
    const listed = listsOf(s, 'vigil')[0]!;
    const r = apply(
      s,
      [
        {
          op: 'deploy_agent',
          ownerFactionId: 'ojjul',
          systemId: named(s, 'Kalzir').id,
          mission: 'assassination',
          effect: { kind: 'stat_debuff', stat: 'might', magnitude: 1 },
          targetNotable: listed.name,
        } as OpInput,
      ],
    );
    expect(r.state.agents.at(-1)?.targetNotableId).toBeUndefined();
  });
});
