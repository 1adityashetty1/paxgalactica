import { MAX_ASSET_STAT } from './diplomacy.js';
import type { StatName } from './checks.js';
import { assetWords, say } from '../skin/lexicon.js';

/**
 * The catalogue: what a thing usually is, so the arbiter reaches for a shape
 * rather than inventing one.
 *
 * ## Why a preset list at all, when `kind` is an open slug
 *
 * The open slug is right and stays. It is what let a playtest reach for a
 * fostered heir, a claimant's seal and a hundred tons of rare material without
 * anybody having enumerated them, and a survey that brings back something
 * nobody thought of is the whole point of an arbiter.
 *
 * But an open vocabulary with no anchors drifts. The same thing gets minted as
 * `prisoners` in one turn and `pows` the next, atomic here and divisible there,
 * priced at 12 a head by one call and 400 by another — and every one of those
 * is a difference the negotiation layer can see and cannot reconcile. This is
 * the same split the whole codebase runs on: **the model is good at judgement
 * and unreliable at lookup**, so it decides *that a thing was taken* and the
 * table decides *what that kind of thing is like*.
 *
 * So an archetype is a default, never a restriction. `create_asset` accepts any
 * slug; when the slug is one of these, the reducer fills in what was not stated
 * and corrects `divisible` and `uses`, which are the two fields whose being
 * wrong quietly breaks a later trade.
 *
 * ## What the columns mean
 *
 * - `divisible` — can it be split into lots. Forty crews can be ransomed twenty
 *   at a time; a seal cannot be halved.
 * - `uses` — an *instrument* is played a bounded number of times and is then
 *   spent. `null` is ordinary stuff, spent by `quantity`.
 * - `speculative` — nobody has assayed it, so its worth is a band. Applied to
 *   the kinds whose value is genuinely a claim: ore nobody has refined, a chart
 *   of a passage nobody has run, a defector's promises.
 * - `fixture` — it IS the world it stands on and changes hands only with the
 *   ground, so it also carries a `yield`.
 */
export interface AssetArchetype {
  kind: string;
  divisible: boolean;
  uses: number | null;
  speculative: boolean;
  fixture: boolean;
  /**
   * For a **fixture**, the stat it is worth to whoever holds the ground.
   *
   * **A fixture is defined by what it modifies**, which is the whole reason a
   * fixture is a distinct shape rather than cargo that happens not to move.
   * Before this the three `fixture` entries were each described as *"nobody
   * wants it"* — true of the paperwork and false of the thing: a foundry, a
   * college and a fortress are not inert scenery, they are the reason the
   * world under them is worth taking.
   *
   * So there is one per stat, and naming it is naming the mechanic: you do not
   * have to be told what a `foundry` does. **A fixture may also name two**, and
   * then it splits one budget between them — a black market is an exchange run
   * for guile as much as for influence, a mercenary board one run for might.
   * Same institution, differently run, which says what a fixture IS better than
   * a second archetype that happens to be worth the same amount.
   *
   * There are **fifteen**: five pure and `5C2` = ten pairs, so the catalogue
   * covers every attribute and every combination of two. Complete by
   * construction rather than by whatever anybody thought to add — a model
   * reaching for a guildhall or a tribunal finds an archetype behind it, which
   * is the whole job of the table. The reducer fills in a
   * `stat` yield from this when `create_asset` names a known fixture and gave
   * none, the same correction it already applies to `divisible` and `uses` —
   * the two other fields whose being wrong quietly breaks a later trade.
   */
  modifies?: readonly ('might' | 'guile' | 'industry' | 'influence' | 'resolve')[];
}

/**
 * Thirty shapes, chosen to cover the ways a thing can enter play rather than
 * to enumerate the fiction.
 *
 * Four groups, and the grouping is the useful part: **people** who can be
 * ransomed or turned, **paper** that proves or authorises, **stuff** that is
 * counted and consumed, and **fixtures** that stand on a world and produce.
 */
export const ASSET_ARCHETYPES: readonly AssetArchetype[] = [
  /* --- People: worth most to whoever lost them ------------------------- */
  {
    kind: 'prisoners',
    divisible: true,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'officer',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'operative',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'hostage',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'defector',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
  },
  /* --- Paper: proves, authorises, or is simply a name ------------------- */
  {
    kind: 'dossier',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'charts',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
  },
  {
    kind: 'blueprints',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
  },
  {
    kind: 'writ',
    divisible: false,
    uses: 1,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'surety',
    divisible: false,
    uses: 1,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'ciphers',
    divisible: false,
    uses: 3,
    speculative: false,
    fixture: false,
  },
  /* --- Stuff: counted, shipped, spent ----------------------------------- */
  {
    kind: 'ore',
    divisible: true,
    uses: null,
    speculative: true,
    fixture: false,
  },
  {
    kind: 'salvage',
    divisible: true,
    uses: null,
    speculative: false,
    fixture: false,
  },
  {
    kind: 'contraband',
    divisible: true,
    uses: null,
    speculative: true,
    fixture: false,
  },
  {
    kind: 'relic',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
  },
  /* --- Works: they stand on a world and produce ------------------------- */
  /* --- fixtures: they stand on a world, and make its holder better at something
     ------------------------------------------------------------------------
     One per stat and one per pair of stats — five plus `5C2`, so the catalogue
     covers every attribute and every combination of two. A fixture never leaves
     the ground it stands on: `transfer_asset` refuses it from both the declared
     and the negotiated path, and it changes hands only through cession or
     conquest, which needed no new code — the transfer-of-control path already
     moves everything standing on a world. That is what makes it a reason to
     take ground rather than a thing to trade.

     **Named for what they are, not for what a fantasy would call them.** The
     first set read as a guild hall and a cloister; these are the institutions a
     power actually runs, which is also what makes the mechanic legible — you do
     not need to be told what a factory improves. */
  {
    kind: 'military_base',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might'],
  },
  {
    kind: 'university',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile'],
  },
  {
    kind: 'factory',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry'],
  },
  {
    kind: 'stock_exchange',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['influence'],
  },
  {
    kind: 'hospital',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['resolve'],
  },

  /* Split works: one budget, two attributes. The pure five above are the same
     kind of institution run for one thing; these are them run for two — and
     there are exactly **ten**, because that is every unordered pair of five
     attributes. Complete by construction rather than by whatever anybody
     thought to add, which is what stops a model reaching for a plausible fixture
     and finding no archetype behind it. `tests/assets.test.ts` asserts the
     count and the coverage, so a sixth attribute would fail rather than quietly
     leave forty-five per cent of the pairs unnamed. */
  {
    kind: 'special_forces_command',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'guile'],
  },
  {
    kind: 'arsenal',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'industry'],
  },
  {
    kind: 'defence_contractor',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'influence'],
  },
  {
    kind: 'military_academy',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'resolve'],
  },
  {
    kind: 'research_lab',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'industry'],
  },
  {
    kind: 'black_market',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'influence'],
  },
  {
    kind: 'security_bureau',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'resolve'],
  },
  {
    kind: 'chamber_of_commerce',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry', 'influence'],
  },
  {
    kind: 'power_plant',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry', 'resolve'],
  },
  {
    kind: 'civil_service',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['influence', 'resolve'],
  },
];

const BY_KIND = new Map(ASSET_ARCHETYPES.map((a) => [a.kind, a]));

/** The archetype for a slug, if it is one of the known shapes. */
/**
 * The catalogue's paper — what a thief can take a **copy** of and leave the
 * original (`larceny`). Ore and a seal cannot be copied; a ledger can.
 */
/** The catalogue's people — never a thief's to take; carrying one off is a kidnapping. */
export const PEOPLE_KINDS: ReadonlySet<string> = new Set(['prisoners', 'officer', 'operative', 'hostage', 'defector']);

export const PAPER_KINDS: ReadonlySet<string> = new Set(['dossier', 'charts', 'blueprints', 'writ', 'surety', 'ciphers']);

export function archetypeFor(kind: string): AssetArchetype | undefined {
  return BY_KIND.get(kind);
}

/**
 * What the arbiter is told about the catalogue.
 *
 * Substituted into `prompts/resolution.md` at CALL time, never pasted into the
 * file. A table restated in Markdown beside this one is a second opinion that
 * will eventually be wrong and will fail silently — exactly the drift
 * `tests/prompt-drift.test.ts` exists to catch for hull prices.
 */
export function serializeArchetypes(): string {
  const row = (a: AssetArchetype): string => {
    const shape = [
      a.divisible ? 'splits into lots' : 'one thing',
      a.uses === null ? null : a.uses === 1 ? 'played once, then spent' : `played ${a.uses} times`,
      a.speculative ? 'worth is a BAND, nobody has settled it' : null,
      a.fixture ? say`stands on a {node}; changes hands only with it` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(' · ');
    const words = assetWords(a.kind);
    return `| \`${a.kind}\` | ${words.unit} | ${shape} | ${words.from} | ${words.wanted} |`;
  };
  return [
    '| kind | unit | shape | what produces one | who wants it |',
    '|---|---|---|---|---|',
    ...ASSET_ARCHETYPES.map(row),
  ].join('\n');
}

/**
 * The stat yield an archetype means, from the attributes it names.
 *
 * One budget, divided evenly over them: at `MAX_ASSET_STAT` of 2 that is either
 * two points of one attribute or one of each, which is the whole reason the cap
 * on a split is two — a half point does not exist on a 1-20 scale.
 *
 * Shared, because two callers need it and a formula written twice is two
 * chances to disagree about what a foundry is worth: the reducer filling in a
 * `create_asset` that named no yield, and a `found_fixture` programme landing.
 */
export function fixtureYieldFor(
  shape: AssetArchetype,
): { kind: 'stat'; stats: { stat: StatName; points: number }[] } | null {
  if (shape.modifies === undefined || shape.modifies.length === 0) return null;
  const each = Math.max(1, Math.floor(MAX_ASSET_STAT / shape.modifies.length));
  return { kind: 'stat', stats: shape.modifies.map((stat) => ({ stat, points: each })) };
}
