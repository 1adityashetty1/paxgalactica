import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import { CheatSchema, CHEAT_ASSET_KINDS, type Cheat } from '../src/domain/cheats.js';
import { ExtractionOpSchema, ModelOpSchema } from '../src/domain/ops.js';
import { activeCommanders, MAX_ACTIVE_COMMANDERS } from '../src/domain/command.js';
import { fleetTonsOf, hullsAt, statFixturesAt, type WorldState } from '../src/domain/state.js';
import { MAX_FIXTURES_PER_WORLD } from '../src/domain/diplomacy.js';
import { createSeedState } from '../src/seed/scenario.js';
import { serializeRecentLog } from '../src/model/serialize.js';
import { dispatch } from '../src/server/router.js';
import { GameSession } from '../src/server/session.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { ROUTES } from '../src/api/contract.js';

/**
 * The cheat menu: fixed actions, applied without the arbiter, and never told
 * to any model. See `src/domain/cheats.ts`.
 */

const seed = () => createSeedState('freeworlds');
const cheat = (s: WorldState, c: Cheat) => applyOps(s, [{ op: 'cheat', cheat: c }], 'cheat', undefined, true);
const held = (s: WorldState, id: string) => s.systems.find((x) => x.controllerFactionId === id)!;
const credits = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;

describe('each cheat does exactly its one thing', () => {
  it('adds credits', () => {
    const s = seed();
    const out = cheat(s, { kind: 'credits', factionId: 'freeworlds', amount: 500 });
    expect(out.rejections).toEqual([]);
    expect(credits(out.state, 'freeworlds')).toBe(credits(s, 'freeworlds') + 500);
  });

  it('moves one disposition, clamped', () => {
    const s = seed();
    const before = s.factions.find((f) => f.id === 'vigil')!.disposition['drajk'] ?? 0;
    const out = cheat(s, { kind: 'disposition', factionId: 'vigil', towardFactionId: 'drajk', delta: -25 });
    expect(out.state.factions.find((f) => f.id === 'vigil')!.disposition['drajk']).toBe(Math.max(-100, before - 25));
  });

  it('creates ships for nothing, where the power stands', () => {
    const s = seed();
    const world = held(s, 'freeworlds');
    const out = cheat(s, { kind: 'ships', factionId: 'freeworlds', systemId: world.id, hull: 'escort', count: 10 });
    expect(out.rejections).toEqual([]);
    expect(hullsAt(out.state.systems.find((x) => x.id === world.id)!, 'freeworlds')).toBe(hullsAt(world, 'freeworlds') + 10);
    // Free: the yards bill nothing, however large the order.
    expect(credits(out.state, 'freeworlds')).toBe(credits(s, 'freeworlds'));
    expect(fleetTonsOf(out.state, 'freeworlds')).toBeGreaterThan(fleetTonsOf(s, 'freeworlds'));
  });

  it('appoints an officer for nothing, of the school asked for', () => {
    const s = seed();
    const world = held(s, 'meridian');
    const out = cheat(s, { kind: 'officer', factionId: 'meridian', systemId: world.id, archetype: 'assault' });
    expect(out.rejections).toEqual([]);
    const hired = out.state.commanders.at(-1)!;
    expect(hired).toMatchObject({ factionId: 'meridian', archetype: 'assault', atSystemId: world.id, status: 'active' });
    expect(credits(out.state, 'meridian')).toBe(credits(s, 'meridian'));
  });

  it('places a haul held by the world\'s holder, and a fixture that pays', () => {
    const s = seed();
    const world = held(s, 'drajk');
    const ore = cheat(s, { kind: 'asset', archetype: 'ore', systemId: world.id });
    expect(ore.rejections).toEqual([]);
    expect(ore.state.assets.at(-1)).toMatchObject({ kind: 'ore', heldBy: 'drajk', atSystemId: world.id, portable: true });

    const free = s.systems.find((x) => x.controllerFactionId === 'drajk' && statFixturesAt(s, x.id).length === 0)!;
    const plant = cheat(s, { kind: 'asset', archetype: 'factory', systemId: free.id });
    expect(plant.rejections).toEqual([]);
    expect(statFixturesAt(plant.state, free.id)[0]).toMatchObject({ kind: 'factory', portable: false, heldBy: 'drajk' });
  });
});

describe('fixed and bounded — the menu cannot put the world anywhere', () => {
  it('admits only the listed values', () => {
    expect(CheatSchema.safeParse({ kind: 'credits', factionId: 'drajk', amount: 1_000_000 }).success).toBe(false);
    expect(CheatSchema.safeParse({ kind: 'disposition', factionId: 'drajk', towardFactionId: 'vigil', delta: -100 }).success).toBe(false);
    expect(CheatSchema.safeParse({ kind: 'ships', factionId: 'drajk', systemId: 'x', hull: 'battleship', count: 500 }).success).toBe(false);
    expect(CheatSchema.safeParse({ kind: 'asset', archetype: 'officer', systemId: 'x' }).success).toBe(false);
    expect(CheatSchema.safeParse({ kind: 'asset', archetype: 'a_planet_of_gold', systemId: 'x' }).success).toBe(false);
    expect(CHEAT_ASSET_KINDS).not.toContain('operative');
  });

  it('keeps the shape of the world: two fixtures a world and no two alike, five officers a power, ships somewhere real', () => {
    const s = seed();
    const home = held(s, 'freeworlds');
    let full = s;
    for (const kind of ['factory', 'hospital', 'university']) {
      if (statFixturesAt(full, home.id).length >= MAX_FIXTURES_PER_WORLD) break;
      if (statFixturesAt(full, home.id).some((a) => a.kind === kind)) continue;
      full = cheat(full, { kind: 'asset', archetype: kind, systemId: home.id }).state;
    }
    expect(statFixturesAt(full, home.id)).toHaveLength(MAX_FIXTURES_PER_WORLD);
    expect(cheat(full, { kind: 'asset', archetype: 'stock_exchange', systemId: home.id }).rejections).toHaveLength(1);
    const bare = s.systems.find((x) => x.controllerFactionId === 'freeworlds' && statFixturesAt(s, x.id).length === 0)!;
    const one = cheat(s, { kind: 'asset', archetype: 'factory', systemId: bare.id }).state;
    expect(cheat(one, { kind: 'asset', archetype: 'factory', systemId: bare.id }).rejections).toHaveLength(1);

    let st = s;
    while (activeCommanders(st.commanders, 'freeworlds').length < MAX_ACTIVE_COMMANDERS) {
      st = cheat(st, { kind: 'officer', factionId: 'freeworlds', systemId: home.id, archetype: 'convoy' }).state;
    }
    expect(cheat(st, { kind: 'officer', factionId: 'freeworlds', systemId: home.id, archetype: 'convoy' }).rejections).toHaveLength(1);

    const theirs = held(s, 'vigil');
    expect(cheat(s, { kind: 'ships', factionId: 'freeworlds', systemId: theirs.id, hull: 'battleship', count: 1 }).rejections).toHaveLength(1);
  });
});

describe('it never passes through a model', () => {
  const op = { op: 'cheat', cheat: { kind: 'credits', factionId: 'freeworlds', amount: 2000 } };

  it('is in no schema a model is handed', () => {
    expect(ModelOpSchema.safeParse(op).success).toBe(false);
    expect(ExtractionOpSchema.safeParse(op).success).toBe(false);
  });

  it('is refused from every source but the menu, and a menu batch carries nothing else', () => {
    for (const source of ['model', 'engine', 'extraction'] as const) {
      const out = applyOps(seed(), [op], source, 'freeworlds', true);
      expect(out.rejections.map((r) => r.code)).toEqual(['reducer_only']);
      expect(credits(out.state, 'freeworlds')).toBe(credits(seed(), 'freeworlds'));
    }
    const smuggled = applyOps(seed(), [{ op: 'adjust_credits', factionId: 'freeworlds', delta: 100 }], 'cheat', undefined, true);
    expect(smuggled.rejections.map((r) => r.code)).toEqual(['reducer_only']);
  });
});

describe('no model is ever told the world was edited', () => {
  it('logs privately, under a kind no prompt is handed — refusals included', () => {
    const s = seed();
    let st = cheat(s, { kind: 'credits', factionId: 'vigil', amount: 2000 }).state;
    st = cheat(st, { kind: 'ships', factionId: 'freeworlds', systemId: held(st, 'vigil').id, hull: 'escort', count: 1 }).state;
    const entries = st.eventLog.filter((e) => /cheat/i.test(e.text));
    expect(entries.length).toBe(2);
    for (const e of entries) {
      expect(e.kind).toBe('cheat');
      expect(e.visibleTo).toEqual(['freeworlds']);
    }
    // Neither the player's own prompts nor any rival's.
    for (const viewer of st.factions.map((f) => f.id)) {
      expect(serializeRecentLog(st, viewer, 500)).not.toMatch(/cheat/i);
    }
  });
});

describe('through the server', () => {
  it('costs no action, replays exactly, and is refused on a finished campaign like any mutation', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('freeworlds', 'cheat-test');
    const before = (await dispatch(session, 'GET', ROUTES.campaign, {})).body as { actionPoints: { left: number } };
    const res = await dispatch(session, 'POST', ROUTES.cheat, { kind: 'credits', factionId: 'freeworlds', amount: 100 });
    expect(res.status).toBe(200);
    expect((res.body as { notes: string[] }).notes.join(' ')).toMatch(/100 credits/);
    const after = (await dispatch(session, 'GET', ROUTES.campaign, {})).body as { actionPoints: { left: number } };
    expect(after.actionPoints.left).toBe(before.actionPoints.left);

    const bad = await dispatch(session, 'POST', ROUTES.cheat, { kind: 'credits', factionId: 'freeworlds', amount: 99 });
    expect(bad.status).toBe(400);

    const campaign = (session as unknown as { campaign: { verifyReplay(): { ok: boolean } } }).campaign;
    expect(campaign.verifyReplay().ok).toBe(true);
  });
});
