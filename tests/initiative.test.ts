import { addShipsAt, setShipsAt, stackAt } from '../src/domain/state.js';
import { HULL_CLASSES, carryOf, type ShipStack } from '../src/domain/hulls.js';
import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { GRIEVANCE_WEIGHT, proposeFor, targetPriority } from '../src/domain/initiative.js';
import { warsFor, type WorldState } from '../src/domain/state.js';

/**
 * Doctrine initiative, and the measurement that made it necessary.
 *
 * Over a seven-turn live campaign the reaction call produced six NPC attacks
 * and every one of them targeted the player, on a single world — while two
 * pairs of NPCs sat at war on paper and never moved a ship at each other. The
 * NPCs were not passive; the galaxy was the player and four powers who existed
 * only in relation to them.
 */

const seed = () => createSeedState('ojjul');

/** Play `turns` with the player doing nothing at all — the case that used to be inert. */
function quietCampaign(turns: number): { state: WorldState; npcVsNpc: number } {
  let s = seed();
  let npcVsNpc = 0;
  for (let t = 0; t < turns; t++) {
    for (const f of s.factions) {
      if (f.id === s.playerFactionId) continue;
      const p = proposeFor(s, f.id);
      if (!p) continue;
      for (const op of p.ops) {
        if (op.op !== 'issue_order' || op.type !== 'fleet_movement') continue;
        const holder = s.systems.find((x) => x.id === op.targetId)?.controllerFactionId;
        if (holder && holder !== f.id && holder !== s.playerFactionId) npcVsNpc++;
      }
      s = applyOps(s, p.ops, 'model', f.id, true).state;
    }
    s = tickTurn(s).state;
  }
  return { state: s, npcVsNpc };
}

describe('the galaxy moves without the player', () => {
  /**
   * The success criterion, and it was exactly zero before this existed.
   * A loose bound on purpose, in the style of the balance assertions: a tight
   * number here is one people learn to ignore.
   */
  it('produces NPC-vs-NPC aggression', () => {
    expect(quietCampaign(12).npcVsNpc).toBeGreaterThan(0);
  });

  it('moves territory between NPCs, not only away from the player', () => {
    const before = seed();
    const { state } = quietCampaign(12);
    const changed = state.systems.filter((sys) => {
      const was = before.systems.find((x) => x.id === sys.id)!.controllerFactionId;
      return was !== sys.controllerFactionId;
    });
    expect(changed.length).toBeGreaterThan(0);
    // At least one world taken off an NPC by another NPC.
    const npcOffNpc = changed.filter((sys) => {
      const was = before.systems.find((x) => x.id === sys.id)!.controllerFactionId;
      return was !== null && was !== 'ojjul' && sys.controllerFactionId !== 'ojjul';
    });
    expect(npcOffNpc.length).toBeGreaterThan(0);
  });

  it('leaves the player’s own faction alone — initiative is for NPCs', () => {
    // The engine skips the player, but the bot exists for every faction and
    // must not be reachable by accident.
    const s = seed();
    expect(proposeFor(s, 'ojjul')).not.toBeNull(); // it CAN propose
    // …the guarantee is in the engine's `spokenFor` set, tested via turn.ts.
  });
});

describe('a doctrine is not a licence', () => {
  const pactBetween = (s: WorldState, a: string, b: string, type: string): WorldState =>
    applyOps(s, [
      {
        op: 'form_treaty',
        parties: [a, b],
        treatyType: type,
        terms: {},
        summary: 'signed',
      },
      // `form_treaty` needs the transcript source; a declared batch cannot.
    ], 'extraction', a, true).state;

  /**
   * The bots were written for a harness where nobody signs anything, so none
   * of them reads `state.treaties`. Turned loose on a live campaign that lets
   * a power's own doctrine tear up paper it signed the same turn, costing 25
   * disposition and a reputation hit with every onlooker.
   */
  it('will not attack a power it has a non-aggression pact with', () => {
    // Find a turn where the Vigil proposes an attack, then forbid that target.
    let s = seed();
    let attack: Record<string, unknown> | undefined;
    for (let t = 0; t < 12 && !attack; t++) {
      const p = proposeFor(s, 'vigil');
      attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) break;
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
    expect(attack, 'the Vigil never proposed an attack in 12 turns').toBeDefined();

    const victim = s.systems.find((x) => x.id === attack!.targetId)!.controllerFactionId!;
    const bound = pactBetween(s, 'vigil', victim, 'non_aggression');
    expect(bound.treaties).toHaveLength(1);

    const after = proposeFor(bound, 'vigil');
    const stillAttacks = (after?.ops ?? []).some(
      (o) => o.op === 'issue_order' && o.type === 'fleet_movement' && o.targetId === attack!.targetId,
    );
    expect(stillAttacks).toBe(false);
    expect(after?.withheld.join(' ') ?? '').toMatch(/pact/);
  });

  it('reports what it withheld rather than dropping it silently', () => {
    // A withheld act must be legible: a power that quietly does less than its
    // doctrine demands is the bug this whole module exists to fix.
    let s = seed();
    for (let t = 0; t < 12; t++) {
      const p = proposeFor(s, 'vigil');
      const attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) {
        const victim = s.systems.find((x) => x.id === attack.targetId)!.controllerFactionId!;
        const bound = pactBetween(s, 'vigil', victim, 'ceasefire');
        const after = proposeFor(bound, 'vigil');
        if (after) expect(after.withheld.length).toBeGreaterThan(0);
        return;
      }
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
  });

  /**
   * Standing was invisible to every bot: a power that loathed you at −95 with
   * no paper between you picked its targets exactly as one that liked you at
   * +50 did. `honourTreaties` was the only relationship any of them consulted,
   * which made paper the sole restraint.
   *
   * The gate is deliberately an **invariant** rather than a behaviour change,
   * and it is measured as one: it withholds nothing across 30 harness turns and
   * on all 24 played boards in `saves/`, because the bots rarely attack a held
   * world and the one that does dislikes its target. So it has to be pinned on
   * a board built to reach it, or it would be a mechanic nobody has ever seen
   * fire — the failure this repo keeps catching.
   */
  it('will not attack a power it is on good terms with, pact or no pact', () => {
    let s = seed();
    let attack: Record<string, unknown> | undefined;
    for (let t = 0; t < 12 && !attack; t++) {
      const p = proposeFor(s, 'vigil');
      attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) break;
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
    expect(attack, 'the Vigil never proposed an attack in 12 turns').toBeDefined();

    // No treaty at all — only an opinion, and held about EVERY power, both
    // ways. Warming one rival only proves the weighting redirected the fleet to
    // another; warming all of them is what leaves the gate as the sole thing
    // that can refuse the attack. Both directions, because `warsFor` is
    // bilateral and a war would bypass the gate by design.
    const ops = [];
    for (const other of s.factions) {
      if (other.id === 'vigil') continue;
      ops.push(
        { op: 'adjust_disposition', factionId: 'vigil', towardFactionId: other.id, delta: 200 },
        { op: 'adjust_disposition', factionId: other.id, towardFactionId: 'vigil', delta: 200 },
      );
    }
    const warm = applyOps(s, ops, 'engine').state;
    const after = proposeFor(warm, 'vigil');

    // Unaligned ground is not gated — there is nobody there to have offended —
    // so what must be gone is every attack on a world another power HOLDS.
    const onAPower = (after?.ops ?? []).filter((o) => {
      if (o.op !== 'issue_order' || o.type !== 'fleet_movement') return false;
      const holder = warm.systems.find((x) => x.id === o.targetId)?.controllerFactionId;
      return !!holder && holder !== 'vigil';
    });
    expect(onAPower).toHaveLength(0);
    expect(after?.withheld.join(' ') ?? '').toMatch(/quarrel/);
  });

  it('still answers a power it is at war with, whatever it thinks of them', () => {
    // `warsFor` is checked first and is BILATERAL, so a power that has been
    // attacked may answer regardless of its own opinion a moment ago. Without
    // that, the gate would forbid exactly the retaliation it should permit.
    let s = seed();
    for (let t = 0; t < 12; t++) {
      const p = proposeFor(s, 'vigil');
      const attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) {
        const victim = s.systems.find((x) => x.id === attack.targetId)!.controllerFactionId!;
        // The Vigil thinks well of EVERYONE, and one of them is at war with it
        // anyway. So the gate forbids every held world except that power's, and
        // what the Vigil reaches for is the assertion. Warming only the victim
        // would prove nothing: the grievance weighting would simply send the
        // fleet at somebody else.
        const ops = [];
        for (const other of s.factions) {
          if (other.id === 'vigil') continue;
          ops.push(
            { op: 'adjust_disposition', factionId: 'vigil', towardFactionId: other.id, delta: 200 },
            { op: 'adjust_disposition', factionId: other.id, towardFactionId: 'vigil', delta: 200 },
          );
        }
        // …and then one of them declares for war, one-sidedly. `warsFor` is
        // bilateral, so that is enough.
        ops.push({ op: 'adjust_disposition', factionId: victim, towardFactionId: 'vigil', delta: -200 });
        const atWar = applyOps(s, ops, 'engine').state;

        const after = proposeFor(atWar, 'vigil');
        const onAPower = (after?.ops ?? []).filter((o) => {
          if (o.op !== 'issue_order' || o.type !== 'fleet_movement') return false;
          const holder = atWar.systems.find((x) => x.id === o.targetId)?.controllerFactionId;
          return !!holder && holder !== 'vigil';
        });
        // It may mass rather than sail this turn; what it must never do is
        // attack one of the four powers it has no quarrel with.
        for (const op of onAPower) {
          const holder = atWar.systems.find((x) => x.id === op.targetId)!.controllerFactionId;
          expect(holder, 'attacked a power it is not at war with').toBe(victim);
        }
        expect(warsFor(atWar, 'vigil')).toEqual([victim]);
        return;
      }
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
    throw new Error('the Vigil never proposed an attack in 12 turns');
  });
});

describe('standing chooses between two prizes', () => {
  /**
   * The part of 98 that actually moves the board. `strategicValue` alone was
   * the whole of target selection, tie-broken on system id — so the Vigil,
   * whose doctrine is "answer insolence with force", was indifferent to who was
   * standing on the world it wanted.
   *
   * A thumb on the scale and not the scale: `GRIEVANCE_WEIGHT` is 4 against a
   * `strategicValue` of 0-10, so a grievance reorders comparable prizes and
   * cannot make a worthless world a war aim. Swept over played 30-turn runs —
   * 0-2 leaves the historical 3/6/5/4/4, 3-6 is a flat region at 4/6/5/4/4, and
   * at 10 grievance swamps prize and Drajk loses a world it otherwise keeps.
   */
  const at = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

  it('ranks a resented holder above a tolerated one at equal value', () => {
    const s = seed();
    const rival = s.systems.find(
      (x) => x.controllerFactionId && x.controllerFactionId !== 'vigil',
    )!;
    const holder = rival.controllerFactionId!;

    const opinion = (delta: number) =>
      applyOps(
        s,
        [{ op: 'adjust_disposition', factionId: 'vigil', towardFactionId: holder, delta }],
        'engine',
      ).state;

    const resented = opinion(-200);
    const tolerated = opinion(200);
    expect(targetPriority(resented, 'vigil', at(resented, rival.id))).toBeGreaterThan(
      targetPriority(tolerated, 'vigil', at(tolerated, rival.id)),
    );
  });

  it('cannot let a grievance outweigh what a world is worth by more than the cap', () => {
    // The bound is the whole design: `opportunist` hits the weak and
    // `crusading` hits regardless, and a grievance large enough to dominate
    // `strategicValue` would flatten both into "attack whoever you hate most".
    const s = seed();
    const rival = s.systems.find(
      (x) => x.controllerFactionId && x.controllerFactionId !== 'vigil',
    )!;
    const worst = applyOps(
      s,
      [
        {
          op: 'adjust_disposition',
          factionId: 'vigil',
          towardFactionId: rival.controllerFactionId!,
          delta: -200,
        },
      ],
      'engine',
    ).state;
    const bumped = targetPriority(worst, 'vigil', at(worst, rival.id)) - rival.strategicValue;
    expect(bumped).toBeCloseTo(GRIEVANCE_WEIGHT);
    expect(bumped).toBeLessThan(10);
  });

  it('scores unaligned ground on its prize alone — nobody there has offended you', () => {
    const s = seed();
    const neutral = s.systems.find((x) => x.controllerFactionId === null)!;
    expect(targetPriority(s, 'vigil', neutral)).toBe(neutral.strategicValue);
    // And a power's own world carries no grievance against itself.
    const mine = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    expect(targetPriority(s, 'vigil', mine)).toBe(mine.strategicValue);
  });
});

describe('initiative is fog-clean', () => {
  it('proposes the same thing whether or not a rival has hidden work under way', () => {
    const plain = seed();
    const withSecret = applyOps(seed(), [
      {
        op: 'issue_order',
        factionId: 'ojjul',
        type: 'capital_ship_construction',
        originId: 'ilv-2',
        targetId: 'ilv-2',
        durationTurns: 3,
        label: 'a secret slipway',
        visibility: [],
      },
    ], 'model').state;

    for (const id of ['meridian', 'vigil', 'freeworlds', 'drajk']) {
      expect(
        JSON.stringify(proposeFor(withSecret, id)?.ops ?? null),
        `${id} reacted to work it cannot see`,
      ).toBe(JSON.stringify(proposeFor(plain, id)?.ops ?? null));
    }
  });
});

describe('the proposal itself', () => {
  it('returns null rather than manufacturing an opportunity', () => {
    // A faction with no fleet, no money and nothing adjacent has nothing to do.
    const s = seed();
    for (const sys of s.systems) setShipsAt(sys, 'freeworlds', 0);
    s.factions.find((f) => f.id === 'freeworlds')!.credits = 0;
    const p = proposeFor(s, 'freeworlds');
    expect(p === null || p.ops.length > 0).toBe(true);
  });

  it('carries a third-person account of what it did', () => {
    const p = proposeFor(seed(), 'vigil');
    expect(p!.rationale).toMatch(/Iron Vigil/);
    expect(p!.rationale.endsWith('.')).toBe(true);
  });

  it('is deterministic, so a bot-driven turn replays exactly', () => {
    const a = proposeFor(seed(), 'drajk');
    const b = proposeFor(seed(), 'drajk');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/**
 * The bots judge strength by the battle line, not by the hull count.
 *
 * Every threshold in `initiative.ts` is a hull count calibrated when a hull was
 * a battleship and nothing else. A lifter is a whole hull for three quarters of
 * a battleship's price, so counting transports among them makes a fleet cross
 * its own thresholds faster the more lift it buys — which is a bug in the
 * bots' units, not a doctrine. Measured before the fix: the Vigil, which buys
 * hardest, went from six systems to ten and reduced Meridian to one world.
 */
describe('lift is carried, not counted as strength', () => {
  it('does not let transports talk a bot into an attack its line cannot make', () => {
    const withLift = (lifters: number) => {
      const s = createSeedState('freeworlds');
      // A staging world next to a target, held well short of what the bot
      // needs, then padded out with transports.
      const staging = s.systems.find((x) => x.id === 'tor-3')!;
      setShipsAt(staging, 'vigil', 6);
      if (lifters > 0) addShipsAt(staging, 'vigil', lifters, 'lifter');
      return (proposeFor(s, 'vigil')?.ops ?? []).some(
        (op: Record<string, unknown>) =>
          op.op === 'issue_order' && op.type === 'fleet_movement',
      );
    };
    // Whatever the answer is with no lift, adding forty transports must not
    // change it: they are cargo, not combat power.
    expect(withLift(40)).toBe(withLift(0));
  });

  it('sails with enough lift to hold what it takes, or does not sail', () => {
    const s = createSeedState('freeworlds');
    // Every bot, and every world it proposes to attack.
    for (const me of ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk']) {
      const ops = ((proposeFor(s, me)?.ops ?? []) as Record<string, unknown>[]).filter(
        (op) => op.op === 'issue_order' && op.type === 'fleet_movement',
      ) as unknown as { force: ShipStack; targetId: string }[];
      for (const op of ops) {
        const target = s.systems.find((x) => x.id === op.targetId)!;
        if (target.controllerFactionId === me || target.garrison <= 0) continue;
        // Troops aboard beat the garrison it is being sent against.
        expect(
          carryOf(op.force),
          `${me}'s sortie at ${op.targetId} cannot beat a garrison of ${target.garrison}`,
        ).toBeGreaterThan(target.garrison);
      }
    }
  });
});

/**
 * Every class has an owner in the harness, the way every ethic does.
 *
 * A class nobody builds is a class nobody has measured — the same failure as a
 * `tradeEthic` held by nobody, which is how `monopolist` stayed implemented,
 * tested and dead for the life of the project.
 */
describe('the bots field composed navies', () => {
  const played = (turns: number): WorldState => {
    let s = createSeedState('freeworlds');
    for (let t = 0; t < turns; t++) {
      for (const id of ['freeworlds', 'ojjul', 'drajk', 'meridian', 'vigil']) {
        const ops = proposeFor(s, id)?.ops ?? [];
        if (ops.length > 0) s = applyOps(s, ops as never[], 'model', id).state;
      }
      s = tickTurn(s).state;
    }
    return s;
  };

  it('puts every hull class on the board within a short run', () => {
    const end = played(12);
    const seen = new Set<string>();
    for (const sys of end.systems) {
      for (const stack of Object.values(sys.ships)) {
        for (const [hull, n] of Object.entries(stack)) if ((n ?? 0) > 0) seen.add(hull);
      }
    }
    expect([...seen].sort()).toEqual([...HULL_CLASSES].sort());
  });

  it('gives the Confederacy boats rather than a battle line it could not win with', () => {
    const end = played(12);
    const boats = end.systems.reduce((n, s) => n + (stackAt(s, 'drajk').torpedo_boat ?? 0), 0);
    expect(boats).toBeGreaterThan(0);
  });

  it('keeps a screen over the convoy for the powers that mount landings', () => {
    const end = played(12);
    for (const id of ['meridian', 'vigil', 'ojjul']) {
      const lift = end.systems.reduce((n, s) => n + (stackAt(s, id).lifter ?? 0), 0);
      const screen = end.systems.reduce((n, s) => n + (stackAt(s, id).escort ?? 0), 0);
      if (lift > 0) expect(screen, `${id} sails its convoy unescorted`).toBeGreaterThan(0);
    }
  });
});

/**
 * The seed's grievances, checked against the seed's own geography.
 *
 * `BOT_AGGRESSION_CEILING` and `GRIEVANCE_WEIGHT` both key on a HOLDER, so
 * every one of their readers asks "whose world is this and what do I think of
 * them" — and a grievance against a power whose worlds you cannot reach is a
 * number nothing will ever consult. The seed shipped its two deepest
 * antagonisms in exactly that position: the Vigil and the Free Worlds at
 * −60/−75 with no lane between them anywhere on the map, and Meridian and the
 * Confederacy at −55/−40, likewise. A war neither party can prosecute is the
 * thing `initiative.ts` exists to stop being the normal case.
 *
 * These are assertions about the SEED, not about the mechanics, and they are
 * here rather than in a scenario test because the mechanics are what make them
 * matter. Both hold whatever the numbers are tuned to.
 */
describe('the seed seats its grievances where they can be acted on', () => {
  const seed = () => createSeedState('meridian');

  /** Pairs with at least one hyperlane between worlds they each hold at turn 0. */
  const bordering = (s: WorldState): Set<string> => {
    const held = new Map(s.systems.map((x) => [x.id, x.controllerFactionId]));
    const out = new Set<string>();
    for (const sys of s.systems) {
      const a = held.get(sys.id);
      if (!a) continue;
      for (const e of sys.hyperlaneEdges) {
        const b = held.get(e);
        if (!b || b === a) continue;
        out.add([a, b].sort().join('|'));
      }
    }
    return out;
  };

  it('does not open a war between powers who share no border', () => {
    // `warsFor` is symmetric and reads either direction past
    // WAR_DISPOSITION_THRESHOLD, so this is every seeded war on the board.
    const s = seed();
    const borders = bordering(s);
    for (const f of s.factions) {
      for (const enemy of warsFor(s, f.id)) {
        const pair = [f.id, enemy].sort().join('|');
        expect(borders.has(pair), `${pair} is at war and shares no lane`).toBe(true);
      }
    }
  });

  it('puts its worst standing on a pair that can reach each other', () => {
    // Weaker than the rule above and worth pinning separately: it is possible
    // for every WAR to border while the single deepest grievance on the board
    // still sits between two powers three sectors apart, which is the state
    // this seed was actually in.
    const s = seed();
    const borders = bordering(s);
    let worst = { pair: '', at: 1 };
    for (const f of s.factions) {
      for (const [other, n] of Object.entries(f.disposition)) {
        if (n < worst.at) worst = { pair: [f.id, other].sort().join('|'), at: n };
      }
    }
    expect(borders.has(worst.pair), `deepest grievance ${worst.pair} (${worst.at})`).toBe(true);
  });

  it('leaves the map’s richest contested border short of war, but not friendly', () => {
    // Oridin and Vantic are the two highest-value worlds either power holds and
    // there is one lane between them. A pair that borders at the best ground on
    // the board and likes each other is a border nothing will ever happen at;
    // a pair already at war there has spent the escalation before turn 1.
    const s = seed();
    for (const [a, b] of [['ojjul', 'vigil'], ['vigil', 'ojjul']] as const) {
      const n = s.factions.find((f) => f.id === a)!.disposition[b]!;
      expect(n, `${a} -> ${b}`).toBeLessThan(0);
      expect(n, `${a} -> ${b}`).toBeGreaterThan(-60);
    }
  });

  it('keeps the Combine and the Confederacy on terms, which is Drajk’s fuse', () => {
    // Drajk borders three powers and is the weakest on the board, and its own
    // raiding bleeds all three opinions of it every turn it takes a prize. How
    // long it lasts is how long the standing gate stays shut on its neighbours,
    // so an opening grievance here is worth several turns of its life.
    const s = seed();
    expect(s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']).toBeGreaterThan(0);
    expect(s.factions.find((f) => f.id === 'drajk')!.disposition['ojjul']).toBeGreaterThan(0);
  });
});
