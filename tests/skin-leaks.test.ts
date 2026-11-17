import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countByFile, hits, idHits, idNames, literals, segments, type Hit } from './helpers/leaks.js';
import { ORDINARY_WORDS, settingWords } from '../src/skin/null.js';
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
 *
 * Ids and field names are counted on a second ratchet: `torpedo_boat`,
 * `unknown_system` and `systemId` carry setting words too, and a model reads
 * every one. Phase 3 renames the ids and phase 4 the protocol's fields, so
 * phase 2 only stops new ones arriving.
 */

const BASELINE = join(import.meta.dirname, 'skin-leaks.baseline.json');
const ID_BASELINE = join(import.meta.dirname, 'skin-ids.baseline.json');

/** Hold `now` to the counts recorded at `path`: no file may gain a hit, and a file that lost some must be recorded. */
function ratchet(path: string, found: readonly Hit[], gained: string): void {
  const now = countByFile(found);
  if (process.env.SKIN_LEAKS_RECORD) {
    writeFileSync(path, `${JSON.stringify(now, null, 2)}\n`);
    return;
  }
  const was: Record<string, number> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const line = (h: Hit) => `  ${h.file}:${h.line} ${h.word}`;
  const worse = Object.keys(now).filter((f) => now[f]! > (was[f] ?? 0));
  const better = Object.keys(was).filter((f) => (now[f] ?? 0) < was[f]!);
  expect(worse.map((f) => `${f}: ${was[f] ?? 0} → ${now[f]}\n${found.filter((h) => h.file === f).map(line).join('\n')}`), gained).toEqual([]);
  expect(better.map((f) => `${f}: ${was[f]} → ${now[f] ?? 0}`), 'a file lost setting words; record the new baseline with SKIN_LEAKS_RECORD=1').toEqual([]);
}

describe('the source', () => {
  it('writes no more setting words than it did when last recorded', async () => {
    const found = hits(await literals(), settingWords(), SAY_TOKENS, ORDINARY_WORDS);
    ratchet(BASELINE, found, 'a file writes a setting word the lexicon should give it; route it through `say` or a lexicon helper');
  }, 60_000);

  // Phases 3 and 4 rename these; until then each file is held to its count, so
  // no new id or field name takes a setting word (`torpedo_boat`, `systemId`).
  it('names no more ids or fields with a setting word than it did when last recorded', async () => {
    const ordinary = new Set(ORDINARY_WORDS.map((w) => w.toLowerCase()));
    const found = idHits(await idNames(), settingWords().filter((w) => !ordinary.has(w.toLowerCase())));
    ratchet(ID_BASELINE, found, 'a new id or field name carries a setting word; name it for its role instead');
  }, 60_000);
});

describe('the scan', () => {
  it('splits an id or a field name into its words', () => {
    expect(segments('atSystemId')).toEqual(['at', 'system', 'id']);
    expect(segments('torpedo_boat')).toEqual(['torpedo', 'boat']);
    const found = idHits([{ file: 'x.ts', line: 1, name: 'toSystemId' }, { file: 'x.ts', line: 2, name: 'torpedo_strike' }], settingWords());
    expect(found.map((h) => h.word)).toEqual(['system', 'torpedo']);
  });

  const lit = (text: string, say = false) => ({ file: 'x.ts', line: 1, text, say });

  it('finds a setting word as a whole word, the longest phrase first', () => {
    const found = hits([lit('3 torpedo boats left orbit'), lit('worldly orbiter')], settingWords(), SAY_TOKENS);
    expect(found.map((h) => h.word)).toEqual(['torpedo boats', 'orbit']);
    expect(hits([lit('a line of credit, and credits')], settingWords(), SAY_TOKENS, ORDINARY_WORDS).map((h) => h.word)).toEqual(['credits']);
  });

  it('counts an id spaced into words, which bypasses the lexicon', () => {
    expect(hits([{ file: 'x.ts', line: 1, text: '', say: false, spaced: true }], settingWords()).map((h) => h.word)).toEqual(['id spaced as a word']);
  });

  it('reads a say template\'s tokens as the lexicon\'s, and a token anywhere else as a leak', () => {
    expect(hits([lit('your {group} over {nodes}', true)], settingWords(), SAY_TOKENS)).toEqual([]);
    expect(hits([lit('your {group} over a world')], settingWords(), SAY_TOKENS).map((h) => h.word)).toEqual([
      '{group} outside say',
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
