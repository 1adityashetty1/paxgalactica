import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Subscription auth for the Agent SDK.
 *
 * The interactive `claude auth login` flow stores its token in the macOS
 * keychain, and on some setups that write silently does nothing — the account
 * profile lands in ~/.claude.json but no credential is ever saved, so every
 * model call reports "not logged in" with no clue as to why.
 *
 * `claude setup-token` mints a long-lived subscription token instead. We store
 * it ourselves and inject it as CLAUDE_CODE_OAUTH_TOKEN when spawning the
 * binary, which sidesteps the keychain entirely and is deterministic.
 *
 * Note this is NOT the same as ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Those
 * bill an API account and shadow the subscription; CLAUDE_CODE_OAUTH_TOKEN *is*
 * the subscription.
 */

/** Kept outside the repo so it cannot be committed by accident. */
export const TOKEN_PATH = join(homedir(), '.paxgalactica', 'oauth-token');

export function readStoredToken(): string | null {
  try {
    const raw = readFileSync(TOKEN_PATH, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function storeToken(token: string): string {
  const clean = token.trim();
  if (!looksLikeOAuthToken(clean)) {
    throw new Error(
      'That does not look like a Claude OAuth token. Expected something beginning "sk-ant-oat".',
    );
  }
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, `${clean}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(TOKEN_PATH, 0o600);
  return TOKEN_PATH;
}

export function hasStoredToken(): boolean {
  return existsSync(TOKEN_PATH) && readStoredToken() !== null;
}

export function looksLikeOAuthToken(token: string): boolean {
  return /^sk-ant-oat[\w-]{10,}$/.test(token.trim());
}

/**
 * The environment handed to the spawned binary.
 *
 * API-key variables are stripped rather than merely warned about: they shadow
 * subscription auth, and they are commonly exported from a shell profile where
 * they come back in every new terminal. Removing them here means the campaign
 * cannot bill an API account by accident regardless of how the shell is set up.
 */
export function buildAuthEnv(
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const token = readStoredToken();
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}
