import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { ledgerFor, type StarSystem, type WorldState } from '../src/domain/state.js';
import { regardFor } from '../src/domain/regard.js';
import { rollD20 } from '../src/domain/checks.js';
import { ASSASSINATION_KILL_ROLL } from '../src/domain/command.js';
import { AFFAIR_FAVOUR, RESENTFUL, SEDUCTION_PROOF_TURNS } from '../src/domain/estates.js';
import { actingFavour, heldAs, isTurned, listsOf, notableById, seatedAt, whereabouts, withheldFor } from '../src/domain/seats.js';
import { secretLive } from '../src/domain/leverage.js';
import type { OpInput } from '../src/domain/ops.js';

/** Operatives aimed at a notable — `docs/design-2026-10-07-seats.md`. */
const calm: LegacyRules = { randomEvents: false };
const named = (s: WorldState, name: string): StarSystem => s.systems.find((x) => x.name === name)!;
const notableAt = (s: WorldState, world: string) => seatedAt(s, named(s, world).id)[0]!;

/** Place an operative straight onto a world (an actorless batch places at once), sure to succeed. */
function place(
  s: WorldState,
  owner: string,
  world: string,
  mission: string,
  targetNotable: string | undefined,
  effect: Record<string, unknown> = { kind: 'stat_debuff', stat: 'industry', magnitude: 1 },
) {
  const r = applyOps(
    s,
    [{ op: 'deploy_agent', ownerFactionId: owner, systemId: named(s, world).id, mission, effect, targetNotable } as OpInput],
    'engine',
  );
  const agent = r.state.agents[r.state.agents.length - 1];
  if (agent && r.rejections.length === 0) agent.successChance = 100;
  return r;
}

describe('aiming at a notable', () => {
  it('a seduction must name one who sits that world, and not your own', () => {
    const s = createSeedState('meridian');
    expect(place(s, 'ojjul', 'Kalzir', 'seduction', undefined).rejections[0]?.code).toBe('illegal_value');
    expect(place(s, 'ojjul', 'Kalzir', 'seduction', notableAt(s, 'Brannix').name).rejections[0]?.code).toBe('illegal_value');
    expect(place(s, 'vigil', 'Kalzir', 'seduction', notableAt(s, 'Kalzir').name).rejections[0]?.code).toBe('illegal_value');
    const ok = place(s, 'ojjul', 'Kalzir', 'seduction', notableAt(s, 'Kalzir').name);
    expect(ok.rejections).toEqual([]);
    const agent = ok.state.agents.at(-1)!;
    expect(agent.targetNotableId).toBe(notableAt(s, 'Kalzir').id);
    expect(agent.effect).toEqual({ kind: 'seduce' });
  });
});

describe('a turned notable', () => {
  it('works against its holder whatever its estate thinks', () => {
    const s = place(createSeedState('meridian'), 'ojjul', 'Kalzir', 'subversion', notableAt(createSeedState('meridian'), 'Kalzir').name).state;
    const n = notableAt(s, 'Kalzir');
    expect(s.agents.at(-1)!.effect).toEqual({ kind: 'turn_notable' });
    expect(isTurned(s, n)).toBe(true);
    expect(actingFavour(s, n)).toBe(RESENTFUL);
    expect(withheldFor(s, 'vigil')).toBeGreaterThan(0);
    expect(ledgerFor(s, 'vigil').withheld).toBeGreaterThan(0);
  });
});

describe('a seduction', () => {
  it('warms the notable’s world to the seducer, and files proof of the affair after three turns', () => {
    const seed = createSeedState('meridian');
    let s = place(seed, 'ojjul', 'Kalzir', 'seduction', notableAt(seed, 'Kalzir').name).state;
    let control = seed;
    for (let i = 0; i < SEDUCTION_PROOF_TURNS; i++) {
      s = tickTurn(s, calm).state;
      control = tickTurn(control, calm).state;
    }
    expect(regardFor(named(s, 'Kalzir'), 'ojjul')).toBeGreaterThan(regardFor(named(control, 'Kalzir'), 'ojjul'));
    const proof = s.assets.find((a) => a.secret?.kind === 'affair');
    expect(proof?.heldBy).toBe('ojjul');
    expect(proof?.secret?.subject).toBe('vigil');
    expect(secretLive(s, proof!.secret!)).toBe(true);
    // And the seducer has been hearing things.
    expect(s.factions.find((f) => f.id === 'ojjul')!.intel.vigil ?? 0).toBeGreaterThan(
      control.factions.find((f) => f.id === 'ojjul')!.intel.vigil ?? 0,
    );
  });

  /** The Vigil's governor of Kalzir wed to a Meridian notable off its Lists, now a ward at Kalzir. */
  function wedKalzir() {
    const seed = createSeedState('meridian');
    const kalzir = notableAt(seed, 'Kalzir');
    const ward = listsOf(seed, 'meridian')[0]!;
    const s = applyOps(
      seed,
      [
        {
          op: 'form_treaty',
          treatyType: 'marriage',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [ward.id, kalzir.id] },
          summary: 'a marriage',
        } as OpInput,
      ],
      'extraction',
      'meridian',
    ).state;
    return { s, kalzir, ward };
  }
  const affairOf = (s: WorldState) => s.assets.find((a) => a.secret?.kind === 'affair')!;

  it('published, shames the estate, sours the world and ends the marriage it betrays; the ward goes home', () => {
    let { s, kalzir, ward } = wedKalzir();
    s = place(s, 'ojjul', 'Kalzir', 'seduction', kalzir.name).state;
    for (let i = 0; i < SEDUCTION_PROOF_TURNS; i++) s = tickTurn(s, calm).state;
    const proof = affairOf(s);
    expect(proof.secret!.subject).toBe('vigil');
    const favour = s.factions.flatMap((f) => f.estates).find((e) => e.id === kalzir.estateId)!.favour;
    const regard = regardFor(named(s, 'Kalzir'), 'vigil');
    const meridianOfVigil = s.factions.find((f) => f.id === 'meridian')!.disposition.vigil ?? 0;
    const r = applyOps(s, [{ op: 'publish_dossier', assetId: proof.id, reason: '' }], 'model', 'ojjul');
    expect(r.rejections).toEqual([]);
    const after = r.state;
    expect(after.factions.flatMap((f) => f.estates).find((e) => e.id === kalzir.estateId)!.favour).toBe(favour - AFFAIR_FAVOUR);
    expect(regardFor(named(after, 'Kalzir'), 'vigil')).toBeLessThan(regard);
    expect(notableById(after, kalzir.id)!.spouseId).toBeNull();
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(after.factions.find((f) => f.id === 'meridian')!.disposition.vigil).toBeLessThan(meridianOfVigil);
    expect(whereabouts(after, notableById(after, ward.id)!)).toBe('listed');
  });

  it('reaches a ward at their court; their own affair published leaves them the court’s prisoner', () => {
    let { s, ward } = wedKalzir();
    s = place(s, 'ojjul', 'Kalzir', 'seduction', ward.name).state;
    expect(s.agents.at(-1)!.targetNotableId).toBe(ward.id);
    for (let i = 0; i < SEDUCTION_PROOF_TURNS; i++) s = tickTurn(s, calm).state;
    const proof = affairOf(s);
    expect(proof.secret!.subject).toBe('meridian');
    const after = applyOps(s, [{ op: 'publish_dossier', assetId: proof.id, reason: '' }], 'model', 'ojjul').state;
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(heldAs(after, ward.id)!.heldBy).toBe('vigil');
  });

  it('courts an independent world’s notable too, with no court there to shame', () => {
    const seed = createSeedState('meridian');
    let s = place(seed, 'ojjul', 'Sennex', 'seduction', notableAt(seed, 'Sennex').name).state;
    let control = seed;
    for (let i = 0; i < SEDUCTION_PROOF_TURNS; i++) {
      s = tickTurn(s, calm).state;
      control = tickTurn(control, calm).state;
    }
    expect(regardFor(named(s, 'Sennex'), 'ojjul')).toBeGreaterThan(regardFor(named(control, 'Sennex'), 'ojjul'));
    expect(s.assets.some((a) => a.secret?.kind === 'affair')).toBe(false);
  });
});

describe('the knife', () => {
  /** Tick on a turn whose kill roll lands, so the test does not ride the die. */
  function strike(s: WorldState) {
    const agent = s.agents.at(-1)!;
    let turn = s.turn;
    while (rollD20(turn + 1, `assassinate:${agent.id}`) < ASSASSINATION_KILL_ROLL) turn++;
    return tickTurn({ ...s, turn }, calm).state;
  }

  it('kills one of a holder’s own, and the seat stands empty until the holder appoints', () => {
    const seed = createSeedState('meridian');
    const mark = notableAt(seed, 'Kalzir');
    const regard = regardFor(named(seed, 'Kalzir'), 'vigil');
    const after = strike(place(seed, 'ojjul', 'Kalzir', 'assassination', mark.name).state);
    expect(notableById(after, mark.id)).toBeUndefined();
    expect(seatedAt(after, named(after, 'Kalzir').id)).toHaveLength(0);
    expect(regardFor(named(after, 'Kalzir'), 'vigil')).toBeLessThan(regard);
  });

  it('kills a married governor, and the ward goes home', () => {
    const seed = createSeedState('meridian');
    const mark = notableAt(seed, 'Kalzir');
    const ward = listsOf(seed, 'meridian')[0]!;
    const wed = applyOps(
      seed,
      [
        {
          op: 'form_treaty',
          treatyType: 'marriage',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [ward.id, mark.id] },
          summary: 'a marriage',
        } as OpInput,
      ],
      'extraction',
      'meridian',
    ).state;
    const after = strike(place(wed, 'ojjul', 'Kalzir', 'assassination', mark.name).state);
    expect(after.treaties.find((t) => t.type === 'marriage')!.status).toBe('voided');
    expect(whereabouts(after, notableById(after, ward.id)!)).toBe('listed');
  });

  it('cannot reach anyone on the Lists', () => {
    const seed = createSeedState('meridian');
    const listed = listsOf(seed, 'vigil')[0]!;
    expect(place(seed, 'ojjul', 'Kalzir', 'seduction', listed.name).rejections[0]?.code).toBe('illegal_value');
  });

  it('kills an independent world’s notable, and a new one speaks for it', () => {
    const seed = createSeedState('meridian');
    const mark = notableAt(seed, 'Sennex');
    const after = strike(place(seed, 'ojjul', 'Sennex', 'assassination', mark.name).state);
    expect(notableById(after, mark.id)).toBeUndefined();
    expect(notableAt(after, 'Sennex').estateId).toBeNull();
  });
});
