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
  ModelTurnOutputSchema,
  ReactionSetSchema,
  ResolutionOutputSchema,
  type ModelTurnOutput,
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
import { callStructured } from './client.js';
import { loadPrompt } from './prompts.js';
import { serializeCharacter, serializeOrders, serializeState } from './serialize.js';

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

  const res = await callStructured({
    kind: 'appraisal',
    label: 'the arbiter considers it',
    system: loadPrompt('appraisal'),
    user: [
      serializeState(state, state.playerFactionId),
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

  // A ruling of inadmissible ends it here. No roll, no ops, no cost beyond
  // the arbitration — the action was not attempted, so there is nothing to
  // resolve. Distinct from a FAILED check (attempted, went badly) and from a
  // REFUSAL (your own institutions would not carry it out).
  if (!priced.appraisal.admissible) {
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

  return {
    output: res.value,
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
): Promise<{ output: ModelTurnOutput; attempts: number; costUsd: number }> {
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
    schema: ModelTurnOutputSchema,
  });
  return { output: res.value, attempts: res.attempts, costUsd: res.costUsd };
}
