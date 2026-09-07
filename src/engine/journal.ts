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
    /**
     * How long this campaign runs, chosen once when it is created.
     *
     * It lives on the seed entry rather than on `WorldState` for the same
     * reason `ACTION_POINTS_PER_TURN` does not: it is a rule about this
     * campaign, not a fact about the galaxy — no faction can read it and
     * nothing in the reducer depends on it. Unlike action points it must
     * survive a save and a replay, and the seed entry is the one place that is
     * written once and never again.
     *
     * **Optional, so a journal written before endings existed loads as
     * endless** rather than retroactively acquiring a deadline it was never
     * played under.
     */
    maxTurns: z.number().int().min(10).max(100).optional(),
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

export function emptyJournal(playerFactionId: string, maxTurns?: number): Journal {
  return {
    version: JOURNAL_VERSION,
    entries: [{ kind: 'seed', playerFactionId, ...(maxTurns === undefined ? {} : { maxTurns }) }],
  };
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
export function replay(
  journal: Journal,
  /**
   * Called with the rebuilt world after every entry, so a caller can observe
   * the campaign as it happened rather than only where it ended.
   *
   * An observer rather than a second walker, because the walk is not trivial:
   * two legacy exemptions decide the source and the atomicity of each batch by
   * journal version, and a copy of that logic would drift the first time a
   * third exemption is added. There is one reader of the journal.
   */
  observe?: (state: WorldState, entry: JournalEntry) => void,
): ReplayResult {
  const parsed = JournalSchema.parse(journal);
  const seed = parsed.entries[0];
  if (!seed || seed.kind !== 'seed') {
    throw new Error('Journal must begin with a seed entry.');
  }

  let state = createSeedState(seed.playerFactionId);
  let rejectionCount = 0;
  // The opening board, before anything is applied. Without it an observer's
  // first sample is the state AFTER the first batch, so anything that batch
  // changed is invisible — `controlHistory` duly missed a world taken on the
  // campaign's opening move, which is exactly the move most worth recording.
  observe?.(state, seed);

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
    observe?.(state, entry);
  }

  return { state: WorldStateSchema.parse(state), rejectionCount };
}

/**
 * One world changing hands, with the turn it happened on.
 *
 * The epilogue's `gained`/`lost` was a set difference between the opening board
 * and the closing one, which erases exactly the campaigns worth narrating. A
 * playtest's only conquest — Threx, held by Drajk at turn 0, ceded to the Vigil
 * around turn 2, stormed back on turn 8 and held through a counter-attack on
 * turn 10 — cancelled to nothing. Three battles were fought and the ending said
 * *"not one flag planted or struck for good"*, while the Vigil was told it
 * "merely held" after losing a world at gunpoint and eleven hulls.
 *
 * The endpoints are not wrong; they are simply not the story. Both are kept.
 */
export interface ControlChange {
  turn: number;
  systemId: string;
  systemName: string;
  /** Who held it before. `null` is unaligned, which is a real answer here. */
  from: string | null;
  to: string | null;
}

/**
 * Every change of control across a campaign, in the order they happened.
 *
 * Derived from the journal rather than recorded in `WorldState`, deliberately.
 * The journal already holds this — `transfer_control` originates only in
 * arrival resolution and cession, both of which replay exactly — so storing it
 * would be a second source of truth for a fact the first source can already
 * answer, and it would need a schema change, a save-format change and a
 * migration for all 23 saved campaigns to gain nothing.
 *
 * The cost is one extra replay, paid once per campaign at the final bell, on a
 * path that is already making a model call that takes seconds.
 */
export function controlHistory(journal: Journal): ControlChange[] {
  const changes: ControlChange[] = [];
  let held: Map<string, string | null> | null = null;

  replay(journal, (state) => {
    const now = new Map(state.systems.map((sys) => [sys.id, sys.controllerFactionId]));
    // `held === null` only on the seed sample, which is the baseline rather
    // than a change.
    if (held !== null) {
      for (const [id, to] of now) {
        // `has` rather than a truthiness test: `null` is a legitimate holder
        // (unaligned), and a world losing its owner is a change worth naming.
        if (!held!.has(id)) continue;
        const from = held!.get(id) ?? null;
        if (from === to) continue;
        changes.push({
          turn: state.turn,
          systemId: id,
          systemName: state.systems.find((sys) => sys.id === id)?.name ?? id,
          from,
          to,
        });
      }
    }
    held = now;
  });

  return changes;
}
