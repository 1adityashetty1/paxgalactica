import { statModifier, type StatName } from './checks.js';
import { HEAT_NOTORIOUS } from './heat.js';
import { battleshipEquivalents } from './hulls.js';
import { neighboursOf } from './graph.js';
import { isBlockaded } from './trade.js';
import {
  WORLD_TYPE_STAT,
  effectiveStats,
  stackAt,
  warsFor,
  type StarSystem,
  type WorldState,
} from './state.js';
import type { BattleReport } from './battle.js';

/**
 * A world's regard for each power — its **standing** with them — and the two
 * things it decides: whom an independent world joins, and whether a held world
 * stays. `docs/design-2026-10-06-standing.md`.
 *
 * One number per world per power, −100 to 100, on `StarSystem.regard`. It
 * drifts toward a baseline (home ground loves its own power; someone else's
 * home resents its occupier; everything else is indifferent), is moved by what
 * powers do to and for the world, and is read three ways:
 *
 * - **content**: a held world at `CONTENT_REGARD` or better toward its holder
 *   stays with no help;
 * - **held down**: otherwise it needs the holder's warships over it, scaled by
 *   the world's value and by how far short of content it is, and a resolute
 *   holder's warships count for more (`HOLD_PER_RESOLVE`);
 * - **joined**: an independent world at `JOIN_REGARD` toward one power, and
 *   `JOIN_LEAD` clear of the next, joins it.
 *
 * A held world that is neither content nor held down is *restless*: its
 * garrison deserts, and when the garrison is gone it secedes. That half lives
 * in the tick, beside the garrison it eats; this module is the arithmetic.
 */

/** A world's baseline regard for its own power. Content, with nobody doing anything. */
export const HOME_REGARD = 50;
/**
 * A world's baseline regard for a power holding it that is not its home power,
 * when it has one. It remembers whose it was, and never forgives on its own:
 * a conquered home world has to be pacified or held down for as long as it is
 * held.
 */
export const OCCUPIED_HOME_REGARD = -30;
/** How fast regard drifts back to its baseline: a tenth of the gap a turn, rounded up — the fade intel uses. */
export const REGARD_FADE = 0.1;
/** At or above this toward its holder, a world needs no force to keep it. */
export const CONTENT_REGARD = 20;
/**
 * Battleship-equivalents needed = strategic value × (content − regard) / this.
 * So a fresh conquest (−60) of a value-5 world needs 4, and an indifferent
 * world (0) of the same value needs 1. Scaled by value for the reason
 * `OCCUPATION_COST` is: a rich world is harder to hold down than a poor one.
 */
export const HOLD_DIVISOR = 100;
/**
 * How much more a warship holds down per point of the holder's effective
 * resolve modifier. Resolve is the stat whose description is *unrest
 * suppressed*: at +4 (the Vigil, Arkane) a warship holds down half as much
 * again; at 0 (Meridian, the Combine) exactly itself.
 */
export const HOLD_PER_RESOLVE = 0.125;
/** A world taken by force: the conqueror's regard there drops at least this low. */
export const CONQUEST_REGARD = -60;
/** Each attacker in a battle fought over a world loses this much of its regard. */
export const BATTLE_REGARD = 15;
/** An independent world conquered: every other independent world thinks this much less of the conqueror. */
export const RIM_WATCHES_REGARD = 25;
/** A raid on a world, a turn, toward the raider it can name. */
export const RAID_REGARD = 10;
/** A notorious power, a turn, at every world. */
export const NOTORIOUS_REGARD = 2;
/** A standing want kept met (protection, trade, peace), a turn. */
export const WANT_REGARD = 8;
/** A one-off want landed (development, arms): a programme of the kind it asked for. */
export const WANT_ONCE_REGARD = 20;
/** What one point of an envoy's magnitude is worth, before the sender's influence. */
export const ENVOY_PER_POINT = 5;
/** Independent world joins the power it regards at least this well… */
export const JOIN_REGARD = 60;
/** …when that power is this far clear of the next. */
export const JOIN_LEAD = 20;
/** A world that rises against its holder thinks this much less of it afterwards. */
export const SECESSION_REGARD = 20;
/** How much of a power's battle line has to stand over a world to count as protecting it. */
export const PROTECTION_LINE = 1;

/** What a world wants, keyed on the stat its ground makes — legible from the map. */
export type Want = 'arms' | 'trade' | 'development' | 'peace' | 'protection';
export const WANT_OF_STAT: Record<StatName, Want> = {
  might: 'arms',
  guile: 'trade',
  industry: 'development',
  influence: 'peace',
  resolve: 'protection',
};
/** What meeting each want takes, in one clause. */
export const WANT_MEANS: Record<Want, string> = {
  arms: 'a fortification programme you pay for there',
  trade: 'your freighters over it, and its lanes open',
  development: 'a development programme you pay for there',
  peace: 'you at war with nobody',
  protection: 'your warships over it, and no raid on it',
};

export function wantOf(system: StarSystem): Want {
  return WANT_OF_STAT[WORLD_TYPE_STAT[system.worldType]];
}

/** Whether this campaign keeps regard at all — false for a journal from before version 17. */
export function regardRecorded(state: { systems: readonly StarSystem[] }): boolean {
  return state.systems.some((s) => Object.keys(s.regard ?? {}).length > 0);
}

/** Where a world's regard for a power drifts when nobody does anything. */
export function baselineRegard(system: StarSystem, factionId: string): number {
  if (system.homeFactionId === factionId) return HOME_REGARD;
  if (system.controllerFactionId === factionId && system.homeFactionId !== null) return OCCUPIED_HOME_REGARD;
  return 0;
}

/** A world's regard for a power, falling back on the baseline where nothing is recorded. */
export function regardFor(system: StarSystem, factionId: string): number {
  return system.regard?.[factionId] ?? baselineRegard(system, factionId);
}

/** The opening record for one world, in faction order, so the key order is a function of the board. */
export function seedRegard(system: StarSystem, factionIds: readonly string[]): Record<string, number> {
  return Object.fromEntries(factionIds.map((id) => [id, baselineRegard(system, id)]));
}

/**
 * How much a warship of this power holds down: 1, plus `HOLD_PER_RESOLVE` a
 * point of resolve modifier.
 *
 * **Resolve before dissent**, the cut `spanOfControl` makes for influence.
 * Read after it, the power this was scaled for is the one it fails: the Iron
 * Vigil runs at 100 dissent from about turn 60 in the harness, with or without
 * any of this, which takes its resolve from 18 to 9 — and its warships from
 * holding half as much again to holding less than anybody's. Terrain, fixtures,
 * an officer's passive and an operative's debuff still reach it.
 */
export function holdingFactor(state: WorldState, factionId: string): number {
  return Math.max(
    0,
    1 + statModifier(effectiveStats(state, factionId, { dissent: false }).resolve) * HOLD_PER_RESOLVE,
  );
}

export interface Hold {
  holder: string;
  regard: number;
  content: boolean;
  /** Battleship-equivalents of the holder's own the world needs over it; 0 when content. */
  need: number;
  /** What it has, already scaled by the holder's resolve. */
  have: number;
  /** `need - have`, never below zero: how far from held down. */
  shortfall: number;
}

/**
 * How a held world stands with its holder: content, held down, or neither.
 * `null` for an independent world. `factor` may be passed in when the caller
 * already knows it, since it reads `effectiveStats`.
 */
export function holdAt(state: WorldState, system: StarSystem, factor?: number): Hold | null {
  const holder = system.controllerFactionId;
  if (holder === null) return null;
  const regard = regardFor(system, holder);
  const content = regard >= CONTENT_REGARD;
  const need = content ? 0 : (system.strategicValue * (CONTENT_REGARD - regard)) / HOLD_DIVISOR;
  const have = battleshipEquivalents(stackAt(system, holder)) * (factor ?? holdingFactor(state, holder));
  return { holder, regard, content, need, have, shortfall: Math.max(0, need - have) };
}

/** Whether a power is meeting this world's want this turn. One-off wants are credited where they land. */
export function meetsWant(state: WorldState, system: StarSystem, factionId: string): boolean {
  const holder = system.controllerFactionId;
  // A world's want is answered by whoever holds it, or by anyone while it is
  // its own. A rival's ships over somebody else's world are not protection.
  if (holder !== null && holder !== factionId) return false;
  const here = stackAt(system, factionId);
  switch (wantOf(system)) {
    case 'protection':
      return (
        battleshipEquivalents(here) >= PROTECTION_LINE &&
        !state.pendingOrders.some((o) => o.type === 'commerce_raiding' && o.targetId === system.id && o.progress > 0)
      );
    case 'trade':
      return (here.freighter ?? 0) > 0 && !isBlockaded(state, system.id);
    case 'peace': {
      if (warsFor(state, factionId).length > 0) return false;
      if (holder === factionId) return true;
      // An independent world hears of a power's peace from its neighbours.
      return (
        battleshipEquivalents(here) > 0 ||
        neighboursOf(state, system.id).some(
          (n) => state.systems.find((x) => x.id === n)?.controllerFactionId === factionId,
        )
      );
    }
    case 'arms':
    case 'development':
      return false;
  }
}

/** What happened this turn that moves regard, gathered by the tick. */
export interface RegardEvents {
  battles: readonly BattleReport[];
  /** Works delivered on a world: develop_system and fortify, by whom. */
  landed: readonly { systemId: string; factionId: string; kind: 'develop_system' | 'fortify' }[];
}

const clampRegard = (n: number): number => Math.max(-100, Math.min(100, Math.round(n)));

/**
 * Move every world's regard for every power by a turn: the drift toward the
 * baseline, the wants met, raids and notoriety, and then the shocks of the
 * turn's battles — so a world taken this turn reads its grievance at once.
 *
 * Mutates `state` in place, as `accrueIntel` does. Each record is rebuilt in
 * faction order, so its key order never depends on the history.
 */
export function accrueRegard(state: WorldState, happened: RegardEvents): void {
  const ids = state.factions.map((f) => f.id);
  const notorious = new Set(state.factions.filter((f) => (f.heat ?? 0) >= HEAT_NOTORIOUS).map((f) => f.id));
  const raidedBy = new Map<string, Set<string>>();
  for (const o of state.pendingOrders) {
    // A raid run dark names nobody, so nobody is blamed until it is traced.
    if (o.type !== 'commerce_raiding' || o.progress <= 0 || o.dark) continue;
    (raidedBy.get(o.targetId) ?? raidedBy.set(o.targetId, new Set()).get(o.targetId)!).add(o.factionId);
  }
  const landed = new Map<string, Set<string>>();
  for (const w of happened.landed) {
    const system = state.systems.find((s) => s.id === w.systemId);
    if (!system) continue;
    const want = wantOf(system);
    const answers =
      (want === 'development' && w.kind === 'develop_system') || (want === 'arms' && w.kind === 'fortify');
    const holder = system.controllerFactionId;
    if (!answers || (holder !== null && holder !== w.factionId)) continue;
    (landed.get(w.systemId) ?? landed.set(w.systemId, new Set()).get(w.systemId)!).add(w.factionId);
  }

  for (const system of state.systems) {
    const next: Record<string, number> = {};
    for (const id of ids) {
      const was = regardFor(system, id);
      const base = baselineRegard(system, id);
      const gap = base - was;
      let r = was + Math.sign(gap) * Math.ceil(Math.abs(gap) * REGARD_FADE);
      if (meetsWant(state, system, id)) r += WANT_REGARD;
      if (landed.get(system.id)?.has(id)) r += WANT_ONCE_REGARD;
      if (raidedBy.get(system.id)?.has(id)) r -= RAID_REGARD;
      if (notorious.has(id)) r -= NOTORIOUS_REGARD;
      next[id] = clampRegard(r);
    }
    system.regard = next;
  }

  for (const battle of happened.battles) {
    const system = state.systems.find((s) => s.id === battle.systemId);
    if (!system) continue;
    const attackers = new Set(battle.rounds.flatMap((r) => r.attackers.map((c) => c.factionId)));
    attackers.delete(battle.holderBefore ?? '');
    // Taking station over a world is not a battle over it. Only a fight with
    // its defenders, or a landing on it, is.
    const fought = battle.rounds.some(
      (r) => r.defenders.length > 0 || (r.phase === 'ground' && r.outcome !== 'no_lift'),
    );
    if (fought) {
      for (const a of attackers) system.regard[a] = clampRegard(regardFor(system, a) - BATTLE_REGARD);
    }
    const taker = battle.holderAfter;
    if (taker === null || taker === battle.holderBefore) continue;
    // Its own power coming home is a liberation, not a conquest.
    if (system.homeFactionId !== taker) {
      system.regard[taker] = Math.min(regardFor(system, taker), CONQUEST_REGARD);
    }
    if (battle.holderBefore === null) {
      for (const other of state.systems) {
        if (other.id === system.id || other.controllerFactionId !== null) continue;
        other.regard[taker] = clampRegard(regardFor(other, taker) - RIM_WATCHES_REGARD);
      }
    }
  }
}

/** The envoy's worth: `ENVOY_PER_POINT` a point, plus the sender's influence modifier once. */
export function envoyRegard(state: WorldState, factionId: string, magnitude: number): number {
  return Math.max(1, magnitude * ENVOY_PER_POINT + statModifier(effectiveStats(state, factionId).influence));
}

/** Whom an independent world would join now, if anybody. */
export function joinsWhom(system: StarSystem, factionIds: readonly string[]): string | null {
  if (system.controllerFactionId !== null) return null;
  const ranked = factionIds
    .map((id) => ({ id, r: regardFor(system, id) }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const [best, second] = ranked;
  if (!best || best.r < JOIN_REGARD) return null;
  if (second && best.r - second.r < JOIN_LEAD) return null;
  return best.id;
}

/** Whether a power may send an envoy to this world: its own, or an independent world it is in reach of. */
export function envoyRefusal(state: WorldState, system: StarSystem, factionId: string): string | null {
  const holder = system.controllerFactionId;
  if (holder !== null && holder !== factionId) {
    return `${system.name} answers to another power; an envoy goes to a world of your own, or to one that answers to nobody.`;
  }
  if (holder === factionId) return null;
  const reach =
    battleshipEquivalents(stackAt(system, factionId)) > 0 ||
    (system.ships?.[factionId] !== undefined) ||
    neighboursOf(state, system.id).some(
      (n) => state.systems.find((x) => x.id === n)?.controllerFactionId === factionId,
    );
  return reach ? null : `Nothing of yours is near ${system.name}; an envoy needs a world of yours next to it, or ships over it.`;
}
