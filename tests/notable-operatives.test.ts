import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { ledgerFor, type StarSystem, type WorldState } from '../src/domain/state.js';
import { regardFor } from '../src/domain/regard.js';
import { rollD20 } from '../src/domain/checks.js';
import { ASSASSINATION_KILL_ROLL } from '../src/domain/command.js';
import { AFFAIR_FAVOUR, RESENTFUL, SEDUCTION_PROOF_TURNS } from '../src/domain/estates.js';
import { actingFavour, isTurned, notableById, seatedAt, withheldFor } from '../src/domain/seats.js';
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

  it('published, shames the estate, sours the world and ends the marriage it betrays', () => {
    const seed = createSeedState('meridian');
    const kalzir = notableAt(seed, 'Kalzir');
    // Married to Meridian first.
    let s = applyOps(
      seed,
      [
        {
          op: 'form_treaty',
          treatyType: 'marriage',
          parties: ['meridian', 'vigil'],
          terms: { spouses: [notableAt(seed, 'Brannix').id, kalzir.id] },
          summary: 'a marriage',
        } as OpInput,
      ],
      'extraction',
      'meridian',
    ).state;
    s = place(s, 'ojjul', 'Kalzir', 'seduction', kalzir.name).state;
    for (let i = 0; i < SEDUCTION_PROOF_TURNS; i++) s = tickTurn(s, calm).state;
    const proof = s.assets.find((a) => a.secret?.kind === 'affair')!;
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

  it('kills one of a holder’s own, and the seat refills for the same estate', () => {
    const seed = createSeedState('meridian');
    const mark = notableAt(seed, 'Kalzir');
    const s = place(seed, 'ojjul', 'Kalzir', 'assassination', mark.name).state;
    const after = strike(s);
    expect(notableById(after, mark.id)).toBeUndefined();
    const refill = notableAt(after, 'Kalzir');
    expect(refill.id).not.toBe(mark.id);
    expect(refill.estateId).toBe(mark.estateId);
  });

  it('kills a foreign notable, and the seat goes to the holder', () => {
    let seed = createSeedState('meridian');
    seed = applyOps(seed, [{ op: 'transfer_control', systemId: named(seed, 'Kalzir').id, toFactionId: 'meridian' }], 'engine').state;
    const mark = notableAt(seed, 'Kalzir');
    const after = strike(place(seed, 'ojjul', 'Kalzir', 'assassination', mark.name).state);
    expect(notableById(after, mark.id)).toBeUndefined();
    expect(notableAt(after, 'Kalzir').estateId!.startsWith('meridian:')).toBe(true);
  });

  it('kills an independent world’s notable, and a new one speaks for it', () => {
    const seed = createSeedState('meridian');
    const mark = notableAt(seed, 'Sennex');
    const after = strike(place(seed, 'ojjul', 'Sennex', 'assassination', mark.name).state);
    expect(notableById(after, mark.id)).toBeUndefined();
    expect(notableAt(after, 'Sennex').estateId).toBeNull();
  });
});
