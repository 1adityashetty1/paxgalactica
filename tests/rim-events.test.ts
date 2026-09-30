import { describe, expect, it, vi } from 'vitest';

/**
 * Item 124: the Rim moves on its own.
 *
 * The flavour call is scripted: it is the only model call a quiet end of turn
 * makes, and this file checks that the turn never waits for it and that a line
 * inventing a number is thrown away.
 */
const flavour = { line: 'Harbour-masters mark the storm and close their books.', fail: false };
vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string }) => {
    if (call.kind !== 'event_flavour') throw new Error(`unexpected call ${call.kind}`);
    if (flavour.fail) throw new Error('overloaded');
    return { value: { line: flavour.line }, attempts: 1, costUsd: 0 };
  },
  timingReport: () => '',
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
}));

const { createSeedState } = await import('../src/seed/scenario.js');
const { applyOps, resolveRimEvent, tickTurn } = await import('../src/domain/reducer.js');
const { buildAdjacency } = await import('../src/domain/graph.js');
const {
  BORDER_INCIDENT_COST,
  ENVOYS_GOODWILL,
  ENVOYS_QUIET_TURNS,
  MUTINY_DISSENT,
  RIM_BOONS,
  RIM_EVENT_KINDS,
  RIM_EVENT_RATE,
  RIM_EVENT_WEIGHT,
  RIM_HAZARDS,
  RIM_KIND_COOLDOWN,
  RIM_POWER_COOLDOWN,
  SHORTAGE_FACTOR,
  shortageFactor,
  stormbound,
} = await import('../src/domain/events.js');
const { drawRimEvent, eligibleRimEvents, rimEventFires, clashKey } = await import('../src/domain/pulse.js');
const { routeEarnings, runsBlockade, severedBy, tradeRoutes } = await import('../src/domain/trade.js');
const { assetWorthTo } = await import('../src/domain/diplomacy.js');
const { worldAsSeenBy } = await import('../src/domain/intel.js');
const { fleetTonsOf, hullsAt } = await import('../src/domain/state.js');
const { briefingFromState } = await import('../src/engine/briefing.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { MemoryCampaignStore } = await import('../src/engine/store.js');
const { replay } = await import('../src/engine/journal.js');
const { GameSession } = await import('../src/server/session.js');
const { flavourKeepsTheFacts } = await import('../src/model/calls.js');

type World = ReturnType<typeof createSeedState>;
const fresh = (): World => createSeedState('freeworlds');
const sys = (s: World, id: string) => s.systems.find((x) => x.id === id)!;
const regard = (s: World, from: string, to: string) =>
  s.factions.find((f) => f.id === from)!.disposition[to] ?? 0;

describe('the pulse: one turn in two, one event at most', () => {
  it('has ten kinds, six hazards and four boons, weighted to a total of one half', () => {
    expect(RIM_EVENT_KINDS).toHaveLength(10);
    expect(RIM_HAZARDS).toHaveLength(6);
    expect(RIM_BOONS).toHaveLength(4);
    const total = Object.values(RIM_EVENT_WEIGHT).reduce((n, w) => n + w, 0);
    expect(total).toBeCloseTo(0.5, 10);
    expect(RIM_EVENT_RATE).toBeCloseTo(0.5, 10);
  });

  it('fires on half the turns over a long run, off the d20', () => {
    let fired = 0;
    for (let t = 1; t <= 20000; t++) if (rimEventFires(t)) fired += 1;
    expect(fired / 20000).toBeGreaterThan(0.48);
    expect(fired / 20000).toBeLessThan(0.52);
  });

  it('draws the same event from the same board on the same turn', () => {
    const s = fresh();
    s.turn = 7;
    expect(drawRimEvent(s)).toEqual(drawRimEvent(structuredClone(s)));
  });

  it('never fires twice in one tick, and records what it did', () => {
    let s = fresh();
    for (let t = 1; t <= 30; t++) {
      const res = tickTurn(s);
      expect(res.report.events.length).toBeLessThanOrEqual(1);
      s = res.state;
    }
    expect(s.rimEvents.length).toBeGreaterThan(5);
    expect(new Set(s.rimEvents.map((e) => e.turn)).size).toBe(s.rimEvents.length);
    for (const e of s.rimEvents) {
      expect(s.eventLog.some((l) => l.kind === 'rim' && l.text === e.text && l.turn === e.turn)).toBe(true);
    }
  });

  it('rests a kind for a while after it fires', () => {
    const s = fresh();
    s.turn = 10;
    s.rimEvents.push({
      id: 'rim-9', turn: 9, kind: 'ion_storm', factionIds: [], systemId: 'ilv-2',
      assetKind: null, untilTurn: 9, text: 'x', visibleTo: null,
    });
    expect(eligibleRimEvents(s).map((e) => e.kind)).not.toContain('ion_storm');
    s.turn = 9 + RIM_KIND_COOLDOWN;
    expect(eligibleRimEvents(s).map((e) => e.kind)).toContain('ion_storm');
  });

  it('leaves a power alone for a while after an event singles it out', () => {
    const s = fresh();
    s.turn = 10;
    s.rimEvents.push({
      id: 'rim-9', turn: 9, kind: 'mutiny', factionIds: ['drajk'], systemId: null,
      assetKind: null, untilTurn: null, text: 'x', visibleTo: ['drajk'],
    });
    const touches = (x: World) =>
      eligibleRimEvents(x).flatMap((e) => e.candidates.flatMap((c) => c.subjects));
    expect(touches(s)).not.toContain('drajk');
    s.turn = 9 + RIM_POWER_COOLDOWN;
    expect(touches(s)).toContain('drajk');
  });

  it('does nothing on a journal from before events', () => {
    let s = fresh();
    for (let t = 1; t <= 20; t++) s = tickTurn(s, { randomEvents: false }).state;
    expect(s.rimEvents).toEqual([]);
    expect(s.lastClash).toEqual({});
    expect(s.eventLog.some((e) => e.kind === 'rim')).toBe(false);
  });
});

describe('the six hazards', () => {
  it('an ion storm closes a lane for its turns, and the smuggler still runs it', () => {
    const s = fresh();
    // The busiest junction on the map, and the Combine's.
    const { state, event } = resolveRimEvent(s, { kind: 'ion_storm', systemId: 'ilv-2', turns: 2 });
    expect(event.visibleTo).toBeNull();
    expect(stormbound(state, 'ilv-2')).toBe(true);
    expect(tradeRoutes(state).some((r) => r.blockedAt.includes('ilv-2'))).toBe(true);
    const before = routeEarnings(s);
    const during = routeEarnings(state);
    expect(during.uncollected).toBeGreaterThan(before.uncollected);
    // Drajk is the smuggler; `runsBlockade` lets it through weather as it does
    // through a blockade.
    expect(during.shares['drajk'] ?? 0).toBeGreaterThanOrEqual(before.shares['drajk'] ?? 0);
    const weather = severedBy(state, 'ilv-2');
    expect(runsBlockade(state, 'drajk', weather)).toBe(true);
    expect(runsBlockade(state, 'meridian', weather)).toBe(false);
    // Nobody resents weather: no power's standing moved.
    for (const f of state.factions) expect(f.disposition).toEqual(s.factions.find((x) => x.id === f.id)!.disposition);
    // It passes: two turns on, the lanes open.
    const later = { ...state, turn: state.turn + 3 };
    expect(stormbound(later, 'ilv-2')).toBe(false);
  });

  it('a derelict is found by whoever is over unaligned ground, and stays there', () => {
    const s = fresh();
    const empty = s.systems.find((x) => x.controllerFactionId === null)!;
    empty.ships['drajk'] = { escort: 2 };
    const { state, event } = resolveRimEvent(s, {
      kind: 'derelict', factionId: 'drajk', systemId: empty.id, find: 'crew', crewOf: 'vigil',
    });
    const found = state.assets.at(-1)!;
    expect(found.heldBy).toBe('drajk');
    expect(found.atSystemId).toBe(empty.id);
    expect(found.kind).toBe('prisoners');
    // Worth most to the power that lost them.
    expect(assetWorthTo(found, 'vigil')).toBeGreaterThan(assetWorthTo(found, 'meridian'));
    expect(event.visibleTo).toContain('drajk');
  });

  it('unrest costs an occupier its garrison, and a world with nobody left slips', () => {
    const s = fresh();
    const w = s.systems.find((x) => x.homeFactionId === 'vigil')!;
    w.controllerFactionId = 'drajk';
    w.garrison = 2;
    for (const id of Object.keys(w.ships)) delete w.ships[id];
    const { state, event } = resolveRimEvent(s, { kind: 'unrest', factionId: 'drajk', systemId: w.id });
    const after = sys(state, w.id);
    expect(after.controllerFactionId).toBeNull();
    // The rising is the militia: unaligned is not undefended.
    expect(after.garrison).toBeGreaterThan(0);
    expect(event.text).toMatch(/answers to nobody/);
  });

  it('unrest does not take a world whose holder has a fleet overhead', () => {
    const s = fresh();
    const w = s.systems.find((x) => x.homeFactionId === 'vigil')!;
    w.controllerFactionId = 'drajk';
    w.garrison = 2;
    w.ships = { drajk: { battleship: 1 } };
    const { state } = resolveRimEvent(s, { kind: 'unrest', factionId: 'drajk', systemId: w.id });
    expect(sys(state, w.id).controllerFactionId).toBe('drajk');
    expect(sys(state, w.id).garrison).toBe(0);
  });

  it('a border incident costs standing both ways, and everyone hears of it', () => {
    const s = fresh();
    const { state, event } = resolveRimEvent(s, {
      kind: 'border_incident', factionIds: ['meridian', 'vigil'], systemId: 'tor-1',
    });
    expect(regard(state, 'meridian', 'vigil')).toBe(Math.max(-100, regard(s, 'meridian', 'vigil') - BORDER_INCIDENT_COST));
    expect(regard(state, 'vigil', 'meridian')).toBe(Math.max(-100, regard(s, 'vigil', 'meridian') - BORDER_INCIDENT_COST));
    expect(event.visibleTo).toBeNull();
  });

  it('a shortage raises what every buyer would pay, and only while it lasts', () => {
    const s = fresh();
    const salvage = s.assets.find((a) => a.kind === 'salvage')!;
    const { state } = resolveRimEvent(s, { kind: 'shortage', assetKind: 'salvage' });
    expect(shortageFactor(state, 'salvage')).toBe(SHORTAGE_FACTOR);
    expect(shortageFactor(state, 'ore')).toBe(1);
    // Read, never written: the asset itself is untouched.
    expect(state.assets.find((a) => a.id === salvage.id)!.valuePerUnit).toEqual(salvage.valuePerUnit);
    expect(assetWorthTo(salvage, 'vigil', shortageFactor(state, 'salvage'))).toBeGreaterThan(
      assetWorthTo(salvage, 'vigil'),
    );
    expect(shortageFactor({ ...state, turn: state.turn + 10 }, 'salvage')).toBe(1);
  });

  it('a mutiny needs dissent, and takes a squadron by the attrition path', () => {
    const s = fresh();
    expect(eligibleRimEvents(s).find((e) => e.kind === 'mutiny')).toBeUndefined();
    s.factions.find((f) => f.id === 'vigil')!.dissent = MUTINY_DISSENT;
    const pool = eligibleRimEvents(s).find((e) => e.kind === 'mutiny')!;
    expect(pool.candidates.map((c) => c.subjects[0])).toEqual(['vigil']);
    const { state, event } = resolveRimEvent(s, { kind: 'mutiny', factionId: 'vigil' });
    expect(fleetTonsOf(state, 'vigil')).toBeLessThan(fleetTonsOf(s, 'vigil'));
    // A power's own affairs.
    expect(event.visibleTo).toEqual(['vigil']);
  });
});

describe('the four boons', () => {
  it('a rich seam pays a few turns of that world\'s own income, once', () => {
    const s = fresh();
    const before = s.factions.find((f) => f.id === 'drajk')!.credits;
    const { state, event } = resolveRimEvent(s, { kind: 'rich_seam', factionId: 'drajk', systemId: 'ark-5' });
    const gained = state.factions.find((f) => f.id === 'drajk')!.credits - before;
    expect(gained).toBeGreaterThan(0);
    expect(event.text).toContain(String(gained));
  });

  it('leans a rich seam toward the poorest net', () => {
    const s = fresh();
    const pool = eligibleRimEvents(s).find((e) => e.kind === 'rich_seam')!;
    const weightOf = (id: string) =>
      pool.candidates.filter((c) => c.subjects[0] === id).reduce((n, c) => n + c.weight, 0);
    // Meridian is the richest power on the opening board, Drajk the poorest.
    expect(weightOf('drajk')).toBeGreaterThan(weightOf('meridian'));
  });

  it('volunteers raise a garrison toward its ceiling and no further', () => {
    const s = fresh();
    const w = s.systems.find((x) => x.controllerFactionId === 'freeworlds')!;
    w.garrison = w.garrisonMax - 1;
    const { state } = resolveRimEvent(s, { kind: 'volunteers', factionId: 'freeworlds', systemId: w.id });
    expect(sys(state, w.id).garrison).toBe(w.garrisonMax);
  });

  it('free captains join the smallest fleet most often, and nobody is billed', () => {
    const s = fresh();
    const pool = eligibleRimEvents(s).find((e) => e.kind === 'free_captains')!;
    const smallest = [...s.factions].sort((a, b) => fleetTonsOf(s, a.id) - fleetTonsOf(s, b.id))[0]!.id;
    const top = pool.candidates.reduce((a, b) => (b.weight > a.weight ? b : a));
    expect(top.subjects[0]).toBe(smallest);
    const w = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    const credits = s.factions.find((f) => f.id === 'drajk')!.credits;
    const { state } = resolveRimEvent(s, { kind: 'free_captains', factionId: 'drajk', systemId: w.id });
    expect(hullsAt(sys(state, w.id), 'drajk')).toBe(hullsAt(w, 'drajk') + 3);
    expect(state.factions.find((f) => f.id === 'drajk')!.credits).toBe(credits);
  });

  it('envoys pass only between powers at war whose war has gone quiet', () => {
    const s = fresh();
    // The Vigil and Drajk open at war, and nobody has fought yet.
    s.turn = ENVOYS_QUIET_TURNS - 1;
    expect(eligibleRimEvents(s).find((e) => e.kind === 'envoys_of_peace')).toBeUndefined();
    s.turn = ENVOYS_QUIET_TURNS;
    const pool = eligibleRimEvents(s).find((e) => e.kind === 'envoys_of_peace')!;
    expect(pool.candidates.map((c) => c.subjects.join('|'))).toContain('drajk|vigil');
    // A battle resets the clock.
    s.lastClash[clashKey('vigil', 'drajk')] = s.turn - 1;
    expect(
      eligibleRimEvents(s)
        .find((e) => e.kind === 'envoys_of_peace')
        ?.candidates.some((c) => c.subjects.join('|') === 'drajk|vigil') ?? false,
    ).toBe(false);
    const { state, event } = resolveRimEvent(fresh(), {
      kind: 'envoys_of_peace', factionIds: ['drajk', 'vigil'], quietFor: 6,
    });
    expect(regard(state, 'vigil', 'drajk')).toBe(regard(fresh(), 'vigil', 'drajk') + ENVOYS_GOODWILL);
    expect(event.visibleTo).toEqual(['drajk', 'vigil']);
  });

  it('records who fought whom, so a war is quiet only when it is', () => {
    let s = fresh();
    // The Vigil and Drajk share a border; send the Vigil across it.
    const adj = buildAdjacency(s.systems);
    const target = s.systems.find(
      (x) =>
        x.controllerFactionId === 'drajk' &&
        [...(adj.get(x.id) ?? [])].some((y) => sys(s, y).controllerFactionId === 'vigil'),
    )!;
    const from = sys(s, [...adj.get(target.id)!].find((y) => sys(s, y).controllerFactionId === 'vigil')!);
    from.ships['vigil'] = { battleship: 30, lifter: 6 };
    s = applyOps(
      s,
      [{ op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: from.id, targetId: target.id,
        force: { battleship: 30, lifter: 6 } }],
      'model',
      'vigil',
    ).state;
    s = tickTurn(s).state;
    expect(s.lastClash[clashKey('vigil', 'drajk')]).toBe(s.turn);
  });
});

describe('what a power may know', () => {
  it('keeps a rival\'s mutiny out of the player\'s view and briefing', () => {
    const s = fresh();
    s.factions.find((f) => f.id === 'vigil')!.dissent = 50;
    const { state } = resolveRimEvent(s, { kind: 'mutiny', factionId: 'vigil' });
    expect(worldAsSeenBy(state, 'freeworlds').rimEvents).toEqual([]);
    expect(worldAsSeenBy(state, 'freeworlds').eventLog.some((e) => e.kind === 'rim')).toBe(false);
    expect(briefingFromState(state).events).toEqual([]);
    expect(worldAsSeenBy(state, 'vigil').rimEvents).toHaveLength(1);
  });

  it('briefs this turn\'s event and a storm still in force, and keeps both on a resume', () => {
    let s = fresh();
    s = resolveRimEvent(s, { kind: 'ion_storm', systemId: 'ilv-2', turns: 3 }).state;
    const now = briefingFromState(s);
    expect(now.events.map((e) => e.kind)).toEqual(['ion_storm']);
    expect(now.events[0]!.ongoing).toBe(false);
    expect(now.quiet).toBe(false);
    s = tickTurn(s, { randomEvents: false }).state;
    const later = briefingFromState(s);
    expect(later.events[0]!.ongoing).toBe(true);
  });
});

describe('replay', () => {
  it('rebuilds a campaign whose ticks carried events, exactly', () => {
    const c = Campaign.start('freeworlds', 'rim', new MemoryCampaignStore());
    for (let t = 0; t < 12; t++) c.tick();
    expect(c.state.rimEvents.length).toBeGreaterThan(0);
    expect(c.verifyReplay().ok).toBe(true);
  });

  it('replays a journal from before events without any', () => {
    const c = Campaign.start('freeworlds', 'old', new MemoryCampaignStore());
    for (let t = 0; t < 12; t++) c.tick();
    const old = replay({ ...c.journal, version: 9 }).state;
    expect(old.rimEvents).toEqual([]);
  });
});

describe('the flavour line', () => {
  it('may not bring a number the plain line does not have', () => {
    const plain = 'Mutiny in the Iron Vigil Remnant\'s fleet: crews take 12 tons of shipping and go.';
    expect(flavourKeepsTheFacts(plain, 'Twelve tons of it, gone into the dark.')).toBe(true);
    expect(flavourKeepsTheFacts(plain, 'The 12 tons will not be back.')).toBe(true);
    expect(flavourKeepsTheFacts(plain, '40 crews walk off with 12 tons.')).toBe(false);
    // Spelled out is still a number.
    expect(flavourKeepsTheFacts(plain, 'Forty crews walk off.')).toBe(false);
    expect(flavourKeepsTheFacts('The lanes close for 3 turns.', 'Three turns of dead air.')).toBe(true);
    expect(flavourKeepsTheFacts('The lanes close for 3 turns.', 'Nine turns of dead air.')).toBe(false);
    const seam = 'A rich seam is struck on Tulgarn: Drajk banks 63 credits, 3 turns of what the world pays.';
    expect(flavourKeepsTheFacts(seam, 'Sixty-three credits out of the rock, three turns of it at once.')).toBe(true);
    expect(flavourKeepsTheFacts(seam, 'Sixty-four credits out of the rock.')).toBe(false);
  });

  const played = async () => {
    const session = new GameSession(new MemoryCampaignStore(), () => {});
    await session.newCampaign('freeworlds', 'dressed');
    // End turns until the Rim does something the player can see.
    for (let t = 0; t < 12; t++) {
      const out = await session.endTurn();
      const event = out.briefing.events.find((e) => !e.ongoing);
      if (event) return { session, out, event };
    }
    throw new Error('twelve turns and nothing visible happened');
  };

  it('never holds the turn: the plain line comes back first, the dressed one on a later push', async () => {
    flavour.fail = false;
    flavour.line = 'Word comes down the lanes, and nobody is surprised.';
    const { session, event } = await played();
    expect(event.flavour).toBeNull();
    await session.dressing;
    const dressed = session.view().briefing!.events.find((e) => e.id === event.id)!;
    expect(dressed.flavour).toBe(flavour.line);
    expect(dressed.text).toBe(event.text);
  });

  it('keeps the plain line when the call fails or invents a number', async () => {
    flavour.fail = true;
    const a = await played();
    await a.session.dressing;
    expect(a.session.view().briefing!.events.find((e) => e.id === a.event.id)!.flavour).toBeNull();

    flavour.fail = false;
    flavour.line = 'It cost 9999 of something, they say.';
    const b = await played();
    await b.session.dressing;
    expect(b.session.view().briefing!.events.find((e) => e.id === b.event.id)!.flavour).toBeNull();
  });

  it('is never state: the journal and the save carry none of it', async () => {
    flavour.fail = false;
    flavour.line = 'Word comes down the lanes.';
    const { session } = await played();
    await session.dressing;
    expect(JSON.stringify(session.view().state.rimEvents)).not.toContain(flavour.line);
  });
});
