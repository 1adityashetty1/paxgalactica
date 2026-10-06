import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { AgentSchema, type Agent } from '../src/domain/diplomacy.js';
import { observeOrders, rememberedBy, worldAsSeenBy } from '../src/domain/intel.js';
import {
  INTEL_COUNTER_SWEEP,
  INTEL_FADE,
  INTEL_DELIVERS,
  INTEL_MEMORY_TURNS,
  INTEL_OPERATIVES,
  INTEL_PER_LISTENER_IN_RANGE,
  INTEL_PER_LISTENER_OVER,
  INTEL_PER_WATCHER,
  INTEL_TYPED,
  intelOn,
} from '../src/domain/intel-levels.js';
import { proposeFor } from '../src/domain/initiative.js';
import { buildAdjacency } from '../src/domain/graph.js';
import { addShipsAt, agentsVisibleTo, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Intel with memory (journal version 16): what a power saw it keeps, and how
 * well it knows each rival builds up from watchers, listeners, trade and war.
 */
const calm = (legacy: LegacyRules = {}) => ({ randomEvents: false, ...legacy });
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const fac = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!;
const tick = (s: WorldState, legacy: LegacyRules = {}) => tickTurn(s, calm(legacy)).state;
/** One turn of a level: it fades in proportion, then gains. */
const step = (level: number, gain: number) => Math.max(0, level - Math.ceil(level * INTEL_FADE) + gain);

/** The Vigil refitting at Vantic: secret yard work, seen only from close by. */
function refitting(): { state: WorldState; orderId: string } {
  const s = createSeedState('meridian');
  const out = applyOps(
    s,
    [{ op: 'issue_order', factionId: 'vigil', type: 'refit', originId: 'tor-3', targetId: 'tor-3', durationTurns: 5, label: 'refit the line' } as OpInput],
    'model',
    'vigil',
  );
  expect(out.rejections).toEqual([]);
  return { state: out.state, orderId: out.state.pendingOrders.at(-1)!.id };
}

const watcher = (over: Partial<Agent>): Agent =>
  AgentSchema.parse({
    id: 'agt-w', ownerFactionId: 'meridian', systemId: 'tor-2', mission: 'surveillance',
    effect: { kind: 'intel', revealsOrders: true }, successChance: 95, deployedTurn: 0, name: 'A Clerk',
    ...over,
  });

describe('memory', () => {
  it('keeps what it saw when the sight is lost, and the rumour becomes the remembered row', () => {
    const { state, orderId } = refitting();
    addShipsAt(sys(state, 'tor-3'), 'meridian', 1, 'escort');
    let s = tick(state);
    expect(observeOrders(s, 'meridian').orders.some((o) => o.id === orderId)).toBe(true);
    delete sys(s, 'tor-3').ships.meridian;
    s = tick(s);
    const row = rememberedBy(s, 'meridian');
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ label: 'refit the line', type: 'refit', systemId: 'tor-3', live: true, seenTurn: 1 });
    // Not also an anonymous rumour of the same work.
    expect(observeOrders(s, 'meridian').rumours.filter((r) => r.factionId === 'vigil' && r.systemId === 'tor-3')).toEqual([]);
    // And no id leaves for the browser.
    expect(JSON.stringify(row)).not.toContain(orderId);
  });

  it('keeps a row it did not see finish, until the memory runs out', () => {
    const { state } = refitting();
    addShipsAt(sys(state, 'tor-3'), 'meridian', 1, 'escort');
    let s = tick(state);
    delete sys(s, 'tor-3').ships.meridian;
    // Five turns of refit finish unseen; the row stays, no longer live.
    for (let i = 0; i < 5; i++) s = tick(s);
    expect(s.pendingOrders.some((o) => o.type === 'refit')).toBe(false);
    expect(rememberedBy(s, 'meridian')[0]).toMatchObject({ live: false });
    while (s.turn - 1 <= INTEL_MEMORY_TURNS) s = tick(s);
    expect(rememberedBy(s, 'meridian')).toEqual([]);
  });

  it('drops a row it watched finish', () => {
    const { state } = refitting();
    addShipsAt(sys(state, 'tor-3'), 'meridian', 1, 'escort');
    let s = state;
    for (let i = 0; i < 6; i++) s = tick(s);
    expect(s.pendingOrders.some((o) => o.type === 'refit')).toBe(false);
    expect(rememberedBy(s, 'meridian')).toEqual([]);
  });

  it('remembers nothing of a journal from before it', () => {
    const { state } = refitting();
    addShipsAt(sys(state, 'tor-3'), 'meridian', 1, 'escort');
    const s = tick(state, { intel: false });
    expect(s.sightings).toEqual([]);
  });
});

describe('intel levels', () => {
  it('a watcher on their ground builds it, and time wears it down', () => {
    const s = createSeedState('meridian');
    s.agents.push(watcher({}));
    const once = tick(s);
    expect(intelOn(once, 'meridian', 'vigil')).toBe(step(0, INTEL_PER_WATCHER));
    const twice = tick(once);
    expect(intelOn(twice, 'meridian', 'vigil')).toBe(step(step(0, INTEL_PER_WATCHER), INTEL_PER_WATCHER));
    // Recalled, it fades.
    twice.agents = twice.agents.filter((a) => a.id !== 'agt-w');
    expect(intelOn(tick(twice), 'meridian', 'vigil')).toBe(step(intelOn(twice, 'meridian', 'vigil'), 0));
  });

  it('settles where one source meets the fade, and it takes two to reach operatives', () => {
    let one = 0;
    let two = 0;
    for (let i = 0; i < 60; i++) {
      one = step(one, INTEL_PER_WATCHER);
      two = step(two, 2 * INTEL_PER_WATCHER);
    }
    expect(one).toBeGreaterThanOrEqual(INTEL_DELIVERS);
    expect(one).toBeLessThan(INTEL_OPERATIVES);
    expect(two).toBeGreaterThanOrEqual(80);
  });

  it('a listener over their world earns what a watcher earns; one within range, half', () => {
    const over = createSeedState('meridian');
    addShipsAt(sys(over, 'tor-2'), 'meridian', 1, 'listener');
    expect(intelOn(tick(over), 'meridian', 'vigil')).toBeGreaterThanOrEqual(INTEL_PER_LISTENER_OVER);

    // A post on Meridian's own Torrek Anchorage, one jump from Vigil ground.
    const near = createSeedState('meridian');
    const adj = buildAdjacency(near.systems);
    expect([...adj.get('tor-1')!].some((n) => sys(near, n).controllerFactionId === 'vigil')).toBe(true);
    addShipsAt(sys(near, 'tor-1'), 'meridian', 1, 'listener');
    expect(intelOn(tick(near), 'meridian', 'vigil')).toBe(INTEL_PER_LISTENER_IN_RANGE);
  });

  it('a counter-intelligence programme on their own ground wears it down', () => {
    const s = createSeedState('meridian');
    s.agents.push(watcher({}));
    const swept = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'vigil', type: 'counter_intelligence', originId: 'tor-2', targetId: 'tor-2', durationTurns: 3, label: 'sweep' } as OpInput],
      'model',
      'vigil',
    ).state;
    expect(intelOn(tick(swept), 'meridian', 'vigil')).toBe(INTEL_PER_WATCHER - INTEL_COUNTER_SWEEP);
  });

  it('is private: the served world carries only the viewer’s own', () => {
    const s = createSeedState('meridian');
    fac(s, 'vigil').intel = { meridian: 50 };
    fac(s, 'meridian').intel = { vigil: 30 };
    const seen = worldAsSeenBy(s, 'meridian');
    expect(fac(seen, 'vigil').intel).toEqual({});
    expect(fac(seen, 'meridian').intel).toEqual({ vigil: 30 });
    expect(seen.sightings).toEqual([]);
  });
});

describe('what knowing them buys', () => {
  it('rumours say what the work is, then what it will deliver', () => {
    const { state } = refitting();
    expect(observeOrders(state, 'meridian').rumours.find((r) => r.factionId === 'vigil')?.type).toBeUndefined();
    fac(state, 'meridian').intel = { vigil: INTEL_TYPED };
    const typed = observeOrders(state, 'meridian').rumours.find((r) => r.factionId === 'vigil')!;
    expect(typed.type).toBe('refit');
    expect(typed.delivers).toBeUndefined();
    fac(state, 'meridian').intel = { vigil: INTEL_DELIVERS };
    expect(observeOrders(state, 'meridian').rumours.find((r) => r.factionId === 'vigil')).toHaveProperty('delivers');
  });

  it('their operatives on your worlds show at sixty', () => {
    const s = createSeedState('meridian');
    const spy = watcher({ id: 'agt-v', ownerFactionId: 'vigil', systemId: 'sek-4' });
    s.agents.push(spy);
    expect(agentsVisibleTo(s, 'meridian').some((a) => a.id === 'agt-v')).toBe(false);
    fac(s, 'meridian').intel = { vigil: INTEL_OPERATIVES };
    expect(agentsVisibleTo(s, 'meridian').some((a) => a.id === 'agt-v')).toBe(true);
  });
});

describe('the bots', () => {
  it('sweep where they have just caught somebody', () => {
    const s = createSeedState('freeworlds');
    s.agents.push(
      watcher({ id: 'agt-c', ownerFactionId: 'vigil', systemId: 'sek-4', exposed: true, caughtTurn: s.turn }),
    );
    const ops = proposeFor(s, 'meridian')!.ops as { op: string; type?: string; targetId?: string }[];
    expect(ops.some((o) => o.type === 'counter_intelligence' && o.targetId === 'sek-4')).toBe(true);
  });
});
