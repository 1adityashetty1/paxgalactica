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
  /** What one of it is. */
  unit: string;
  divisible: boolean;
  uses: number | null;
  speculative: boolean;
  fixture: boolean;
  /** The kind of attempt that produces one, for the arbiter's rubric. */
  from: string;
  /** Who tends to want it, in words. Never a number: the board decides that. */
  wanted: string;
  /**
   * For a **fixture**, the stat it is worth to whoever holds the ground.
   *
   * **A works is defined by what it modifies**, which is the whole reason a
   * fixture is a distinct shape rather than cargo that happens not to move.
   * Before this the three `works` entries were each described as *"nobody
   * wants it"* — true of the paperwork and false of the thing: a foundry, a
   * college and a fortress are not inert scenery, they are the reason the
   * world under them is worth taking.
   *
   * So there is one per stat, and naming it is naming the mechanic: you do not
   * have to be told what a `foundry` does. **A works may also name two**, and
   * then it splits one budget between them — a black market is an exchange run
   * for guile as much as for influence, a mercenary board one run for might.
   * Same institution, differently run, which says what a works IS better than
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
 * counted and consumed, and **works** that stand on a world and produce.
 */
export const ASSET_ARCHETYPES: readonly AssetArchetype[] = [
  /* --- People: worth most to whoever lost them ------------------------- */
  {
    kind: 'prisoners',
    unit: 'crew',
    divisible: true,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'sweeping a battlefield you hold, boarding a hull, taking a world',
    wanted: 'the power that lost them, and almost nobody else',
  },
  {
    kind: 'officer',
    unit: 'person',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'taking them alive when the fleet they commanded was broken',
    wanted: 'the power that lost them, badly; anybody else only as leverage',
  },
  {
    kind: 'operative',
    unit: 'person',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'taking a burned operative alive rather than merely closing the line',
    wanted: 'the power that ran them, and anyone who wants to know what they knew',
  },
  {
    kind: 'hostage',
    unit: 'person',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'a negotiated exchange, a fostering, or seizing someone who matters',
    wanted: 'their own house, enormously; a rival house, as leverage',
  },
  {
    kind: 'defector',
    unit: 'person',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'suborning an officer, sheltering someone who fled',
    wanted: 'whoever they fled — to silence them; whoever they fled TO — for what they know',
  },
  /* --- Paper: proves, authorises, or is simply a name ------------------- */
  {
    kind: 'dossier',
    unit: 'dossier',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'a bargain across a table — the one kind an accord may create',
    wanted: 'whoever it is about, to bury it; their rival, to use it',
  },
  {
    kind: 'charts',
    unit: 'chart',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'a survey run, a theft from a pilot house',
    wanted: 'anybody who moves cargo through that space — if they are true',
  },
  {
    kind: 'blueprints',
    unit: 'set',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'espionage against a yard, buying a foreman',
    wanted: 'a power with the industry to use them and not the design',
  },
  {
    kind: 'writ',
    unit: 'writ',
    divisible: false,
    uses: 1,
    speculative: false,
    fixture: false,
    from: 'a political manoeuvre — a letter of marque, a warrant, a commission',
    wanted: 'whoever it licenses; it is played once and is then spent',
  },
  {
    kind: 'surety',
    unit: 'bond',
    divisible: false,
    uses: 1,
    speculative: false,
    fixture: false,
    from: 'a bargain where one side had to put something in escrow',
    wanted: 'the party it is held against — it is called in once, and is gone',
  },
  {
    kind: 'ciphers',
    unit: 'key',
    divisible: false,
    uses: 3,
    speculative: false,
    fixture: false,
    from: 'a theft from a signals office, a turned cryptographer',
    wanted: 'anybody reading that traffic — until the keys are changed',
  },
  /* --- Stuff: counted, shipped, spent ----------------------------------- */
  {
    kind: 'ore',
    unit: 'ton',
    divisible: true,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'a survey, a seizure, a foundry standing on a world you hold',
    wanted: 'a power building hulls, at a price nobody has settled',
  },
  {
    kind: 'salvage',
    unit: 'ton',
    divisible: true,
    uses: null,
    speculative: false,
    fixture: false,
    from: 'holding the ground after a battle, breaking a wreck',
    wanted: 'a yard, at scrap rates, by anyone who can lift it',
  },
  {
    kind: 'contraband',
    unit: 'crate',
    divisible: true,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'a smuggling run, a customs seizure',
    wanted: 'whoever will move it; worth nothing to a power that will not',
  },
  {
    kind: 'relic',
    unit: 'relic',
    divisible: false,
    uses: null,
    speculative: true,
    fixture: false,
    from: 'a raid on a seat of government, a tomb, a chapter house',
    wanted: 'whoever it was taken from, for reasons that are not commercial',
  },
  /* --- Works: they stand on a world and produce ------------------------- */
  /* --- works: they stand on a world, and make its holder better at something
     ------------------------------------------------------------------------
     One per stat, so the catalogue's fixtures ARE the five attributes. A works
     never leaves the ground it stands on: `transfer_asset` refuses it from both
     the declared and the negotiated path, and it changes hands only through
     cession or conquest, which needed no new code — the transfer-of-control
     path already moves everything standing on a world. That is what makes it a
     reason to take ground rather than a thing to trade. */
  {
    kind: 'arsenal',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might'],
    from: 'raising an armoury, a proving ground, a fortress academy',
    wanted: 'whoever holds the world — it arms them, and changes hands with the ground',
  },
  {
    kind: 'college',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile'],
    from: 'endowing a university, a chart house, a school of signals',
    wanted: 'whoever holds the world — it teaches them, and changes hands with the ground',
  },
  {
    kind: 'foundry',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry'],
    from: 'opening a mine, laying a slipway, converting a yard',
    wanted: 'whoever holds the world — it builds for them, and changes hands with the ground',
  },
  {
    kind: 'exchange',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['influence'],
    from: 'chartering a market, licensing a dock, seating a court',
    wanted: 'whoever holds the world — it speaks for them, and changes hands with the ground',
  },
  {
    kind: 'sanctuary',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['resolve'],
    from: 'raising a theatre, a temple, a grain dole — anything that settles a population',
    wanted: 'whoever holds the world — it settles them, and changes hands with the ground',
  },
  /* Split works: one budget, two attributes. The pure five above are the same
     institutions run for one thing; these are them run for two — and there are
     exactly **ten**, because that is every unordered pair of five attributes.
     The catalogue is complete by construction rather than by whatever anybody
     thought to add, which is what stops a model reaching for a plausible works
     and finding no archetype behind it. `tests/assets.test.ts` asserts the
     count and the coverage, so a sixth attribute would fail rather than quietly
     leave forty-five per cent of the pairs unnamed. */
  {
    kind: 'privateer_hall',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'guile'],
    from: 'licensing a hall of marque — captains who fight and captains who vanish',
    wanted: 'whoever holds the world — it arms them and hides them, and changes hands with the ground',
  },
  {
    kind: 'proving_yard',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'industry'],
    from: 'laying out a proving ground beside the works that feeds it',
    wanted: 'whoever holds the world — it builds the guns and teaches the crews',
  },
  {
    kind: 'mercenary_board',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'influence'],
    from: 'licensing a hiring hall, seating a board that sells contracts',
    wanted: 'whoever holds the world — an exchange that also musters companies',
  },
  {
    kind: 'war_college',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['might', 'resolve'],
    from: 'endowing a staff school, a siege academy',
    wanted: 'whoever holds the world — it teaches an army to hold as well as to fight',
  },
  {
    kind: 'shipwright_school',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'industry'],
    from: 'endowing a school beside a yard — draughtsmen as well as riveters',
    wanted: "whoever holds the world — it builds hulls and copies other people's",
  },
  {
    kind: 'black_market',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'influence'],
    from: 'letting a market run without asking what crosses it',
    wanted: 'whoever holds the world — an exchange that also hears things',
  },
  {
    kind: 'cloister',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['guile', 'resolve'],
    from: 'endowing a closed order — people who keep secrets and keep going',
    wanted: 'whoever holds the world — it teaches discretion, and endurance with it',
  },
  {
    kind: 'guildhall',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry', 'influence'],
    from: 'chartering a guild — a trade that speaks for itself',
    wanted: 'whoever holds the world — it makes things, and is heard when it asks',
  },
  {
    kind: 'arcology',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['industry', 'resolve'],
    from: 'raising a works-town that feeds and houses the people who run it',
    wanted: 'whoever holds the world — it produces, and it does not break under siege',
  },
  {
    kind: 'tribunal',
    unit: 'works',
    divisible: false,
    uses: null,
    speculative: false,
    fixture: true,
    modifies: ['influence', 'resolve'],
    from: 'seating a bench that settles disputes nobody else will',
    wanted: 'whoever holds the world — it speaks for them, and steadies them',
  },
];

const BY_KIND = new Map(ASSET_ARCHETYPES.map((a) => [a.kind, a]));

/** The archetype for a slug, if it is one of the known shapes. */
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
      a.fixture ? 'stands on a world; changes hands only with it' : null,
    ]
      .filter((x): x is string => x !== null)
      .join(' · ');
    return `| \`${a.kind}\` | ${a.unit} | ${shape} | ${a.from} | ${a.wanted} |`;
  };
  return [
    '| kind | unit | shape | what produces one | who wants it |',
    '|---|---|---|---|---|',
    ...ASSET_ARCHETYPES.map(row),
  ].join('\n');
}
