import { STAT_NAMES, type StatName } from '../domain/checks.js';
import { ASSET_ARCHETYPES, fixtureYieldFor } from '../domain/assets.js';
import { EFFECT_CATEGORIES } from '../domain/development.js';
import { FIXTURE_COST, MAX_FIXTURE_BONUS, MAX_FIXTURES_PER_WORLD } from '../domain/diplomacy.js';
import { CATEGORY_FLOORS } from '../domain/duration.js';
import {
  WORLD_TYPE_STAT,
  effectiveStats,
  fixtureBonus,
  fixtureSlotRefusal,
  fixtureUpkeepForCount,
  fixturesRunBy,
  getFaction,
  getSystem,
  statFixturesAt,
  type WorldState,
} from '../domain/state.js';

/**
 * What the player could build on one of their worlds, for the System tab.
 *
 * The rules were all in the game and none of them were on the screen: the
 * ground decides which kinds may stand (each must name the stat the world's
 * type makes), a world carries two and no two alike, and the price is a fixed
 * outlay plus an upkeep that rises with how many a power runs. A player learnt
 * them from the help text or from a rejection. This lists the kinds the ground
 * allows, says why any of them cannot go up here now, and prices the next one
 * against the player's own count — the same rules the reducer applies, read
 * from the same functions, so the list cannot promise what the order refuses.
 *
 * Pure, beside `layout.ts` and `portrait.ts`, because there is no DOM in the
 * suite and logic inside a component is logic nothing checks.
 */
export type FixtureOption = {
  kind: string;
  /** "Chamber Of Commerce" — the slug as a building's name. */
  name: string;
  spread: { stat: StatName; points: number }[];
  /** Why it cannot go up here now (a kind already standing or being raised, or no room). */
  refusal: string | null;
  /** Stats it would raise that cannot rise further: already 20, or fixtures at their clamp. */
  wasted: StatName[];
};

export type FixtureOptions = {
  ground: StatName;
  room: number;
  cost: number;
  /** The shortest a founding programme can run. */
  turns: number;
  /** What the next fixture adds to the player's upkeep, a turn. */
  upkeepAdded: number;
  /** Which fixture of theirs it would be, counting ones under construction. */
  ordinal: number;
  credits: number;
  kinds: FixtureOption[];
};

export function fixtureName(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Null unless the player holds the world: a fixture is raised only on ground you hold. */
export function fixtureOptions(state: WorldState, systemId: string): FixtureOptions | null {
  const me = state.playerFactionId;
  const site = getSystem(state, systemId);
  if (!site || site.controllerFactionId !== me) return null;
  const ground = WORLD_TYPE_STAT[site.worldType];

  const raising = state.pendingOrders.filter(
    (o) => o.factionId === me && o.onComplete?.kind === 'found_fixture',
  );
  const here = raising.filter((o) => o.targetId === systemId).length;
  const room = Math.max(0, MAX_FIXTURES_PER_WORLD - statFixturesAt(state, systemId).length - here);
  const running = fixturesRunBy(state, me) + raising.length;

  const stats = effectiveStats(state, me);
  const bonus = fixtureBonus(state, me);
  const kinds = ASSET_ARCHETYPES.filter((a) => a.fixture && a.modifies?.includes(ground))
    // The pure kind first — it is the whole budget on the stat the ground
    // makes — then the splits in stat order of their other attribute.
    .sort(
      (a, b) =>
        a.modifies!.length - b.modifies!.length ||
        STAT_NAMES.indexOf(a.modifies!.find((x) => x !== ground) ?? ground) -
          STAT_NAMES.indexOf(b.modifies!.find((x) => x !== ground) ?? ground),
    )
    .map((a) => {
      const spread = fixtureYieldFor(a)?.stats ?? [];
      return {
        kind: a.kind,
        name: fixtureName(a.kind),
        spread,
        refusal: fixtureSlotRefusal(state, site, a.kind),
        wasted: spread
          .map((x) => x.stat)
          .filter((stat) => stats[stat] >= 20 || (bonus[stat] ?? 0) >= MAX_FIXTURE_BONUS),
      };
    });

  return {
    ground,
    room,
    cost: FIXTURE_COST,
    turns: Math.min(...EFFECT_CATEGORIES.found_fixture.map((c) => CATEGORY_FLOORS[c])),
    upkeepAdded: fixtureUpkeepForCount(running + 1) - fixtureUpkeepForCount(running),
    ordinal: running + 1,
    credits: getFaction(state, me)?.credits ?? 0,
    kinds,
  };
}

/** The sentence a player can send to found one — what the help text's example says. */
export function foundingLine(kind: string, worldName: string): string {
  const name = kind.replace(/_/g, ' ');
  // By sound, not letter: "an arsenal", "a university". No kind starts with a
  // vowel that is not one of those two cases.
  return `Build ${/^[aeio]/.test(name) ? 'an' : 'a'} ${name} at ${worldName}.`;
}

export type Buildable = {
  systemId: string;
  name: string;
  options: FixtureOptions;
  /** The first kind that can go up there now and gains something: what a button offers. */
  suggest: FixtureOption;
};

/**
 * Every world of the player's with a free slot and something worth building in
 * it, best world first — for the System tab when no world is chosen, so the
 * buttons are not hidden behind finding the right world on the map first. The
 * suggestion is the first kind `fixtureOptions` lists that can go up now and
 * would raise something, so it agrees with the full list on that world.
 */
export function buildableWorlds(state: WorldState): Buildable[] {
  return state.systems
    .filter((x) => x.controllerFactionId === state.playerFactionId)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))
    .flatMap((site) => {
      const options = fixtureOptions(state, site.id);
      if (!options || options.room === 0) return [];
      const suggest = options.kinds.find((k) => k.refusal === null && k.wasted.length < k.spread.length);
      return suggest ? [{ systemId: site.id, name: site.name, options, suggest }] : [];
    });
}
