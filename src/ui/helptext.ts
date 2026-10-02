import { STAT_NAMES } from '../domain/checks.js';
import { EFFECT_CATEGORIES } from '../domain/development.js';
import {
  FIXTURE_COST,
  MAX_ASSET_STAT,
  MAX_FIXTURE_BONUS,
  MAX_FIXTURES_PER_WORLD,
} from '../domain/diplomacy.js';
import { fixtureKindFor } from '../domain/initiative.js';
import { CATEGORY_FLOORS } from '../domain/duration.js';
import {
  CREDITS_PER_TON,
  HULL_CLASSES,
  HULL_SPEC,
  LIFTER_CARRY,
  UPKEEP_PER_TON,
  type HullClass,
} from '../domain/hulls.js';
import {
  WORLD_TYPE_STAT,
  fixtureUpkeepForCount,
  type WorldState,
  type WorldType,
} from '../domain/state.js';
import { worldTypeLabel } from './worldtext.js';

/**
 * The help text's ship-class and fixture sections, built from the game's own
 * tables rather than typed out.
 *
 * The section these replace said "four hull classes" for as long as there have
 * been six — prose about numbers is a second opinion that goes stale without
 * anyone noticing, the drift `prompt-drift.test.ts` exists to catch in the
 * prompts. Here every price, tonnage, floor and upkeep is read where it is
 * charged, and a test holds the lines to them. Pure and DOM-free so that test
 * can run, the reason `layout.ts` and `portrait.ts` live here too.
 */

/**
 * What each class is for, in a line. Keyed on every class, so a seventh fails
 * the typecheck here rather than being left out of the help. Short enough that
 * a row fits the feed's width with the rest of the help — longer, and the
 * table wraps into a ragged column.
 */
const JOB: Record<HullClass, string> = {
  battleship: 'the line, and what wins the exchange',
  escort: 'the screen: lost first, turns torpedoes aside',
  torpedo_boat: 'fires once, first, at the heaviest hulls',
  lifter: `carries ${LIFTER_CARRY} troops — the only way to take a world`,
  freighter: 'more of the trade over unclaimed ground',
  listener: 'sees what is under way where it stands',
};

/** A class too light to count in the exchange: it is there to be protected. */
const UNARMED = 0.1;

function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function shipClassLines(): string[] {
  const plural = (h: HullClass) => `${HULL_SPEC[h].label}s`;
  const unarmed = HULL_CLASSES.filter((h) => HULL_SPEC[h].orbitalWeight < UNARMED).map(plural);
  const byLoss = [...HULL_CLASSES].sort((a, b) => HULL_SPEC[a].lossOrder - HULL_SPEC[b].lossOrder);
  const first = byLoss[0]!;
  const last = byLoss.at(-1)!;
  return [
    `SHIP CLASSES — ${CREDITS_PER_TON} credits a ton to build, ${UPKEEP_PER_TON} a ton every turn after`,
    ...HULL_CLASSES.map((h) => {
      const { label, tonnage } = HULL_SPEC[h];
      const cost = `${tonnage * CREDITS_PER_TON}cr`;
      return `  ${label.padEnd(13)} ${tonnage}t ${cost.padStart(5)}  ${JOB[h]}`;
    }),
    `  ${capitalise(names(unarmed))} cannot fight. Losses fall on ${plural(first)}`,
    `  first and ${plural(last)} last, so a screen is what brings a convoy home.`,
  ];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The fixture section, with an example built on a world the player could
 * actually build on — a held world with no fixture, and the kind its ground
 * takes — so it can be typed verbatim, the way `exampleActions` is.
 */
export function fixtureLines(state: WorldState | null): string[] {
  const types = Object.keys(WORLD_TYPE_STAT) as WorldType[];
  const ground = STAT_NAMES.map((stat) => {
    const kinds = types.filter((t) => WORLD_TYPE_STAT[t] === stat).map(worldTypeLabel);
    return `    ${stat.padEnd(10)} ${kinds.join(', ')}`;
  });
  const turns = Math.min(...EFFECT_CATEGORIES.found_fixture.map((c) => CATEGORY_FLOORS[c]));
  const nth = (n: number) => fixtureUpkeepForCount(n) - fixtureUpkeepForCount(n - 1);
  const example = state ? exampleFixture(state) : null;
  return [
    'FIXTURES — what a world can be built into',
    '  A fixture is a building that raises your stats while you hold its world:',
    `  a factory, a military base, a stock exchange. Each world carries ${count(MAX_FIXTURES_PER_WORLD)},`,
    '  no two of the same kind, and its ground decides which: each must raise',
    '  the stat the ground does.',
    ...ground,
    `  It gives +${MAX_ASSET_STAT} to one stat, or +${MAX_ASSET_STAT / 2} to each of two. All of yours together`,
    `  add at most +${MAX_FIXTURE_BONUS} to any one stat. It costs ${FIXTURE_COST} credits and at least ${turns} turns`,
    '  of construction on a world you hold, and the bill rises with how many you',
    `  run: your first costs ${nth(1)} a turn, your second ${nth(2)}, your third ${nth(3)}. Every`,
    '  power opens with one. Whoever holds the world when it finishes owns it,',
    '  and taking a world takes what is built on it.',
    ...(example ? [`  Try: ${example}`] : []),
  ];
}

function exampleFixture(state: WorldState): string | null {
  const me = state.playerFactionId;
  const pick = state.systems
    .filter((s) => s.controllerFactionId === me)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))
    .map((s) => ({ site: s, kind: fixtureKindFor(state, me, s) }))
    .find((p) => p.kind !== null);
  return pick ? `Build a ${pick.kind!.replace(/_/g, ' ')} at ${pick.site.name}.` : null;
}

const WORDS = ['none', 'one', 'two', 'three', 'four'];
function count(n: number): string {
  return WORDS[n] ?? String(n);
}
