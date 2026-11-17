import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { DRAFT_ID, SkinDraftSchema, serializeDraft } from '../src/skin/studio/draft.js';

/**
 * The skin studio's file access, and nothing else: list, read and write a
 * draft at `skins/<id>.json`, and find where a name is still written by hand
 * in code.
 *
 * **Dev server only** (`apply: 'serve'`), so none of it exists in a build and
 * the game server never learns about drafts. It runs inside Vite on
 * localhost, which is the whole of its trust boundary: an id is held to
 * `DRAFT_ID` and a body to `SkinDraftSchema` before anything touches disk.
 */
export function skinStudio(root: string): Plugin {
  const dir = join(root, 'skins');

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((ok, fail) => {
      let data = '';
      req.on('data', (c: Buffer) => {
        data += c.toString('utf8');
        if (data.length > 4_000_000) fail(new Error('too large'));
      });
      req.on('end', () => ok(data));
      req.on('error', fail);
    });

  const list = () =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .flatMap((f) => {
            const slug = f.slice(0, -5);
            try {
              const draft = SkinDraftSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
              return [{ slug, name: draft.name, entries: Object.keys(draft.entries).length, terms: Object.keys(draft.renames).length }];
            } catch {
              return [{ slug, name: `${slug} (unreadable)`, entries: 0, terms: 0 }];
            }
          })
      : [];

  /**
   * Where a name is still written in code, which no skin reaches. Not
   * `src/skin` or the seed: those are where the default skin's words are read
   * from, so a name there is the base, not a leak.
   */
  const SCAN = ['src', join('web', 'src')];
  const files = (): string[] => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const full = join(d, e.name);
        if (e.isDirectory()) return e.name === 'skin' || e.name === 'seed' || e.name === 'skins' ? [] : walk(full);
        return /\.(ts|tsx|md)$/.test(e.name) ? [full] : [];
      });
    return SCAN.map((d) => join(root, d)).filter(existsSync).flatMap(walk);
  };
  const mentions = (terms: string[]) => {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const out: Record<string, { file: string; line: number; text: string; comment: boolean }[]> = {};
    const patterns = terms.slice(0, 200).map((t) => [t, new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, 'u')] as const);
    for (const t of terms) out[t] = [];
    for (const file of files()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const md = file.endsWith('.md');
      lines.forEach((text, i) => {
        for (const [t, re] of patterns) {
          if (!re.test(text) || out[t]!.length >= 80) continue;
          const trimmed = text.trim();
          out[t]!.push({
            file: relative(root, file),
            line: i + 1,
            text: trimmed.slice(0, 220),
            comment: !md && /^(\/\/|\/\*|\*)/.test(trimmed),
          });
        }
      });
    }
    return out;
  };

  return {
    name: 'paxgalactica-skin-studio',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__skins', (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const slug = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
            if (slug === '' && req.method === 'GET') return send(res, 200, { skins: list() });
            if (slug === 'mentions' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { terms?: unknown };
              const terms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
              return send(res, 200, { mentions: mentions(terms) });
            }
            if (!DRAFT_ID.test(slug)) return send(res, 400, { error: `"${slug}" is not a skin id: lowercase words joined by underscores.` });
            const path = join(dir, `${slug}.json`);
            if (req.method === 'GET') {
              if (!existsSync(path)) return send(res, 404, { error: `No skin called ${slug}.` });
              return send(res, 200, SkinDraftSchema.parse(JSON.parse(readFileSync(path, 'utf8'))));
            }
            if (req.method === 'PUT') {
              const parsed = SkinDraftSchema.safeParse(JSON.parse(await readBody(req)));
              if (!parsed.success) return send(res, 400, { error: parsed.error.message });
              mkdirSync(dir, { recursive: true });
              writeFileSync(path, serializeDraft(parsed.data));
              return send(res, 200, { ok: true, path: relative(root, path) });
            }
            return send(res, 405, { error: 'Not a skin studio route.' });
          } catch (err) {
            send(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    },
  };
}
