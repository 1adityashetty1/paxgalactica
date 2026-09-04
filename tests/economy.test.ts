import { ordersVisibleTo } from '../src/domain/intel.js';
import { describe, expect, it } from 'vitest';
import { applyOps, tickTurn, MAX_ATTRITION_FRACTION } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';
import { AGENT_COST, MISSION_PROFILE } from '../src/domain/diplomacy.js';
import { COMMITMENT_GOODWILL } from '../src/domain/arbitration.js';
import {
  agentsVisibleTo,
  effectiveStats,
  ledgerFor,
  fleetStrengthOf,
  SHIP_COST,
  UPKEEP_PER_FLEET_POINT,
  systemIncome,
  treatiesFor,
  warsFor,
  type WorldState,
  AGENT_UPKEEP,
  maxAgentsFor,
  MAX_TREATY_INCOME_PER_TURN,
} from '../src/domain/state.js';
import type { OpInput as Op } from '../src/domain/ops.js';

const fresh = (): WorldState => createSeedState('freeworlds');
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

describe('per-system income', () => {
  it('pays a wholly owned system entirely to its owner', () => {
    const state = fresh();
    const income = systemIncome(state, sys(state, 'ark-1'));
    expect(income.contested).toBe(false);
    expect(Object.keys(income.shares)).toEqual(['freeworlds']);
    expect(income.shares['freeworlds']).toBe(income.base);
  });

  it('splits a contested system between holder and intruder', () => {
    const state = fresh();
    // Iron Vigil parks ships over a Free Worlds world.
    const target = sys(state, 'ark-1');
    target.ships['vigil'] = 6;

    const income = systemIncome(state, target);
    expect(income.contested).toBe(true);
    expect(income.shares['freeworlds']).toBeGreaterThan(0);
    expect(income.shares['vigil']).toBeGreaterThan(0);
    // The holder administers; the intruder only extracts.
    expect(income.shares['freeworlds']!).toBeGreaterThan(income.shares['vigil']!);
    const total = income.shares['freeworlds']! + income.shares['vigil']!;
    expect(Math.abs(total - income.base)).toBeLessThanOrEqual(1);
  });

  it('pays an unaligned, unoccupied system to nobody', () => {
    const state = fresh();
    // Neutral worlds are not free money lying on the table.
    const income = systemIncome(state, sys(state, 'slu-3'));
    expect(Object.keys(income.shares)).toHaveLength(0);
  });

  it('pays an unaligned system to whoever occupies it', () => {
    const state = fresh();
    const neutral = sys(state, 'slu-3');
    neutral.ships['hutt'] = 3;
    neutral.ships['krayt'] = 1;
    const income = systemIncome(state, neutral);
    expect(income.shares['hutt']!).toBeGreaterThan(income.shares['krayt']!);
  });

  it('pays a neutral system through a treaty, which is the only way', () => {
    const state = fresh();
    const res = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['freeworlds', 'meridian'],
          terms: { incomeShares: [{ systemId: 'slu-3', factionId: 'freeworlds', share: 0.5 }] },
          summary: 'Ithaal concession',
        },
      ],
      'extraction',
    );
    expect(res.rejections).toHaveLength(0);
    const income = systemIncome(res.state, sys(res.state, 'slu-3'));
    expect(income.shares['freeworlds']).toBe(Math.round(income.base * 0.5));
    expect(income.byTreaty).toContain('freeworlds');
  });

  it('never pays out more than a system is worth', () => {
    const state = fresh();
    const res = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['freeworlds', 'meridian'],
          terms: {
            incomeShares: [
              { systemId: 'slu-3', factionId: 'freeworlds', share: 0.8 },
              { systemId: 'slu-3', factionId: 'meridian', share: 0.8 },
            ],
          },
        },
      ],
      'extraction',
    );
    const income = systemIncome(res.state, sys(res.state, 'slu-3'));
    const total = Object.values(income.shares).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(income.base + 1);
  });
});

describe('ledgers', () => {
  it('counts treaty transfers and espionage losses separately', () => {
    const state = fresh();
    const res = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'tribute',
          parties: ['freeworlds', 'hutt'],
          // Within `MAX_TREATY_INCOME_PER_TURN`, so nothing is trimmed and
          // this stays a test about which side the flow lands on.
          terms: { incomePerTurn: { freeworlds: -50, hutt: 50 } },
        },
      ],
      'extraction',
    );
    const mine = ledgerFor(res.state, 'freeworlds');
    expect(mine.treatyFlow).toBe(-50);
    expect(ledgerFor(res.state, 'hutt').treatyFlow).toBe(50);
  });

  /**
   * A per-turn treaty flow is the one term that compounds, and it was
   * unbounded — so the same payment refused at 990 as a one-off was accepted
   * at 300 *per turn*, forever, which made the one-off cap theatre. Trimmed
   * rather than rejected: the arrangement is real at a smaller number.
   */
  it('trims a treaty flow to the per-turn ceiling, in both directions', () => {
    const res = applyOps(
      fresh(),
      [
        {
          op: 'form_treaty',
          treatyType: 'tribute',
          parties: ['freeworlds', 'hutt'],
          terms: { incomePerTurn: { freeworlds: -300, hutt: 300 } },
        },
      ],
      'extraction',
    );
    expect(res.rejections).toHaveLength(0);
    expect(ledgerFor(res.state, 'hutt').treatyFlow).toBe(MAX_TREATY_INCOME_PER_TURN);
    expect(ledgerFor(res.state, 'freeworlds').treatyFlow).toBe(-MAX_TREATY_INCOME_PER_TURN);
    expect(res.notes.join(' ')).toMatch(/Trimmed a treaty flow/);
  });

  /**
   * The one test that would catch a term being dropped from `net`.
   *
   * Two tests used to restate the formula as
   * `gross - upkeep + treatyFlow - espionageLoss`, which stopped being the
   * formula when `agentUpkeep` and `commitmentFlow` were added. Both kept
   * passing, because a fresh seed has neither — a restatement that agrees with
   * the code only where the code does nothing. So this drives every term
   * non-zero at once, which is the only arrangement that can fail.
   */
  it('accounts for every term in net, with all of them in play at once', () => {
    const state = fresh();
    const res = applyOps(
      state,
      [
        // pays out
        {
          op: 'form_treaty', treatyType: 'tribute', parties: ['freeworlds', 'hutt'],
          terms: { incomePerTurn: { freeworlds: -150, hutt: 150 } },
        },
        // skimmed by a rival
        {
          op: 'deploy_agent', ownerFactionId: 'hutt', systemId: 'ark-1',
          mission: 'theft', effect: { kind: 'income_penalty', perTurn: 60 },
        },
        // runs an operative of its own
        {
          op: 'deploy_agent', ownerFactionId: 'freeworlds', systemId: 'kes-1',
          mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 },
        },
        // and holds an arrangement that pays
        {
          op: 'establish_commitment', kind: 'salvage_charter', factionIds: ['freeworlds'],
          text: 'Salvage rights across the Drift.', incomePerTurn: 20,
        },
      ],
      // `engine`, not `extraction`: this is a fixture building a board with
      // every ledger term non-zero, not a test of where ops may come from. An
      // accord cannot place an agent (see `EXTRACTION_ALLOWED`), and using the
      // negotiated source here would be testing the guard by accident.
      'engine',
    );
    expect(res.rejections).toEqual([]);

    const l = ledgerFor(res.state, 'freeworlds');
    // Every term is actually exercised, or the assertion below proves nothing.
    for (const term of [l.upkeep, l.treatyFlow, l.espionageLoss, l.agentUpkeep, l.commitmentFlow]) {
      expect(term).not.toBe(0);
    }
    expect(l.gross).toBe(l.territory + l.routes);
    expect(l.net).toBe(
      l.gross - l.upkeep + l.treatyFlow - l.espionageLoss - l.agentUpkeep + l.commitmentFlow,
    );
  });

  it('docks income for a hostile agent skimming a system', () => {
    const state = fresh();
    const before = ledgerFor(state, 'freeworlds').net;
    const res = applyOps(
      state,
      [
        {
          op: 'deploy_agent',
          ownerFactionId: 'hutt',
          systemId: 'ark-1',
          mission: 'theft',
          effect: { kind: 'income_penalty', perTurn: 60 },
        },
      ],
      'model',
    );
    const after = ledgerFor(res.state, 'freeworlds');
    expect(after.espionageLoss).toBe(60);
    expect(after.net).toBe(before - 60);
  });
});

describe('agents', () => {
  const withAgent = (effect: unknown, owner = 'hutt', system = 'ark-1') =>
    applyOps(
      fresh(),
      [{ op: 'deploy_agent', ownerFactionId: owner, systemId: system, mission: 'sabotage', effect }],
      'model',
    );

  it('computes success chance in code, not from the model', () => {
    const res = withAgent({ kind: 'hull_damage', perTurn: 3 });
    const agent = res.state.agents[0]!;
    // Nar guile 18 vs Free Worlds resolve 19 → slightly unfavourable.
    expect(agent.successChance).toBeGreaterThan(0);
    expect(agent.successChance).toBeLessThan(100);
    expect(agent.successChance).toBe(50 + (18 - 19) * 6);
  });

  it('debuffs a stat while in place, and only for the target', () => {
    const res = withAgent({ kind: 'stat_debuff', stat: 'industry', magnitude: 3 });
    expect(effectiveStats(res.state, 'freeworlds').industry).toBe(10 - 3);
    expect(effectiveStats(res.state, 'hutt').industry).toBe(12);
  });

  it('stops having any effect once exposed', () => {
    const res = withAgent({ kind: 'stat_debuff', stat: 'industry', magnitude: 3 });
    res.state.agents[0]!.exposed = true;
    expect(effectiveStats(res.state, 'freeworlds').industry).toBe(10);
  });

  it('resolves deterministically on tick', () => {
    const res = withAgent({ kind: 'hull_damage', perTurn: 4 });
    const a = tickTurn(res.state);
    const b = tickTurn(res.state);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('rejects an agent on an unknown system', () => {
    const res = applyOps(
      fresh(),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'hutt', systemId: 'nowhere',
          mission: 'theft', effect: { kind: 'income_penalty', perTurn: 10 },
        },
      ],
      'model',
    );
    expect(res.rejections.map((r) => r.code)).toEqual(['unknown_system']);
  });

  it('recalls an agent, and 404s an unknown one', () => {
    const res = withAgent({ kind: 'hull_damage', perTurn: 3 });
    const id = res.state.agents[0]!.id;
    expect(applyOps(res.state, [{ op: 'recall_agent', agentId: id }]).state.agents).toHaveLength(0);
    expect(
      applyOps(res.state, [{ op: 'recall_agent', agentId: 'nope' }]).rejections.map((r) => r.code),
    ).toEqual(['unknown_agent']);
  });
});

describe('every mission is mechanically distinct', () => {
  const place = (mission: string, effect: unknown, state = fresh()) =>
    applyOps(
      state,
      [{ op: 'deploy_agent', ownerFactionId: 'hutt', systemId: 'ark-1', mission, effect }],
      'model',
    ).state;

  it('intel actually reveals the target’s hidden orders', () => {
    // The whole point of surveillance. This was declared and inert before.
    const hidden = applyOps(fresh(), [
      {
        // A capital-ship programme rather than infrastructure: works are
        // visible from orbit and are public by category, which is the point of
        // `PUBLIC_CATEGORIES`. A slipway inside a yard is not.
        op: 'issue_order', factionId: 'freeworlds', type: 'capital_ship_construction',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 3, label: 'secret slipway',
        visibility: [],
      },
    ]).state;

    expect(ordersVisibleTo(hidden, 'hutt')).toHaveLength(0);

    const watched = place('surveillance', { kind: 'intel', revealsOrders: true }, hidden);
    expect(ordersVisibleTo(watched, 'hutt').map((o) => o.label)).toEqual(['secret slipway']);
  });

  it('stops revealing once the watcher is burned', () => {
    const hidden = applyOps(fresh(), [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'espionage',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 2, label: 'quiet work',
        visibility: [],
      },
    ]).state;
    const watched = place('surveillance', { kind: 'intel', revealsOrders: true }, hidden);
    watched.agents[0]!.exposed = true;
    expect(ordersVisibleTo(watched, 'hutt')).toHaveLength(0);
  });

  it('gives a watcher far less exposure risk than an assassin', () => {
    expect(MISSION_PROFILE.surveillance.exposureRisk).toBeLessThan(
      MISSION_PROFILE.assassination.exposureRisk,
    );
    expect(MISSION_PROFILE.assassination.oneShot).toBe(true);
    expect(MISSION_PROFILE.surveillance.oneShot).toBe(false);
  });

  it('spends an assassin after one attempt, whatever happens', () => {
    // Both outcomes consume the operative: it is a strike, not a posting.
    for (const chance of [100, 0]) {
      const state = place('assassination', { kind: 'hull_damage', perTurn: 4 });
      state.agents[0]!.successChance = chance;
      const after = tickTurn(state).state;
      expect(after.agents, `chance ${chance}`).toHaveLength(0);
    }
  });

  it('leaves a persistent mission in place across turns', () => {
    const state = place('sabotage', { kind: 'hull_damage', perTurn: 2 });
    state.agents[0]!.successChance = 100;
    const after = tickTurn(tickTurn(state).state).state;
    expect(after.agents).toHaveLength(1);
  });

  it('makes a successful assassination hit far harder than routine sabotage', () => {
    // Hulls are destroyed where the operative is, so measure ships at ark-1.
    const at = (st: WorldState) => sys(st, 'ark-1').ships['freeworlds'] ?? 0;
    const base = at(fresh());
    // Keep the multiplied damage inside what is actually parked there, or the
    // comparison measures the floor at zero rather than the multiplier.
    const perTurn = 2;
    expect(base).toBeGreaterThanOrEqual(perTurn * MISSION_PROFILE.assassination.effectMultiplier);

    const sab = place('sabotage', { kind: 'hull_damage', perTurn });
    sab.agents[0]!.successChance = 100;
    expect(base - at(tickTurn(sab).state)).toBe(perTurn);

    const ass = place('assassination', { kind: 'hull_damage', perTurn });
    ass.agents[0]!.successChance = 100;
    expect(base - at(tickTurn(ass).state)).toBe(
      perTurn * MISSION_PROFILE.assassination.effectMultiplier,
    );
  });

  it('collapses relations on a successful killing, even undetected', () => {
    const state = place('assassination', { kind: 'hull_damage', perTurn: 3 });
    state.agents[0]!.successChance = 100;
    const before = state.factions.find((f) => f.id === 'freeworlds')!.disposition['hutt'] ?? 0;
    const after = tickTurn(state).state.factions.find((f) => f.id === 'freeworlds')!;
    expect(after.disposition['hutt']!).toBeLessThan(before);
  });

  it('exposes a failed assassin far more often than a failed watcher', () => {
    // Sweep every turn so the seeded roll varies, and count burns.
    const burned = (mission: string) => {
      let count = 0;
      for (let turn = 0; turn < 40; turn++) {
        const state = place(mission, { kind: 'hull_damage', perTurn: 1 });
        state.turn = turn;
        state.agents[0]!.successChance = 0; // always fails; only exposure varies
        const after = tickTurn(state).state;
        // A spent one-shot is removed, so check the log instead.
        if (after.eventLog.some((e) => /exposes/.test(e.text))) count += 1;
      }
      return count;
    };
    expect(burned('assassination')).toBeGreaterThan(burned('surveillance'));
  });
});

describe('treaties', () => {
  const treaty = (extra: Record<string, unknown> = {}) =>
    applyOps(
      fresh(),
      [
        {
          op: 'form_treaty',
          treatyType: 'ceasefire',
          parties: ['freeworlds', 'vigil'],
          terms: { mutualDefenseTrigger: 'an attack on Arkanis Prime' },
          durationTurns: 3,
          ...extra,
        },
      ],
      'extraction',
    );

  it('records terms and an expiry', () => {
    const res = treaty();
    const t = res.state.treaties[0]!;
    expect(t.expiresTurn).toBe(3);
    expect(t.status).toBe('active');
    expect(treatiesFor(res.state, 'freeworlds')).toHaveLength(1);
  });

  it('lapses on schedule', () => {
    let state = treaty().state;
    for (let i = 0; i < 3; i++) state = tickTurn(state).state;
    expect(state.treaties[0]!.status).toBe('expired');
    expect(treatiesFor(state, 'freeworlds')).toHaveLength(0);
  });

  it('makes an indefinite treaty when no duration is given', () => {
    const res = treaty({ durationTurns: undefined });
    expect(res.state.treaties[0]!.expiresTurn).toBeNull();
  });

  it('costs the breaker standing with the other party', () => {
    const signed = treaty().state;
    const before = signed.factions.find((f) => f.id === 'vigil')!.disposition['freeworlds'] ?? 0;
    const broken = applyOps(signed, [
      { op: 'break_treaty', treatyId: signed.treaties[0]!.id },
    ]).state;
    expect(broken.treaties[0]!.status).toBe('broken');
    expect(broken.factions.find((f) => f.id === 'vigil')!.disposition['freeworlds']!).toBeLessThan(
      before,
    );
  });

  it('rejects a treaty with one party or an unknown faction', () => {
    expect(
      applyOps(
        fresh(),
        [{ op: 'form_treaty', treatyType: 'ceasefire', parties: ['hutt', 'hutt'], terms: {} }],
        'extraction',
      ).rejections.map((r) => r.code),
    ).toEqual(['illegal_value']);
    expect(
      applyOps(
        fresh(),
        [{ op: 'form_treaty', treatyType: 'ceasefire', parties: ['hutt', 'ewoks'], terms: {} }],
        'extraction',
      ).rejections.map((r) => r.code),
    ).toEqual(['unknown_faction']);
  });

  it('counts a peace treaty as ending a war', () => {
    const state = fresh();
    // Vigil sits at -75 toward the Free Worlds in the seed.
    expect(warsFor(state, 'freeworlds')).toContain('vigil');
    const res = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'non_aggression',
          parties: ['freeworlds', 'vigil'],
          terms: {},
        },
      ],
      'extraction',
    );
    expect(warsFor(res.state, 'freeworlds')).not.toContain('vigil');
  });
});

describe('ships in systems', () => {
  it('moves ships in and out, clearing empty entries', () => {
    const added = applyOps(fresh(), [
      { op: 'adjust_ships', systemId: 'slu-3', factionId: 'krayt', delta: 5 },
    ]).state;
    expect(sys(added, 'slu-3').ships['krayt']).toBe(5);

    const removed = applyOps(added, [
      { op: 'adjust_ships', systemId: 'slu-3', factionId: 'krayt', delta: -9 },
    ]).state;
    expect(sys(removed, 'slu-3').ships['krayt']).toBeUndefined();
  });

  it('rejects unknown systems and factions', () => {
    expect(
      applyOps(fresh(), [
        { op: 'adjust_ships', systemId: 'nope', factionId: 'krayt', delta: 1 },
      ]).rejections.map((r) => r.code),
    ).toEqual(['unknown_system']);
  });
});

describe('faction compulsions exist for every power', () => {
  it('gives each faction things its institutions demand', () => {
    for (const f of fresh().factions) {
      expect(f.compulsions.length, f.id).toBeGreaterThan(0);
      expect(f.dissent).toBe(0);
    }
  });

  it('gives Iron Vigil a compulsion against sitting still, and Meridian one against contraband', () => {
    const state = fresh();
    const textOf = (id: string) =>
      state.factions.find((f) => f.id === id)!.compulsions.map((c) => c.text).join(' ');
    expect(textOf('vigil')).toMatch(/complicity|no fleet under way/i);
    expect(textOf('meridian')).toMatch(/spice|slave/i);
  });
});


describe('ships cost money, in code rather than in a prompt', () => {
  const fleet = (s: WorldState, id = 'freeworlds') => fleetStrengthOf(s, id);
  const purse = (s: WorldState, id = 'freeworlds') => s.factions.find((f) => f.id === id)!.credits;

  it('cannot build a thousand ships on eleven hundred credits', () => {
    // The whole point of pricing this in the reducer: "build a thousand ships"
    // is exactly the instruction a model can be argued into emitting.
    const start = fresh();
    const before = fleet(start);
    const res = applyOps(start, [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: 1000 }]);

    const affordable = Math.floor(purse(start) / SHIP_COST);
    expect(fleet(res.state)).toBe(before + affordable);
    expect(purse(res.state)).toBeLessThan(SHIP_COST);
    expect(res.notes.join(' ')).toMatch(/could only pay for/);
    // Not a rejection — the order is partly fulfilled, which is the more
    // useful outcome and matches how a partial check reads.
    expect(res.rejections).toHaveLength(0);
  });

  it('charges exactly the list price for an affordable order', () => {
    const start = fresh();
    const res = applyOps(start, [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: 4 }]);
    expect(fleet(res.state)).toBe(fleet(start) + 4);
    expect(purse(res.state)).toBe(purse(start) - 4 * SHIP_COST);
    expect(res.notes.join(' ')).toMatch(/commissions 4 hulls/);
  });

  it('does not charge for repositioning, in either order', () => {
    const start = fresh();
    const forward = applyOps(start, [
      { op: 'adjust_ships', systemId: 'ark-3', factionId: 'freeworlds', delta: -5 },
      { op: 'adjust_ships', systemId: 'ark-1', factionId: 'freeworlds', delta: 5 },
    ]);
    const reversed = applyOps(start, [
      { op: 'adjust_ships', systemId: 'ark-1', factionId: 'freeworlds', delta: 5 },
      { op: 'adjust_ships', systemId: 'ark-3', factionId: 'freeworlds', delta: -5 },
    ]);
    // Billing net hulls across the batch is what makes this order-independent.
    expect(purse(forward.state)).toBe(purse(start));
    expect(purse(reversed.state)).toBe(purse(start));
    expect(fleet(forward.state)).toBe(fleet(start));
  });

  it('does not treat a departing fleet as scrapped hulls', () => {
    const start = fresh();
    const res = applyOps(start, [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'fleet_movement',
        originId: 'ark-3', targetId: 'slu-6', force: 5, label: 'sortie',
      },
    ]);
    // Ships in transit have left the origin but still exist and still cost.
    expect(fleet(res.state)).toBe(fleet(start));
    expect(purse(res.state)).toBe(purse(start));
  });

  it('never refunds a loss, so hulls cannot be cycled for cash', () => {
    const start = fresh();
    const res = applyOps(start, [{ op: 'adjust_fleet', factionId: 'freeworlds', delta: -5 }]);
    expect(fleet(res.state)).toBe(fleet(start) - 5);
    expect(purse(res.state)).toBe(purse(start));
  });

  it('bills each faction only for its own construction', () => {
    const start = fresh();
    const res = applyOps(start, [
      { op: 'adjust_fleet', factionId: 'freeworlds', delta: 3 },
      { op: 'adjust_fleet', factionId: 'krayt', delta: 2 },
    ]);
    expect(purse(res.state, 'freeworlds')).toBe(purse(start, 'freeworlds') - 3 * SHIP_COST);
    expect(purse(res.state, 'krayt')).toBe(purse(start, 'krayt') - 2 * SHIP_COST);
  });
});

describe('a navy you cannot pay for does not simply sit there', () => {
  it('lays up ships once the treasury is empty', () => {
    // Credits used to floor at zero and nothing else happened, so upkeep was
    // no constraint at all — a vast fleet was sustainable on an empty purse.
    const state0 = fresh();
    // Placed directly rather than bought, so the test is about upkeep and not
    // about whether the yards would have delivered them.
    sys(state0, 'ark-1').ships['freeworlds'] = 600;
    let state = state0;

    let laidUpTurn = -1;
    for (let turn = 1; turn <= 60; turn++) {
      const res = tickTurn(state);
      state = res.state;
      if (res.notes.some((n) => /lays up/.test(n)) && laidUpTurn === -1) laidUpTurn = turn;
    }
    expect(laidUpTurn).toBeGreaterThan(0);

    // It settles at a fleet its income can actually carry, rather than
    // shrinking to nothing or staying at 600 forever.
    const settled = fleetStrengthOf(state, 'freeworlds');
    const ledger = ledgerFor(state, 'freeworlds');
    expect(settled).toBeLessThan(600);
    expect(settled).toBeGreaterThan(0);
    expect(ledger.net).toBeGreaterThanOrEqual(0);
  });

  it('declines gradually rather than collapsing in one turn', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 0;
    sys(state, 'ark-1').ships['freeworlds'] = 400;
    const before = fleetStrengthOf(state, 'freeworlds');

    const after = tickTurn(state).state;
    const lost = before - fleetStrengthOf(after, 'freeworlds');
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(Math.ceil(before * MAX_ATTRITION_FRACTION));
  });

  it('leaves a solvent power alone', () => {
    const state = fresh();
    const before = fleetStrengthOf(state, 'meridian');
    const res = tickTurn(state);
    expect(fleetStrengthOf(res.state, 'meridian')).toBe(before);
    expect(res.notes.join(' ')).not.toMatch(/lays up/);
  });

  it('prices upkeep against the cost of a hull, so a ship pays for itself in fifteen turns', () => {
    // Not an arbitrary pair of numbers: the ratio is what makes expansion a
    // commitment rather than a purchase.
    expect(SHIP_COST / UPKEEP_PER_FLEET_POINT).toBe(15);
  });
});

describe('a covert service costs money and has a ceiling', () => {
  const deploy = (state: WorldState, actor: string, systemId: string, mission = 'surveillance') =>
    applyOps(
      state,
      [
        {
          op: 'deploy_agent', ownerFactionId: actor, systemId,
          mission, effect: { kind: 'intel', revealsOrders: true }, cover: 'broker',
        },
      ],
      'model',
      actor,
    );

  it('charges for placing an operative', () => {
    // Agents used to be free in every sense: no deployment cost, no upkeep,
    // no cap — which made an unbounded spy network strictly dominant.
    const state = fresh();
    const before = state.factions.find((f) => f.id === 'freeworlds')!.credits;
    const res = deploy(state, 'freeworlds', 'ark-2');
    expect(res.rejections).toHaveLength(0);
    expect(res.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(
      before - AGENT_COST.surveillance,
    );
  });

  it('prices a decapitation strike well above a watcher', () => {
    expect(AGENT_COST.assassination).toBeGreaterThan(AGENT_COST.surveillance * 2);
  });

  it('refuses a deployment the treasury cannot cover', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 10;
    const res = deploy(state, 'freeworlds', 'ark-2');
    expect(res.rejections.map((r) => r.code)).toContain('insufficient_credits');
    expect(res.state.agents).toHaveLength(0);
  });

  it('caps simultaneous operatives, scaled off guile', () => {
    // Not a flat constant: the Nars at guile 18 run a real service, the Iron
    // Vigil at 11 manages a couple of watchers.
    const state = fresh();
    expect(maxAgentsFor(state, 'hutt')).toBeGreaterThan(maxAgentsFor(state, 'vigil'));

    let s = fresh();
    s.factions.find((f) => f.id === 'vigil')!.credits = 5000;
    const cap = maxAgentsFor(s, 'vigil');
    const targets = ['ark-2', 'slu-3', 'slu-5', 'slu-6', 'kes-4'];
    for (let i = 0; i < cap; i++) {
      const res = deploy(s, 'vigil', targets[i]!);
      expect(res.rejections, `deployment ${i + 1} of ${cap}`).toHaveLength(0);
      s = res.state;
    }
    const overflow = deploy(s, 'vigil', targets[cap]!);
    expect(overflow.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(overflow.rejections[0]!.message).toMatch(/already running/);
    expect(overflow.state.agents).toHaveLength(cap);
  });

  it('bills live operatives every turn, and burned ones not at all', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 2000;
    const withAgent = deploy(state, 'freeworlds', 'ark-2').state;
    expect(ledgerFor(withAgent, 'freeworlds').agentUpkeep).toBe(AGENT_UPKEEP);

    withAgent.agents[0]!.exposed = true;
    expect(ledgerFor(withAgent, 'freeworlds').agentUpkeep).toBe(0);
  });

  it('subtracts agent upkeep from net income', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.credits = 2000;
    const before = ledgerFor(state, 'freeworlds').net;
    const after = deploy(state, 'freeworlds', 'ark-2').state;
    expect(ledgerFor(after, 'freeworlds').net).toBe(before - AGENT_UPKEEP);
  });
});

/**
 * A treaty is the one op that binds a faction other than the actor, so it is
 * the one op that needs someone else's consent — and consent is a thing only a
 * conversation establishes. `form_treaty` therefore left `ModelOpSchema` and is
 * reachable from the diplomacy extraction pass and nowhere else a model reaches.
 */
describe('a treaty cannot be declared into existence', () => {
  const pact: Op = {
    op: 'form_treaty',
    treatyType: 'mutual_defense',
    parties: ['meridian', 'vigil'],
    terms: { shipsPledged: { vigil: 15 } },
    summary: 'declared, not negotiated',
  } as unknown as Op;

  it('is rejected from a declared action, with somewhere to go instead', () => {
    const out = applyOps(fresh(), [pact], 'model', 'meridian');
    expect(out.rejections.map((r) => r.code)).toEqual(['needs_consent']);
    expect(out.rejections[0]!.message).toMatch(/\/talk/);
    expect(out.state.treaties).toHaveLength(0);
  });

  it('is accepted from the pass that read a transcript', () => {
    const out = applyOps(fresh(), [pact], 'extraction', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.treaties).toHaveLength(1);
  });

  it('leaves repudiation unilateral, because it genuinely is', () => {
    // You do not need the other party's agreement to stop honouring a deal,
    // only a willingness to pay for having stopped.
    const signed = applyOps(fresh(), [pact], 'extraction', 'meridian');
    const id = signed.state.treaties[0]!.id;
    const broken = applyOps(signed.state, [{ op: 'break_treaty', treatyId: id }], 'model', 'meridian');
    expect(broken.rejections).toHaveLength(0);
    expect(broken.state.treaties[0]!.status).not.toBe('active');
  });
});

/**
 * A commitment can bind a faction other than the actor exactly the way a
 * treaty does — a dynastic marriage or a charter naming a partner is not
 * something one side can put in the other's ledger — and for most of this
 * project's life it had no guard at all: `establish_commitment` was declarable
 * directly from an ordinary action, unlike `form_treaty` and `establish_debt`,
 * which left `ModelOpSchema` for exactly this reason. A live playtest reported
 * the arbiter inconsistently redirecting marriage proposals to a channel —
 * traced to `prompts/appraisal.md` contradicting itself on whether marriage
 * belongs in `establishes` (direct) or `negotiation` (consented), and to this
 * guard's absence meaning a direct declaration would have succeeded regardless
 * of which the arbiter picked.
 *
 * Gated on the actor, not unconditionally like the other two: this op has been
 * declarable since before consent was enforced anywhere, and real saves
 * contain commitments written that way with no actor recorded. Those replay
 * exactly, because `actor === undefined` is "a journal from before the actor
 * field existed" everywhere else in the reducer too.
 */
describe('a commitment binding another power needs their consent', () => {
  const marriage: Op = {
    op: 'establish_commitment',
    kind: 'dynastic_marriage',
    factionIds: ['meridian', 'hutt'],
    text: 'declared, not negotiated',
    exclusive: true,
  };

  it('is rejected from a declared action, with somewhere to go instead', () => {
    const out = applyOps(fresh(), [marriage], 'model', 'meridian');
    expect(out.rejections.map((r) => r.code)).toEqual(['needs_consent']);
    expect(out.rejections[0]!.message).toMatch(/\/talk/);
    expect(out.state.commitments).toHaveLength(0);
  });

  it('is accepted from the pass that read a transcript', () => {
    const out = applyOps(fresh(), [marriage], 'extraction', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.commitments).toHaveLength(1);
  });

  it('leaves a commitment naming only the actor declarable, needing nobody', () => {
    const unilateral: Op = {
      op: 'establish_commitment',
      kind: 'salvage_charter',
      factionIds: ['meridian'],
      text: 'Salvage rights across our own space.',
      exclusive: false,
    };
    const out = applyOps(fresh(), [unilateral], 'model', 'meridian');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.commitments).toHaveLength(1);
  });

  it('replays a journal from before the actor field exactly as it ran', () => {
    // No actor passed at all — the same shape a pre-fix journal entry has.
    const out = applyOps(fresh(), [marriage], 'model');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.commitments).toHaveLength(1);
  });
});

/**
 * A commitment's `incomePerTurn` is one number shared by everyone it binds, not
 * a transfer between them.
 *
 * Worth pinning because it is the opposite of what the field's name suggests
 * and of how the analogous treaty term works. `Treaty.terms.incomePerTurn` is a
 * record keyed by faction, so it can say "A pays B"; a commitment's is a scalar
 * every bound party reads the same way. A debt written as a single two-party
 * commitment therefore pays the debtor as well as the creditor — which is
 * exactly the encoding `prompts/extraction.md` briefly recommended before this
 * was measured.
 */
describe('commitment income is shared, not directional', () => {
  it('pays every bound faction the same figure', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'establish_commitment',
          kind: 'debt',
          factionIds: ['hutt', 'freeworlds'],
          text: 'The Free Worlds owe the Combine 400, repaid at 25 a turn.',
          exclusive: false,
          incomePerTurn: 25,
        },
      ],
      // A commitment binding a faction other than the actor now needs the
      // other party's consent, same as a treaty — see the reducer guard on
      // `establish_commitment`. Irrelevant to what this test pins (income
      // shape), so it is declared the way it would really land: extracted
      // from an agreed channel, not as an ordinary action.
      'extraction',
      'hutt',
    );
    expect(out.rejections).toHaveLength(0);
    // Both sides earn. Nobody pays.
    expect(ledgerFor(out.state, 'hutt').commitmentFlow).toBeGreaterThan(0);
    expect(ledgerFor(out.state, 'freeworlds').commitmentFlow).toBeGreaterThan(0);
  });

  it('unlike a treaty, whose terms name each party separately', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'form_treaty',
          treatyType: 'tribute',
          parties: ['freeworlds', 'hutt'],
          terms: { incomePerTurn: { freeworlds: -25, hutt: 25 } },
          summary: 'debt service',
        },
      ],
      'extraction',
      'hutt',
    );
    expect(ledgerFor(out.state, 'hutt').treatyFlow).toBe(25);
    expect(ledgerFor(out.state, 'freeworlds').treatyFlow).toBe(-25);
  });
});

/**
 * Diplomacy is unmetered by action points on the stated grounds that "a channel
 * already blocks the command line and End Turn, which is its own pacing". That
 * holds only while a channel cannot *do* what a declared action does — and it
 * could: extraction could emit `fleet_movement`.
 *
 * Measured in a playtest: an accord staged a movement of 8 hulls, the tick
 * reported "storms Sennex, breaking a garrison of 4 ... takes possession", and
 * the player's action points still read 2/2 afterwards. A world annexed for
 * free, through a conversation.
 */
describe('a fleet movement cannot come out of a negotiation', () => {
  const move: Op = {
    op: 'issue_order',
    factionId: 'freeworlds',
    type: 'fleet_movement',
    originId: 'ark-1',
    targetId: 'ark-2',
    force: 8,
    label: 'a squadron takes station',
  };

  it('is rejected from the extraction pass, pointing at the declared path', () => {
    const out = applyOps(fresh(), [move], 'extraction', 'freeworlds');
    expect(out.rejections.map((r) => r.code)).toEqual(['declared_only']);
    expect(out.state.pendingOrders).toHaveLength(0);
  });

  it('is still perfectly legal as a declared action, which is what costs one', () => {
    const out = applyOps(fresh(), [move], 'model', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    expect(out.state.pendingOrders).toHaveLength(1);
  });

  /**
   * The guard was one exception and everything else walked through it, which
   * made diplomacy an unmetered action channel for 13 of the 14 order types.
   * An accord may now produce only what needs the other party's agreement, or
   * what records the conversation — see `EXTRACTION_ALLOWED`.
   *
   * `treaty_ratification` is the order this test used to allow, and it is the
   * clearest case of why the exception was wrong: a deal gated on ratification
   * is expressed by `form_treaty`'s own `ratifyTurns`, not by an order that
   * carries no payload and completes without producing anything.
   */
  it('refuses an order an accord tried to start, however harmless', () => {
    const out = applyOps(
      fresh(),
      [
        {
          op: 'issue_order',
          factionId: 'freeworlds',
          type: 'treaty_ratification',
          originId: 'ark-1',
          targetId: 'ark-1',
          durationTurns: 2,
          label: 'councils ratify',
        },
      ],
      'extraction',
      'freeworlds',
    );
    expect(out.rejections.map((r) => r.code)).toEqual(['declared_only']);
    expect(out.state.pendingOrders).toHaveLength(0);
    expect(out.rejections[0]!.message).toMatch(/costs an action/);
  });
});

/**
 * Renegotiating a charter added a second treaty and left the first live, so the
 * same system paid the same faction twice and the share ratcheted upward every
 * time — while the op's own summary said "superseding the prior arrangement".
 * Seen live at 5% and 8% on ark-4, both active four turns later.
 */
describe('a renegotiated income share supersedes the old one', () => {
  const charter = (share: number): Op => ({
    op: 'form_treaty',
    treatyType: 'trade_accord',
    parties: ['freeworlds', 'meridian'],
    terms: { incomeShares: [{ systemId: 'ark-4', factionId: 'meridian', share }] },
    summary: `carrier rights at Vashka at ${share * 100}%`,
  });

  it('retires the earlier grant of the same system to the same faction', () => {
    const first = applyOps(fresh(), [charter(0.05)], 'extraction', 'freeworlds');
    expect(first.rejections).toHaveLength(0);
    const second = applyOps(first.state, [charter(0.08)], 'extraction', 'freeworlds');
    expect(second.rejections).toHaveLength(0);

    const active = second.state.treaties.filter((t) => t.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]!.terms.incomeShares[0]!.share).toBe(0.08);
    expect(second.state.treaties.find((t) => t.status === 'superseded')).toBeDefined();
    expect(second.notes.join(' ')).toMatch(/Superseded/);
  });

  it('leaves a grant of a different system alone', () => {
    const first = applyOps(fresh(), [charter(0.05)], 'extraction', 'freeworlds');
    const other: Op = {
      op: 'form_treaty',
      treatyType: 'trade_accord',
      parties: ['freeworlds', 'meridian'],
      terms: { incomeShares: [{ systemId: 'ark-6', factionId: 'meridian', share: 0.05 }] },
      summary: 'a second, unrelated lane',
    };
    const second = applyOps(first.state, [other], 'extraction', 'freeworlds');
    expect(second.state.treaties.filter((t) => t.status === 'active')).toHaveLength(2);
  });
});

/**
 * A commitment with no `incomePerTurn` was mechanically inert, and a playtest
 * closed five accords that each produced exactly one — a war subsidy, a tenth
 * of all prizes, a standing intelligence duty, all decoration. The record is
 * the useful part and the arbiter reads it, so the answer is not to stop
 * recording them but to make the record bite.
 */
describe('a commitment binds people, so it moves how they see each other', () => {
  const bind = (factionIds: string[]): Op => ({
    op: 'establish_commitment',
    kind: 'intelligence_notice',
    factionIds,
    text: 'standing notice of what crosses the lanes',
    exclusive: false,
  });

  const disp = (s: WorldState, who: string, toward: string) =>
    s.factions.find((f) => f.id === who)!.disposition[toward] ?? 0;

  it('raises both parties, even with no money attached', () => {
    const state = fresh();
    const a = disp(state, 'freeworlds', 'hutt');
    const b = disp(state, 'hutt', 'freeworlds');

    const out = applyOps(state, [bind(['freeworlds', 'hutt'])], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    // Zero flow, and still not inert.
    expect(out.state.commitments.at(-1)!.incomePerTurn).toBe(0);
    expect(disp(out.state, 'freeworlds', 'hutt')).toBe(a + COMMITMENT_GOODWILL);
    expect(disp(out.state, 'hutt', 'freeworlds')).toBe(b + COMMITMENT_GOODWILL);
  });

  it('takes it back when the commitment is dissolved', () => {
    const state = fresh();
    const before = disp(state, 'freeworlds', 'hutt');
    const bound = applyOps(state, [bind(['freeworlds', 'hutt'])], 'extraction', 'freeworlds');
    const id = bound.state.commitments.at(-1)!.id;

    const out = applyOps(
      bound.state,
      [{ op: 'dissolve_commitment', commitmentId: id, reason: 'it served its turn' }],
      'model',
      'freeworlds',
    );
    expect(disp(out.state, 'freeworlds', 'hutt')).toBe(before);
  });

  it('moves nothing for a commitment that binds only its author', () => {
    const state = fresh();
    const before = disp(state, 'freeworlds', 'hutt');
    const out = applyOps(state, [bind(['freeworlds'])], 'model', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    expect(disp(out.state, 'freeworlds', 'hutt')).toBe(before);
  });
});
