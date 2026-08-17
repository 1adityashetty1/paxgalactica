import type {
  ActionOutcomeResponse,
  CampaignView,
  ImportOutcome,
  ServerEvent,
  TurnOutcomeResponse,
} from '../api/contract.js';
import { archiveFilename, packCampaign, unpackCampaign } from '../engine/archive.js';
import { briefingFromState, buildBriefing, type Briefing } from '../engine/briefing.js';
import { Campaign } from '../engine/campaign.js';
import { FileCampaignStore, type CampaignStore } from '../engine/store.js';
import { closeChannel, endTurn, submitAction } from '../engine/turn.js';
import { diplomacyReply, type ChatMessage } from '../model/calls.js';
import { getFaction } from '../domain/state.js';
import { playableFactions } from '../seed/scenario.js';
import { ApiFailure, toApiFailure } from './errors.js';

export type Emit = (event: ServerEvent) => void;

/**
 * One campaign, held in memory, driven by the HTTP layer.
 *
 * SINGLE CAMPAIGN PER PROCESS, deliberately. This is a single-player game
 * running on localhost; there is no tenancy model here and nothing about this
 * class is safe to share between users. If multi-campaign support is ever
 * wanted, key these fields by session id rather than bolting concurrency onto
 * the singleton.
 *
 * Everything here is plain async methods over parsed input — no `req`, no
 * `res`, no HTTP. That is what lets the whole surface be tested without
 * binding a port.
 */
export class GameSession {
  private campaign: Campaign | null = null;
  private openChannel: string | null = null;
  private channelHistory: ChatMessage[] = [];
  private lastBriefing: Briefing | null = null;

  /**
   * Guards against overlapping model calls. The staging model assumes ordered
   * declarations, and two resolutions racing would interleave their ops
   * unpredictably — so a second request is refused rather than queued.
   */
  private busyLabel: string | null = null;

  constructor(
    private readonly store: CampaignStore = new FileCampaignStore(),
    private readonly emit: Emit = () => {},
  ) {}

  get isBusy(): boolean {
    return this.busyLabel !== null;
  }

  private require(): Campaign {
    if (!this.campaign) {
      throw new ApiFailure('no_campaign', 'No campaign is loaded. Start or resume one first.');
    }
    return this.campaign;
  }

  /** Run work under the busy guard, narrating progress to any SSE listener. */
  private async exclusive<T>(label: string, work: () => Promise<T>): Promise<T> {
    if (this.busyLabel) {
      throw new ApiFailure('conflict', `Busy: ${this.busyLabel}. Wait for it to finish.`);
    }
    this.busyLabel = label;
    this.emit({ type: 'progress', label, busy: true });
    try {
      return await work();
    } catch (err) {
      throw toApiFailure(err);
    } finally {
      this.busyLabel = null;
      this.emit({ type: 'progress', label: '', busy: false });
    }
  }

  /* ---------------- reads ---------------- */

  view(): CampaignView {
    const campaign = this.require();
    return {
      state: campaign.state,
      staged: campaign.stagedLabels().map((label, index) => ({
        index,
        label,
        narrative: campaign.stagedNarratives()[index] ?? '',
      })),
      briefing: this.lastBriefing,
      openChannel: this.openChannel,
      channelHistory: [...this.channelHistory],
      name: campaign.name,
    };
  }

  hasCampaign(): boolean {
    return this.campaign !== null;
  }

  async factions(): Promise<{ factions: ReturnType<typeof playableFactions>; saves: string[] }> {
    return { factions: playableFactions(), saves: await this.store.list() };
  }

  private pushState(): void {
    if (this.campaign) this.emit({ type: 'state', view: this.view() });
  }

  /* ---------------- lifecycle ---------------- */

  async newCampaign(factionId: string, name: string): Promise<CampaignView> {
    if (!playableFactions().some((f) => f.id === factionId)) {
      throw new ApiFailure('bad_request', `Unknown faction "${factionId}".`);
    }
    this.campaign = Campaign.start(factionId, name, this.store);
    this.openChannel = null;
    this.channelHistory = [];
    this.lastBriefing = null;
    await this.campaign.save();
    this.pushState();
    return this.view();
  }

  async resume(name: string): Promise<CampaignView> {
    const loaded = await Campaign.load(name, this.store);
    if (!loaded) throw new ApiFailure('not_found', `No saved campaign named "${name}".`);
    this.campaign = loaded;
    this.openChannel = null;
    this.channelHistory = [];
    // Derive a briefing from state so a resumed campaign shows what is running
    // instead of "end a turn to see the report" while three projects tick away.
    this.lastBriefing = briefingFromState(loaded.state);
    this.pushState();
    return this.view();
  }

  /* ---------------- archives ---------------- */

  /**
   * Pack the *committed* campaign for download.
   *
   * Synchronous and free of the busy guard on purpose: it reads the journal
   * the campaign already holds, so it cannot interleave with a model call, and
   * a player should be able to grab a backup while a turn is resolving.
   *
   * Staged actions are excluded because they are not in the journal — the same
   * reason they do not survive a save. `stagedLost` lets the caller warn.
   */
  exportArchive(): { filename: string; bytes: Uint8Array; stagedLost: number } {
    const campaign = this.require();
    const now = Date.now();
    return {
      filename: archiveFilename(campaign.name, now),
      bytes: packCampaign(campaign.name, campaign.toSaveFile(), { now }),
      stagedLost: campaign.stagedCount,
    };
  }

  /**
   * Adopt an uploaded archive: verify it, write it into the save store, and
   * load it as the current campaign.
   *
   * Verification happens in `unpackCampaign` — the journal is replayed in full
   * before anything is written, so a corrupt archive cannot land halfway and
   * leave the session holding a broken campaign.
   */
  async importArchive(archiveBase64: string, name?: string): Promise<ImportOutcome> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(archiveBase64, 'base64'));
    } catch {
      throw new ApiFailure('bad_request', 'The uploaded archive was not valid base64.');
    }
    if (bytes.length === 0) throw new ApiFailure('bad_request', 'The uploaded archive was empty.');

    let unpacked;
    try {
      unpacked = unpackCampaign(bytes);
    } catch (err) {
      throw new ApiFailure('bad_request', err instanceof Error ? err.message : String(err));
    }

    const target = name ?? unpacked.manifest.name;
    if (!/^[\w.-]+$/.test(target)) {
      throw new ApiFailure(
        'bad_request',
        `The archive names its campaign "${target}", which is not a usable save name. Supply one.`,
      );
    }

    await this.store.save(target, unpacked.save);
    const view = await this.resume(target);

    return {
      name: target,
      turn: unpacked.turn,
      playerFactionId: unpacked.manifest.playerFactionId,
      exportedAt: unpacked.manifest.exportedAt,
      journalEntries: unpacked.manifest.journalEntries,
      view,
    };
  }

  /* ---------------- play ---------------- */

  async action(text: string): Promise<ActionOutcomeResponse> {
    const campaign = this.require();
    if (this.openChannel) {
      throw new ApiFailure(
        'conflict',
        `A channel with ${this.openChannel} is open. Close it before declaring an action.`,
      );
    }

    const outcome = await this.exclusive('Resolving', () => submitAction(campaign, text));
    this.pushState();
    return {
      narrative: outcome.narrative,
      refusal: outcome.refusal ?? null,
      defiance: outcome.defiance ?? null,
      negotiation: outcome.negotiation ?? null,
      staged: outcome.staged,
      ops: outcome.ops,
      notes: outcome.notes,
      rejections: outcome.rejections,
      check: outcome.check ?? null,
      costUsd: outcome.costUsd,
    };
  }

  async endTurn(): Promise<TurnOutcomeResponse> {
    const campaign = this.require();
    if (this.openChannel) {
      throw new ApiFailure(
        'conflict',
        `A channel with ${this.openChannel} is open. Close it before ending the turn.`,
      );
    }

    const outcome = await this.exclusive('The galaxy turns', () => endTurn(campaign));
    this.lastBriefing = buildBriefing(campaign.state, outcome.report);
    await campaign.save();
    this.pushState();

    return {
      applied: outcome.applied,
      reactions: outcome.reactions,
      notes: outcome.notes,
      rejections: outcome.rejections,
      briefing: this.lastBriefing,
      costUsd: outcome.costUsd,
    };
  }

  async discardStaged(index?: number): Promise<{ discarded: number }> {
    const campaign = this.require();
    if (this.isBusy) throw new ApiFailure('conflict', `Busy: ${this.busyLabel}.`);

    if (index === undefined) {
      const discarded = campaign.discardStaged();
      this.pushState();
      return { discarded };
    }

    if (!campaign.discardStagedAt(index)) {
      throw new ApiFailure('bad_request', `No declared action at index ${index}.`);
    }
    this.pushState();
    return { discarded: 1 };
  }

  /* ---------------- diplomacy ---------------- */

  async talk(factionId: string, text: string): Promise<{ reply: string; costUsd: number }> {
    const campaign = this.require();
    const faction = getFaction(campaign.state, factionId);
    if (!faction) throw new ApiFailure('not_found', `No faction "${factionId}".`);
    if (factionId === campaign.state.playerFactionId) {
      throw new ApiFailure('bad_request', 'You cannot open a channel with yourself.');
    }
    if (this.openChannel && this.openChannel !== factionId) {
      throw new ApiFailure(
        'conflict',
        `A channel with ${this.openChannel} is already open. Close it first.`,
      );
    }

    if (!this.openChannel) {
      this.openChannel = factionId;
      this.channelHistory = [];
    }
    this.channelHistory.push({ speaker: 'player', text });

    const result = await this.exclusive(`${faction.name} considers`, async () =>
      diplomacyReply(campaign.state, factionId, this.channelHistory, campaign.priorTranscripts(factionId)),
    );

    this.channelHistory.push({ speaker: 'faction', text: result.reply });
    this.pushState();
    return { reply: result.reply, costUsd: result.costUsd };
  }

  async endTalk(factionId: string): Promise<ActionOutcomeResponse> {
    const campaign = this.require();
    if (this.openChannel !== factionId) {
      throw new ApiFailure('conflict', `No open channel with "${factionId}".`);
    }

    const history = [...this.channelHistory];
    // Close the channel before extraction: whatever the pass returns, the
    // conversation is over, and leaving it open on failure would strand the UI.
    this.openChannel = null;
    this.channelHistory = [];

    const outcome = await this.exclusive('Reading the transcript', () =>
      closeChannel(campaign, factionId, history),
    );
    this.pushState();

    return {
      narrative: outcome.narrative,
      refusal: null,
      defiance: null,
      negotiation: null,
      staged: outcome.staged,
      ops: outcome.ops,
      notes: outcome.notes,
      rejections: outcome.rejections,
      check: null,
      costUsd: outcome.costUsd,
    };
  }

  /** Save on shutdown. Staged actions are not journaled and are lost. */
  async shutdown(): Promise<{ saved: boolean; stagedLost: number }> {
    if (!this.campaign) return { saved: false, stagedLost: 0 };
    const stagedLost = this.campaign.stagedCount;
    await this.campaign.save();
    return { saved: true, stagedLost };
  }
}
