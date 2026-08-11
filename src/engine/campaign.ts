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

export interface StagedBatch {
  label: string;
  ops: unknown[];
  /** What the model said would happen, for the end-of-turn summary. */
  narrative: string;
  /** Whose ops these are — carried so the commit replays under the same guards. */
  actor?: string;
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
  ): Campaign {
    return new Campaign(
      createSeedState(playerFactionId),
      emptyJournal(playerFactionId),
      {},
      name,
      store,
    );
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
    return new Campaign(
      state,
      journal,
      file.transcripts as Record<string, ChatMessage[][]>,
      name,
      store,
    );
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
  stage(ops: unknown[], label: string, narrative = ''): { rejections: ApplyResult['rejections']; notes: string[] } {
    // The player's own faction is always the actor for a declared action.
    const actor = this.committed.playerFactionId;
    const res = applyOps(this.state, ops, 'model', actor);
    this.state = res.state;
    this.stagedBatches.push({ label, ops, narrative, actor });
    return { rejections: res.rejections, notes: res.notes };
  }

  get stagedCount(): number {
    return this.stagedBatches.length;
  }

  /** Every op declared but not yet landed, for picking who reacts. */
  stagedOps(): unknown[] {
    return this.stagedBatches.flatMap((b) => b.ops);
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
      const res = applyOps(this.committed, batch.ops, 'model', batch.actor);
      this.committed = res.state;
      this.journal.entries.push({
        kind: 'ops',
        source: 'model',
        label: batch.label,
        ops: batch.ops,
      });
      notes.push(...res.notes);
    }

    this.stagedBatches = [];
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
    const res = applyOps(this.committed, ops, source, actor);
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
    for (const batch of this.stagedBatches) s = applyOps(s, batch.ops, 'model', batch.actor).state;
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
  toSaveFile(): SaveFile {
    return SaveFileSchema.parse({
      version: 1,
      journal: this.journal,
      transcripts: this.transcripts,
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
