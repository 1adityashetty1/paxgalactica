import { z } from 'zod';
import { ASSET_ARCHETYPES } from '../domain/assets.js';
import { BATTLE_OUTCOMES, BATTLE_PHASES } from '../domain/battle.js';
import { AGENT_CLASSES, COMMANDER_ARCHETYPES } from '../domain/command.js';
import { AGENT_MISSIONS, NOTE_KINDS, TREATY_TYPES } from '../domain/diplomacy.js';
import { DURATION_CATEGORIES } from '../domain/duration.js';
import { RIM_EVENT_KINDS as EVENT_KINDS } from '../domain/events.js';
import { FLEET_KINDS } from '../domain/fleets.js';
import { HULL_CLASSES } from '../domain/hulls.js';
import { MOVEMENT_ORDER_TYPE, TRADE_ETHICS, WAR_ETHICS, WORLD_TYPES, type WorldState } from '../domain/state.js';
import { ACCOUNT_TERMS, FORCE_TERMS, PEOPLE_TERMS, PLACE_TERMS, VERB_TERMS } from './lexicon.js';
import { PAX_LEXICON } from './words.js';
import { ACT_KINDS } from '../domain/act-kinds.js';
import { STAT_NAMES } from '../domain/checks.js';

/**
 * A skin: the words, names and art that sit over the core's mechanics.
 *
 * `docs/design-2026-11-15-skins.md`. A skin never changes a number. It names
 * the core's slots: every role a model or a player can read (the lexicon), the
 * five powers, the 25 systems and the four sectors, and the art each slot is
 * drawn with. Until phase 3 renumbers the core, its slots are keyed by today's
 * ids, so the Pax Galactica skin maps each id to itself.
 *
 * `SkinSchema` checks shape and completeness (every role in every family
 * labelled, stocks at their fixed sizes, every art key present). What a schema
 * cannot see — the skin's slots against the core's, a word used twice in a
 * family, a family name shared by two stocks, a skin word that could pass for
 * a core id — is `skinViolations`.
 */

/* ------------------------------------------------------------------ */
/* The forms ids and words take                                        */
/* ------------------------------------------------------------------ */

/**
 * The marked prefixes the core's role ids take from phase 3 (`u_line`,
 * `ev_uprising` …; decision 9). A skin id may contain an underscore — today's
 * are `torpedo_boat` and `ion_storm` — but never begin like one of these.
 */
export const MARKED_ID = /\b(?:u|t|ev|k|sch|nk|oc|ph|fk|tt)_[a-z0-9_]+\b/;

/** The core's ordinal ids for powers, systems and sectors (decision 2). */
export const ORDINAL_ID = /\b(?:f\d|s\d\d|r\d)\b/;

/** What a model writes in an op: lowercase words joined by underscores. */
const SkinIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'a skin id is lowercase words joined by underscores');

/** What a player reads. Checked for underscores and ordinals in `skinViolations`. */
const WordSchema = z.string().min(1).max(80);

/** A role a model writes by id: its id, the word it is shown as, and other words that mean it. */
const IdWordSchema = z.object({
  id: SkinIdSchema,
  word: WordSchema,
  synonyms: z.array(WordSchema).default([]),
});

/** A role that is counted, so it needs a plural. */
const CountedIdWordSchema = IdWordSchema.extend({ plural: WordSchema });

/** A kind of thing that can be held, with what one of it is called ("40 crew", "3 charts"). */
const AssetWordSchema = IdWordSchema.extend({ unit: WordSchema, from: z.string().min(1), wanted: z.string().min(1) });

/** A word with no id: a place or a unit of account, which no op names. */
const TermSchema = z.object({
  word: WordSchema,
  plural: WordSchema,
  synonyms: z.array(WordSchema).default([]),
  /** A second word for the same role, which a skin may leave out (`Term.alt` in `lexicon.ts`). */
  alt: z.object({ word: WordSchema, plural: WordSchema }).optional(),
});

/** A record keyed by every member of a closed family, and by nothing else. Zod 4 holds an enum key exhaustive. */
function family<T extends z.ZodTypeAny>(keys: readonly string[], entry: T) {
  return z.record(z.enum(keys as [string, ...string[]]), entry);
}

/* ------------------------------------------------------------------ */
/* The lexicon: a word for every role                                  */
/* ------------------------------------------------------------------ */

export const ASSET_KINDS: readonly string[] = ASSET_ARCHETYPES.map((a) => a.kind);
export const RIM_EVENT_KINDS: readonly string[] = EVENT_KINDS;
export const SCHOOLS: readonly string[] = COMMANDER_ARCHETYPES.map((a) => a.kind);

export { ACCOUNT_TERMS, FORCE_TERMS, PEOPLE_TERMS, PLACE_TERMS, VERB_TERMS };

/** A verb in the four forms English sentences need. */
const VerbSchema = z.object({ base: WordSchema, s: WordSchema, past: WordSchema, ing: WordSchema, synonyms: z.array(WordSchema).default([]) });

export const LexiconSchema = z.object({
  units: family(HULL_CLASSES, CountedIdWordSchema),
  terrains: family(WORLD_TYPES, IdWordSchema),
  orderCategories: family([MOVEMENT_ORDER_TYPE, ...DURATION_CATEGORIES], IdWordSchema),
  assetKinds: family(ASSET_KINDS, AssetWordSchema),
  rimEvents: family(RIM_EVENT_KINDS, IdWordSchema),
  treatyTypes: family(TREATY_TYPES, IdWordSchema),
  schools: family(SCHOOLS, IdWordSchema.extend({ phase: z.string().min(1), effect: z.string().min(1), known: z.string().min(1) })),
  noteKinds: family(NOTE_KINDS, IdWordSchema),
  phases: family(BATTLE_PHASES, IdWordSchema),
  fleetKinds: family(FLEET_KINDS, IdWordSchema),
  places: family(PLACE_TERMS, TermSchema),
  forces: family(FORCE_TERMS, TermSchema),
  people: family(PEOPLE_TERMS, TermSchema),
  verbs: family(VERB_TERMS, VerbSchema),
  meanings: z.object({
    stats: family(STAT_NAMES, z.string().min(1)),
    warEthics: family(WAR_ETHICS, z.string().min(1)),
    tradeEthics: family(TRADE_ETHICS, z.string().min(1)),
    treatyTypes: family(TREATY_TYPES, z.string().min(1)),
    notes: family(NOTE_KINDS, z.string().min(1)),
    agentClasses: family(AGENT_CLASSES, z.string().min(1)),
    missions: family(AGENT_MISSIONS, z.string().min(1)),
    acts: family(ACT_KINDS, z.string().min(1)),
    battleOutcomes: family(BATTLE_OUTCOMES, z.string().min(1)),
    wants: family(Object.keys(PAX_LEXICON.meanings.wants), z.string().min(1)),
    unitJobs: family(HULL_CLASSES, z.string().min(1)),
    terrainLines: family(WORLD_TYPES, z.string().min(1)),
    finds: family(Object.keys(PAX_LEXICON.meanings.finds), z.string().min(1)),
    difficulty: family(Object.keys(PAX_LEXICON.meanings.difficulty), z.string().min(1)),
    missionJobs: family(AGENT_MISSIONS, z.string().min(1)),
    treatyJobs: family(TREATY_TYPES, z.string().min(1)),
    bands: family(Object.keys(PAX_LEXICON.meanings.bands), z.string().min(1)),
  }),
  accounts: family(ACCOUNT_TERMS, TermSchema),
});
export type Lexicon = z.infer<typeof LexiconSchema>;

/** The lexicon's families a model writes by id, which must each be a bijection. */
export const ID_FAMILIES = [
  'units',
  'terrains',
  'orderCategories',
  'assetKinds',
  'rimEvents',
  'treatyTypes',
  'schools',
  'noteKinds',
  'phases',
  'fleetKinds',
] as const satisfies readonly (keyof Lexicon)[];

/* ------------------------------------------------------------------ */
/* The scenario's words                                                */
/* ------------------------------------------------------------------ */

/**
 * How many given and family names every stock carries. The draw indexes a
 * stock by the die, so two skins name the same people at the same places only
 * if their stocks are the same size: 20 divides the d20, and 60 families are
 * what a long campaign's Lists use up (journal version 22).
 */
export const STOCK_GIVEN = 20;
export const STOCK_FAMILIES = 60;

export const NameStockSchema = z.object({
  given: z.array(WordSchema).length(STOCK_GIVEN),
  family: z.array(WordSchema).length(STOCK_FAMILIES),
  /** The title a power gives each school of officer. */
  titles: family(SCHOOLS, WordSchema),
  /** Whether a title sits before the name or after it. */
  place: z.enum(['prefix', 'suffix']),
});
export type NameStockWords = z.infer<typeof NameStockSchema>;

/** A fleet's name with its number left out: `{n}` is the number, `{nth}` the ordinal. */
const FleetTemplateSchema = z.string().regex(/\{n(?:th)?\}/, 'a fleet name carries {n} or {nth}');

export const PowerWordsSchema = z.object({
  id: SkinIdSchema,
  name: WordSchema,
  /** What its leader is called: the first thing its counsellor says. */
  title: WordSchema,
  voice: z.string().min(1),
  doctrine: z.string().min(1),
  /** Each red line's and compulsion's text, in the sheet's order: the core keeps what each forbids. */
  redLines: z.array(z.string().min(1)),
  compulsions: z.array(z.string().min(1)),
  /** Its three estates, by the core's estate id. */
  estates: z.record(z.string(), z.object({ name: WordSchema })),
  names: NameStockSchema,
  fleets: family(FLEET_KINDS, FleetTemplateSchema),
});
export type PowerWords = z.infer<typeof PowerWordsSchema>;

export const SystemWordsSchema = z.object({
  id: SkinIdSchema.or(z.string().regex(/^[a-z]+-\d+$/)),
  name: WordSchema,
  /** Where it is drawn. A skin may move a world; it may not move a lane. */
  coords: z.object({ x: z.number(), y: z.number() }),
});

/* ------------------------------------------------------------------ */
/* Art                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A piece of art: drawn in code (`drawn:<key>`) or a file under the client's
 * public folder (`file:<path>`). `null` where the game shows the words alone.
 */
const ArtRefSchema = z
  .string()
  .regex(/^(?:drawn|file):[a-z0-9_./-]+$/, 'art is drawn:<key> or file:<path>')
  .nullable();

export const OUTCOME_ART = ['refusal', 'defiance', 'negotiation', 'inadmissible', 'out-of-actions'] as const;

export const ArtSchema = z.object({
  /** By the core's power id; checked against the core's powers. */
  portraits: z.record(z.string(), ArtRefSchema),
  terrains: family(WORLD_TYPES, ArtRefSchema),
  units: family(HULL_CLASSES, ArtRefSchema),
  rimEvents: family(RIM_EVENT_KINDS, ArtRefSchema),
  outcomes: family(OUTCOME_ART, ArtRefSchema),
});

/* ------------------------------------------------------------------ */
/* The skin                                                            */
/* ------------------------------------------------------------------ */

export const SkinSchema = z.object({
  id: SkinIdSchema,
  name: WordSchema,
  lexicon: LexiconSchema,
  /** By the core's power id. */
  powers: z.record(z.string(), PowerWordsSchema),
  /** The independents' stock, which an unaligned world's notables are named from. */
  independents: z.object({ names: NameStockSchema }),
  /** By the core's system id. */
  systems: z.record(z.string(), SystemWordsSchema),
  /** By the core's sector. */
  sectors: z.record(z.string(), z.object({ name: WordSchema })),
  art: ArtSchema,
});
export type Skin = z.infer<typeof SkinSchema>;

/* ------------------------------------------------------------------ */
/* What a schema cannot see                                            */
/* ------------------------------------------------------------------ */

/** The core's slots a skin must name: exactly these, adding and removing none. */
export interface CoreSlots {
  powers: readonly string[];
  systems: readonly string[];
  sectors: readonly string[];
  /** Each power's estates, by estate id. */
  estates: Readonly<Record<string, readonly string[]>>;
  /** Each power's red lines and compulsions, as counts: a skin words each slot once. */
  lines: Readonly<Record<string, { redLines: number; compulsions: number }>>;
}

/** Read the slots off a world: the opening board is where the core's powers, systems and sectors are. */
export function coreSlotsOf(state: WorldState): CoreSlots {
  return {
    powers: state.factions.map((f) => f.id),
    systems: state.systems.map((s) => s.id),
    sectors: [...new Set(state.systems.map((s) => s.sector))],
    estates: Object.fromEntries(state.factions.map((f) => [f.id, (f.estates ?? []).map((e) => e.id)])),
    lines: Object.fromEntries(
      state.factions.map((f) => [f.id, { redLines: f.redLines.length, compulsions: f.compulsions.length }]),
    ),
  };
}

/** A skin's id for a core id in one family, and the core id a skin id or word stands for. */
export function lexiconIndex(lexicon: Lexicon, fam: (typeof ID_FAMILIES)[number]) {
  const entries = Object.entries(lexicon[fam]) as [string, z.infer<typeof IdWordSchema>][];
  const toSkin = new Map(entries.map(([core, e]) => [core, e.id]));
  const toCore = new Map<string, string>();
  for (const [core, e] of entries) {
    for (const w of [e.id, e.word, ...e.synonyms]) toCore.set(w.toLowerCase(), core);
  }
  return { toSkin, toCore };
}

/**
 * A skin as it arrives — a file, a studio draft, a menu choice — held to both
 * checks in order: `SkinSchema` first, and `skinViolations` only on what the
 * schema accepted. `skinViolations` reads a parsed `Skin` and is not built to
 * survive one that is not (a missing plural is a crash, not a finding), so a
 * caller with untrusted input asks here.
 */
export function checkSkin(input: unknown, core: CoreSlots): { skin: Skin | null; issues: string[] } {
  const parsed = SkinSchema.safeParse(input);
  if (!parsed.success) {
    return { skin: null, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'skin'}: ${i.message}`) };
  }
  return { skin: parsed.data, issues: skinViolations(parsed.data, core) };
}

/**
 * Everything wrong with a skin that its schema cannot see. Empty when the skin
 * can be played. Run against the core's slots, so a skin that adds a world,
 * drops a power or names an estate the core does not have is caught.
 */
export function skinViolations(skin: Skin, core: CoreSlots): string[] {
  const out: string[] = [];
  const sameKeys = (label: string, have: readonly string[], want: readonly string[]) => {
    const missing = want.filter((k) => !have.includes(k));
    const extra = have.filter((k) => !want.includes(k));
    if (missing.length > 0) out.push(`${label}: no words for ${missing.join(', ')}`);
    if (extra.length > 0) out.push(`${label}: words for ${extra.join(', ')}, which the core does not have`);
  };

  // The slots: exactly the core's, adding and removing none.
  sameKeys('powers', Object.keys(skin.powers), core.powers);
  sameKeys('systems', Object.keys(skin.systems), core.systems);
  sameKeys('sectors', Object.keys(skin.sectors), core.sectors);
  sameKeys('portraits', Object.keys(skin.art.portraits), core.powers);
  for (const [id, power] of Object.entries(skin.powers)) {
    sameKeys(`${id}'s estates`, Object.keys(power.estates), core.estates[id] ?? []);
    const lines = core.lines[id];
    if (lines && power.redLines.length !== lines.redLines) {
      out.push(`${id} words ${power.redLines.length} red lines; the core has ${lines.redLines}`);
    }
    if (lines && power.compulsions.length !== lines.compulsions) {
      out.push(`${id} words ${power.compulsions.length} compulsions; the core has ${lines.compulsions}`);
    }
  }

  // Each family a bijection: one id and one word per core id, none shared, and
  // every canonical word finds its way back.
  for (const fam of ID_FAMILIES) {
    const entries = Object.entries(skin.lexicon[fam]) as [string, z.infer<typeof IdWordSchema>][];
    const ids = new Map<string, string>();
    const words = new Map<string, string>();
    for (const [core, e] of entries) {
      const otherId = ids.get(e.id);
      if (otherId) out.push(`${fam}: ${otherId} and ${core} share the id ${e.id}`);
      ids.set(e.id, core);
      for (const w of new Set([e.word, ...e.synonyms].map((x) => x.toLowerCase()))) {
        const other = words.get(w);
        if (other && other !== core) out.push(`${fam}: ${other} and ${core} share the word "${w}"`);
        words.set(w, core);
      }
    }
    const { toSkin, toCore } = lexiconIndex(skin.lexicon, fam);
    for (const [core] of entries) {
      const back = toCore.get(toSkin.get(core)!.toLowerCase());
      if (back !== core) out.push(`${fam}: ${core} goes out as ${toSkin.get(core)} and comes back as ${back}`);
    }
  }
  for (const [label, entries] of [['places', skin.lexicon.places], ['forces', skin.lexicon.forces], ['people', skin.lexicon.people], ['accounts', skin.lexicon.accounts]] as const) {
    const seen = new Map<string, string>();
    for (const [key, t] of Object.entries(entries)) {
      for (const w of [t.word, t.plural, ...t.synonyms, ...(t.alt ? [t.alt.word, t.alt.plural] : [])].map((x) => x.toLowerCase())) {
        const other = seen.get(w);
        if (other && other !== key) out.push(`${label}: ${other} and ${key} share the word "${w}"`);
        seen.set(w, key);
      }
    }
  }

  // The stocks: a family name belongs to one stock, so a family is a person for
  // the whole campaign whoever they serve; and no stock repeats a name.
  const stocks: [string, NameStockWords][] = [
    ...Object.entries(skin.powers).map(([id, p]) => [id, p.names] as [string, NameStockWords]),
    ['independents', skin.independents.names],
  ];
  const familyOf = new Map<string, string>();
  for (const [who, stock] of stocks) {
    if (new Set(stock.given).size < stock.given.length) out.push(`${who}'s stock repeats a given name`);
    if (new Set(stock.family).size < stock.family.length) out.push(`${who}'s stock repeats a family name`);
    for (const name of stock.family) {
      const other = familyOf.get(name);
      if (other && other !== who) out.push(`the family ${name} is in both ${other}'s stock and ${who}'s`);
      familyOf.set(name, who);
    }
    // A power's schools are told apart by title; the independents appoint no
    // officers, and their stock's titles are one word for anyone of standing.
    const titles = Object.values(stock.titles);
    if (who !== 'independents' && new Set(titles).size < titles.length) out.push(`${who} gives two schools one title`);
  }

  // Ids: what a model writes in this skin must never pass for a core id.
  const skinIds = [
    skin.id,
    ...Object.values(skin.powers).map((p) => p.id),
    ...Object.values(skin.systems).map((s) => s.id),
    ...ID_FAMILIES.flatMap((fam) => Object.values(skin.lexicon[fam]).map((e) => (e as { id: string }).id)),
  ];
  for (const id of skinIds) {
    if (MARKED_ID.test(id) || ORDINAL_ID.test(id)) out.push(`the skin id ${id} could pass for a core id`);
  }

  // Words: what a player reads carries no underscore and no ordinal, so no word
  // in any skin can be mistaken for a core id leaking through.
  const words: string[] = [skin.name];
  for (const fam of ID_FAMILIES) {
    for (const e of Object.values(skin.lexicon[fam]) as (z.infer<typeof IdWordSchema> & { plural?: string; unit?: string })[]) {
      words.push(e.word, ...e.synonyms, ...(e.plural ? [e.plural] : []), ...(e.unit ? [e.unit] : []));
    }
  }
  for (const t of [...Object.values(skin.lexicon.places), ...Object.values(skin.lexicon.forces), ...Object.values(skin.lexicon.people), ...Object.values(skin.lexicon.accounts)]) {
    words.push(t.word, t.plural, ...t.synonyms, ...(t.alt ? [t.alt.word, t.alt.plural] : []));
  }
  for (const v of Object.values(skin.lexicon.verbs)) words.push(v.base, v.s, v.past, v.ing, ...v.synonyms);
  for (const p of Object.values(skin.powers)) {
    words.push(p.name, p.title, p.voice, p.doctrine, ...p.redLines, ...p.compulsions);
    words.push(...Object.values(p.estates).map((e) => e.name), ...Object.values(p.fleets));
  }
  for (const [, stock] of stocks) words.push(...stock.given, ...stock.family, ...Object.values(stock.titles));
  words.push(...Object.values(skin.systems).map((s) => s.name), ...Object.values(skin.sectors).map((s) => s.name));
  for (const w of new Set(words)) {
    if (w.includes('_')) out.push(`"${w.slice(0, 60)}" carries an underscore`);
    else if (ORDINAL_ID.test(w)) out.push(`"${w.slice(0, 60)}" carries what reads as a core id`);
  }
  return out;
}

/** A fleet's name in a skin: the template with its number filled in. */
export function fleetNameFrom(template: string, n: number, ordinal: (n: number) => string): string {
  return template.replace('{nth}', ordinal(n)).replace('{n}', String(n));
}
