import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTORS, createSeedState } from '../src/seed/scenario.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const state = createSeedState('meridian');

/**
 * An id is not private. It ships in the `GET /api/campaign` payload, in every
 * exported archive, in rejection messages and in the event log — so an id that
 * disagrees with the name beside it does not hide the old name, it publishes
 * it. `hutt` displayed as "Ojjul Nar Combine" for the life of the project on
 * the reasoning that ids are opaque internal keys; they are not.
 *
 * The rule is deliberately "the id appears in the name", not "the id is the
 * first word": `vigil` sits inside "Iron Vigil Remnant" and `freeworlds`
 * spans two words of "Arkane Free Worlds". Both are roots the player can see.
 */
describe('ids share a root with the name they display', () => {
  const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  it.each(state.factions.map((f) => [f.id, f.name] as const))(
    'faction %s is visible in "%s"',
    (id, name) => {
      expect(flatten(name)).toContain(flatten(id));
    },
  );

  /**
   * A system id's prefix IS its sector, so a stale prefix leaks a renamed
   * sector everywhere an id goes — which is how `kes-2` went on saying
   * "Kessel" long after the sector stopped being called that.
   */
  it.each(state.systems.map((s) => [s.id, s.sector] as const))(
    'system %s sits in a sector its prefix names (%s)',
    (id, sector) => {
      const prefix = id.split('-')[0] ?? '';
      expect(sector.toLowerCase().startsWith(prefix)).toBe(true);
    },
  );

  it('every sector prefix is distinct, so an id names exactly one sector', () => {
    const prefixes = SECTORS.map((s) => s.slice(0, 3).toLowerCase());
    expect(new Set(prefixes).size).toBe(SECTORS.length);
  });
});

/**
 * The setting is its own. These are the proper nouns that were borrowed and
 * have been given back — a denylist rather than a general check, because
 * "is this a Star Wars reference" is a judgement no predicate makes.
 *
 * Scoped to the seed, the prompts and the player-facing client: those are the
 * three places a name reaches a player. `docs/` and CLAUDE.md are excluded and
 * could not be included — explaining why a name was retired means naming it,
 * so the record of this change would fail its own denylist.
 */
describe('no borrowed proper nouns reach the seed, the prompts or the screen', () => {
  const BORROWED = [
    'Krayt', 'Hutt', 'Arkanis', 'Sluis', 'Tion', 'Kessel',
    'Ghorman', 'Byss', 'Nar Shaddaa', 'Ryloth', 'Dolomar', 'Outer Rim',
  ];

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.(ts|tsx|md)$/.test(e.name) ? [full] : [];
    });

  const files = [
    join(ROOT, 'src', 'seed', 'scenario.ts'),
    ...walk(join(ROOT, 'prompts')),
    ...walk(join(ROOT, 'web', 'src')),
  ];

  /**
   * The two retired faction ids, checked separately because they are lower
   * case and cannot use the plain word-boundary form above: `hutt` is a
   * substring of "shuttle", "shutting" and "shuttling", all of which are real
   * words in this codebase. The lookbehind is the same one the migration used.
   */
  it.each([['hutt', 'ojjul'], ['krayt', 'drajk']])(
    'the retired id %s is gone, replaced by %s',
    (retired) => {
      const re = new RegExp(`(?<![sS])${retired}`, 'i');
      const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    },
  );

  it.each(BORROWED)('%s appears nowhere', (term) => {
    // `\bTion\b` must not fire on "action"; a leading word boundary alone is
    // not enough, since `\b` sits between "ac" and "Tion" only if the case
    // differs — which it does not in `resolution`. Case-sensitive, both ends.
    const re = new RegExp(`\\b${term}\\b`);
    const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
