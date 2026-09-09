import { describeCheck, type CheckResult } from '../domain/checks.js';
import { boundPayloadsToOutcome, routeCovertAction } from '../domain/development.js';
import {
  describeRejections,
  ExtractionOutputSchema,
  ModelTurnOutputSchema,
  type OpRejection,
} from '../domain/ops.js';
import type { TurnReport } from '../domain/reducer.js';
import {
  COMPULSION_BREACH_DISSENT,
  COUNTERPARTY_BREACH_DISSENT,
  dissentPenalty,
  getFaction,
  MAX_DISSENT_PENALTY,
  REFUSAL_DISSENT,
} from '../domain/state.js';
import {
  narrateEpilogue,
  appraiseAgreement,
  extractAgreements,
  recordRuling,
  verifyBreachRelevance,
  gatherReactions,
  resolveAction,
  type ChatMessage,
} from '../model/calls.js';
import {
  breachContradictsState, classifyPrinciples } from '../domain/compulsions.js';
import { callStructured } from '../model/client.js';
import { loadPrompt } from '../model/prompts.js';
import { createSeedState } from '../seed/scenario.js';
import { proposeFor } from '../domain/initiative.js';
import { controlHistory } from './journal.js';
import type { Concession } from '../domain/diplomacy.js';
import type { WorldState } from '../domain/state.js';
import {
  campaignOutcome,
  fallbackEpilogue,
  serializeOutcome,
  type EpilogueView,
} from './epilogue.js';
import { mostAffectedFactions, serializeCharacter, serializeState } from '../model/serialize.js';
import { ACTION_POINTS_PER_TURN, type Campaign } from './campaign.js';

export interface ReactionView {
  factionId: string;
  factionName: string;
  color: number;
  narrative: string;
  /** Set when this power wants to open a conversation. See `ReactionSchema`. */
  approach: { opening: string; about: string } | null;
  /**
   * What this faction actually did, as applied.
   *
   * `ReactionView` had no such field, so `reactions[].ops` was `null` for every
   * faction on every turn while the event log proved ops had landed on the same
   * tick. A caller reading the turn payload saw a narrative describing action
   * and no way to tell what came of it — or that a whole batch had been held
   * back, which atomic batching makes an all-or-nothing outcome worth
   * reporting.
   */
  ops: unknown[];
  /** Set when the batch was rejected whole and nothing in it landed. */
  heldBack: number | null;
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
  /**
   * Set when the arbiter ruled the action cannot be attempted at all — the
   * world does not permit it, as distinct from permitting it and having it go
   * badly. Nothing was rolled, nothing staged, no action point spent.
   *
   * `ResolutionOutput` has carried this since the arbiter was split out; it
   * simply never reached the wire, so the browser could only tell an
   * inadmissible action from an ordinary one by matching a note string.
   */
  inadmissible?: string | null;
  /**
   * Set when the declaration was turned away because the turn's actions are
   * spent. The fifth and last way a declaration produces nothing, and the only
   * one that is about the player's turn rather than about the world.
   */
  outOfActions?: { perTurn: number } | null;
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
   * The whole batch as proposed. Needed because batches are atomic: nothing
   * from the first attempt was applied, so the correction has to re-emit the
   * good ops as well as fix the bad ones.
   */
  attempted: unknown[],
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
    '## What you emitted, none of which was applied',
    '',
    'An action lands whole or not at all. The reducer refused some of these ops,',
    'so NONE of the batch was applied and the world is exactly as the state above',
    'describes it. Nothing has happened twice and nothing needs preserving.',
    '',
    '```json',
    JSON.stringify(attempted, null, 2).slice(0, 6000),
    '```',
    '',
    '## Why it was refused',
    '',
    describeRejections(rejections),
    '',
    'Re-emit the WHOLE batch, corrected. Keep the ops that were fine exactly as',
    'they were, and fix or drop the ones named above. If a rejected op cannot be',
    'expressed legally, drop it and say so in the narrative rather than working',
    'around the rules — but do not drop the rest of the action with it.',
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

  const revised = await reviseRejected(campaign, first.rejections, label, context, bound.ops, source);
  if (!revised) {
    return {
      rejections: first.rejections,
      notes: [...bound.notes, ...first.notes],
      costUsd: 0,
    };
  }

  const boundAgain = bind(revised.ops);
  const second = campaign.stage(boundAgain.ops, `${label}:correction`, '', source);

  // BOTH batches' rejections reach the player, and the first batch's
  // all-or-nothing note is rewritten when the correction landed.
  //
  // The response used to carry `second.rejections` alone, so a corrected action
  // reported none at all — while `notes` still carried the first batch's
  // "Nothing in this batch was applied: 4 of 10 ops were rejected", written by
  // the atomic rollback of a batch that was then successfully replaced.
  // Measured: a player was told nothing landed and given no reason, and the
  // board said otherwise — the correction had applied 320 credits.
  //
  // Both halves were wrong from the player's seat, and in opposite directions.
  const corrected = second.rejections.length === 0;
  const firstNotes = corrected
    ? first.notes.map((n) =>
        n.startsWith('Nothing in this batch was applied')
          ? `${n.replace(/\.$/, '')} — corrected and re-staged, and the second attempt landed.`
          : n,
      )
    : first.notes;
  return {
    // First then second: the order they happened, and the first is the one that
    // explains why there was a correction at all.
    rejections: [...first.rejections, ...second.rejections],
    notes: [...bound.notes, ...firstNotes, ...boundAgain.notes, ...second.notes],
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

  const revised = await reviseRejected(campaign, first.rejections, label, context, ops);
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
      outOfActions: { perTurn: ACTION_POINTS_PER_TURN },
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

  // Every ruling that named a line is written down, including the ones that
  // charged nothing. Staged as an engine op so it replays with the campaign and
  // can be read back off any save — a drift report needs rows, not console
  // output that scrolls away.
  //
  // Before the outcome branches, because a refusal stages nothing else and an
  // inadmissible ruling returns before staging at all; putting it here is what
  // makes the record cover the exits that produce no other trace.
  if (resolution.ruling) {
    campaign.stage(
      [{ op: 'log_ruling', ...resolution.ruling }],
      'arbiter ruling',
      '',
      'engine',
      campaign.state.playerFactionId,
    );
  }

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
      inadmissible: resolution.output.inadmissible,
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

  // One act, one mechanism. A covert declaration BECOMES a deployment, so it is
  // charged by `AGENT_COST`, held to `maxAgentsFor`, resolved on the tick and
  // exposed on the same ladder as an operative placed the ordinary way. Without
  // this the declared route was simply cheaper than the mechanic it duplicates.
  const routed = routeCovertAction(
    ops,
    resolution.check?.outcome ?? 'success',
    resolution.output.covert,
    campaign.state.playerFactionId,
  );

  const staged = await stageWithCorrection(
    campaign,
    routed.ops,
    action.length > 48 ? `${action.slice(0, 47)}…` : action,
    resolution.output.narrative,
    `The player declared: ${action}\n\nYour narrative was: ${resolution.output.narrative}`,
    resolution.check?.outcome,
  );
  staged.notes.unshift(...routed.notes);

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
    // Three responders, not four, so one seat is always left for a power the
    // player never touched.
    //
    // `mostAffectedFactions` selects from what the PLAYER's ops touched, and in
    // a live campaign a player touches enough of the board that nearly every
    // faction is a responder nearly every turn — so `proposeFor` fell through
    // for almost nobody and doctrine initiative fired exactly when it was least
    // needed. Measured: 2 NPC-vs-NPC attacks over 12 turns with no player at
    // all, and **zero** over a 10-turn campaign with one.
    //
    // The reserved seat is not a fifth responder — it costs no extra tokens,
    // because the faction it displaces is handled by its own doctrine instead,
    // which is free.
    const responders = mostAffectedFactions(
      campaign.state,
      touched.factions,
      touched.systems,
      campaign.state.playerFactionId,
      3,
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
            ops: applied.rejections.length > 0 ? [] : reaction.ops,
            heldBack: applied.rejections.length > 0 ? applied.rejections.length : null,
            // An invitation to talk, if this power wants something. Passed
            // through rather than acted on: the player opens the channel.
            approach: reaction.approach ?? null,
          });
        }
      } catch (err) {
        notes.push(
          `NPC reaction call failed: ${err instanceof Error ? err.message : String(err)}. The turn stands; nobody responded.`,
        );
      }
    }
  }

  // Every power that the model did NOT speak for acts on its own doctrine.
  //
  // This is what closes the solipsism. Responders are chosen from what the
  // player's ops touched, and reactions are skipped entirely on a quiet turn —
  // so a faction the player ignores has never acted at all. Measured over
  // seven turns: 16 NPC fleet movements, six of them attacks, and every attack
  // aimed at the player, while two NPC pairs sat at war on paper and never
  // moved a ship at each other.
  //
  // The bots in `domain/initiative.ts` already contest each other; that is
  // what the balance harness measures. Running them here costs nothing, is
  // pure, and replays exactly — the journal records the ops, not the
  // reasoning. It runs OUTSIDE the `committed.applied > 0` gate on purpose, so
  // a turn the player ends quietly is still a turn in which the galaxy moves.
  const spokenFor = new Set([campaign.state.playerFactionId, ...reactionViews.map((r) => r.factionId)]);
  for (const faction of campaign.state.factions) {
    if (spokenFor.has(faction.id)) continue;
    const proposal = proposeFor(campaign.state, faction.id);
    if (!proposal) continue;

    // The rationale is logged as part of the batch, so `serializeRecentLog`
    // carries it into the NEXT reaction call and the faction can account for
    // its own move when it next speaks. That is the whole of the retroactive
    // narration: no second model call, and the NPC's history becomes something
    // it reasons from rather than something only the player remembers.
    const withheld = proposal.withheld.length > 0
      ? ` It holds back ${proposal.withheld.join(' and ')}.`
      : '';
    const batch = [
      ...proposal.ops,
      {
        op: 'spawn_event',
        factionId: faction.id,
        text: `${proposal.rationale}${withheld}`,
      },
    ];

    const applied = campaign.commit(batch, 'model', `initiative:${faction.id}`, faction.id);
    notes.push(...applied.notes);
    rejections.push(...applied.rejections);
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

/**
 * Drop what the other power never actually put on the table.
 *
 * The consent gap in one sentence: `extractAgreements` reads the transcript AND
 * asserts what was in it, and nothing compared the two. A playtest moved three
 * worlds — one the map's greatest junction — off a conversation whose
 * counterparty had said *"Oridin, no — garrison standing, no world changes
 * hands"*, and two of the three were never asked for at all.
 *
 * Another interpreter cannot close that: a checker shown the transcript and a
 * plausible reading is handed the conclusion and asked to agree. So the
 * counterparty records what it concedes as it concedes it, and this function is
 * the enforcement half — a matcher, not a judge. The same split as
 * `classifyPrinciple`, where the model names the line and code does the lookup.
 *
 * **Only terms that cost the counterparty are grounded.** A player giving its
 * own world away, paying its own credits or taking on its own debt binds
 * nobody else, and requiring a record there would turn every one-sided
 * concession into a dead promise — the exact bug class this is meant to end.
 */
export function groundInConcessions(
  state: WorldState,
  ops: unknown[],
  conceded: readonly Concession[],
  otherId: string,
): { ops: unknown[]; dropped: string[] } {
  const theirs = conceded.filter((c) => c.by === otherId);
  const ceded = new Set(theirs.flatMap((c) => c.systems));
  const offeredCredits = theirs.reduce((n, c) => n + c.credits, 0);
  const offeredPerTurn = theirs.reduce((n, c) => n + c.perTurn, 0);
  const offeredHulls = theirs.reduce((n, c) => n + c.hulls, 0);
  const handedOver = new Set(theirs.flatMap((c) => c.assets));
  const saidAnything = theirs.length > 0;
  const dropped: string[] = [];

  const keep = ops.filter((raw) => {
    if (raw === null || typeof raw !== 'object') return true;
    const op = raw as Record<string, unknown>;

    if (op.op === 'form_treaty') {
      const terms = (op.terms ?? {}) as Record<string, unknown>;
      // Worlds are the sharpest case and the one that was measured: a world
      // moves only if that power named it. Ids, because the power conceding
      // resolved its own "the Sennex lane is yours" into systems itself.
      const territory = Array.isArray(terms.territory) ? (terms.territory as string[]) : [];
      const theirWorlds = territory.filter(
        (id) => state.systems.find((sys) => sys.id === id)?.controllerFactionId === otherId,
      );
      const ungranted = theirWorlds.filter((id) => !ceded.has(id));
      if (ungranted.length > 0) {
        dropped.push(
          `${ungranted.join(', ')} — ${otherId} never put ${ungranted.length === 1 ? 'it' : 'them'} on the table.`,
        );
        return false;
      }
      const payment = (terms.payment ?? {}) as Record<string, number>;
      const owed = -(payment[otherId] ?? 0);
      if (owed > 0 && owed > offeredCredits) {
        dropped.push(`a payment of ${owed} from ${otherId}, which it never offered.`);
        return false;
      }
      const perTurn = (terms.incomePerTurn ?? {}) as Record<string, number>;
      const stream = -(perTurn[otherId] ?? 0);
      if (stream > 0 && stream > offeredPerTurn) {
        dropped.push(`${stream} a turn from ${otherId}, which it never offered.`);
        return false;
      }
      const pledged = (terms.shipsPledged ?? {}) as Record<string, number>;
      if ((pledged[otherId] ?? 0) > offeredHulls) {
        dropped.push(`${pledged[otherId]} hulls pledged by ${otherId}, which it never offered.`);
        return false;
      }
      return true;
    }

    // A thing is exactly as sharp a case as a world, and for the same reason: an
    // asset is a RECORD, so *"you can have your people back"* names no id and
    // nothing downstream can pick which haul was meant. The power holding them
    // resolved it when it said so.
    if (op.op === 'transfer_asset' && typeof op.assetId === 'string') {
      const asset = (state.assets ?? []).find((a) => a.id === op.assetId);
      // Only when it is coming OUT of the other party's hands. The player
      // giving their own away binds nobody and needs no record, which is the
      // same rule that keeps one-sided concessions out of this whole check.
      if (asset && asset.heldBy === otherId && !handedOver.has(asset.id)) {
        dropped.push(`${asset.text} — ${otherId} never put it on the table.`);
        return false;
      }
      return true;
    }

    // A debt binds the debtor. Anything else — a commitment naming them, money
    // taken out of their treasury — needs them to have conceded SOMETHING; the
    // arrangement itself is free-form by design, so the check is coarse on
    // purpose. Terms with no structured referent are the creative case, where
    // the damage is bounded and the vocabulary is deliberately open.
    if (op.op === 'establish_debt' && op.debtorFactionId === otherId && !saidAnything) {
      dropped.push(`a debt owed by ${otherId}, which it never agreed to owe.`);
      return false;
    }
    if (op.op === 'adjust_credits' && op.factionId === otherId && Number(op.delta ?? 0) < 0 && !saidAnything) {
      dropped.push(`credits out of ${otherId}'s treasury, which it never agreed to pay.`);
      return false;
    }
    if (op.op === 'establish_commitment') {
      const bound = Array.isArray(op.factionIds) ? (op.factionIds as string[]) : [];
      if (bound.includes(otherId) && !saidAnything) {
        dropped.push(`an arrangement binding ${otherId}, which it never agreed to.`);
        return false;
      }
    }
    return true;
  });

  return { ops: keep, dropped };
}

export async function closeChannel(
  campaign: Campaign,
  factionId: string,
  history: ChatMessage[],
  /**
   * What each power actually wrote down as conceded, accumulated message by
   * message during the conversation, and any of the player's own concessions
   * its institutions ruled a red line.
   *
   * Optional so a caller with no channel state (a test, a replay) behaves as
   * before rather than having every accord refused for want of a record.
   */
  conceded: readonly Concession[] = [],
  blockers: readonly { concession: string; principle: string }[] = [],
): Promise<ActionOutcome> {
  if (history.length === 0) {
    campaign.recordTranscript(factionId, history);
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
  const firstPass = actor && named.length > 0 ? classifyPrinciples(actor, named) : null;

  // Same second opinion the declared path gets: the quote is proven real by
  // `classifyPrinciples`, and nothing proved it was about this act.
  let relevanceCost = 0;
  let breach = firstPass;
  let firstPassRelevant: boolean | null = null;
  // A compulsion that carries a trigger is a question about the board, and the
  // board can answer it for free. `verifyBreachRelevance` is shown the act and
  // the line and deliberately no state, so it cannot notice that a
  // state-dependent compulsion is factually inapplicable — measured live as 15
  // dissent charged for "no raid under way" while a raid was staged and a fleet
  // was in transit. Checked before the paid call, so a contradiction costs
  // nothing to catch.
  if (
    firstPass?.kind === 'compulsion' &&
    breachContradictsState(campaign.state, campaign.state.playerFactionId, firstPass.principle)
  ) {
    breach = null;
  } else if (firstPass) {
    const check = await verifyBreachRelevance(
      extraction.output.narrative,
      firstPass.principle,
      firstPass.kind,
    );
    relevanceCost = check.costUsd;
    firstPassRelevant = check.relevant;
    if (!check.relevant) breach = null;
  }
  const rulingCost = (ruling?.costUsd ?? 0) + relevanceCost;

  // The same record the declared path writes. An accord's rulings drift exactly
  // as an order's do — a playtest saw six treaty-emitting accords permitted and
  // two refused, one of them on a debt, with no way to ask how often.
  // AND THE OTHER POWER'S OWN INSTITUTIONS GET A VIEW.
  //
  // `appraiseAgreement` is scoped to the acting faction by construction, on the
  // correct ground that the counterparty's concessions cannot trip the PLAYER's
  // lines. They should trip their own, and nothing checked: measured, the Iron
  // Vigil negotiated three messages and signed an accommodation with the Nars
  // against a sheet that forbids exactly that, at no cost to itself.
  //
  // A price rather than a veto — an NPC backing out at signature would destroy a
  // deal the player negotiated in good faith, with none of the warning the
  // player gets from a blocker. A leader may agree to what its people hate, and
  // its people notice.
  //
  // Only when the accord produced ops AND the other power actually conceded
  // something: agreeing to nothing costs nobody anything, and a conversation
  // that agreed nothing must not cost a call to discover that.
  let counterpartyCost = 0;
  const counterpartyNotes: string[] = [];
  const theirs = conceded.filter((c) => c.by === factionId);
  if (extraction.output.ops.length > 0 && theirs.length > 0) {
    const other = getFaction(campaign.state, factionId);
    const theirRuling = await appraiseAgreement(
      campaign.state,
      campaign.state.playerFactionId,
      theirs.map((c) => c.text).join(' '),
      factionId,
    );
    counterpartyCost = theirRuling.costUsd;
    const theirNamed = theirRuling.appraisal.breach?.principles ?? [];
    const theirBreach =
      other && theirNamed.length > 0 ? classifyPrinciples(other, theirNamed) : null;
    if (theirBreach) {
      campaign.stage(
        [
          {
            op: 'adjust_dissent',
            factionId,
            delta: COUNTERPARTY_BREACH_DISSENT[theirBreach.kind],
            reason: theirBreach.principle,
          },
        ],
        `${factionId} signs against its own line`,
        '',
        'engine',
        factionId,
      );
      const said = `${other?.name ?? factionId} signs anyway, against its own standing: "${theirBreach.principle}". Its institutions will remember.`;
      counterpartyNotes.push(said);
    }
  }

  const rulingRow = recordRuling(
    extraction.output.narrative,
    'accord',
    named,
    firstPass,
    firstPassRelevant,
    breach !== null,
  );
  if (rulingRow) {
    campaign.stage(
      [{ op: 'log_ruling', ...rulingRow }],
      'arbiter ruling',
      '',
      'engine',
      campaign.state.playerFactionId,
    );
  }

  // A red line refuses the WHOLE agreement. A deal that requires you to cross
  // it is not a smaller deal, it is no deal — the same rule `submitAction`
  // applies to an order the fleet will not carry out. The other party's
  // concessions go with it, because there is nothing left to concede to.
  if (breach?.kind === 'red_line') {
    const by = ruling?.appraisal.breach?.by ?? 'your own institutions';
    // The conversation happened and is worth keeping, but what it agreed did
    // NOT. Transcripts are replayed into the persona, so a refused accord left
    // the other power remembering a concession it never actually made:
    // measured live, an NPC forgave 100 of a debt in a refused accord and
    // spent the rest of the campaign treating it as done — *"my pen already
    // struck the first hundred"* — while the balance ran down on instalments
    // alone. The player paid the dissent, got nothing, and was permanently
    // blocked from the deal by the counterparty's memory of granting it.
    //
    // A `record` line rather than dropping the transcript: the conversation is
    // real and the rapport in it is real, and only the outcome was different
    // from what was said.
    campaign.recordTranscript(factionId, [
      ...history,
      {
        speaker: 'record' as const,
        text: `[This accord was REFUSED by ${by} and never took effect. Nothing agreed above was carried out — no treaty, no payment, no concession by either side. Both parties are back where they started.]`,
      },
    ]);
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

  // A red line found DURING the conversation blocks the accord, and it was
  // already said out loud in the turn it was approached rather than sprung at
  // the end. Refused whole for the same reason a declared red line is: a deal
  // that needs you to cross one is not a smaller deal, it is no deal.
  if (blockers.length > 0) {
    const first = blockers[0]!;
    const by = getFaction(campaign.state, campaign.state.playerFactionId)?.name ?? 'Your institutions';
    const why = `${by} will not ratify: ${first.concession}`;
    return {
      narrative: why,
      refusal: { by, reason: why, violated: first.principle },
      staged: 0,
      notes: [
        ...blockers.map((b) => `Breached: ${b.principle} — ${b.concession}`),
        'This was flagged when it was conceded, not at signature; the accord could have been renegotiated around it.',
      ],
      rejections: [],
      costUsd: extraction.costUsd,
      ops: [],
    };
  }

  // Ops that COST THE COUNTERPARTY must be grounded in something that power
  // actually wrote down. A concession by the player needs no grounding: nobody
  // needs protecting from a power binding itself.
  const grounded = groundInConcessions(campaign.state, extraction.output.ops, conceded, factionId);

  const staged = await stageWithCorrection(
    campaign,
    grounded.ops,
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
  // The conversation is recorded with whatever actually became of it.
  //
  // A refusal is only ONE of the ways an accord can agree something and deliver
  // nothing. The reducer can reject the batch whole (atomic batches make that
  // all-or-nothing), and transcripts are replayed into the persona — so the
  // other power goes on believing in a concession the world has no record of,
  // permanently blocking a deal the player is entitled to ask for again.
  // A number that was trimmed is a number the parties did not agree to, and
  // they should be arguing about the real one. Transcripts are replayed into
  // the persona, so a trim that stays in `notes` is invisible to the very power
  // that bargained over it — measured: an annuity haggled from 80 to 95 settled
  // at 60 with neither side told, and a headline 33% toll share settles at one
  // credit a turn.
  const trims = staged.notes.filter((n) => /^Trimmed |^Dropped /.test(n));

  campaign.recordTranscript(
    factionId,
    staged.rejections.length > 0
      ? [
          ...history,
          {
            speaker: 'record' as const,
            text: `[Nothing agreed above took effect: the terms could not be carried out (${staged.rejections
              .map((r) => r.code)
              .join(', ')}). Both parties are back where they started.]`,
          },
        ]
      : trims.length > 0
        ? [
            ...history,
            {
              speaker: 'record' as const,
              text: `[What actually took effect differs from what was said: ${trims.join(' ')} Both parties are working from the smaller figures now.]`,
            },
          ]
        : history,
  );

  const notes = [...staged.notes, ...counterpartyNotes];
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

  // Said out loud rather than dropped quietly. A term the other power never put
  // on the table is exactly the thing both sides would otherwise leave the room
  // believing in — which is the failure `closeChannel` already records a
  // transcript line for.
  if (grounded.dropped.length > 0) {
    notes.push(
      ...grounded.dropped.map(
        (d) => `Not enacted — ${d} Nothing binds a power that did not write it down.`,
      ),
    );
  }

  return {
    narrative: extraction.output.narrative,
    defiance,
    staged: campaign.stagedCount - before,
    notes,
    rejections: staged.rejections,
    costUsd: extraction.costUsd + staged.costUsd + rulingCost + counterpartyCost,
    // Extraction is the one pass that can turn conversation into ops, so seeing
    // exactly what it read out of a transcript matters more here than anywhere.
    ops: campaign.opsStagedSince(before),
  };
}

/* ------------------------------------------------------------------ */
/* The last page                                                        */
/* ------------------------------------------------------------------ */

/**
 * Close a campaign that has run out of turns.
 *
 * The facts are computed first and the prose is written over them, which is
 * the same split the whole game uses — and it matters more here than anywhere
 * else, because this is the last thing the player reads and they have no turn
 * left in which to catch an invented war.
 *
 * **It cannot fail.** A model call can die for reasons that have nothing to do
 * with the campaign — a dropped stream, an overloaded tier, a token that
 * expired mid-session — and an ending that does not appear is worse than a
 * plain one. On any failure the deterministic epilogue is used and the view
 * says so, rather than the player being handed an error where their ending
 * should be.
 */
export async function writeEpilogue(
  campaign: Campaign,
): Promise<{ view: EpilogueView; costUsd: number }> {
  // `state` rather than the committed journal because they are the same thing
  // here: this runs immediately after `endTurn`, which commits every staged
  // batch and clears the list. Reading the preview keeps `committed` private.
  const state = campaign.state;
  // The campaign's history, not only its endpoints. Replaying the journal once
  // more costs milliseconds on a path that is about to make a model call taking
  // seconds, and it is the only way to see a world that changed hands and
  // changed back — which is exactly the world worth narrating.
  const outcome = campaignOutcome(
    state,
    createSeedState(state.playerFactionId),
    campaign.maxTurns ?? state.turn,
    controlHistory(campaign.journal),
  );

  const base = {
    turn: outcome.turn,
    maxTurns: outcome.maxTurns,
    playerFactionId: outcome.playerFactionId,
    unaligned: outcome.unaligned,
    foremost: outcome.foremost,
    leaders: outcome.leaders,
    upheavals: outcome.upheavals,
    factions: outcome.factions,
  };

  try {
    const written = await narrateEpilogue(
      serializeOutcome(outcome),
      state.factions.map((f) => serializeCharacter(f)).join('\n\n'),
    );
    // A slide for a faction that does not exist, or a missing one, would leave
    // a hole in the ending. Reconciled against the dossier rather than trusted.
    const byId = new Map(written.output.slides.map((sl) => [sl.factionId, sl.text]));
    const fallback = fallbackEpilogue(outcome);
    const slides = outcome.factions.map((f) => ({
      factionId: f.factionId,
      text: byId.get(f.factionId) ?? fallback.slides.find((sl) => sl.factionId === f.factionId)!.text,
    }));
    return {
      view: { ...base, slides, closing: written.output.closing, fallback: false },
      costUsd: written.costUsd,
    };
  } catch {
    const plain = fallbackEpilogue(outcome);
    return {
      view: { ...base, slides: plain.slides, closing: plain.closing, fallback: true },
      costUsd: 0,
    };
  }
}
