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
  type Appraisal,
  ExtractionOutputSchema,
  ModelTurnOutputSchema,
  ReactionSetSchema,
  ResolutionOutputSchema,
  type ExtractionOutput,
  type ReactionSet,
  type ResolutionOutput,
} from '../domain/ops.js';
import {
  effectiveStats,
  dispositionBetween,
  fleetStrengthOf,
  fleetTonsOf,
  getFaction,
  type WorldState,
} from '../domain/state.js';
import { classifyPrinciple, classifyPrinciples } from '../domain/compulsions.js';
import { callStructured } from './client.js';
import { serializeArchetypes } from '../domain/assets.js';
import { loadPrompt } from './prompts.js';
import {
  serializeCharacter,
  serializeOrders,
  serializePrinciples,
  serializeState,
  serializeTheirAssets,
} from './serialize.js';

/** Resolution and extraction share the duration rules, so both get the rubric. */
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
      serializeState(state, viewerId),
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
    ].join('\n'),
    schema: AppraisalSchema,
  });

  return { appraisal: res.value, attempts: res.attempts, costUsd: res.costUsd };
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
    ].join('\n'),
    viewerId,
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
): Promise<{ relevant: boolean; why: string; costUsd: number }> {
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
    'lane.',
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
    ].join('\n'),
    schema: BreachRelevanceSchema,
  });
  return { relevant: res.value.relevant, why: res.value.why, costUsd: res.costUsd };
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
}> {
  /* --- 1. Arbitrate: admissible at all, and priced blind to the roll --- */
  const priced = await appraiseAction(state, action);
  const actor = getFaction(state, state.playerFactionId);

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
    const check = await verifyBreachRelevance(action, firstPass.principle, firstPass.kind);
    relevanceCost = check.costUsd;
    relevant = check.relevant;
    if (!check.relevant) classified = null;
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
    };
  }

  /* --- 2. Roll, and resolve in code ----------------------------------- */
  const roll = rollD20(state.turn, `${salt}:${action}`);
  // EFFECTIVE stats, not base: dissent and hostile stat_debuffs both reduce
  // what a faction can actually do, and resolving against the undegraded
  // number meant neither ever reached the dice — a faction at 100 dissent
  // rolled exactly as well as one whose institutions were behind it.
  const stats = effectiveStats(state, state.playerFactionId);
  const check = resolveCheck(
    priced.appraisal.stat,
    stats[priced.appraisal.stat],
    roll,
    priced.appraisal.difficulty,
  );

  // Every check is written to the log, so a campaign's luck is auditable.
  //
  // That sentence was in CLAUDE.md and nowhere in the code: `EventKindSchema`
  // has no `check` kind and nothing wrote one. The only reason any rolls were
  // visible in a real campaign is that the resolution model *voluntarily*
  // emitted `log_narrative` lines for them — model discretion, not a
  // mechanism, and turns 0-5 of that campaign had none at all.
  //
  // Staged as an op rather than mutated in, so it lands with the batch and
  // replays exactly like every other entry.
  const checkOp = {
    op: 'log_narrative' as const,
    text: `[check] ${priced.appraisal.stat} check: d20 ${roll} ${check.modifier >= 0 ? '+' : ''}${check.modifier} = ${check.total} vs DC ${priced.appraisal.difficulty} -> ${check.outcome}`,
  };

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
      '## How this action resolved',
      '',
      `The attempt was priced as a **${priced.appraisal.stat}** check at DC ${priced.appraisal.difficulty}`,
      priced.appraisal.rationale ? `(${priced.appraisal.rationale})` : '',
      `and rolled **d20 ${roll} ${formatModifier(check.modifier)} = ${check.total}**.`,
      '',
      `### Outcome: ${check.outcome.replace('_', ' ').toUpperCase()}`,
      '',
      OUTCOME_GUIDANCE[check.outcome],
      '',
      'This outcome is settled. Narrate it and emit the ops that make it real.',
      'Do not narrate a different result, and do not re-price the action.',
      '',
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
            'Emit one `deploy_agent` for EACH of them.',
            'Emit `deploy_agent` for it, owned by the acting faction, at that system,',
            'with that mission and an effect that fits. Do NOT invent its consequences —',
            'no hull losses, no stolen credits, no collapse in relations. The operative',
            'is charged for, capped, and resolved on the tick like every other one.',
            'If you do not emit it, the engine will, so that the act is priced once.',
            '',
          ]
        : []),
      ...(priced.appraisal.establishes && check.outcome !== 'failure' && check.outcome !== 'critical_failure'
        ? [
            '### This action establishes something lasting',
            '',
            `The arbiter ruled that success here creates: **${priced.appraisal.establishes.text}**`,
            `Emit \`establish_commitment\` with kind \`${priced.appraisal.establishes.kind}\`, parties ${priced.appraisal.establishes.factionIds.join(', ')}, exclusive ${priced.appraisal.establishes.exclusive}.`,
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
  const withCovert = (o: ResolutionOutput): ResolutionOutput =>
    priced.appraisal.covert && priced.appraisal.covert.length > 0
      ? { ...o, covert: priced.appraisal.covert }
      : o;

  // The check line rides at the FRONT of the batch, so the log reads
  // roll-then-consequence rather than the other way round.
  const withCheck = (o: ResolutionOutput): ResolutionOutput => ({
    ...o,
    ops: [checkOp, ...o.ops],
  });

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
    'It worked, and better than intended. Emit the ops for the full result plus one concrete bonus that follows from it — an unexpected defection, a rival caught off balance, a cost avoided.',
  success:
    'It worked as intended. Emit the ops for exactly what was attempted; no windfall, no complication.',
  partial:
    'It half-worked, and there is a bill. Emit ops for the reduced result AND for the cost — credits spent for less than was bought, a relationship soured, a fleet out of position. This is the most common interesting outcome; do not quietly round it up to success.',
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

  // Each faction gets its own observation block. A faction must react only to
  // projects it can actually see, so the scoped views are kept separate and
  // explicitly labelled rather than merged into one omniscient list.
  const perFaction = factionIds
    .map((id) => {
      const f = getFaction(state, id);
      if (!f) return '';
      return [
        `### ${f.name} (\`${id}\`)`,
        '',
        serializeCharacter(f),
        '',
        // Hulls AND tons. A bare hull count was the whole fleet a model saw,
        // and it means different things by class: thirty escorts and thirty
        // battleships are the same number and a third of the fighting weight
        // apart. `serializeState` has reported both since classes shipped;
        // these two call sites were left behind.
        `Fleet ${fleetStrengthOf(state, f.id)} hulls / ${fleetTonsOf(state, f.id)} tons · credits ${f.credits} · disposition toward the player (${state.playerFactionId}): ${dispositionBetween(
          state,
          id,
          state.playerFactionId,
        )}`,
        '',
        'What this faction can observe of orders in progress:',
        serializeOrders(state, id),
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  const user = [
    serializeState(state, state.playerFactionId),
    '',
    '---',
    '',
    '## What just happened',
    '',
    whatHappened,
    '',
    '---',
    '',
    '## React as each of these factions',
    '',
    perFaction,
    '',
    `Return exactly ${factionIds.length} reaction(s), one per faction id listed above: ${factionIds
      .map((i) => `\`${i}\``)
      .join(', ')}.`,
  ].join('\n');

  const res = await callStructured({
    kind: 'reaction',
    label: 'reaction',
    system: withRubric(loadPrompt('reaction')),
    user,
    schema: ReactionSetSchema,
  });
  return { output: res.value, attempts: res.attempts, costUsd: res.costUsd };
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
 * Whether a counsel has turned into a queue of instructions.
 *
 * The one rule this call has that a prompt cannot be trusted with. *"It must
 * not become a solver"* is the design note item 80 leads with, and a solver
 * announces itself structurally: it enumerates. A numbered list, a bulleted
 * list, or a sequence of `First … Second … Third` is a plan, and a plan is the
 * thing a leader is supposed to be making.
 *
 * Deliberately shape-based rather than semantic. Asking a second model whether
 * the first was too prescriptive is the confirmation bias `verifyBreachRelevance`
 * exists to avoid; counting list markers is a lookup, and code does lookups.
 */
export function looksLikeAPlan(counsel: string): boolean {
  const text = counsel.trim();
  // Two or more lines opening with a marker. One is a stray dash mid-sentence.
  const markers = text
    .split(/\n/)
    .filter((line) => /^\s*(?:[-*•]|\d+[.)]|(?:First|Second|Third|Then|Finally)\b[,:]?\s)/i.test(line));
  if (markers.length >= 2) return true;
  // Or the same enumeration run together in prose.
  //
  // Counted as ordinals-followed-by-punctuation rather than as one regex over
  // the whole run, because the first version required the markers to sit within
  // one sentence of each other (`\bfirst\b[^.]*\.[^.]*\bsecond\b`) and real
  // enumerated counsel puts several sentences under each heading. Measured live:
  // "Three things, Chief Executive... First — Shalka. <four sentences> Second,
  // the Combine ledger... <three sentences> Third — the Drajk." — three headings
  // in one unbroken paragraph, which passed both branches. The line branch saw
  // no line starting with a marker because there are no line breaks, and the
  // prose branch allowed exactly one full stop between markers.
  //
  // The punctuation is what separates an enumeration from ordinary speech: a
  // heading is written "First —" or "Second,", while a sentence says "the first
  // time" or "First Elder" with a word next. Two are required for the same
  // reason two line markers are — one is a turn of phrase.
  const ordinals =
    text.match(/\b(?:first|second|third|fourth|fifth|finally|lastly)\b\s*[—–\-:,;]/gi) ?? [];
  return ordinals.length >= 2;
}

export const AdvisorReplySchema = z.object({
  /**
   * What the counsellor actually says, out loud, to their leader.
   *
   * One field and no second one, which is the design. A `pressures: []` beside
   * it would render as a checklist however it was worded, and a checklist is a
   * queue of instructions wearing a different label — the exact failure item 80
   * names. The prose has to carry it, and the refine below is what stops the
   * prose becoming the list anyway.
   */
  counsel: z
    .string()
    .min(1)
    .max(1600)
    .refine((c) => !looksLikeAPlan(c), {
      message:
        'This is a plan, not counsel. Do not enumerate steps or list actions — name what is pressing on your leader, in your own voice, and let them decide what to do about it.',
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
): Promise<{ counsel: string; attempts: number; costUsd: number }> {
  const faction = getFaction(state, viewerId);
  if (!faction) throw new Error(`No faction ${viewerId}`);

  const res = await callStructured({
    kind: 'advisor',
    label: 'your counsellor reads the board',
    system: loadPrompt('advisor'),
    user: [
      `You advise the ${faction.name}. Your leader is addressed as **${faction.title}**.`,
      '',
      '---',
      '',
      '## The voice you speak in',
      '',
      serializeCharacter(faction),
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
      `Speak to the ${faction.title}. Name what is pressing, in your own voice. Do not tell them what to do.`,
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
  reply: z
    .string()
    .min(1)
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
    '---',
    '',
    'Emit ops for what these two powers actually committed to. Nothing else.',
  ].join('\n');

  const res = await callStructured({
    kind: 'extraction',
    label: 'extraction',
    system: withArchetypes(withRubric(loadPrompt('extraction'))),
    user,
    // The extraction vocabulary, which is the ordinary one plus `form_treaty`.
    // This pass has read a transcript, so it is the only model-driven place in
    // the game where another power's consent actually exists.
    schema: ExtractionOutputSchema,
  });
  return { output: res.value, attempts: res.attempts, costUsd: res.costUsd };
}
