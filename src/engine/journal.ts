import { z } from 'zod';
import { applyOps, tickTurn } from '../domain/reducer.js';
import { WorldStateSchema, type WorldState } from '../domain/state.js';
import { createSeedState } from '../seed/scenario.js';

/**
 * The ops journal. Everything that ever changed the world is recorded here as
 * the op list that changed it, so a campaign can be rebuilt from turn 0 by
 * replaying the reducer — with no model calls at all.
 *
 * That is what makes prompt changes evaluable: replay an existing campaign to
 * reproduce the exact state a prompt produced, rather than trying to remember
 * what the old prompt used to do.
 */

/** Bumped when a change would otherwise make an older journal replay differently. */
export const JOURNAL_VERSION = 3;

export const JournalEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('seed'),
    playerFactionId: z.string(),
  }),
  z.object({
    kind: z.literal('ops'),
    /**
     * 'model' ops are subject to the reducer-only guards; 'engine' ops are not.
     * 'extraction' is the diplomacy pass, and is the only model-driven source
     * that may `form_treaty` — a treaty needs the other party's consent, and a
     * transcript is where consent is established.
     *
     * Journals written before `extraction` existed replay unchanged: they
     * recorded diplomacy ops as 'model', which at the time could legally carry
     * a treaty, so replaying them reproduces what actually happened rather than
     * retroactively rejecting it.
     */
    source: z.enum(['model', 'engine', 'extraction']),
    label: z.string(),
    ops: z.array(z.unknown()),
    /**
     * Which faction emitted these ops. Optional so journals written before
     * actor-aware guards existed still replay — without it the suborn guard
     * simply does not apply, which reproduces what actually happened rather
     * than retroactively rejecting it.
     */
    actor: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tick'),
  }),
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalSchema = z.object({
  /**
   * 1 — written before `form_treaty` required the `extraction` source, so its
   *     diplomacy batches are recorded as `model` and must still replay as they
   *     originally ran. See `replay`.
   * 2 — current.
   */
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  entries: z.array(JournalEntrySchema),
});
export type Journal = z.infer<typeof JournalSchema>;

export function emptyJournal(playerFactionId: string): Journal {
  return { version: JOURNAL_VERSION, entries: [{ kind: 'seed', playerFactionId }] };
}

export interface ReplayResult {
  state: WorldState;
  /** Rejections encountered during replay; should be identical every run. */
  rejectionCount: number;
}

/**
 * Rebuild world state from a journal. Pure and offline: if this ever needs a
 * model call, the journal has failed at its job.
 */
export function replay(journal: Journal): ReplayResult {
  const parsed = JournalSchema.parse(journal);
  const seed = parsed.entries[0];
  if (!seed || seed.kind !== 'seed') {
    throw new Error('Journal must begin with a seed entry.');
  }

  let state = createSeedState(seed.playerFactionId);
  let rejectionCount = 0;

  for (const entry of parsed.entries.slice(1)) {
    if (entry.kind === 'ops') {
      // A journal written before treaties needed a transcript recorded its
      // diplomacy batches as `model`, which the reducer now refuses. Replaying
      // one under today's rule would silently delete a treaty that really was
      // negotiated and really did apply — the campaign would come back a
      // different campaign, which is the one thing the journal exists to
      // prevent. Those entries replay under the source that permits them.
      //
      // Scoped to entries that actually contain a treaty, rather than
      // reinterpreting every legacy batch: a diplomacy extraction never carried
      // a `transfer_control`, so this cannot quietly permit anything else.
      // Pinned to 2 — the version at which `form_treaty` began requiring an
      // `extraction` source — and NOT to `JOURNAL_VERSION`. Written against the
      // current version it silently widened every time the version was bumped
      // for an unrelated reason: bumping to 3 for atomic batches made this
      // exempt v2 journals too, which are precisely the ones the guard exists
      // to hold. An exemption belongs to the rule that created it.
      const legacyTreaty =
        parsed.version < 2 &&
        entry.source === 'model' &&
        entry.ops.some(
          (op) => !!op && typeof op === 'object' && (op as { op?: unknown }).op === 'form_treaty',
        );
      const source = legacyTreaty ? 'extraction' : entry.source;
      // Batches are atomic from version 3 on. Before that they applied
      // partially, and journals written then recorded batches that really did
      // land in part — replaying those atomically would discard work the
      // campaign actually did, which is the one thing this function exists to
      // prevent. Each entry replays under the rule that was in force when it
      // was written, exactly as the legacy-treaty clause above does.
      const atomicBatches = parsed.version >= 3;
      const res = applyOps(state, entry.ops, source, entry.actor, atomicBatches);
      state = res.state;
      rejectionCount += res.rejections.length;
    } else if (entry.kind === 'tick') {
      state = tickTurn(state).state;
    }
  }

  return { state: WorldStateSchema.parse(state), rejectionCount };
}
