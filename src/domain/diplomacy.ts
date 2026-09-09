import { z } from 'zod';
import { StatNameSchema } from './checks.js';

/**
 * Treaties and covert agents: the two standing structures that outlive the turn
 * they were created in.
 *
 * Both live in world state rather than in prompt memory, because both have
 * mechanical consequences the reducer must apply every turn — income shares,
 * defence triggers, sabotage. A treaty a model merely "remembers" is a treaty
 * that quietly stops existing.
 */

/**
 * Something a power puts on the table, recorded **by the party it would bind**,
 * in the same breath as the words that offer it.
 *
 * Consent used to exist only as prose. `DiplomacyReplySchema` was
 * `{ reply: string }`, so the extraction pass at `/endtalk` was the one and
 * only thing that ever interpreted what a counterparty had agreed to — it both
 * read the transcript and asserted what was in it, with nothing downstream
 * comparing the two. A playtest moved three worlds, one of them the map's
 * greatest junction, off a transcript whose counterparty had said *"Oridin, no
 * — garrison standing, no world changes hands"*, and two of those worlds were
 * never asked for at all.
 *
 * Adding another interpreter cannot fix a missing record, and a checker shown
 * the transcript plus a plausible reading is being handed the conclusion and
 * asked to agree with it — the exact confirmation bias `verifyBreachRelevance`
 * is shaped to avoid. So the record is made instead: the persona states what it
 * is conceding **forward**, as part of speaking, with its own sheet and state
 * loaded. Extraction stops being a judge and becomes a matcher.
 *
 * The same split this project uses everywhere else. The arbiter rules and the
 * reducer enforces; `classifyPrinciple` has the model name the line and code do
 * the lookup. Here the persona offers and code enforces that the ops match.
 *
 * **`kind` is deliberately open**, unlike `OrderEffect` or `voidsOn`. A closed
 * list is right when a wrong entry lands silently and permanently — but a
 * concession is recorded on every message, rendered in the channel, and
 * correctable in the next breath by either party. That feedback loop is what
 * makes an open vocabulary safe here rather than reckless, and it is what lets
 * two powers invent an arrangement nobody enumerated, which is the whole point
 * of the diplomacy layer.
 *
 * The **referents** are structured even though the kind is not, because they
 * are what a reducer has to match against. Free-form in what the arrangement
 * IS, exact about the worlds and the money it moves — the same shape as
 * `Commitment`, which pairs a free-form `kind` with a typed `share`.
 */
export const ConcessionSchema = z.object({
  /** The power giving this up. It binds them and nobody else. */
  by: z.string().min(1),
  /** A lower_snake_case slug. Reusable, invented freely. */
  kind: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'kind must be a lower_snake_case slug'),
  /** One sentence, in the words the parties actually used. */
  text: z.string().min(1).max(240),
  /**
   * Worlds this concession hands over, RESOLVED TO IDS by the power giving
   * them up.
   *
   * The resolution is the load-bearing part and it has to happen here. A
   * counterparty says *"the Sennex lane is yours"* or *"take the Ilvenn
   * holdings"* — no world is named, and no downstream matcher can turn that
   * into ids without guessing. The power conceding knows what it holds and what
   * it meant, at the moment it means it.
   */
  systems: z.array(z.string().min(1)).max(12).default([]),
  /** Credits moving once, from `by` to the other party. */
  credits: z.number().int().min(0).max(100000).default(0),
  /** Credits moving every turn, from `by` to the other party. */
  perTurn: z.number().int().min(0).max(1000).default(0),
  /** Hulls pledged out of `by`'s own fleet. */
  hulls: z.number().int().min(0).max(1000).default(0),
});
export type Concession = z.infer<typeof ConcessionSchema>;

/**
 * Taking a concession back, in character.
 *
 * The correction loop is the reason this whole mechanism records per MESSAGE
 * rather than once at `/endtalk`: a concession the persona wrote down by
 * mistake is visible in the channel while the conversation is still open, so
 * either party can strike it before it binds anything. That is also what makes
 * the open `kind` vocabulary safe.
 *
 * `why` is flavour and it is load-bearing flavour. A misrecorded term struck
 * out as *"my clerk had written Oridin into the draft; he had misheard the
 * lane for the world"* reads as a translation failure between two powers
 * negotiating in a second language — which is what it is, in the fiction — and
 * not as the machine correcting itself in front of the player. An error the
 * game can narrate is an error that costs nothing.
 */
export const RetractionSchema = z.object({
  /** Whose concession is being struck. */
  by: z.string().min(1),
  /** The `kind` slug being taken back. */
  kind: z.string().min(1).max(40),
  /** In character, one sentence. A mishearing, a clerk's error, a bad draft. */
  why: z.string().min(1).max(240),
});
export type Retraction = z.infer<typeof RetractionSchema>;

/**
 * Fold a message's concessions and retractions into the running ledger.
 *
 * Pure and here rather than inside `GameSession`, for the reason `logview.ts`
 * and `layout.ts` are pure: the suite has no server, so logic living inside a
 * request handler is logic nothing checks.
 *
 * It appended before, and the list accumulated — one hire recorded four times
 * under four slugs, one recorded backwards, and terms both parties had struck
 * still live because the retraction's `kind` matched none of the entries it
 * meant to remove. Extraction deduped it correctly that time and nothing broke,
 * but extraction is documented as a MATCHER against this list, and a list that
 * disagrees with itself is a matcher's problem waiting to happen.
 */
export function mergeConcessions(
  held: readonly Concession[],
  incoming: readonly Concession[],
  retractions: readonly Retraction[],
): Concession[] {
  // Retractions first, so a power can strike and re-offer in one breath.
  let out = [...held];
  for (const r of retractions) {
    const exact = out.some((c) => c.by === r.by && c.kind === r.kind);
    out = out.filter((c) =>
      c.by !== r.by ? true : exact ? c.kind !== r.kind : !looselyTheSame(r.kind, c.kind),
    );
  }
  for (const c of incoming) {
    // Supersede in place: a power restating a term is amending it, not adding a
    // second one. Keying on (by, kind) is what makes this a position rather
    // than a history of positions.
    const at = out.findIndex((x) => x.by === c.by && x.kind === c.kind);
    if (at >= 0) out[at] = c;
    else out.push(c);
  }
  return out;
}

/**
 * Whether a retraction with no exactly-matching `kind` still means this entry.
 *
 * Deliberately loose, and only ever applied within one party's own concessions.
 * A persona that strikes "the Kest arrangement" having recorded it as
 * `mutual_defense_kest` has plainly retracted it, and the alternative — leaving
 * it standing because two slugs it invented moments apart do not match — is how
 * a struck term survives to bind somebody.
 */
function looselyTheSame(a: string, b: string): boolean {
  const words = (v: string) =>
    v.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const first = new Set(words(a));
  return words(b).some((w) => first.has(w));
}

/**
 * The concessions a reply may record: the two powers in the room, nobody else.
 *
 * The two halves are not the same kind of record. A power's own concession
 * **binds it** — `groundInConcessions` grounds an op against the counterparty's
 * and nothing else. Its record of what the player offered is only its
 * understanding, and is useful precisely because it can be wrong out loud.
 *
 * This filtered to the speaker alone, which stripped the player's concessions
 * before anything could appraise them — so the per-message red-line pass had
 * nothing to look at and `channelBlockers` was empty at every read.
 */
export function atThisTable<T extends { by: string }>(
  entries: readonly T[],
  speakerId: string,
  playerId: string,
): T[] {
  return entries.filter((e) => e.by === speakerId || e.by === playerId);
}

export const TREATY_TYPES = [
  'non_aggression',
  'mutual_defense',
  'trade_accord',
  'tribute',
  'basing_rights',
  'ceasefire',
  // A land transfer had no type of its own, so extraction borrowed one — and
  // the borrowed label was load-bearing in two places it had no business being.
  // A playtest ceded three worlds inside a `basing_rights` treaty, which grants
  // the right to ENTER without it being an attack and is the opposite of a
  // handover; another wrote a sale as a `trade_accord` and superseded the live
  // raid-immunity pact between the same pair, because supersession keys on the
  // type. Naming the thing fixes both.
  'cession',
  /**
   * A commercial agreement that pays: a hire, an annuity, a charter fee, a
   * retainer, a share of a season's take.
   *
   * `tribute` was the only type carrying `incomePerTurn`, so it became the sink
   * for every recurring flow regardless of what the parties meant — and words
   * bind here. A playtest recorded a hire contract and a reinsurance annuity as
   * `tribute`, which put the **Arkane Free Worlds** on the paying end of an
   * instrument their own sheet refuses outright: *"tribute is refused. The
   * Drift does not pay to be left alone, whatever the arithmetic says."*
   *
   * It also fixes a quieter bug. Supersession keys on `(pair, type)`, so a
   * second commercial deal with the same power silently retired the first — two
   * unrelated contracts could not coexist because they had to share a label.
   */
  'contract',
] as const;
export const TreatyTypeSchema = z.enum(TREATY_TYPES);
export type TreatyType = z.infer<typeof TreatyTypeSchema>;

export const TREATY_TYPE_MEANING: Record<TreatyType, string> = {
  cession: 'one party hands named worlds to the other, once and permanently; a price may ride with it',
  contract: 'a commercial agreement that pays — a hire, an annuity, a charter fee; money for something given, not tribute',
  non_aggression: 'neither party attacks the other; breaking it is a betrayal everyone sees',
  mutual_defense: 'an attack on one obliges the other to answer',
  trade_accord: 'lanes stay open and income is shared on named systems',
  tribute: 'one party pays the other every turn, in exchange for being left alone',
  basing_rights: 'fleets of one party may transit and resupply in the other’s systems',
  ceasefire: 'hostilities stop for a fixed number of turns and then lapse',
};

/** A share of one system's income, granted by treaty. */
export const IncomeShareSchema = z.object({
  systemId: z.string().min(1),
  factionId: z.string().min(1),
  /** 0–1. Shares across a system are normalised if they exceed 1. */
  share: z.number().min(0).max(1),
});
export type IncomeShare = z.infer<typeof IncomeShareSchema>;

/**
 * A condition that ends a treaty when it comes true.
 *
 * NPCs negotiate these constantly, because natural language makes them free —
 * *"any tribute or standing order you give the Vigil voids this, full stop"* —
 * and nothing enforced them. The playtest detail that makes it a bug rather
 * than a gap: both halves of that deal were signed with the Vigil on one
 * timestamp, the NPC noticed in prose the next turn, and it broke **only the
 * `mutual_defense` half**. The `trade_accord` that paid the player survived and
 * was still active four turns later. The half of the void that cost the player
 * broke; the half that paid them did not.
 *
 * A **closed set** of three kinds rather than a condition language, on the same
 * principle as `OrderEffect`: the vocabulary is small, it is arithmetic on
 * state, and nothing here can be argued into meaning something else.
 */
/**
 * The most a thing can pay its holder in a turn, before it is trimmed.
 *
 * A yield is the one part of an asset that is **money rather than a claim**, so
 * it is the one part that needs a ceiling — the rule every money mechanism here
 * has converged on. Set beside `MAX_COMMITMENT_INCOME` (25) because it is the
 * same size of thing: a standing arrangement that pays a little, every turn,
 * forever.
 *
 * Only the paying direction is capped. A thing that costs its holder to keep —
 * prisoners eat, a garrisoned mine is guarded — is uncapped for the reason a
 * commitment's costs are: nothing needs protecting from a power agreeing to pay.
 */
export const MAX_ASSET_YIELD = 25;

/**
 * The most a thing can move its holder's dissent in a turn.
 *
 * Deliberately tiny, and set at `DISSENT_DECAY`. Institutions are repaired by
 * governing in character and by time, at a pace every other number here was
 * tuned against — a theatre or a temple may **double** that rate and may not
 * outrun it. One refusal costs 8 and one compulsion breach 15, so nothing built
 * out of assets lets a leader buy their way out of governing badly.
 */
export const MAX_ASSET_DISSENT = 2;

/**
 * What a thing does every turn, if it does anything.
 *
 * Most assets are inert: a hundred tons of ore sits in a hold and is worth what
 * somebody will pay for it. But a mine, an exchange and a theatre are all
 * *things you can hold at a world*, and what makes them worth holding is that
 * they produce — so an asset class with no per-tick vocabulary can name them and
 * not model them, which is the failure this whole subsystem exists to end.
 *
 * A closed union of three, for the reason `OrderEffect` and `VoidCondition` are
 * closed: a predicate has to be right about every case that will ever exist, a
 * list has to be edited, and the edit is where the thinking happens.
 *
 * **Where each is applied follows the rule the agent effects already set.**
 * `credits` is *read where it is used*, in `ledgerFor`, because a flow that
 * mutated the treasury each tick would compound rather than recur. `dissent`
 * and `asset` **mutate** in `tickTurn`, because both accumulate on their own
 * clock — the same split that puts `hull_damage` and `sedition` on one side and
 * `income_penalty` on the other.
 */
export const AssetYieldSchema = z.discriminatedUnion('kind', [
  z.object({
    /** An exchange, a customs house, a licenced dock. */
    kind: z.literal('credits'),
    /** To the holder, every turn. Negative is upkeep — prisoners eat. */
    perTurn: z.number().int().min(-400).max(400),
  }),
  z.object({
    /**
     * A theatre, a temple, a grain dole — or a labour camp, which is the same
     * field with the sign the other way.
     *
     * The holder's **own** dissent. Turning a *rival's* institutions against it
     * is `sedition`, which is an operative's work and priced as such; an asset
     * that could do it would be that mechanic at none of the cost.
     */
    kind: z.literal('dissent'),
    /** Negative settles the population; positive inflames it. */
    perTurn: z.number().int().min(-10).max(10),
  }),
  z.object({
    /**
     * A mine, a hatchery, a shipbreaker's yard — a thing that makes another
     * thing.
     *
     * The output **merges into an existing holding** of the same kind at the
     * same world rather than minting a row a turn: a mine run for thirty turns
     * is one growing stockpile, not thirty piles of ore. Same lesson as
     * `normaliseStack` — a record whose shape depends on its history is a
     * record nobody can read.
     */
    kind: z.literal('asset'),
    /** How many units come out a turn. */
    perTurn: z.number().int().min(1).max(1000),
    /** The slug of what it makes: `ore`, `hulls_scrap`, `foodstuffs`. */
    assetKind: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'assetKind must be a lower_snake_case slug'),
    /** What one of it is. */
    unit: z.string().min(1).max(24),
    /** One sentence, read back to the player as the stockpile's description. */
    text: z.string().min(1).max(240),
    /** What a unit of the output is worth to whom. A claim, as ever. */
    valuePerUnit: z.record(z.string(), z.number().int().min(0).max(10000)).default({}),
  }),
]);
export type AssetYield = z.infer<typeof AssetYieldSchema>;

/**
 * A thing that is neither credits nor ships.
 *
 * Prisoners, a fostered heir, a claimant's seal held in escrow, a hundred tons
 * of a rare material, a chart that is false, a piece of intelligence held
 * exclusively. A creative playtest reached for all of these and the world had
 * nowhere to put any of them: an accord would record *"fifty crews at forty a
 * head"* and the game could not count a single crew.
 *
 * ## Per-faction value is the idea
 *
 * `valuePerUnit` is what makes an asset worth **trading** rather than worth
 * hoarding. Prisoners are worth a great deal to the power that lost them and
 * almost nothing to anyone else; an heirloom is worth something to the house it
 * came from. Asymmetric valuation is the whole of gains-from-trade, and it is
 * precisely what the playtest showed nobody at the table could see — a figure
 * bargained from 80 to 95 settled at 60 with neither persona told, and the same
 * intelligence was sold twice because nothing recorded who held it.
 *
 * ## An asset has no intrinsic economic force
 *
 * `valuePerUnit` is a **claim about what somebody would pay**, not money. It
 * never enters a ledger, is never income, and creating an asset mints nothing.
 * It becomes credits only when a power actually pays, through `terms.payment`
 * or a negotiated `adjust_credits` — both already conserved.
 *
 * That is what lets `kind` stay open, the same bargain `Commitment.kind`
 * strikes, and it is the opposite of `incomePerTurn`, which had to be capped
 * twice over precisely because it *is* money.
 *
 * ## Value is per UNIT, and that is not cosmetic
 *
 * Forty prisoners split into two lots of twenty; one heirloom does not split.
 * Stating value per unit rather than as a total means a split **conserves by
 * construction** — the arithmetic does it, rather than a model being trusted to
 * divide correctly.
 */
/**
 * The one asset kind an accord may bring into being.
 *
 * ## Why intelligence is not an asset, and a dossier is
 *
 * *"A piece of intelligence held exclusively"* looked like an asset and cannot
 * be one, for a reason that has nothing to do with schemas: **nothing prevents a
 * player from simply saying it.** Diplomacy is free text. A power that knows
 * where the Vantic keels are laid types that sentence into a channel and the
 * knowledge has moved, whatever any record says. An object you can hand over by
 * talking is not an object.
 *
 * So the line is drawn at the source. **What an operative produces is never an
 * asset** — it is knowledge, it is disclosable in conversation, and it may be
 * real consideration in a bargain without being a thing that changes hands. The
 * `intel` agent effect stays exactly what it is: live, derived from an unexposed
 * operative, and gone when the operative is burned.
 *
 * A **dossier** is the other thing. It is the paper, not the knowledge — a file
 * compiled, sealed and handed across a table — and it is the only asset kind
 * that an accord may *create*, because it is the one whose substance the
 * conversation itself supplies. Nothing is conjured: the seller already had the
 * knowledge for free, and what the deal makes is the record.
 *
 * That distinction is also what lets it stay simple. A dossier is **atomic**, so
 * there is no half a file and no question about how value divides; it has no
 * decay and no copy semantics, so exclusivity needs no lineage field; and it has
 * **no location**, because a record of a conversation is not standing on a world
 * to be seized with it. What it has is a natural per-faction value, which is the
 * whole of what makes it worth trading.
 */
export const DOSSIER_KIND = 'dossier';

export const AssetSchema = z.object({
  id: z.string().min(1),
  /** A lower_snake_case slug, invented freely — `prisoners`, `heirloom`, `ore`. */
  kind: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'kind must be a lower_snake_case slug'),
  /** One sentence, written to be read back to the player verbatim. */
  text: z.string().min(1).max(240),
  /** Who has it. An asset is always somebody's. */
  heldBy: z.string().min(1),
  quantity: z.number().int().min(1).max(100000),
  /** What one of it is: `crew`, `ton`, `heirloom`, `dossier`. */
  unit: z.string().min(1).max(24),
  /**
   * Whether it can be split into lots.
   *
   * Forty crews can be ransomed twenty at a time; a family heirloom cannot be
   * halved. `split_asset` refuses on an atomic one.
   */
  divisible: z.boolean().default(true),
  /**
   * factionId -> what one unit is worth to that power, in credits.
   *
   * A claim, never money. Absent means worth nothing to them, which is the
   * ordinary case and the point: prisoners are worth something to the power
   * that lost them and nothing to anybody else.
   */
  valuePerUnit: z.record(z.string(), z.number().int().min(0).max(10000)).default({}),
  /**
   * Where it physically is, if anywhere.
   *
   * Optional, and it is what makes an asset losable: prisoners held at a world
   * change hands when the world does. An asset with no location — a title, a
   * charter, a debt of honour — is held by the faction and travels with it.
   */
  atSystemId: z.string().nullable().default(null),
  /**
   * Whether it can leave the world it sits on.
   *
   * `atSystemId` already made an asset **losable** — anything at a world changes
   * hands when the world does — but it said nothing about whether the thing can
   * be handed over on its own, and the difference is the whole of what separates
   * a cargo from a fixture. A hundred tons of ore is at a world and can be
   * shipped anywhere; survey robots are at a world and can be crated up and
   * given away; a mine, an exchange, a theatre are *the world*, and the only way
   * to give one away is to give away the ground it stands on.
   *
   * So `portable: false` is refused by `transfer_asset` and reachable only
   * through `cession` or conquest — which needs no new code at all, because the
   * transfer-of-control path already moves everything standing on a world.
   *
   * A fixture with no world is nonsense and the reducer rejects it.
   */
  portable: z.boolean().default(true),
  /**
   * What it does every turn, if it does anything. See `AssetYieldSchema`.
   *
   * A yield **requires** `atSystemId`, and that is a design rule rather than a
   * technicality: a thing that pays must sit somewhere it can be taken. Without
   * it an asset that produced credits would be a perpetual income stream with no
   * counterplay whatever — unraidable, unblockadeable, unconquerable — which is
   * the one shape the economy here has consistently refused.
   */
  yield: AssetYieldSchema.nullable().default(null),
  acquiredTurn: z.number().int().min(0),
});
export type Asset = z.infer<typeof AssetSchema>;

/** What an asset is worth to a power, in total. A claim, never a ledger entry. */
export function assetWorthTo(asset: Asset, factionId: string): number {
  return (asset.valuePerUnit[factionId] ?? 0) * asset.quantity;
}

/** Everything a faction is holding. */
export function assetsOf(assets: readonly Asset[], factionId: string): Asset[] {
  return assets.filter((a) => a.heldBy === factionId);
}

export const VoidConditionSchema = z.object({
  kind: z.enum([
    /** `by` must not hold a live treaty with `target`. */
    'treaty_with',
    /** `by` must not be at war with `target`. */
    'attacks',
    /**
     * `by` must stay solvent.
     *
     * A payer whose treasury has floored at zero "pays" nothing while the
     * treaty goes on claiming it does — the obligation quietly stops being met
     * and nothing says so. This makes insolvency end the arrangement out loud,
     * so a party cannot keep the benefits of a deal it has stopped funding.
     */
    'insolvent',
    /**
     * `by` must still hold the asset named in `target`.
     *
     * What makes a hostage a hostage. Without it an accord could record that
     * someone was held against a treaty's performance and nothing anywhere
     * could notice them being killed, released or taken back — which is what a
     * playtest measured: hostages were offered twice, accepted once, and there
     * was no object to hold.
     */
    'asset_lost',
    /**
     * `by` must still hold the system named in `target`.
     *
     * The trigger an indemnity is written against — *"if Pell Reach falls"* —
     * and the reason this vocabulary is shared with `Commitment.contingencies`
     * rather than duplicated: a condition that can end a treaty is exactly the
     * kind of condition somebody insures against.
     */
    'world_lost',
  ]),
  /** The party the condition constrains. */
  by: z.string().min(1),
  /** The third power it constrains them against. Unused by `insolvent`. */
  target: z.string().default(''),
});
export type VoidCondition = z.infer<typeof VoidConditionSchema>;

export const TreatyTermsSchema = z.object({
  /**
   * Conditions that end this treaty when they come true. Evaluated every tick.
   */
  voidsOn: z.array(VoidConditionSchema).default([]),
  /** Systems whose ownership or access the treaty settles. */
  territory: z.array(z.string()).default([]),
  /** Fleet strength each party has pledged to the arrangement. */
  shipsPledged: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Flat credits moved every turn: positive receives, negative pays. */
  incomePerTurn: z.record(z.string(), z.number().int()).default({}),
  /**
   * Credits moved ONCE, when the treaty takes force: positive receives,
   * negative pays. The price of a cession, an indemnity, a lump settlement.
   *
   * This is the fourth money mechanism and it was the missing one. A one-time
   * price had nowhere to live — `incomePerTurn` is recurring, `incomeShares` is
   * a claim on a named system, and a commitment's `incomePerTurn` is
   * non-directional — so a negotiated purchase was written as narrative
   * `adjust_credits` and trimmed to `MAX_NARRATIVE_CREDITS`, while
   * `terms.territory` moved the worlds in full. Seven worlds changed hands for
   * 1,200 credits against 13,950 agreed.
   *
   * It carries no ceiling, and does not need one: it is a TRANSFER, conserved
   * to zero and bounded by what the payer actually holds, so it cannot invent a
   * credit. Only a flow into existence needs a cap.
   */
  payment: z.record(z.string(), z.number().int()).default({}),
  /** Claims on system income — the mechanism for neutral and shared worlds. */
  incomeShares: z.array(IncomeShareSchema).default([]),
  /** What obliges the signatories to act. Empty for treaties with no trigger. */
  mutualDefenseTrigger: z.string().default(''),
});
export type TreatyTerms = z.infer<typeof TreatyTermsSchema>;

/** A live treaty of one of the given types binding both factions. */
export function treatyBetween(
  treaties: Treaty[],
  turn: number,
  a: string,
  b: string,
  types: readonly TreatyType[],
): Treaty | undefined {
  return treaties.find(
    (t) =>
      isTreatyLive(t, turn) &&
      types.includes(t.type) &&
      t.parties.includes(a) &&
      t.parties.includes(b),
  );
}

/**
 * Treaties that forbid an attack. Breaking one of these is the betrayal the
 * whole galaxy hears about — see `PACT_BREAKING_REPUTATION_COST`.
 */
export const PEACE_TREATIES = ['non_aggression', 'ceasefire', 'mutual_defense'] as const;


/**
 * What every OTHER power's opinion of you drops by when you attack a partner.
 *
 * Distinct from the −25 the injured party feels: that is a grievance, this is
 * a reputation. Without it, breaking a pact was a private matter between two
 * factions and treachery had no strategic price at all.
 */
export const PACT_BREAKING_REPUTATION_COST = 10;

export const TreatySchema = z.object({
  id: z.string().min(1),
  type: TreatyTypeSchema,
  /** Exactly two parties. Multilateral pacts are modelled as several treaties. */
  parties: z.array(z.string().min(1)).length(2),
  terms: TreatyTermsSchema,
  signedTurn: z.number().int().min(0),
  /** null means indefinite; otherwise it lapses at the start of this turn. */
  expiresTurn: z.number().int().min(0).nullable().default(null),
  /**
   * `superseded` is what a renegotiation leaves behind: distinct from `expired`
   * (ran its term) and `broken` (repudiated, and priced accordingly), because
   * neither of those is what happened when the same parties simply rewrote the
   * same grant. Added after a playtest ratcheted one charter from 5% to 8% and
   * left both live.
   */
  status: z
    .enum(['active', 'expired', 'broken', 'superseded', 'pending', 'voided'])
    .default('active'),
  /**
   * The turn this treaty starts having effect. `null` means immediately.
   *
   * A `pending` treaty is one whose parties agreed but whose terms are not yet
   * live — a deal a council still has to ratify. It exists because extraction
   * is told, correctly, that a conditional promise produces nothing yet, so a
   * deal an NPC gated on ratification used to produce a `treaty_ratification`
   * order and no treaty at all. That order carries no payload by design, so the
   * order completed, logged, and changed nothing: a fully negotiated marriage,
   * supply line and transit compact evaporated on completion.
   *
   * Making it one object rather than an order plus a promise means there is no
   * second source of truth to desync, and the deal is visible in the treaties
   * panel while it waits instead of hiding inside an order.
   *
   * `isTreatyLive` gates on `status === 'active'`, so a pending treaty is inert
   * everywhere for free — no reader had to change.
   */
  effectiveTurn: z.number().int().min(0).nullable().default(null),
  /** One line the UI can show verbatim. */
  summary: z.string().default(''),
});
export type Treaty = z.infer<typeof TreatySchema>;

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export const AGENT_MISSIONS = [
  'sabotage',
  'surveillance',
  'subversion',
  'theft',
  'defection',
  'assassination',
] as const;
export const AgentMissionSchema = z.enum(AGENT_MISSIONS);
export type AgentMission = z.infer<typeof AgentMissionSchema>;

export const AGENT_MISSION_MEANING: Record<AgentMission, string> = {
  surveillance:
    'reveals the target\'s hidden orders on this system; no damage, and the quietest mission there is',
  theft: 'siphons credits from the system it sits on, every turn it succeeds',
  subversion: 'erodes a named stat while in place — the target governs, fights or builds worse',
  sabotage: 'destroys fleet strength every turn it succeeds; loud, and easier to trace',
  defection:
    'talks crews out of the target\'s service and into yours, one or two hulls at a time. How many is your guile against their resolve, not your choice — and a power resolute enough simply cannot be turned',
  assassination:
    'ONE attempt at a decapitating strike, then the operative is gone either way. Success is a heavy one-off blow and a collapse in relations; failure almost always ends with the agent caught',
};

/**
 * What the mission itself costs in risk and persistence.
 *
 * Without this, `mission` is a label: an agent doing 3 hull damage a turn
 * behaves identically whether it is called surveillance or assassination.
 * These are the two axes on which the missions genuinely differ.
 */
/**
 * What it costs to put an operative in place, by mission.
 *
 * Priced against the same economy as hulls (`SHIP_COST` 60, net incomes
 * 72-283 a turn): a watcher is cheaper than a corvette, a decapitation strike
 * costs more than two. Agents were previously free in every sense — no
 * deployment cost, no upkeep, no cap — which made an unbounded covert network
 * strictly dominant once a player noticed.
 *
 * Scales with what the mission actually requires rather than with its effect:
 * `assassination` is dear because arranging one is dear, and it is spent after
 * a single attempt either way.
 */
export const AGENT_COST: Record<AgentMission, number> = {
  surveillance: 40,
  theft: 60,
  subversion: 60,
  defection: 80,
  sabotage: 80,
  assassination: 150,
};

export interface MissionProfile {
  /** A failed roll at or below this exposes the operative. */
  exposureRisk: number;
  /** One attempt, then the agent is spent regardless of outcome. */
  oneShot: boolean;
  /** Multiplies the declared effect. A single strike hits far harder. */
  effectMultiplier: number;
}

export const MISSION_PROFILE: Record<AgentMission, MissionProfile> = {
  surveillance: { exposureRisk: 1, oneShot: false, effectMultiplier: 1 },
  theft: { exposureRisk: 2, oneShot: false, effectMultiplier: 1 },
  subversion: { exposureRisk: 2, oneShot: false, effectMultiplier: 1 },
  sabotage: { exposureRisk: 3, oneShot: false, effectMultiplier: 1 },
  // Riskier than theft — you are talking to people who may report you — but
  // it persists, because a defection network is a standing arrangement.
  defection: { exposureRisk: 4, oneShot: false, effectMultiplier: 1 },
  // A near-coin-flip on being caught, in exchange for one heavy blow.
  assassination: { exposureRisk: 9, oneShot: true, effectMultiplier: 4 },
};

/**
 * What an agent does to its target each turn.
 *
 * Effects are explicit numbers rather than narrative, so the player can see the
 * trade being made and the reducer can apply it deterministically.
 */
export const AgentEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hull_damage'),
    /** Fleet strength destroyed per turn on success. */
    perTurn: z.number().int().min(0).max(20),
  }),
  z.object({
    /**
     * Turn a rival's own institutions against it.
     *
     * **There was no op in the game that could raise another power's dissent.**
     * `adjust_dissent` is actor-only and upward-only by design — the guard that
     * stops it being the cheapest hostile act available — and
     * `adjust_disposition` measures the wrong quantity: how they feel about
     * *you*, not how their own people feel about them.
     *
     * So a playtest crowned a pretender and passed a bill of attainder against
     * the Iron Vigil, both successfully, and left it **mechanically identical**:
     * −200 credits and +15 of the actor's own dissent, for a legitimacy attack
     * the fiction described in detail and the arithmetic could not express.
     *
     * Mutates rather than being read where it is used, like `hull_damage` and
     * unlike `stat_debuff`: dissent accumulates and decays on its own clock, so
     * a value read fresh each turn would not accumulate at all.
     */
    kind: z.literal('sedition'),
    /** Dissent added to the target per turn on success. */
    perTurn: z.number().int().min(1).max(6),
  }),
  z.object({
    kind: z.literal('income_penalty'),
    /** Credits denied to the target per turn on success. */
    perTurn: z.number().int().min(0).max(400),
  }),
  z.object({
    kind: z.literal('stat_debuff'),
    stat: StatNameSchema,
    /** Points subtracted while the agent is in place. */
    magnitude: z.number().int().min(1).max(4),
  }),
  z.object({
    kind: z.literal('intel'),
    /** Reveals the target's hidden orders while in place. */
    revealsOrders: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('crew_defection'),
    /**
     * Hulls the operative TRIES for each turn. What it actually gets is
     * `subornLimit` — the owner's guile against the target's resolve — so this
     * is a ceiling on ambition, not a promise. A model cannot ask for a
     * squadron and receive one.
     */
    perTurn: z.number().int().min(1).max(4),
  }),
]);
export type AgentEffect = z.infer<typeof AgentEffectSchema>;

/**
 * What a mission does when nobody said.
 *
 * Used when a declared covert action is routed into the agent mechanic and the
 * resolution call did not supply an effect. Deliberately modest: the point of
 * routing is that the act is priced, capped and exposed like every other
 * operation, not that it hits hard. A model that wants more says so.
 */
export const DEFAULT_COVERT_EFFECT: Record<AgentMission, AgentEffect> = {
  surveillance: { kind: 'intel', revealsOrders: true },
  theft: { kind: 'income_penalty', perTurn: 10 },
  subversion: { kind: 'stat_debuff', stat: 'industry', magnitude: 1 },
  sabotage: { kind: 'hull_damage', perTurn: 2 },
  defection: { kind: 'crew_defection', perTurn: 1 },
  // One attempt, quadrupled by the mission profile, then the operative is gone.
  assassination: { kind: 'stat_debuff', stat: 'resolve', magnitude: 1 },
};

export const AgentSchema = z.object({
  id: z.string().min(1),
  ownerFactionId: z.string().min(1),
  /** Where the agent physically is. Drives which faction it harms. */
  systemId: z.string().min(1),
  mission: AgentMissionSchema,
  effect: AgentEffectSchema,
  /**
   * Per-turn chance the agent achieves its effect, 0–100. Computed in code
   * from the owner's guile against the target's counter-intelligence, never
   * chosen by a model.
   */
  successChance: z.number().int().min(0).max(100),
  deployedTurn: z.number().int().min(0),
  /** Exposed agents are visible to the target and stop producing effects. */
  exposed: z.boolean().default(false),
  cover: z.string().default(''),
});
export type Agent = z.infer<typeof AgentSchema>;

export function describeEffect(effect: AgentEffect): string {
  switch (effect.kind) {
    case 'hull_damage':
      return `−${effect.perTurn} fleet strength per turn`;
    case 'income_penalty':
      return `−${effect.perTurn} credits per turn`;
    case 'stat_debuff':
      return `−${effect.magnitude} ${effect.stat}`;
    case 'crew_defection':
      return `talks up to ${effect.perTurn} hull(s) a turn out of the target's service, as far as guile beats resolve`;
    case 'sedition':
      return `+${effect.perTurn} dissent a turn in the target's own institutions`;
    case 'intel':
      return 'reveals hidden orders';
  }
}

export function isTreatyLive(treaty: Treaty, turn: number): boolean {
  if (treaty.status !== 'active') return false;
  return treaty.expiresTurn === null || turn < treaty.expiresTurn;
}
