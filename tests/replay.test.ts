import { describe, expect, it } from 'vitest';
import { emptyJournal, replay, type Journal } from '../src/engine/journal.js';
import { Campaign } from '../src/engine/campaign.js';
import { fleetStrengthOf, MAX_NARRATIVE_CREDITS } from '../src/domain/state.js';

/**
 * Replay is what makes prompt changes evaluable, so it is held to a strict
 * standard: rebuilding from the journal must produce byte-identical state,
 * with no model calls (PAXGALACTICA_NO_NETWORK=1 makes any attempt throw).
 */

const journalWith = (entries: Journal['entries']): Journal => ({
  version: 1,
  entries: [{ kind: 'seed', playerFactionId: 'freeworlds' }, ...entries],
});

describe('journal replay', () => {
  it('rebuilds turn-0 state from a bare seed', () => {
    const { state } = replay(emptyJournal('hutt'));
    expect(state.turn).toBe(0);
    expect(state.playerFactionId).toBe('hutt');
    expect(state.systems).toHaveLength(25);
    expect(state.factions).toHaveLength(5);
  });

  it('rejects a journal that does not begin with a seed', () => {
    expect(() => replay({ version: 1, entries: [{ kind: 'tick' }] })).toThrow(/seed/i);
  });

  it('reproduces the same state on every run', () => {
    const journal = journalWith([
      {
        kind: 'ops',
        source: 'model',
        label: 'build',
        ops: [
          {
            op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
            originId: 'ark-1', targetId: 'ark-1', durationTurns: 5, label: 'shipyard',
          },
        ],
      },
      { kind: 'tick' },
      { kind: 'tick' },
      {
        kind: 'ops',
        source: 'model',
        label: 'move',
        ops: [
          { op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement', originId: 'ark-3', targetId: 'slu-6' },
        ],
      },
      { kind: 'tick' },
      { kind: 'tick' },
    ]);

    const a = replay(journal).state;
    const b = replay(journal).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.turn).toBe(4);
    expect(a.systems.find((s) => s.id === 'slu-6')!.controllerFactionId).toBe('freeworlds');
    expect(a.pendingOrders.find((o) => o.label === 'shipyard')!.progress).toBe(4);
  });

  it('replays a works programme, payload and payment and all', () => {
    const journal = journalWith([
      {
        kind: 'ops',
        source: 'model',
        label: 'develop',
        ops: [
          {
            op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
            originId: 'ark-1', targetId: 'ark-3', durationTurns: 3, label: 'orbital works',
            onComplete: { kind: 'develop_system', magnitude: 2 },
          },
        ],
      },
      { kind: 'tick' },
      { kind: 'tick' },
      { kind: 'tick' },
    ]);

    const a = replay(journal).state;
    const b = replay(journal).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // The programme landed: ark-3 starts at 5 and the payload is worth 2.
    expect(a.systems.find((s) => s.id === 'ark-3')!.strategicValue).toBe(7);
    expect(a.pendingOrders).toHaveLength(0);
  });

  it('replays a journal written before payloads existed', () => {
    // `onComplete` is optional and `investedCredits` defaults, so an order
    // recorded by an older build still rebuilds rather than failing validation.
    const journal = journalWith([
      {
        kind: 'ops',
        source: 'model',
        label: 'old build',
        ops: [
          {
            op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
            originId: 'ark-1', targetId: 'ark-1', durationTurns: 3, label: 'shipyard',
          },
        ],
      },
      { kind: 'tick' },
    ]);
    const { state } = replay(journal);
    const order = state.pendingOrders.find((o) => o.label === 'shipyard')!;
    expect(order.onComplete).toBeUndefined();
    expect(order.investedCredits).toBe(0);
  });

  it('replays rejections identically rather than diverging', () => {
    const journal = journalWith([
      {
        kind: 'ops',
        source: 'model',
        label: 'bad batch',
        ops: [
          { op: 'transfer_control', systemId: 'tio-3', toFactionId: 'freeworlds' },
          { op: 'not_a_real_op' },
          { op: 'adjust_credits', factionId: 'freeworlds', delta: 250 },
        ],
      },
    ]);
    const first = replay(journal);
    const second = replay(journal);
    expect(first.rejectionCount).toBe(2);
    expect(second.rejectionCount).toBe(2);
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
    // The valid op in the batch still landed.
    expect(first.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(1350);
    // The reducer-only op did not.
    expect(first.state.systems.find((s) => s.id === 'tio-3')!.controllerFactionId).toBe('vigil');
  });
});

describe('campaign / journal agreement', () => {
  it('keeps live state and replayed state identical as a campaign progresses', () => {
    const campaign = Campaign.start('meridian', 'test-campaign');

    campaign.commit(
      [
        {
          op: 'issue_order', factionId: 'meridian', type: 'espionage',
          originId: 'slu-1', targetId: 'tio-3', durationTurns: 3, label: 'listening post',
        },
      ],
      'model',
      'turn 1',
    );
    expect(campaign.verifyReplay().ok).toBe(true);

    campaign.tick();
    campaign.tick();
    expect(campaign.verifyReplay().ok).toBe(true);

    campaign.commit(
      [{ op: 'adjust_disposition', factionId: 'meridian', towardFactionId: 'vigil', delta: -15 }],
      'model',
      'turn 3',
    );
    campaign.tick();

    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
    expect(campaign.state.turn).toBe(3);
    expect(campaign.state.pendingOrders).toHaveLength(0);
  });

  it('keeps staged actions out of the journal until the turn lands', () => {
    const campaign = Campaign.start('freeworlds', 'test-staging');
    const journalBefore = campaign.journal.entries.length;

    // Within MAX_NARRATIVE_CREDITS, so nothing is trimmed and the arithmetic
    // below stays about staging rather than about the cap.
    campaign.stage(
      [{ op: 'adjust_credits', factionId: 'freeworlds', delta: -200 }],
      'buy something',
    );

    // The preview shows the consequence immediately...
    expect(campaign.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(900);
    expect(campaign.stagedCount).toBe(1);
    // ...but nothing has been journaled, and replay still sees the old world.
    expect(campaign.journal.entries).toHaveLength(journalBefore);
    expect(replay(campaign.journal).state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(
      1100,
    );
    expect(campaign.verifyReplay().ok).toBe(true);

    const { applied } = campaign.commitTurn();
    expect(applied).toBe(1);
    expect(campaign.stagedCount).toBe(0);
    expect(campaign.journal.entries).toHaveLength(journalBefore + 1);
    expect(replay(campaign.journal).state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(
      900,
    );
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('lets a second declaration see the first, so credits cannot be double-spent', () => {
    const campaign = Campaign.start('freeworlds', 'test-preview');
    // Six batches at the narrative-credit cap rather than two oversized ones:
    // the point is that the second declaration sees what the first spent, and
    // a single op above MAX_NARRATIVE_CREDITS would be trimmed instead.
    for (let i = 0; i < 6; i++) {
      campaign.stage(
        [{ op: 'adjust_credits', factionId: 'freeworlds', delta: -MAX_NARRATIVE_CREDITS }],
        `spend ${i}`,
      );
    }
    // 1100 against 6 x 240 committed in order, floored at 0 rather than negative.
    expect(campaign.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(0);
    campaign.commitTurn();
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('reports only the ops that landed, never the ones the reducer refused', () => {
    // The first version of this returned the PROPOSED list, and a playtest
    // correctly called it out: an auditor diffing a narrative against it would
    // confirm an effect that never happened, which is the exact bug class the
    // field exists to expose.
    const campaign = Campaign.start('freeworlds', 'test-applied');
    campaign.stage(
      [
        // Legal.
        { op: 'adjust_credits', factionId: 'freeworlds', delta: -50 },
        // Reducer-only: rejected, and must not appear in the reported ops.
        { op: 'transfer_control', systemId: 'tio-3', toFactionId: 'freeworlds' },
      ],
      'one good, one refused',
    );
    const reported = campaign.opsStagedSince(0) as { op: string }[];
    expect(reported.map((o) => o.op)).toEqual(['adjust_credits']);
    expect(campaign.state.systems.find((s) => s.id === 'tio-3')!.controllerFactionId).toBe('vigil');
  });

  it('journals the actor, so replay applies the same guards the live turn did', () => {
    // `commitTurn` applied each staged batch WITH its actor and journaled it
    // WITHOUT — so replay re-ran every player-declared action as an actorless
    // engine op and skipped every actor-gated guard: the suborn limits, the
    // agent owner check, the doctrine guards, the dissent sign rule,
    // capSelfInflictedLosses, the narrative-credit cap. Live trimmed or
    // rejected; replay applied in full. It hid for as long as it did because
    // those guards mostly reject, and a rejection leaves state alone — nothing
    // staged an op that a guard would *modify* until the credit cap existed.
    const campaign = Campaign.start('freeworlds', 'test-actor');
    campaign.stage(
      [{ op: 'adjust_credits', factionId: 'freeworlds', delta: -(MAX_NARRATIVE_CREDITS + 500) }],
      'an extravagance',
    );
    campaign.commitTurn();

    const entry = campaign.journal.entries.at(-1)!;
    expect(entry.kind).toBe('ops');
    expect((entry as { actor?: string }).actor).toBe('freeworlds');

    // The trim happened once, live, and replay reproduces it exactly.
    const live = campaign.state.factions.find((f) => f.id === 'freeworlds')!.credits;
    expect(live).toBe(1100 - MAX_NARRATIVE_CREDITS);
    expect(replay(campaign.journal).state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(
      live,
    );
    const check = campaign.verifyReplay();
    expect(check.ok, check.detail).toBe(true);
  });

  it('commits staged batches in declaration order', () => {
    const campaign = Campaign.start('freeworlds', 'test-order');
    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'decree',
          originId: 'ark-1', targetId: 'ark-1', durationTurns: 1, label: 'first decree',
        },
      ],
      'a',
    );
    campaign.stage(
      [
        {
          op: 'issue_order', factionId: 'freeworlds', type: 'decree',
          originId: 'ark-3', targetId: 'ark-3', durationTurns: 1, label: 'second decree',
        },
      ],
      'b',
    );
    const preview = campaign.state.pendingOrders.map((o) => o.id);
    campaign.commitTurn();
    expect(campaign.state.pendingOrders.map((o) => o.id)).toEqual(preview);
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('discards staged actions cleanly, restoring the committed world', () => {
    const campaign = Campaign.start('freeworlds', 'test-discard');
    const before = fleetStrengthOf(campaign.state, 'freeworlds');
    campaign.stage([{ op: 'adjust_fleet', factionId: 'freeworlds', delta: 50 }], 'muster');
    // 1100 credits buys 18 hulls at 60 apiece; the other 32 are never laid
    // down. What matters here is that discarding restores whatever landed.
    const mustered = fleetStrengthOf(campaign.state, 'freeworlds');
    expect(mustered).toBeGreaterThan(before);

    expect(campaign.discardStaged()).toBe(1);
    expect(campaign.stagedCount).toBe(0);
    expect(fleetStrengthOf(campaign.state, 'freeworlds')).toBe(before);
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('surfaces a rejection at declaration time, not at end of turn', () => {
    const campaign = Campaign.start('freeworlds', 'test-reject');
    const res = campaign.stage(
      [{ op: 'transfer_control', systemId: 'tio-3', toFactionId: 'freeworlds' }],
      'seize it',
    );
    expect(res.rejections.map((r) => r.code)).toEqual(['reducer_only']);
    campaign.commitTurn();
    expect(campaign.state.systems.find((s) => s.id === 'tio-3')!.controllerFactionId).toBe('vigil');
  });

  it('records transcripts outside the journal, since talk is not world state', () => {
    const campaign = Campaign.start('krayt', 'test-transcripts');
    campaign.recordTranscript('hutt', [
      { speaker: 'player', text: 'We want the spice lanes.' },
      { speaker: 'faction', text: 'Everyone does.' },
    ]);
    expect(campaign.priorTranscripts('hutt')).toHaveLength(1);
    expect(campaign.priorTranscripts('hutt')[0]).toMatch(/spice lanes/);
    // Nothing said in a channel reaches world state on its own.
    expect(campaign.verifyReplay().ok).toBe(true);
    expect(campaign.state.eventLog.filter((e) => e.kind === 'diplomacy')).toHaveLength(0);
  });
});
