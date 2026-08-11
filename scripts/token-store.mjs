import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Plain-JS mirror of src/model/auth.ts, so the setup scripts work before (and
 * independently of) a TypeScript build.
 */

export const TOKEN_PATH = join(homedir(), '.paxgalactica', 'oauth-token');

/**
 * Strip ALL whitespace, not just the ends.
 *
 * setup-token prints the token wrapped across terminal lines, so a copy-paste
 * routinely contains an embedded newline. Trimming only the ends leaves that
 * newline in the middle and stores a token that is silently wrong.
 */
export function normalizeToken(token) {
  return String(token).replace(/\s+/g, '');
}

export function looksLikeOAuthToken(token) {
  return /^sk-ant-oat[\w-]{20,}$/.test(normalizeToken(token));
}

export function readStoredToken() {
  try {
    const raw = readFileSync(TOKEN_PATH, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function hasStoredToken() {
  return existsSync(TOKEN_PATH) && readStoredToken() !== null;
}

export function storeToken(token) {
  const clean = normalizeToken(token);
  if (!looksLikeOAuthToken(clean)) throw new Error('Not a Claude OAuth token.');
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, `${clean}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(TOKEN_PATH, 0o600);
  return TOKEN_PATH;
}
