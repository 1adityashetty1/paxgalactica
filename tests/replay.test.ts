import { describe, expect, it } from 'vitest';
import { emptyJournal, replay, type Journal } from '../src/engine/journal.js';
import { Campaign } from '../src/engine/campaign.js';
import { fleetStrengthOf } from '../src/domain/state.js';

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

    campaign.stage(
      [{ op: 'adjust_credits', factionId: 'freeworlds', delta: -300 }],
      'buy something',
    );

    // The preview shows the consequence immediately...
    expect(campaign.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(800);
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
      800,
    );
    expect(campaign.verifyReplay().ok).toBe(true);
  });

  it('lets a second declaration see the first, so credits cannot be double-spent', () => {
    const campaign = Campaign.start('freeworlds', 'test-preview');
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -600 }], 'first');
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -600 }], 'second');
    // 1100 - 600 = 500, then floored at 0 rather than going negative.
    expect(campaign.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(0);
    campaign.commitTurn();
    expect(campaign.verifyReplay().ok).toBe(true);
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
