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

export const JournalEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('seed'),
    playerFactionId: z.string(),
  }),
  z.object({
    kind: z.literal('ops'),
    /** 'model' ops are subject to the reducer-only guard; 'engine' ops are not. */
    source: z.enum(['model', 'engine']),
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
  version: z.literal(1),
  entries: z.array(JournalEntrySchema),
});
export type Journal = z.infer<typeof JournalSchema>;

export function emptyJournal(playerFactionId: string): Journal {
  return { version: 1, entries: [{ kind: 'seed', playerFactionId }] };
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
      const res = applyOps(state, entry.ops, entry.source, entry.actor);
      state = res.state;
      rejectionCount += res.rejections.length;
    } else if (entry.kind === 'tick') {
      state = tickTurn(state).state;
    }
  }

  return { state: WorldStateSchema.parse(state), rejectionCount };
}
