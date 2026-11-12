import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { buildBriefing, endedLines } from '../src/engine/briefing.js';
import { Campaign } from '../src/engine/campaign.js';

const issue = (extra: Record<string, unknown> = {}) => ({
  op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
  originId: 'ark-1', targetId: 'ark-1', durationTurns: 2, label: 'shipyard', ...extra,
});

/** An order's last state was a line of prose in the log; it is now a record of how it ended. */
describe('how an order leaves the board', () => {
  it('records a recall from the batch that made it', () => {
    const s = applyOps(createSeedState('freeworlds'), [issue()]).state;
    const res = applyOps(s, [{ op: 'cancel_order', orderId: 'ord-0-0' }]);
    expect(res.ended).toEqual([
      expect.objectContaining({ id: 'ord-0-0', label: 'shipyard', factionId: 'freeworlds', reason: 'cancelled' }),
    ]);
  });

  it('records a completion from the tick that finished it', () => {
    let s = applyOps(createSeedState('freeworlds'), [issue({ durationTurns: 1 })]).state;
    const reasons: string[] = [];
    for (let i = 0; i < 6 && s.pendingOrders.length > 0; i++) {
      const t = tickTurn(s);
      s = t.state;
      reasons.push(...(t.report.ended ?? []).map((e) => e.reason));
    }
    expect(reasons).toEqual(['completed']);
  });

  it('records nothing for a batch that was held back', () => {
    const s = applyOps(createSeedState('freeworlds'), [issue()]).state;
    const res = applyOps(s, [{ op: 'cancel_order', orderId: 'ord-0-0' }, { op: 'cancel_order', orderId: 'nope' }], 'engine', undefined, true);
    expect(res.ended).toEqual([]);
  });

  it("carries a turn's recalls into its tick, and the briefing says so", () => {
    const campaign = Campaign.start('freeworlds', 'endings');
    campaign.commit([issue({ durationTurns: 3 })], 'engine', 'yard');
    const id = campaign.state.pendingOrders[0]!.id;
    campaign.commit([{ op: 'cancel_order', orderId: id }], 'engine', 'recall');
    const { report } = campaign.tick();
    expect(report.ended?.map((e) => e.reason)).toEqual(['cancelled']);
    const briefing = buildBriefing(campaign.state, report);
    expect(briefing.ended).toEqual([{ text: 'shipyard at Arkane Prime: recalled.', tone: 'info' }]);
    expect(briefing.quiet).toBe(false);
    // And it is the turn's, not the next one's.
    expect(campaign.tick().report.ended).toEqual([]);
  });

  it("names a rival's interruption, and keeps a power's own covert work from others", () => {
    const s = createSeedState('freeworlds');
    const lines = endedLines(s, {
      completed: [], advanced: [], arrivals: [], battles: [], events: [], ledger: {} as never,
      ended: [
        { id: 'a', label: 'raid', factionId: 'freeworlds', where: 'Tulgarn', reason: 'interrupted', by: 'vigil', covert: true },
        { id: 'b', label: 'secret yards', factionId: 'vigil', where: 'Vantic', reason: 'interrupted', by: 'freeworlds', covert: true },
        { id: 'c', label: 'blockade', factionId: 'meridian', where: 'Sennex', reason: 'lost', covert: false },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      'raid at Tulgarn: interrupted by Iron Vigil Remnant.',
      "You stood down Iron Vigil Remnant's work at Vantic.",
    ]);
  });
});
