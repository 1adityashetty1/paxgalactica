import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countByFile, hits, literals, type Hit } from './helpers/leaks.js';
import { settingWords } from '../src/skin/null.js';
import { SAY_TOKENS } from '../src/skin/lexicon.js';

/**
 * No Pax Galactica word in the source outside the skin, ratcheted.
 *
 * `docs/design-2026-11-15-skins.md`, *"Leak prevention"* 2: a word written into
 * a core module, `src/ui` or the client is a word no skin can change. Phase 2
 * routes them through the lexicon a file at a time, so this holds each file to
 * the number it had when last recorded: a file may lose words and never gain
 * one, and the phase is done when the baseline is empty.
 *
 * A file that has lost words fails too, until it is recorded, so the ratchet
 * cannot quietly loosen:
 *
 *   SKIN_LEAKS_RECORD=1 npx vitest run tests/skin-leaks.test.ts
 */

const BASELINE = join(import.meta.dirname, 'skin-leaks.baseline.json');

describe('the source', () => {
  it('writes no more setting words than it did when last recorded', async () => {
    const found = hits(await literals(), settingWords(), SAY_TOKENS);
    const now = countByFile(found);
    if (process.env.SKIN_LEAKS_RECORD) {
      writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const was: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const describe = (h: Hit) => `  ${h.file}:${h.line} ${h.word}`;
    const worse = Object.keys(now).filter((f) => now[f]! > (was[f] ?? 0));
    const better = Object.keys(was).filter((f) => (now[f] ?? 0) < was[f]!);
    expect(
      worse.map((f) => `${f}: ${was[f] ?? 0} → ${now[f]}\n${found.filter((h) => h.file === f).map(describe).join('\n')}`),
      'a file writes a setting word the lexicon should give it; route it through `say` or a lexicon helper',
    ).toEqual([]);
    expect(
      better.map((f) => `${f}: ${was[f]} → ${now[f] ?? 0}`),
      'a file lost setting words; record the new baseline with SKIN_LEAKS_RECORD=1',
    ).toEqual([]);
  }, 60_000);
});

describe('the scan', () => {
  const lit = (text: string, say = false) => ({ file: 'x.ts', line: 1, text, say });

  it('finds a setting word as a whole word, the longest phrase first', () => {
    const found = hits([lit('3 torpedo boats left orbit'), lit('worldly orbiter')], settingWords(), SAY_TOKENS);
    expect(found.map((h) => h.word)).toEqual(['torpedo boats', 'orbit']);
  });

  it('reads a say template\'s tokens as the lexicon\'s, and a token anywhere else as a leak', () => {
    expect(hits([lit('your {fleet} over {worlds}', true)], settingWords(), SAY_TOKENS)).toEqual([]);
    expect(hits([lit('your {fleet} over a world')], settingWords(), SAY_TOKENS).map((h) => h.word)).toEqual([
      '{fleet} outside say',
      'world',
    ]);
  });

  it('reads the source: a literal, a template and JSX text, and never a comment or an import', async () => {
    const found = await literals();
    const helpText = found.filter((l) => l.file === 'src/ui/helptext.ts');
    expect(helpText.length).toBeGreaterThan(50);
    expect(found.some((l) => l.file.startsWith('web/src/') && l.file.endsWith('.tsx'))).toBe(true);
    expect(found.some((l) => /^\.\.?\//.test(l.text))).toBe(false);
    expect(found.some((l) => l.file.startsWith('src/skin/') || l.file.startsWith('src/seed/'))).toBe(false);
  }, 60_000);
});
