import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

/**
 * Static file serving for the built browser client.
 *
 * Deliberately small: this only ever serves our own build output on localhost.
 * It still resolves and range-checks every path, because "it only serves our
 * own files" stops being true the moment a URL contains `..`.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export function serveStatic(
  root: string,
  urlPath: string,
  res: ServerResponse,
  method: 'GET' | 'HEAD' = 'GET',
): boolean {
  if (!existsSync(root)) return false;

  const rootResolved = resolve(root);
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const candidate = resolve(join(rootResolved, normalize(requested)));

  // Containment check: a resolved path must still sit under the root.
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) return false;

  let target = candidate;
  if (!existsSync(target) || statSync(target).isDirectory()) {
    // SPA fallback: unknown paths get index.html so client routing works.
    const index = join(rootResolved, 'index.html');
    if (!existsSync(index)) return false;
    target = index;
  }

  const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    // The build hashes asset names; index.html must never be cached or a
    // rebuild leaves the browser on stale JavaScript.
    'Cache-Control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  // A HEAD probe (some browsers and extensions send one before an <img> GET,
  // and it is the standard way to validate a cached resource) previously fell
  // through this function entirely — the caller only invoked it on GET — and
  // landed on the API's 404 instead of these headers with no body. The asset
  // exists and the headers are correct; only the body is skipped.
  if (method === 'HEAD') {
    res.end();
    return true;
  }

  createReadStream(target).pipe(res);
  return true;
}
