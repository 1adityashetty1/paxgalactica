import { describe, expect, it } from 'vitest';
import {
  DISSENT_BANDS,
  FAVOUR_BANDS,
  HEAT_BANDS,
  INTEL_BANDS,
  REGARD_BANDS,
  STANDING_BANDS,
  bandOf,
  describeReading,
  watchLine,
  type Meter,
} from '../src/domain/bands.js';
import { BOT_AGGRESSION_CEILING, COALITION_GRIEVANCE, EXCHANGE_STANDING } from '../src/domain/initiative.js';
import { favourModifier } from '../src/domain/estates.js';
import { WAR_DISPOSITION_THRESHOLD } from '../src/domain/state.js';

const METERS: Meter[] = [REGARD_BANDS, DISSENT_BANDS, HEAT_BANDS, INTEL_BANDS, FAVOUR_BANDS, STANDING_BANDS];

describe('the threshold table', () => {
  it('lists every meter in ascending order', () => {
    for (const m of METERS) {
      const froms = m.bands.map((b) => b.from);
      expect([...froms].sort((a, b) => a - b)).toEqual(froms);
      expect(new Set(froms).size).toBe(froms.length);
    }
  });

  it("draws regard's lines where the mechanics and the bots draw them", () => {
    const at = (name: string) => REGARD_BANDS.bands.find((b) => b.name === name)!.from;
    expect(at('hostile') - 1).toBe(WAR_DISPOSITION_THRESHOLD);
    expect(at('cool') - 1).toBe(COALITION_GRIEVANCE);
    expect(at('warm') - 1).toBe(BOT_AGGRESSION_CEILING);
    expect(at('friendly')).toBe(EXCHANGE_STANDING);
  });

  it("names favour's bands as favourModifier counts them", () => {
    for (let v = -100; v <= 100; v++) {
      const i = FAVOUR_BANDS.bands.indexOf(bandOf(FAVOUR_BANDS, v).band);
      expect(i - 2).toBe(favourModifier(v));
    }
  });

  it('says the line to watch, and only when it is near', () => {
    expect(describeReading(REGARD_BANDS, -55)).toBe('-55 (hostile; 5 from war at -60)');
    expect(describeReading(REGARD_BANDS, -60)).toBe('-60 (war)');
    expect(describeReading(REGARD_BANDS, 50)).toBe('50 (friendly)');
    expect(watchLine(DISSENT_BANDS, 22)).toBe('3 from mutinous at 25');
    expect(watchLine(DISSENT_BANDS, 2)).toBeNull();
    expect(watchLine(HEAT_BANDS, 30)).toBeNull();
  });
});
