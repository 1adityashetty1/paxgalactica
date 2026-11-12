import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
/**
 * Where the bundled binary runs: an empty folder of the game's own, never the
 * server's working directory.
 *
 * Every model call starts the Claude Code binary, and it inherited the server's
 * working directory — `/` under the Mac app, the repo under `pnpm play:web` —
 * where it looks around as Claude Code does at start (project files, git,
 * memory files up the tree). Under the Mac app every one of those reads is
 * attributed to Pax Galactica, so macOS asked the player for access to folders
 * the game has no business in, turn after turn. The game's calls use no tools
 * and read nothing, so the binary is given nothing to look at. Under the
 * system's temporary directory rather than `~/.paxgalactica`, which holds the
 * player's keys and which the suite keeps pointed at a folder that must not
 * exist.
 */
export function binaryWorkDir(base: string = tmpdir()): string {
  const dir = join(base, 'paxgalactica-run');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

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
