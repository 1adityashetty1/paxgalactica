import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { warsFor, type StarSystem, type WorldState } from '../src/domain/state.js';
import { regardFor } from '../src/domain/regard.js';
import { REPATRIATION_GOODWILL } from '../src/domain/command.js';
import { GRANT_FAVOUR, MARRIAGE_CONSENT_REGARD, REVOKED_FAVOUR } from '../src/domain/estates.js';
import { concessionBudget, wardsHeld } from '../src/domain/leverage.js';
import {
  favourBaseline,
  heldAs,
  inLawsByWorld,
  listedFor,
  listsOf,
  marriagesAbroad,
  notableById,
  removeNotable,
  seatedAt,
  whereabouts,
} from '../src/domain/seats.js';
import type { OpInput } from '../src/domain/ops.js';

/** Marriage between notables, wards and prisoners — `docs/design-2026-10-07-seats.md`. */
const calm: LegacyRules = { randomEvents: false };
const named = (s: WorldState, name: string): StarSystem => s.systems.find((x) => x.name === name)!;
const notableAt = (s: WorldState, world: string) => seatedAt(s, named(s, world).id)[0]!;
const estate = (s: WorldState, id: string) => s.factions.flatMap((f) => f.estates).find((e) => e.id === id)!;
const listedOf = (s: WorldState, faction: string) => listsOf(s, faction)[0]!;
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
/** Meridian's governor of Brannix wed to a Vigil notable off its Lists, who becomes Meridian's ward. */
function wedBrannix() {
  const s = createSeedState('meridian');
  const seated = notableAt(s, 'Brannix');
  const ward = listedOf(s, 'vigil');
  const r = marry(s, seated.name, ward.name);
  return { s: r.state, r, seated, ward };
}

describe('a marriage between powers', () => {
  it('weds a seated notable to one off the other Lists, who goes to live at that court as a ward', () => {
    const { s, r, seated, ward } = wedBrannix();
    expect(r.rejections).toEqual([]);
    expect(notableById(s, seated.id)!.spouseId).toBe(ward.id);
    expect(notableById(s, ward.id)!.spouseId).toBe(seated.id);
    const treaty = s.treaties.find((t) => t.type === 'marriage')!;
    expect(treaty.terms.ward).toBe(ward.id);
    const held = heldAs(s, ward.id)!;
    expect(held.heldBy).toBe('meridian');
    expect(held.atSystemId).toBe(named(s, 'Brannix').id);
    expect(whereabouts(s, notableById(s, ward.id)!)).toBe('held');
    // The governor keeps their seat, and the Vigil's Lists are restocked.
    expect(notableById(s, seated.id)!.systemId).toBe(named(s, 'Brannix').id);
    expect(listedFor(s, ward.estateId!).length).toBeGreaterThan(0);
    expect(warsFor(s, 'meridian')).not.toContain('vigil');
  });

  it('takes one seated and one listed — never two of either, nor anyone already wed', () => {
    const s = createSeedState('meridian');
    expect(marry(s, notableAt(s, 'Brannix').name, 'nobody at all').rejections[0]?.code).toBe('illegal_value');
    expect(marry(s, notableAt(s, 'Brannix').id, notableAt(s, 'Kalzir').id).rejections[0]?.message).toMatch(/both of these sit seats/);
    expect(marry(s, listedOf(s, 'meridian').id, listedOf(s, 'vigil').id).rejections[0]?.message).toMatch(/neither of these/);
    expect(
      marry(s, notableAt(s, 'Brannix').id, listedOf(s, 'vigil').id, { ward: notableAt(s, 'Brannix').id }).rejections[0]?.message,
    ).toMatch(/ward is the spouse who comes off the Lists/);
    const odd = applyOps(
      s,
      [
        {
          op: 'form_treaty',
          treatyType: 'non_aggression',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [notableAt(s, 'Brannix').id, listedOf(s, 'vigil').id] },
          summary: 'x',
        } as OpInput,
      ],
      'extraction',
      'meridian',
    );
    expect(odd.rejections[0]?.code).toBe('illegal_value');
    const { s: once, seated } = wedBrannix();
    expect(marry(once, seated.id, listedOf(once, 'vigil').id).rejections[0]?.code).toBe('illegal_value');
  });

  it('counts as a grant for each estate, and draws only the seated spouse’s world toward the in-laws', () => {
    const s = createSeedState('meridian');
    const seated = notableAt(s, 'Brannix');
    const ward = listedOf(s, 'vigil');
    const before = favourBaseline(s, estate(s, seated.estateId!)).baseline;
    const wardBefore = favourBaseline(s, estate(s, ward.estateId!)).baseline;
    const wed = marry(s, seated.id, ward.id).state;
    expect(marriagesAbroad(wed, seated.estateId!)).toBe(1);
    expect(marriagesAbroad(wed, ward.estateId!)).toBe(1);
    expect(favourBaseline(wed, estate(wed, seated.estateId!)).baseline).toBe(before + GRANT_FAVOUR);
    expect(favourBaseline(wed, estate(wed, ward.estateId!)).baseline).toBe(wardBefore + GRANT_FAVOUR);
    const kin = inLawsByWorld(wed);
    expect(kin.get(named(wed, 'Brannix').id)?.has('vigil')).toBe(true);
    expect([...kin.values()].some((k) => k.has('meridian'))).toBe(false);
    const control = tickTurn(s, calm).state;
    const after = tickTurn(wed, calm).state;
    expect(regardFor(named(after, 'Brannix'), 'vigil')).toBeGreaterThan(regardFor(named(control, 'Brannix'), 'vigil'));
  });

  it('broken by the power that gave the ward: the court keeps them prisoner, and the breaker’s estate takes it as a grant revoked', () => {
    const { s, ward } = wedBrannix();
    const treaty = s.treaties.find((t) => t.type === 'marriage')!;
    const r = applyOps(s, [{ op: 'break_treaty', treatyId: treaty.id, reason: '' }], 'model', 'vigil');
    expect(r.rejections).toEqual([]);
    expect(r.state.treaties.find((t) => t.id === treaty.id)!.status).toBe('broken');
    expect(notableById(r.state, ward.id)!.spouseId).toBeNull();
    expect(heldAs(r.state, ward.id)!.heldBy).toBe('meridian');
    expect(estate(r.state, ward.estateId!).favour).toBe(-REVOKED_FAVOUR);
  });

  it('broken by the court that held the ward: the ward is lost', () => {
    const { s, ward, seated } = wedBrannix();
    const treaty = s.treaties.find((t) => t.type === 'marriage')!;
    const r = applyOps(s, [{ op: 'break_treaty', treatyId: treaty.id, reason: '' }], 'model', 'meridian');
    expect(notableById(r.state, ward.id)).toBeUndefined();
    expect(heldAs(r.state, ward.id)).toBeUndefined();
    expect(notableById(r.state, seated.id)!.spouseId).toBeNull();
    expect(estate(r.state, seated.estateId!).favour).toBe(-REVOKED_FAVOUR);
  });

  it('broken by the giver attacking the court: the ward stays, a prisoner', () => {
    // Torrek Anchorage borders the Vigil's Kalzir.
    let s = createSeedState('meridian');
    const seated = notableAt(s, 'Torrek Anchorage');
    const ward = listedOf(s, 'vigil');
    s = marry(s, seated.id, ward.id).state;
    s = applyOps(
      s,
      [
        {
          op: 'issue_order',
          factionId: 'vigil',
          type: 'fleet_movement',
          originId: named(s, 'Kalzir').id,
          targetId: named(s, 'Torrek Anchorage').id,
          label: 'attack',
        } as OpInput,
      ],
      'engine',
    ).state;
    const after = tickTurn(s, calm).state;
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('broken');
    const held = heldAs(after, ward.id);
    expect(held).toBeDefined();
    expect(notableById(after, ward.id)!.spouseId).toBeNull();
  });

  it('ends with the seated spouse’s death, and the ward goes home to the Lists', () => {
    const { s, ward, seated } = wedBrannix();
    removeNotable(s, notableById(s, seated.id)!);
    const after = tickTurn(s, calm).state;
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(whereabouts(after, notableById(after, ward.id)!)).toBe('listed');
  });

  it('ends when a third power takes the seated spouse’s world: both are its prisoners', () => {
    const { s, ward, seated } = wedBrannix();
    const r = applyOps(s, [{ op: 'transfer_control', systemId: named(s, 'Brannix').id, toFactionId: 'ojjul' }], 'engine').state;
    expect(r.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(heldAs(r, seated.id)!.heldBy).toBe('ojjul');
    expect(heldAs(r, ward.id)!.heldBy).toBe('ojjul');
    expect(seatedAt(r, named(r, 'Brannix').id)).toHaveLength(0);
  });

  it('a married governor’s seat cannot be taken by an appointment', () => {
    const { s } = wedBrannix();
    const r = applyOps(
      s,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(s, 'Brannix').id, estate: 'creatives' }],
      'model',
      'meridian',
    );
    expect(r.rejections[0]?.message).toMatch(/married/);
  });
});

describe('a ward', () => {
  it('is leverage: their own power gives up more to the court that holds them', () => {
    const plain = createSeedState('meridian');
    const { s } = wedBrannix();
    expect(wardsHeld(s, 'meridian', 'vigil')).toBe(1);
    expect(concessionBudget(s, 'vigil', 'meridian').because.join(' ')).toMatch(/ward/);
    expect(concessionBudget(plain, 'vigil', 'meridian').because.join(' ')).not.toMatch(/ward/);
  });

  it('questioned, is a marriage betrayed by the court that held them', () => {
    const { s, ward } = wedBrannix();
    const held = heldAs(s, ward.id)!;
    const r = applyOps(s, [{ op: 'consume_asset', assetId: held.id }], 'model', 'meridian');
    expect(r.rejections).toEqual([]);
    expect(notableById(r.state, ward.id)).toBeUndefined();
    expect(r.state.treaties.find((t) => t.type === 'marriage')!.status).toBe('broken');
    expect(r.state.assets.some((a) => a.kind === 'dossier' && a.heldBy === 'meridian')).toBe(true);
  });
});

describe('marrying into an independent world', () => {
  const sennex = (s: WorldState) => named(s, 'Sennex');
  const propose = (s: WorldState, notable: string) =>
    applyOps(s, [{ op: 'propose_marriage', factionId: 'meridian', notable, systemId: sennex(s).id } as OpInput], 'model', 'meridian');

  it('waits on the world’s standing, and sends yours off the Lists to live there', () => {
    const s = createSeedState('meridian');
    const mine = listedOf(s, 'meridian');
    expect(propose(s, mine.name).rejections[0]?.message).toMatch(new RegExp(`takes ${MARRIAGE_CONSENT_REGARD}`));
    expect(propose(s, notableAt(s, 'Brannix').name).rejections[0]?.message).toMatch(/Lists/);
    sennex(s).regard = { ...sennex(s).regard, meridian: MARRIAGE_CONSENT_REGARD };
    const yes = propose(s, mine.name);
    expect(yes.rejections).toEqual([]);
    const theirs = notableAt(yes.state, 'Sennex');
    expect(theirs.spouseId).toBe(mine.id);
    expect(notableById(yes.state, mine.id)!.livesAt).toBe(sennex(yes.state).id);
    expect(whereabouts(yes.state, notableById(yes.state, mine.id)!)).toBe('abroad');
    expect(listedFor(yes.state, mine.estateId!).length).toBeGreaterThan(0);
    expect(marriagesAbroad(yes.state, mine.estateId!)).toBe(1);
    expect(inLawsByWorld(yes.state).get(sennex(yes.state).id)?.has('meridian')).toBe(true);
  });

  it('when the world joins, seats its notable for the estate that made the match, and yours comes home', () => {
    const s = createSeedState('meridian');
    const mine = listsOf(s, 'meridian').find((n) => n.estateId === 'meridian:security')!;
    sennex(s).regard = { ...sennex(s).regard, meridian: 95 };
    const wed = propose(s, mine.id).state;
    const after = tickTurn(wed, calm).state;
    expect(sennex(after).controllerFactionId).toBe('meridian');
    expect(notableAt(after, 'Sennex').estateId).toBe(mine.estateId);
    expect(whereabouts(after, notableById(after, mine.id)!)).toBe('listed');
    expect(marriagesAbroad(after, mine.estateId!)).toBe(0);
  });

  it('ends if the world is taken by force: its notable turned out, yours home — or a third power’s prisoner', () => {
    const s = createSeedState('meridian');
    const mine = listedOf(s, 'meridian');
    sennex(s).regard = { ...sennex(s).regard, meridian: 50 };
    const wed = propose(s, mine.id).state;
    const ours = applyOps(wed, [{ op: 'transfer_control', systemId: sennex(wed).id, toFactionId: 'meridian' }], 'engine').state;
    expect(notableById(ours, mine.id)!.spouseId).toBeNull();
    expect(whereabouts(ours, notableById(ours, mine.id)!)).toBe('listed');
    const theirs = applyOps(wed, [{ op: 'transfer_control', systemId: sennex(wed).id, toFactionId: 'ojjul' }], 'engine').state;
    expect(heldAs(theirs, mine.id)!.heldBy).toBe('ojjul');
  });

  it('is only for a world that answers to nobody', () => {
    const s = createSeedState('meridian');
    const r = applyOps(
      s,
      [{ op: 'propose_marriage', factionId: 'meridian', notable: listedOf(s, 'meridian').id, systemId: named(s, 'Kalzir').id }],
      'model',
      'meridian',
    );
    expect(r.rejections[0]?.message).toMatch(/marriage treaty/);
  });
});

describe('a prisoner', () => {
  const conquered = () => {
    const s = createSeedState('meridian');
    const governor = notableAt(s, 'Kalzir');
    const state = applyOps(s, [{ op: 'transfer_control', systemId: named(s, 'Kalzir').id, toFactionId: 'meridian' }], 'engine').state;
    return { state, governor };
  };

  it('is taken with a world, worth most to their own power, and leaves its seats empty', () => {
    const { state, governor } = conquered();
    const held = heldAs(state, governor.id)!;
    expect(held.heldBy).toBe('meridian');
    expect(held.atSystemId).toBe(named(state, 'Kalzir').id);
    expect(held.valuePerUnit.vigil).toBeGreaterThan(held.valuePerUnit.ojjul!);
    expect(seatedAt(state, named(state, 'Kalzir').id)).toHaveLength(0);
  });

  it('handed home buys standing and goes back on their own Lists — never into the captor’s seat', () => {
    const { state, governor } = conquered();
    const captorSeats = applyOps(
      state,
      [{ op: 'seat_estate', factionId: 'meridian', systemId: named(state, 'Kalzir').id, notable: governor.name }],
      'model',
      'meridian',
    );
    expect(captorSeats.rejections[0]?.code).toBe('illegal_value');
    const held = heldAs(state, governor.id)!;
    const goodwill = state.factions.find((f) => f.id === 'vigil')!.disposition.meridian ?? 0;
    const r = applyOps(state, [{ op: 'transfer_asset', assetId: held.id, toFactionId: 'vigil', reason: '' }], 'model', 'meridian').state;
    expect(r.factions.find((f) => f.id === 'vigil')!.disposition.meridian).toBe(goodwill + REPATRIATION_GOODWILL);
    expect(heldAs(r, governor.id)).toBeUndefined();
    expect(whereabouts(r, notableById(r, governor.id)!)).toBe('listed');
    const home = applyOps(
      r,
      [{ op: 'seat_estate', factionId: 'vigil', systemId: named(r, 'Sarsuma').id, notable: governor.name, office: 'governor' }],
      'model',
      'vigil',
    );
    expect(home.rejections).toEqual([]);
    expect(notableById(home.state, governor.id)!.systemId).toBe(named(home.state, 'Sarsuma').id);
  });
});
