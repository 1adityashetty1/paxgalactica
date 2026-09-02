import type { EpilogueView } from './epilogue.js';
import {
  applyOps,
  tickTurn,
  type ApplyResult,
  type OpSource,
  type TurnReport,
} from '../domain/reducer.js';
import type { WorldState } from '../domain/state.js';
import { createSeedState } from '../seed/scenario.js';
import { emptyJournal, replay, type Journal } from './journal.js';
import {
  FileCampaignStore,
  SAVE_DIR,
  SaveFileSchema,
  type CampaignStore,
  type SaveFile,
} from './store.js';
import type { ChatMessage } from '../model/calls.js';

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
  /**
   * Where the batch came from, carried for the same reason as `actor`: a
   * negotiated treaty must commit under the source that permits it, or a deal
   * struck in a channel would be rejected the moment the turn lands. Optional
   * so a batch restored from an older shape still works.
   */
  source?: Extract<OpSource, 'model' | 'extraction'>;
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
    public transcripts: Record<string, ChatMessage[][]>,
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
  ): Campaign {
    return new Campaign(
      createSeedState(playerFactionId),
      emptyJournal(playerFactionId, maxTurns),
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
      file.transcripts as Record<string, ChatMessage[][]>,
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
    source: Extract<OpSource, 'model' | 'extraction'> = 'model',
  ): { rejections: ApplyResult['rejections']; notes: string[] } {
    // The player's own faction is always the actor for a declared action.
    const actor = this.committed.playerFactionId;
    const res = applyOps(this.state, ops, source, actor, true);
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
    this.stagedBatches.push({ label, ops, applied, narrative, actor, source });
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

  /** Every op declared but not yet landed, for picking who reacts. */
  stagedOps(): unknown[] {
    return this.stagedBatches.flatMap((b) => b.ops);
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
    return this.stagedBatches.slice(index).flatMap((b) => b.applied ?? b.ops);
  }

  stagedSummary(): string {
    return this.stagedBatches
      .map((b, i) => `${i + 1}. ${b.label}${b.narrative ? ` — ${b.narrative}` : ''}`)
      .join('\n');
  }

  discardStaged(): number {
    const dropped = this.stagedBatches.length;
    this.stagedBatches = [];
    this.state = this.committed;
    return dropped;
  }

  /**
   * Drop one declaration by index, keeping the rest.
   *
   * The preview must be rebuilt from committed state rather than "undone",
   * because a later declaration may have been resolved against the one being
   * removed. Replaying what survives is the only way to get a coherent world.
   */
  discardStagedAt(index: number): boolean {
    if (index < 0 || index >= this.stagedBatches.length) return false;
    this.stagedBatches.splice(index, 1);
    this.resyncPreview();
    return true;
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
      const res = applyOps(this.committed, batch.ops, source, batch.actor, true);
      this.committed = res.state;
      this.journal.entries.push({
        kind: 'ops',
        source,
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
      notes.push(...res.notes);
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
  ): { rejections: ApplyResult['rejections']; notes: string[] } {
    const res = applyOps(this.committed, ops, source, actor, true);
    this.committed = res.state;
    this.journal.entries.push({ kind: 'ops', source, label, ops, actor });
    this.resyncPreview();
    return { rejections: res.rejections, notes: res.notes };
  }

  /** Advance time. The only path by which pending orders progress. */
  tick(): { notes: string[]; report: TurnReport } {
    const res = tickTurn(this.committed);
    this.committed = res.state;
    this.journal.entries.push({ kind: 'tick' });
    this.resyncPreview();
    return { notes: res.notes, report: res.report };
  }

  private resyncPreview(): void {
    let s = this.committed;
    for (const batch of this.stagedBatches) {
      const res = applyOps(s, batch.ops, batch.source ?? 'model', batch.actor, true);
      s = res.state;
      // Same rule as `stage`, and it has to be the same rule: a preview that
      // recomputed `applied` differently would change the reported ops
      // underneath the player on the next commit or tick.
      batch.applied = res.rejections.length > 0 ? [] : batch.ops;
    }
    this.state = s;
  }

  /* ---------------- diplomacy transcripts ---------------- */

  recordTranscript(factionId: string, messages: ChatMessage[]): void {
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
        session.map((m) => `${m.speaker === 'player' ? 'Them' : 'You'}: ${m.text}`).join('\n'),
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
   * Rebuild committed state from the journal and confirm it matches.
   * Compares against `committed`, not the preview — staged actions are not yet
   * part of the world and are deliberately absent from the journal.
   */
  verifyReplay(): { ok: boolean; detail: string } {
    const { state } = replay(this.journal);
    const a = JSON.stringify(state);
    const b = JSON.stringify(this.committed);
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
