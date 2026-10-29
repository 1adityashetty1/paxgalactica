import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { fleetName, fleetsAt, resolveFleet } from '../src/domain/fleets.js';
import { hullsIn, mergeStacks } from '../src/domain/hulls.js';
import type { OpInput } from '../src/domain/ops.js';
import { stackAt, type WorldState } from '../src/domain/state.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';

/** Named fleets own the hulls and keep their identity (`docs/design-2026-10-26-fleets.md`). */

const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
/** The warfleets at a world; listeners, freighters and couriers stand beside them as fleets of their own. */
const names = (s: WorldState, id: string, f = 'meridian') => fleetsAt(sys(s, id), f).filter((x) => x.kind === 'line').map((x) => fleetName(f, x));
const solos = (s: WorldState, id: string, f = 'meridian') => fleetsAt(sys(s, id), f).filter((x) => x.kind !== 'line').map((x) => fleetName(f, x));
const apply = (s: WorldState, ops: OpInput[], path: 'declared' | 'organise' = 'declared') => {
  const out = applyOps(s, ops, 'model', 'meridian', true, {}, path);
  expect(out.rejections).toEqual([]);
  return out;
};
const calm = { randomEvents: false };
const until = (s: WorldState, done: (s: WorldState) => boolean): WorldState => {
  for (let i = 0; i < 6 && !done(s); i++) s = tickTurn(s, calm).state;
  return s;
};

/** Every world's ships are exactly what its fleets hold. */
function indexHolds(s: WorldState): void {
  for (const x of s.systems) {
    for (const f of new Set([...Object.keys(x.ships), ...(x.fleets ?? []).map((y) => y.factionId)])) {
      const held = fleetsAt(x, f).filter((y) => y.kind !== 'courier').reduce((acc, y) => mergeStacks(acc, y.stack), {});
      expect(held, `${x.id} ${f}`).toEqual(stackAt(x, f));
    }
  }
}

describe('the opening board', () => {
  it('organises every power into fleets, numbered from its best world', () => {
    const s = createSeedState('meridian');
    expect(names(s, 'sek-1')).toEqual(['Operating Group 1']);
    expect(names(s, 'tor-3', 'vigil')).toEqual(['1st Battle Squadron']);
    expect(names(s, 'ilv-6', 'drajk')).toEqual(['1st Pack']);
    indexHolds(s);
  });

  it('keeps none in a campaign from before version 31', () => {
    expect(createSeedState('meridian', { fleets: false }).systems.every((x) => x.fleets === undefined)).toBe(true);
  });
});

describe('a named fleet', () => {
  it('sails whole from wherever it stands, and keeps its name under way and on arrival', () => {
    const s0 = createSeedState('meridian');
    const og1 = sys(s0, 'sek-1').fleets!.find((f) => f.factionId === 'meridian')!.stack;
    // Origin and force are the fleet's, whatever is written.
    const { state } = apply(s0, [{ op: 'move', factionId: 'meridian', fleet: 'Operating Group 1', targetId: 'sek-4', force: 1 }]);
    const order = state.pendingOrders.at(-1)!;
    expect(order.fleet).toMatchObject({ id: 'flt-meridian-1', number: 1, detached: false });
    expect(order.force).toEqual(og1);
    expect(order.label).toMatch(/^Operating Group 1: /);
    expect(names(state, 'sek-1')).toEqual([]);
    const s = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(names(s, 'sek-4')).toEqual(['Operating Group 1', 'Operating Group 4']);
    indexHolds(s);
  });

  it('lands at once one jump inside its own space, as itself', () => {
    const { state } = apply(createSeedState('meridian'), [{ op: 'move', factionId: 'meridian', fleet: '3rd', targetId: 'sek-1' }]);
    expect(names(state, 'sek-1')).toEqual(['Operating Group 1', 'Operating Group 3']);
    expect(names(state, 'sek-2')).toEqual([]);
    indexHolds(state);
  });

  it('comes home as itself when recalled', () => {
    const { state } = apply(createSeedState('meridian'), [{ op: 'move', factionId: 'meridian', fleet: 'flt-meridian-1', targetId: 'sek-4' }]);
    const orderId = state.pendingOrders.at(-1)!.id;
    const back = apply(state, [{ op: 'cancel_order', orderId }]).state;
    expect(names(back, 'sek-1')).toEqual(['Operating Group 1']);
    indexHolds(back);
  });

  it('is refused by a name nobody answers to, with the fleets that do', () => {
    const out = applyOps(createSeedState('meridian'), [{ op: 'move', factionId: 'meridian', fleet: '9th', targetId: 'sek-4' }], 'model', 'meridian', true, {}, 'declared');
    expect(out.rejections[0]!.message).toMatch(/No fleet of Meridian Trade Authority answers to "9th"\. Its fleets: Operating Group 1 at Sekkar Gate/);
  });

  it('keeps its name through a battle it wins', () => {
    // Sennex answers to nobody and is a jump from Sekkar Gate: Operating Group 1 storms it.
    const { state } = apply(createSeedState('meridian'), [{ op: 'move', factionId: 'meridian', fleet: 'Operating Group 1', targetId: 'ark-2' }]);
    let report: ReturnType<typeof tickTurn>['report'] | null = null;
    let s = state;
    for (let i = 0; i < 3 && s.pendingOrders.some((o) => o.fleet?.id === 'flt-meridian-1'); i++) {
      const r = tickTurn(s, calm);
      s = r.state;
      if (r.report.battles.length > 0) report = r.report;
    }
    expect(names(s, 'ark-2')).toEqual(['Operating Group 1']);
    expect(report!.battles[0]!.rounds.flatMap((r) => [...r.attackers, ...r.defenders]).some((c) => c.fleets?.includes('Operating Group 1'))).toBe(true);
    indexHolds(s);
  });
});

describe('ships sent without a fleet', () => {
  it('go as a detachment that rejoins the senior fleet where they arrive', () => {
    const { state } = apply(createSeedState('meridian'), [
      { op: 'move', factionId: 'meridian', originId: 'sek-1', targetId: 'sek-4', force: { battleship: 2 } },
    ]);
    const order = state.pendingOrders.at(-1)!;
    expect(order.fleet).toMatchObject({ detached: true });
    expect(sys(state, 'sek-1').fleets!.find((f) => f.factionId === 'meridian')!.stack.battleship).toBe(5);
    const s = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(names(s, 'sek-4')).toEqual(['Operating Group 4']);
    expect(sys(s, 'sek-4').fleets!.find((f) => f.factionId === 'meridian')!.stack.battleship).toBe(6);
    indexHolds(s);
  });

  it('are built into the senior fleet at the yard', () => {
    const { state } = apply(createSeedState('meridian'), [{ op: 'build_ships', factionId: 'meridian', hull: 'escort', count: 2, systemId: 'sek-1' }]);
    expect(sys(state, 'sek-1').fleets!.find((f) => f.factionId === 'meridian')!.stack.escort).toBe(8);
    indexHolds(state);
  });
});

describe('organising', () => {
  it('renames, splits and merges, and moves nothing', () => {
    let s = createSeedState('meridian');
    const before = JSON.stringify(s.systems.map((x) => x.ships));
    s = apply(s, [{ op: 'rename_fleet', factionId: 'meridian', fleet: '1', name: 'Home Guard' }], 'organise').state;
    expect(names(s, 'sek-1')).toEqual(['Home Guard']);
    s = apply(s, [{ op: 'split_fleet', factionId: 'meridian', fleet: 'Home Guard', force: { battleship: 3, escort: 2 }, name: 'Strike Group' }], 'organise').state;
    expect(names(s, 'sek-1')).toEqual(['Home Guard', 'Strike Group']);
    const strike = sys(s, 'sek-1').fleets!.find((f) => f.name === 'Strike Group')!;
    expect(strike).toMatchObject({ id: 'flt-meridian-5', number: 5, stack: { battleship: 3, escort: 2 } });
    s = apply(s, [{ op: 'merge_fleets', factionId: 'meridian', into: 'Home Guard', from: ['Strike Group'] }], 'organise').state;
    expect(names(s, 'sek-1')).toEqual(['Home Guard']);
    expect(JSON.stringify(s.systems.map((x) => x.ships))).toBe(before);
    s = apply(s, [{ op: 'rename_fleet', factionId: 'meridian', fleet: 'Home Guard', name: '' }], 'organise').state;
    expect(names(s, 'sek-1')).toEqual(['Operating Group 1']);
  });

  it('merges only fleets at one world, and only your own', () => {
    const s = createSeedState('meridian');
    const far = applyOps(s, [{ op: 'merge_fleets', factionId: 'meridian', into: '1', from: ['2'] }], 'model', 'meridian', true, {}, 'organise');
    expect(far.rejections[0]!.message).toMatch(/Operating Group 2 is at Torrek Anchorage, not Sekkar Gate/);
    const theirs = applyOps(s, [{ op: 'rename_fleet', factionId: 'vigil', fleet: '1', name: 'Mine now' }], 'model', 'meridian', true, {}, 'organise');
    expect(theirs.rejections[0]!.message).toMatch(/cannot organise the fleets of Iron Vigil Remnant/);
  });
});

describe('a name', () => {
  const fleets = createSeedState('meridian').systems.flatMap((x) => fleetsAt(x, 'drajk'));
  it('is found by id, number, ordinal word or name, and a tie finds nobody', () => {
    expect(resolveFleet(fleets, 'flt-drajk-2')?.number).toBe(2);
    expect(resolveFleet(fleets, '3rd')?.number).toBe(3);
    expect(resolveFleet(fleets, 'the third pack')?.number).toBe(3);
    expect(resolveFleet(fleets, '4th Pack')?.number).toBe(4);
    expect(resolveFleet(fleets, 'Pack')).toBeNull();
  });
});

describe('a campaign with fleets', () => {
  it('replays to the same fleets', () => {
    const c = Campaign.start('meridian', 'fleets', new MemoryCampaignStore());
    c.commit([{ op: 'move', factionId: 'meridian', fleet: 'Operating Group 1', targetId: 'ark-2' }], 'model', 'move', 'meridian', 'declared');
    c.commit([{ op: 'split_fleet', factionId: 'meridian', fleet: '2', force: { escort: 2 } }], 'model', 'split', 'meridian', 'organise');
    for (let i = 0; i < 4; i++) c.tick();
    expect(c.verifyReplay().ok).toBe(true);
    expect(hullsIn(sys(c.state, 'ark-2').ships.meridian)).toBeGreaterThan(0);
  });
});

describe('who commands a fleet', () => {
  it('is the senior officer where it stands, or aboard it under way — the rule a battle reads', async () => {
    const { commandingAboard, commandingAt } = await import('../src/domain/command.js');
    const s = createSeedState('meridian');
    const here = commandingAt(s.commanders, 'meridian', 'sek-1');
    expect(here?.name).toMatch(/Adrienne Sorel/);
    expect(commandingAt(s.commanders, 'meridian', 'sek-2')).toBeUndefined();
    const { state } = apply(s, [{ op: 'move', factionId: 'meridian', fleet: '1', targetId: 'sek-4' }]);
    const order = state.pendingOrders.at(-1)!;
    expect(commandingAboard(state.commanders, order.officers)?.id).toBe(here!.id);
  });
});

describe('the organise route', () => {
  it('stages a free, withdrawable change labelled by what it did, and refuses a bad one unstaged', async () => {
    const { GameSession } = await import('../src/server/session.js');
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('meridian', 'organise');
    await session.organise({ op: 'split_fleet', fleet: '1', force: { battleship: 2 } });
    const view = session.view();
    expect(view.actionPoints.left).toBe(2);
    expect(view.staged.at(-1)!.label).toBe('2 battleships split from Operating Group 1 at Sekkar Gate');
    expect(view.state.systems.find((x) => x.id === 'sek-1')!.fleets!.filter((f) => f.factionId === 'meridian' && f.kind === 'line')).toHaveLength(2);
    await expect(session.organise({ op: 'merge_fleets', into: '1', from: ['2'] })).rejects.toThrow(/not Sekkar Gate/);
    expect(session.view().staged).toHaveLength(1);
  });
});

describe('a fleet commander', () => {
  /** Meridian with a second officer, Lira Nakagawa, appointed at Sekkar Gate beside Adrienne Sorel. */
  const twoOfficers = () => apply(createSeedState('meridian'), [{ op: 'recruit_commander', factionId: 'meridian', systemId: 'sek-1', school: 'gunnery' }]).state;
  const fleet = (s: WorldState, id: string) => s.systems.flatMap((x) => x.fleets ?? []).find((f) => f.id === id);
  const officer = (s: WorldState, name: string) => s.commanders.find((c) => c.name.includes(name))!;

  it('is set on the opening board where each power has an officer standing', () => {
    const s = createSeedState('meridian');
    expect(fleet(s, 'flt-meridian-1')!.commanderId).toBe(officer(s, 'Sorel').id);
    expect(fleet(s, 'flt-vigil-1')!.commanderId).not.toBeNull();
  });

  it('is assigned from the officers standing there, one fleet each, and relieved without leaving', () => {
    let s = twoOfficers();
    s = apply(s, [{ op: 'split_fleet', factionId: 'meridian', fleet: '1', force: { battleship: 3 } }], 'organise').state;
    s = apply(s, [{ op: 'assign_command', factionId: 'meridian', fleet: '5', officer: 'Nakagawa' }], 'organise').state;
    expect(fleet(s, 'flt-meridian-5')!.commanderId).toBe(officer(s, 'Nakagawa').id);
    // Sorel takes the 5th: she gives up the 1st, and Nakagawa stays at the world, uncommanding.
    s = apply(s, [{ op: 'assign_command', factionId: 'meridian', fleet: '5', officer: 'Sorel' }], 'organise').state;
    expect(fleet(s, 'flt-meridian-5')!.commanderId).toBe(officer(s, 'Sorel').id);
    expect(fleet(s, 'flt-meridian-1')!.commanderId).toBeNull();
    expect(officer(s, 'Nakagawa').atSystemId).toBe('sek-1');
    s = apply(s, [{ op: 'relieve_command', factionId: 'meridian', fleet: '5' }], 'organise').state;
    expect(fleet(s, 'flt-meridian-5')!.commanderId).toBeNull();
    expect(officer(s, 'Sorel').atSystemId).toBe('sek-1');
  });

  it('must be standing where the fleet is', () => {
    const out = applyOps(createSeedState('meridian'), [{ op: 'assign_command', factionId: 'meridian', fleet: '2', officer: 'Sorel' }], 'model', 'meridian', true, {}, 'organise');
    expect(out.rejections[0]!.message).toMatch(/Sorel is at Sekkar Gate, not Torrek Anchorage/);
  });

  it('sails with the fleet and commands it where it lands; another officer may ride as a passenger', () => {
    const { state } = apply(twoOfficers(), [{ op: 'move', factionId: 'meridian', fleet: '1', targetId: 'sek-4', officers: ['Nakagawa'] }]);
    const order = state.pendingOrders.at(-1)!;
    expect(order.fleet!.commanderId).toBe(officer(state, 'Sorel').id);
    expect(order.officers).toEqual(expect.arrayContaining([officer(state, 'Sorel').id, officer(state, 'Nakagawa').id]));
    const s = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(fleet(s, 'flt-meridian-1')!.commanderId).toBe(officer(s, 'Sorel').id);
    expect(officer(s, 'Nakagawa').atSystemId).toBe('sek-4');
  });

  it('leaves the fleet uncommanded by travelling alone, and arrives where their power stands', () => {
    const { state } = apply(createSeedState('meridian'), [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'tor-1' }]);
    expect(fleet(state, 'flt-meridian-1')!.commanderId).toBeNull();
    const order = state.pendingOrders.at(-1)!;
    // They sail a courier: a one-hull fleet named for them, which they command.
    expect(order.force).toEqual({ courier: 1 });
    expect(order.fleet).toMatchObject({ name: expect.stringMatching(/^courier of .*Sorel/), commanderId: officer(state, 'Sorel').id });
    const s = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(officer(s, 'Sorel').atSystemId).toBe('tor-1');
    // The courier is set aside once they are down: nothing new stands at the world.
    expect(s.systems.find((x) => x.id === 'tor-1')!.ships.meridian).toEqual(state.systems.find((x) => x.id === 'tor-1')!.ships.meridian);
    expect(s.systems.flatMap((x) => Object.values(x.ships)).some((st) => (st.courier ?? 0) > 0)).toBe(false);
    // And takes the fleet there once assigned.
    const t = apply(s, [{ op: 'assign_command', factionId: 'meridian', fleet: '2', officer: 'Sorel' }], 'organise').state;
    expect(fleet(t, 'flt-meridian-2')!.commanderId).toBe(officer(t, 'Sorel').id);
  });

  it('travels alone only to where their power stands', () => {
    const out = applyOps(createSeedState('meridian'), [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'tor-3' }], 'model', 'meridian', true, {}, 'declared');
    expect(out.rejections[0]!.message).toMatch(/travels alone only to a world/);
  });

  it('leads the side in battle over a more senior officer aboard', () => {
    let s = twoOfficers();
    const nakagawa = officer(s, 'Nakagawa');
    nakagawa.battles = 0;
    officer(s, 'Sorel').battles = 4;
    s = apply(s, [{ op: 'assign_command', factionId: 'meridian', fleet: '1', officer: 'Nakagawa' }], 'organise').state;
    s = apply(s, [{ op: 'move', factionId: 'meridian', fleet: '1', targetId: 'ark-2', officers: ['Sorel'] }]).state;
    let led: string[] = [];
    for (let i = 0; i < 3 && led.length === 0; i++) {
      const r = tickTurn(s, calm);
      s = r.state;
      led = r.report.battles.flatMap((b) => (b.leaders?.attack ? [b.leaders.attack] : []));
    }
    expect(led.join(' ')).toMatch(/Nakagawa/);
    expect(led.join(' ')).not.toMatch(/Sorel/);
  });
});

describe('a refusal about fleets', () => {
  it('cannot rest on a fleet existing, or on an officer travelling alone', async () => {
    const { checkGround } = await import('../src/domain/refusals.js');
    const s = createSeedState('meridian');
    expect(checkGround(s, 'meridian', { kind: 'already_so', ref: 'flt-meridian-3', reason: '' } as never, 'Move Operating Group 3 to Sekkar Gate.')).toMatch(/does not make the order already so/);
    const sent = apply(s, [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'tor-1' }]).state;
    const passage = sent.pendingOrders.at(-1)!.id;
    expect(checkGround(sent, 'meridian', { kind: 'already_so', ref: passage, reason: '' } as never, 'Move Operating Group 2 to Corvid.')).toMatch(/officer travelling alone/);
    expect(checkGround(s, 'meridian', { kind: 'no_such_entity', entity: 'thing', name: '3rd Pack', reason: '' } as never)).toMatch(/does exist: 3rd Pack/);
  });
});

describe('a recall', () => {
  it('brings the fleet home, and a move of it to where it now stands is dropped, not sailed', () => {
    const { state } = apply(createSeedState('meridian'), [{ op: 'move', factionId: 'meridian', fleet: '1', targetId: 'sek-4' }]);
    const orderId = state.pendingOrders.at(-1)!.id;
    const out = apply(state, [
      { op: 'cancel_order', orderId },
      { op: 'move', factionId: 'meridian', fleet: 'Operating Group 1', targetId: 'sek-1' },
    ]);
    expect(out.state.pendingOrders.some((o) => o.factionId === 'meridian')).toBe(false);
    expect(names(out.state, 'sek-1')).toEqual(['Operating Group 1']);
    expect(out.notes.join(' ')).toMatch(/already at Sekkar Gate/);
  });
});

describe('organising, declared in words', () => {
  it('has any charge beside it left out', async () => {
    const { organisingIsFree } = await import('../src/domain/refusals.js');
    const merged = organisingIsFree([
      { op: 'merge_fleets', factionId: 'meridian', into: '3', from: ['5'] },
      { op: 'spend', factionId: 'meridian', amount: 40, for: 'overtime' },
      { op: 'log_narrative', text: 'x' },
    ]);
    expect(merged.dropped).toBe(true);
    expect(merged.ops.map((o) => (o as { op: string }).op)).toEqual(['merge_fleets', 'log_narrative']);
    // Beside a real act the charge is that act's, and stays.
    expect(organisingIsFree([{ op: 'merge_fleets' }, { op: 'build_ships' }, { op: 'spend' }]).dropped).toBe(false);
  });
});

describe('holding position', () => {
  it('needs no order: a move onto a world the mover holds is dropped', () => {
    const out = applyOps(createSeedState('meridian'), [{ op: 'move', factionId: 'vigil', originId: 'tor-3', targetId: 'tor-3', force: 2 }], 'model', 'vigil', true, {}, 'reaction');
    expect(out.rejections).toEqual([]);
    expect(out.state.pendingOrders.some((o) => o.factionId === 'vigil')).toBe(false);
    expect(out.notes.join(' ')).toMatch(/holds Vantic already/);
  });
});

describe('an officer travelling alone', () => {
  it('is a one-unit fleet of nominal weight, met and fought on arrival', () => {
    const s0 = createSeedState('meridian');
    // Six Vigil battleships squat over Corvid, a Meridian world.
    s0.systems.find((x) => x.id === 'sek-2')!.ships.vigil = { battleship: 6 };
    const { state } = apply(s0, [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'sek-2' }]);
    const r = tickTurn(state, calm);
    const battle = r.report.battles.find((b) => b.systemId === 'sek-2')!;
    expect(battle).toBeDefined();
    const sides = battle.rounds.flatMap((x) => [...x.attackers, ...x.defenders]);
    expect(sides.some((c) => c.fleets?.some((n) => /^courier of .*Sorel/.test(n)))).toBe(true);
    // The courier is shot away; the world is Meridian's, so Sorel comes down
    // with the garrison, as any officer on a world their power holds does.
    expect(r.state.systems.flatMap((x) => Object.values(x.ships)).some((st) => (st.courier ?? 0) > 0)).toBe(false);
    const sorel = r.state.commanders.find((c) => c.name.includes('Sorel'))!;
    expect(sorel.atSystemId).toBe('sek-2');
  });

  it('falls with the courier over ground their power does not hold', () => {
    const s0 = createSeedState('meridian');
    // One Meridian escort parked over the Vigil's Kalzir, under its guns.
    const kalzir = s0.systems.find((x) => x.id === 'tor-2')!;
    kalzir.ships.meridian = { escort: 1 };
    kalzir.ships.vigil = { battleship: 12 };
    const { state } = apply(s0, [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'tor-2' }]);
    let w = state;
    for (let i = 0; i < 6 && w.pendingOrders.some((o) => o.factionId === 'meridian' && o.targetId === 'tor-2'); i++) w = tickTurn(w, calm).state;
    const sorel = w.commanders.find((c) => c.name.includes('Sorel'))!;
    expect(sorel.status).not.toBe('active');
  });

  it('costs the navy nothing: the yards do not bill a courier and it draws no upkeep', async () => {
    const { fleetTonsOf } = await import('../src/domain/state.js');
    const s0 = createSeedState('meridian');
    const before = s0.factions.find((f) => f.id === 'meridian')!.credits;
    const { state } = apply(s0, [{ op: 'move_officer', factionId: 'meridian', officer: 'Sorel', targetId: 'tor-1' }]);
    expect(state.factions.find((f) => f.id === 'meridian')!.credits).toBe(before);
    expect(fleetTonsOf(state, 'meridian')).toBe(fleetTonsOf(s0, 'meridian'));
  });

  it('cannot be built', () => {
    const out = applyOps(createSeedState('meridian'), [{ op: 'build_ships', factionId: 'meridian', hull: 'courier', count: 1 } as never], 'model', 'meridian', true, {}, 'declared');
    expect(out.rejections.length).toBeGreaterThan(0);
  });
});

describe('a single-vessel job', () => {
  const kinds = (s: WorldState, f: string) => s.systems.flatMap((x) => fleetsAt(x, f));

  it('stands as a one-ship fleet of its own from the opening board, never in a warfleet', () => {
    const s = createSeedState('meridian');
    for (const f of kinds(s, 'meridian').concat(kinds(s, 'ojjul'), kinds(s, 'vigil'))) {
      if (f.kind === 'line') expect(f.stack.listener ?? 0, f.id).toBe(0);
      if (f.kind === 'line') expect(f.stack.freighter ?? 0, f.id).toBe(0);
      if (f.kind === 'listener' || f.kind === 'freighter') expect(f.stack).toEqual({ [f.kind]: 1 });
    }
    expect(kinds(s, 'ojjul').filter((f) => f.kind === 'listener')).toHaveLength(3);
    expect(solos(s, 'sek-1')).toContain('Contract Hauler 1');
    indexHolds(s);
  });

  it('is built as a fleet of its own, while a warship joins the senior warfleet', () => {
    const before = solos(createSeedState('meridian'), 'sek-1').length;
    const { state } = apply(createSeedState('meridian'), [
      { op: 'build_ships', factionId: 'meridian', hull: 'listener', count: 2, systemId: 'sek-1' },
    ]);
    const listeners = fleetsAt(sys(state, 'sek-1'), 'meridian').filter((f) => f.kind === 'listener');
    expect(listeners.map((f) => f.stack)).toEqual([{ listener: 1 }, { listener: 1 }]);
    expect(listeners.map((f) => fleetName('meridian', f))).toEqual(['Espionage Platform 1', 'Espionage Platform 2']);
    expect(solos(state, 'sek-1')).toHaveLength(before + 2);
    expect(names(state, 'sek-1')).toEqual(['Operating Group 1']);
    indexHolds(state);
  });

  it('comes in unnamed as a fleet of its own, and sails by its own name', () => {
    const s0 = createSeedState('meridian');
    const freighter = fleetsAt(sys(s0, 'sek-1'), 'meridian').find((f) => f.kind === 'freighter')!;
    const { state } = apply(s0, [{ op: 'move', factionId: 'meridian', fleet: fleetName('meridian', freighter), targetId: 'sek-4' }]);
    const order = state.pendingOrders.at(-1)!;
    expect(order.force).toMatchObject({ freighter: 1 });
    expect(order.fleet).toMatchObject({ id: freighter.id, kind: 'freighter' });
    const s = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(fleetsAt(sys(s, 'sek-4'), 'meridian').find((f) => f.id === freighter.id)?.stack).toEqual({ freighter: 1 });
    expect(names(s, 'sek-4')).toEqual(['Operating Group 4']);
    indexHolds(s);
  });

  it('rides in a warfleet when its power merges it in, and sails with it', () => {
    const s0 = createSeedState('meridian');
    const freighter = fleetsAt(sys(s0, 'sek-1'), 'meridian').find((f) => f.kind === 'freighter')!;
    let s = apply(s0, [{ op: 'merge_fleets', factionId: 'meridian', into: 'Operating Group 1', from: [freighter.id] }], 'organise').state;
    const og1 = fleetsAt(sys(s, 'sek-1'), 'meridian').find((f) => f.number === 1 && f.kind === 'line')!;
    expect(og1.stack.freighter).toBe(1);
    s = apply(s, [{ op: 'move', factionId: 'meridian', fleet: 'Operating Group 1', targetId: 'sek-4' }]).state;
    expect(s.pendingOrders.at(-1)!.force).toMatchObject({ freighter: 1 });
    s = until(s, (x) => !x.pendingOrders.some((o) => o.fleet?.id === og1.id));
    expect(fleetsAt(sys(s, 'sek-4'), 'meridian').find((f) => f.id === og1.id)?.stack.freighter).toBe(1);
    indexHolds(s);
  });

  it('is named by its kind, so a bare number still means a warfleet', () => {
    const fleets = [
      { id: 'a', factionId: 'meridian', kind: 'line' as const, number: 2, name: null },
      { id: 'b', factionId: 'meridian', kind: 'listener' as const, number: 2, name: null },
    ];
    expect(resolveFleet(fleets, '2')?.id).toBe('a');
    expect(resolveFleet(fleets, 'Espionage Platform 2')?.id).toBe('b');
  });

  it('is named in its power\'s voice', () => {
    expect(fleetName('ojjul', { kind: 'listener', number: 1, name: null })).toBe('Ear of the Family 1');
    expect(fleetName('ojjul', { kind: 'freighter', number: 1, name: null })).toBe('Spice Hauler 1');
    expect(fleetName('vigil', { kind: 'listener', number: 2, name: null })).toBe('Signals Picket 2');
    expect(fleetName('elsewhere', { kind: 'freighter', number: 3, name: null })).toBe('Freighter 3');
  });
});

describe('an officer with nothing to command', () => {
  const twoOfficers = () => apply(createSeedState('meridian'), [{ op: 'recruit_commander', factionId: 'meridian', systemId: 'sek-1', school: 'gunnery' }]).state;
  const couriers = (s: WorldState) => s.systems.flatMap((x) => (x.fleets ?? []).filter((f) => f.kind === 'courier').map((f) => ({ ...f, at: x.id })));

  it('keeps a courier where they stand, commanded by them and out of the index', () => {
    const s = twoOfficers();
    const added = s.commanders.find((c) => c.status === 'active' && c.factionId === 'meridian' && !s.systems.some((x) => (x.fleets ?? []).some((f) => f.kind === 'line' && f.commanderId === c.id)))!;
    const mine = couriers(s).filter((f) => f.commanderId === added.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ at: 'sek-1', stack: { courier: 1 }, kind: 'courier' });
    expect(fleetName('meridian', mine[0]!)).toMatch(/^courier of /);
    expect(stackAt(sys(s, 'sek-1'), 'meridian').courier ?? 0).toBe(0);
    indexHolds(s);
  });

  it('gives it up on taking command, and has it back on standing down', () => {
    let s = twoOfficers();
    const sorel = s.commanders.find((c) => c.name.includes('Sorel'))!;
    const other = s.commanders.find((c) => c.factionId === 'meridian' && c.status === 'active' && c.id !== sorel.id && c.atSystemId === 'sek-1')!;
    s = apply(s, [{ op: 'assign_command', factionId: 'meridian', fleet: 'Operating Group 1', officer: other.id }], 'organise').state;
    expect(couriers(s).some((f) => f.commanderId === other.id)).toBe(false);
    expect(couriers(s).some((f) => f.commanderId === sorel.id && f.at === 'sek-1')).toBe(true);
    s = apply(s, [{ op: 'relieve_command', factionId: 'meridian', fleet: 'Operating Group 1' }], 'organise').state;
    expect(couriers(s).some((f) => f.commanderId === other.id)).toBe(true);
  });

  it('is not split, merged or given another commander', () => {
    const s = twoOfficers();
    const courier = couriers(s)[0]!;
    for (const op of [
      { op: 'merge_fleets', factionId: 'meridian', into: 'Operating Group 1', from: [courier.id] },
      { op: 'relieve_command', factionId: 'meridian', fleet: courier.id },
    ] as OpInput[]) {
      expect(applyOps(s, [op], 'model', 'meridian', true, {}, 'organise').rejections[0]?.message).toMatch(/passage/);
    }
  });

  it('sails alone when the courier is sent, under its own name', () => {
    const s = twoOfficers();
    const courier = couriers(s)[0]!;
    const { state } = apply(s, [{ op: 'move', factionId: 'meridian', fleet: courier.id, targetId: 'sek-4' }]);
    const order = state.pendingOrders.at(-1)!;
    expect(order.force).toEqual({ courier: 1 });
    expect(order.fleet).toMatchObject({ id: courier.id, kind: 'courier', commanderId: courier.commanderId });
    expect(couriers(state).some((f) => f.id === courier.id)).toBe(false);
    const landed = until(state, (x) => !x.pendingOrders.some((o) => o.id === order.id));
    expect(couriers(landed).some((f) => f.commanderId === courier.commanderId && f.at === 'sek-4')).toBe(true);
    indexHolds(landed);
  });
});

describe('standing guard over a world', () => {
  // The Combine's 3rd House Fleet at Riqel carries a lifter; Var Hollow, a jump
  // away, answers to nobody.
  const send = (land?: boolean) =>
    applyOps(
      createSeedState('ojjul'),
      [{ op: 'move', factionId: 'ojjul', fleet: '3rd', targetId: 'sek-5', ...(land === undefined ? {} : { land }) }],
      'model',
      'ojjul',
      true,
      {},
      'declared',
    );

  it('lands the lift, and is an invasion, by default', () => {
    const out = send();
    expect(out.acts.some((a) => a.kind === 'invasion_launched')).toBe(true);
  });

  it('takes station with the lift aboard when sent without landing, and is no invasion', () => {
    const out = send(false);
    expect(out.rejections).toEqual([]);
    expect(out.acts.some((a) => a.kind === 'invasion_launched')).toBe(false);
    expect(out.state.pendingOrders.at(-1)!.holdLanding).toBe(true);
    let s = out.state;
    let report: ReturnType<typeof tickTurn>['report'] | null = null;
    for (let i = 0; i < 3 && s.pendingOrders.some((o) => o.holdLanding); i++) {
      const r = tickTurn(s, calm);
      s = r.state;
      report = r.report;
    }
    const vh = sys(s, 'sek-5');
    expect(vh.controllerFactionId).toBeNull();
    expect(vh.garrison).toBe(3);
    expect(stackAt(vh, 'ojjul').lifter).toBe(1);
    expect(report!.battles.some((b) => b.systemId === 'sek-5')).toBe(false);
    expect(s.eventLog.some((e) => /takes station over Var Hollow, and lands nobody/.test(e.text))).toBe(true);
  });

  it('is not refused by the Combine as a war of conquest', async () => {
    const { linesCrossed } = await import('../src/domain/acts.js');
    const s = createSeedState('ojjul');
    expect(linesCrossed(s.factions, send(false).acts, ['ojjul'])).toEqual([]);
    expect(linesCrossed(s.factions, send().acts, ['ojjul']).length).toBeGreaterThan(0);
  });
});

describe('landing as an action of its own', () => {
  it('puts a stationed fleet\'s troops down from the orbit it holds', () => {
    let s = applyOps(
      createSeedState('ojjul'),
      [{ op: 'move', factionId: 'ojjul', fleet: '3rd', targetId: 'sek-5', land: false }],
      'model', 'ojjul', true, {}, 'declared',
    ).state;
    s = until(s, (x) => !x.pendingOrders.some((o) => o.holdLanding));
    expect(sys(s, 'sek-5').controllerFactionId).toBeNull();
    const land = applyOps(s, [{ op: 'move', factionId: 'ojjul', fleet: '3rd', targetId: 'sek-5' }], 'model', 'ojjul', true, {}, 'declared');
    expect(land.rejections).toEqual([]);
    expect(land.acts.some((a) => a.kind === 'invasion_launched')).toBe(true);
    const order = land.state.pendingOrders.at(-1)!;
    expect(order).toMatchObject({ originId: 'sek-5', targetId: 'sek-5', durationTurns: 1 });
    expect(order.holdLanding).toBeUndefined();
    const r = tickTurn(land.state, calm);
    expect(r.notes.some((n) => /storms Var Hollow/.test(n))).toBe(true);
  });
});

describe('bughunt 2026-10-27', () => {
  it('refuses standing guard in a friendly power\'s orbit without basing rights, rather than fighting there', () => {
    // Hollow Star is the Confederacy's, and the Combine is on good terms with it.
    const out = applyOps(
      createSeedState('ojjul'),
      [{ op: 'move', factionId: 'ojjul', originId: 'ilv-1', targetId: 'ilv-7', force: { battleship: 2 }, land: false }],
      'model', 'ojjul', true, {}, 'declared',
    );
    expect(out.rejections[0]?.message).toMatch(/basing rights/);
    expect(out.state.pendingOrders.some((o) => o.targetId === 'ilv-7' && o.factionId === 'ojjul')).toBe(false);
  });

  it('takes station over a militia with no lift aboard, rather than reporting a battle', () => {
    const out = applyOps(
      createSeedState('ojjul'),
      [{ op: 'move', factionId: 'ojjul', originId: 'ilv-3', targetId: 'sek-5', force: { battleship: 2, escort: 2 } }],
      'model', 'ojjul', true, {}, 'declared',
    );
    const r = tickTurn(out.state, calm);
    expect(r.report.battles.some((b) => b.systemId === 'sek-5')).toBe(false);
    expect(r.notes.some((n) => /takes station over Var Hollow\.$/.test(n))).toBe(true);
    expect(sys(r.state, 'sek-5').garrison).toBe(3);
  });
});

describe('a landing with nothing to land with (bughunt 2026-10-28)', () => {
  it('says so when the fleet sails, and says nothing when it stands guard', async () => {
    const { createSeedState } = await import('../src/seed/scenario.js');
    const { applyOps } = await import('../src/domain/reducer.js');
    const s = createSeedState('meridian');
    const land = applyOps(s, [{ op: 'move', factionId: 'meridian', originId: 'sek-1', targetId: 'sek-3', force: { battleship: 3 }, label: 'to Ithaal' }], 'model', 'meridian');
    expect(land.rejections).toEqual([]);
    expect(land.notes.some((n) => /No lifters sail with to Ithaal: .*nobody lands/.test(n))).toBe(true);
    const guard = applyOps(s, [{ op: 'move', factionId: 'meridian', originId: 'sek-1', targetId: 'sek-3', force: { battleship: 3 }, land: false, label: 'to Ithaal' }], 'model', 'meridian');
    expect(guard.notes.some((n) => n.startsWith('No lifters'))).toBe(false);
    // A battle line and its lifter sent as two moves are one landing.
    const pair = applyOps(
      s,
      [
        { op: 'move', factionId: 'meridian', originId: 'sek-1', targetId: 'sek-3', force: { battleship: 3 }, label: 'line' },
        { op: 'move', factionId: 'meridian', originId: 'sek-1', targetId: 'sek-3', force: { lifter: 1 }, label: 'lift' },
      ],
      'model',
      'meridian',
    );
    expect(pair.rejections).toEqual([]);
    expect(pair.notes.some((n) => n.startsWith('No lifters'))).toBe(false);
  });
});
