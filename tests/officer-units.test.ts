import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  NAME_STOCK_FACTIONS,
  activeCommanders,
  drawPerson,
  familiesInUse,
  familyOf,
  resolveCommander,
  titlesFor,
} from '../src/domain/command.js';
import { hullsAt, setStackAt, type WorldState } from '../src/domain/state.js';
import { replay, type Journal } from '../src/engine/journal.js';
import { serializeState } from '../src/model/serialize.js';

/**
 * Item 122: an officer is a unit of the fleet — a zero-ton unit that sails,
 * shows and falls with the ships they stand beside — and is named by a family
 * name nobody else in the campaign carries.
 */

const fresh = (): WorldState => createSeedState('freeworlds');
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
const ours = (s: WorldState) => activeCommanders(s.commanders, 'freeworlds');

/** Sail from ark-3 to sek-6 (two jumps) and tick until the order is gone. */
function sail(s: WorldState, op: Record<string, unknown>) {
  const out = applyOps(
    s,
    [{ op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-3', targetId: 'sek-6', ...op }],
    'model',
    'freeworlds',
  );
  return out;
}

function arrive(s: WorldState) {
  let res = tickTurn(s);
  for (let i = 0; i < 6 && res.state.pendingOrders.some((o) => o.type === 'fleet_movement'); i++) {
    res = tickTurn(res.state);
  }
  return res;
}

/** Two officers of Arkane's standing at ark-3 beside five battleships. */
function twoAtPort(): WorldState {
  const s = fresh();
  s.factions.find((f) => f.id === 'freeworlds')!.credits = 100000;
  const hired = applyOps(
    s,
    [{ op: 'recruit_commander', factionId: 'freeworlds', systemId: 'ark-3' }],
    'model',
    'freeworlds',
  ).state;
  for (const c of ours(hired)) c.atSystemId = 'ark-3';
  setStackAt(sys(hired, 'ark-3'), 'freeworlds', { battleship: 5 });
  return hired;
}

describe('an officer sails the way a hull does', () => {
  it('goes with the whole port when no force is named', () => {
    const s = twoAtPort();
    expect(ours(s)).toHaveLength(2);
    const out = sail(s, {});
    expect(out.rejections).toHaveLength(0);
    expect(out.state.pendingOrders[0]!.officers.sort()).toEqual(ours(s).map((c) => c.id).sort());
    for (const c of ours(out.state)) expect(c.atSystemId).toBeNull();
  });

  it('takes only the officers it names when part of the port sails', () => {
    const s = twoAtPort();
    const [first, second] = ours(s);
    const out = sail(s, { force: { battleship: 3 }, officers: [second!.id] });
    expect(out.state.pendingOrders[0]!.officers).toEqual([second!.id]);
    expect(ours(out.state).find((c) => c.id === first!.id)!.atSystemId).toBe('ark-3');

    const none = sail(twoAtPort(), { force: { battleship: 3 } });
    expect(none.state.pendingOrders[0]!.officers).toEqual([]);
  });

  it('carries more than one, each named by family alone', () => {
    const s = twoAtPort();
    const families = ours(s).map((c) => familyOf(c.name)!);
    expect(new Set(families).size).toBe(2);
    const out = sail(s, { force: { battleship: 3 }, officers: families });
    expect(out.state.pendingOrders[0]!.officers).toHaveLength(2);
  });

  it('boards nobody on the old rules, where one officer an order was named or nobody was', () => {
    const s = twoAtPort();
    const out = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-3', targetId: 'sek-6' }],
      'model',
      'freeworlds',
      false,
      { officerUnits: false },
    );
    expect(out.state.pendingOrders[0]!.officers).toEqual([]);
  });
});

describe('an officer falls with the ships, not with a die', () => {
  it('is ashore on a world their power takes, even with every hull spent taking it', () => {
    // Two lifters against a garrison of four: one lost in the landing, the
    // other spent putting its troops down — the world is taken and nothing
    // Arkane sailed with is left in orbit. The officer landed with the troops.
    const s = fresh();
    const c = ours(s)[0]!;
    c.atSystemId = 'ark-3';
    const t = sys(s, 'sek-6');
    t.controllerFactionId = null;
    t.ships = {};
    t.garrison = 4;
    t.garrisonMax = 5;
    setStackAt(sys(s, 'ark-3'), 'freeworlds', { lifter: 2 });
    const res = arrive(sail(s, { force: { lifter: 2 }, officers: [c.id] }).state);
    expect(sys(res.state, 'sek-6').controllerFactionId).toBe('freeworlds');
    expect(hullsAt(sys(res.state, 'sek-6'), 'freeworlds')).toBe(0);
    const them = res.state.commanders.find((x) => x.id === c.id)!;
    expect(them.status).toBe('active');
    expect(them.atSystemId).toBe('sek-6');
  });

  it('puts a holder reinforcing a world under attack on the defending side', () => {
    // Meridian holds Sekkar's sixth world and sails a squadron in from sek-1 on
    // the same tick Arkane attacks from ark-4. The Meridian officer aboard
    // arrived without attacking, so they defend with everyone ashore — they
    // were counted as an attacker, where a withdrawal could take them for a
    // retreat Meridian never made.
    const s = fresh();
    const t = sys(s, 'sek-6');
    t.controllerFactionId = 'meridian';
    setStackAt(t, 'meridian', { battleship: 6 });
    const m = activeCommanders(s.commanders, 'meridian')[0]!;
    m.atSystemId = 'sek-1';
    setStackAt(sys(s, 'sek-1'), 'meridian', { battleship: 4 });
    setStackAt(sys(s, 'ark-4'), 'freeworlds', { battleship: 12 });
    let next = applyOps(s, [{
      op: 'issue_order', factionId: 'meridian', type: 'fleet_movement',
      originId: 'sek-1', targetId: 'sek-6', force: { battleship: 4 }, officers: [m.id],
    }], 'model', 'meridian').state;
    next = applyOps(next, [{
      op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
      originId: 'ark-4', targetId: 'sek-6', force: { battleship: 12 },
    }], 'model', 'freeworlds').state;
    const res = arrive(next);
    const battle = res.report.battles.find((b) => b.systemId === 'sek-6')!;
    expect(battle).toBeDefined();
    expect(battle.officers.find((o) => o.id === m.id)?.side).toBe('defend');
    // And they end the battle somewhere — standing on a world, or fallen.
    const them = res.state.commanders.find((c) => c.id === m.id)!;
    if (them.status === 'active') expect(them.atSystemId).not.toBeNull();
  });
});

describe('a family name is a person', () => {
  it('stocks share no family across powers, and none is a given name or a word of a title', () => {
    const seen = new Set<string>();
    const words = new Set<string>();
    for (const f of NAME_STOCK_FACTIONS) {
      for (const t of Object.values(titlesFor(f))) for (const w of t.toLowerCase().split(/\W+/)) words.add(w);
    }
    const s = fresh();
    for (const c of s.commanders) words.add(c.name.split(' ').find((w) => !familyOf(w))!.toLowerCase());
    for (const f of NAME_STOCK_FACTIONS) {
      const drawn = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const p = drawPerson({ factionId: f, turn: 0, salt: `x${i}`, archetype: null, taken: drawn });
        expect(seen.has(p.family), `${p.family} is used by two powers`).toBe(false);
        drawn.add(p.family);
      }
      for (const fam of drawn) {
        seen.add(fam);
        for (const w of fam.toLowerCase().split(/\s+/).filter((x) => x !== 'nar')) {
          expect(words.has(w), `${fam} shares a word with a title`).toBe(false);
        }
      }
    }
  });

  it('walks to a free family instead of repeating one, and joins two into one word past the stock', () => {
    const taken = new Set<string>();
    const families: string[] = [];
    for (let i = 0; i < 45; i++) {
      const p = drawPerson({ factionId: 'vigil', turn: 3, salt: `s${i}`, archetype: 'convoy', taken });
      expect(taken.has(p.family)).toBe(false);
      taken.add(p.family);
      families.push(p.family);
    }
    // Thirty in the stock, then joined: a single word, so "Galba" never ties
    // between Galba and a Galba-something.
    expect(families.slice(30).every((f) => !/[\s-]/.test(f))).toBe(true);
  });

  it('starts where the old draw landed, so the opening names do not move', () => {
    const s = fresh();
    for (const c of s.commanders) {
      const p = drawPerson({ factionId: c.factionId, turn: 0, salt: 'seed', archetype: c.archetype, taken: new Set() });
      expect(p.name).toBe(c.name);
    }
  });

  it('is never given again, even after the person it named has left the board', () => {
    let s = fresh();
    s.factions.find((f) => f.id === 'ojjul')!.credits = 100000;
    const deploy = () =>
      applyOps(s, [{
        op: 'deploy_agent', ownerFactionId: 'ojjul', systemId: 'ark-1', mission: 'surveillance',
        effect: { kind: 'intel', perTurn: 1 }, cover: '',
      }], 'model', 'ojjul').state;
    s = deploy();
    const first = s.agents.at(-1)!;
    const family = familyOf(first.name)!;
    expect(s.familiesUsed).toContain(family);
    s = applyOps(s, [{ op: 'recall_agent', agentId: first.id }], 'model', 'ojjul').state;
    expect(s.agents.some((a) => a.id === first.id)).toBe(false);
    expect(familiesInUse(s).has(family)).toBe(true);
    for (let i = 0; i < 6; i++) {
      s = deploy();
      expect(familyOf(s.agents.at(-1)!.name)).not.toBe(family);
    }
  });

  it('resolves a family name alone to the one officer who carries it', () => {
    const s = twoAtPort();
    for (const c of ours(s)) {
      expect(resolveCommander(s.commanders, familyOf(c.name)!)?.id).toBe(c.id);
    }
  });
});

describe('an old journal', () => {
  it('still sails the officer it named in `commanderId`', () => {
    const s = fresh();
    const c = ours(s)[0]!;
    const home = c.atSystemId!;
    const to = s.systems.find((x) => x.id !== home && x.controllerFactionId === 'freeworlds' && x.hyperlaneEdges.includes(home))!;
    const journal: Journal = {
      version: 7,
      entries: [
        { kind: 'seed', playerFactionId: 'freeworlds' },
        {
          kind: 'ops', source: 'model', actor: 'freeworlds', label: 'sail',
          ops: [{
            op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
            originId: home, targetId: to.id, force: 1, commanderId: c.id,
          }],
        },
      ],
    } as Journal;
    const { state } = replay(journal);
    expect(state.pendingOrders[0]?.officers).toEqual([c.id]);
  });
});

describe('the state document', () => {
  it('says where every officer is, and lists them beside the hulls', () => {
    const s = twoAtPort();
    const text = serializeState(s, 'freeworlds');
    for (const c of ours(s)) {
      expect(text).toContain(`${c.name} — `);
      expect(text).toMatch(new RegExp(`${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*at `));
    }
    expect(text).toMatch(/ships: [^\n]*5 battleships with /);
  });

  it('and the resolution prompt tells the model how to put one aboard', () => {
    const prompt = readFileSync('prompts/resolution.md', 'utf8');
    expect(prompt).toMatch(/`officers`/);
    expect(prompt).not.toMatch(/You do not choose/);
  });
});
