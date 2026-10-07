import { HEAT_DECAY, HEAT_NOTORIOUS } from '../domain/heat.js';
import { DARK_RAID_YIELD } from '../domain/trade.js';
import { RIM_BOONS, RIM_EVENT_RATE, RIM_HAZARDS } from '../domain/events.js';
import {
  COMMANDER_ARCHETYPES,
  COMMANDER_COST,
  COMMANDER_UPKEEP,
  MAX_ACTIVE_COMMANDERS,
  VETERAN_THRESHOLDS,
} from '../domain/command.js';
import { STAT_NAMES } from '../domain/checks.js';
import { EFFECT_CATEGORIES } from '../domain/development.js';
import { EFFECT_COST } from '../domain/development.js';
import {
  COMMODITY_CAP,
  COMMODITY_PER_TURN,
  COMMODITY_VALUE,
  FIXTURE_COST,
  MAX_ASSET_STAT,
  MAX_FIXTURE_BONUS,
  MAX_FIXTURES_PER_WORLD,
  NOTE_TERM_TURNS,
  OBLIGATION_TERM_TURNS,
  TRUCE_BREAKING_REPUTATION_COST,
  TRUCE_TURNS,
  ULTIMATUM_MAX_DEADLINE,
  BOUNTY_PER_TON,
} from '../domain/diplomacy.js';
import { EMISSION_RANGE } from '../domain/intel.js';
import { CONTENT_REGARD, JOIN_LEAD, JOIN_REGARD, WANT_MEANS, WANT_OF_STAT } from '../domain/regard.js';
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
  SPAN_BASE,
  SPAN_DISSENT_PER_WORLD,
  TRUCE_FLOOR,
  WORLD_TYPE_STAT,
  fixtureUpkeepForCount,
  type WorldState,
  type WorldType,
} from '../domain/state.js';
import { worldTypeLabel } from './worldtext.js';
import { foundingLine } from './fixtureoptions.js';

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
  listener: `sees work where it stands; hears raids ${EMISSION_RANGE} jumps out`,
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
    '  A saboteur can wreck one, a point of what it yields at a time, and it',
    `  still costs its upkeep; a repair programme puts it back, ${EFFECT_COST.repair_fixture} a point.`,
    ...(example ? [`  Try: ${example}`] : []),
  ];
}

/**
 * How much ground a power can govern, and what holding more costs. A line of
 * its own because it is a standing cost with a cause the player can act on.
 */
export function spanLines(): string[] {
  return [
    '  You can govern only so many worlds: your homeland, or more with good',
    `  influence (${SPAN_BASE} plus its modifier). Each world past that costs`,
    `  ${SPAN_DISSENT_PER_WORLD} dissent every turn — conquest is braked by administration.`,
  ];
}

/**
 * What a world thinks of you, and what that decides. Generated from the want
 * table and the thresholds, so the help cannot promise a figure the tick does
 * not use. See `regard.ts`.
 */
export function worldLines(): string[] {
  return [
    'WORLDS WITH A VIEW OF THEIR OWN',
    '  Every world has a standing with every power. One that answers to nobody',
    `  joins the power it regards at ${JOIN_REGARD} or better, ${JOIN_LEAD} clear of the next:`,
    '  send it an envoy, and give it what it wants. A world you hold stays while',
    `  it is content with you (${CONTENT_REGARD} or better) or held down by your warships`,
    '  over it — fewer of them the higher your resolve. Neither, and its garrison',
    '  deserts until it rises and answers to nobody. An operative sent to incite',
    "  a world another power holds turns it against them — never on their home.",
    '  What a world wants, by the stat its ground makes:',
    ...STAT_NAMES.map((stat) => {
      const want = WANT_OF_STAT[stat];
      return `    ${stat.padEnd(10)}${want.padEnd(12)}${WANT_MEANS[want]}`;
    }),
  ];
}

/** Truces, promissory notes and goods: the things that pay for keeping peace. */
export function peaceLines(): string[] {
  return [
    'PEACE, FAVOURS AND GOODS',
    '  A peace signed between two powers at war leaves a truce: neither may',
    `  attack the other for ${TRUCE_TURNS} turns, and their standing heals toward ${TRUCE_FLOOR} —`,
    '  just out of war, and no further. Attacking across one costs 25 with the',
    `  victim and ${TRUCE_BREAKING_REPUTATION_COST} with every other power.`,
    '  Every power holds one promissory note, a favour signed in advance. Give',
    '  yours away and the holder may call it in, with no need to ask: a trade',
    `  accord, a defence pact, basing rights or a line of credit, for ${NOTE_TERM_TURNS} turns.`,
    '  Every power also makes goods it cannot use, worth nothing to it and',
    `  ${COMMODITY_VALUE} a unit to whoever it gives them to — ${COMMODITY_PER_TURN} a turn, piling up to ${COMMODITY_CAP}.`,
    '  A trade accord can send them across every turn it holds.',
  ];
}

function exampleFixture(state: WorldState): string | null {
  const me = state.playerFactionId;
  const pick = state.systems
    .filter((s) => s.controllerFactionId === me)
    .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))
    .map((s) => ({ site: s, kind: fixtureKindFor(state, me, s) }))
    .find((p) => p.kind !== null);
  return pick ? foundingLine(pick.kind!, pick.site.name) : null;
}

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six'];
function count(n: number): string {
  return WORDS[n] ?? String(n);
}

/** Favours, secrets, ultimatums and the budget a power negotiates within. */
export function leverageLines(): string[] {
  return [
    'LEVERAGE',
    '  A favour owed can be called in, unasked: the power that owes it signs a',
    `  non-aggression pact, a ceasefire or a trade accord for ${OBLIGATION_TERM_TURNS} turns, or backs`,
    '  an ultimatum of yours. Favours come from accords, from debts you forgive,',
    '  and from blackmail.',
    '  A watcher of yours can dig up proof of what its host hides: an operative,',
    '  a secret programme, an unpaid debt. Publish it to cost them standing with',
    '  everyone, or keep it quiet for a hook that never stops being useful.',
    `  An ultimatum is a public demand with a deadline of up to ${ULTIMATUM_MAX_DEADLINE} turns. Others`,
    '  may back either side; at the deadline it is given way to, or it is war.',
    '  Every power can give up only so much in one conversation. The channel',
    '  shows how much; your influence and your leverage over them widen it.',
  ];
}

/** "half", for a yield of a half, so the line reads as prose. */
function darkShare(): string {
  return DARK_RAID_YIELD === 0.5 ? 'half' : `${Math.round(DARK_RAID_YIELD * 100)}% of`;
}

/** The raider's ledger and heat, from the constants that run them. */
export function raiderLines(): string[] {
  return [
    "THE RAIDER'S LEDGER, AND HEAT",
    '  Post a bounty on a power and your credits wait in escrow: prizes raided',
    `  from it pay out credit for credit, its hulls destroyed ${BOUNTY_PER_TON} a ton.`,
    '  A raid can run dark — say so when you order it: "raid it quietly, no',
    '  colours". Nobody is told whose it is and it costs no standing or heat',
    `  while it stays dark, but it takes ${darkShare()} the prizes. Each power it robs`,
    '  may trace it, helped by listeners nearby; traced, it runs open, they',
    '  resent it double, and they hold proof to publish or blackmail you with.',
    '  Raiders you cannot name show up on your Trade tab as what they took.',
    '  A raider can be paid to leave you alone (protection) or to go after',
    '  your enemy (a letter of marque). Both are contracts, agreed in a channel.',
    '  Covert work, unlicensed raids and broken pacts make a power notorious.',
    `  Heat fades ${HEAT_DECAY} a turn; from ${HEAT_NOTORIOUS} the Rim answers: crackdowns, a price`,
    '  on your head, contacts turned, a neighbour massing on your border.',
  ];
}

/** Officers, from the table and constants that run them. */
export function officerLines(): string[] {
  const [seasoned, veteran] = VETERAN_THRESHOLDS;
  return [
    'OFFICERS',
    `  Up to ${count(MAX_ACTIVE_COMMANDERS)} in post, ${COMMANDER_COST} to appoint and ${COMMANDER_UPKEEP} a turn to keep. Each`,
    '  is of one school, and helps only in a battle they are at:',
    ...COMMANDER_ARCHETYPES.map((a) => `  · ${a.effect} — ${a.phase}`),
    '  Name one in an order and they sail with that fleet. They grow better',
    `  after ${seasoned} engagements and again after ${veteran}, and fall or are taken when`,
    '  the fleet around them does. A captured officer can be ransomed home,',
    '  and the senior one in post also improves something at home.',
  ];
}

/** The Rim's own events, from the weights that run them. */
export function rimLines(): string[] {
  const oneIn = Math.round(1 / RIM_EVENT_RATE);
  return [
    'THE RIM MOVES ON ITS OWN',
    `  About one turn in ${count(oneIn)}, something happens nobody ordered: one of`,
    `  ${count(RIM_HAZARDS.length)} hazards, which lean on whoever is ahead, or one of ${count(RIM_BOONS.length)} boons, which`,
    '  lean on whoever is behind. Never two in a turn. A card in the feed says',
    '  what happened and what it changed; storms and shortages last a while.',
  ];
}
