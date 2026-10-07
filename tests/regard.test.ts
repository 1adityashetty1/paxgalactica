import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import {
  BATTLE_REGARD,
  CONQUEST_REGARD,
  CONTENT_REGARD,
  ENVOY_PER_POINT,
  HOME_REGARD,
  JOIN_REGARD,
  OCCUPIED_HOME_REGARD,
  RIM_WATCHES_REGARD,
  SECESSION_REGARD,
  WANT_ONCE_REGARD,
  WANT_REGARD,
  accrueRegard,
  baselineRegard,
  holdAt,
  holdingFactor,
  joinsWhom,
  regardFor,
  regardRecorded,
  wantOf,
} from '../src/domain/regard.js';
import { eligibleRimEvents } from '../src/domain/pulse.js';
import { proposeFor, holdable } from '../src/domain/initiative.js';
import { statModifier } from '../src/domain/checks.js';
import { addShipsAt, effectiveStats, setShipsAt, type StarSystem, type WorldState } from '../src/domain/state.js';
import type { BattleReport } from '../src/domain/battle.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * A world's regard for each power — its standing — and what it decides: whom
 * an independent world joins, and whether a held one stays (journal version 17).
 */
const calm: LegacyRules = { randomEvents: false };
const sys = (s: WorldState, id: string): StarSystem => s.systems.find((x) => x.id === id)!;
const tick = (s: WorldState, legacy: LegacyRules = {}) => tickTurn(s, { ...calm, ...legacy });
const ids = (s: WorldState) => s.factions.map((f) => f.id);
/** Sets one world's regard for one power, leaving the rest. */
const set = (s: WorldState, id: string, faction: string, n: number) => {
  sys(s, id).regard = { ...sys(s, id).regard, [faction]: n };
};

describe('the opening board', () => {
  it('home ground loves its own power and every world is indifferent to the rest', () => {
    const s = createSeedState('meridian');
    expect(regardRecorded(s)).toBe(true);
    expect(sys(s, 'sek-1').regard).toEqual({ meridian: HOME_REGARD, vigil: 0, ojjul: 0, freeworlds: 0, drajk: 0 });
    // Unaligned: nobody's, so nobody's yet.
    expect(Object.values(sys(s, 'sek-6').regard).every((n) => n === 0)).toBe(true);
    // Key order is faction order, so a replay rebuilds the same bytes.
    expect(Object.keys(sys(s, 'ilv-2').regard)).toEqual(ids(s));
  });

  it('keeps nothing for a board from before version 17, and the tick moves nothing', () => {
    const s = createSeedState('meridian', { regard: false });
    expect(regardRecorded(s)).toBe(false);
    const after = tick(s);
    expect(after.state.systems.every((x) => Object.keys(x.regard).length === 0)).toBe(true);
    expect(after.report.worlds).toBeUndefined();
  });

  it('reads each want off the ground', () => {
    const s = createSeedState('meridian');
    expect(wantOf(sys(s, 'sek-3'))).toBe('arms'); // arid
    expect(wantOf(sys(s, 'sek-6'))).toBe('development'); // gas giant
    expect(wantOf(sys(s, 'ark-2'))).toBe('protection'); // ice
    expect(wantOf(sys(s, 'sek-1'))).toBe('trade'); // earthnight
    expect(wantOf(sys(s, 'sek-4'))).toBe('peace'); // earthlike
  });
});

describe('drift', () => {
  it('a home world drifts back toward its own power, a tenth of the gap a turn', () => {
    const s = createSeedState('meridian');
    set(s, 'sek-2', 'meridian', 0);
    // Meridian's freighters and warships could meet Corvid's want; clear them so
    // this measures the drift alone.
    sys(s, 'sek-2').ships = {};
    const after = tick(s).state;
    expect(regardFor(sys(after, 'sek-2'), 'meridian')).toBe(Math.ceil(HOME_REGARD / 10));
  });

  it("someone else's home settles at a grudge toward whoever holds it", () => {
    const s = createSeedState('meridian');
    const w = sys(s, 'tor-1');
    w.controllerFactionId = 'vigil';
    expect(baselineRegard(w, 'vigil')).toBe(OCCUPIED_HOME_REGARD);
    expect(baselineRegard(w, 'meridian')).toBe(HOME_REGARD);
  });
});

describe('content, or held down', () => {
  it('a content world needs nothing', () => {
    const s = createSeedState('meridian');
    const h = holdAt(s, sys(s, 'sek-1'))!;
    expect(h.content).toBe(true);
    expect(h.need).toBe(0);
  });

  it('needs value times how far short of content it is, over a hundred', () => {
    const s = createSeedState('meridian');
    const w = sys(s, 'sek-3'); // Ithaal, value 5
    w.controllerFactionId = 'meridian';
    set(s, 'sek-3', 'meridian', CONQUEST_REGARD);
    expect(holdAt(s, w)!.need).toBeCloseTo((5 * (CONTENT_REGARD - CONQUEST_REGARD)) / 100);
  });

  it('a resolute holder holds down more with each warship', () => {
    const s = createSeedState('meridian');
    expect(holdingFactor(s, 'vigil')).toBe(1 + statModifier(effectiveStats(s, 'vigil', { dissent: false }).resolve) * 0.125);
    expect(holdingFactor(s, 'vigil')).toBeGreaterThan(holdingFactor(s, 'meridian'));
  });

  it('reads resolve before dissent, so a restive Vigil is not the worst jailer on the board', () => {
    const s = createSeedState('meridian');
    const calmFactor = holdingFactor(s, 'vigil');
    s.factions.find((f) => f.id === 'vigil')!.dissent = 100;
    expect(holdingFactor(s, 'vigil')).toBe(calmFactor);
  });
});

/** Ithaal held by Meridian against its will, with nothing over it. */
function resentful(garrison: number): WorldState {
  const s = createSeedState('meridian');
  const w = sys(s, 'sek-3');
  w.controllerFactionId = 'meridian';
  w.garrison = garrison;
  set(s, 'sek-3', 'meridian', CONQUEST_REGARD);
  return s;
}

describe('rising', () => {
  it('a world neither content nor held down loses garrison by the shortfall, and does not regrow', () => {
    const s = resentful(5);
    const after = tick(s);
    const w = sys(after.state, 'sek-3');
    expect(w.garrison).toBeLessThan(5);
    expect(after.report.worlds!.restless.map((r) => r.systemId)).toEqual(['sek-3']);
  });

  it('held down by enough warships, it stays quiet', () => {
    const s = resentful(5);
    addShipsAt(sys(s, 'sek-3'), 'meridian', 6, 'battleship');
    const after = tick(s);
    expect(after.report.worlds!.restless).toEqual([]);
    expect(sys(after.state, 'sek-3').controllerFactionId).toBe('meridian');
  });

  it('with its last troops gone it answers to nobody, its holder’s ships go home, and it thinks the worse of it', () => {
    const s = resentful(1);
    addShipsAt(sys(s, 'sek-3'), 'meridian', 1, 'escort');
    const after = tick(s);
    const w = sys(after.state, 'sek-3');
    expect(w.controllerFactionId).toBeNull();
    expect(w.garrison).toBeGreaterThan(0); // the rising is its militia
    expect(w.ships.meridian).toBeUndefined();
    expect(regardFor(w, 'meridian')).toBeLessThanOrEqual(CONQUEST_REGARD - SECESSION_REGARD + 10);
    expect(after.report.worlds!.rose).toEqual([{ systemId: 'sek-3', factionId: 'meridian' }]);
  });

  it('the Rim’s unrest can strike any world not content, not only conquered homes', () => {
    const s = resentful(5);
    const unrest = eligibleRimEvents(s).find((e) => e.kind === 'unrest');
    expect(unrest?.candidates.some((c) => (c.plan as { systemId: string }).systemId === 'sek-3')).toBe(true);
  });
});

describe('joining', () => {
  it('an independent world joins the power it regards well enough, and clear of the next', () => {
    const s = createSeedState('meridian');
    // Clear of the line by more than a turn's drift, since the tick fades
    // regard before it asks whom a world will join.
    set(s, 'sek-6', 'ojjul', JOIN_REGARD + 15);
    set(s, 'sek-6', 'meridian', JOIN_REGARD - 20);
    expect(joinsWhom(sys(s, 'sek-6'), ids(s))).toBe('ojjul');
    const after = tick(s);
    expect(sys(after.state, 'sek-6').controllerFactionId).toBe('ojjul');
    expect(sys(after.state, 'sek-6').garrison).toBe(sys(s, 'sek-6').garrison);
    expect(after.report.worlds!.joined).toEqual([{ systemId: 'sek-6', factionId: 'ojjul' }]);
  });

  it('two suitors level with each other get nobody', () => {
    const s = createSeedState('meridian');
    set(s, 'sek-6', 'ojjul', 90);
    set(s, 'sek-6', 'meridian', 80);
    expect(joinsWhom(sys(s, 'sek-6'), ids(s))).toBeNull();
  });
});

describe('what moves it', () => {
  it('protection: warships over a world that wants it, with no raid on it', () => {
    const s = createSeedState('meridian');
    addShipsAt(sys(s, 'ark-2'), 'meridian', 2, 'battleship'); // Sennex, ice
    const after = tick(s).state;
    expect(regardFor(sys(after, 'ark-2'), 'meridian')).toBe(WANT_REGARD);
    expect(regardFor(sys(after, 'ark-2'), 'freeworlds')).toBe(0);
  });

  it('development: a programme of the kind it asked for, once', () => {
    const s = createSeedState('meridian');
    const w = sys(s, 'sek-6'); // Neth, gas giant
    addShipsAt(w, 'ojjul', 1, 'escort');
    accrueRegard(s, { battles: [], landed: [{ systemId: 'sek-6', factionId: 'ojjul', kind: 'develop_system' }] });
    expect(regardFor(w, 'ojjul')).toBe(WANT_ONCE_REGARD);
    // A fortification is not what a gas giant asked for.
    accrueRegard(s, { battles: [], landed: [{ systemId: 'sek-6', factionId: 'meridian', kind: 'fortify' }] });
    expect(regardFor(w, 'meridian')).toBe(0);
  });

  it('a conquest leaves its conqueror hated, the rest of the Rim watching, and a liberation does not', () => {
    const s = createSeedState('meridian');
    sys(s, 'sek-6').controllerFactionId = 'drajk';
    const report = (systemId: string, before: string | null, after: string): BattleReport => ({
      id: `${systemId}:1`, systemId, systemName: systemId, turn: 1, roll: 10, attackMod: 0, defendMod: 0,
      doctrinesFired: [], commandersFired: [], officers: [], holderBefore: before, holderAfter: after,
      garrisonBefore: 4, garrisonAfter: 4, status: 'resolved', note: '',
      rounds: [{
        turn: 1, phase: 'ground', outcome: 'captured' as never, attackPower: 0, defendPower: 0,
        assault: 10, garrison: 4, garrisonEffective: 4,
        attackers: [{ factionId: after, factionName: after, before: 4, after: 4, stackBefore: {}, stackAfter: {} }],
        defenders: [], note: '',
      }],
    });
    accrueRegard(s, { battles: [report('sek-6', null, 'drajk')], landed: [] });
    expect(regardFor(sys(s, 'sek-6'), 'drajk')).toBe(CONQUEST_REGARD);
    expect(regardFor(sys(s, 'ark-2'), 'drajk')).toBe(-RIM_WATCHES_REGARD);
    // Meridian taking back its own Torrek Anchorage is not a conquest of it.
    sys(s, 'tor-1').controllerFactionId = 'meridian';
    accrueRegard(s, { battles: [report('tor-1', 'vigil', 'meridian')], landed: [] });
    expect(regardFor(sys(s, 'tor-1'), 'meridian')).toBeGreaterThan(HOME_REGARD - BATTLE_REGARD - 10);
  });

  it('a raid sours the world it is run on toward the raider, and a dark one names nobody', () => {
    const s = createSeedState('meridian');
    addShipsAt(sys(s, 'sek-6'), 'drajk', 4, 'battleship');
    const open = applyOps(s, [{ op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding', originId: 'sek-6', targetId: 'sek-6', durationTurns: 3, label: 'raid' } as OpInput], 'model', 'drajk').state;
    open.pendingOrders.at(-1)!.progress = 1;
    accrueRegard(open, { battles: [], landed: [] });
    expect(regardFor(sys(open, 'sek-6'), 'drajk')).toBeLessThan(0);
    const dark = applyOps(s, [{ op: 'issue_order', factionId: 'drajk', type: 'commerce_raiding', originId: 'sek-6', targetId: 'sek-6', durationTurns: 3, label: 'raid', dark: true } as OpInput], 'model', 'drajk').state;
    dark.pendingOrders.at(-1)!.progress = 1;
    accrueRegard(dark, { battles: [], landed: [] });
    expect(regardFor(sys(dark, 'sek-6'), 'drajk')).toBe(0);
  });
});

describe('the envoy', () => {
  const envoy = (to: string, by: string, magnitude = 2): OpInput =>
    ({
      op: 'issue_order', factionId: by, type: 'political_maneuver', originId: to, targetId: to,
      durationTurns: 1, label: `an envoy to ${to}`, onComplete: { kind: 'court', magnitude },
    }) as OpInput;

  it('lands on an independent world in reach, worth five a point and the sender’s influence', () => {
    const s = createSeedState('meridian');
    const out = applyOps(s, [envoy('sek-6', 'meridian')], 'model', 'meridian');
    expect(out.rejections).toEqual([]);
    const after = tick(out.state).state;
    const worth = 2 * ENVOY_PER_POINT + statModifier(effectiveStats(s, 'meridian').influence);
    expect(regardFor(sys(after, 'sek-6'), 'meridian')).toBe(worth);
  });

  it('goes to nobody else’s world, and needs something of yours nearby', () => {
    const s = createSeedState('meridian');
    expect(applyOps(s, [envoy('ilv-2', 'meridian')], 'model', 'meridian').rejections[0]?.code).toBe('no_presence');
    // The Vigil holds nothing next to Neth.
    expect(applyOps(s, [envoy('sek-6', 'vigil')], 'model', 'vigil').rejections[0]?.code).toBe('no_presence');
  });

  it('is refused where worlds keep no regard', () => {
    const s = createSeedState('meridian', { regard: false });
    expect(applyOps(s, [envoy('sek-6', 'meridian')], 'model', 'meridian').rejections[0]?.code).toBe('no_presence');
  });
});

describe('the bots', () => {
  it('a courting power sends an envoy to an independent world it borders, and does not storm it', () => {
    const s = createSeedState('freeworlds');
    const ops = (proposeFor(s, 'meridian')?.ops ?? []) as Record<string, unknown>[];
    expect(ops.some((o) => o.type === 'political_maneuver' && (o.onComplete as { kind: string }).kind === 'court')).toBe(true);
    const storming = ops.filter(
      (o) => o.type === 'fleet_movement' && ((o.force as Record<string, number>)?.lifter ?? 0) > 0,
    );
    expect(storming.map((o) => o.targetId)).not.toContain('sek-3');
  });

  it('masses warships onto a world that is about to rise', () => {
    const s = createSeedState('freeworlds');
    const w = sys(s, 'sek-3');
    w.controllerFactionId = 'meridian';
    set(s, 'sek-3', 'meridian', CONQUEST_REGARD);
    setShipsAt(w, 'meridian', 0);
    const ops = (proposeFor(s, 'meridian')?.ops ?? []) as Record<string, unknown>[];
    expect(ops.some((o) => o.op === 'adjust_ships' && o.systemId === 'sek-3' && (o.delta as number) > 0)).toBe(true);
  });

  it('does not storm a world that hates it past what the storming fleet could hold', () => {
    const s = createSeedState('freeworlds');
    // Neth: nobody in orbit, so the storming fleet is the smallest sortie.
    const w = sys(s, 'sek-6');
    expect(holdable(s, 'vigil', w)).toBe(true);
    set(s, 'sek-6', 'vigil', -100);
    w.strategicValue = 10;
    expect(holdable(s, 'vigil', w)).toBe(false);
  });
});
