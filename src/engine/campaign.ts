import { z } from 'zod';
import type { EpilogueView } from './epilogue.js';
import {
  applyOps,
  tickTurn,
  type ApplyResult,
  type OpSource,
  type TurnReport,
} from '../domain/reducer.js';
import { WorldStateSchema, getFaction, type OrderType, type WorldState } from '../domain/state.js';
import { OP_PATHS_LIST, orderFor, type OpPath } from '../domain/ops.js';
import { isPublicOrderType } from '../domain/intel.js';
import { createSeedState } from '../seed/scenario.js';
import { emptyJournal, replay, seedStateFor, type Journal } from './journal.js';
import type { RimEventKind } from '../domain/events.js';
import {
  FileCampaignStore,
  SAVE_DIR,
  SaveFileSchema,
  type CampaignStore,
  type SaveFile,
} from './store.js';
import type { ChatMessage, TranscriptEntry } from '../model/calls.js';

// Re-exported so existing importers (and src/replay.ts) keep working.
export { SAVE_DIR, SaveFileSchema, FileCampaignStore, MemoryCampaignStore } from './store.js';
export type { CampaignStore, SaveFile } from './store.js';

/**
 * What a player may declare in one turn before ending it.
 *
 * Two is enough for a plan with a hedge — strike and reinforce, court and
 * build — and few enough that the turn has to end for anything to actually
 * happen. Without a limit there is no reason to ever end a turn except to let
 * orders tick, so a player can resolve a dozen actions against a frozen board
 * while every NPC waits politely.
 *
 * Actions the world refused to let you attempt at all do not spend one: an
 * arbiter ruling of inadmissible, and a redirect to a diplomatic channel, both
 * mean nothing happened. Being *refused by your own institutions* does spend
 * one — that is a real event with a real cost, and it is the one case where a
 * free retry would let a player probe their own red lines all day.
 */
export const ACTION_POINTS_PER_TURN = 2;
export interface StagedBatch {
  label: string;
  /** What was proposed. Journaled, so replay reproduces the same rejections. */
  ops: unknown[];
  /**
   * The subset that actually landed. Optional so a batch restored from an older
   * shape still works; `opsStagedSince` falls back to `ops` when it is absent.
   */
  applied?: unknown[];
  /** What the model said would happen, for the end-of-turn summary. */
  narrative: string;
  /** Whose ops these are — carried so the commit replays under the same guards. */
  actor?: string;
  /** Which writer staged them — the player, or the engine charging the player. See `OP_PATHS`. */
  path?: OpPath;
  /**
   * Where the batch came from, carried for the same reason as `actor`: a
   * negotiated treaty must commit under the source that permits it, or a deal
   * struck in a channel would be rejected the moment the turn lands. Optional
   * so a batch restored from an older shape still works.
   */
  source?: Extract<OpSource, 'model' | 'extraction' | 'engine'>;
  /**
   * Why this batch cannot be discarded, or absent when it can.
   *
   * **Discard withdraws an order; it does not un-happen an attempt.** It used
   * to drop the whole batch and rebuild the preview from committed state, which
   * refunded everything the declaration cost while the action point stayed
   * spent — so a failed roll's losses and a refusal's dissent were both free to
   * erase, and a player could probe their own red lines at no price but the
   * point. Measured: credits 3400 → 3600 and dissent 8 → 0 after a discard.
   *
   * - `rolled` — the dice were thrown. Which band it landed in is now a fact,
   *   and letting a player keep the good ones and discard the bad ones is a
   *   reroll with extra steps.
   * - `refused` — a refusal IS its charge; there is no order inside to withdraw.
   * - `charge` — an objection priced on an accord, kept even if the accord goes.
   * - `record` — an engine row, such as the arbiter's ruling. Records of what
   *   happened are not the player's to delete.
   * - `attached` — part of another batch's `group`, withdrawn with it and
   *   never alone: the other power's charge for signing an accord goes when
   *   the accord does.
   *
   * What stays discardable is an accord: unrolled, and still the player's to
   * walk away from before the turn lands. A charge its institutions levied for
   * proposing it is a separate batch and stays.
   */
  binding?: StagedBinding;
  /** Batches withdrawn together: an accord, its correction, and what is `attached` to it. */
  group?: string;
  /** The power an accord was made with, so withdrawing it can be written into that conversation. */
  accordWith?: string;
  /**
   * The acting power's business alone: covert work, or an order its own
   * institutions refused. Left out of what the reactions are told, and its
   * narrative notes are written private — see `reactionBrief`.
   */
  secret?: boolean;
}

export type StagedBinding = 'rolled' | 'sent' | 'refused' | 'charge' | 'record' | 'attached';

/**
 * A campaign as the browser carries it between requests. See
 * `Campaign.toSnapshot`. Loosely typed below the top level on purpose: the
 * save file is validated by its own schema, the world by `WorldStateSchema`
 * when it is trusted, and a staged batch is replayed through the reducer,
 * which rejects anything malformed as it always has.
 */
export const StagedBatchSchema = z.object({
  label: z.string(),
  ops: z.array(z.unknown()),
  applied: z.array(z.unknown()).optional(),
  narrative: z.string(),
  actor: z.string().optional(),
  source: z.enum(['model', 'extraction', 'engine']).optional(),
  path: z.enum(OP_PATHS_LIST).optional(),
  binding: z.enum(['rolled', 'sent', 'refused', 'charge', 'record', 'attached']).optional(),
  secret: z.boolean().optional(),
  group: z.string().optional(),
  accordWith: z.string().optional(),
});

export const CampaignSnapshotSchema = z.object({
  name: z.string().regex(/^[\w.-]+$/),
  save: SaveFileSchema,
  build: z.string(),
  committed: z.unknown().optional(),
  staged: z.array(StagedBatchSchema),
  actionsDeclared: z.number().int().min(0),
});
export type CampaignSnapshot = z.infer<typeof CampaignSnapshotSchema>;

/** Staging options beyond the op list. */
export interface StageMeta {
  binding?: StagedBinding;
  secret?: boolean;
  /** Withdrawn together — see `StagedBatch.group`. */
  group?: string;
  /** The power an accord was made with. */
  accordWith?: string;
  /** Which writer this is. Every live caller says; a test may not. */
  path?: OpPath;
}

/**
 * A live campaign.
 *
 * General actions are **declared, not executed**: they resolve into ops that
 * are staged, and land on the next timestamp when `:endturn` commits them.
 * Two states are therefore tracked:
 *
 *   `committed` — the journal's truth. Only `commitTurn`, `commit` and `tick`
 *                 advance it, and each writes a journal entry as it does.
 *   `state`     — committed plus everything staged. This is what the UI draws
 *                 and what resolution prompts read, so declaring two actions in
 *                 one turn cannot spend the same credits twice.
 *
 * Because `applyOps` is pure and deterministic, replaying the staged batches
 * against `committed` at commit time reproduces the preview exactly.
 */
export class Campaign {
  /** Committed + staged. Safe to read anywhere; never journaled directly. */
  state: WorldState;

  private constructor(
    private committed: WorldState,
    public journal: Journal,
    public transcripts: Record<string, TranscriptEntry[][]>,
    public name: string,
    private readonly store: CampaignStore,
    private stagedBatches: StagedBatch[] = [],
  ) {
    this.state = committed;
  }

  static start(
    playerFactionId: string,
    name = 'campaign',
    store: CampaignStore = new FileCampaignStore(),
    maxTurns?: number,
    /** A sandbox: only this random event, every turn. See `primeRimSandbox`. */
    sandboxEvent?: RimEventKind,
  ): Campaign {
    return new Campaign(
      seedStateFor(playerFactionId, sandboxEvent),
      emptyJournal(playerFactionId, maxTurns, sandboxEvent),
      {},
      name,
      store,
    );
  }

  /**
   * How long this campaign runs, or `null` for one with no ending.
   *
   * Read off the seed entry, which is written once and never again — so it
   * survives a save, an export and a replay without existing anywhere a
   * faction could read it. A journal written before endings existed has no
   * value here and stays endless, rather than acquiring a deadline it was
   * never played under.
   */
  get maxTurns(): number | null {
    const seed = this.journal.entries[0];
    if (!seed || seed.kind !== 'seed') return null;
    return seed.maxTurns ?? null;
  }

  /** The one random event a sandbox campaign fires, or null for a real one. */
  get sandboxEvent(): RimEventKind | null {
    const seed = this.journal.entries[0];
    if (!seed || seed.kind !== 'seed') return null;
    return seed.sandboxEvent ?? null;
  }

  /** True once time has run out. Committed turn, not the preview. */
  get isOver(): boolean {
    return this.maxTurns !== null && this.committed.turn >= this.maxTurns;
  }

  /**
   * Rebuild a campaign from a save file, wherever it came from.
   *
   * Split out from `load` because a save can now also arrive as an uploaded
   * archive rather than from the store — and the reconstruction must be the
   * same either way, or an imported campaign would be a subtly different
   * object from a loaded one.
   */
  static fromSaveFile(
    name: string,
    file: SaveFile,
    store: CampaignStore = new FileCampaignStore(),
  ): Campaign {
    const journal = file.journal as Journal;
    const { state } = replay(journal);
    const campaign = new Campaign(
      state,
      journal,
      file.transcripts as Record<string, TranscriptEntry[][]>,
      name,
      store,
    );
    // A finished campaign reloads finished. The ending is not replayable from
    // ops — it is prose written once over the final board — so it has to be
    // carried across explicitly, the same as the transcripts above it.
    campaign.epilogue = file.epilogue ?? null;
    return campaign;
  }

  /** Returns null when no such campaign exists, rather than throwing. */
  static async load(
    name = 'campaign',
    store: CampaignStore = new FileCampaignStore(),
  ): Promise<Campaign | null> {
    const file = await store.load(name);
    return file ? Campaign.fromSaveFile(name, file, store) : null;
  }

  static async exists(
    name = 'campaign',
    store: CampaignStore = new FileCampaignStore(),
  ): Promise<boolean> {
    return store.exists(name);
  }

  /* ---------------- staging ---------------- */

  /**
   * Declare an action. Ops are validated against the preview immediately — so
   * the player learns about a rejection now rather than at end of turn — but
   * the world does not formally change until `commitTurn`.
   */
  stage(
    ops: unknown[],
    label: string,
    narrative = '',
    /**
     * `extraction` for ops read out of a diplomatic transcript, which is the
     * only model-driven source that may form a treaty — the other party said
     * yes in its own voice, which is the thing a declared action cannot supply.
     */
    source: Extract<OpSource, 'model' | 'extraction' | 'engine'> = 'model',
    /**
     * Whose act this is. Defaults to the player, which is right for every
     * declared action and every accord they close.
     *
     * `engine` batches pass it explicitly: the arbiter's ruling on a player's
     * order is the player's row, and it is written by the engine rather than
     * proposed by a model — which is the whole point, since a model writing its
     * own report card is the confirmation bias this layer exists to avoid.
     */
    actorId: string = this.committed.playerFactionId,
    meta: StageMeta = {},
  ): { rejections: ApplyResult['rejections']; notes: string[] } {
    const actor = actorId;
    // A secret batch's notes are written for its actor alone. Marked on the op
    // rather than decided in the reducer, because the reducer sees one batch and
    // cannot know an arbiter ruled it covert — a failed covert attempt places
    // nobody, so it carries no `deploy_agent` to recognise it by. On the op, it
    // is journaled and replays exactly.
    if (meta.secret) ops = ops.map(privateNote);
    const res = applyOps(this.state, ops, source, actor, true, {}, meta.path);
    this.state = res.state;
    // `ops` is what was PROPOSED and is what gets journaled, because replay must
    // re-run the rejections to reproduce them. `applied` is what actually
    // landed, and it is what the API reports: the first version of this
    // returned the proposed list and a playtest correctly called it out, since an
    // auditor reading it would conclude a rejected op had taken effect.
    //
    // Batches are atomic, so a rejection means **nothing** landed — not merely
    // the rejected op. This was `ops` minus the individually rejected ones,
    // which was right before atomicity and a lie after it: a corrected action
    // reported the whole held-back first batch *and* its correction, so ops
    // appeared doubled and the counts in the notes matched neither list.
    const applied = res.rejections.length > 0 ? [] : ops;
    this.stagedBatches.push({
      label,
      ops,
      applied,
      narrative,
      actor,
      source,
      path: meta.path,
      // An engine row is a record whatever the caller says, unless it is
      // attached to a batch it goes with.
      binding: meta.binding ?? (source === 'engine' ? 'record' : undefined),
      secret: meta.secret,
      ...(meta.group ? { group: meta.group } : {}),
      ...(meta.accordWith ? { accordWith: meta.accordWith } : {}),
    });
    return { rejections: res.rejections, notes: res.notes };
  }

  get stagedCount(): number {
    return this.stagedBatches.length;
  }

  /**
   * Action points: how many things you may declare before time has to move.
   *
   * Deliberately **not** in `WorldState`. It is a pacing rule about the player's
   * turn, not a fact about the galaxy — no faction has action points, nothing in
   * the reducer reads them, and putting them in state would push them through
   * the schema, the save file and every replay for no benefit. It lives beside
   * the staged batches and is reset by the same thing that clears them.
   *
   * Counted as *declarations*, not as staged batches: a correction pass stages a
   * second batch and a refusal stages one of its own, so `stagedCount` would
   * charge two points for one order and a point for being told no.
   */
  private actionsDeclared = 0;

  get actionPointsLeft(): number {
    return Math.max(0, ACTION_POINTS_PER_TURN - this.actionsDeclared);
  }

  /** Spend one. Called once per action that was actually attempted. */
  spendActionPoint(): void {
    this.actionsDeclared += 1;
  }

  /** Give one back, for a declaration that turned out to cost none. */
  refundActionPoint(): void {
    this.actionsDeclared = Math.max(0, this.actionsDeclared - 1);
  }

  /**
   * Take back an attempt that had nothing to stand on: every batch staged from
   * `from` goes, and the action point with it, as for an inadmissible ruling.
   * Not a discard — the player did not choose it, and nothing of the attempt
   * changed the world.
   */
  withdrawAttempt(from: number): void {
    this.stagedBatches = this.stagedBatches.slice(0, from);
    this.actionsDeclared = Math.max(0, this.actionsDeclared - 1);
    this.resyncPreview();
  }

  /** Every op declared but not yet landed, for picking who reacts. */
  stagedOps(): unknown[] {
    return this.stagedBatches.flatMap((b) => b.ops);
  }

  /**
   * What the reacting powers are told the player did, and what their selection
   * is computed from.
   *
   * This was the whole staged summary, label and narrative verbatim, handed to
   * every responder — and responders are chosen by what the player's ops
   * TOUCHED, so the target of a covert op was the power most likely to be woken
   * and given the order text. Measured in a live save: the Iron Vigil was told
   * the Combine had directed an assassination of its Iron Marshal, and answered
   * by name.
   *
   * A secret batch is left out of the prose entirely, and its ops count toward
   * selection only where they are PUBLIC by the fog's own rule — a fleet under
   * way is seen by everyone, so an attack riding in the same declaration as a
   * covert op still wakes the power it lands on. An operative, a refused order
   * and a failed covert attempt wake nobody. Engine rows are records, not acts.
   */
  reactionBrief(): { summary: string; ops: unknown[] } {
    const acts = this.stagedBatches.filter((b) => b.source !== 'engine');
    // A fleet sent at somebody else's world has not arrived when the turn's
    // powers answer — battles settle in the tick, after them — so the story of
    // how it went is not yet true. The Vigil answered "Torrek Anchorage lost in
    // a single disciplined pass" to a story; the battle went the other way
    // (playtest 2026-10-19, S3). Such a batch is told as what was sent.
    // An accord is the business of the two powers who made it: treaties are
    // scoped to their parties everywhere else, and the one summary handed to
    // every responder told the Vigil of a private letter of marque against it
    // (bughunt 2026-10-28). The counterparty heard it in the room.
    const hidden = (b: StagedBatch) => b.secret || b.accordWith !== undefined;
    const summary = acts
      .filter((b) => !hidden(b))
      .map((b, i) => {
        const sent = sentAgainst(this.state, b.applied ?? b.ops);
        const told = sent.length > 0 ? `${sent.join('; ')} (the outcome is decided when they arrive)` : b.narrative;
        return `${i + 1}. ${b.label}${told ? ` — ${told}` : ''}`;
      })
      .join('\n');
    // What LANDED decides who answers, not what was proposed: a refused op
    // reaches nobody (playtest 2026-10-18, D4).
    const ops = acts.flatMap((b) => {
      const landed = b.applied ?? b.ops;
      return hidden(b) ? landed.filter(isPublicAct) : landed;
    });
    return { summary, ops };
  }

  /**
   * Replace one declaration's story with the reconciled one (§5): the first
   * non-engine batch from `from` carries it, and any correction after it is
   * cleared, so the reactions read one story and it is the true one.
   */
  rewriteNarrative(from: number, text: string): void {
    let first = true;
    for (const batch of this.stagedBatches.slice(from)) {
      if (batch.source === 'engine') continue;
      batch.narrative = first ? text : '';
      first = false;
    }
  }

  /** Write what a correction changed onto the batch it staged, for the reactions to read. */
  amendLastNarrative(text: string): void {
    const last = this.stagedBatches[this.stagedBatches.length - 1];
    if (last) last.narrative = last.narrative ? `${last.narrative} ${text}` : text;
  }

  /** Whether each staged batch may be discarded, index for index. */
  stagedBindings(): (StagedBinding | null)[] {
    return this.stagedBatches.map((b) => b.binding ?? null);
  }

  /**
   * Ops from batches `index` onward that actually LANDED — one declaration's
   * whole effect, including any correction batch that followed it, and excluding
   * everything the reducer refused.
   *
   * Applied rather than proposed on purpose. Reporting the proposed list is
   * worse than reporting nothing: a caller diffing the narrative against it
   * would confirm an effect that never happened, which is the exact bug class
   * this field exists to expose.
   */
  opsStagedSince(index: number): unknown[] {
    // `engine` batches are excluded: this answers "what did my action do", and
    // an audit row the engine wrote about the ruling is not something the action
    // did. Without this a refused order reported `log_ruling` among its ops, so
    // the player's own report card showed up in their results.
    return this.stagedBatches
      .slice(index)
      .filter((b) => b.source !== 'engine')
      .flatMap((b) => b.applied ?? b.ops);
  }

  stagedSummary(): string {
    return this.stagedBatches
      .map((b, i) => `${i + 1}. ${b.label}${b.narrative ? ` — ${b.narrative}` : ''}`)
      .join('\n');
  }

  /**
   * Withdraw every declaration that can still be withdrawn.
   *
   * Returns how many went; the rest stay staged, for the reasons on
   * `StagedBatch.binding`. The preview is rebuilt rather than reset, because
   * what survives must be replayed against committed state.
   */
  discardStaged(): number {
    const before = this.stagedBatches.length;
    const going = this.stagedBatches.filter((b) => b.binding === undefined || b.binding === 'attached');
    this.stagedBatches = this.stagedBatches.filter((b) => b.binding !== undefined && b.binding !== 'attached');
    this.recordWithdrawals(going);
    this.resyncPreview();
    return before - this.stagedBatches.length;
  }

  /**
   * Drop one declaration by index, keeping the rest.
   *
   * The preview must be rebuilt from committed state rather than "undone",
   * because a later declaration may have been resolved against the one being
   * removed. Replaying what survives is the only way to get a coherent world.
   */
  discardStagedAt(index: number): boolean | StagedBinding {
    if (index < 0 || index >= this.stagedBatches.length) return false;
    const target = this.stagedBatches[index]!;
    if (target.binding !== undefined) return target.binding;
    // Its group goes with it: the accord's correction, and the charge attached
    // to it. Anything bound in the group stays, for its own reason.
    const goes = (b: StagedBatch): boolean =>
      b === target ||
      (target.group !== undefined && b.group === target.group && (b.binding === undefined || b.binding === 'attached'));
    const going = this.stagedBatches.filter(goes);
    this.stagedBatches = this.stagedBatches.filter((b) => !goes(b));
    this.recordWithdrawals(going);
    this.resyncPreview();
    return true;
  }

  /**
   * Tell the conversation an accord came from that it was withdrawn. The
   * transcript is replayed into that power's persona, which otherwise goes on
   * believing in a deal that never took effect — measured: after a withdrawn
   * toll lift, the Combine insisted "you paid 400, and my customs houses struck
   * you from the list" (playtest 2026-10-18, C13). Once per conversation.
   */
  private recordWithdrawals(going: readonly StagedBatch[]): void {
    for (const factionId of new Set(going.flatMap((b) => (b.accordWith ? [b.accordWith] : [])))) {
      const sessions = this.transcripts[factionId];
      const last = sessions?.[sessions.length - 1];
      if (!last) continue;
      last.push({
        speaker: 'record',
        text: '[The accord reached above was WITHDRAWN before it took effect. Nothing in it was carried out — no treaty, no payment, no concession by either side.]',
      });
    }
  }

  stagedLabels(): string[] {
    return this.stagedBatches.map((b) => b.label);
  }

  stagedNarratives(): string[] {
    return this.stagedBatches.map((b) => b.narrative);
  }

  /** Land every declared action. This is the "next timestamp" arriving. */
  commitTurn(): { notes: string[]; applied: number } {
    const notes: string[] = [];
    const applied = this.stagedBatches.length;

    for (const batch of this.stagedBatches) {
      // The source is carried from staging for the same reason the actor is: a
      // treaty negotiated in a channel is staged under `extraction`, and
      // committing it as `model` would reject it at the moment the turn landed
      // — the deal visible in the preview would quietly not exist afterwards.
      const source = batch.source ?? 'model';
      const res = applyOps(this.committed, batch.ops, source, batch.actor, true, {}, batch.path);
      this.committed = res.state;
      this.journal.entries.push({
        kind: 'ops',
        source,
        ...(batch.path ? { path: batch.path } : {}),
        label: batch.label,
        ops: batch.ops,
        // The actor MUST be journaled. It was applied above and dropped here,
        // so replay re-ran every player-declared batch with `actor: undefined`
        // and skipped every actor-gated guard — the suborn limits, the agent
        // owner check, the doctrine guards, the dissent sign rule,
        // `capSelfInflictedLosses`, the narrative-credit cap. Live rejected or
        // trimmed; replay applied in full. It stayed invisible because those
        // guards mostly *reject*, and no test staged an op that tripped one
        // until the credit cap started *modifying* a value the parity test
        // asserts on.
        actor: batch.actor,
      });
      // A batch that lands nothing is the failed first attempt of an action
      // that was corrected, or refused outright, and the player was told so
      // when it was declared. It is committed so replay reproduces the
      // rejection, and its notes are not said a second time at End Turn.
      if (res.rejections.length === 0) notes.push(...res.notes);
    }

    this.stagedBatches = [];
    this.actionsDeclared = 0;
    this.state = this.committed;
    return { notes, applied };
  }

  /* ---------------- immediate commits ---------------- */

  /**
   * Apply and journal ops straight away, bypassing staging. Used during
   * end-of-turn processing (NPC reactions) where the turn is already landing.
   */
  commit(
    ops: unknown[],
    source: OpSource,
    label: string,
    actor?: string,
    path?: OpPath,
  ): { rejections: ApplyResult['rejections']; notes: string[] } {
    const res = applyOps(this.committed, ops, source, actor, true, {}, path);
    this.committed = res.state;
    this.journal.entries.push({ kind: 'ops', source, ...(path ? { path } : {}), label, ops, actor });
    this.resyncPreview();
    return { rejections: res.rejections, notes: res.notes };
  }

  /** Advance time. The only path by which pending orders progress. */
  tick(): { notes: string[]; report: TurnReport } {
    const res = tickTurn(this.committed, { rimSandbox: this.sandboxEvent ?? undefined });
    this.committed = res.state;
    this.journal.entries.push({ kind: 'tick' });
    this.resyncPreview();
    return { notes: res.notes, report: res.report };
  }

  private resyncPreview(): void {
    let s = this.committed;
    for (const batch of this.stagedBatches) {
      const res = applyOps(s, batch.ops, batch.source ?? 'model', batch.actor, true, {}, batch.path);
      s = res.state;
      // Same rule as `stage`, and it has to be the same rule: a preview that
      // recomputed `applied` differently would change the reported ops
      // underneath the player on the next commit or tick.
      batch.applied = res.rejections.length > 0 ? [] : batch.ops;
    }
    this.state = s;
  }

  /* ---------------- diplomacy transcripts ---------------- */

  recordTranscript(factionId: string, messages: TranscriptEntry[]): void {
    const existing = this.transcripts[factionId] ?? [];
    existing.push(messages);
    this.transcripts[factionId] = existing;
  }

  /** Flattened past conversations with a faction, for its persona prompt. */
  priorTranscripts(factionId: string): string[] {
    const sessions = this.transcripts[factionId] ?? [];
    return sessions.map(
      (session, i) =>
        `### Conversation ${i + 1}\n` +
        session
          .map((m) =>
            // A `record` line is the engine's note on what became of the
            // conversation, not a thing either party said. Rendered without a
            // speaker so it cannot be read back as the faction's own words —
            // the previous mapping would have attributed a refusal notice to
            // "You", which is exactly the confusion it exists to prevent.
            m.speaker === 'record'
              ? m.text
              : `${m.speaker === 'player' ? 'Them' : 'You'}: ${m.text}`,
          )
          .join('\n'),
    );
  }

  /* ---------------- persistence ---------------- */

  /** The serialisable form of this campaign. Staged actions are excluded by
   *  construction — they are not in the journal and do not survive a save. */
  /**
   * The ending, once written. Persisted beside the journal for the same reason
   * transcripts are: it is not a world fact and cannot be replayed from ops,
   * but a player reopening a finished campaign must read the ending they were
   * actually given rather than a freshly generated one.
   */
  epilogue: EpilogueView | null = null;

  toSaveFile(): SaveFile {
    return SaveFileSchema.parse({
      version: 1,
      journal: this.journal,
      transcripts: this.transcripts,
      ...(this.epilogue === null ? {} : { epilogue: this.epilogue }),
    });
  }

  async save(): Promise<string> {
    await this.store.save(this.name, this.toSaveFile());
    return this.name;
  }

  /**
   * Everything a campaign holds, including what a save file deliberately does
   * not: the declarations staged this turn and the action points they spent.
   *
   * This is what lets the server be stateless. The browser holds the snapshot
   * and sends it with each request; the server rebuilds the campaign from it,
   * does the work, and hands the next snapshot back. A save file is the
   * campaign's durable record and stays journal-only; a snapshot is the
   * campaign mid-turn.
   *
   * `committed` rides along so a request need not replay the whole journal —
   * ~300ms at turn 100 — and `build` says which server wrote it. A snapshot
   * from another build is replayed instead of trusted, because the world it
   * carries was produced under rules this build may not share.
   */
  toSnapshot(build: string): CampaignSnapshot {
    return {
      name: this.name,
      save: this.toSaveFile(),
      build,
      committed: this.committed,
      ...this.turnState(),
    };
  }

  /** The turn-local half of a snapshot: what a save file leaves out. */
  turnState(): Pick<CampaignSnapshot, 'staged' | 'actionsDeclared'> {
    return { staged: this.stagedBatches, actionsDeclared: this.actionsDeclared };
  }

  static fromSnapshot(
    snapshot: CampaignSnapshot,
    build: string,
    store: CampaignStore = new FileCampaignStore(),
  ): Campaign {
    const trusted =
      snapshot.build === build && snapshot.committed !== undefined
        ? WorldStateSchema.safeParse(snapshot.committed)
        : null;
    const campaign = trusted?.success
      ? Campaign.withCommitted(snapshot.name, snapshot.save, trusted.data, store)
      : Campaign.fromSaveFile(snapshot.name, snapshot.save, store);
    campaign.restoreTurn(snapshot);
    return campaign;
  }

  /** Put staged declarations and spent action points back, and rebuild the preview. */
  restoreTurn(turn: Partial<Pick<CampaignSnapshot, 'staged' | 'actionsDeclared'>>): void {
    this.stagedBatches = (turn.staged ?? []).map((b) => ({ ...b }));
    this.actionsDeclared = turn.actionsDeclared ?? 0;
    this.resyncPreview();
  }

  /** `fromSaveFile`, with the committed world supplied instead of replayed. */
  private static withCommitted(
    name: string,
    file: SaveFile,
    committed: WorldState,
    store: CampaignStore,
  ): Campaign {
    const campaign = new Campaign(
      committed,
      file.journal as Journal,
      file.transcripts as Record<string, TranscriptEntry[][]>,
      name,
      store,
    );
    campaign.epilogue = file.epilogue ?? null;
    return campaign;
  }

  /**
   * Rebuild committed state from the journal and confirm it matches.
   * Compares against `committed`, not the preview — staged actions are not yet
   * part of the world and are deliberately absent from the journal.
   */
  verifyReplay(): { ok: boolean; detail: string } {
    const { state } = replay(this.journal);
    // Both sides in CANONICAL form. `replay` returns its world through
    // `WorldStateSchema.parse`, which writes every object's keys in schema
    // order, while the live world keeps whatever order the reducer's literal
    // happened to use — so an operative created as `{ id, name, ownerFactionId,
    // … }` compared unequal to the same operative replayed as `{ id,
    // ownerFactionId, …, name }`. Every campaign with a live operative failed
    // this check while holding an identical world. Found while pinning that a
    // covert reaction replays exactly.
    //
    // Records are untouched by the parse — `z.record` keeps insertion order —
    // so the stack-order defect `normaliseStack` closed is still caught here.
    const a = JSON.stringify(state);
    const b = JSON.stringify(WorldStateSchema.parse(this.committed));
    if (a === b) {
      return {
        ok: true,
        detail:
          this.stagedCount > 0
            ? `Replay reproduces committed state exactly (${this.stagedCount} action(s) still staged).`
            : 'Replay reproduces live state exactly.',
      };
    }
    return { ok: false, detail: `Replay diverged: ${a.length} vs ${b.length} bytes of state.` };
  }
}

/** Every `log_narrative` in a batch, marked private to its actor. */
export function markNotesPrivate(ops: unknown[]): unknown[] {
  return ops.map(privateNote);
}

/** Mark a `log_narrative` private to its actor; any other op passes through. */
function privateNote(op: unknown): unknown {
  return op && typeof op === 'object' && (op as { op?: unknown }).op === 'log_narrative'
    ? { ...(op as object), private: true }
    : op;
}

/**
 * The part of a secret batch that the rest of the Rim can see anyway: an order
 * of a public category, which `intel.ts` already rules visible to everyone.
 */
function isPublicAct(op: unknown): boolean {
  // Work is read as the order it means, so a declared move is as public as the
  // fleet movement it becomes.
  const o = orderFor(op) as { type?: unknown } | null;
  return o !== null && typeof o.type === 'string' && isPublicOrderType(o.type as OrderType);
}

/** Fleets a batch sends at a world its sender does not hold, said plainly. */
function sentAgainst(state: WorldState, ops: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of ops) {
    const o = raw as { op?: string; type?: string; factionId?: string; originId?: string; targetId?: string; force?: unknown } | null;
    const isMove = o?.op === 'move' || (o?.op === 'issue_order' && o.type === 'fleet_movement');
    if (!isMove || !o?.targetId) continue;
    const target = state.systems.find((x) => x.id === o.targetId);
    const origin = state.systems.find((x) => x.id === o.originId);
    if (!target) continue;
    const contested = target.controllerFactionId !== o.factionId || Object.keys(target.ships).some((f) => f !== o.factionId);
    if (!contested) continue;
    const force =
      o.force === undefined
        ? 'every hull there'
        : typeof o.force === 'number'
          ? `${o.force} hulls`
          : Object.entries(o.force as Record<string, number>).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}${n === 1 ? '' : 's'}`).join(', ');
    out.push(`${getFaction(state, o.factionId ?? '')?.name ?? o.factionId} sends ${force} from ${origin?.name ?? o.originId} to ${target.name}`);
  }
  return out;
}
