import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREDITS_PER_TON, HULL_CLASSES, HULL_SPEC, hullCost, hullUpkeep } from '../src/domain/hulls.js';
import {
  COMPULSION_BREACH_DISSENT,
  DOCTRINE_CHANGE_DISSENT_CEILING,
  DOCTRINE_ETHIC_DISSENT,
  DOCTRINE_TEXT_DISSENT,
  REFUSAL_DISSENT,
} from '../src/domain/state.js';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/**
 * A prompt is not allowed to quote a price the reducer does not charge.
 *
 * `prompts/appraisal.md` told the model a compulsion breach costs "25 dissent"
 * long after `COMPULSION_BREACH_DISSENT` had been lowered to 15 — so the game
 * was explaining a price it does not charge, in the one document whose job is
 * to make the ruling legible. Same class as the hardcoded `dissentPenalty`
 * copy that once lived in `serialize.ts` and told the model a different number
 * than the game rolled against.
 *
 * A prompt CAN legitimately mention a real constant (the doctrine ceiling of 75
 * is quoted correctly), so the test is not "no numbers near the word dissent" —
 * it is "every number quoted beside `dissent` is one the code actually uses".
 */
describe('prompts do not quote dissent prices the code does not charge', () => {
  const real = new Set(
    [
      COMPULSION_BREACH_DISSENT,
      REFUSAL_DISSENT,
      DOCTRINE_CHANGE_DISSENT_CEILING,
      DOCTRINE_ETHIC_DISSENT,
      DOCTRINE_TEXT_DISSENT,
      // The scale itself, and the decay rate, both of which prompts describe.
      100,
      2,
    ].map(String),
  );

  const files = readdirSync(PROMPTS).filter((f) => f.endsWith('.md'));

  it('has prompts to check', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  for (const file of files) {
    it(`${file} quotes only real dissent figures`, () => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      const quoted = [...text.matchAll(/(\d+)\s+dissent/gi)].map((m) => m[1]!);
      const stale = quoted.filter((n) => !real.has(n));
      expect(stale, `${file} quotes ${stale.join(', ')} beside "dissent"`).toEqual([]);
    });
  }
});

/**
 * The same guard, for what a ship costs.
 *
 * Four lines of `resolution.md` stated a hull's price as a single number — "60
 * credits a hull", "the hulls are paid for at 60 apiece" — which was true for
 * exactly as long as a battleship was the only class. Nothing was wrong on the
 * day classes landed, because nothing but battleships existed yet, and that is
 * precisely what would have let it ship past: the prompt would have gone on
 * quoting a battleship's price for a lifter until a playtest noticed the
 * arithmetic did not add up.
 *
 * Two halves, because they fail differently:
 *
 * - **every price the prompts quote is a real one.** Catches the stale figure.
 * - **every class the prompts price is priced correctly.** Catches the subtler
 *   case where a class is named beside a number that belongs to another one.
 */
describe('prompts do not quote ship prices the yards do not charge', () => {
  const files = readdirSync(PROMPTS).filter((f) => f.endsWith('.md'));

  /** Every figure a prompt may legitimately state as the price of a hull. */
  const realPrices = new Set([
    CREDITS_PER_TON,
    ...HULL_CLASSES.map(hullCost),
  ].map(String));
  const realUpkeep = new Set(HULL_CLASSES.map(hullUpkeep).map(String));

  for (const file of files) {
    it(`${file} quotes only real hull prices`, () => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      // "60 credits a hull", "60 a ton", "hulls at 60", "at 60 apiece".
      const quoted = [
        ...text.matchAll(/(\d+)\s*(?:credits?\s*)?(?:a|per)\s+(?:hull|ton)\b/gi),
        ...text.matchAll(/\bhulls?\s+at\s+(\d+)\b/gi),
        ...text.matchAll(/\bat\s+(\d+)\s+apiece\b/gi),
      ].map((m) => m[1]!);
      const stale = quoted.filter((n) => !realPrices.has(n) && !realUpkeep.has(n));
      expect(stale, `${file} quotes ${stale.join(', ')} as a hull price`).toEqual([]);
    });

    it(`${file} prices each named class correctly`, () => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      for (const hull of HULL_CLASSES) {
        const label = HULL_SPEC[hull].label;
        // "60 for a battleship", "45 for a lifter".
        for (const m of text.matchAll(
          new RegExp(`(\\d+)\\s+for\\s+an?\\s+${label}`, 'gi'),
        )) {
          expect(Number(m[1]), `${file} prices a ${label} at ${m[1]}`).toBe(hullCost(hull));
        }
      }
    });
  }
});
