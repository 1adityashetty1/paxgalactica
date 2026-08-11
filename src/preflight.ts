import { spawnSync } from 'node:child_process';
import { buildAuthEnv, hasStoredToken, TOKEN_PATH } from './model/auth.js';
import { resolveClaudeBinary } from './model/binary.js';

/**
 * Startup guards. These run before the server binds, so a misconfigured
 * install fails with an explanation instead of accepting a campaign and then
 * failing every action in it.
 */

export class PreflightError extends Error {}

/**
 * API-key variables shadow subscription auth. The game strips them from the
 * environment it hands the binary (see `buildAuthEnv`), so they can no longer
 * cause surprise billing — which means this is worth mentioning but not worth
 * refusing to start over. It used to be fatal, and since these are usually
 * exported from a shell profile, that turned every new terminal into a puzzle.
 */
export function apiKeyNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  const offenders = (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const).filter(
    (k) => typeof env[k] === 'string' && env[k]!.trim().length > 0,
  );
  if (offenders.length === 0) return null;
  return `${offenders.join(' and ')} is set in this shell. Pax Galactica strips it from model calls, so your subscription is still what gets used.`;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
}

/**
 * Ask the bundled binary whether it is signed in, using exactly the environment
 * the game will use. Probing with ambient environment instead is how this
 * previously reported "ready" on the strength of an API key that the game then
 * refused, sending the player in a loop.
 */
export function readAuthStatus(spawn = spawnSync): AuthStatus | null {
  const binary = resolveClaudeBinary();
  if (!binary) return null;
  try {
    const probe = spawn(binary, ['auth', 'status', '--json'], {
      encoding: 'utf8',
      env: buildAuthEnv() as NodeJS.ProcessEnv,
    });
    if (typeof probe.stdout !== 'string') return null;
    const parsed = JSON.parse(probe.stdout) as AuthStatus;
    return typeof parsed?.loggedIn === 'boolean' ? parsed : null;
  } catch {
    // A probe failure should not stop the game; the model call will report it.
    return null;
  }
}

export function assertLoggedIn(status: AuthStatus | null): void {
  // A null status means the probe itself failed. Do not block on that — let the
  // first model call produce the real error rather than guessing at one.
  if (status === null) return;

  // `loggedIn: true` is not sufficient: with a key present the binary reports
  // method "api_key" and calls itself signed in, which is not the auth we want.
  if (status.loggedIn && status.authMethod !== 'api_key') return;

  const stored = hasStoredToken();
  throw new PreflightError(
    [
      stored
        ? 'A subscription token is stored, but the binary will not accept it.'
        : 'No Claude subscription token is stored, so no model calls can be made.',
      '',
      stored
        ? `The token at ${TOKEN_PATH} may have been revoked, or truncated when pasted.`
        : 'Pax Galactica runs on your Claude Pro/Max subscription.',
      '',
      'Sign in with:',
      '',
      '    pnpm login     runs `claude setup-token` and stores the token it prints',
      '    pnpm auth      confirms the game can use it',
      '',
      'Note: `claude auth login` is not enough on its own — it stores its',
      'credential in the macOS keychain, and on some setups that write silently',
      'does nothing, leaving an account profile behind but no usable credential.',
    ].join('\n'),
  );
}

export interface PreflightResult {
  warnings: string[];
}

/**
 * Startup checks for the server.
 *
 * There is no TTY requirement: nothing in this project draws to a terminal.
 *
 * Auth is checked at startup rather than on the first request — a server that
 * accepts a campaign and then fails every action is worse than one that refuses
 * to start with an explanation.
 */
export function runServerPreflight(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const warnings: string[] = [];
  const notice = apiKeyNotice(env);
  if (notice) warnings.push(notice);

  assertLoggedIn(readAuthStatus());

  return { warnings };
}
