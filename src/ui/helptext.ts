import { HEAT_DECAY, HEAT_NOTORIOUS } from '../domain/heat.js';
import { DARK_RAID_YIELD } from '../domain/trade.js';
import { RIM_BOONS, RIM_EVENT_RATE, RIM_EVENT_TITLE, RIM_HAZARDS, RIM_NOTORIETY } from '../domain/events.js';
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
  AGENT_COST,
  AGENT_JUMPS_PER_TURN,
  MISSION_PROFILE,
  NOTE_VALUE,
  PLEDGE_REACH,
  type AgentMission,
  type TreatyType,
} from '../domain/diplomacy.js';
import { EXHAUSTION_INDEMNITY_SHARE, EXHAUSTION_RATIO, EXHAUSTION_RUNWAY_TURNS } from '../domain/leverage.js';
import {
  INTEL_DELIVERS,
  INTEL_DIG,
  INTEL_MEMORY_TURNS,
  INTEL_OPERATIVES,
  INTEL_TYPED,
} from '../domain/intel-levels.js';
import { ASSET_ARCHETYPES } from '../domain/assets.js';
import { MAX_DEBT_PRINCIPAL } from '../domain/debt.js';
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
  AGENT_UPKEEP,
  MAX_AGENTS_BASE,
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
    '  a world another power holds turns it against them, hardest at home.',
    '  What a world wants, by the stat its ground makes:',
    ...STAT_NAMES.map((stat) => {
      const want = WANT_OF_STAT[stat];
      return `    ${stat.padEnd(10)}${want.padEnd(12)}${WANT_MEANS[want]}`;
    }),
  ];
}

/** Truces and promissory notes: the things that pay for keeping peace. */
export function peaceLines(): string[] {
  return [
    'PEACE AND FAVOURS',
    '  A peace signed between two powers at war leaves a truce: neither may',
    `  attack the other for ${TRUCE_TURNS} turns, and their standing heals toward ${TRUCE_FLOOR} —`,
    '  just out of war, and no further. Attacking across one costs 25 with the',
    `  victim and ${TRUCE_BREAKING_REPUTATION_COST} with every other power.`,
    '  Every power holds one promissory note, a favour signed in advance. Give',
    '  yours away and the holder may call it in, with no need to ask: a trade',
    `  accord, a defence pact, basing rights or a line of credit, for ${NOTE_TERM_TURNS} turns.`,
  ];
}

/** A power's own goods: worthless to it, and the reason peace pays every turn. */
export function goodsLines(): string[] {
  return [
    'GOODS',
    '  Every power makes goods it cannot use, worth nothing to it and',
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
    "THE RAIDER'S LEDGER",
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
  ];
}

/** Notoriety, from the constants that run it. */
export function heatLines(): string[] {
  return [
    'HEAT',
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

/**
 * Fold prose to the feed's width, each line indented. The help's sections
 * that list things out of a table — events by title, archetypes by kind —
 * cannot be wrapped by hand, since the list is whatever the table holds.
 */
export function wrap(text: string, indent = '  ', width = 76): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      out.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out;
}

/**
 * What each mission does, in a phrase. Keyed on every mission, so a new one
 * fails the typecheck here rather than being missing from the help.
 */
const MISSION_JOB: Record<AgentMission, string> = {
  surveillance: 'watches a world: hidden work there shows',
  theft: 'skims credits off the world it sits on',
  subversion: 'wears down one of the holder\'s stats',
  sabotage: 'wrecks hulls and fixtures',
  defection: 'talks crews into your service',
  discord: 'sets the holder against a third power',
  incitement: 'turns a world against whoever holds it',
  assassination: 'one strike, at a power or a named officer',
};

/** Operatives, from the mission table that prices and risks them. */
export function operativeLines(): string[] {
  return [
    'OPERATIVES',
    '  Recruiting one is an action, at a world you hold; sending them on a',
    `  mission is another. They travel ${AGENT_JUMPS_PER_TURN} jumps a turn and cost ${AGENT_UPKEEP} a turn`,
    `  to keep. How many you can run is ${MAX_AGENTS_BASE} plus your guile modifier. Each`,
    '  mission is paid when they are sent; a failure can get them caught,',
    '  and a caught operative is a prisoner the other side can ransom.',
    '  Risk is the chance in twenty that a failed turn gets them caught.',
    `    ${'mission'.padEnd(14)}${'cost'.padStart(5)}  risk`,
    ...(Object.keys(MISSION_JOB) as AgentMission[]).map((m) => {
      const cost = `${AGENT_COST[m]}cr`;
      const risk = `${MISSION_PROFILE[m].exposureRisk}/20`;
      return `    ${m.padEnd(14)}${cost.padStart(5)}  ${risk.padStart(4)}  ${MISSION_JOB[m]}`;
    }),
    '  Say what you want done in plain words — "put a watcher on Vantic" —',
    '  and the arbiter routes it here. The Agents tab tracks every one.',
  ];
}

/** Intel with memory, and what knowing a power well buys. */
export function intelLines(): string[] {
  return [
    'INTEL',
    '  Everything you cannot see is a rumour until somebody of yours is',
    '  standing in it: a watcher, or a listener over the world. What you see',
    `  you remember for ${INTEL_MEMORY_TURNS} turns after the sight is lost.`,
    '  The longer you watch a power, the better you know it:',
    `    ${String(INTEL_TYPED).padStart(3)}  its rumours say what kind of work it is`,
    `    ${String(INTEL_DELIVERS).padStart(3)}  …and what the work will deliver`,
    `    ${String(INTEL_OPERATIVES).padStart(3)}  its operatives on your worlds show`,
    `    ${String(INTEL_DIG).padStart(3)}  your watchers dig deeper, and trace its dark raids`,
    '  A watcher, or a listener over their world, teaches fastest; a listener',
    '  nearby half as fast; a trade accord or a battle a little. A',
    '  counter-intelligence programme on your own ground wears their picture',
    '  of you down and catches their people there more often.',
    '  A watcher can also dig up proof of what its host hides — an operative,',
    '  a secret programme, an unpaid debt — to publish, or to blackmail with.',
  ];
}

/**
 * What each treaty type does, in a phrase. Keyed on every type, so a new one
 * fails the typecheck here rather than being missing from the help.
 */
const TREATY_JOB: Record<TreatyType, string> = {
  non_aggression: 'neither attacks the other; breaking it is public',
  ceasefire: 'hostilities stop for a set number of turns',
  mutual_defense: 'an attack on one, by anyone, brings the other in',
  coalition: 'the same, but only against the powers it names',
  trade_accord: 'lanes stay open between you; goods can flow',
  basing_rights: 'one\'s fleets may sit in the other\'s systems',
  tribute: 'one pays the other every turn to be left alone',
  contract: 'paid work: a hire, a charter, a letter of marque',
  cession: 'worlds change hands, once; a price may ride along',
};

/** Talking, and what it takes to make anything said real. */
export function channelLines(): string[] {
  return [
    'CHANNELS',
    '  /talk <power> opens a conversation; time does not pass while it is',
    '  open. Nothing said is binding until /endtalk, when what was actually',
    '  agreed is written down — a refusal or a maybe produces nothing. A power',
    '  may also ask to talk to you after a turn; it is an invitation only.',
  ];
}

/** The treaty types, from the type list. */
export function treatyLines(): string[] {
  return [
    'TREATIES — agreed in a channel, never declared',
    ...(Object.keys(TREATY_JOB) as TreatyType[]).map(
      (t) => `    ${t.replace(/_/g, ' ').replace('defense', 'defence').padEnd(16)}${TREATY_JOB[t]}`,
    ),
    '  One conversation can produce several. Breaking one is your choice, and',
    '  it costs you with the other party and with everyone watching.',
  ];
}

/** Allies, and the peace a power sues for when its wars outrun it. */
export function allyLines(): string[] {
  const share = EXHAUSTION_INDEMNITY_SHARE === 0.25 ? 'a quarter' : `${Math.round(EXHAUSTION_INDEMNITY_SHARE * 100)}%`;
  return [
    'ALLIES',
    '  A mutual defence pact answers an attack by anyone; a coalition answers',
    '  only the powers it names, and they resent it. Either way, an attack on',
    '  one puts the other at war with the attacker, and the warships it',
    `  pledged come from worlds within ${count(PLEDGE_REACH)} jumps, once a turn. An ally already`,
    '  at peace with the attacker is not called.',
    `  A power whose enemies together outweigh it ${count(EXHAUSTION_RATIO)} to one, or whose wars`,
    `  are eating its last ${count(EXHAUSTION_RUNWAY_TURNS)} turns of savings, sues one of them for peace and`,
    `  pays ${share} of its treasury for it, and gives more away at the table.`,
  ];
}

/** The Rim's events by title, from the lists that draw them. */
export function eventListLines(): string[] {
  const titles = (kinds: readonly string[]) =>
    kinds.map((k) => RIM_EVENT_TITLE[k as keyof typeof RIM_EVENT_TITLE]).join(', ');
  return [
    ...wrap(`Hazards: ${titles(RIM_HAZARDS)}.`),
    ...wrap(`Boons: ${titles(RIM_BOONS)}.`),
    ...wrap(
      `And for a notorious power, from heat ${HEAT_NOTORIOUS}: ${titles(RIM_NOTORIETY)}. Each eases the heat it answers.`,
    ),
  ];
}

/** Assets, from the catalogue that anchors them. */
export function assetLines(): string[] {
  const things = ASSET_ARCHETYPES.filter((a) => !a.fixture).length;
  return [
    'ASSETS — things that are neither credits nor ships',
    '  Prisoners, a dossier, a relic, a hold of ore, a chart: worth different',
    '  amounts to different powers, which is what makes them worth trading.',
    `  The game knows ${things} kinds and will hear of more. Every one is won by`,
    '  attempting something, never by claiming it, and sits on a world —',
    '  take the world and you take what is on it. The Assets tab lists yours.',
    '  · people — prisoners, a captured officer or operative: worth most to',
    '    the power that lost them. Hand them home, sell them on, or question',
    '    them for a dossier; each is remembered.',
    '  · paper — a dossier, a seal, a charter. A promissory note is a favour',
    `    signed in advance, worth ${NOTE_VALUE} to anyone but the power that wrote it.`,
    '  · debts and loans — money owed and paid down by instalment, up to',
    `    ${MAX_DEBT_PRINCIPAL}; or a squadron, credits or a thing lent and expected back.`,
    '    Agreed in a channel; missing a payment costs standing every turn.',
  ];
}
