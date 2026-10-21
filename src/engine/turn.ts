import type { CheckResult } from '../domain/checks.js';
import { boundPayloadsToOutcome, routeCovertAction } from '../domain/development.js';
import {
  describeRejections,
  ExtractionOutputSchema,
  ModelTurnOutputSchema,
  type OpRejection,
  orderFor,
} from '../domain/ops.js';
import { applyOps, type TurnReport } from '../domain/reducer.js';
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
  reconcileNarrative,
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
import { span } from '../model/telemetry.js';
import { loadPrompt } from '../model/prompts.js';
import { createSeedState } from '../seed/scenario.js';
import { brokeredAccords, honourTreaties, proposeFor } from '../domain/initiative.js';
import { battleHistory, controlHistory, overrulings } from './journal.js';
import { holdToRuling, noPaymentBesideAGift, type RulingBounds } from '../domain/refusals.js';
import { ACT_WORDS, SWAY_BY_BAND, linesCrossed, type Act, type LineHit } from '../domain/acts.js';
import { accelerationCost, type FibScale } from '../domain/duration.js';
import { isMovementType } from '../domain/state.js';
import { PEACE_TREATIES, type Concession } from '../domain/diplomacy.js';
import type { WorldState } from '../domain/state.js';
import {
  campaignOutcome,
  fallbackEpilogue,
  serializeOutcome,
  type EpilogueView,
} from './epilogue.js';
import { involvedFactions, serializeCharacter, serializeState } from '../model/serialize.js';
import {
  ACTION_POINTS_PER_TURN,
  markNotesPrivate,
  type Campaign,
  type StageMeta,
} from './campaign.js';

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
export function touchedBy(state: WorldState, ops: unknown[]): { factions: string[]; systems: string[] } {
  // Any value naming a power or a world, wherever it sits in the op: a bounty's
  // target, a treaty's parties, a void condition, a marque's `against`. Reading
  // three field names missed most of them, and a power the turn named in a
  // field nobody listed was a power the turn did not involve.
  const factionIds = new Set(state.factions.map((f) => f.id));
  const systemIds = new Set(state.systems.map((x) => x.id));
  const factions = new Set<string>();
  const systems = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4) return;
    if (typeof value === 'string') {
      if (factionIds.has(value)) factions.add(value);
      else if (systemIds.has(value)) systems.add(value);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) walk(v, depth + 1);
    }
  };
  for (const op of ops) walk(op, 0);
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
): Promise<{ ops: unknown[]; narrative: string; costUsd: number } | null> {
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
      // A correction re-emits the ops alone: which concessions were agreed was
      // settled by the first pass, and the transfers they name are not its to touch.
      schema: source === 'extraction' ? ExtractionOutputSchema.omit({ accepted: true }) : ModelTurnOutputSchema,
      maxRetries: 1,
    });
    return { ops: res.value.ops, narrative: res.value.narrative, costUsd: res.costUsd };
  } catch {
    // The correction call itself failed. The original rejections still stand
    // and are reported to the player rather than swallowed.
    return null;
  }
}

/** Stage ops, correcting once if the reducer refuses any. */
/** Ops that sign somebody on: an officer appointed, an operative recruited. */
const RECRUITS = new Set(['recruit_commander', 'recruit_agent']);
/** What may ride with a recruitment: the roll's line, a narrative, a defiance charge. */
const WITH_A_RECRUIT = new Set(['log_narrative', 'adjust_dissent']);

/**
 * **Recruiting is an action of its own.** A declaration that signs somebody on
 * — an officer, an operative — does only that; anything else it carried is
 * dropped, and said. Sending the recruit is the next action, which is what
 * stops an operative raised this turn being placed and striking in one breath.
 *
 * Here rather than in the reducer, because it is a rule about the player's
 * turn and the action economy lives in the engine: an NPC reaction answers the
 * turn with no action points to spend, and may recruit and send together.
 * Applied to the correction batch as well, through `bind`, so a retry cannot
 * put back what this took out.
 */
export function recruitmentAlone(ops: unknown[]): { ops: unknown[]; notes: string[] } {
  const kind = (op: unknown) => (op as { op?: unknown } | null)?.op;
  if (!ops.some((op) => RECRUITS.has(kind(op) as string))) return { ops, notes: [] };
  const kept = ops.filter((op) => RECRUITS.has(kind(op) as string) || WITH_A_RECRUIT.has(kind(op) as string));
  if (kept.length === ops.length) return { ops, notes: [] };
  const dropped = [...new Set(ops.filter((op) => !kept.includes(op)).map((op) => String(kind(op))))];
  return {
    ops: kept,
    notes: [
      `Recruiting is an action of its own, so the rest of this order was not carried out (${dropped.join(', ')}). Declare it next.`,
    ],
  };
}

/**
 * **A raid's prizes are paid when it runs, not when it is ordered.** Raiding
 * pays through the ledger every turn the raid takes cargo, so a `create_asset`
 * beside the order that launches it is plunder from a raid that has not
 * happened — and would be paid twice once it did. Measured live: a dark raid
 * ordered at Sarsuma came with "14 crates cracked from Vigil-flagged haulers"
 * minted on the spot. The same rule the reducer keeps for battle spoils, which
 * are its own to create once the battle has been fought.
 */
export function noPrizeBeforeTheRaid(ops: unknown[]): { ops: unknown[]; notes: string[] } {
  const raids = ops.some((x) => (orderFor(x) as { type?: unknown } | null)?.type === 'commerce_raiding');
  if (!raids) return { ops, notes: [] };
  const kept = ops.filter((x) => (x as { op?: unknown } | null)?.op !== 'create_asset');
  if (kept.length === ops.length) return { ops, notes: [] };
  return {
    ops: kept,
    notes: ['No plunder was taken yet: a raid pays out of the lanes each turn it runs, starting next turn.'],
  };
}

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
  /**
   * The attribute the check tested. A fixture is built by the attribute it is
   * made of, so this is what decides whether a fixture may be founded at all —
   * see `fixtureBuilt`.
   */
  stat?: CheckResult['stat'],
  meta: StageMeta = {},
  /**
   * What the declaration's ruling lets a batch carry. The first batch was held
   * to it when it was resolved; a correction call writes a fresh one, which
   * must be held to the same ruling or it is a way around every filter on it.
   */
  bounds?: RulingBounds,
  /**
   * The lines to hold each batch to before it is staged: the acts a dry run
   * commits, against the sheets of these powers (`linesCrossed`). A red line of
   * a power in `refuse` stops the batch unstaged and is returned as `refused`;
   * every crossing is returned as `crossed`, for the caller to price.
   */
  lines?: LineCheck,
  /**
   * Ops the correction call may not touch, staged with every batch: an
   * accord's transfers, built from the record (`transfersFromRecord`). One of
   * them refused cannot be repaired by rewording, so the accord fails whole.
   */
  fixed: readonly unknown[] = [],
): Promise<{
  rejections: OpRejection[];
  notes: string[];
  costUsd: number;
  /** The red line that stopped the batch; nothing of it was staged. */
  refused?: LineHit;
  /** The lines the batch that landed crosses. */
  crossed: LineHit[];
}> {
  const actor = campaign.state.playerFactionId;
  // Run on an accord too, where there is no check at all: a conversation can
  // agree to many things and founding a fixture is not one of them, so passing
  // no band still has to strip a fixture rather than wave it through.
  const bind = (batch: unknown[]) => {
    const alone = recruitmentAlone(batch);
    const unrun = noPrizeBeforeTheRaid(alone.ops);
    const bound = boundPayloadsToOutcome(unrun.ops, outcome ?? 'success', stat);
    return { ops: bound.ops, notes: [...alone.notes, ...unrun.notes, ...bound.notes] };
  };

  // The writer, for `OP_PATHS`: the player's declaration, or the accord they closed.
  meta = { ...meta, path: meta.path ?? (source === 'extraction' ? 'accord' : 'declared') };
  // Held to the lines BEFORE staging: a batch a red line refuses is not a
  // smaller version of that batch, it is no batch.
  const holdTo = (batch: unknown[]): { hits: LineHit[]; refused?: LineHit } => {
    if (!lines) return { hits: [] };
    const hits = linesOf(campaign, batch, source, actor, meta.path, lines);
    return { hits, refused: hits.find((h) => h.kind === 'red_line' && lines.refuse.includes(h.act.actor)) };
  };
  const bound = bind([...ops, ...fixed]);
  const firstLines = holdTo(bound.ops);
  if (firstLines.refused) {
    return { rejections: [], notes: bound.notes, costUsd: 0, refused: firstLines.refused, crossed: firstLines.hits };
  }
  const first = campaign.stage(bound.ops, label, narrative, source, actor, meta);
  if (first.rejections.length === 0) {
    return { rejections: [], notes: [...bound.notes, ...first.notes], costUsd: 0, crossed: firstLines.hits };
  }

  // An accord lands whole or not at all (§2). A refused transfer from the
  // record cannot be reworded into legality, and a correction that drops a term
  // would land the rest without it — the 400 paid for a toll lift that was
  // refused (playtest 2026-10-18, C4). Either way the accord fails, said.
  const key = (o: unknown): string => JSON.stringify(o);
  const fixedKeys = new Set(fixed.map(key));
  const accordFails = (why: string) => ({
    rejections: first.rejections,
    notes: [...bound.notes, ...first.notes, why],
    costUsd: 0,
    crossed: [] as LineHit[],
  });
  if (first.rejections.some((r) => fixedKeys.has(key(r.op)))) {
    return accordFails('A term the record wrote could not be carried out, so nothing in the accord took effect.');
  }
  const attempted = bound.ops.filter((o) => !fixedKeys.has(key(o)));
  const revised = await reviseRejected(campaign, first.rejections, label, context, attempted, source);
  if (revised && source === 'extraction') {
    const count = (list: readonly unknown[]) =>
      list.reduce<Map<string, number>>((m, o) => {
        const k = String((o as { op?: unknown } | null)?.op);
        return m.set(k, (m.get(k) ?? 0) + 1);
      }, new Map());
    const before = count(attempted);
    const after = count(revised.ops);
    const lost = [...before].filter(([k, n]) => (after.get(k) ?? 0) < n).map(([k]) => k);
    if (lost.length > 0) {
      return accordFails(`A correction may fix a term, not drop one (${lost.join(', ')}), so nothing in the accord took effect.`);
    }
  }
  if (!revised) {
    return {
      rejections: first.rejections,
      notes: [...bound.notes, ...first.notes],
      costUsd: 0,
      crossed: [],
    };
  }

  const reheld = bounds ? holdToRuling(revised.ops, bounds) : { ops: revised.ops, notes: [] };
  const boundAgain = bind([...reheld.ops, ...fixed]);
  boundAgain.notes.unshift(...reheld.notes);
  const secondLines = holdTo(boundAgain.ops);
  if (secondLines.refused) {
    return {
      rejections: first.rejections,
      notes: [...bound.notes, ...first.notes, ...boundAgain.notes],
      costUsd: revised.costUsd,
      refused: secondLines.refused,
      crossed: secondLines.hits,
    };
  }
  const second = campaign.stage(boundAgain.ops, `${label}:correction`, '', source, actor, meta);

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
  // The story was told for the first batch, and some of what it describes was
  // refused. The correction says what changed; say it, so the narrative above
  // is not left claiming an effect that never landed.
  const amended = corrected && revised.narrative.trim() ? [`Correction: ${revised.narrative.trim()}`] : [];
  // And on the batch itself, which is what the turn's reactions are told. The
  // correction sat in the player's notes only, so the Vigil's reaction went on
  // about a listener crew that "has already gone over" when the suborning had
  // been refused (playtest 2026-10-18, D4).
  if (amended.length > 0) campaign.amendLastNarrative(amended[0]!);
  return {
    // First then second: the order they happened, and the first is the one that
    // explains why there was a correction at all.
    rejections: [...first.rejections, ...second.rejections],
    notes: [...bound.notes, ...firstNotes, ...amended, ...boundAgain.notes, ...second.notes],
    costUsd: revised.costUsd,
    crossed: corrected ? secondLines.hits : [],
  };
}

/**
 * Who a batch is held to the lines of, and how a crossing is answered
 * (`docs/design-2026-10-18-code-knows.md` §1).
 */
interface LineCheck {
  /** Powers whose red line refuses the batch. */
  refuse: readonly string[];
  /** Powers whose lines are priced rather than refusing it. */
  price: readonly string[];
  /** Acts read from the batch as a whole rather than from one op: an accord's. */
  extra?: (ops: unknown[]) => Act[];
}

/**
 * The lines a batch would cross, read off a dry run of it. The reducer reports
 * what each op did (`ApplyResult.acts`), so this is lookup: the arbiter read
 * the prose before the roll, and this reads the ops after it. A batch the
 * reducer would hold back commits nothing and crosses nothing.
 */
function linesOf(
  campaign: Campaign,
  ops: unknown[],
  source: 'model' | 'extraction',
  actor: string,
  path: StageMeta['path'],
  check: LineCheck,
): LineHit[] {
  const dry = applyOps(campaign.state, ops, source, actor, true, {}, path);
  const acts = dry.rejections.length > 0 ? [] : [...dry.acts, ...(check.extra?.(ops) ?? [])];
  return linesCrossed(campaign.state.factions, acts, [...check.refuse, ...check.price]);
}

/**
 * A reaction held to its own lines. A red line's op is held back, by the op
 * that crossed it, and the rest is read again; a compulsion lets the ops stand
 * and is returned to be charged. Read off a dry run that applies what it can,
 * so a reaction the reducer would otherwise refuse is still read.
 */
function reactionToLines(
  campaign: Campaign,
  factionId: string,
  ops: readonly unknown[],
): { ops: unknown[]; withheld: string[]; charged: LineHit | null } {
  let kept = [...ops];
  const withheld: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const dry = applyOps(campaign.state, kept, 'model', factionId, false, {}, 'reaction');
    const hits = linesCrossed(campaign.state.factions, dry.acts, [factionId]);
    const red = hits.filter((h) => h.kind === 'red_line' && h.act.opIndex >= 0);
    if (red.length === 0) return { ops: kept, withheld, charged: hits.find((h) => h.kind === 'compulsion') ?? null };
    const drop = new Set(red.map((h) => h.act.opIndex));
    withheld.push(...red.map((h) => `${ACT_WORDS[h.act.kind]}, against its own line`));
    kept = kept.filter((_, i) => !drop.has(i));
  }
  return { ops: kept, withheld, charged: null };
}

/**
 * A critical success's bonus, priced in code (`docs/design-2026-10-18-code-knows.md`
 * §4). Resolution names one; this decides what it does, on the engine's path:
 *
 * - `cost_avoided` — a quarter of what the declaration took out of the treasury;
 * - `tempo` — the first new order of the declaration's own drops a bucket, free;
 * - `goodwill` — `SWAY_BY_BAND.partial` from the power the batch named most;
 * - `windfall` — applied before staging, as one more of a ruled prize.
 *
 * It was "one concrete bonus that follows from it", and resolution chose the
 * ops — once an `interrupt_order` that sent a rival's fleet home (playtest
 * 2026-10-18, D3).
 */
export function applyBonus(
  campaign: Campaign,
  bonus: 'cost_avoided' | 'tempo' | 'goodwill' | 'windfall',
  creditsBefore: number,
  ordersBefore: ReadonlySet<string>,
  landed: readonly unknown[],
): string[] {
  const me = campaign.state.playerFactionId;
  const stage = (ops: unknown[], label: string) =>
    campaign.stage(ops, label, '', 'engine', undefined, { path: 'engine' });
  if (bonus === 'cost_avoided') {
    const spent = creditsBefore - (getFaction(campaign.state, me)?.credits ?? 0);
    const back = Math.floor(Math.max(0, spent) / 4);
    if (back <= 0) return [];
    stage([{ op: 'adjust_credits', factionId: me, delta: back }], 'a cost avoided');
    return [`A cost avoided: ${back} credits come back.`];
  }
  if (bonus === 'tempo') {
    const fresh = campaign.state.pendingOrders.find(
      (o) => o.factionId === me && !ordersBefore.has(o.id) && !isMovementType(o.type) && o.durationTurns > 1,
    );
    if (!fresh) return [];
    const cost = accelerationCost(fresh.durationTurns as FibScale);
    stage(
      [
        { op: 'accelerate_order', orderId: fresh.id, reason: 'ahead of time' },
        { op: 'adjust_credits', factionId: me, delta: cost },
      ],
      'ahead of time',
    );
    return [`Ahead of time: ${fresh.label} finishes a step sooner.`];
  }
  if (bonus === 'goodwill') {
    const named = new Map<string, number>();
    for (const raw of landed) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const ids = [o.factionId, o.to, o.whom, o.toFactionId, o.towardFactionId, o.fromFactionId];
      const sys = campaign.state.systems.find((x) => x.id === (o.targetId ?? o.systemId));
      ids.push(sys?.controllerFactionId);
      for (const id of ids) {
        if (typeof id === 'string' && id !== me && getFaction(campaign.state, id)) named.set(id, (named.get(id) ?? 0) + 1);
      }
    }
    const [who] = [...named].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    if (!who) return [];
    stage([{ op: 'adjust_disposition', factionId: who, towardFactionId: me, delta: SWAY_BY_BAND.partial }], 'goodwill');
    return [`Goodwill: ${getFaction(campaign.state, who)?.name ?? who} thinks better of you.`];
  }
  return [];
}

/**
 * Whether what landed differs from the story told for it: a rejection, an op
 * a ruling filter dropped, a trim or clamp, a correction (§5). Read off the
 * notes the engine and the reducer already write, so nothing new is tracked.
 */
const DIVERGED = /left out|^Trimmed |rather than|were not begun|could only pay|^Correction:|is not added|moved as far as|Nothing in this batch was applied|^Not enacted|nothing in the accord took effect|barracks are already full|lay down nothing/;

export function storyDiverged(notes: readonly string[], rejections: readonly unknown[]): boolean {
  if (rejections.length > 0) return true;
  return notes.some((n) => DIVERGED.test(n));
}

/**
 * The draft with what did not land said after it, for when no rewrite can be
 * had. A refused rewrite used to leave the draft alone — the one story known
 * to be wrong: "four hundred credits go into escrow" for a bounty that was
 * left out (playtest 2026-10-19, B3).
 */
export function draftWithCorrection(draft: string, notes: readonly string[], rejections: readonly { message?: string }[]): string {
  const said = [...notes.filter((n) => DIVERGED.test(n)), ...rejections.map((r) => r.message ?? '').filter(Boolean)];
  return said.length === 0 ? draft : `${draft}\n\nNot as told: ${said.join(' ')}`;
}

/** What a batch did, one line an op, for the reconcile pass to tell the truth from. */
export function describeLanded(ops: readonly unknown[]): string {
  return ops
    .filter((o) => (o as { op?: string } | null)?.op && (o as { op: string }).op !== 'log_check')
    .map((o) => {
      const { op, ...rest } = o as Record<string, unknown>;
      const fields = Object.entries(rest)
        .filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' ');
      return `- ${String(op)} ${fields}`.slice(0, 240);
    })
    .join('\n');
}

/**
 * Rewrite a declaration's or an accord's story to what landed, when the two
 * differ, onto the staged batch from `from` (§5). Returns the story to show,
 * and what it cost. A call or guard that fails leaves the draft.
 */
async function reconcileStory(
  campaign: Campaign,
  from: number,
  draft: string,
  notes: readonly string[],
  rejections: readonly unknown[],
  /** Orders that existed before this act, so the ones it began can be timed. */
  ordersBefore?: ReadonlySet<string>,
): Promise<{ narrative: string; costUsd: number; reconciled: boolean }> {
  // The story is written before the engine knows when anything lands. A
  // two-jump reinforcement "already in orbit", a ceiling that "rises" three
  // turns early, an open build that "will take time" (playtest 2026-10-19,
  // loop 2, L5). Whenever the act began work that runs over turns, the pass is
  // handed the timing and checks the tense.
  const timing = ordersBefore ? timingOf(campaign, ordersBefore) : [];
  const holders = holdersOf(campaign, draft);
  if (!draft.trim() || (!storyDiverged(notes, rejections) && timing.length === 0 && holders.length === 0)) {
    return { narrative: draft, costUsd: 0, reconciled: false };
  }
  const landed = [describeLanded(campaign.opsStagedSince(from)), ...timing, ...holders].filter(Boolean).join('\n');
  const out = await reconcileNarrative(draft, landed, notes).catch(() => null);
  if (!out?.narrative) {
    const base = draftWithCorrection(draft, notes, rejections as { message?: string }[]);
    const corrected = holders.length > 0 ? `${base}\n\nNot as told: ${holders.map((h) => h.replace(/^- HOLDER: /, '')).join(' ')}` : base;
    campaign.rewriteNarrative(from, corrected);
    return { narrative: corrected, costUsd: out?.costUsd ?? 0, reconciled: false };
  }
  campaign.rewriteNarrative(from, out.narrative);
  return { narrative: out.narrative, costUsd: out.costUsd, reconciled: true };
}

/**
 * Worlds the story says were taken that the power does not hold. A declaration
 * is written before any battle it starts is fought, and one told the player
 * "Sorel's dash on Threx lands home… Meridian colors go up" a turn after the
 * dash lost twelve hulls and the Vigil kept the world (loop 18). Read off the
 * sentences that name a world beside a word of taking it.
 */
const TAKEN = /\b(?:colou?rs? (?:go|goes|went) up|banners? (?:come|comes|came) down|falls?|fell|taken|takes|took|captured?|seized?|storm(?:s|ed)?|lands home|is ours|ours now|in (?:our|meridian) hands)\b/i;
function holdersOf(campaign: Campaign, draft: string): string[] {
  const me = campaign.state.playerFactionId;
  const out: string[] = [];
  for (const sentence of draft.split(/(?<=[.!?])\s+/)) {
    if (!TAKEN.test(sentence)) continue;
    for (const world of campaign.state.systems) {
      if (world.controllerFactionId === me || !sentence.includes(world.name)) continue;
      const holder = world.controllerFactionId ? (getFaction(campaign.state, world.controllerFactionId)?.name ?? world.controllerFactionId) : 'nobody';
      const line = `- HOLDER: ${world.name} is held by ${holder}, not by you; nothing in this act took it.`;
      if (!out.includes(line)) out.push(line);
    }
  }
  return out;
}

/** When each order the act began will land, said plainly for the reconcile pass. */
function timingOf(campaign: Campaign, ordersBefore: ReadonlySet<string>): string[] {
  const me = campaign.state.playerFactionId;
  return campaign.state.pendingOrders
    .filter((o) => o.factionId === me && !ordersBefore.has(o.id))
    .map((o) => {
      const left = o.durationTurns - o.progress;
      const where = campaign.state.systems.find((x) => x.id === o.targetId)?.name ?? o.targetId;
      return `- TIMING: "${o.label}" at ${where} has only begun; it ${isMovementType(o.type) ? 'arrives' : 'completes'} in ${left} turn${left === 1 ? '' : 's'}, not now.`;
    });
}

/** A crossing said as the institutions would say it. */
function lineReason(state: WorldState, hit: LineHit): string {
  const toward = hit.act.with.map((id) => getFaction(state, id)?.name ?? id);
  return `That would ${ACT_WORDS[hit.act.kind]}${toward.length > 0 ? ` — ${toward.join(' and ')}` : ''}, and this power does not.`;
}

/** Apply and journal ops immediately, correcting once. Used at end of turn. */
async function commitWithCorrection(
  campaign: Campaign,
  ops: unknown[],
  label: string,
  context: string,
  actor?: string,
  /** Covert work: its notes are written for the actor alone, correction included. */
  secret = false,
): Promise<{ rejections: OpRejection[]; notes: string[]; costUsd: number }> {
  // **A reaction has no check behind it**, so it cannot found a fixture. The rest
  // of an NPC's ops are unbounded on purpose — it is answering the turn, not
  // rolling for it — but a fixture is a thing a power sets out to build, and
  // nothing here is an undertaking. See `fixtureBuilt`.
  const bound = boundPayloadsToOutcome(ops, 'success', undefined);
  ops = bound.ops;
  const seal = (batch: unknown[]) => (secret ? markNotesPrivate(batch) : batch);
  // Only reactions come through here: an NPC answering the turn (`OP_PATHS`).
  const first = campaign.commit(seal(ops), 'model', label, actor, 'reaction');
  if (first.rejections.length === 0) {
    return { rejections: [], notes: [...bound.notes, ...first.notes], costUsd: 0 };
  }

  const revised = await reviseRejected(campaign, first.rejections, label, context, ops);
  if (!revised) {
    return { rejections: first.rejections, notes: [...bound.notes, ...first.notes], costUsd: 0 };
  }

  // The correction batch is filtered too: a retry that re-emitted the fixture
  // would otherwise be the hole, exactly as it is for an `onComplete` payload.
  const again = boundPayloadsToOutcome(revised.ops, 'success', undefined);
  const second = campaign.commit(seal(again.ops), 'model', `${label}:correction`, actor, 'reaction');
  return {
    rejections: second.rejections,
    notes: [...bound.notes, ...first.notes, ...again.notes, ...second.notes],
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
      { path: 'engine' },
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
  // An act with ops of its own and a negotiation beside it is the act, with a
  // note: "send two escorts to Var Hollow, and offer the Combine the note"
  // came back with the move written and the talks as a negotiation, and this
  // branch threw the move away under a story saying the escorts had arrived
  // (loop 14).
  const sideTalks = resolution.output.negotiation;
  const acted = resolution.output.ops.some((o) => (o as { op?: string }).op !== 'log_narrative');
  if (sideTalks && acted) {
    resolution.notes.push(
      `The rest needs ${sideTalks.withFactionIds.join(' and ')} to agree — open a channel: ${sideTalks.withFactionIds.map((id) => `/talk ${id}`).join(' · ')}.`,
    );
  }
  if (resolution.output.negotiation && !acted) {
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
      'model',
      campaign.state.playerFactionId,
      // The refusal IS the charge, so there is nothing inside to withdraw; and an
      // order your own institutions would not carry out is nobody else's news.
      // The engine's charge, not the declaration's: see `OP_PATHS`.
      { binding: 'refused', secret: true, path: 'engine' },
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

  let defiance = resolution.output.defiance ?? null;

  // The check is already in `resolution.output.ops` — `resolveAction` puts it at
  // the front, so the log reads roll-then-consequence. It used to be staged here
  // as well, and every roll reached the log, the prompts and the Log panel twice
  // (item 120).
  const ops = [...resolution.output.ops];

  // One act, one mechanism. A covert declaration BECOMES a deployment, so it is
  // charged by `AGENT_COST`, held to `maxAgentsFor`, resolved on the tick and
  // exposed on the same ladder as an operative placed the ordinary way. Without
  // this the declared route was simply cheaper than the mechanic it duplicates.
  // Covert parts are sent, never rolled with the declaration: even in an act
  // whose open half failed its check, the operatives set out.
  const routed = routeCovertAction(
    ops,
    'success',
    resolution.output.covert,
    campaign.state.playerFactionId,
    resolution.output.groundwork ?? [],
  );

  const inKind = noPaymentBesideAGift(routed.ops, campaign.state.debts);
  if (inKind.dropped) {
    routed.ops = inKind.ops;
    routed.notes.push('Goods handed to a creditor are a gift, not a payment: the cash paid beside them is left out. Settling a debt in goods needs the creditor to agree — open a channel.');
  }

  // Secret when the arbiter ruled it covert OR anything in it places an
  // operative. The ruling is the load-bearing half: a covert attempt that
  // FAILED places nobody, so it carries no `deploy_agent` to recognise it by,
  // and its narrative is exactly the thing that told the Vigil it had been
  // targeted.
  const secret =
    (resolution.output.covert?.length ?? 0) > 0 ||
    (resolution.output.groundwork?.length ?? 0) > 0 ||
    routed.ops.some(isCovertOp);

  const creditsBefore = getFaction(campaign.state, campaign.state.playerFactionId)?.credits ?? 0;
  const ordersBefore = new Set(campaign.state.pendingOrders.map((o) => o.id));
  const staged = await stageWithCorrection(
    campaign,
    routed.ops,
    action.length > 48 ? `${action.slice(0, 47)}…` : action,
    resolution.output.narrative,
    `The player declared: ${action}\n\nYour narrative was: ${resolution.output.narrative}`,
    resolution.check?.outcome,
    'model',
    resolution.check?.stat,
    // Covert work is sent, not rolled: nothing was thrown, but the operative is
    // under way and the action is spent, so it stands like a roll does.
    { binding: resolution.check ? 'rolled' : 'sent', secret },
    resolution.bounds,
    // The player's own lines, read off what the ops actually do. The arbiter
    // ruled on the words before the roll; this reads the acts after it, so
    // "sail on Kalzir" with `breaks: tre-0-3` meets "will not repudiate a
    // contract" as "repudiate the pact" did (playtest 2026-10-18, B4).
    { refuse: [campaign.state.playerFactionId], price: [] },
  );
  staged.notes.unshift(...resolution.notes, ...routed.notes);

  // Work on a world the power has nothing at, refused by the reducer and
  // nothing else in the act: there was nowhere to stand, so it was never an
  // attempt. Twice the counsellor urged fortifying unaligned Ithaal, the
  // arbiter rolled it, a critical success landed nothing and the action was
  // spent (loops 5 and 7) — the prompt rules did not hold, so code does.
  const nowhere = staged.rejections.find((r) => r.code === 'no_presence');
  const landed = campaign.opsStagedSince(before).filter((o) => !['log_narrative', 'spend'].includes((o as { op?: string }).op ?? ''));
  if (nowhere && landed.length === 0 && !staged.refused) {
    campaign.withdrawAttempt(before);
    const why = `Nothing of yours stands there to build on: ${nowhere.message}`;
    return {
      narrative: why,
      inadmissible: why,
      staged: 0,
      notes: ['No action spent: the work had nowhere to stand.'],
      rejections: staged.rejections,
      costUsd: resolution.costUsd + staged.costUsd,
      check: null,
      refusal: null,
      ops: [],
    };
  }

  // A red line the ops cross: refused as the arbiter's red line is — the action
  // spent, `REFUSAL_DISSENT` charged, nothing of the order staged.
  if (staged.refused) {
    const hit = staged.refused;
    const why = lineReason(campaign.state, hit);
    const by = 'your own institutions';
    campaign.stage(
      [
        { op: 'log_narrative', text: `[refused by ${by}] ${why}` },
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: REFUSAL_DISSENT,
          reason: hit.principle,
        },
      ],
      `refused: ${action.length > 40 ? `${action.slice(0, 39)}…` : action}`,
      resolution.output.narrative,
      'model',
      campaign.state.playerFactionId,
      { binding: 'refused', secret: true, path: 'engine' },
    );
    const dissent = getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0;
    return {
      narrative: why,
      refusal: { by, reason: why, violated: hit.principle },
      staged: campaign.stagedCount - before,
      notes: [
        `${by[0]!.toUpperCase()}${by.slice(1)} refused the order.`,
        `Breached: ${hit.principle}`,
        `Dissent ${dissent}/100 — every stat is now reduced by ${dissentPenalty(dissent)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
      ],
      rejections: [],
      costUsd: resolution.costUsd + staged.costUsd,
      check: resolution.check,
      ops: campaign.opsStagedSince(before),
    };
  }
  // A critical success's bonus, from the closed menu and applied here, where
  // the engine can see what the declaration spent and started (§4). The
  // windfall was applied to the batch before it was staged.
  if (resolution.check?.outcome === 'critical_success' && resolution.output.bonus) {
    staged.notes.push(...applyBonus(campaign, resolution.output.bonus, creditsBefore, ordersBefore, campaign.opsStagedSince(before)));
  }

  // A compulsion the ops cross is priced as the arbiter's is, once: the
  // arbiter's own ruling stands when it named one.
  const defied = staged.crossed.find((h) => h.kind === 'compulsion');
  if (!defiance && defied) {
    defiance = { by: 'your own institutions', reason: lineReason(campaign.state, defied), violated: defied.principle };
  }

  // Charged in code, not chosen by the model: the resolution call says a
  // compulsion was defied, and the price for that is not its to nominate. Its
  // own batch on the engine's path, so the order and its price are told apart —
  // a declaration may not write `adjust_dissent`, and the engine's charge is
  // not the declaration's. It stands whatever became of the order: the price
  // lands on the attempt.
  if (defiance) {
    campaign.stage(
      [
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: COMPULSION_BREACH_DISSENT,
          reason: defiance.violated || defiance.reason,
        },
        { op: 'log_narrative', text: `[objected to by ${defiance.by}] ${defiance.reason}` },
      ],
      `objection: ${action.length > 40 ? `${action.slice(0, 39)}…` : action}`,
      '',
      'model',
      campaign.state.playerFactionId,
      { binding: 'charge', secret, path: 'engine' },
    );
  }

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

  // The story, rewritten to what landed when the two differ (§5). The notes
  // still say what changed; the story stops claiming it did not.
  const story = await reconcileStory(
    campaign,
    before,
    resolution.output.narrative,
    [...resolution.notes, ...staged.notes],
    staged.rejections,
    ordersBefore,
  );

  return {
    narrative: story.narrative,
    staged: campaign.stagedCount - before,
    notes: story.reconciled ? staged.notes.filter((n) => !n.startsWith('Correction: ')) : staged.notes,
    rejections: staged.rejections,
    costUsd: resolution.costUsd + staged.costUsd + story.costUsd,
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
export async function endTurn(
  campaign: Campaign,
  /** Called as each power's answer lands, so the client need not wait for all three. */
  onReaction?: (view: ReactionView) => void,
): Promise<TurnOutcome> {
  const notes: string[] = [];
  const rejections: OpRejection[] = [];
  let costUsd = 0;
  // Where this turn's log begins, so its private lines can be kept out of the
  // notes the player is handed — see the filter at the end.
  const logFrom = campaign.state.eventLog.length;
  const player = campaign.state.playerFactionId;

  // Capture what was declared before committing clears the staging area.
  const brief = campaign.reactionBrief();
  const declared = brief.summary;
  const stagedOps = brief.ops;

  // Each step of the turn is a span (see `src/model/telemetry.ts`), so a slow
  // end-of-turn reads as commit, reactions, bots and tick rather than one bar.
  // The turn is the one being ended — read before `tick` advances it.
  const turn = campaign.state.turn;
  const committed = await span('commit', { turn }, () => campaign.commitTurn());
  notes.push(...committed.notes);

  // NPCs react once, to the world as it now stands.
  const reactionViews: ReactionView[] = [];
  if (committed.applied > 0) await span('reactions', { turn }, async () => {
    const touched = touchedBy(campaign.state, stagedOps);
    // Only the powers the turn involved, three at most, so a power the player
    // never touched is always left to its doctrine.
    //
    // Selection used to fill every seat from the whole board, and in a live
    // campaign that made nearly every faction a responder nearly every turn —
    // so `proposeFor` fell through for almost nobody and doctrine initiative
    // fired exactly when it was least needed. Measured: 2 NPC-vs-NPC attacks
    // over 12 turns with no player at all, and **zero** over a 10-turn
    // campaign with one. The seat a power with no stake no longer takes costs
    // no tokens: its doctrine acts for it, which is free.
    const responders = involvedFactions(
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
          // Everything the player did may have been secret. Saying "acted this
          // turn:" over an empty list would itself tell the Rim that something
          // happened out of sight.
          declared
            ? `${campaign.state.playerFactionId} acted this turn:\n\n${declared}`
            : `${campaign.state.playerFactionId} did nothing this turn that you could see.`,
        );
        costUsd += reactions.costUsd;

        for (const reaction of reactions.output.reactions) {
          const faction = getFaction(campaign.state, reaction.factionId);
          if (!faction) continue;
          // A reaction that places an operative is the NPC mirror of a secret
          // declaration. Its ops land and its notes are written for it alone —
          // and the player hears NOTHING from it this turn: not the narrative,
          // not the reducer's notes, not its rejections. Measured in a live save:
          // Drajk's reaction told the player it had "inserted a theft operative
          // into Vigil-held Vantic".
          //
          // Silence is a small tell, and the cheaper one: a power that says
          // nothing is indistinguishable from a power that was not asked, which
          // is every power the turn did not reach. The alternative is a
          // prompt rule asking the model not to mention it, which is exactly the
          // guard a model can be talked past.
          const secret = reaction.ops.some(isCovertOp);
          // A reaction honours its own paper, as a bot does: an attack,
          // blockade or raid on a power it is bound to is held back unless the
          // order names that power in `breaks`. Before this a reaction broke a
          // pact as easily as it attacked anyone, and only the prompt stood in
          // the way (`docs/design-2026-10-17-intent-ops.md` §7).
          const honoured = honourTreaties(
            campaign.state,
            reaction.factionId,
            reaction.ops as Record<string, unknown>[],
          );
          // And its own lines, read off what the ops do: a red line's op is held
          // back like a broken pact's, and a compulsion is charged as the
          // player's is (`docs/design-2026-10-18-code-knows.md` §1).
          const lined = reactionToLines(campaign, reaction.factionId, honoured.ops);
          const held = [...honoured.withheld, ...lined.withheld].map((w) => `${faction.name} holds back ${w}.`);
          const applied = await commitWithCorrection(
            campaign,
            lined.ops,
            `reaction:${reaction.factionId}`,
            `${faction.name} reacted: ${reaction.narrative}`,
            // The reacting faction is the actor, so an NPC is held to the same
            // presence and guile limits the player is when it suborns a crew.
            reaction.factionId,
            secret,
          );
          costUsd += applied.costUsd;
          if (lined.charged && applied.rejections.length === 0) {
            campaign.commit(
              [
                {
                  op: 'adjust_dissent',
                  factionId: reaction.factionId,
                  delta: COMPULSION_BREACH_DISSENT,
                  reason: lined.charged.principle,
                },
              ],
              'engine',
              `${reaction.factionId} acts against its own line`,
              undefined,
              'engine',
            );
          }
          if (secret) continue;
          notes.push(...held, ...applied.notes);
          rejections.push(...applied.rejections);
          const heldBack =
            (applied.rejections.length > 0 ? applied.rejections.length : 0) + honoured.withheld.length + lined.withheld.length;
          const view: ReactionView = {
            factionId: faction.id,
            factionName: faction.name,
            color: faction.displayColor,
            narrative: reaction.narrative,
            ops: applied.rejections.length > 0 ? [] : lined.ops,
            heldBack: heldBack > 0 ? heldBack : null,
            // An invitation to talk, if this power wants something. Passed
            // through rather than acted on: the player opens the channel.
            approach: reaction.approach ?? null,
          };
          reactionViews.push(view);
          // Handed over as it lands. The reactions are generated one power at a
          // time, so the last of them is the only one that has to wait for all
          // three — and until this existed, so did the first two.
          onReaction?.(view);
        }
      } catch (err) {
        notes.push(
          `NPC reaction call failed: ${err instanceof Error ? err.message : String(err)}. The turn stands; nobody responded.`,
        );
      }
    }
  });

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
  await span('bots', { turn }, () => {
    for (const faction of campaign.state.factions) {
      if (spokenFor.has(faction.id)) continue;
      // Committed atomically below, so a rule that would sink the batch is
      // left out rather than costing the power its turn.
      const proposal = proposeFor(
        campaign.state,
        faction.id,
        (ops) => applyOps(campaign.state, ops, 'model', faction.id, true).rejections.length === 0,
        (ops) => applyOps(campaign.state, ops, 'model', faction.id, false, {}, 'bot').acts,
      );
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

      // A bot's notes and rejections are its own business — where its
      // operatives are going, what its yards were refused — and the end-turn
      // response is printed in the player's feed. What the galaxy may know of
      // the move is in the log, scoped like everything else there (playtest
      // 2026-10-16: every rival's spy postings reached the player this way).
      campaign.commit(batch, 'model', `initiative:${faction.id}`, faction.id, 'bot');
    }

    // And what two NPC powers agree between themselves — an exchange of goods,
    // a peace in a war gone quiet. Engine batches with no actor: the rule read
    // both parties, so neither one's guard speaks for the pair.
    for (const accord of brokeredAccords(campaign.state)) {
      // Not one that crosses either party's own line: neither side's doctrine
      // signs what its sheet forbids (`honourLines`).
      const dry = applyOps(campaign.state, accord.ops, 'engine', undefined, false, {}, 'engine');
      if (linesCrossed(campaign.state.factions, dry.acts, campaign.state.factions.map((f) => f.id)).length > 0) continue;
      campaign.commit(accord.ops, 'engine', accord.label, undefined, 'engine');
    }
  });

  // Time passes last, so orders started this turn do not immediately progress.
  const ticked = await span('tick', { turn }, () => campaign.tick());
  notes.push(...ticked.notes);

  // A note the log scoped away from the player is not the player's to read
  // either: the tick writes every power's private lines (an estate losing a
  // seat, an operative's report) as notes and as log entries visible to that
  // power alone, and the notes are printed in the player's feed.
  const hidden = new Set(
    campaign.state.eventLog
      .slice(logFrom)
      .filter((e) => e.visibleTo && !e.visibleTo.includes(player))
      .map((e) => e.text),
  );

  return {
    applied: committed.applied,
    reactions: reactionViews,
    notes: notes.filter((n) => !hidden.has(n)),
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
  const favoursGiven = new Set(theirs.flatMap((c) => c.obligations));
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
      // The raider's ledger binds both sides of a contract: protection binds
      // the party that stops raiding, and a letter of marque binds the raider
      // to spare its paymaster and the paymaster to pay the bonus. Either way
      // the other power has to have said something.
      const protects = Array.isArray(terms.protection) ? (terms.protection as string[]) : [];
      if ((protects.some((id) => id !== otherId) || terms.commission) && !saidAnything) {
        dropped.push(`${terms.commission ? 'a letter of marque' : 'protection'} binding ${otherId}, which it never agreed to.`);
        return false;
      }
      const pledged = (terms.shipsPledged ?? {}) as Record<string, number>;
      if ((pledged[otherId] ?? 0) > offeredHulls) {
        dropped.push(`${pledged[otherId]} hulls pledged by ${otherId}, which it never offered.`);
        return false;
      }
      // A thing written into the paper is held to exactly the standard a world
      // is, and by the same argument: it comes out of that power's hands, so
      // that power has to have put it on the table. Restated here rather than
      // shared with the `transfer_asset` branch below because the check runs on
      // a TERM inside a treaty rather than on a standalone op, and dropping the
      // treaty is the remedy — a sale with an ungranted half is not a smaller
      // sale, it is somebody else's property written into a contract.
      const assetTerms = Array.isArray(terms.assets)
        ? (terms.assets as { assetId?: unknown }[])
        : [];
      const takenFromThem = assetTerms
        .map((t) => (typeof t?.assetId === 'string' ? t.assetId : null))
        .filter((id): id is string => id !== null)
        .filter((id) => (state.assets ?? []).find((a) => a.id === id)?.heldBy === otherId);
      const unoffered = takenFromThem.filter((id) => !handedOver.has(id));
      if (unoffered.length > 0) {
        dropped.push(
          `${unoffered.join(', ')} — ${otherId} never put ${unoffered.length === 1 ? 'it' : 'them'} on the table.`,
        );
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

    // A favour the other party holds is theirs to let go of or to sell, and it
    // is a record — "forget what you owe us" names no id — so it is held to the
    // standard an asset is: that power put this one on the table.
    if ((op.op === 'release_obligation' || op.op === 'assign_obligation') && typeof op.obligationId === 'string') {
      const owed = (state.obligations ?? []).find((o) => o.id === op.obligationId);
      if (owed && owed.holderFactionId === otherId && !favoursGiven.has(owed.id)) {
        dropped.push(`the favour ${owed.debtorFactionId} owes ${otherId} — ${otherId} never put it on the table.`);
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
    if (
      ((op.op === 'adjust_credits' && Number(op.delta ?? 0) < 0) || op.op === 'pay') &&
      op.factionId === otherId &&
      !saidAnything
    ) {
      dropped.push(`credits out of ${otherId}'s treasury, which it never agreed to pay.`);
      return false;
    }
    // A favour owed binds the power that owes it, and giving way to a demand
    // binds the power giving way — both need it to have said something.
    if (op.op === 'establish_obligation' && op.debtorFactionId === otherId && !saidAnything) {
      dropped.push(`a favour owed by ${otherId}, which it never agreed to owe.`);
      return false;
    }
    if (op.op === 'concede_ultimatum' && !saidAnything) {
      const demand = (state.demands ?? []).find((d) => d.id === op.demandId);
      if (demand?.toFactionId === otherId) {
        dropped.push(`${otherId} giving way to the ultimatum, which it never agreed to.`);
        return false;
      }
    }
    // A toll is lifted by the power that charges it. In an accord that may be
    // the other party, which the reducer now allows (playtest 2026-10-18, C4) —
    // so it needs that power to have said something, and a third power's
    // customs are nobody's at this table to open.
    if (op.op === 'set_toll_policy' && op.factionId !== state.playerFactionId) {
      if (op.factionId !== otherId) {
        dropped.push(`${String(op.factionId)}'s tolls, which are not ${otherId}'s to lift.`);
        return false;
      }
      if (!saidAnything) {
        dropped.push(`${otherId} lifting its toll, which it never agreed to.`);
        return false;
      }
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

/**
 * Every transfer an accord's agreed concessions name, built by the engine from
 * the record each power wrote as it spoke (`docs/design-2026-10-18-code-knows.md`
 * §3). Extraction re-read these from the transcript and wrote them again, and
 * could write them wrong: a conceded crate dropped, an existing set of drawings
 * minted afresh (playtest 2026-10-18, C7, C8). The ids were settled when each
 * power wrote its concession; building from them is lookup.
 *
 * A world ceded is a `cession` treaty, and what the other side gives for it —
 * its credits as `terms.payment`, its things as `terms.assets` — rides on the
 * same treaty, so the cession looks like the bargain it is. Everything else is
 * one op per transfer: `pay`, `transfer_asset`, `release_obligation` or
 * `assign_obligation`, and `set_toll_policy` for a toll lifted. A flow and
 * hulls are not built: each needs a shape (tribute or contract, loan or
 * pledge), which is extraction's to judge.
 */
export function transfersFromRecord(
  state: WorldState,
  agreed: readonly Concession[],
  player: string,
  other: string,
): { ops: Record<string, unknown>[]; notes: string[] } {
  const ops: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const otherOf = (by: string): string => (by === player ? other : player);
  const sum = (by: string, f: (c: Concession) => number) =>
    agreed.filter((c) => c.by === by).reduce((n, c) => n + f(c), 0);
  const credits = new Map([player, other].map((p) => [p, sum(p, (c) => c.credits)] as [string, number]));
  const assetsOf = (by: string) => [...new Set(agreed.filter((c) => c.by === by).flatMap((c) => c.assets))];
  const assetsGiven = new Map([player, other].map((p) => [p, assetsOf(p)] as [string, string[]]));

  for (const ceder of [player, other]) {
    // Only worlds the ceder holds: a world named that it does not hold is not
    // its to hand over, whatever the record says (playtest 2026-10-19, loop 3).
    const systems = [...new Set(agreed.filter((c) => c.by === ceder).flatMap((c) => c.systems))].filter(
      (id) => state.systems.find((x) => x.id === id)?.controllerFactionId === ceder,
    );
    if (systems.length === 0) continue;
    const buyer = otherOf(ceder);
    const price = credits.get(buyer) ?? 0;
    const goods = assetsGiven.get(buyer) ?? [];
    ops.push({
      op: 'form_treaty',
      treatyType: 'cession',
      parties: [ceder, buyer],
      terms: {
        territory: systems,
        ...(price > 0 ? { payment: { [buyer]: -price, [ceder]: price } } : {}),
        ...(goods.length > 0 ? { assets: goods.map((assetId) => ({ assetId, toFactionId: ceder })) } : {}),
      },
      summary: `${systems.map((id) => state.systems.find((x) => x.id === id)?.name ?? id).join(', ')} ceded to ${getFaction(state, buyer)?.name ?? buyer}`,
    });
    credits.set(buyer, 0);
    assetsGiven.set(buyer, []);
  }
  for (const [by, amount] of credits) {
    if (amount > 0) ops.push({ op: 'pay', factionId: by, to: otherOf(by), amount, for: 'the terms agreed' });
  }
  for (const [by, ids] of assetsGiven) {
    for (const assetId of ids) ops.push({ op: 'transfer_asset', assetId, toFactionId: otherOf(by), reason: '(under the terms agreed)' });
  }
  for (const c of agreed) {
    const to = otherOf(c.by);
    for (const id of c.obligations) {
      const owed = (state.obligations ?? []).find((o) => o.id === id);
      if (!owed) {
        notes.push(`No favour "${id}" to give up; ${c.text}`);
        continue;
      }
      ops.push(
        owed.debtorFactionId === to
          ? { op: 'release_obligation', obligationId: id, reason: c.text.slice(0, 240) }
          : { op: 'assign_obligation', obligationId: id, toHolderFactionId: to, reason: c.text.slice(0, 240) },
      );
    }
  }
  for (const by of [player, other]) {
    const lifting = agreed.filter((c) => c.by === by && c.lifts.length > 0);
    if (lifting.length === 0) continue;
    const lifts = new Set(lifting.flatMap((c) => c.lifts));
    const term = lifting.map((c) => c.liftTurns).find((t) => t !== undefined);
    const charging = getFaction(state, by)?.tollTargets ?? [];
    ops.push({
      op: 'set_toll_policy',
      factionId: by,
      targets: charging.filter((id) => !lifts.has(id)),
      ...(term !== undefined ? { forTurns: term } : {}),
    });
  }
  return { ops, notes };
}

/** The ops the record writes, which extraction no longer may (§3). */
const RECORD_OPS = new Set(['pay', 'adjust_credits', 'transfer_asset', 'release_obligation', 'assign_obligation', 'set_toll_policy']);

/**
 * Extraction's ops with every transfer the record now writes taken out: those
 * ops, a cession, and the territory, payment and things on any other treaty. A
 * contract left with no flow, protection or commission was a sale written as a
 * treaty, and goes too. Said, so a dropped term is never silent.
 */
export function withoutRecordTransfers(ops: readonly unknown[]): { ops: unknown[]; dropped: string[] } {
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const raw of ops) {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!o) {
      kept.push(raw);
      continue;
    }
    if (RECORD_OPS.has(String(o.op))) {
      dropped.push(String(o.op));
      continue;
    }
    if (o.op === 'form_treaty') {
      if (o.treatyType === 'cession') {
        dropped.push('a cession');
        continue;
      }
      const { territory: _t, payment: _p, assets: _a, ...rest } = (o.terms ?? {}) as Record<string, unknown>;
      const flows = rest.incomePerTurn && Object.keys(rest.incomePerTurn as object).length > 0;
      if (o.treatyType === 'contract' && !flows && !rest.protection && !rest.commission) {
        dropped.push('a sale written as a contract');
        continue;
      }
      kept.push(rest === o.terms ? o : { ...o, terms: rest });
      continue;
    }
    kept.push(raw);
  }
  return { ops: kept, dropped };
}

/**
 * What an accord does that no single op shows: one side taking money for a
 * peace, or one side giving and the other giving nothing. Read from the whole
 * batch and the concession record, for the lines that name them — the Vigil's
 * "will not accept payment to stand down" and the Combine's "nothing given
 * away for nothing".
 *
 * A treaty binding a party counts as that party giving: a pact is a promise
 * each side makes. So "for nothing" means no treaty, nothing paid or handed
 * over, and nothing recorded — a gift or a waiver, which is what the line is
 * about, and never a deal on any terms (playtest 2026-10-18, C3).
 */
export function accordActs(
  state: WorldState,
  ops: readonly unknown[],
  conceded: readonly Concession[],
  player: string,
  other: string,
): Act[] {
  const list = ops.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object');
  const treaties = list.filter((o) => o.op === 'form_treaty' && Array.isArray(o.parties));
  const terms = (o: Record<string, unknown>) => (o.terms ?? {}) as Record<string, Record<string, number> | string[] | undefined>;
  const paidTo = (to: string, from: string): boolean =>
    list.some(
      (o) =>
        ((o.op === 'pay' || o.op === 'gift') && o.factionId === from && o.to === to && Number(o.amount ?? 0) > 0) ||
        (o.op === 'adjust_credits' && o.factionId === to && Number(o.delta ?? 0) > 0),
    ) ||
    treaties.some((t) => {
      const payment = (terms(t).payment ?? {}) as Record<string, number>;
      const flow = (terms(t).incomePerTurn ?? {}) as Record<string, number>;
      return (payment[to] ?? 0) > 0 || (flow[to] ?? 0) > 0;
    });
  const gave = (who: string, to: string): boolean =>
    conceded.some((c) => c.by === who) ||
    paidTo(to, who) ||
    treaties.some((t) => (t.parties as string[]).includes(who)) ||
    list.some(
      (o) =>
        (o.op === 'transfer_asset' &&
          o.toFactionId === to &&
          (state.assets ?? []).some((a) => a.id === o.assetId && a.heldBy === who)) ||
        (o.op === 'set_toll_policy' && o.factionId === who) ||
        ((o.op === 'release_obligation' || o.op === 'assign_obligation') &&
          (state.obligations ?? []).some((b) => b.id === o.obligationId && b.holderFactionId === who)) ||
        (o.op === 'forgive_debt' && (state.debts ?? []).some((d) => d.id === o.debtId && d.creditorFactionId === who)),
    );
  const acts: Act[] = [];
  for (const [x, y] of [[player, other], [other, player]] as [string, string][]) {
    const peace = treaties.some(
      (t) =>
        (PEACE_TREATIES as readonly string[]).includes(String(t.treatyType)) &&
        (t.parties as string[]).includes(x) &&
        (t.parties as string[]).includes(y),
    );
    if (peace && paidTo(x, y)) acts.push({ kind: 'paid_for_peace', actor: x, with: [y], opIndex: -1 });
    if (gave(x, y) && !gave(y, x)) acts.push({ kind: 'given_for_nothing', actor: x, with: [y], opIndex: -1 });
  }
  return acts;
}

/**
 * An op whose batch is the actor's business alone: placing an operative, or a
 * raid run dark. Either one in a declaration or a reaction keeps the whole
 * batch's notes and narrative from everybody else — a dark raid announced in
 * the narrative that launched it would not be dark.
 */
function isCovertOp(raw: unknown): boolean {
  const op = raw as { op?: unknown; dark?: unknown } | null;
  return op?.op === 'deploy_agent' || op?.op === 'lay_groundwork' || (orderFor(op) as { dark?: unknown } | null)?.dark === true;
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
  const extraction = await extractAgreements(campaign.state, factionId, history, conceded);

  // The record is the deal (§3). Extraction judged which terms were agreed;
  // the transfers they name are built from the ids each power wrote down, and
  // any extraction wrote itself are left out, said.
  const player = campaign.state.playerFactionId;
  const accepted = new Set(extraction.output.accepted);
  const agreed = conceded.filter((c) => accepted.has(`${c.by}:${c.kind}`));
  const unknownTerms = [...accepted].filter((k) => !conceded.some((c) => `${c.by}:${c.kind}` === k));
  const built = transfersFromRecord(campaign.state, agreed, player, factionId);
  const stripped = withoutRecordTransfers(extraction.output.ops);
  const recordNotes = [
    ...built.notes,
    ...unknownTerms.map((k) => `"${k}" is not on the record, so nothing was built for it.`),
    ...(stripped.dropped.length > 0
      ? [`The record writes the transfers; left out of the extraction: ${[...new Set(stripped.dropped)].join(', ')}.`]
      : []),
  ];
  const proposed = [...stripped.ops, ...built.ops];

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
  //
  // An appraisal that CANNOT BE OBTAINED must not delete the accord it guards.
  // Measured live: this call exhausted its three attempts on a malformed
  // arbiter response ("expected object, received string"), the error propagated
  // out of `closeChannel`, and `/endtalk` answered 502 — with `endTalk` having
  // already cleared the channel, the history and the concessions before
  // awaiting this. A completed negotiation was destroyed by a model glitch that
  // had nothing to do with it: no ops, no transcript, no channel to retry.
  //
  // Failing open here is safe in a way it would not be as the only guard,
  // because it is not the only guard. `sendMessage` appraises every one of the
  // player's own concessions as it is made, and the `blockers` that pass
  // produces are checked below and refuse the whole accord. What is lost is a
  // ruling on the accord AS A WHOLE, and that is said out loud rather than
  // quietly skipped — the same shape as `fallbackEpilogue` carrying
  // `fallback: true` rather than pretending it wrote the ending.
  const unappraised: string[] = [];
  const ruling =
    proposed.length > 0
      ? await appraiseAgreement(campaign.state, factionId, extraction.output.narrative).catch(
          (err: unknown) => {
            unappraised.push(
              `Your institutions could not be reached for a ruling on this accord (${err instanceof Error ? err.message : String(err)}). It stands as agreed; anything flagged during the conversation still applies.`,
            );
            return null;
          },
        )
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
      { path: 'engine' },
    );
  }

  // A red line refuses the WHOLE agreement. A deal that requires you to cross
  // it is not a smaller deal, it is no deal — the same rule `submitAction`
  // applies to an order the fleet will not carry out. The other party's
  // concessions go with it, because there is nothing left to concede to.
  // A red line refuses the whole accord, whether the arbiter read it in the
  // transcript or the engine reads it in the ops (below).
  const refuseAccord = (by: string, why: string, principle: string, cost: number): ActionOutcome => {
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
    campaign.stage(
      [
        { op: 'log_narrative', text: `[refused by ${by}] ${why}` },
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: REFUSAL_DISSENT,
          reason: principle,
        },
      ],
      `refused accord with ${faction?.name ?? factionId}`,
      why,
      'model',
      campaign.state.playerFactionId,
      { binding: 'refused', secret: true, path: 'engine' },
    );
    const dissent = getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0;
    return {
      narrative: why,
      refusal: { by, reason: why, violated: principle },
      staged: campaign.stagedCount - before,
      notes: [
        `${by} will not ratify the accord with ${faction?.name ?? factionId}.`,
        `Breached: ${principle}`,
        `Dissent ${dissent}/100 — every stat is now reduced by ${dissentPenalty(dissent)}, to a maximum of ${MAX_DISSENT_PENALTY}.`,
      ],
      rejections: [],
      costUsd: extraction.costUsd + rulingCost + cost,
      ops: campaign.opsStagedSince(before),
    };
  };

  if (breach?.kind === 'red_line') {
    return refuseAccord(
      ruling?.appraisal.breach?.by ?? 'your own institutions',
      ruling?.appraisal.breach?.reason || 'That is not something this power will put its name to.',
      breach.principle,
      0,
    );
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
  const grounded = groundInConcessions(campaign.state, stripped.ops, conceded, factionId);

  // One group for the accord and everything that goes with it if the player
  // withdraws it before the turn lands.
  const accordAt = campaign.stagedCount;
  const group = `accord:${factionId}:${accordAt}`;
  const stateBefore = campaign.state;
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
    undefined,
    { group, accordWith: factionId },
    undefined,
    // Both parties' lines, read off what the accord's ops do and what the
    // record says each side gave: the player's red line refuses it, the other
    // power's is priced below.
    {
      refuse: [campaign.state.playerFactionId],
      price: [factionId],
      extra: (batch) => accordActs(stateBefore, batch, agreed, campaign.state.playerFactionId, factionId),
    },
    built.ops,
  );
  staged.notes.unshift(...recordNotes);
  if (staged.refused) {
    return refuseAccord('your own institutions', lineReason(stateBefore, staged.refused), staged.refused.principle, staged.costUsd);
  }

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
  // **Only once the accord has landed**, and only when the other power actually
  // conceded something. It was staged before the player's own refusal was
  // ruled, so an accord the player's side refused still charged the other
  // power 20 for signing it (playtest 2026-10-18, C2). **Held to the relevance
  // check** the player's own breach gets, since unrelated lines were quoted
  // against ordinary paid deals (C3). And **withdrawn with the accord**: it was
  // an engine record that outlived the accord it priced, so withdrawing and
  // re-signing charged it twice (C1). Ruled on the board as it stood before
  // the accord, which is what the other power signed against.
  let counterpartyCost = 0;
  const counterpartyNotes: string[] = [];
  // What the other power agreed to give, not every term it put on the table.
  const theirs = agreed.filter((c) => c.by === factionId);
  const landed = campaign.opsStagedSince(accordAt).length > 0;
  // A line of theirs the accord's ops cross, which no reading can miss.
  const theirLine = landed ? staged.crossed.find((h) => h.act.actor === factionId) : undefined;
  if (landed && (theirs.length > 0 || theirLine)) {
    const other = getFaction(stateBefore, factionId);
    const theirText = theirs.map((c) => c.text).join(' ');
    let theirBreach: { kind: 'red_line' | 'compulsion'; principle: string } | null = null;
    if (theirs.length > 0) {
      // Same reason as above: a ruling on the OTHER power's concessions that
      // cannot be obtained is a ruling that did not happen, not grounds to throw
      // away a negotiation both sides completed.
      const theirRuling = await appraiseAgreement(stateBefore, stateBefore.playerFactionId, theirText, factionId).catch(
        () => null,
      );
      counterpartyCost = theirRuling?.costUsd ?? 0;
      const theirNamed = theirRuling?.appraisal.breach?.principles ?? [];
      theirBreach = other && theirNamed.length > 0 ? classifyPrinciples(other, theirNamed) : null;
      if (theirBreach?.kind === 'compulsion' && breachContradictsState(stateBefore, factionId, theirBreach.principle)) {
        theirBreach = null;
      } else if (theirBreach) {
        const check = await verifyBreachRelevance(theirText, theirBreach.principle, theirBreach.kind);
        counterpartyCost += check.costUsd;
        if (!check.relevant) theirBreach = null;
      }
    }
    // Charged once, at the dearer of what was read and what was done.
    if (theirLine && (!theirBreach || (theirLine.kind === 'red_line' && theirBreach.kind === 'compulsion'))) {
      theirBreach = { kind: theirLine.kind, principle: theirLine.principle };
    }
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
        { path: 'engine', binding: 'attached', group },
      );
      const said = `${other?.name ?? factionId} signs anyway, against its own standing: "${theirBreach.principle}". Its institutions will remember.`;
      counterpartyNotes.push(said);
    }
  }

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
    // Whether the accord LANDED, not whether a first attempt was refused: a
    // correction that landed used to be recorded as "nothing took effect".
    !landed && proposed.length > 0
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

  const notes = [...staged.notes, ...counterpartyNotes, ...unappraised];
  let defiance: ActionOutcome['defiance'] = null;
  // The player's own compulsion, as the arbiter read it, or as the ops show it
  // when the arbiter named none. Charged once.
  const myLine =
    landed && breach?.kind !== 'compulsion'
      ? staged.crossed.find((h) => h.act.actor === campaign.state.playerFactionId && h.kind === 'compulsion')
      : undefined;
  const objection =
    breach?.kind === 'compulsion'
      ? {
          by: ruling?.appraisal.breach?.by ?? 'your own institutions',
          reason: ruling?.appraisal.breach?.reason || 'It was agreed over their objection.',
          principle: breach.principle,
        }
      : myLine
        ? { by: 'your own institutions', reason: lineReason(stateBefore, myLine), principle: myLine.principle }
        : null;
  if (objection) {
    const by = objection.by;
    defiance = {
      by,
      reason: objection.reason,
      violated: objection.principle,
    };
    campaign.stage(
      [
        {
          op: 'adjust_dissent',
          factionId: campaign.state.playerFactionId,
          delta: COMPULSION_BREACH_DISSENT,
          reason: objection.principle,
        },
        { op: 'log_narrative', text: `[objected to by ${by}] ${defiance.reason}` },
      ],
      `objection to the accord with ${faction?.name ?? factionId}`,
      '',
      'model',
      campaign.state.playerFactionId,
      // Charged for proposing it, so it stays even if the accord is withdrawn.
      { binding: 'charge', path: 'engine' },
    );
    const dissent = getFaction(campaign.state, campaign.state.playerFactionId)?.dissent ?? 0;
    notes.push(
      `${by} objected to the accord and it stands anyway.`,
      `Defied: ${objection.principle}`,
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

  // The accord's story, rewritten to what landed when the two differ (§5).
  const story = await reconcileStory(campaign, accordAt, extraction.output.narrative, notes, staged.rejections);

  return {
    narrative: story.narrative,
    defiance,
    staged: campaign.stagedCount - before,
    notes,
    rejections: staged.rejections,
    costUsd: extraction.costUsd + staged.costUsd + rulingCost + counterpartyCost + story.costUsd,
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
    overrulings(campaign.journal),
    battleHistory(campaign.journal),
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
