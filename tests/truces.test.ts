import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { TRUCE_FLOOR, warsFor, type WorldState } from '../src/domain/state.js';
import {
  TRUCE_BREAKING_REPUTATION_COST,
  TRUCE_RECOVERY,
  TRUCE_TURNS,
  truceBetween,
} from '../src/domain/diplomacy.js';
import { proposeFor } from '../src/domain/initiative.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * A peace between two powers at war leaves a truce (journal version 12): it
 * holds them out of war, heals the war toward `TRUCE_FLOOR` and no further, and
 * is the dearest thing in the game to break. The seed's one war is the Vigil
 * and the Confederacy, at −70 and −50.
 */

const calm: LegacyRules = { randomEvents: false };

const sign = (
  s: WorldState,
  type: string,
  extra: Record<string, unknown> = {},
  parties: [string, string] = ['vigil', 'drajk'],
  legacy: LegacyRules = {},
) =>
  applyOps(
    s,
    [{ op: 'form_treaty', parties, treatyType: type, terms: {}, summary: 'peace', ...extra }] as OpInput[],
    'extraction',
    parties[0],
    true,
    legacy,
  );

const regard = (s: WorldState, from: string, toward: string): number =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;

const tick = (s: WorldState, n = 1): WorldState => {
  for (let i = 0; i < n; i++) s = tickTurn(s, calm).state;
  return s;
};

/** A truce placed directly, so a test can isolate it from the paper that made it. */
const withTruce = (s: WorldState, a: string, b: string): WorldState => ({
  ...s,
  truces: [
    { parties: [a, b].sort(), treatyId: 'tre-x', signedTurn: s.turn, untilTurn: s.turn + TRUCE_TURNS, status: 'active' },
  ],
});

describe('a peace between powers at war leaves a truce', () => {
  it('records one, and it outlives the ceasefire that made it', () => {
    const s = createSeedState('meridian');
    expect(warsFor(s, 'vigil')).toContain('drajk');
    const out = sign(s, 'ceasefire', { durationTurns: 2 });
    expect(out.rejections).toEqual([]);
    expect(truceBetween(out.state.truces, out.state.turn, 'vigil', 'drajk')).toMatchObject({
      parties: ['drajk', 'vigil'],
      untilTurn: s.turn + TRUCE_TURNS,
      status: 'active',
    });

    const later = tick(out.state, 3);
    expect(later.treaties[0]!.status).toBe('expired');
    // The ceasefire has lapsed and they are still not at war.
    expect(warsFor(later, 'vigil')).not.toContain('drajk');
    expect(warsFor(later, 'drajk')).not.toContain('vigil');
  });

  it('is left by a cession too, which is spent the moment it is signed', () => {
    const out = sign(createSeedState('meridian'), 'cession', { terms: { territory: ['tor-6'] } }, ['drajk', 'vigil']);
    expect(out.rejections).toEqual([]);
    expect(truceBetween(out.state.truces, out.state.turn, 'vigil', 'drajk')).toBeDefined();
  });

  it('heals the war toward the edge of it, and no further', () => {
    let t = sign(createSeedState('meridian'), 'ceasefire').state;
    const v0 = regard(t, 'vigil', 'drajk');
    const d0 = regard(t, 'drajk', 'vigil');
    expect(v0).toBeLessThan(TRUCE_FLOOR);
    expect(d0).toBeGreaterThan(TRUCE_FLOOR);

    t = tick(t);
    expect(regard(t, 'vigil', 'drajk')).toBe(Math.min(TRUCE_FLOOR, v0 + TRUCE_RECOVERY));
    // Above the floor it moves nothing: a truce never manufactures friendship.
    expect(regard(t, 'drajk', 'vigil')).toBe(d0);

    t = tick(t, TRUCE_TURNS);
    expect(regard(t, 'vigil', 'drajk')).toBe(TRUCE_FLOOR);
  });

  it('runs out, and a war shallow enough to heal does not resume', () => {
    let t = sign(createSeedState('meridian'), 'ceasefire', { durationTurns: 1 }).state;
    t = tick(t, TRUCE_TURNS);
    expect(t.truces[0]!.status).toBe('ended');
    expect(warsFor(t, 'vigil')).not.toContain('drajk');
  });

  it('leaves a war too deep to heal still a war when it ends', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'vigil')!.disposition.drajk = -100;
    let t = sign(s, 'ceasefire', { durationTurns: 1 }).state;
    t = tick(t, TRUCE_TURNS);
    expect(t.truces[0]!.status).toBe('ended');
    expect(regard(t, 'vigil', 'drajk')).toBeLessThan(TRUCE_FLOOR);
    expect(warsFor(t, 'vigil')).toContain('drajk');
  });

  it('is not left by a peace between powers who were not at war', () => {
    const out = sign(createSeedState('meridian'), 'non_aggression', {}, ['meridian', 'ojjul']);
    expect(out.rejections).toEqual([]);
    expect(out.state.truces).toEqual([]);
  });

  it('is not left by an accord that is not a peace', () => {
    const out = sign(createSeedState('meridian'), 'trade_accord');
    expect(out.state.truces).toEqual([]);
  });

  it('waits for a ratified peace to come into force', () => {
    const out = sign(createSeedState('meridian'), 'ceasefire', { ratifyTurns: 1 });
    expect(out.state.truces).toEqual([]);
    const live = tick(out.state);
    expect(truceBetween(live.truces, live.turn, 'vigil', 'drajk')).toBeDefined();
  });

  it('replays a journal from before it as a peace that left nothing', () => {
    const out = sign(createSeedState('meridian'), 'ceasefire', {}, ['vigil', 'drajk'], { truces: false });
    expect(out.rejections).toEqual([]);
    expect(out.state.truces).toEqual([]);
  });
});

describe('breaking a truce', () => {
  // Vantic (tor-3) is one jump from Threx (tor-6), the seeded war's one border.
  const attack: OpInput[] = [
    {
      op: 'issue_order',
      factionId: 'vigil',
      type: 'fleet_movement',
      originId: 'tor-3',
      targetId: 'tor-6',
      force: { battleship: 7, escort: 7, lifter: 2 },
      label: 'across the line',
    } as OpInput,
  ];
  const strike = (s: WorldState) => tick(applyOps(s, attack, 'model', 'vigil').state);

  it('is the dearest public act there is: the victim\'s 25, and twice a pact\'s price with everyone', () => {
    const base = createSeedState('meridian');
    const broken = strike(withTruce(base, 'vigil', 'drajk'));
    const control = strike(base);
    expect(broken.truces[0]!.status).toBe('broken');
    expect(regard(broken, 'drajk', 'vigil')).toBe(Math.max(-100, regard(control, 'drajk', 'vigil') - 25));
    for (const onlooker of ['meridian', 'ojjul', 'freeworlds']) {
      expect(regard(broken, onlooker, 'vigil'), onlooker).toBe(
        regard(control, onlooker, 'vigil') - TRUCE_BREAKING_REPUTATION_COST,
      );
    }
  });

  it('is something the bots will not do', () => {
    // Find a turn on which the Vigil reaches for a Drajk world, then put a truce
    // between them and ask again.
    let s = createSeedState('meridian');
    let target: string | undefined;
    for (let t = 0; t < 20 && !target; t++) {
      const p = proposeFor(s, 'vigil');
      const hit = p?.ops.find(
        (o) =>
          o.op === 'issue_order' &&
          o.type === 'fleet_movement' &&
          s.systems.find((x) => x.id === o.targetId)?.controllerFactionId === 'drajk',
      );
      if (hit) {
        target = String(hit.targetId);
        break;
      }
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tick(s);
    }
    expect(target, 'the Vigil never reached for a Drajk world in 20 turns').toBeDefined();

    const after = proposeFor(withTruce(s, 'vigil', 'drajk'), 'vigil');
    const still = (after?.ops ?? []).some(
      (o) => o.op === 'issue_order' && o.type === 'fleet_movement' && o.targetId === target,
    );
    expect(still).toBe(false);
    expect(after?.withheld.join(' ') ?? '').toMatch(/truce/);
  });
});
