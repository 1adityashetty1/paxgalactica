import { describeCheck, type CheckResult } from '../domain/checks.js';
import { boundPayloadsToOutcome } from '../domain/development.js';
import {
  describeRejections,
  ExtractionOutputSchema,
  ModelTurnOutputSchema,
  type OpRejection,
} from '../domain/ops.js';
import type { TurnReport } from '../domain/reducer.js';
import {
  COMPULSION_BREACH_DISSENT,
  dissentPenalty,
  getFaction,
  MAX_DISSENT_PENALTY,
  REFUSAL_DISSENT,
} from '../domain/state.js';
import {
  appraiseAgreement,
  extractAgreements,
  gatherReactions,
  resolveAction,
  type ChatMessage,
} from '../model/calls.js';
import { classifyPrinciples } from '../domain/compulsions.js';
import { callStructured } from '../model/client.js';
import { loadPrompt } from '../model/prompts.js';
import { mostAffectedFactions, serializeState } from '../model/serialize.js';
import { ACTION_POINTS_PER_TURN, type Campaign } from './campaign.js';

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
  /**
   * Set when the institutions objected and carried the order out anyway — a
   * compulsion defied rather than a red line crossed. The ops landed; the
   * faction paid `COMPULSION_BREACH_DISSENT` for it, and may pay again.
   */
  defiance?: { by: string; reason: string; violated: string } | null;
  /**
   * Set when the action needs another power's agreement: it was not rolled for
   * and nothing was staged, because a treaty is not something you can declare
   * into existence. Carries the channel to open instead.
   */
  negotiation?: {
    withFactionIds: string[];
    what: string;
    supported: boolean;
    channels: string;
  } | null;
  /** Ops staged by this declaration; they land on `:endturn`. */
  staged: number;
  notes: string[];
  rejections: OpRejection[];
  costUsd: number;
  /** The ability check this action was resolved against, if it had one. */
  check?: CheckResult | null;
  /**
   * Exactly what this declaration staged, as applied. Returned so a narrative
   * can be checked against what it did without opening the save file.
   */
  ops: unknown[];
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
  /**
   * Extraction corrections must be able to re-emit a treaty: the deal was
   * struck, and handing back a vocabulary that cannot express it would turn a
   * fixable rejection into a lost agreement.
   */
  source: 'model' | 'extraction' = 'model',
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
    'You emitted these ops and the reducer refused them. Every OTHER op from',
    'that batch was accepted and is already applied — re-emitting any of them',
    'would apply it twice.',
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
      // A dedicated, minimal prompt rather than the full resolution one. The
      // resolution prompt's whole job is "narrate this action and emit its
      // ops", which directly contradicts "only fix these three rejects" — and
      // in practice the system prompt won: a correction pass re-derived the
      // entire batch and double-applied everything that had already succeeded.
      system: loadPrompt('correction'),
      user,
      schema: source === 'extraction' ? ExtractionOutputSchema : ModelTurnOutputSchema,
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
  /**
   * The band this action resolved in, so an `onComplete` payload cannot deliver
   * more than the roll earned. Applied to the correction batch as well as the
   * first: a retry that re-emitted the payload would otherwise be the hole.
   */
  outcome?: CheckResult['outcome'],
  source: 'model' | 'extraction' = 'model',
): Promise<{ rejections: OpRejection[]; notes: string[]; costUsd: number }> {
  const bind = (batch: unknown[]) =>
    outcome ? boundPayloadsToOutcome(batch, outcome) : { ops: batch, notes: [] };

  const bound = bind(ops);
  const first = campaign.stage(bound.ops, label, narrative, source);
  if (first.rejections.length === 0) {
    return { rejections: [], notes: [...bound.notes, ...first.notes], costUsd: 0 };
  }

  const revised = await reviseRejected(campaign, first.rejections, label, context, source);
  if (!revised) {
    return {
      rejections: first.rejections,
      notes: [...bound.notes, ...first.notes],
      costUsd: 0,
    };
  }

  const boundAgain = bind(revised.ops);
  const second = campaign.stage(boundAgain.ops, `${label}:correction`, '', source);
  return {
    rejections: second.rejections,
    notes: [...bound.notes, ...first.notes, ...boundAgain.notes, ...second.notes],
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
  // Checked before anything is spent. The arbiter costs real money, so running
  // out of turn has to be free to discover.
  if (campaign.actionPointsLeft <= 0) {
    return {
      narrative: `Nothing further will move until the turn ends. You have used all ${ACTION_POINTS_PER_TURN} actions.`,
      refusal: null,
      defiance: null,
      staged: 0,
      notes: [
        `No actions left this turn (${ACTION_POINTS_PER_TURN} per turn).`,
        'End the turn to let orders tick, income land and the other powers answer.',
      ],
      rejections: [],
      costUsd: 0,
      check: null,
      ops: [],
    };
  }

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
  // Deliberately BEFORE any point is spent: the arbiter has ruled the thing
  // cannot be attempted, so nothing happened and there is nothing to charge for.
  if (resolution.output.inadmissible) {
    return {
      narrative: resolution.output.narrative,
      refusal: null,
      staged: 0,
      notes: ['The arbiter ruled this cannot be attempted as things stand.'],
      rejections: [],
      costUsd: resolution.costUsd,
      check: null,
      ops: [],
    };
  }

  // A negotiation, not a decree. Costs nothing, stages nothing, charges no
  // dissent: the player asked for something reasonable and is being told where
  // the mechanism for it actually lives.
  // Also free: being told "that is a conversation" is a redirect, not an act.
  // Charging for it would make the redirect feel like a penalty for asking.
  if (resolution.output.negotiation) {
    const n = resolution.output.negotiation;
    return {
      narrative: resolution.output.narrative,
      refusal: null,
      defiance: null,
      negotiation: n,
      staged: 0,
      notes: [
        n.supported
          ? 'Your own people are behind this — but it is not yours to declare.'
          : 'This needs agreement you do not have.',
        `Open a channel and negotiate it: ${n.channels}`,
        'Whatever is actually agreed there becomes ops when you /endtalk.',
      ],
      rejections: [],
      costUsd: resolution.costUsd,
      check: null,
      ops: [],
    };
  }

  if (resolution.output.refusal) {
    // Spent. Your institutions refusing is a real event with a real cost, and a
    // free retry would let a player probe their own red lines all day.
    campaign.spendActionPoint();
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
        `Dissent ${dissent}/100 — every stat is now reduced by ${dissentPenalty(dissent)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
      ].filter(Boolean),
      rejections: [],
      costUsd: resolution.costUsd,
      check: null,
      ops: campaign.opsStagedSince(before),
    };
  }

  // A COMPULSION defied rather than a red line crossed. The distinction is the
  // whole of it: a red line is absolute and buys nothing, while a compulsion is
  // a demand a leader is allowed to overrule — so the order stands, and the
  // institutions charge for having been overruled. Four of these reach the cap.
  //
  // This replaced retiring principles. A player who means to change what their
  // power is now does it by insisting, repeatedly, and absorbing the cost, which
  // leaves nothing to desync between the character sheet and the fiction.
  campaign.spendActionPoint();

  const defiance = resolution.output.defiance ?? null;

  // The check is recorded so a campaign's luck is auditable after the fact, but
  // it rides along with the action's own ops rather than forming a batch of its
  // own — a separate batch would show up in the player's "declared this turn"
  // list as a meaningless "check record" entry and inflate the count.
  const ops = [
    ...resolution.output.ops,
    ...(resolution.check
      ? [{ op: 'log_narrative', text: `[check] ${describeCheck(resolution.check)}` }]
      : []),
    // Charged in code, not chosen by the model: the resolution call says a
    // compulsion was defied, and the price for that is not its to nominate.
    ...(defiance
      ? [
          {
            op: 'adjust_dissent',
            factionId: campaign.state.playerFactionId,
            delta: COMPULSION_BREACH_DISSENT,
            reason: defiance.violated || defiance.reason,
          },
          {
            op: 'log_narrative',
            text: `[objected to by ${defiance.by}] ${defiance.reason}`,
          },
        ]
      : []),
  ];

  const staged = await stageWithCorrection(
    campaign,
    ops,
    action.length > 48 ? `${action.slice(0, 47)}…` : action,
    resolution.output.narrative,
    `The player declared: ${action}\n\nYour narrative was: ${resolution.output.narrative}`,
    resolution.check?.outcome,
  );

  if (defiance) {
    const total = Math.min(
      100,
      (getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0),
    );
    staged.notes.push(
      ...[
        // Who objected and why is on `defiance` itself, and the UI renders it
        // in its own voice; repeating it here only doubled the line.
        defiance.violated ? `Defied: ${defiance.violated}` : '',
        `Dissent +${COMPULSION_BREACH_DISSENT}, now ${total}/100 — every stat is reduced by ${dissentPenalty(total)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
      ].filter(Boolean),
    );
  }

  return {
    narrative: resolution.output.narrative,
    staged: campaign.stagedCount - before,
    notes: staged.notes,
    rejections: staged.rejections,
    costUsd: resolution.costUsd + staged.costUsd,
    check: resolution.check,
    refusal: null,
    defiance,
    ops: campaign.opsStagedSince(before),
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
      ops: [],
    };
  }

  const before = campaign.stagedCount;
  const faction = getFaction(campaign.state, factionId);
  const extraction = await extractAgreements(campaign.state, factionId, history);

  // The institutions get a view on a deal, exactly as they do on a decree.
  //
  // Without this the arbiter gated the declaration path and nothing gated
  // extraction, so a red line could be walked past by framing the act as a
  // negotiation — measured live, the Combine emitted `forgive_debt` against its
  // own first red line for no dissent at all, while the same intent declared
  // normally was refused three times. Sharper than a plain missing check:
  // `establish_debt` and `forgive_debt` are extraction-only by design, so the
  // ops most tied to that faction's identity were the ones with no check.
  //
  // Only when the transcript actually produced ops. A conversation that agreed
  // nothing changes nothing, and must not cost a call to discover that.
  const ruling =
    extraction.output.ops.length > 0
      ? await appraiseAgreement(campaign.state, factionId, extraction.output.narrative)
      : null;
  const actor = getFaction(campaign.state, campaign.state.playerFactionId);
  const named = ruling?.appraisal.breach?.principles ?? [];
  const breach = actor && named.length > 0 ? classifyPrinciples(actor, named) : null;
  const rulingCost = ruling?.costUsd ?? 0;

  // A red line refuses the WHOLE agreement. A deal that requires you to cross
  // it is not a smaller deal, it is no deal — the same rule `submitAction`
  // applies to an order the fleet will not carry out. The other party's
  // concessions go with it, because there is nothing left to concede to.
  if (breach?.kind === 'red_line') {
    const by = ruling?.appraisal.breach?.by ?? 'your own institutions';
    const why =
      ruling?.appraisal.breach?.reason ||
      'That is not something this power will put its name to.';
    campaign.stage(
      [
        { op: 'log_narrative', text: `[refused by ${by}] ${why}` },
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: REFUSAL_DISSENT,
          reason: breach.principle,
        },
      ],
      `refused accord with ${faction?.name ?? factionId}`,
      why,
    );
    const dissent = getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0;
    return {
      narrative: why,
      refusal: { by, reason: why, violated: breach.principle },
      staged: campaign.stagedCount - before,
      notes: [
        `${by} will not ratify the accord with ${faction?.name ?? factionId}.`,
        `Breached: ${breach.principle}`,
        `Dissent ${dissent}/100 — every stat is now reduced by ${dissentPenalty(dissent)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
      ],
      rejections: [],
      costUsd: extraction.costUsd + rulingCost,
      ops: campaign.opsStagedSince(before),
    };
  }

  const staged = await stageWithCorrection(
    campaign,
    extraction.output.ops,
    `accord with ${faction?.name ?? factionId}`,
    extraction.output.narrative,
    `Extraction from a diplomatic channel with ${factionId}: ${extraction.output.narrative}`,
    undefined,
    // The one model-driven source that may form a treaty: these ops come from a
    // transcript in which the other power actually said yes.
    'extraction',
  );

  // A compulsion is a price, not a wall: the accord stands and the institutions
  // charge for having been overruled — the same bargain a declared action gets.
  const notes = [...staged.notes];
  let defiance: ActionOutcome['defiance'] = null;
  if (breach?.kind === 'compulsion') {
    const by = ruling?.appraisal.breach?.by ?? 'your own institutions';
    defiance = {
      by,
      reason: ruling?.appraisal.breach?.reason || 'It was agreed over their objection.',
      violated: breach.principle,
    };
    campaign.stage(
      [
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: COMPULSION_BREACH_DISSENT,
          reason: breach.principle,
        },
        { op: 'log_narrative', text: `[objected to by ${by}] ${defiance.reason}` },
      ],
      `objection to the accord with ${faction?.name ?? factionId}`,
      '',
    );
    const dissent = getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0;
    notes.push(
      `${by} objected to the accord and it stands anyway.`,
      `Defied: ${breach.principle}`,
      `Dissent +${COMPULSION_BREACH_DISSENT}, now ${dissent}/100 — every stat is reduced by ${dissentPenalty(dissent)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
    );
  }

  return {
    narrative: extraction.output.narrative,
    defiance,
    staged: campaign.stagedCount - before,
    notes,
    rejections: staged.rejections,
    costUsd: extraction.costUsd + staged.costUsd + rulingCost,
    // Extraction is the one pass that can turn conversation into ops, so seeing
    // exactly what it read out of a transcript matters more here than anywhere.
    ops: campaign.opsStagedSince(before),
  };
}
