import { z } from 'zod';
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
  getFaction,
  type WorldState,
} from '../domain/state.js';
import { classifyPrinciple, classifyPrinciples } from '../domain/compulsions.js';
import { callStructured } from './client.js';
import { loadPrompt } from './prompts.js';
import {
  serializeCharacter,
  serializeOrders,
  serializePrinciples,
  serializeState,
} from './serialize.js';

/** Resolution and extraction share the duration rules, so both get the rubric. */
function withRubric(base: string): string {
  return `${base}\n\n---\n\n${loadPrompt('duration-rubric')}`;
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
): Promise<{ appraisal: Appraisal; attempts: number; costUsd: number }> {
  const stats = effectiveStats(state, state.playerFactionId);
  const bands = DIFFICULTY_BANDS.map((b) => `  DC ${b.dc} ${b.label} — ${b.example}`).join('\n');
  const statLines = STAT_NAMES.map(
    (s) => `  ${s} ${stats[s]} (${formatModifier(statModifier(stats[s]))}) — ${STAT_MEANINGS[s]}`,
  ).join('\n');
  const actor = getFaction(state, state.playerFactionId);

  const res = await callStructured({
    kind: 'appraisal',
    label: 'the arbiter considers it',
    system: loadPrompt('appraisal'),
    user: [
      serializeState(state, state.playerFactionId),
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
): Promise<{ appraisal: Appraisal; costUsd: number }> {
  const other = getFaction(state, withFactionId)?.name ?? withFactionId;
  const res = await appraiseAction(
    state,
    `Your envoys have concluded an agreement with ${other} and are about to put it into effect. ` +
      `What was agreed: ${agreed}`,
  );
  return { appraisal: res.appraisal, costUsd: res.costUsd };
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
}> {
  /* --- 1. Arbitrate: admissible at all, and priced blind to the roll --- */
  const priced = await appraiseAction(state, action);
  const actor = getFaction(state, state.playerFactionId);

  // What the arbiter NAMED, classified against the sheet rather than by its own
  // label — see `classifyPrinciple`. The model is good at spotting which line an
  // action touches and unreliable at saying which list that line is on, so the
  // judgement is taken and the lookup is not.
  const named = priced.appraisal.breach?.principles ?? [];
  const classified = actor && named.length > 0 ? classifyPrinciples(actor, named) : null;

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
      costUsd: priced.costUsd,
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
      costUsd: priced.costUsd,
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
      costUsd: priced.costUsd,
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

  /* --- 3. Narrate and enact the outcome code produced ------------------ */
  const res = await callStructured({
    kind: 'resolution',
    label: 'resolution',
    system: withRubric(loadPrompt('resolution')),
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
            `The arbiter ruled this a **${priced.appraisal.covert.mission}** operation at \`${priced.appraisal.covert.systemId}\`.`,
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
    priced.appraisal.covert ? { ...o, covert: priced.appraisal.covert } : o;

  const output: ResolutionOutput = withCovert(
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
  );

  return {
    output,
    check,
    roll,
    attempts: priced.attempts + res.attempts,
    costUsd: priced.costUsd + res.costUsd,
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
        `Fleet ${fleetStrengthOf(state, f.id)} · credits ${f.credits} · disposition toward the player (${state.playerFactionId}): ${dispositionBetween(
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

export const DiplomacyReplySchema = z.object({
  reply: z.string().min(1),
});

export interface ChatMessage {
  speaker: 'player' | 'faction';
  text: string;
}

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
): Promise<{ reply: string; costUsd: number }> {
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
    `Fleet strength ${fleetStrengthOf(state, faction.id)} · treasury ${faction.credits} credits.`,
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
  return { reply: res.value.reply, costUsd: res.costUsd };
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
    system: withRubric(loadPrompt('extraction')),
    user,
    // The extraction vocabulary, which is the ordinary one plus `form_treaty`.
    // This pass has read a transcript, so it is the only model-driven place in
    // the game where another power's consent actually exists.
    schema: ExtractionOutputSchema,
  });
  return { output: res.value, attempts: res.attempts, costUsd: res.costUsd };
}
