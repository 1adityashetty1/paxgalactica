import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { EXTRACTION_ALLOWED, ModelOpSchema } from '../src/domain/ops.js';

/**
 * An accord may only produce what needs the other party's agreement, or what
 * records the conversation.
 *
 * The guard used to be one exception — extraction could emit any `issue_order`
 * except a `fleet_movement` — which made diplomacy an unmetered action channel
 * for 13 of the 14 order types. Measured live: a channel closed with
 * `actionPoints: {left: 0}` issued a `courier` order and the count stayed at
 * zero, and a refused accord cost no action point either, which bypasses the
 * entire reason the declared path charges for a refusal.
 */

const seed = () => createSeedState('krayt');
const viaAccord = (op: Record<string, unknown>) =>
  applyOps(seed(), [op], 'extraction', 'krayt', true);
const codes = (r: ReturnType<typeof viaAccord>) => r.rejections.map((x) => x.code);

describe('what an accord may not produce', () => {
  const home = () => createSeedState('krayt').systems.find((x) => x.controllerFactionId === 'krayt')!.id;

  it('refuses an order of any type, not just a fleet movement', () => {
    for (const type of ['courier', 'garrison_raising', 'fortification', 'capital_ship_construction', 'blockade', 'espionage']) {
      const out = viaAccord({
        op: 'issue_order', factionId: 'krayt', type,
        originId: home(), targetId: home(), durationTurns: 2, label: type, visibility: [],
      });
      expect(codes(out), type).toEqual(['declared_only']);
      expect(out.state.pendingOrders, type).toHaveLength(0);
    }
  });

  it('refuses a fleet movement, as it always did', () => {
    const out = viaAccord({
      op: 'issue_order', factionId: 'krayt', type: 'fleet_movement',
      originId: home(), targetId: home(), force: 3, label: 'move', visibility: [],
    });
    expect(codes(out)).toEqual(['declared_only']);
  });

  it('refuses hulls, operatives, doctrine and dissent', () => {
    for (const op of [
      { op: 'adjust_fleet', factionId: 'krayt', delta: 5, reason: 'yards' },
      { op: 'deploy_agent', ownerFactionId: 'krayt', systemId: 'kes-6', mission: 'surveillance', effect: { kind: 'intel', revealsOrders: true } },
      { op: 'set_doctrine', factionId: 'krayt', doctrine: 'a new posture entirely' },
      { op: 'adjust_dissent', factionId: 'krayt', delta: 5, reason: 'x' },
      { op: 'adjust_ships', systemId: 'kes-6', factionId: 'krayt', delta: 3, reason: 'x' },
    ]) {
      expect(codes(viaAccord(op)), String(op.op)).toEqual(['declared_only']);
    }
  });

  it('explains itself in terms a player can act on', () => {
    const out = viaAccord({
      op: 'issue_order', factionId: 'krayt', type: 'fortification',
      originId: home(), targetId: home(), durationTurns: 3, label: 'walls', visibility: [],
    });
    expect(out.rejections[0]!.message).toMatch(/costs an action/);
  });
});

describe('what an accord may still produce', () => {
  it('allows the ops that bind the other party', () => {
    const out = applyOps(seed(), [
      {
        op: 'form_treaty', treatyType: 'tribute', parties: ['krayt', 'hutt'],
        terms: { incomePerTurn: { krayt: 20, hutt: -20 } }, summary: 'a tithe',
      },
      {
        op: 'establish_commitment', kind: 'quiet_understanding',
        factionIds: ['krayt', 'hutt'], text: 'nothing on paper', exclusive: false,
      },
      { op: 'adjust_disposition', factionId: 'hutt', towardFactionId: 'krayt', delta: 5, reason: 'a good hour' },
      { op: 'log_narrative', text: 'They shook on it.' },
    ], 'extraction', 'krayt', true);
    expect(out.rejections).toEqual([]);
    expect(out.state.treaties).toHaveLength(1);
  });

  it('still allows a creditor to act on what was agreed', () => {
    const out = viaAccord({ op: 'forgive_debt', debtId: 'debt-0', reason: 'agreed in the room' });
    // `krayt` is the DEBTOR on debt-0, so this is refused on the actor guard —
    // the point is that it is not refused for coming out of a negotiation.
    expect(codes(out)).not.toContain('declared_only');
  });
});

describe('the allowlist is a closed set, and says so', () => {
  it('contains only ops the model can actually emit, plus the negotiated ones', () => {
    const modelOps = new Set(ModelOpSchema.options.map((o) => o.shape.op.value as string));
    const negotiated = new Set(['form_treaty', 'establish_debt', 'assign_debt']);
    for (const op of EXTRACTION_ALLOWED) {
      expect(modelOps.has(op) || negotiated.has(op), `${op} is not an op anything can emit`).toBe(true);
    }
  });

  it('excludes every order-issuing and unilateral op', () => {
    for (const op of ['issue_order', 'adjust_fleet', 'deploy_agent', 'set_doctrine', 'adjust_dissent', 'adjust_ships', 'cancel_order', 'interrupt_order', 'extend_order', 'accelerate_order', 'recall_agent']) {
      expect(EXTRACTION_ALLOWED.has(op), `${op} should not be reachable from an accord`).toBe(false);
    }
  });
});
