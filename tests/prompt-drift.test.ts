import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
