import type { ActKind } from '../domain/act-kinds.js';
import type { BattleOutcome, BattlePhase } from '../domain/battle.js';
import type { Want } from '../domain/regard.js';
import type { StatName } from '../domain/checks.js';
import type { AgentClass, CommanderArchetype } from '../domain/command.js';
import type { AgentMission, NoteKind, TreatyType } from '../domain/diplomacy.js';
import type { RimEventKind } from '../domain/events.js';
import type { FleetKind } from '../domain/fleets.js';
import type { HullClass } from '../domain/hulls.js';
import type { OrderType, TradeEthic, WarEthic, WorldType } from '../domain/state.js';
import { PAX_LEXICON } from './words.js';

/**
 * The lexicon the game writes in, read from a scope.
 *
 * `docs/design-2026-11-15-skins.md`, phase 2. Every word the game shows for a
 * role — a hull class, a terrain, a Rim event, a place, a unit of account —
 * comes from here, so a skin can change it and nothing else has to know.
 *
 * **A leaf, apart from types.** The domain reads it from deep inside the
 * reducer, and the skin's schema reads the domain's id tables at load, so a
 * runtime import from here into either would be a cycle that fails at module
 * evaluation. The default words therefore live in `words.ts`, which imports
 * nothing, and `SkinSchema` checks them as it checks any skin.
 *
 * **Read from a scope, not threaded**, the way `withNameStock` scopes the name
 * stock: whoever runs the engine for a campaign sets the campaign's lexicon
 * (`withLexicon`), and everything under it writes in those words. Until a
 * campaign can name its skin (phase 7) the scope is always Pax Galactica,
 * except in the tests that run the engine under the null lexicon to find the
 * words that do not come from here.
 */

/** A role a model writes by id: the id a skin gives it, the word it is shown as, and other words that mean it. */
export interface Word {
  id: string;
  word: string;
  synonyms: string[];
}

/** A role that is counted, so it needs a plural. */
export interface CountedWord extends Word {
  plural: string;
}

/** An officer school: its word, the part of a battle it helps, and how a report and a prompt describe it. */
export interface SchoolWord extends Word {
  /** Where in a battle it helps: "the landing". */
  phase: string;
  /** What it reads as in a battle report. */
  effect: string;
  /** Voice for a prompt: what this officer is known for. */
  known: string;
}

/** A kind of thing that can be held: what one of it is called ("40 crew"), what produces one, and who wants it. */
export interface AssetWord extends Word {
  unit: string;
  /** The kind of attempt that produces one, for the arbiter's rubric. */
  from: string;
  /** Who tends to want it, in words. Never a number: the board decides that. */
  wanted: string;
}

/** A word with no id: a place, a force or a unit of account, which no op names. */
export interface Term {
  word: string;
  plural: string;
  synonyms: string[];
}

/** The words for where things are, which every prompt and panel uses and no op names. */
export const PLACE_TERMS = ['world', 'system', 'sector', 'lane', 'hyperlane', 'jump', 'hub', 'orbit', 'garrison', 'yards', 'shipyard', 'berth', 'rim', 'space', 'galaxy'] as const;
export type PlaceTerm = (typeof PLACE_TERMS)[number];

/** The words for armed force in general, whatever its class: a hull, a fleet, a crew, a navy. */
export const FORCE_TERMS = ['hull', 'ship', 'warship', 'fleet', 'squadron', 'crew', 'navy', 'cargo', 'salvo', 'torpedo', 'voyage'] as const;
export type ForceTerm = (typeof FORCE_TERMS)[number];

/** The verbs a fleet does: it sails, and it lands. */
export const VERB_TERMS = ['sail', 'land'] as const;
export type VerbTerm = (typeof VERB_TERMS)[number];

/** A verb in the four forms English sentences need: "sail", "sails", "sailed", "sailing". */
export interface Verb {
  base: string;
  s: string;
  past: string;
  ing: string;
  synonyms: string[];
}

/** The units every price and every fleet is counted in. */
export const ACCOUNT_TERMS = ['credits', 'tons'] as const;
export type AccountTerm = (typeof ACCOUNT_TERMS)[number];

/**
 * The sentences a skin writes about the core's ids: what a stat covers, what
 * an ethic does, what a treaty binds. A skin owns the sentence and not only
 * the nouns in it, because "fleets, guns, invasions" is not a sentence any
 * lexicon word can turn into "hosts, siege engines, sieges". `{name}` marks a
 * number the core fills in (`meaning`).
 */
export interface Meanings {
  stats: Record<StatName, string>;
  warEthics: Record<WarEthic, string>;
  tradeEthics: Record<TradeEthic, string>;
  treatyTypes: Record<TreatyType, string>;
  notes: Record<NoteKind, string>;
  agentClasses: Record<AgentClass, string>;
  missions: Record<AgentMission, string>;
  acts: Record<ActKind, string>;
  battleOutcomes: Record<BattleOutcome, string>;
  wants: Record<Want, string>;
  unitJobs: Record<HullClass, string>;
  terrainLines: Record<WorldType, string>;
  finds: Record<'salvage' | 'blueprints' | 'prisoners', string>;
  difficulty: Record<string, string>;
  bands: Record<string, string>;
}

/** A word for every role. The shape `LexiconSchema` checks, typed by the domain's own ids. */
export interface Words {
  units: Record<HullClass, CountedWord>;
  terrains: Record<WorldType, Word>;
  orderCategories: Record<OrderType, Word>;
  assetKinds: Record<string, AssetWord>;
  rimEvents: Record<RimEventKind, Word>;
  treatyTypes: Record<TreatyType, Word>;
  schools: Record<CommanderArchetype, SchoolWord>;
  noteKinds: Record<NoteKind, Word>;
  phases: Record<BattlePhase, Word>;
  fleetKinds: Record<FleetKind, Word>;
  places: Record<PlaceTerm, Term>;
  forces: Record<ForceTerm, Term>;
  verbs: Record<VerbTerm, Verb>;
  accounts: Record<AccountTerm, Term>;
  meanings: Meanings;
}

let active: Words = PAX_LEXICON;

/** The lexicon in force. */
export function lexicon(): Words {
  return active;
}

/** Run with `words` as the lexicon, and put the outer one back afterwards whatever happens. */
export function withLexicon<T>(words: Words, run: () => T): T {
  const outer = active;
  active = words;
  try {
    return run();
  } finally {
    active = outer;
  }
}

/**
 * `withLexicon` across awaits: the lexicon stays set until `run` settles.
 *
 * The scope is one module variable, so this is only sound while nothing else
 * runs a campaign in another lexicon meanwhile — true of the suite, which uses
 * it to build prompts under the null lexicon, and of every campaign today,
 * which is in Pax Galactica. A server holding campaigns in two skins at once
 * needs the scope per request (phase 7), the way telemetry's spans already are.
 */
export async function withLexiconAsync<T>(words: Words, run: () => Promise<T>): Promise<T> {
  const outer = active;
  active = words;
  try {
    return await run();
  } finally {
    active = outer;
  }
}

const one = (n: number) => n === 1;

/** Fill a skin sentence's `{name}` marks with the core's numbers. A mark with no number throws. */
function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`meaning: no value for {${key}} in "${text}"`);
    return String(values[key]);
  });
}

/** One of a skin's sentences about an id, with its numbers filled in. */
export function meaning<T extends keyof Meanings>(
  table: T,
  key: keyof Meanings[T] & string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const text = (active.meanings[table] as Record<string, string>)[key];
  if (text === undefined) throw new Error(`meaning: no ${table}.${key}`);
  return fill(text, values);
}

/**
 * A table of a skin's sentences that reads the lexicon in force each time it is
 * read, so a table the domain exports — `STAT_MEANINGS`, `ACT_WORDS` — keeps
 * its name and its readers while the words live in the skin. Its keys are the
 * default lexicon's, which every skin's schema holds equal.
 */
export function liveMeanings<T extends keyof Meanings>(
  table: T,
  values: Readonly<Record<string, string | number>> = {},
): Readonly<Meanings[T]> {
  const live = {} as Record<string, string>;
  for (const key of Object.keys(PAX_LEXICON.meanings[table])) {
    Object.defineProperty(live, key, { enumerable: true, get: () => meaning(table, key as keyof Meanings[T] & string, values) });
  }
  return Object.freeze(live) as unknown as Readonly<Meanings[T]>;
}

/** A hull class's word, singular or plural for `n`. */
export function unitWord(hull: HullClass, n = 1): string {
  const w = active.units[hull];
  return one(n) ? w.word : w.plural;
}

/** "3 battleships", "1 torpedo boat". */
export function countUnits(hull: HullClass, n: number): string {
  return `${n} ${unitWord(hull, n)}`;
}

/** A place's word, singular or plural for `n`. */
export function placeWord(place: PlaceTerm, n = 1): string {
  const w = active.places[place];
  return one(n) ? w.word : w.plural;
}

/** A word for force in general, singular or plural for `n`. */
export function forceWord(force: ForceTerm, n = 1): string {
  const w = active.forces[force];
  return one(n) ? w.word : w.plural;
}

/** A unit of account's word, singular or plural for `n`. */
export function accountWord(account: AccountTerm, n = 2): string {
  const w = active.accounts[account];
  return one(n) ? w.word : w.plural;
}

/** "40 credits", "1 ton". */
export function amount(account: AccountTerm, n: number): string {
  return `${n} ${accountWord(account, n)}`;
}

/** A Rim event's title: what kind of thing happened. */
export function rimEventTitle(kind: RimEventKind): string {
  return active.rimEvents[kind].word;
}

/** A terrain's name, as the system panel and the help text show it. */
export function terrainName(type: WorldType): string {
  return active.terrains[type].word;
}

/** A Rim event's name inside a sentence: "an ion storm settles", "a rich seam is struck". */
export function rimEventWord(kind: RimEventKind): string {
  const title = active.rimEvents[kind].word;
  return title[0]!.toLowerCase() + title.slice(1);
}

/**
 * What an order category is called, a fleet movement included. A rumour or a
 * sighting stores its type as a plain string, so one outside the vocabulary is
 * shown as its id, spaced, rather than throwing.
 */
export function orderWord(category: OrderType | (string & {})): string {
  return (active.orderCategories as Record<string, Word>)[category]?.word ?? category.replace(/_/g, ' ');
}

/** What a treaty type is called; one outside the vocabulary is shown as its id, spaced. */
export function treatyWord(type: TreatyType | (string & {})): string {
  return (active.treatyTypes as Record<string, Word>)[type]?.word ?? type.replace(/_/g, ' ');
}

/** A promissory note's title. */
export function noteTitle(kind: NoteKind): string {
  return active.noteKinds[kind].word;
}

/** An officer school's words, read when asked for. */
export function schoolWords(kind: string): SchoolWord {
  const words = (active.schools as Record<string, SchoolWord>)[kind];
  if (!words) throw new Error(`lexicon: no school ${kind}`);
  return words;
}

/** What a fleet of a kind is called, before its number. */
export function fleetKindWord(kind: FleetKind): string {
  return active.fleetKinds[kind].word;
}

/** What one of a kind of thing is called: "crew", "chart", "fixture". A kind outside the catalogue is counted as itself. */
export function assetUnit(kind: string): string {
  return active.assetKinds[kind]?.unit ?? kind.replace(/_/g, ' ');
}

/** What a kind of thing is called in a sentence: "power plant", "prisoners". A kind outside the catalogue is shown as its id, spaced. */
export function assetKindWord(kind: string): string {
  return active.assetKinds[kind]?.word ?? kind.replace(/_/g, ' ');
}

/** A catalogue kind's words: its unit, what produces one and who wants it. */
export function assetWords(kind: string): AssetWord {
  const words = active.assetKinds[kind];
  if (!words) throw new Error(`lexicon: no asset kind ${kind}`);
  return words;
}

/* ------------------------------------------------------------------ */
/* say: prose with the lexicon's words in it                           */
/* ------------------------------------------------------------------ */

type TokenSource =
  | { family: 'places' | 'forces' | 'accounts'; key: string; plural: boolean }
  | { family: 'units'; key: HullClass; plural: boolean }
  | { family: 'verbs'; key: VerbTerm; form: Exclude<keyof Verb, 'synonyms'> };

function tokenTable(): Map<string, TokenSource> {
  const table = new Map<string, TokenSource>();
  const add = (family: 'places' | 'forces' | 'accounts', key: string, one: string, many: string | null) => {
    table.set(one, { family, key, plural: false });
    if (many) table.set(many, { family, key, plural: true });
  };
  add('places', 'world', 'world', 'worlds');
  add('places', 'system', 'system', 'systems');
  add('places', 'sector', 'sector', 'sectors');
  add('places', 'lane', 'lane', 'lanes');
  add('places', 'hyperlane', 'hyperlane', 'hyperlanes');
  add('places', 'jump', 'jump', 'jumps');
  add('places', 'hub', 'hub', 'hubs');
  add('places', 'orbit', 'orbit', 'orbits');
  add('places', 'garrison', 'garrison', 'garrisons');
  add('places', 'yards', 'yards', null);
  add('places', 'shipyard', 'shipyard', 'shipyards');
  add('places', 'berth', 'berth', 'berths');
  add('places', 'rim', 'rim', null);
  add('places', 'space', 'space', null);
  add('places', 'galaxy', 'galaxy', 'galaxies');
  add('forces', 'hull', 'hull', 'hulls');
  add('forces', 'ship', 'ship', 'ships');
  add('forces', 'warship', 'warship', 'warships');
  add('forces', 'fleet', 'fleet', 'fleets');
  add('forces', 'squadron', 'squadron', 'squadrons');
  add('forces', 'crew', 'crew', 'crews');
  add('forces', 'navy', 'navy', 'navies');
  add('forces', 'cargo', 'cargo', null);
  add('forces', 'salvo', 'salvo', 'salvos');
  add('forces', 'torpedo', 'torpedo', 'torpedoes');
  add('forces', 'voyage', 'voyage', 'voyages');
  for (const verb of ['sail', 'land'] as const) {
    table.set(verb, { family: 'verbs', key: verb, form: 'base' });
    table.set(`${verb}s`, { family: 'verbs', key: verb, form: 's' });
    table.set(`${verb}ed`, { family: 'verbs', key: verb, form: 'past' });
    table.set(`${verb}ing`, { family: 'verbs', key: verb, form: 'ing' });
  }
  add('accounts', 'credits', 'credit', 'credits');
  add('accounts', 'tons', 'ton', 'tons');
  for (const hull of ['battleship', 'escort', 'torpedo_boat', 'lifter', 'freighter', 'listener', 'courier'] as const) {
    table.set(hull, { family: 'units', key: hull, plural: false });
    table.set(`${hull}s`, { family: 'units', key: hull, plural: true });
  }
  return table;
}

const TOKENS = tokenTable();

/** The tokens `say` knows, by name: `world`, `worlds`, `credits`, `battleships` … */
export const SAY_TOKENS: readonly string[] = [...TOKENS.keys()];

/** A token's word in the lexicon in force. `{World}` is the same token, capitalised. */
function tokenWord(name: string): string {
  const shouting = name.length > 1 && name === name.toUpperCase();
  const lower = shouting ? name.toLowerCase() : name[0]!.toLowerCase() + name.slice(1);
  const source = TOKENS.get(lower);
  if (!source) throw new Error(`say: no lexicon token {${name}}`);
  const capital = (word: string) =>
    shouting ? word.toUpperCase() : name[0] === lower[0] ? word : word[0]!.toUpperCase() + word.slice(1);
  if (source.family === 'verbs') return capital(active.verbs[source.key][source.form]);
  const entry =
    source.family === 'units'
      ? active.units[source.key]
      : source.family === 'places'
        ? active.places[source.key as PlaceTerm]
        : source.family === 'forces'
          ? active.forces[source.key as ForceTerm]
          : active.accounts[source.key as AccountTerm];
  return capital(source.plural ? entry.plural : entry.word);
}

/** A token in a `say` template: a name in braces, `{world}`, `{Fleets}`, `{torpedo_boats}`, and `{SHIP}` for a heading in capitals. */
export const SAY_TOKEN = /\{([A-Za-z][A-Za-z_]*)\}/g;

/**
 * Prose written with the lexicon's words in it: say`Your {fleet} at ${name}`.
 *
 * The template's own text names a role by token — `{world}`, `{worlds}`,
 * `{credits}`, `{battleships}`, `{rim}` for "the Rim", capitalised for the
 * start of a sentence (`{Worlds}`) — and `say` fills each from the lexicon in
 * force, so the sentence a skin reads is in the skin's words and the source
 * holds none of Pax Galactica's. What is interpolated (`${name}`) is left as it
 * is: a name comes from the world, a count from arithmetic, and a word from a
 * lexicon helper (`unitWord`, `placeWord` …) already.
 *
 * An unknown token throws rather than printing braces at a player, so a typo
 * fails the first test that writes the sentence.
 */
export function say(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]!.replace(SAY_TOKEN, (_, name: string) => tokenWord(name));
    if (i < values.length) out += String(values[i]);
  }
  return out;
}
