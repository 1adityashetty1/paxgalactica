import { z } from 'zod';
import {
  atThisTable,
  ConcessionSchema,
  RetractionSchema,
  type Concession,
  type Retraction,
} from '../domain/diplomacy.js';
import {
  DIFFICULTY_BANDS,
  describeCheck,
  formatModifier,
  resolveCheck,
  rollD20,
  statModifier,
  STAT_MEANINGS,
  STAT_NAMES,
  type CheckResult,
} from '../domain/checks.js';
import {
  AppraisalSchema,
  DeclaredRulingSchema,
  oneActPerRuling,
  rulingToAppraisal,
  type Appraisal,
  ExtractionOutputSchema,
  ModelTurnOutputSchema,
  ReactionSchema,
  ResolutionOutputSchema,
  type ExtractionOutput,
  type ReactionSet,
  type ResolutionOutput,
  cappedProse,
} from '../domain/ops.js';
import {
  effectiveStats,
  dispositionBetween,
  fleetStrengthOf,
  fleetTonsOf,
  getFaction,
  type WorldState,
  hullsAt,
} from '../domain/state.js';
import { classifyPrinciple, classifyPrinciples } from '../domain/compulsions.js';
import { checkGround, holdToRuling, INVENTED_REFUSAL_NOTE, inventedRefusal, ownOperativeNamed, type RulingBounds } from '../domain/refusals.js';
import { concessionBudget, withinBudget } from '../domain/leverage.js';
import { callStructured } from './client.js';
import { serializeArchetypes } from '../domain/assets.js';
import { loadPrompt } from './prompts.js';
import { paperOf, pressuresOn } from '../domain/pressures.js';
import { capabilitiesOf } from '../domain/capabilities.js';
import { ACT_WORDS } from '../domain/acts.js';
import { lineCrossable } from '../domain/line-reach.js';
import {
  serializeCharacter,
  serializePrinciples,
  serializeState,
  serializeTheirAssets,
} from './serialize.js';

/**
 * The duration rubric, for the passes that actually set a duration.
 *
 * That is resolution and reaction — the two that emit `issue_order`. It was
 * also appended to **extraction**, which cannot: `issue_order` is not in
 * `EXTRACTION_ALLOWED`, and the reducer refuses it with "an order is your own
 * work and costs an action to give". So the one pass that could never write a
 * `durationTurns` was carrying 944 tokens of anchors telling it how, on every
 * accord closed in the game.
 */
function withRubric(base: string): string {
  return `${base}\n\n---\n\n${loadPrompt('duration-rubric')}`;
}

/**
 * The asset catalogue is substituted at call time, never pasted into the file.
 *
 * `ASSET_ARCHETYPES` decides what a `prisoners` haul is actually like — whether
 * it divides, whether it is an instrument, whether its worth is a band — and the
 * reducer *corrects* a call that disagrees. A table restated in Markdown beside
 * it is a second opinion that will eventually be wrong and will fail silently,
 * exactly the drift `tests/prompt-drift.test.ts` exists to catch for hull
 * prices. Substituting means there is one table.
 */
const ARCHETYPE_MARKER = '<!-- ASSET_ARCHETYPES -->';
function withArchetypes(base: string): string {
  return base.includes(ARCHETYPE_MARKER)
    ? base.replace(ARCHETYPE_MARKER, serializeArchetypes())
    : base;
}

/* ------------------------------------------------------------------ */
/* 1. Resolution                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve a declared action.
 *
 * The d20 is rolled HERE, in code, before the model is asked anything, and the
 * result is handed to it. The model decides which stat the action tests and how
 * hard it is; it cannot decide whether the dice were kind. Seeding the roll
 * from (turn, salt) keeps replay exact — the same action on the same turn always
 * rolls the same number.
 */
/**
 * Price an action without knowing the roll.
 *
 * Separated from resolution precisely so that it cannot see the d20. When the
 * two were one call, the prompt showed the roll and then asked for a
 * difficulty — and a DC chosen with the roll in hand is a verdict, not a
 * difficulty. A model could make any action succeed by pricing it at 10 and
 * any action fail by pricing it at 19, which made "the model does not decide
 * whether an action succeeds" untrue in the one place it mattered.
 */
export async function appraiseAction(
  state: WorldState,
  action: string,
  /**
   * Whose institutions are ruling. Defaults to the player, which is right for
   * every declared action and every accord they close.
   *
   * Passed explicitly when the question is *"would the OTHER power's own people
   * stand for this"* — the half `appraiseAgreement` deliberately never asked,
   * on the correct ground that the counterparty's concessions cannot trip the
   * player's lines. It turns out they should trip their own: a playtest watched
   * the Iron Vigil negotiate for three messages and sign an accommodation with
   * the Nars against a sheet that says *"no accommodation with pirates,
   * smugglers or the Nars may be entertained, however useful"*, at no cost to
   * itself whatsoever.
   */
  viewerId: string = state.playerFactionId,
  /**
   * `declared: false` for an accord, which is never rolled and so is never
   * priced. `note` is appended to the question — used once, to ask for the
   * price of an action code has ruled admissible after all.
   */
  opts: { declared?: boolean; note?: string } = {},
): Promise<{ appraisal: Appraisal; attempts: number; costUsd: number }> {
  const stats = effectiveStats(state, viewerId);
  const bands = DIFFICULTY_BANDS.map((b) => `  DC ${b.dc} ${b.label} — ${b.example}`).join('\n');
  const statLines = STAT_NAMES.map(
    (s) => `  ${s} ${stats[s]} (${formatModifier(statModifier(stats[s]))}) — ${STAT_MEANINGS[s]}`,
  ).join('\n');
  const actor = getFaction(state, viewerId);

  const res = await callStructured({
    kind: 'appraisal',
    label: 'the arbiter considers it',
    system: loadPrompt('appraisal'),
    user: [
      // `positions`, not `full`: the arbiter rules on what the ACTING power may
      // attempt, what it tests and how hard, and it is handed that power's own
      // red lines and compulsions below. Four rivals' doctrine paragraphs
      // decide none of that, and this is the most frequent call in the game.
      serializeState(state, viewerId, 'positions'),
      '',
      '---',
      '',
      // The arbiter now rules on whether an action breaks one of the acting
      // faction's own principles, and for its whole existence before that it
      // was never shown them: `serializeState` carries doctrine and ethics but
      // not red lines or compulsions. A referee cannot enforce a rule it has
      // not been given.
      '## The acting faction’s own character',
      '',
      actor ? serializePrinciples(actor) : '_Unknown._',
      '',
      '---',
      '',
      '## The acting faction’s capabilities',
      '',
      statLines,
      '',
      '## Difficulty bands',
      '',
      bands,
      '',
      '---',
      '',
      '## Declared action',
      '',
      action,
      ...(opts.note ? ['', '---', '', opts.note] : []),
    ].join('\n'),
    // Two schemas, two answer shapes: an accord is never rolled, so it keeps
    // the flat ruling; a declared act is parts.
    schema: (opts.declared === false ? AppraisalSchema : DeclaredRulingSchema) as z.ZodType<unknown>,
    ...(opts.declared === false ? {} : { lenient: oneActPerRuling }),
  });

  // A declared ruling comes back as parts; the rest of resolution reads the
  // flat shape it was built on (`rulingToAppraisal`).
  return { appraisal: rulingToAppraisal(res.value), attempts: res.attempts, costUsd: res.costUsd };
}

/**
 * Is this the name of a body inside the faction, rather than the faction?
 *
 * A defiance is spoken by someone — the officer corps, the Trade Council, the
 * old cousins — and a bare faction id or name in that slot reads as nonsense
 * once it is rendered ("vigil object, and the order goes out anyway").
 */
function namesAnInstitution(by: string | undefined, state: WorldState): boolean {
  if (!by) return false;
  const cleaned = by.trim().toLowerCase();
  if (cleaned.length === 0) return false;
  return !state.factions.some(
    (f) => f.id.toLowerCase() === cleaned || f.name.toLowerCase() === cleaned,
  );
}

/**
 * Rule on whether a negotiated agreement breaks the acting power's own
 * principles, before any of it is staged.
 *
 * The arbiter gated the declaration path and nothing gated extraction, so a red
 * line could be walked past simply by framing the act as a deal. Measured live:
 * the Ojjul Nar Combine, whose first red line is *"will not forgive an unpaid
 * debt — the debt is the whole instrument of control"*, negotiated a
 * "renegotiation" with Drajk and the extraction pass emitted `forgive_debt`
 * against that line with no refusal, no defiance and **no dissent**. The
 * identical intent declared as an ordinary action was refused three times.
 *
 * It is sharper than a missing check: `establish_debt` and `forgive_debt` are
 * extraction-only *by design*, so the two ops most tied to that faction's
 * identity lived entirely on the ungated path.
 *
 * Reuses the arbiter rather than adding a prompt: entering into a deal IS an
 * act the institutions get a view on, and `breach` is the only field read back.
 * Scoped to the acting faction by construction, because `appraiseAction`
 * appraises from `playerFactionId` — the other party's own concessions are
 * theirs to make and must not trip your line.
 */
export async function appraiseAgreement(
  state: WorldState,
  withFactionId: string,
  agreed: string,
  /** Whose institutions are ruling. Defaults to the player — see `appraiseAction`. */
  viewerId?: string,
): Promise<{ appraisal: Appraisal; costUsd: number }> {
  const other = getFaction(state, withFactionId)?.name ?? withFactionId;
  const res = await appraiseAction(
    state,
    [
      `Your envoys have concluded an agreement with ${other} and are about to put it into effect.`,
      '',
      `What was agreed: ${agreed}`,
      '',
      // Rule on what the accord OBLIGES, not only on what it enacts today.
      //
      // A red line crossed in future tense used to pass clean. Measured live:
      // Meridian's line is "will not close a lane — no blockade of civilian
      // traffic, no embargo, no shut border", the unconditional closure was
      // refused with that line quoted, and the identical act written as
      // "if Vigil forces move on Vashka, Meridian closes the Sennex lane"
      // returned no refusal, no defiance and no dissent — leaving a live treaty
      // obliging exactly the forbidden thing.
      //
      // This does NOT make conditional pacts suspect in general, which was the
      // obvious worry and is wrong: it only bites when the obliged act is
      // itself forbidden. A mutual defence pact obliges sending ships, which is
      // on nobody's red line; the two cases where it does bite — the Combine
      // pledging its own hulls to a war of conquest, Drajk committing to sit
      // and defend — are the characterisation working, not collateral.
      'Judge what this commits you to, not only what it does the moment it is',
      'signed. An undertaking to do a thing later is an undertaking to do that',
      'thing: if honouring this agreement would require you to cross one of your',
      'own lines, it crosses it now, however the clause is worded and whether or',
      'not the condition ever comes true. A power does not promise what it will',
      'not do.',
      '',
      'This is about the SUBSTANCE of the obligation, not about conditionality.',
      'Promising to send ships if an ally is attacked is an ordinary pact and',
      'breaches nothing. Promising to close a lane, pay tribute, or hand over a',
      'world is a breach for a power whose lines forbid those things, whatever',
      'the trigger.',
      '',
      'An agreement is never rolled, so it has no price: leave `stat` and',
      '`difficulty` out.',
    ].join('\n'),
    viewerId,
    // An accord is never rolled, so it is never priced.
    { declared: false },
  );
  return { appraisal: res.appraisal, costUsd: res.costUsd };
}

export const BreachRelevanceSchema = z.object({
  /** Does the act actually do the thing the line forbids or demands? */
  relevant: z.boolean(),
  /** One clause, in plain words, for the log. */
  why: z.string().max(200).default(''),
});

/**
 * A second, cheap opinion on whether a quoted line is actually about this act.
 *
 * `classifyPrinciple` verifies that a quoted line **exists** on the sheet. It
 * cannot verify the line is **relevant**, and relevance is exactly the judgement
 * being delegated. Measured live: an assassination was charged
 * `COMPULSION_BREACH_DISSENT` quoting *"commerce raiding is refused outright"*.
 * The quote was real; the reading was nonsense. Code faithfully charged 15
 * dissent for a compulsion the act does not touch, and the same declaration
 * made twice in one turn produced a breach once and nothing the other time —
 * the difficulty was stable at DC 18 both times, so it is specifically the
 * breach reading that wobbles.
 *
 * Deliberately a **separate, tiny call** rather than a field on the appraisal:
 * asking the same pass that found the breach whether the breach is real gets
 * the answer it already gave. This one is shown the act and the line and
 * nothing else — not the character sheet, not the state — so it has nothing to
 * reason from except whether the two match.
 *
 * It runs **only when a breach was named**, which is rare, so it costs nothing
 * on an ordinary action. On a false positive the cost is one Haiku call and a
 * charge that should not have been made is dropped.
 */
/**
 * One breach ruling, recorded whether or not it cost anything.
 *
 * `docs/todo.md` section A accepts arbiter variance as irreducible; it does not
 * accept being unable to *measure* it. A playtest found the same act ruled three
 * different ways across three turns, and that could only ever be an anecdote,
 * because a ruling that decides not to charge leaves no trace anywhere.
 */
export interface BreachRuling {
  action: string;
  via: 'declared' | 'accord';
  named: string[];
  matched: string | null;
  kind: 'red_line' | 'compulsion' | null;
  relevant: boolean | null;
  outcome:
    | 'refused'
    | 'charged'
    | 'dropped_irrelevant'
    | 'dropped_unmatched'
    | 'dropped_contradicted';
}

/** The ruling record for a pass that named lines, or `null` if it named none. */
export function recordRuling(
  action: string,
  via: 'declared' | 'accord',
  named: string[],
  firstPass: { kind: 'red_line' | 'compulsion'; principle: string } | null,
  relevant: boolean | null,
  survived: boolean,
): BreachRuling | null {
  if (named.length === 0) return null;
  const outcome: BreachRuling['outcome'] = survived
    ? firstPass?.kind === 'red_line'
      ? 'refused'
      : 'charged'
    : firstPass === null
      ? 'dropped_unmatched'
      : relevant === false
        ? 'dropped_irrelevant'
        : 'dropped_contradicted';
  return {
    action: action.slice(0, 200),
    via,
    named: named.slice(0, 3),
    matched: firstPass?.principle ?? null,
    kind: firstPass?.kind ?? null,
    relevant,
    outcome,
  };
}

export async function verifyBreachRelevance(
  action: string,
  principle: string,
  kind: 'red_line' | 'compulsion',
  /**
   * The power whose line it is. Where its seed tags the line with the acts it
   * forbids (`Faction.lineActs`), the check is shown that closed list and asked
   * whether the act is one of them. Loop 4 of the advisor playtest: "will not
   * repudiate a contract" refused handing Meridian's own note to the Combine
   * and offering Arkane a seat, three times — neither goes back on anything,
   * and an open "is this about that" let all three through.
   */
  sheet?: { lineActs?: readonly { text: string; forbids: readonly string[] }[] } | null,
): Promise<{ relevant: boolean; why: string; costUsd: number }> {
  const forbids = sheet?.lineActs?.find((t) => t.text === principle)?.forbids ?? [];
  const named = forbids.map((a) => (ACT_WORDS as Record<string, string>)[a] ?? a.replace(/_/g, ' '));
  const system = [
    'You check one thing and answer nothing else.',
    '',
    'You are given an ACT a power is about to take, and one LINE from that',
    "power's own character — either something it refuses to do, or something",
    'its institutions demand of it.',
    '',
    'Answer whether the act genuinely does the thing that line is about.',
    '',
    'Say `relevant: true` when the act does what the line forbids, or fails to',
    'do what it demands, even if the wording differs — judge the act, not the',
    'phrasing. A blockade dressed up as withdrawing insurance still closes a',
    'lane. And the other way: a fleet sent to fight or "block" another fleet is',
    'a battle, not a closed lane.',
    '',
    'Say `relevant: false` when the line is simply about something else. A line',
    'about preying on shipping has nothing to say about an assassination; a line',
    'about refusing tribute has nothing to say about building a shipyard. Being',
    'generally out of character is not enough — the line has to be about THIS.',
    '',
    'You are not deciding whether the act is wise, legal or in character. Only',
    'whether that specific line is the right line to invoke.',
  ].join('\n');

  const res = await callStructured({
    kind: 'breach_relevance',
    label: 'breach-relevance',
    system,
    user: [
      `ACT: ${action}`,
      '',
      `LINE (${kind === 'red_line' ? 'something this power refuses' : 'something its institutions demand'}): ${principle}`,
      ...(named.length > 0
        ? [
            '',
            `This line forbids exactly these acts, and nothing else: ${named.join('; ')}.`,
            'Say `relevant: true` only if the act is one of them.',
          ]
        : []),
    ].join('\n'),
    schema: BreachRelevanceSchema,
  });
  return { relevant: res.value.relevant, why: res.value.why, costUsd: res.costUsd };
}

/* ------------------------------------------------------------------ */
/* A random event, dressed for the player                              */
/* ------------------------------------------------------------------ */

export const EventFlavourSchema = z.object({
  line: z.string().min(1).max(280),
});

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12,
};

/**
 * Every number in `text`, digits or spelled out. What the guard below compares.
 * "Sixty-three" is read as 63, since that is how a line dressing "63 credits"
 * says it; anything longer than a hyphenated pair is read word by word, which
 * refuses more than it needs to and falls back to the plain line when it does.
 */
function numbersIn(text: string): string[] {
  const digits = text.match(/\d+/g) ?? [];
  const words = (text.toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) ?? []).flatMap((token) => {
    const [a, b] = token.split('-');
    const x = NUMBER_WORDS[a!];
    const y = b === undefined ? undefined : NUMBER_WORDS[b];
    if (x !== undefined && y !== undefined && x >= 20 && x % 10 === 0 && y < 10) return [String(x + y)];
    return [a, b].filter((w): w is string => w !== undefined && w in NUMBER_WORDS).map((w) => String(NUMBER_WORDS[w]));
  });
  return [...digits, ...words];
}

/**
 * The one guard code can hold a flavour line to: **no number the plain line
 * does not already contain.** A number is the likeliest invented fact and the
 * one a reader is likeliest to believe — "loses 40 tons" beside a plain line
 * saying 12 is the failure this exists to stop. Anything subtler is the
 * prompt's job, and the plain line is always shown beneath, so a line that
 * slips past this is colour beside a fact rather than instead of one.
 */
export function flavourKeepsTheFacts(plain: string, line: string): boolean {
  const allowed = new Set(numbersIn(plain));
  // "One" is how English says "a", so it is always allowed: "one storm" adds
  // nothing a plain line about a storm did not already say.
  return numbersIn(line).every((n) => n === '1' || allowed.has(n));
}

/**
 * Rewrite one event's plain line in the setting's voice (item 124).
 *
 * **Never state, and never load-bearing.** Nothing reads what comes back but a
 * card on the player's screen; it is not journaled and replay never calls it —
 * the position the epilogue's prose is in. So it may fail freely: the caller
 * keeps the plain line on any error, and on a line that fails
 * `flavourKeepsTheFacts`.
 */
export async function dressRimEvent(
  title: string,
  plain: string,
): Promise<{ line: string | null; costUsd: number }> {
  const res = await callStructured({
    kind: 'event_flavour',
    label: 'event-flavour',
    system: loadPrompt('event-flavour'),
    user: [`EVENT: ${title}`, `PLAIN SENTENCE (settled fact): ${plain}`].join('\n'),
    schema: EventFlavourSchema,
    // One retry: this is colour, and the plain line is already on screen.
    maxRetries: 1,
  });
  const line = res.value.line.trim();
  return { line: flavourKeepsTheFacts(plain, line) ? line : null, costUsd: res.costUsd };
}

export const ReconcileSchema = z.object({
  narrative: z.string().min(1).max(1200),
});

/**
 * A story rewritten to what landed (`docs/design-2026-10-18-code-knows.md` §5).
 *
 * Resolution writes the story and the ops in one call, before the reducer has
 * ruled on them, and half the playtest's declarations ended with a story that
 * said more than happened — a crew that defected and did not, twelve lifters
 * where six were laid down. Run only when the two differ, on the cheap tier,
 * and held to the guard the Rim's lines are: no number the landed acts and the
 * notes do not contain. A rewrite that fails it, or a call that fails, leaves
 * the draft standing.
 */
export async function reconcileNarrative(
  draft: string,
  landed: string,
  notes: readonly string[],
): Promise<{ narrative: string | null; costUsd: number }> {
  const facts = [landed, ...notes].join('\n');
  const res = await callStructured({
    kind: 'reconcile',
    label: 'reconcile',
    system: loadPrompt('reconcile'),
    user: [`DRAFT STORY:\n${draft}`, `ACTS THAT LANDED (settled):\n${landed || '(none)'}`, `NOTES (settled):\n${notes.join('\n')}`].join('\n\n'),
    schema: ReconcileSchema,
    maxRetries: 1,
  });
  const narrative = res.value.narrative.trim();
  return { narrative: flavourKeepsTheFacts(facts, narrative) ? narrative : null, costUsd: res.costUsd };
}

/* ------------------------------------------------------------------ */
/* The epilogue                                                        */
/* ------------------------------------------------------------------ */

export const EpilogueSchema = z.object({
  slides: z.array(
    z.object({
      factionId: z.string().min(1),
      text: z.string().min(1).max(1200),
    }),
  ),
  closing: z.string().min(1).max(1200),
});
export type EpilogueOutput = z.infer<typeof EpilogueSchema>;

/**
 * Close the campaign.
 *
 * Runs once, on the turn the limit is reached. Handed a dossier of facts
 * computed in `engine/epilogue.ts` rather than raw state, for the reason the
 * prompt states: this is the last thing the player reads and there is no turn
 * left in which to catch an invented war.
 *
 * The caller is expected to fall back to `fallbackEpilogue` if this throws. An
 * ending that fails to appear is worse than a plain one, and a model call can
 * fail for reasons that have nothing to do with the campaign.
 */
export async function narrateEpilogue(
  dossier: string,
  characters: string,
): Promise<{ output: EpilogueOutput; costUsd: number }> {
  const res = await callStructured({
    kind: 'epilogue',
    label: 'epilogue',
    system: loadPrompt('epilogue'),
    user: [
      '# Dossier — the galaxy at the last bell',
      '',
      dossier,
      '',
      '# The powers, in their own terms',
      '',
      characters,
    ].join('\n'),
    schema: EpilogueSchema,
  });
  return { output: res.value, costUsd: res.costUsd };
}

/** How resolution writes the mechanism the arbiter named for a commitment (intent-ops §5). */
const MECHANISM_GUIDANCE: Record<string, string> = {
  income:
    'It pays every turn: set `incomePerTurn`, positive for the side that earns. Without it the commitment is refused. A charter pays from a world: name it in `systemId`, a world this power holds, or it is chartered on the richest. It pays at most a quarter of what that world pays, and nothing once the world is lost — say so if the figure is more.',
  record: 'It is a record and nothing more: no income — any you write is left out.',
};

export async function resolveAction(
  state: WorldState,
  action: string,
  salt = '0',
): Promise<{
  output: ResolutionOutput;
  check: CheckResult | null;
  roll: number;
  attempts: number;
  costUsd: number;
  /**
   * What the arbiter ruled about the actor's own principles, and what became of
   * it — including the rulings that charged nothing, which are the ones nothing
   * else records. `null` when no line was named at all.
   */
  ruling: BreachRuling | null;
  /** What code changed about the ruling or the batch, for the player to read. */
  notes: string[];
  /** What the ruling lets a batch carry, so a correction is held to it too. Absent when nothing was resolved. */
  bounds?: RulingBounds;
}> {
  /* --- 1. Arbitrate: admissible at all, and priced blind to the roll --- */
  let priced = await appraiseAction(state, action);
  const actor = getFaction(state, state.playerFactionId);

  // A refusal that cites a rule nobody wrote is not a ruling. The prompt bans
  // three of them in bold and two playtests watched the arbiter reach for them
  // anyway, so the check is code: the ruling is put back with what it got
  // wrong, once. A "no mechanic" refusal that survives the retry is what
  // `unexpressed` is for, and is turned away on that path, so it is recorded
  // as the missing outcome rather than as a reason the world gave.
  const notes: string[] = [];
  const invented = priced.appraisal.admissible ? null : inventedRefusal(priced.appraisal.reason);
  if (invented) {
    const again = await appraiseAction(state, action, undefined, {
      note: [
        '## Your first ruling broke a rule of the arbiter',
        '',
        `You ruled: "${priced.appraisal.reason}"`,
        '',
        INVENTED_REFUSAL_NOTE[invented],
        'Rule again. Refuse only for a fact in the state block above.',
      ].join('\n'),
    });
    priced = {
      appraisal: again.appraisal,
      attempts: priced.attempts + again.attempts,
      costUsd: priced.costUsd + again.costUsd,
    };
    const still = priced.appraisal.admissible ? null : inventedRefusal(priced.appraisal.reason);
    if (still === 'no_mechanic') {
      priced.appraisal = { ...priced.appraisal, unexpressed: priced.appraisal.reason, admissible: true };
    }
    notes.push(`The arbiter's first ruling cited a rule that does not exist (${invented}), and was made again.`);
  }

  // A refusal stands on a ground code can check. One that is not true on the
  // board is put back once with what was wrong; a second that fails is the
  // missing outcome, turned away at no action and logged, rather than a reason
  // the world never gave. See `checkGround`.
  // Not for a refusal that quotes the actor's own sheet: that is a breach
  // ruled in the wrong place, and the breach path below rewrites it.
  if (
    !priced.appraisal.admissible &&
    priced.appraisal.ground &&
    !(actor && classifyPrinciple(actor, priced.appraisal.reason))
  ) {
    const wrong =
      priced.appraisal.ground.kind === 'already_so' && standingOrder(action)
        ? null
        : (checkGround(state, state.playerFactionId, priced.appraisal.ground, action) ?? sendingIsTheAct(state, action, priced.appraisal.ground));
    if (wrong) {
      const again = await appraiseAction(state, action, undefined, {
        note: [
          '## Your refusal stands on something that is not so',
          '',
          `You refused on \`${priced.appraisal.ground.kind}\`, and the board says otherwise: ${wrong}`,
          'Rule again. Refuse only on a ground that is true in the state block; if none is, rule the act as parts, and put whatever no mission does in an `unexpressed` part.',
        ].join('\n'),
      });
      priced = {
        appraisal: again.appraisal,
        attempts: priced.attempts + again.attempts,
        costUsd: priced.costUsd + again.costUsd,
      };
      const still =
        !priced.appraisal.admissible && priced.appraisal.ground
          ? (checkGround(state, state.playerFactionId, priced.appraisal.ground, action) ??
            sendingIsTheAct(state, action, priced.appraisal.ground))
          : null;
      if (still) {
        priced.appraisal = { ...priced.appraisal, admissible: true, unexpressed: priced.appraisal.reason, ground: undefined };
      }
      notes.push(`The arbiter's first refusal rested on something not true on the board (${wrong}), and was made again.`);
    }
  }

  // An act that names one of the actor's own operatives, ruled with no covert
  // or groundwork part, has almost certainly lost the part that sends them —
  // and with sends now the ruling's alone, a lost part is an operative who
  // never goes. Put back once with the name; if the ruling stands, the act is
  // overt and nobody is sent.
  {
    const a = priced.appraisal;
    const own = (state.agents ?? []).filter((x) => x.ownerFactionId === state.playerFactionId);
    // An overt part that lists one of the actor's own operatives has put a
    // covert hand into open work; and words naming one, with no covert or
    // groundwork part at all, have lost the part that sends them.
    const listed = (a.involves ?? [])
      .map((n) => own.find((x) => x.id === n || ownOperativeNamed([x], state.playerFactionId, n)))
      .find(Boolean)?.name;
    const operative =
      a.admissible && !a.negotiation
        ? listed ??
          (!a.unexpressed && !(a.covert?.length) && !(a.groundwork?.length)
            ? ownOperativeNamed(state.agents, state.playerFactionId, action)
            : null)
        : null;
    if (operative) {
      const again = await appraiseAction(state, action, undefined, {
        note: [
          '## This act names one of your operatives',
          '',
          `It names **${operative}**. If ${operative} carries it out, it is covert work: read it by its outcome and rule it with a \`covert\` part (or \`groundwork\`, if it only prepares). Rule it without one only if ${operative} has no hand in it.`,
        ].join('\n'),
      });
      priced = {
        appraisal: again.appraisal,
        attempts: priced.attempts + again.attempts,
        costUsd: priced.costUsd + again.costUsd,
      };
    }
  }

  // What the arbiter NAMED, classified against the sheet rather than by its own
  // label — see `classifyPrinciple`. The model is good at spotting which line an
  // action touches and unreliable at saying which list that line is on, so the
  // judgement is taken and the lookup is not.
  const named = priced.appraisal.breach?.principles ?? [];
  const firstPass = actor && named.length > 0 ? classifyPrinciples(actor, named) : null;

  // A second, cheap opinion on whether the line is actually about this act.
  // `classifyPrinciples` proves the quote is real; nothing proved it was
  // relevant, and a playtest charged 15 dissent for "commerce raiding is
  // refused outright" on an assassination. Only fires when a breach was named.
  let relevanceCost = 0;
  let classified = firstPass;
  let relevant: boolean | null = null;
  if (firstPass) {
    const check = await verifyBreachRelevance(action, firstPass.principle, firstPass.kind, actor);
    relevanceCost = check.costUsd;
    relevant = check.relevant;
    if (!check.relevant) classified = null;
  }
  // A line that forbids only going back on paper the power does not hold
  // cannot be crossed by anything it does now, whatever the two calls said.
  if (classified && actor && !lineCrossable(state, actor.id, classified.principle)) {
    notes.push(`"${classified.principle}" names paper ${actor.name} does not hold, so this act cannot cross it.`);
    classified = null;
  }

  // `admissible: false` is the one exit that charges nothing at all, which makes
  // it the cheapest possible bypass for a principle — and a live playtest found
  // the arbiter reaching for it on a compulsion worth 25 dissent and a landed
  // order, having correctly quoted the line in its reason. The prompt says "out
  // of character is not inadmissible"; this is what says it in code. An
  // inadmissible ruling whose reason quotes a real line off the sheet is
  // rewritten into the breach it actually is.
  const smuggled =
    !priced.appraisal.admissible && actor && !classified
      ? classifyPrinciple(actor, priced.appraisal.reason)
      : null;
  const ruled = classified ?? smuggled;

  // The ruling, recorded once and carried out of every exit — including the
  // exits that charge nothing, which are exactly the rows a drift report needs.
  const ruling = recordRuling(action, 'declared', named, firstPass, relevant, ruled !== null);

  // A ruling of inadmissible ends it here. No roll, no ops, no cost beyond
  // the arbitration — the action was not attempted, so there is nothing to
  // resolve. Distinct from a FAILED check (attempted, went badly) and from a
  // REFUSAL (your own institutions would not carry it out).
  if (!priced.appraisal.admissible && !ruled) {
    return {
      output: {
        narrative:
          priced.appraisal.reason ||
          'That cannot be attempted as things stand.',
        ops: [],
        inadmissible: priced.appraisal.reason || 'That cannot be attempted as things stand.',
      },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }

  /* --- 1b. A red line ends it here, before the dice ------------------- */
  // The classification used to sit inside the resolution call, which is the
  // pass that has already been told the outcome and asked to make it real —
  // and it duly ruled that almost nothing broke a principle. Three flagrant
  // compulsion breaches in one playtest cost nothing and a red line was never
  // once returned as a refusal.
  //
  // Ruling it here is structural rather than persuasive: on a red line there
  // IS no resolution call, so there is nothing left to argue the order back
  // into existence. A red line is absolute, and no roll can buy it.
  //
  // `ruled` rather than the arbiter's own `kind`, and the sheet's wording rather
  // than the quote: the player is charged for the line as their faction states
  // it, which is also the string every other reader in the game matches on.
  const breach = ruled
    ? {
        kind: ruled.kind,
        principle: ruled.principle,
        by: priced.appraisal.breach?.by ?? 'your own institutions',
        reason:
          priced.appraisal.breach?.reason ||
          priced.appraisal.reason ||
          'Your institutions will not have it.',
      }
    : null;

  if (breach?.kind === 'red_line') {
    return {
      output: {
        narrative: breach.reason,
        ops: [],
        refusal: {
          by: breach.by,
          reason: breach.reason,
          violated: breach.principle,
        },
      },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }

  /* --- 1b''. Works need somewhere to stand ---------------------------- */
  // Named by the arbiter before the roll, checked here against the board: a
  // world the power neither holds nor has ships over cannot be built on, so
  // the act is turned away as inadmissible — no roll, no action, no cost —
  // however the dice would have fallen (loop 12).
  // Never on an influence act: an envoy or an offer of development needs only
  // a world next to it, and the arbiter named the world it would develop as
  // `buildsAt`, turning two envoys away (loop 13).
  // Only on industry, which is what works are: a landing named the world it
  // was sailing for and was turned away too (loop 14).
  const builds = priced.appraisal.stat === 'industry' ? (priced.appraisal.buildsAt ?? []) : [];
  const nowhere = builds.filter((id) => {
    const world = state.systems.find((x) => x.id === id);
    return world !== undefined && world.controllerFactionId !== state.playerFactionId && hullsAt(world, state.playerFactionId) === 0;
  });
  if (nowhere.length > 0 && nowhere.length === builds.length) {
    const names = nowhere.map((id) => state.systems.find((x) => x.id === id)?.name ?? id).join(' and ');
    const why = `Nothing of yours stands at ${names} to build on: works need a world you hold, or a fleet of yours over it.`;
    return {
      output: { narrative: why, ops: [], inadmissible: why },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }

  /* --- 1b'. Covert work needs somebody on the books -------------------- */
  // Recruiting an operative and sending one are two actions (version 11), so a
  // covert attempt by a power with nobody to send is not a thing that can be
  // tried this turn. Turned away here, before the roll and before resolution,
  // at the price of an inadmissible ruling — nothing — rather than rolled,
  // charged an action, and then rejected by the reducer for want of a person.
  let covert = priced.appraisal.covert ?? [];
  let groundwork = priced.appraisal.groundwork ?? [];
  // An outcome no mission produces is said so, and costs nothing: the act is
  // turned away as inadmissible — no action point — and the reason is the
  // record of what the next mission should be. Only when nothing else in the
  // act could be done; alongside a mission it is a note.
  if (priced.appraisal.unexpressed && covert.length === 0 && groundwork.length === 0 && !priced.appraisal.overt) {
    // Handing something to a named power needs that power: "cede Torrek
    // Anchorage to the Vigil" came back as "no mission does that yet" over an
    // invented rule about a debt, where the bilateral list in the prompt names
    // ceding territory as a negotiation (loop 19). Said as the redirect it is.
    const to = handedTo(state, action);
    if (to) {
      const name = getFaction(state, to)?.name ?? to;
      return {
        output: {
          narrative: `That needs ${name} to agree to it.`,
          ops: [],
          negotiation: { withFactionIds: [to], what: action.slice(0, 240), supported: true, channels: `/talk ${to}` },
        },
        check: null,
        roll: 0,
        attempts: priced.attempts,
        costUsd: priced.costUsd + relevanceCost,
        ruling,
        notes,
      };
    }
    const why = `No mission does that yet: ${priced.appraisal.unexpressed}`;
    return {
      output: { narrative: why, ops: [], inadmissible: why },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }
  if (priced.appraisal.unexpressed) {
    notes.push(`Not done in this order: ${priced.appraisal.unexpressed}`);
  }
  const onBooks = (state.agents ?? []).some(
    (a) => a.ownerFactionId === state.playerFactionId && !a.exposed,
  );
  // An act with open work in it is not turned away for its covert half: the
  // open work goes ahead and the sending is left out, said. "Recruit an
  // operative and settle the debt", and a build beside an invasion, were both
  // turned away whole as "nobody to send" (playtest 2026-10-18, B9).
  if ((covert.length > 0 || groundwork.length > 0) && !onBooks && priced.appraisal.overt) {
    notes.push('You have nobody on the books to send, so the covert part of this was left out; the rest goes ahead.');
    covert = [];
    groundwork = [];
    priced = { ...priced, appraisal: { ...priced.appraisal, covert: [], groundwork: [] } };
  }
  if ((covert.length > 0 || groundwork.length > 0) && !onBooks) {
    const why =
      'You have nobody to send. Recruit an operative first — that is an action of its own, at a world you hold — and send them with your next.';
    return {
      output: { narrative: why, ops: [], inadmissible: why },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }

  /* --- 1c. A negotiation is not a decree; send them to the channel ---- */
  // Ordered after the red-line check on purpose: an action your own people will
  // not carry out is refused whether or not it also needed someone else's
  // agreement, so being told "that is a conversation" never launders a breach.
  //
  // This closes a real hole rather than adding polish. `form_treaty` used to be
  // model-emittable from a resolution call, and the reducer checked only that
  // the two ids existed and differed — so a declared "sign a mutual defence
  // pact with the Iron Vigil" was priced as an ordinary influence check
  // (measured live at DC 17, against a power at -45 disposition) and a good
  // roll bound them to it. The op has left `ModelOpSchema` and the reducer
  // rejects it from a `model` source; this is the half that tells the player
  // where to go instead, so the boundary reads as a door rather than a wall.
  const negotiation = priced.appraisal.negotiation;
  if (negotiation) {
    const names = negotiation.withFactionIds
      .map((id) => getFaction(state, id)?.name ?? id)
      .join(', ');
    const channels = negotiation.withFactionIds.map((id) => `/talk ${id}`).join(' · ');
    return {
      output: {
        narrative: priced.appraisal.reason || `That needs ${names} to agree to it.`,
        ops: [],
        negotiation: {
          withFactionIds: [...negotiation.withFactionIds],
          what: negotiation.what,
          supported: negotiation.supported,
          // Written here rather than by the model so the instruction is always
          // the real command, spelled the way the client accepts it.
          channels,
        },
      },
      check: null,
      roll: 0,
      attempts: priced.attempts,
      costUsd: priced.costUsd + relevanceCost,
      ruling,
      notes,
    };
  }

  /* --- 1c. The price, if the ruling carried none ---------------------- */
  // An inadmissible ruling carries no price, and must not be made to invent
  // one — but `smuggled` above can rewrite it into the compulsion breach it
  // quoted, and a compulsion is priced and rolled. Only on that path, ask the
  // arbiter for the one thing it was right not to give: one small call, on a
  // path that is rare by construction.
  // Covert work is SENT, not rolled. The operative's own chance — guile against
  // the host's resolve, their class, the method and any groundwork — is rolled
  // on the tick, so a declaration roll in front of it was a second gate the
  // method could not touch: a playtest burned an operative on a natural 1 here
  // while the engine gave it 95%. So a covert declaration is priced at nothing
  // and rolled not at all, and what it may carry is cut to the sending.
  // An act may be open work and covert work at once: its overt part is rolled,
  // its covert parts are sent. A ruling in the old flat shape has no `overt`
  // flag, and was rolled exactly when it sent nobody.
  const sends = covert.length > 0 || groundwork.length > 0;
  const rolled = priced.appraisal.overt ?? !sends;
  let stat = priced.appraisal.stat;
  let difficulty = priced.appraisal.difficulty;
  if (rolled && (stat === undefined || difficulty === undefined)) {
    const again = await appraiseAction(state, action, undefined, {
      note: [
        '## This action is admissible',
        '',
        'It breaks one of your own compulsions, and a compulsion is a price your',
        'institutions charge, not a wall: the attempt goes ahead. Rule it',
        'admissible and give the stat it tests and its difficulty.',
      ].join('\n'),
    });
    priced.costUsd += again.costUsd;
    stat = again.appraisal.stat;
    difficulty = again.appraisal.difficulty;
    if (stat === undefined || difficulty === undefined) {
      throw new Error('The arbiter would not price an action that has to be rolled.');
    }
  }

  /* --- 2. Roll, and resolve in code ----------------------------------- */
  const roll = rolled ? rollD20(state.turn, `${salt}:${action}`) : 0;
  // EFFECTIVE stats, not base: dissent and hostile stat_debuffs both reduce
  // what a faction can actually do, and resolving against the undegraded
  // number meant neither ever reached the dice — a faction at 100 dissent
  // rolled exactly as well as one whose institutions were behind it.
  const stats = effectiveStats(state, state.playerFactionId);
  const check: CheckResult | null =
    !rolled || stat === undefined || difficulty === undefined
      ? null
      : resolveCheck(stat, stats[stat], roll, difficulty);

  // Every check is written to the log, so a campaign's luck is auditable.
  //
  // That sentence was in CLAUDE.md and nowhere in the code: `EventKindSchema`
  // has no `check` kind and nothing wrote one. The only reason any rolls were
  // visible in a real campaign is that the resolution model *voluntarily*
  // emitted `log_narrative` lines for them — model discretion, not a
  // mechanism, and turns 0-5 of that campaign had none at all.
  //
  // Staged as an op rather than mutated in, so it lands with the batch and
  // replays exactly like every other entry. This is the ONE place a roll is
  // written: `submitAction` used to stage a second copy, and every check reached
  // the log twice (item 120).
  const checkOp = check
    ? { op: 'log_narrative' as const, text: `[check] ${describeCheck(check)}` }
    : null;

  /* --- 3. Narrate and enact the outcome code produced ------------------ */
  const res = await callStructured({
    kind: 'resolution',
    label: 'resolution',
    system: withArchetypes(withRubric(loadPrompt('resolution'))),
    user: [
      serializeState(state, state.playerFactionId),
      '',
      '---',
      '',
      ...(check
        ? [
            '## How this action resolved',
            '',
            `The attempt was priced as a **${stat}** check at DC ${difficulty}`,
            priced.appraisal.rationale ? `(${priced.appraisal.rationale})` : '',
            `and rolled **d20 ${roll} ${formatModifier(check.modifier)} = ${check.total}**.`,
            '',
            `### Outcome: ${check.outcome.replace('_', ' ').toUpperCase()}`,
            '',
            OUTCOME_GUIDANCE[check.outcome],
            '',
            'This outcome is settled. Narrate it and emit the ops that make it real.',
            'Do not narrate a different result, and do not re-price the action.',
            ...(sends
              ? [
                  '',
                  'The covert half of this act is not part of that roll: its operatives are',
                  'sent, and their own chance is rolled on the tick. Narrate them setting out,',
                  'not what comes of it.',
                ]
              : []),
            '',
          ]
        : [
            '## This is covert work, and it is sent, not rolled',
            '',
            'Nothing has been rolled. The operative sets out now; the engine rolls',
            'their own chance on the tick and decides what comes of it. Narrate the',
            'operative going to work, in a sentence or two, and not the result.',
            'Emit only `deploy_agent`, `lay_groundwork`, `recall_agent` and',
            '`log_narrative`. Charge nothing: the engine prices the mission and the',
            'method itself, and groundwork costs the action alone.',
            '',
          ]),
      ...(breach?.kind === 'compulsion'
        ? [
            '### Your institutions object, and the order stands',
            '',
            `The arbiter ruled that this breaches a compulsion on your own sheet: **${breach.principle}**`,
            `${breach.by} have said so, in these terms: ${breach.reason}`,
            '',
            'A compulsion is a demand, not a prohibition, so the order is carried',
            'out anyway and the price is charged in dissent by the engine. Emit the',
            'ops for the outcome above exactly as you otherwise would, and let the',
            'narrative carry the objection. Do NOT refuse, and do not soften the',
            'ops to make the objection unnecessary.',
            '',
          ]
        : []),
      ...(priced.appraisal.covert
        ? [
            '### This is covert work, and covert work is run by operatives',
            '',
            `The arbiter ruled this ${priced.appraisal.covert.length === 1 ? 'a' : `${priced.appraisal.covert.length}`} covert operation${priced.appraisal.covert.length === 1 ? '' : 's'}: ${priced.appraisal.covert
              .map((c) => `**${c.mission}** at \`${c.systemId}\``)
              .join(', ')}.`,
            'You may emit one `deploy_agent` for EACH of them, at that system with that',
            'mission, to give it a cover and an effect that fits — and no send the',
            'arbiter did not rule. Do NOT invent its consequences: no hull losses, no',
            'stolen credits, no collapse in relations. The operative is charged for,',
            'capped, and resolved on the tick like every other one. Anything you leave',
            'out, the engine sends itself, rider and all.',
            '',
          ]
        : []),
      ...(priced.appraisal.yields && priced.appraisal.yields.length > 0 && check && check.outcome !== 'failure' && check.outcome !== 'critical_failure'
        ? [
            '### What it may come away with',
            '',
            `The arbiter ruled this attempt could yield: ${priced.appraisal.yields.map((y) => `\`${y}\``).join(', ')}. A \`create_asset\` of one of those kinds is yours to write if the narrative brings it back; any other kind is dropped.`,
            '',
          ]
        : []),
      ...(priced.appraisal.reaches && priced.appraisal.reaches.length > 0
        ? [
            '### How it may reach another power',
            '',
            `The arbiter ruled this act reaches into another power's business by: ${priced.appraisal.reaches.map((r) => `\`${r}\``).join(', ')}. An op of another reach — standing down a rival's orders, turning crews, breaking paper, coercion — is dropped.`,
            '',
          ]
        : [
            '### It reaches no other power',
            '',
            "The arbiter named no way this act reaches into another power's business, so do not write one: no `interrupt_order`, `extend_order` or `accelerate_order` on a rival's order, no `suborn_crews`, `break_treaty`, ultimatum, bounty, blackmail or published dossier. They are dropped.",
            '',
          ]),
      ...(priced.appraisal.establishes && check && check.outcome !== 'failure' && check.outcome !== 'critical_failure'
        ? [
            '### This action establishes something lasting',
            '',
            `The arbiter ruled that success here creates: **${priced.appraisal.establishes.text}**`,
            `Emit \`establish_commitment\` with kind \`${priced.appraisal.establishes.kind}\`, parties ${priced.appraisal.establishes.factionIds.join(', ')}, exclusive ${priced.appraisal.establishes.exclusive}.`,
            MECHANISM_GUIDANCE[priced.appraisal.establishes.mechanism ?? 'record'],
            'On a PARTIAL, record it only if the reduced result still amounts to the arrangement being made.',
            '',
          ]
        : []),
      '---',
      '',
      '## Declared action',
      '',
      action,
    ]
      .filter((line) => line !== '')
      .join('\n'),
    schema: ResolutionOutputSchema,
  });

  // The arbiter's ruling is the one that counts. If it found a compulsion
  // breach, the defiance stands whatever the resolution call chose to report —
  // that call declining to notice is precisely the failure this pass exists to
  // close. The model's own wording is kept when it offered some, since it is
  // written against the narrative it just produced.
  const withCovert = (o: ResolutionOutput): ResolutionOutput => ({
    ...o,
    ...(priced.appraisal.covert && priced.appraisal.covert.length > 0 ? { covert: priced.appraisal.covert } : {}),
    ...(priced.appraisal.groundwork && priced.appraisal.groundwork.length > 0 ? { groundwork: priced.appraisal.groundwork } : {}),
  });

  // What the ruling lets a batch carry — this one, and any correction of it.
  const bounds: RulingBounds = {
    covert,
    groundwork,
    stat: check?.stat,
    outcome: check?.outcome,
    establishes: priced.appraisal.establishes,
    yields: priced.appraisal.yields ?? [],
    sentOnly: !checkOp,
    reaches: priced.appraisal.reaches ?? [],
    foreignOrders: state.pendingOrders.filter((o) => o.factionId !== state.playerFactionId).map((o) => o.id),
  };
  const withCheck = (o: ResolutionOutput): ResolutionOutput => {
    // Sends, sways, commitments and prizes are the ruling's (intent-ops §3–5),
    // and covert work carries only its sending. See `holdToRuling`.
    const held = holdToRuling(o.ops, bounds);
    notes.push(...held.notes);
    let ops = held.ops as ResolutionOutput['ops'];
    // A windfall is one more of a prize the ruling named, and only on a
    // critical (§4). The other bonuses are applied by the engine once staged.
    if (check?.outcome === 'critical_success' && o.bonus === 'windfall') {
      const at = ops.findIndex((x) => x.op === 'create_asset' && (bounds.yields as readonly string[]).includes(x.kind));
      if (at >= 0) {
        const prize = ops[at] as Extract<ResolutionOutput['ops'][number], { op: 'create_asset' }>;
        ops = ops.map((x, i) => (i === at ? { ...prize, quantity: (prize.quantity ?? 1) + 1 } : x));
        notes.push('A windfall: one more than the attempt was after.');
      }
    }
    // The check line rides at the FRONT of the batch, so the log reads
    // roll-then-consequence rather than the other way round.
    return { ...o, ops: checkOp ? [checkOp, ...ops] : ops };
  };

  const output: ResolutionOutput = withCheck(withCovert(
    breach?.kind === 'compulsion'
      ? {
          ...res.value,
          // A red line is the arbiter's call now; resolution volunteering a
          // refusal on top of a compulsion ruling would turn a price into a
          // block, which is the distinction the whole mechanism rests on.
          refusal: undefined,
          defiance: {
            // `by` is meant to name the institution that objected — "the
            // officer corps", "the Trade Council" — and resolution sometimes
            // fills it with the faction id instead, which the UI then renders
            // as "vigil object, and the order goes out anyway". Seen live.
            by: namesAnInstitution(res.value.defiance?.by, state)
              ? (res.value.defiance?.by as string)
              : breach.by,
            reason: res.value.defiance?.reason ?? breach.reason,
            // Always the arbiter's, so the line the player is charged for is
            // the line that was actually ruled on.
            violated: breach.principle,
          },
        }
      : res.value,
  ));

  return {
    output,
    check,
    roll,
    ruling,
    notes,
    bounds,
    attempts: priced.attempts + res.attempts,
    costUsd: priced.costUsd + relevanceCost + res.costUsd,
  };
}

/**
 * What each band obliges the narrative and the ops to do.
 *
 * Stated here rather than in the prompt file because it is the contract
 * between the arithmetic and the story: a "failure" that still quietly emits
 * the ops the player wanted is not a failure.
 */
const OUTCOME_GUIDANCE: Record<CheckResult['outcome'], string> = {
  critical_success:
    'It worked, and better than intended. Emit the ops for the full result, and name ONE bonus in `bonus` — `cost_avoided` (a quarter of what it spent comes back), `tempo` (one of its new orders finishes a bucket sooner), `goodwill` (the power most involved warms to you) or `windfall` (one more of a prize the ruling named). The engine applies it: write no ops for the bonus, and narrate it however you like.',
  success:
    'It worked as intended. Emit the ops for exactly what was attempted; no windfall, no complication.',
  partial:
    'It half-worked, and there is a bill. Write each piece of work, programme and prize at the size that was attempted — the engine halves them itself, so halving them here halves them twice — and emit ops for the cost: credits spent for less than was bought, a relationship soured, a fleet out of position. This is the most common interesting outcome; do not quietly round it up to success.',
  failure:
    'It did not work. Emit the ops for what the attempt COST — spent credits, wasted turns, a rival forewarned — and NOT the ops for the thing the player wanted. Nothing they were reaching for changes hands.',
  critical_failure:
    'It failed badly and made things worse. Emit ops for the cost and for a real consequence beyond it: an exposed agent, a broken relationship, a loss that was not on the table when the order was given.',
};

/* ------------------------------------------------------------------ */
/* 2. NPC reaction                                                      */
/* ------------------------------------------------------------------ */

export async function gatherReactions(
  state: WorldState,
  factionIds: string[],
  whatHappened: string,
): Promise<{ output: ReactionSet; attempts: number; costUsd: number }> {
  if (factionIds.length === 0) {
    return { output: { reactions: [] }, attempts: 0, costUsd: 0 };
  }

  // ONE CALL PER FACTION, ISSUED AT ONCE — not one call listing them all, and
  // not one after another.
  //
  // The split is a correctness change that happens to be faster, and three of
  // its four arguments have nothing to do with speed:
  //
  // - **No power reads another's observation block.** Every faction's scoped
  //   view used to sit in one context, so the model writing the Vigil's
  //   reaction could read what the Combine can see. The prompt asked for
  //   separation; nothing enforced it. Same lesson `worldAsSeenBy` records — a
  //   leak is a property of the whole payload. Running them concurrently is the
  //   strongest form of it: no power can be influenced by what another was just
  //   made to say, because nothing has been said yet.
  // - **A misattributed reaction becomes detectable.** The merged call
  //   legitimately expected every id in the batch, so nothing could tell a
  //   reaction written under the wrong flag from a correct one — and a reaction
  //   commits with its own faction as `actor`, so that acts with another
  //   power's hand.
  // - **One bad response costs one voice**, not the turn's reactions entire.
  // - And the fourth: end-of-turn was the largest single wait in the game at a
  //   66.7s median. Three calls averaging ~22s sum to 67s in sequence and land
  //   together in ~40s at once.
  //
  // **Cost is the same either way**, which is what settles it: N calls each
  // re-send `serializeState` and the whole reaction prompt, measured at 2.8x
  // the merged call — a property of there being N calls, not of running them
  // together. What concurrency does cost is contention, since each call spawns
  // its own copy of the Claude Code binary and three at once on a laptop is why
  // ~22s each becomes ~40s rather than ~22s. That is a property of the
  // transport rather than of this design, and it is one of the things a direct
  // HTTP client would remove.
  //
  // `Promise.all` preserves input order, and the caller commits in that order,
  // so the journal records the same batch sequence on every run — the ops are
  // deterministic even though the calls are not.
  const settled = await Promise.all(
    factionIds.map(async (id) => {
      try {
        return await reactAs(state, id, whatHappened);
      } catch {
        // A power that could not be reached simply does not speak this turn.
        // Losing every reaction because one failed is what the split ends.
        return null;
      }
    }),
  );
  const spoke = settled.filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    output: { reactions: spoke.flatMap((r) => r.output.reactions) },
    attempts: spoke.reduce((n, r) => Math.max(n, r.attempts), 0),
    costUsd: spoke.reduce((n, r) => n + r.costUsd, 0),
  };
}

/** One power's answer to the turn. See `gatherReactions` for why it is its own call. */
async function reactAs(
  state: WorldState,
  factionId: string,
  whatHappened: string,
): Promise<{ output: ReactionSet; attempts: number; costUsd: number }> {
  // The faction's own observation block. A faction must react only to projects
  // it can actually see, so the scoped view is built for it alone.
  const perFaction = [factionId]
    .map((id) => {
      const f = getFaction(state, id);
      if (!f) return '';
      return [
        `### ${f.name} (\`${id}\`)`,
        '',
        serializeCharacter(f),
        '',
        // Not fleet/credits/orders — the state block below now IS this
        // faction's own view (`serializeState(state, factionId)`), which
        // already carries its self bullet in `## Factions` (fleet, tons,
        // credits) and its own `## Orders in progress`. Restating them here,
        // keyed on the SAME id, was never a second opinion; it was the same
        // text twice under a different heading. What is NOT duplicated is
        // this faction's own disposition toward the player —
        // `serializeFactions` suppresses the "toward" column on a viewer's
        // self-row, so nowhere else says how THIS power feels about the one
        // it is reacting to.
        `Disposition toward the player (${state.playerFactionId}): ${dispositionBetween(
          state,
          id,
          state.playerFactionId,
        )}`,
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  // The state block is THIS FACTION'S board, not the player's.
  //
  // Every reaction call sent `serializeState(state, state.playerFactionId)` —
  // the player's fog, not the reacting faction's — so an NPC reasoned from
  // what MERIDIAN can see: it read the player's own observable orders, and it
  // read every other power's disposition toward the PLAYER rather than toward
  // itself. `serializeOrders(state, id)` two lines below was already scoped
  // correctly; the much larger block built from it was not. Same class of
  // defect `worldAsSeenBy` exists to name: fog is a property of the whole
  // payload, and half of it was leaking the player's view into five other
  // factions' heads.
  const user = [
    serializeState(state, factionId),
    '',
    '---',
    '',
    '## What just happened',
    '',
    whatHappened,
    '',
    '---',
    '',
    '## React as this faction',
    '',
    perFaction,
    '',
    `Return one reaction object for \`${factionId}\` — not an array.`,
  ].join('\n');

  const res = await callStructured({
    kind: 'reaction',
    label: `reaction (${factionId})`,
    system: withRubric(loadPrompt('reaction')),
    user,
    // ONE reaction, not the set. The call has been per-faction since the split
    // above, but its schema still asked for `{ reactions: [...] }` — and the
    // model, told to answer for one power, kept answering with one object.
    // Traced: 13 of 16 schema misses across 27 reactions were that envelope
    // (`/reactions: must be array`, or no `reactions` key at all), each costing
    // a round trip inside the SDK that re-read the whole context.
    schema: ReactionSchema,
  });
  // The call was asked for one faction, so a reaction written under any other
  // flag is discarded rather than trusted. A reaction commits with its own
  // faction as `actor`, so a misattributed one would act with another power's
  // hand — the merged call could not check this at all, because every id in
  // the batch was legitimately expected.
  return {
    output: { reactions: res.value.factionId === factionId ? [res.value] : [] },
    attempts: res.attempts,
    costUsd: res.costUsd,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Diplomacy chat — emits NO ops, by construction                    */
/* ------------------------------------------------------------------ */

/**
 * The longest a reply can be and still be suspected of being a stub.
 *
 * A real reply runs to paragraphs; a stub is one sentence pointing somewhere
 * else. Kept generous so the check never has to reason about long prose.
 */
export const STUB_REPLY_MAX_CHARS = 240;

/* ------------------------------------------------------------------ */
/* The advisor                                                          */
/* ------------------------------------------------------------------ */

/**
 * Whether counsel is laid out as a list: two or more lines opening with a
 * bullet, a number or a heading word. Counsel is spoken, so it is held to
 * prose — but a sequence said in a sentence is a direct answer to "how", and
 * from 2026-10-27 the counsellor is asked to give one. One marker is a stray
 * dash mid-sentence, not a list. Shape rather than meaning: asking a second
 * model whether the first was too prescriptive is the confirmation bias
 * `verifyBreachRelevance` exists to avoid, and counting markers is a lookup.
 */
export function looksLikeAList(counsel: string): boolean {
  return (
    counsel
      .trim()
      .split(/\n/)
      .filter((line) => /^\s*(?:[-*•]|\d+[.)]|(?:First|Second|Third|Then|Finally)\b[,:]?\s)/i.test(line)).length >= 2
  );
}

/**
 * Whether counsel has stepped outside the fiction into the game's own terms —
 * "that was turn five", an action point, a DC, the dice. The prompt forbids it
 * and a playtest (2026-10-16) caught "turn five" anyway. Shape, not meaning,
 * for the reason `looksLikeAList` gives.
 */
export function breaksTheFourthWall(counsel: string): boolean {
  return /\bturns?\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\baction points?\b|\bDC\s*\d|\bd20\b|\bdice\b|\bdie roll\b/i.test(
    counsel,
  );
}

/**
 * The power an act hands something to, when its words do: "cede Torrek
 * Anchorage to the Vigil", "sell the plate to the Combine". Read off the words,
 * as `looksLikeAList` is, and only consulted when the arbiter found nothing
 * the power could do alone.
 */
export function handedTo(state: WorldState, action: string): string | null {
  if (!/\b(?:cede|cedes|ceding|hand|hands|handing|give|gives|giving|sell|sells|selling|trade|trades|trading|yield|yields|surrender|transfer)\b/i.test(action)) return null;
  const after = /\bto\s+(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/.exec(action)?.[1];
  if (!after) return null;
  const words = after.toLowerCase().split(/\s+/);
  const hit = state.factions.find(
    (f) => f.id !== state.playerFactionId && (f.id === words[0] || words.some((w) => f.name.toLowerCase().split(/\s+/).includes(w) && !['the', 'of'].includes(w))),
  );
  return hit?.id ?? null;
}

/**
 * A refusal for not being somewhere, on an act whose whole point is to go
 * there. "Land troops at Var Hollow" was turned away as `not_present` ("no
 * troops embarked anywhere") while twelve of Meridian's lift stood at Torrek
 * Anchorage (loop 20). When the act's words send ships and the power has ships
 * to send, the ground is not so.
 */
/**
 * An order to go on as things are — "do not move against the Vigil this turn",
 * "hold Torrek", "wait" — is already so whatever record the arbiter cited for
 * it. It cited an invented one, the check sent it back, and the re-ruling
 * rolled the non-act and charged 40 credits for it (loop 21).
 */
export function standingOrder(action: string): boolean {
  return /^\s*(?:do not|don't|hold\b|wait\b|stand fast|stand pat|keep\b|stay\b|make no|take no|leave\b.*\bas (?:it|they) (?:is|are))/i.test(action);
}

export function sendingIsTheAct(state: WorldState, action: string, ground: { kind: string }): string | null {
  if (ground.kind !== 'not_present') return null;
  if (!/\b(?:land|lands|landing|sail|sails|send|sends|move|moves|attack|storm|invade|strike|garrison|station|take)\b/i.test(action)) return null;
  const me = state.playerFactionId;
  const ships = state.systems.filter((x) => hullsAt(x, me) > 0);
  if (ships.length === 0) return null;
  return `the act sends ships there, and ${getFaction(state, me)?.name ?? me} has ships at ${ships.map((x) => x.name).slice(0, 3).join(', ')} to send. Going there is the act; rule it as a move.`;
}

export const AdvisorReplySchema = z.object({
  /**
   * What the counsellor actually says, out loud, to their leader.
   *
   * One field, which is the design: the counsel itself says what to do and
   * how. A separate one-line recommendation sat under it for a while
   * (2026-10-19) and only repeated it, so it was dropped (2026-10-27).
   */
  counsel: cappedProse(900)
    .refine((c) => !looksLikeAList(c), {
      message:
        'This is laid out as a list. You are speaking: say it in prose, in your own voice — a sequence said in a sentence is fine.',
    })
    .refine((c) => !breaksTheFourthWall(c), {
      message:
        'This speaks of turns, action points, difficulty or dice. You are inside the fiction: say "last month", "soon", "it will not be easy" — never the game\'s own terms.',
    }),
});
export type AdvisorReply = z.infer<typeof AdvisorReplySchema>;

/**
 * Ask the power's own counsellor what it is worried about.
 *
 * Everything here already existed: `serializeState` is the board a reaction
 * call reads, `serializeCharacter` is the voice a persona speaks in, and
 * `serializePrinciples` is the sheet the arbiter rules against. The advisor is
 * those three pointed inward — the same power, talking to its own leader rather
 * than to a rival or a referee — which is why it is one function and not a
 * subsystem.
 *
 * It gets `serializeCharacter` in full, unlike the arbiter, which deliberately
 * does not: a bounded classification does not need thousands of tokens of
 * dialect notes and this does, because sounding like the Combine rather than
 * like a briefing document is most of what the call is for.
 */
export async function askAdvisor(
  state: WorldState,
  viewerId: string = state.playerFactionId,
  /**
   * What the leader asked, in their own words, or nothing for the standing
   * question. A question is answered within the same rule as everything else
   * the counsellor says: what bears on it, never the steps — "how do I take
   * Vantic" is answered with what holds Vantic, not with an order of march.
   */
  question?: string,
  /** What the counsellor said last time, so a change of course is said and explained. */
  last?: { turn: number; counsel: string; followed?: string | null } | null,
  /** The turn so far: the actions left after this counsel, and what was declared and came of it. */
  turnSoFar?: { actionsLeft: number; perTurn: number; declared: string[] },
): Promise<{ counsel: string; attempts: number; costUsd: number }> {
  const faction = getFaction(state, viewerId);
  if (!faction) throw new Error(`No faction ${viewerId}`);
  const asked = question?.trim();
  const pressures = pressuresOn(state, viewerId);

  const res = await callStructured({
    kind: 'advisor',
    label: 'your counsellor reads the board',
    system: loadPrompt('advisor'),
    user: [
      `You advise the ${faction.name}. Your leader is addressed as **${faction.title}**.`,
      '',
      '---',
      '',
      ...(last
        ? [
            `## What you told your leader ${last.turn === state.turn ? 'earlier this turn' : `on turn ${last.turn}`}`,
            '',
            `> ${last.counsel}`,
            ...(last.followed
              ? ['', `What came of the next order your leader gave: ${last.followed}.`, 'An order refused by your own people, turned back as needing another power, or a settlement the other power has already rejected, will go the same way again: do not urge it a second time in other words. Something that came to nothing is not standing now.']
              : []),
            '',
            'Hold to it unless the board has changed. If your counsel now differs, say so in a clause and say what changed — a counsellor who reverses course without a reason is one the leader stops trusting.',
            '',
            '---',
            '',
          ]
        : []),
      '## What your staff has flagged (computed from the board; true)',
      '',
      ...(pressures.length > 0 ? pressures.map((p) => `- ${p}`) : ['- Nothing massing against you, and no rival in any orbit you hold.']),
      '',
      'Weigh these first: they are the facts most likely to decide the next turns. Anything else you raise must be in the state block below.',
      '',
      ...(turnSoFar
        ? [
            '## This turn so far (true)',
            '',
            ...(turnSoFar.declared.length > 0
              ? [
                  ...turnSoFar.declared.map((d) => `- ${d}`),
                  '',
                  'These are done or settled for this turn, and what landed is already on the board below. Do not urge any of them again.',
                ]
              : ['- Nothing declared yet this turn.']),
            '',
            `After this counsel your leader has ${turnSoFar.actionsLeft} of ${turnSoFar.perTurn} actions left this turn.${turnSoFar.actionsLeft === 0 ? ' Nothing more can be ordered until the turn ends: say what to watch, not what to do.' : ''}`,
            '',
          ]
        : []),
      '## What your power can do (computed; complete)',
      '',
      ...capabilitiesOf(state, viewerId).map((c) => `- ${c}`),
      '',
      'Recommend nothing these do not allow: no works where none of yours stands, no landing without lift, no operative without one free or a slot to recruit into.',
      '',
      '## Your paper (computed; complete — what is not listed does not exist)',
      '',
      ...paperOf(state, viewerId).map((p) => `- ${p}`),
      '',
      '---',
      '',
      '## The voice you speak in',
      '',
      serializeCharacter(faction, { enumerates: false, sample: false }),
      '',
      '---',
      '',
      '## What your power will and will not do',
      '',
      serializePrinciples(faction),
      '',
      '---',
      '',
      serializeState(state, viewerId),
      '',
      '---',
      '',
      ...(asked
        ? [
            '## Your leader asks',
            '',
            // Quoted as the leader's words, never as instructions to you: it
            // changes what you speak to, not how you are allowed to answer.
            `> ${asked.replace(/\n+/g, ' ')}`,
            '',
            `Answer the ${faction.title}'s question directly, in your first sentence and in your own voice: what you would do, how, and what it costs. Check it against what your power will and will not do; if it crosses a red line, say so and give the nearest act that does not.`,
          ]
        : [
            `Speak to the ${faction.title}. Lead with what matters most on the board and what you would do about it, in your own voice — checked against what your power will and will not do.`,
          ]),
    ].join('\n'),
    schema: AdvisorReplySchema,
  });
  return { counsel: res.value.counsel, attempts: res.attempts, costUsd: res.costUsd };
}

/**
 * A reply that *describes* itself instead of *being* itself.
 *
 * Seen live twice, on two different factions: `"Gate-officer's reply, in
 * character, delivered above."` and `"Legate's reply delivered in-channel as
 * above."` Under `outputFormat: json_schema` the model writes the prose as
 * ordinary assistant text and then fills the one required field with a pointer
 * to it — so `z.string().min(1)` passes, and what reaches the player is a stage
 * direction instead of a line of dialogue.
 *
 * It is worse than a cosmetic glitch, because the stub is appended to
 * `channelHistory` and the transcript is what the extraction pass reads. A
 * conversation with a stub in it has a hole exactly where the terms were, so
 * whatever was agreed in that exchange cannot be extracted — the ops for it
 * simply never appear.
 *
 * Deliberately **narrow**: it fires only on a SHORT string that both names the
 * artefact and says where it supposedly is. A genuinely short reply — "No." —
 * is in character for at least two of the five powers and must survive. The
 * cost of a false positive is one retry, not a failed action.
 */
export function looksLikeStubReply(reply: string): boolean {
  const text = reply.trim();
  if (text.length > STUB_REPLY_MAX_CHARS) return false;
  const namesTheArtefact = /\b(reply|response|answer|message|dialogue|statement)\b/i.test(text);
  const pointsElsewhere =
    /\b(above|below|delivered|provided|omitted|as follows|in[-\s]?channel|in character|as stated)\b/i.test(
      text,
    );
  return namesTheArtefact && pointsElsewhere;
}

export const DiplomacyReplySchema = z.object({
  /**
   * What this power is putting on the table, recorded as it says it.
   *
   * Only what **this** power gives up, and only what it has actually decided
   * to give — not what it is being asked for, not what it is considering, and
   * not what the other side offered. An empty list is the normal case: most
   * messages in a negotiation concede nothing.
   */
  concessions: z.array(ConcessionSchema).max(6).default([]),
  /** Concessions being struck, with an in-character reason. */
  retractions: z.array(RetractionSchema).max(6).default([]),
  reply: cappedProse(900)
    // Layer 2, which is the only layer that can catch this: no JSON schema can
    // express "this string must be the speech rather than a note about it".
    .refine((r) => !looksLikeStubReply(r), {
      message:
        'This must be the words the faction actually speaks, in character — not a description of a reply delivered elsewhere. Put the dialogue itself in this field.',
    }),
});

export interface ChatMessage {
  speaker: 'player' | 'faction';
  text: string;
}

/**
 * A line in a STORED transcript, which is not quite a line of conversation.
 *
 * A live channel is two parties talking and can only ever hold those two. An
 * archived one can also hold a `record`: the engine's note on what became of
 * the conversation, written when an accord was refused so that replaying the
 * transcript into a persona does not present a dead deal as a live one.
 *
 * Deliberately a separate type rather than a wider `ChatMessage`. Widening it
 * would let a `record` line reach `diplomacyReply` and `extractAgreements`,
 * whose speaker checks are `player ? … : faction` — so it would render as the
 * faction's own words, which is the exact confusion the line exists to prevent.
 * The narrow type makes that unreachable instead of merely unlikely.
 */
export type TranscriptEntry = ChatMessage | { speaker: 'record'; text: string };

/**
 * A turn of conversation. The schema has no `ops` field at all — the boundary
 * that keeps chat from mutating state is structural, not a prompt instruction
 * the model could be talked out of.
 */
export async function diplomacyReply(
  state: WorldState,
  factionId: string,
  history: ChatMessage[],
  priorTranscripts: string[],
  /** What is already written down in this channel, which the budget counts. */
  onTable: readonly Concession[] = [],
): Promise<{
  reply: string;
  concessions: Concession[];
  retractions: Retraction[];
  costUsd: number;
}> {
  const faction = getFaction(state, factionId);
  const player = getFaction(state, state.playerFactionId);
  if (!faction) throw new Error(`No faction "${factionId}".`);

  const memory =
    priorTranscripts.length > 0
      ? ['## Your record of past dealings with this leader', '', ...priorTranscripts].join('\n')
      : '## Your record of past dealings with this leader\n\n_You have not spoken before._';

  const conversation = history
    .map((m) => `${m.speaker === 'player' ? player?.name ?? 'The other leader' : faction.name}: ${m.text}`)
    .join('\n\n');

  const user = [
    '# You are this power',
    '',
    serializeCharacter(faction),
    '',
    `Fleet ${fleetStrengthOf(state, faction.id)} hulls / ${fleetTonsOf(state, faction.id)} tons · treasury ${faction.credits} credits.`,
    `Your disposition toward ${player?.name ?? state.playerFactionId}: ${dispositionBetween(
      state,
      factionId,
      state.playerFactionId,
    )} (scale −100 to 100).`,
    // What to call them. `Faction.title` named every leader in the game and
    // then reached exactly one call — the advisor, which addresses the player's
    // own — so across a table the powers had no form of address for each other
    // and fell back on faction names, which is how nobody has ever spoken to a
    // head of state. The office is also a lever: using it, pointedly not using
    // it, and using the wrong one are three different moves.
    `They are addressed as the ${player?.title ?? 'Commander'}. You are the ${faction.title}.`,
    '',
    '---',
    '',
    serializeState(state, factionId),
    '',
    '---',
    '',
    memory,
    '',
    '---',
    '',
    `## What ${player?.name ?? state.playerFactionId} is holding that you want`,
    '',
    serializeTheirAssets(state, factionId, state.playerFactionId),
    '',
    '---',
    '',
    // Code owns how much ground; the persona owns the words. See
    // `concessionBudget` — a concession past it is struck when written down.
    '## What you can give up',
    '',
    (() => {
      const { budget, because } = concessionBudget(state, factionId, state.playerFactionId);
      const { given } = withinBudget(state, onTable, factionId, state.playerFactionId);
      return `About ${budget} credits' worth in this conversation; ${given} of it is already on the table, so ${Math.max(0, budget - given)} is left.${
        because.length > 0 ? ` Set by ${because.join(', ')}.` : ''
      }`;
    })(),
    '',
    '---',
    '',
    '## This conversation so far',
    '',
    conversation,
    '',
    `Reply as ${faction.name}.`,
  ].join('\n');

  const res = await callStructured({
    kind: 'diplomacy',
    label: 'diplomacy',
    system: loadPrompt('diplomacy-persona'),
    user,
    schema: DiplomacyReplySchema,
  });
  return {
    reply: res.value.reply,
    // BOTH sides of the table, and third parties dropped.
    //
    // This filtered to `c.by === factionId` — the NPC's own — which is right
    // about consent and was wrong about everything else: the player's
    // concessions were stripped before the session could see them, so the
    // per-message red-line appraisal had nothing to appraise and
    // `channelBlockers` was `[]` at every read, across four channels and three
    // deliberate self-announced crossings. The mechanism did not fail; it never
    // ran.
    //
    // The two halves are not the same kind of record and it matters which is
    // which. A power's own concession **binds it** — `groundInConcessions`
    // grounds an op against `c.by === otherId` and nothing else. Its record of
    // what the PLAYER offered is only its understanding, and it is useful
    // precisely because it can be wrong out loud: the player sees the
    // counterparty's reading of their own promise while there is still a
    // conversation in which to correct it.
    //
    // A concession naming a third party is still dropped. Nobody at this table
    // speaks for a power that is not in the room.
    concessions: atThisTable(res.value.concessions, factionId, state.playerFactionId),
    retractions: atThisTable(res.value.retractions, factionId, state.playerFactionId),
    costUsd: res.costUsd,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Extraction — the only pass in a conversation that mutates state   */
/* ------------------------------------------------------------------ */

export async function extractAgreements(
  state: WorldState,
  factionId: string,
  history: ChatMessage[],
  /**
   * What each power recorded conceding as it spoke. This pass is the one that
   * writes the ops, and it was never shown the record: the state block is the
   * player's view, which lists the player's own things and none of the other
   * power's, so a conceded crate of luxuries had no id to move and a bought set
   * of drawings was minted afresh as a dossier (playtest 2026-10-18, C7, C8).
   */
  conceded: readonly Concession[] = [],
): Promise<{ output: ExtractionOutput; attempts: number; costUsd: number }> {
  const faction = getFaction(state, factionId);
  const player = getFaction(state, state.playerFactionId);

  const transcript = history
    .map(
      (m) =>
        `${m.speaker === 'player' ? `${player?.name ?? 'Player'} (\`${state.playerFactionId}\`)` : `${faction?.name ?? factionId} (\`${factionId}\`)`}: ${m.text}`,
    )
    .join('\n\n');

  const user = [
    serializeState(state, state.playerFactionId),
    '',
    '---',
    '',
    `## Transcript — ${player?.name ?? state.playerFactionId} and ${faction?.name ?? factionId}`,
    '',
    transcript || '_The channel opened and closed without anything being said._',
    '',
    ...(conceded.length > 0 ? ['---', '', serializeConcessionRecord(state, conceded), ''] : []),
    '---',
    '',
    'Emit ops for what these two powers actually committed to. Nothing else.',
  ].join('\n');

  const res = await callStructured({
    kind: 'extraction',
    label: 'extraction',
    system: withArchetypes(loadPrompt('extraction')),
    user,
    // The extraction vocabulary, which is the ordinary one plus `form_treaty`.
    // This pass has read a transcript, so it is the only model-driven place in
    // the game where another power's consent actually exists.
    schema: ExtractionOutputSchema,
  });
  return { output: res.value, attempts: res.attempts, costUsd: res.costUsd };
}

/**
 * The concessions each side wrote down, as the extraction pass needs them: who
 * gave what, and the ids of the worlds, things and favours named. A thing named
 * here already exists, so moving it is `transfer_asset` of that id.
 */
export function serializeConcessionRecord(state: WorldState, conceded: readonly Concession[]): string {
  const lines = conceded.map((c) => {
    const who = getFaction(state, c.by)?.name ?? c.by;
    const parts: string[] = [];
    if (c.systems.length > 0) parts.push(`worlds ${c.systems.map((id) => `\`${id}\``).join(', ')}`);
    if (c.credits > 0) parts.push(`${c.credits} credits`);
    if (c.perTurn > 0) parts.push(`${c.perTurn} a turn`);
    if (c.hulls > 0) parts.push(`${c.hulls} hulls`);
    for (const id of c.assets) {
      const a = (state.assets ?? []).find((x) => x.id === id);
      parts.push(a ? `\`${id}\` (${a.quantity} ${a.unit} — ${a.text}, held by ${a.heldBy})` : `\`${id}\``);
    }
    for (const id of c.obligations) parts.push(`favour \`${id}\``);
    if (c.lifts.length > 0) parts.push(`stops tolling ${c.lifts.join(', ')}${c.liftTurns ? ` for ${c.liftTurns} turns` : ''}`);
    return `- \`${c.by}:${c.kind}\` — ${who}: ${c.text}${parts.length > 0 ? ` — ${parts.join('; ')}` : ''}`;
  });
  return [
    '## What each side recorded conceding',
    '',
    'Written down by each power as it spoke, and struck when it was withdrawn. List every term the two actually agreed in `accepted`, by the key at the start of its line. The engine builds the payments, things, favours, worlds and toll lifts from these lines; a thing named by id here already exists.',
    '',
    ...lines,
  ].join('\n');
}
