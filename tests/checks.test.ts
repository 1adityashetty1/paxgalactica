import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_BANDS,
  resolveCheck,
  rollD20,
  statModifier,
  STAT_NAMES,
} from '../src/domain/checks.js';
import { createSeedState } from '../src/seed/scenario.js';
import { fleetStrengthOf, ledgerFor, TRADE_INCOME_MULTIPLIER } from '../src/domain/state.js';
import { tickTurn } from '../src/domain/reducer.js';

describe('ability modifiers', () => {
  it('follows the D&D curve', () => {
    expect(statModifier(1)).toBe(-5);
    expect(statModifier(8)).toBe(-1);
    expect(statModifier(10)).toBe(0);
    expect(statModifier(11)).toBe(0);
    expect(statModifier(14)).toBe(2);
    expect(statModifier(20)).toBe(5);
  });
});

describe('deterministic dice', () => {
  it('always returns a legal d20 face', () => {
    for (let turn = 0; turn < 60; turn++) {
      const roll = rollD20(turn, `action-${turn}`);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
      expect(Number.isInteger(roll)).toBe(true);
    }
  });

  it('is reproducible — the same turn and salt always roll the same', () => {
    // Replay depends on this: nothing may consult a clock or Math.random.
    expect(rollD20(7, 'raid Ithaal')).toBe(rollD20(7, 'raid Ithaal'));
    expect(rollD20(7, 'raid Ithaal')).toBe(rollD20(7, 'raid Ithaal'));
  });

  it('differs across turns and across actions in a turn', () => {
    const acrossTurns = new Set(Array.from({ length: 40 }, (_, t) => rollD20(t, 'same action')));
    expect(acrossTurns.size).toBeGreaterThan(6);
    const withinTurn = new Set(
      Array.from({ length: 40 }, (_, i) => rollD20(3, `${i}:different action`)),
    );
    expect(withinTurn.size).toBeGreaterThan(6);
  });

  it('spreads reasonably across the faces', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const r = rollD20(i % 97, `salt-${i}`);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect(counts.size).toBe(20);
    for (const [, n] of counts) expect(n).toBeGreaterThan(60); // no dead face
  });
});

describe('resolving a check', () => {
  it('succeeds when the total meets the DC', () => {
    expect(resolveCheck('might', 14, 12, 14).outcome).toBe('success');
  });

  it('grants a critical on a natural 20 even against a brutal DC', () => {
    expect(resolveCheck('influence', 6, 20, 25).outcome).toBe('critical_success');
  });

  it('fails on a natural 1 even for a titan', () => {
    expect(resolveCheck('might', 20, 1, 5).outcome).toBe('critical_failure');
  });

  it('gives partial success in the near-miss band, so outcomes are not binary', () => {
    const near = resolveCheck('guile', 10, 8, 10); // total 8 vs 10, margin -2
    expect(near.outcome).toBe('partial');
  });

  it('makes a strong stat measurably better than a weak one', () => {
    const rolls = Array.from({ length: 20 }, (_, i) => i + 1);
    const strong = rolls.filter((r) => resolveCheck('might', 18, r, 14).margin >= 0).length;
    const weak = rolls.filter((r) => resolveCheck('might', 6, r, 14).margin >= 0).length;
    expect(strong).toBeGreaterThan(weak);
  });

  it('reports the arithmetic it used', () => {
    const r = resolveCheck('industry', 16, 11, 13);
    expect(r.modifier).toBe(3);
    expect(r.total).toBe(14);
    expect(r.margin).toBe(1);
  });
});

describe('difficulty bands', () => {
  it('are ordered and span the legal DC range', () => {
    const dcs = DIFFICULTY_BANDS.map((b) => b.dc);
    expect([...dcs].sort((a, b) => a - b)).toEqual(dcs);
    expect(Math.min(...dcs)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...dcs)).toBeLessThanOrEqual(25);
  });
});

describe('faction differentiation', () => {
  const state = createSeedState('freeworlds');

  it('gives every faction a full character sheet', () => {
    for (const f of state.factions) {
      expect(f.voice.length, f.id).toBeGreaterThan(40);
      expect(f.redLines.length, f.id).toBeGreaterThan(0);
      expect(f.buildBias.length, f.id).toBeGreaterThan(0);
      for (const s of STAT_NAMES) expect(f.stats[s], `${f.id}.${s}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('makes no two factions mechanically identical', () => {
    const fingerprints = state.factions.map((f) =>
      STAT_NAMES.map((s) => f.stats[s]).join(','),
    );
    expect(new Set(fingerprints).size).toBe(state.factions.length);
  });

  it('spreads war and trade ethics rather than reusing one', () => {
    expect(new Set(state.factions.map((f) => f.warEthic)).size).toBeGreaterThan(2);
    expect(new Set(state.factions.map((f) => f.tradeEthic)).size).toBeGreaterThan(2);
  });

  it('gives each faction a different strongest stat or build instinct', () => {
    const best = state.factions.map(
      (f) => [...STAT_NAMES].sort((a, b) => f.stats[b] - f.stats[a])[0],
    );
    const biases = state.factions.map((f) => f.buildBias[0]);
    // Not all five need a unique peak stat, but the pairing must be distinct.
    const pairs = best.map((b, i) => `${b}/${biases[i]}`);
    expect(new Set(pairs).size).toBe(state.factions.length);
  });
});

describe('economy', () => {
  const state = createSeedState('freeworlds');

  it('pays income by strategic value and charges upkeep by fleet', () => {
    const ledger = ledgerFor(state, 'freeworlds');
    expect(ledger.systems).toBe(4);
    expect(ledger.gross).toBeGreaterThan(0);
    // Upkeep is charged on the DERIVED fleet — the ships actually on the board,
    // not a separate global number that could drift from them.
    expect(ledger.upkeep).toBe(fleetStrengthOf(state, 'freeworlds') * 4);
    expect(ledger.net).toBe(ledger.gross - ledger.upkeep + ledger.treatyFlow - ledger.espionageLoss);
  });

  it('lets trade ethic change what the same holdings earn, and how', () => {
    // The territorial multiplier now runs the OTHER way: an autarkist wrings
    // more out of its own worlds precisely because it has renounced the
    // network. The free trader's advantage is the network, so comparing the
    // two on territory alone measures the wrong half of each doctrine.
    expect(TRADE_INCOME_MULTIPLIER.autarkic).toBeGreaterThan(
      TRADE_INCOME_MULTIPLIER.free_trade,
    );

    // What matters is the total. Same faction, same map, different beliefs.
    const earnings = (ethic: (typeof TRADE_INCOME_MULTIPLIER) extends Record<infer K, number> ? K : never) => {
      const world = createSeedState('meridian');
      world.factions.find((f) => f.id === 'meridian')!.tradeEthic = ethic;
      return ledgerFor(world, 'meridian');
    };

    const open = earnings('free_trade');
    const closed = earnings('autarkic');
    expect(closed.territory).toBeGreaterThan(open.territory);
    expect(open.routes).toBeGreaterThan(closed.routes);
    // On a hub-rich holding the network is worth more than the premium at
    // home, which is why Meridian is the free trader and not the recluse.
    expect(open.gross).toBeGreaterThan(closed.gross);
  });

  it('credits every faction on tick, deterministically', () => {
    const before = state.factions.map((f) => f.credits);
    const a = tickTurn(state);
    const b = tickTurn(state);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const after = a.state.factions.map((f) => f.credits);
    expect(after).not.toEqual(before);
    // Input is untouched: the reducer stays pure.
    expect(state.factions.map((f) => f.credits)).toEqual(before);
  });

  it('never drives a treasury negative', () => {
    const broke = createSeedState('krayt');
    broke.factions.find((f) => f.id === 'krayt')!.credits = 0;
    // Ruinous upkeep, expressed the only way it can be now: actual hulls.
    broke.systems.find((s) => s.id === 'ark-5')!.ships['krayt'] = 900;
    const res = tickTurn(broke);
    expect(res.state.factions.find((f) => f.id === 'krayt')!.credits).toBe(0);
  });
});

describe('turn report', () => {
  it('describes what advanced, what finished, and the ledger', () => {
    const state = createSeedState('freeworlds');
    const withOrder = tickTurn({
      ...state,
      pendingOrders: [
        {
          id: 'ord-0-0',
          factionId: 'freeworlds',
          type: 'fortification',
          originId: 'ark-1',
          targetId: 'ark-1',
          durationTurns: 3,
          progress: 0,
          interruptible: true,
          onInterrupt: 'partial',
          visibility: [],
          label: 'Arkanis works',
          durationRationale: '',
          path: [],
        },
      ],
    });

    expect(withOrder.report.advanced).toHaveLength(1);
    expect(withOrder.report.advanced[0]!.remaining).toBe(2);
    expect(withOrder.report.advanced[0]!.label).toBe('Arkanis works');
    expect(withOrder.report.completed).toHaveLength(0);
    expect(withOrder.report.ledger.systems).toBe(4);
  });
});
