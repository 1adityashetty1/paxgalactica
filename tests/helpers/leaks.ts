import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

/**
 * The static half of leak prevention (`docs/design-2026-11-15-skins.md`,
 * *"Leak prevention"* 2): every string a core module, `src/ui` or the client
 * writes, read off the source by a parser, and searched for the default
 * skin's words.
 *
 * **A parser, not a pattern.** A regular expression over source cannot tell a
 * string from a comment, a template's text from its `${}`, or JSX text from a
 * tag. TypeScript 7 exposes no parser to JavaScript, and Vite already ships
 * one: rolldown's, resolved from Vite's own location the way `binary.ts`
 * resolves the platform package from the SDK's, since under pnpm it is
 * Vite's dependency and not this project's.
 *
 * **What is read:** string literals, the text of template literals, and JSX
 * text. **What is not:** import and export sources, object keys, and any
 * string that is one lowercase token (`'battleship'`, `'sek-4'`,
 * `'commerce_raiding'`). Those are ids, and ids are phase 3's: until the core
 * renumbers, its ids are Pax Galactica's words by construction.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** The directories scanned: the core, the UI's text producers and the client. */
export const SCANNED = ['src/domain', 'src/engine', 'src/model', 'src/server', 'src/api', 'src/ui', 'web/src'];

/** The skin is where the words belong; the seed is the scenario, whose words move into the skin in phase 5. */
export const UNSCANNED = ['src/skin', 'src/seed'];

type Node = { type: string; start: number; end: number; [k: string]: unknown };

let parse: ((src: string, opts: { lang: string }) => Node) | null = null;

async function parser(): Promise<(src: string, opts: { lang: string }) => Node> {
  if (parse) return parse;
  const vite = realpathSync(join(ROOT, 'node_modules', 'vite', 'package.json'));
  const mod = (await import(createRequire(vite).resolve('rolldown/parseAst'))) as {
    parseAst: (src: string, opts: { lang: string }) => Node;
  };
  parse = mod.parseAst;
  return parse;
}

/** One string the source writes, and where. */
export interface Literal {
  file: string;
  line: number;
  text: string;
  /** A `say` evaluated when its module loads, which writes the default skin's words whatever the scope later holds. */
  early?: boolean;
  /** Text of a `say` template, whose `{tokens}` are the lexicon's words and not the source's. */
  say: boolean;
}

/** A string that is one lowercase token: an id, a key, a path or a code, never prose. */
const ID_LIKE = /^[a-z0-9_:\-./#@]*$/;

function lineAt(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function walk(node: unknown, out: Node[], skip: Set<unknown>, says: Set<unknown>, depth = 0, early: Node[] = []): void {
  if (!node || typeof node !== 'object' || skip.has(node)) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, skip, says, depth, early);
    return;
  }
  const n = node as Node;
  const inner = FUNCTIONS.has(n.type) ? depth + 1 : depth;
  // An import's source, an export's source, and an object key are not prose.
  if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) skip.add(n.source);
  if (n.type === 'ImportExpression' && n.source) skip.add(n.source);
  if ((n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'TSPropertySignature') && n.key && !n.computed) skip.add(n.key);
  if (n.type === 'TSLiteralType' || n.type === 'TSEnumMember') return;
  if (n.type === 'TaggedTemplateExpression' && (n.tag as Node).type === 'Identifier' && (n.tag as { name: string }).name === 'say') {
    for (const q of ((n.quasi as { quasis: unknown[] }).quasis ?? [])) says.add(q);
    if (depth === 0) early.push(n);
  }
  if ((n.type === 'Literal' && typeof n.value === 'string') || n.type === 'JSXText') out.push(n);
  if (n.type === 'TemplateElement') out.push(n);
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    walk(n[key], out, skip, says, inner, early);
  }
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** Every prose string the scanned directories write. */
export async function literals(): Promise<Literal[]> {
  const parseAst = await parser();
  const out: Literal[] = [];
  for (const dir of SCANNED) {
    for (const path of filesUnder(join(ROOT, dir))) {
      const file = relative(ROOT, path);
      if (UNSCANNED.some((d) => file.startsWith(`${d}/`))) continue;
      const src = readFileSync(path, 'utf8');
      const found: Node[] = [];
      const says = new Set<unknown>();
      const early: Node[] = [];
      walk(parseAst(src, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts' }), found, new Set(), says, 0, early);
      for (const e of early) out.push({ file, line: lineAt(src, e.start), text: '', say: true, early: true });
      for (const n of found) {
        const text =
          n.type === 'TemplateElement' ? String((n.value as { cooked?: string; raw: string }).cooked ?? (n.value as { raw: string }).raw) : String(n.value);
        if (ID_LIKE.test(text.trim())) continue;
        out.push({ file, line: lineAt(src, n.start), text, say: says.has(n) });
      }
    }
  }
  return out;
}

/**
 * A word or phrase as a whole-word, case-blind pattern: "torpedo boat" also
 * matches "torpedo  boat". An underscore is part of a word, so an op or id
 * named in prose (`publish_dossier`, `capital_ship_construction`) is protocol,
 * not the word inside it.
 */
export function wordPattern(word: string): RegExp {
  const body = word
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<![A-Za-z_])${body}(?![A-Za-z_])`, 'gi');
}

/** One word of the skin, found in one string of the source. */
export interface Hit {
  file: string;
  line: number;
  word: string;
}

/**
 * Every place a scanned word appears in a prose string, longest words first so
 * "torpedo boat" is not also "boat". An ordinary phrase is masked first, so
 * "line of credit" is not also "credit".
 *
 * A `say` evaluated at module load is a hit of its own: it fills its tokens
 * once, from the default lexicon, and a skin set later never reaches it.
 *
 * A `say` template's tokens are taken out first, since they are the
 * lexicon's words rather than the source's. A token anywhere else is a hit of
 * its own: outside `say` nothing fills it, and a player would read the braces.
 */
export function hits(
  found: readonly Literal[],
  words: readonly string[],
  tokens: readonly string[] = [],
  ordinary: readonly string[] = [],
): Hit[] {
  const ordered = [...new Set(words.map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length);
  const patterns = ordered.map((w) => [w, wordPattern(w)] as const);
  const masks = [...ordinary].sort((a, b) => b.length - a.length).map(wordPattern);
  const known = new Set(tokens.map((t) => t.toLowerCase()));
  const out: Hit[] = [];
  for (const lit of found) {
    if (lit.early) {
      out.push({ file: lit.file, line: lit.line, word: 'say at module load' });
      continue;
    }
    let text = masks.reduce((t, re) => t.replace(re, ' '), lit.text);
    text = text.replace(/\{([A-Za-z][A-Za-z_]*)\}/g, (all, name: string) => {
      if (!known.has(name.toLowerCase())) return all;
      if (!lit.say) out.push({ file: lit.file, line: lit.line, word: `{${name}} outside say` });
      return ' ';
    });
    for (const [w, re] of patterns) {
      text = text.replace(re, () => {
        out.push({ file: lit.file, line: lit.line, word: w });
        return ' ';
      });
    }
  }
  return out;
}

/** Hits counted per file, in a stable order, as the baseline records them. */
export function countByFile(found: readonly Hit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of found) counts[h.file] = (counts[h.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/* ------------------------------------------------------------------ */
/* Ids and field names: read by phases 3 and 4, counted from now       */
/* ------------------------------------------------------------------ */

/** One id or field name the source writes, and where. */
export interface IdName {
  file: string;
  line: number;
  name: string;
}

/**
 * Every one-token string and every object key or property name in the scanned
 * directories: `'torpedo_boat'`, `'unknown_system'`, `systemId`, `atSystemId`.
 *
 * `literals` leaves these out because renaming them is not phase 2's work:
 * phase 3 gives role ids their marked form (`u_strike`) and powers and systems
 * their ordinals, and phase 4 gives the protocol neutral field names
 * (`placeId`). Left out entirely they would be invisible, and a skin word in
 * an id is still a skin word the model reads, so they are counted on a ratchet
 * of their own.
 */
export async function idNames(): Promise<IdName[]> {
  const parseAst = await parser();
  const out: IdName[] = [];
  for (const dir of SCANNED) {
    for (const path of filesUnder(join(ROOT, dir))) {
      const file = relative(ROOT, path);
      if (UNSCANNED.some((d) => file.startsWith(`${d}/`))) continue;
      const src = readFileSync(path, 'utf8');
      const visit = (node: unknown, inImport: boolean): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (const child of node) visit(child, inImport);
          return;
        }
        const n = node as Node & { key?: Node & { name?: string; value?: unknown }; computed?: boolean; value?: unknown };
        const importing = inImport || n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || (n.type === 'ExportNamedDeclaration' && !!n.source);
        if (!importing && n.type === 'Literal' && typeof n.value === 'string' && n.value.length > 0 && ID_LIKE.test(n.value)) {
          out.push({ file, line: lineAt(src, n.start), name: n.value });
        }
        if ((n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'TSPropertySignature') && n.key && !n.computed) {
          const name = n.key.type === 'Identifier' ? n.key.name : typeof n.key.value === 'string' ? n.key.value : '';
          if (name) out.push({ file, line: lineAt(src, n.key.start), name });
        }
        for (const key of Object.keys(n)) {
          if (key === 'type' || key === 'start' || key === 'end') continue;
          visit(n[key], importing);
        }
      };
      visit(parseAst(src, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts' }), false);
    }
  }
  return out;
}

/** An id or field name's words: `atSystemId` is "at system id", `torpedo_boat` is "torpedo boat". */
export function segments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Every id or field name carrying one of `words` among its segments, once per word it carries. */
export function idHits(found: readonly IdName[], words: readonly string[]): Hit[] {
  const single = new Set(words.filter((w) => !/\s/.test(w)).map((w) => w.toLowerCase()));
  const out: Hit[] = [];
  for (const id of found) {
    for (const s of new Set(segments(id.name))) if (single.has(s)) out.push({ file: id.file, line: id.line, word: s });
  }
  return out;
}
