import { describe, expect, it } from 'vitest';
import { DeclaredRulingSchema, rulingToAppraisal } from '../src/domain/ops.js';
import { holdToRuling, opsAsRuled } from '../src/domain/refusals.js';
import { Campaign } from '../src/engine/campaign.js';
import { applyBonus } from '../src/engine/turn.js';

/**
 * A declaration produces what was ruled (`docs/design-2026-10-18-code-knows.md`
 * §4): an op that reaches into another power's business needs its reach named
 * before the roll, and a critical success's bonus comes off a closed menu.
 */

describe('an op that reaches another power needs its reach ruled', () => {
  const interrupt = { op: 'interrupt_order', orderId: 'ord-1-0', reason: 'a flourish' };

  it('drops a rival order stood down, and keeps the actor’s own', () => {
    expect(opsAsRuled([interrupt], [], ['ord-1-0']).ops).toEqual([]);
    expect(opsAsRuled([interrupt], ['their_orders'], ['ord-1-0']).ops).toEqual([interrupt]);
    expect(opsAsRuled([interrupt], [], []).ops).toEqual([interrupt]);
  });

  it('holds paper, crews and coercion the same way, and passes a power’s own business', () => {
    const ops = [
      { op: 'break_treaty', treatyId: 'tre-0-1' },
      { op: 'suborn_crews', factionId: 'meridian', fromFactionId: 'vigil', systemId: 'tor-3', count: 1 },
      { op: 'post_bounty', factionId: 'meridian', targetFactionId: 'drajk', amount: 50 },
      { op: 'fortify', factionId: 'meridian', systemId: 'sek-1', magnitude: 1 },
    ];
    const held = opsAsRuled(ops, ['coercion'], []);
    expect(held.ops.map((o) => (o as { op: string }).op)).toEqual(['post_bounty', 'fortify']);
    expect(held.dropped).toEqual(['break_treaty', 'suborn_crews']);
  });

  it('is part of every batch held to the ruling', () => {
    const bounds = { covert: [], groundwork: [], stat: 'might', outcome: 'critical_success', establishes: undefined, yields: [], sentOnly: false, foreignOrders: ['ord-1-0'] };
    const held = holdToRuling([interrupt], bounds);
    expect(held.ops).toEqual([]);
    expect(held.notes.join(' ')).toMatch(/reaches into another power's business only as it was ruled/);
  });

  it('is carried from the ruling to the appraisal', () => {
    const ruling = DeclaredRulingSchema.parse({
      kind: 'act',
      parts: [{ kind: 'overt', what: 'press the Vigil', stat: 'influence', difficulty: 12, reaches: ['coercion'] }],
    });
    expect(rulingToAppraisal(ruling).reaches).toEqual(['coercion']);
  });
});

describe('a critical success’s bonus is priced in code', () => {
  const credits = (c: Campaign) => c.state.factions.find((f) => f.id === 'meridian')!.credits;

  it('cost_avoided: a quarter of what the declaration spent comes back', () => {
    const campaign = Campaign.start('meridian', 'bonus-cost');
    const before = credits(campaign);
    campaign.stage([{ op: 'spend', factionId: 'meridian', amount: 200 }], 'spend', '', 'model', 'meridian', { path: 'declared' });
    const notes = applyBonus(campaign, 'cost_avoided', before, new Set(), []);
    expect(before - credits(campaign)).toBe(150);
    expect(notes.join(' ')).toMatch(/50 credits/);
  });

  it('tempo: the declaration’s own new order drops a bucket, free', () => {
    const campaign = Campaign.start('meridian', 'bonus-tempo');
    const orders = new Set(campaign.state.pendingOrders.map((o) => o.id));
    campaign.stage([{ op: 'fortify', factionId: 'meridian', systemId: 'sek-1', magnitude: 1, durationTurns: 3 }], 'walls', '', 'model', 'meridian', { path: 'declared' });
    const fresh = campaign.state.pendingOrders.find((o) => !orders.has(o.id))!;
    const before = credits(campaign);
    applyBonus(campaign, 'tempo', before, orders, []);
    expect(campaign.state.pendingOrders.find((o) => o.id === fresh.id)!.durationTurns).toBeLessThan(fresh.durationTurns);
    expect(credits(campaign)).toBe(before);
  });

  it('goodwill: the power the act named most warms to the actor', () => {
    const campaign = Campaign.start('meridian', 'bonus-goodwill');
    const view = () => campaign.state.factions.find((f) => f.id === 'vigil')!.disposition.meridian ?? 0;
    const before = view();
    applyBonus(campaign, 'goodwill', 0, new Set(), [{ op: 'pay', factionId: 'meridian', to: 'vigil', amount: 10 }]);
    expect(view()).toBe(before + 3);
  });
});
