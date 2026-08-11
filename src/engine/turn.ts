import { describeCheck, type CheckResult } from '../domain/checks.js';
import { describeRejections, ModelTurnOutputSchema, type OpRejection } from '../domain/ops.js';
import type { TurnReport } from '../domain/reducer.js';
import { getFaction, REFUSAL_DISSENT } from '../domain/state.js';
import { extractAgreements, gatherReactions, resolveAction, type ChatMessage } from '../model/calls.js';
import { callStructured } from '../model/client.js';
import { loadPrompt } from '../model/prompts.js';
import { mostAffectedFactions, serializeState } from '../model/serialize.js';
import type { Campaign } from './campaign.js';

export interface ReactionView {
  factionId: string;
  factionName: string;
  color: number;
  narrative: string;
}

export interface ActionOutcome {
  narrative: string;
  /** Set when the player's own faction refused to carry the order out. */
  refusal?: { by: string; reason: string; violated: string } | null;
  /** Ops staged by this declaration; they land on `:endturn`. */
  staged: number;
  notes: string[];
  rejections: OpRejection[];
  costUsd: number;
  /** The ability check this action was resolved against, if it had one. */
  check?: CheckResult | null;
}

export interface TurnOutcome {
  /** How many declared actions landed. */
  applied: number;
  reactions: ReactionView[];
  notes: string[];
  rejections: OpRejection[];
  costUsd: number;
  /** Everything that moved this turn, so the UI can brief without being asked. */
  report: TurnReport;
}

/**
 * Which factions and systems an op list touches, used to pick who reacts so a
 * turn spent on internal administration does not summon the whole galaxy to
 * comment on it.
 */
function touchedBy(ops: unknown[]): { factions: string[]; systems: string[] } {
  const factions = new Set<string>();
  const systems = new Set<string>();
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const o = op as Record<string, unknown>;
    for (const key of ['factionId', 'towardFactionId', 'toFactionId']) {
      if (typeof o[key] === 'string') factions.add(o[key] as string);
    }
    for (const key of ['systemId', 'originId', 'targetId']) {
      if (typeof o[key] === 'string') systems.add(o[key] as string);
    }
  }
  return { factions: [...factions], systems: [...systems] };
}

function resolutionSystemPrompt(): string {
  return `${loadPrompt('resolution')}\n\n---\n\n${loadPrompt('duration-rubric')}`;
}

/**
 * Ask the model to repair ops the reducer refused.
 *
 * Rejections are never silently dropped: they are either corrected here or
 * surfaced to the player. Bounded at one attempt so a model that keeps emitting
 * the same bad op cannot spin the turn forever.
 */
async function reviseRejected(
  campaign: Campaign,
  rejections: OpRejection[],
  label: string,
  context: string,
): Promise<{ ops: unknown[]; costUsd: number } | null> {
  const user = [
    serializeState(campaign.state, campaign.state.playerFactionId),
    '',
    '---',
    '',
    '## Context',
    '',
    context,
    '',
    '## Ops that were rejected',
    '',
    'You emitted these ops and the reducer refused them. The valid ops from the',
    'same batch have already been accepted — do not repeat those.',
    '',
    describeRejections(rejections),
    '',
    'Re-emit ONLY corrected replacements for the rejected ops. If a rejected op',
    'cannot be expressed legally, drop it and say so in the narrative rather than',
    'working around the rules.',
  ].join('\n');

  try {
    const res = await callStructured({
      kind: 'resolution',
      label: `${label}:correction`,
      system: resolutionSystemPrompt(),
      user,
      schema: ModelTurnOutputSchema,
      maxRetries: 1,
    });
    return { ops: res.value.ops, costUsd: res.costUsd };
  } catch {
    // The correction call itself failed. The original rejections still stand
    // and are reported to the player rather than swallowed.
    return null;
  }
}

/** Stage ops, correcting once if the reducer refuses any. */
async function stageWithCorrection(
  campaign: Campaign,
  ops: unknown[],
  label: string,
  narrative: string,
  context: string,
): Promise<{ rejections: OpRejection[]; notes: string[]; costUsd: number }> {
  const first = campaign.stage(ops, label, narrative);
  if (first.rejections.length === 0) {
    return { rejections: [], notes: first.notes, costUsd: 0 };
  }

  const revised = await reviseRejected(campaign, first.rejections, label, context);
  if (!revised) return { rejections: first.rejections, notes: first.notes, costUsd: 0 };

  const second = campaign.stage(revised.ops, `${label}:correction`, '');
  return {
    rejections: second.rejections,
    notes: [...first.notes, ...second.notes],
    costUsd: revised.costUsd,
  };
}

/** Apply and journal ops immediately, correcting once. Used at end of turn. */
async function commitWithCorrection(
  campaign: Campaign,
  ops: unknown[],
  label: string,
  context: string,
  actor?: string,
): Promise<{ rejections: OpRejection[]; notes: string[]; costUsd: number }> {
  const first = campaign.commit(ops, 'model', label, actor);
  if (first.rejections.length === 0) {
    return { rejections: [], notes: first.notes, costUsd: 0 };
  }

  const revised = await reviseRejected(campaign, first.rejections, label, context);
  if (!revised) return { rejections: first.rejections, notes: first.notes, costUsd: 0 };

  const second = campaign.commit(revised.ops, 'model', `${label}:correction`, actor);
  return {
    rejections: second.rejections,
    notes: [...first.notes, ...second.notes],
    costUsd: revised.costUsd,
  };
}

/**
 * Declare a general action.
 *
 * The resolution call runs now, so the player gets narrative and a plausibility
 * check straight away and the reducer can reject a malformed op while there is
 * still something to do about it. The resulting ops are STAGED: they affect the
 * next timestamp, landing when `:endturn` commits the turn. NPCs do not respond
 * yet — they react once, at end of turn, to the whole settled world.
 */
export async function submitAction(campaign: Campaign, action: string): Promise<ActionOutcome> {
  const before = campaign.stagedCount;
  // The salt keeps two declarations in the same turn from sharing a roll,
  // while staying a pure function of state so replay is unaffected.
  const resolution = await resolveAction(campaign.state, action, String(before));

  // The player's own institutions may simply refuse. When they do, NOTHING is
  // staged: a faction is not a puppet, and an order the fleet will not carry
  // out is not a smaller version of that order, it is no order at all.
  // The arbiter ruled it could not be attempted. Nothing was rolled and
  // nothing is staged — distinct from a failed check (attempted, went badly)
  // and from a refusal (your own institutions would not carry it out).
  if (resolution.output.inadmissible) {
    return {
      narrative: resolution.output.narrative,
      refusal: null,
      staged: 0,
      notes: ['The arbiter ruled this cannot be attempted as things stand.'],
      rejections: [],
      costUsd: resolution.costUsd,
      check: null,
    };
  }

  if (resolution.output.refusal) {
    const refusal = resolution.output.refusal;
    const faction = getFaction(campaign.state, campaign.state.playerFactionId);
    const dissent = Math.min(100, (faction?.dissent ?? 0) + REFUSAL_DISSENT);
    campaign.stage(
      [
        {
          op: 'log_narrative',
          text: `[refused by ${refusal.by}] ${refusal.reason}`,
        },
        // This op is the whole mechanic. It used to be missing: the new total
        // was computed for the message and thrown away, so dissent never rose
        // from a refusal and the note telling the player it had was simply
        // false. Nothing degraded, ever.
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: REFUSAL_DISSENT,
          reason: refusal.violated || refusal.reason,
        },
      ],
      `refused: ${action.length > 40 ? `${action.slice(0, 39)}…` : action}`,
      resolution.output.narrative,
    );
    return {
      narrative: resolution.output.narrative,
      refusal,
      staged: campaign.stagedCount - before,
      notes: [
        `${refusal.by} refused the order.`,
        refusal.violated ? `Breached: ${refusal.violated}` : '',
        `Dissent ${dissent}/100 — every stat drops a point per 25.`,
      ].filter(Boolean),
      rejections: [],
      costUsd: resolution.costUsd,
      check: null,
    };
  }

  // The check is recorded so a campaign's luck is auditable after the fact, but
  // it rides along with the action's own ops rather than forming a batch of its
  // own — a separate batch would show up in the player's "declared this turn"
  // list as a meaningless "check record" entry and inflate the count.
  const ops = resolution.check
    ? [
        ...resolution.output.ops,
        { op: 'log_narrative', text: `[check] ${describeCheck(resolution.check)}` },
      ]
    : resolution.output.ops;

  const staged = await stageWithCorrection(
    campaign,
    ops,
    action.length > 48 ? `${action.slice(0, 47)}…` : action,
    resolution.output.narrative,
    `The player declared: ${action}\n\nYour narrative was: ${resolution.output.narrative}`,
  );

  return {
    narrative: resolution.output.narrative,
    staged: campaign.stagedCount - before,
    notes: staged.notes,
    rejections: staged.rejections,
    costUsd: resolution.costUsd + staged.costUsd,
    check: resolution.check,
    refusal: null,
  };
}

/**
 * Advance time. Everything declared this turn lands, the affected powers
 * respond to the settled world, and then every pending order ticks.
 */
export async function endTurn(campaign: Campaign): Promise<TurnOutcome> {
  const notes: string[] = [];
  const rejections: OpRejection[] = [];
  let costUsd = 0;

  // Capture what was declared before committing clears the staging area.
  const declared = campaign.stagedSummary();
  const stagedOps = campaign.stagedOps();

  const committed = campaign.commitTurn();
  notes.push(...committed.notes);

  // NPCs react once, to the world as it now stands.
  const reactionViews: ReactionView[] = [];
  if (committed.applied > 0) {
    const touched = touchedBy(stagedOps);
    const responders = mostAffectedFactions(
      campaign.state,
      touched.factions,
      touched.systems,
      campaign.state.playerFactionId,
      4,
    );

    if (responders.length > 0) {
      try {
        const reactions = await gatherReactions(
          campaign.state,
          responders,
          `${campaign.state.playerFactionId} acted this turn:\n\n${declared}`,
        );
        costUsd += reactions.costUsd;

        for (const reaction of reactions.output.reactions) {
          const faction = getFaction(campaign.state, reaction.factionId);
          if (!faction) continue;
          const applied = await commitWithCorrection(
            campaign,
            reaction.ops,
            `reaction:${reaction.factionId}`,
            `${faction.name} reacted: ${reaction.narrative}`,
            // The reacting faction is the actor, so an NPC is held to the same
            // presence and guile limits the player is when it suborns a crew.
            reaction.factionId,
          );
          costUsd += applied.costUsd;
          notes.push(...applied.notes);
          rejections.push(...applied.rejections);
          reactionViews.push({
            factionId: faction.id,
            factionName: faction.name,
            color: faction.displayColor,
            narrative: reaction.narrative,
          });
        }
      } catch (err) {
        notes.push(
          `NPC reaction call failed: ${err instanceof Error ? err.message : String(err)}. The turn stands; nobody responded.`,
        );
      }
    }
  }

  // Time passes last, so orders started this turn do not immediately progress.
  const ticked = campaign.tick();
  notes.push(...ticked.notes);

  return {
    applied: committed.applied,
    reactions: reactionViews,
    notes,
    rejections,
    costUsd,
    report: ticked.report,
  };
}

/**
 * Close a diplomatic channel.
 *
 * Nothing said in the channel touched the world. The transcript is recorded,
 * then a SEPARATE extraction pass decides what was actually agreed. Those ops
 * are staged like any other action, so a treaty lands on the same timestamp as
 * everything else declared this turn rather than jumping the queue.
 */
export async function closeChannel(
  campaign: Campaign,
  factionId: string,
  history: ChatMessage[],
): Promise<ActionOutcome> {
  campaign.recordTranscript(factionId, history);

  if (history.length === 0) {
    return {
      narrative: 'The channel closed without a word exchanged.',
      staged: 0,
      notes: [],
      rejections: [],
      costUsd: 0,
    };
  }

  const before = campaign.stagedCount;
  const faction = getFaction(campaign.state, factionId);
  const extraction = await extractAgreements(campaign.state, factionId, history);

  const staged = await stageWithCorrection(
    campaign,
    extraction.output.ops,
    `accord with ${faction?.name ?? factionId}`,
    extraction.output.narrative,
    `Extraction from a diplomatic channel with ${factionId}: ${extraction.output.narrative}`,
  );

  return {
    narrative: extraction.output.narrative,
    staged: campaign.stagedCount - before,
    notes: staged.notes,
    rejections: staged.rejections,
    costUsd: extraction.costUsd + staged.costUsd,
  };
}
