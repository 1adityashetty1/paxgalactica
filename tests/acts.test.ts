import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import type { WorldState } from '../src/domain/state.js';
import {
  BREACH_KINDS,
  BREACH_PRICES,
  BROKEN_WORD_COST,
  LEGACY_BREACH_PRICES,
  REPUDIATION_REPUTATION_COST,
  breachCharges,
} from '../src/domain/acts.js';
import { PACT_BREAKING_REPUTATION_COST } from '../src/domain/diplomacy.js';
import { COMMITMENT_BREAKING_COST } from '../src/domain/arbitration.js';
import { HEAT_PACT_BROKEN } from '../src/domain/heat.js';

/**
 * A breach of faith is priced once, in `acts.ts` (journal version 24). Before
 * it, eight sites priced the same act five ways — see
 * `docs/design-2026-10-17-acts.md`.
 */

const everyone = ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk'];

/** The movement of `who`'s regard for `toward`, summed over a charge. */
const moved = (charge: ReturnType<typeof breachCharges>, who: string, toward: string): number =>
  charge.regard.filter((m) => m.who === who && m.toward === toward).reduce((n, m) => n + m.delta, 0);

describe('the breach table', () => {
  it('prices every kind, in both tables', () => {
    for (const kind of BREACH_KINDS) {
      expect(BREACH_PRICES[kind].injured).toBeGreaterThan(0);
      expect(LEGACY_BREACH_PRICES[kind].injured).toBeGreaterThan(0);
    }
  });

  it('charges onlookers for repudiating a treaty, at less than an attack under it', () => {
    const c = breachCharges({ kind: 'treaty_repudiated', breaker: 'vigil', parties: ['vigil', 'ojjul'] }, everyone);
    expect(moved(c, 'ojjul', 'vigil')).toBe(-BROKEN_WORD_COST);
    for (const onlooker of ['meridian', 'freeworlds', 'drajk']) expect(moved(c, onlooker, 'vigil')).toBe(-REPUDIATION_REPUTATION_COST);
    expect(REPUDIATION_REPUTATION_COST).toBeGreaterThan(0);
    expect(REPUDIATION_REPUTATION_COST).toBeLessThan(PACT_BREAKING_REPUTATION_COST);
    expect(c.heat).toBe(HEAT_PACT_BROKEN);
  });

  it('does not lower the breaker’s own regard for its victim', () => {
    const c = breachCharges({ kind: 'treaty_repudiated', breaker: 'vigil', parties: ['vigil', 'ojjul'] }, everyone);
    expect(moved(c, 'vigil', 'ojjul')).toBe(0);
  });

  it('charges a commitment’s other parties once, as the injured, and not again as onlookers', () => {
    const c = breachCharges({ kind: 'commitment_walked', breaker: 'ojjul', parties: ['ojjul', 'drajk', 'meridian'] }, everyone);
    expect(moved(c, 'drajk', 'ojjul')).toBe(-COMMITMENT_BREAKING_COST);
    expect(moved(c, 'meridian', 'ojjul')).toBe(-COMMITMENT_BREAKING_COST);
    expect(moved(c, 'vigil', 'ojjul')).toBe(-PACT_BREAKING_REPUTATION_COST);
    expect(moved(c, 'freeworlds', 'ojjul')).toBe(-PACT_BREAKING_REPUTATION_COST);
    expect(c.heat).toBe(HEAT_PACT_BROKEN);
  });

  it('puts heat on walking away from a two-party commitment, and nothing on onlookers', () => {
    const c = breachCharges({ kind: 'commitment_walked', breaker: 'ojjul', parties: ['ojjul', 'drajk'] }, everyone);
    expect(moved(c, 'drajk', 'ojjul')).toBe(-COMMITMENT_BREAKING_COST);
    expect(moved(c, 'vigil', 'ojjul')).toBe(0);
    expect(c.heat).toBe(HEAT_PACT_BROKEN);
  });

  it('charges each side of a treaty nobody broke, and no heat', () => {
    const c = breachCharges({ kind: 'treaty_repudiated', breaker: null, parties: ['vigil', 'ojjul'] }, everyone);
    expect(moved(c, 'vigil', 'ojjul')).toBe(-BROKEN_WORD_COST);
    expect(moved(c, 'ojjul', 'vigil')).toBe(-BROKEN_WORD_COST);
    expect(c.heat).toBe(0);
  });

  /**
   * The table every journal before version 24 was played under, written out by
   * hand from the sites it replaced — so a slip in `LEGACY_BREACH_PRICES` is a
   * test failure and not a quietly different replay.
   */
  describe('the legacy table reproduces the old sites', () => {
    it('break_treaty: both ways, no onlookers', () => {
      const c = breachCharges({ kind: 'treaty_repudiated', breaker: 'vigil', parties: ['vigil', 'ojjul'] }, everyone, LEGACY_BREACH_PRICES);
      expect(moved(c, 'ojjul', 'vigil')).toBe(-25);
      expect(moved(c, 'vigil', 'ojjul')).toBe(-25);
      expect(moved(c, 'drajk', 'vigil')).toBe(0);
      expect(c.heat).toBe(8);
    });

    it('a marriage broken: one way, no onlookers', () => {
      const c = breachCharges({ kind: 'marriage_repudiated', breaker: 'vigil', parties: ['vigil', 'ojjul'] }, everyone, LEGACY_BREACH_PRICES);
      expect(moved(c, 'ojjul', 'vigil')).toBe(-25);
      expect(moved(c, 'vigil', 'ojjul')).toBe(0);
      expect(moved(c, 'drajk', 'vigil')).toBe(0);
      expect(c.heat).toBe(8);
    });

    it('a commitment of three: the parties pay twice, and two parties carry no heat', () => {
      const three = breachCharges({ kind: 'commitment_walked', breaker: 'ojjul', parties: ['ojjul', 'drajk', 'meridian'] }, everyone, LEGACY_BREACH_PRICES);
      expect(moved(three, 'drajk', 'ojjul')).toBe(-12 - 10);
      expect(moved(three, 'vigil', 'ojjul')).toBe(-10);
      expect(three.heat).toBe(8);
      const two = breachCharges({ kind: 'commitment_walked', breaker: 'ojjul', parties: ['ojjul', 'drajk'] }, everyone, LEGACY_BREACH_PRICES);
      expect(moved(two, 'drajk', 'ojjul')).toBe(-12);
      expect(two.heat).toBe(0);
    });

    it('the rest are unchanged', () => {
      for (const [kind, onlookers, heat] of [
        ['attack_under_pact', 10, 8],
        ['attack_across_truce', 20, 16],
        ['attack_on_inlaws', 0, 0],
        ['treaty_conceded', 0, 0],
        ['match_betrayed', 0, 0],
        ['favour_repudiated', 10, 8],
        ['loan_defaulted', 10, 8],
      ] as const) {
        const c = breachCharges({ kind, breaker: 'vigil', parties: ['vigil', 'ojjul'] }, everyone, LEGACY_BREACH_PRICES);
        expect(moved(c, 'ojjul', 'vigil'), kind).toBe(-25);
        expect(moved(c, 'drajk', 'vigil') + onlookers, kind).toBe(0);
        expect(c.heat, kind).toBe(heat);
        expect(BREACH_PRICES[kind], kind).toEqual(LEGACY_BREACH_PRICES[kind]);
      }
    });
  });
});

describe('break_treaty', () => {
  const pact = (): { s: WorldState; id: string } => {
    const s = applyOps(createSeedState('drajk'), [
      { op: 'form_treaty', parties: ['vigil', 'ojjul'], treatyType: 'non_aggression', terms: {}, summary: 'signed' },
    ], 'extraction', 'vigil', true).state;
    const t = s.treaties.find((x) => x.type === 'non_aggression' && x.parties.includes('vigil') && x.parties.includes('ojjul'))!;
    return { s, id: t.id };
  };
  const regard = (s: WorldState, who: string, toward: string): number =>
    s.factions.find((f) => f.id === who)!.disposition[toward] ?? 0;

  it('is refused to a power the treaty does not bind', () => {
    const { s, id } = pact();
    const r = applyOps(s, [{ op: 'break_treaty', treatyId: id, reason: 'Drajk says so' }], 'model', 'drajk', true);
    expect(r.rejections.map((x) => x.code)).toEqual(['illegal_value']);
    expect(r.state.treaties.find((t) => t.id === id)!.status).toBe('active');
    expect(regard(r.state, 'ojjul', 'vigil')).toBe(regard(s, 'ojjul', 'vigil'));
  });

  it('was a free way to set two other powers against each other before version 24', () => {
    const { s, id } = pact();
    const r = applyOps(s, [{ op: 'break_treaty', treatyId: id, reason: 'Drajk says so' }], 'model', 'drajk', true, { breachPrices: false });
    expect(r.rejections).toEqual([]);
    expect(regard(r.state, 'ojjul', 'vigil')).toBe(regard(s, 'ojjul', 'vigil') - 25);
    expect(regard(r.state, 'vigil', 'ojjul')).toBe(regard(s, 'vigil', 'ojjul') - 25);
  });

  it('cannot be charged twice for one treaty', () => {
    const { s, id } = pact();
    const once = applyOps(s, [{ op: 'break_treaty', treatyId: id, reason: '' }], 'model', 'vigil', true).state;
    const twice = applyOps(once, [{ op: 'break_treaty', treatyId: id, reason: '' }], 'model', 'vigil', true);
    expect(twice.rejections.map((x) => x.code)).toEqual(['already_void']);
  });

  it('by a party: the victim and every onlooker think less of the breaker, and the breaker does not go cold', () => {
    const { s, id } = pact();
    const r = applyOps(s, [{ op: 'break_treaty', treatyId: id, reason: '' }], 'model', 'vigil', true).state;
    expect(regard(r, 'ojjul', 'vigil')).toBe(regard(s, 'ojjul', 'vigil') - BROKEN_WORD_COST);
    expect(regard(r, 'vigil', 'ojjul')).toBe(regard(s, 'vigil', 'ojjul'));
    for (const onlooker of ['meridian', 'freeworlds', 'drajk']) {
      expect(regard(r, onlooker, 'vigil')).toBe(Math.max(-100, regard(s, onlooker, 'vigil') - REPUDIATION_REPUTATION_COST));
    }
    expect(r.factions.find((f) => f.id === 'vigil')!.heat).toBe((s.factions.find((f) => f.id === 'vigil')!.heat ?? 0) + HEAT_PACT_BROKEN);
  });
});

describe('dissolve_commitment', () => {
  it('carries heat for two parties', () => {
    let s = createSeedState('drajk');
    s = applyOps(s, [
      { op: 'establish_commitment', kind: 'quiet_understanding', factionIds: ['ojjul', 'meridian'], text: 'a word between houses' },
    ], 'extraction', 'ojjul', true).state;
    const c = s.commitments.find((x) => x.kind === 'quiet_understanding')!;
    const before = s.factions.find((f) => f.id === 'ojjul')!.heat ?? 0;
    const r = applyOps(s, [{ op: 'dissolve_commitment', commitmentId: c.id, reason: '' }], 'model', 'ojjul', true);
    expect(r.rejections).toEqual([]);
    expect(r.state.factions.find((f) => f.id === 'ojjul')!.heat).toBe(before + HEAT_PACT_BROKEN);
  });
});

/**
 * The layer only holds if nothing walks around it. Every site that charges a
 * breach of faith goes through `chargeBreach`, so a breach price written
 * anywhere else in the domain is a second opinion about what the act costs —
 * the defect this module exists to end.
 */
describe('breach prices live in acts.ts', () => {
  const dir = join(__dirname, '..', 'src', 'domain');
  const code = (file: string): string[] =>
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .filter((line) => !/^\s*(\*|\/\*)/.test(line));

  it('uses no breach constant outside its definition', () => {
    const constants = ['PACT_BREAKING_REPUTATION_COST', 'TRUCE_BREAKING_REPUTATION_COST', 'COMMITMENT_BREAKING_COST', 'LOAN_DEFAULT_DISPOSITION_COST'];
    const strays: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'acts.ts')) {
      code(file).forEach((line, i) => {
        if (/^\s*export const /.test(line)) return;
        for (const c of constants) if (new RegExp(`\\b${c}\\b`).test(line)) strays.push(`${file}:${i + 1} ${c}`);
      });
    }
    expect(strays).toEqual([]);
  });

  it('writes no broken-word figure as a bare number', () => {
    const strays: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'acts.ts')) {
      code(file).forEach((line, i) => {
        if (/\?\?\s*0\)\s*-\s*25\b/.test(line) || /moveRegard\([^)]*,\s*-25\)/.test(line)) strays.push(`${file}:${i + 1}`);
      });
    }
    expect(strays).toEqual([]);
  });
});
