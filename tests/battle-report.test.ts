import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { changedHands, totalLosses, type BattleReport } from '../src/domain/battle.js';
import type { WarEthic, WorldState } from '../src/domain/state.js';

/**
 * `resolveBattle` computed the roll, both modifiers, the powers the 2:1 test
 * compares, the dug-in garrison and the assault total — and flattened all of it
 * into one sentence. The player saw "Fleets engage over Kalzir: Meridian loses
 * 24, defenders lose 20" and could not tell which phase decided it.
 *
 * It got worse when war ethics gained mechanical force: four doctrines now
 * change battles and none of them were observable. `doctrinesFired` is the
 * answer, and these tests are the first thing that can assert a doctrine did
 * anything in a real fight.
 */

const fresh = (player = 'freeworlds'): WorldState => createSeedState(player);
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const fac = (s: WorldState, id: string) => s.factions.find((x) => x.id === id)!;

/** Send `force` from `origin` to `target` and tick until it lands. */
function fight(
  setup: (s: WorldState) => void,
  opts: { attacker: string; origin: string; target: string; force: number },
): { state: WorldState; battles: BattleReport[] } {
  const state = fresh();
  setup(state);
  sys(state, opts.origin).ships[opts.attacker] = opts.force;
  const issued = applyOps(
    state,
    [
      {
        op: 'issue_order', factionId: opts.attacker, type: 'fleet_movement',
        originId: opts.origin, targetId: opts.target, force: opts.force,
      },
    ],
    'model',
    opts.attacker,
  );
  expect(issued.rejections).toEqual([]);
  let s = issued.state;
  let battles: BattleReport[] = [];
  for (let i = 0; i < 8 && s.pendingOrders.length > 0; i++) {
    const tick = tickTurn(s);
    s = tick.state;
    if (tick.report.battles.length > 0) battles = tick.report.battles;
  }
  return { state: s, battles };
}

describe('a battle is a record, not a sentence', () => {
  it('reports the engagement with the arithmetic still attached', () => {
    const { battles } = fight(() => {}, {
      attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 14,
    });
    expect(battles).toHaveLength(1);
    const b = battles[0]!;
    expect(b.systemId).toBe('ark-6');
    expect(b.id).toBe(`ark-6:${b.turn}`);
    expect(b.roll).toBeGreaterThanOrEqual(1);
    expect(b.roll).toBeLessThanOrEqual(20);
    expect(b.rounds.length).toBeGreaterThan(0);
    // The prose survives, so the log and the panel cannot disagree.
    expect(b.note.length).toBeGreaterThan(0);
  });

  it('agrees with the state it produced', () => {
    const { state, battles } = fight(() => {}, {
      attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 14,
    });
    const b = battles[0]!;
    const after = sys(state, 'ark-6');
    // The report is the record of what happened, so it must match the board.
    expect(b.holderAfter).toBe(after.controllerFactionId);
    expect(b.garrisonAfter).toBe(after.garrison);
    expect(changedHands(b)).toBe(b.holderBefore !== after.controllerFactionId);
  });

  it('records losses that reconcile with the hulls that vanished', () => {
    const { battles } = fight(() => {}, {
      attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 14,
    });
    const { attackers, defenders } = totalLosses(battles[0]!);
    expect(attackers).toBeGreaterThanOrEqual(0);
    expect(defenders).toBeGreaterThanOrEqual(0);
    expect(attackers + defenders).toBeGreaterThan(0);
  });

  it('reports nothing for a reinforcement, which is not a battle', () => {
    const state = fresh();
    sys(state, 'ark-1').ships['freeworlds'] = 6;
    const issued = applyOps(
      state,
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
          originId: 'ark-1', targetId: 'ark-3', force: 6,
        },
      ],
      'model',
      'freeworlds',
    );
    let s = issued.state;
    let sawBattle = false;
    for (let i = 0; i < 4 && s.pendingOrders.length > 0; i++) {
      const tick = tickTurn(s);
      s = tick.state;
      if (tick.report.battles.length > 0) sawBattle = true;
    }
    expect(sawBattle).toBe(false);
  });

  it('reports each round as its own delta, reconciling with the final board', () => {
    // The first version snapshotted the system's ships at entry, so attackers —
    // who are in transit, not in orbit — were reported as a fleet of zero
    // attacking. Each round now carries what that side had when the round
    // started, and the last round must land on what the board actually holds.
    const { state, battles } = fight(
      (s) => {
        const t = sys(s, 'ark-6');
        t.garrison = 3;
        t.garrisonMax = 14;
        t.ships['freeworlds'] = 5;
      },
      { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 26 },
    );
    const b = battles[0]!;
    const orbital = b.rounds.find((r) => r.phase === 'orbital')!;
    expect(orbital.attackers[0]!.before).toBe(26);

    const last = b.rounds[b.rounds.length - 1]!;
    const onBoard = sys(state, 'ark-6').ships['krayt'] ?? 0;
    expect(last.attackers.find((c) => c.factionId === 'krayt')!.after).toBe(onBoard);
  });

  it('is deterministic, like the battle it describes', () => {
    const a = fight(() => {}, { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 14 });
    const b = fight(() => {}, { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 14 });
    expect(JSON.stringify(a.battles)).toBe(JSON.stringify(b.battles));
  });
});

describe('doctrinesFired makes the war ethics observable', () => {
  /** Same battle, one doctrine changed. */
  const withEthics = (holder: WarEthic, attacker: WarEthic, force: number) =>
    fight(
      (s) => {
        fac(s, 'freeworlds').warEthic = holder;
        fac(s, 'krayt').warEthic = attacker;
      },
      { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force },
    );

  it('names a defensive garrison fighting above its size', () => {
    const dugIn = withEthics('defensive', 'profiteer', 20).battles[0]!;
    const plain = withEthics('profiteer', 'profiteer', 20).battles[0]!;
    expect(dugIn.doctrinesFired.join(' ')).toMatch(/defensive: .* fought as/);
    expect(plain.doctrinesFired.join(' ')).not.toMatch(/defensive/);
  });

  it('stays silent when a doctrine did not change anything', () => {
    // A crusading power that was never asked to retreat has done nothing worth
    // telling the player about, so it must not appear.
    const b = withEthics('crusading', 'profiteer', 3).battles[0]!;
    for (const line of b.doctrinesFired) expect(line).not.toMatch(/crusading/);
  });

  it('names an opportunist that picked on a stripped garrison', () => {
    const raider = fight(
      (s) => {
        fac(s, 'krayt').warEthic = 'opportunist';
        fac(s, 'freeworlds').warEthic = 'profiteer';
        const t = sys(s, 'ark-6');
        t.garrison = 2;
        t.garrisonMax = 14;
        delete t.ships['freeworlds'];
      },
      { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 10 },
    ).battles[0]!;
    expect(raider.doctrinesFired.join(' ')).toMatch(/opportunist: \+\d+ might/);
  });
});

describe('the phases are told apart', () => {
  it('separates the orbital exchange from the ground assault', () => {
    const { battles } = fight(
      (s) => {
        sys(s, 'ark-6').ships['freeworlds'] = 6;
        fac(s, 'freeworlds').warEthic = 'profiteer';
      },
      { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 30 },
    );
    const phases = battles[0]!.rounds.map((r) => r.phase);
    expect(phases[0]).toBe('orbital');
    // Every round carries the turn it happened on — the multi-turn hook.
    for (const r of battles[0]!.rounds) expect(r.turn).toBe(battles[0]!.turn);
  });

  it('carries the powers the break-off test compared, on the orbital round', () => {
    const { battles } = fight(
      (s) => {
        sys(s, 'ark-6').ships['freeworlds'] = 6;
      },
      { attacker: 'krayt', origin: 'ark-5', target: 'ark-6', force: 30 },
    );
    const orbital = battles[0]!.rounds.find((r) => r.phase === 'orbital')!;
    expect(orbital.attackPower).toBeGreaterThan(0);
    expect(orbital.defendPower).toBeGreaterThan(0);
  });
});
