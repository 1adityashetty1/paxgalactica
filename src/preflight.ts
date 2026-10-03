import { spawnSync } from 'node:child_process';
import { buildAuthEnv, hasStoredToken, TOKEN_PATH } from './model/auth.js';
import { resolveClaudeBinary } from './model/binary.js';
import { missingKeyMessage } from './model/provider.js';
import {
  chosenProvider,
  KEY_ENV,
  KEYED_PROVIDERS,
  keyHint,
  keyProblem,
  readSettings,
  resolveKey,
  type KeyedProvider,
  type ProviderId,
  type Settings,
} from './model/settings.js';

/**
 * Startup guards. These run before the server binds, so a misconfigured
 * install fails with an explanation instead of accepting a campaign and then
 * failing every action in it.
 */

export class PreflightError extends Error {}

/**
 * API-key variables shadow subscription auth — when the subscription is the
 * provider. When the `anthropic` provider is chosen, `ANTHROPIC_API_KEY` is
 * the credential it reads, and this note does not apply. The game strips them from the
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

/* ------------------------------------------------------------------ */
/* Whichever provider is chosen                                         */
/* ------------------------------------------------------------------ */

export interface KeyState {
  /** `sk-or-…4f2a`, never the key. */
  hint: string;
  source: 'stored' | 'env';
}

export interface ProviderStatus {
  provider: ProviderId;
  /** Where the choice came from — an environment choice cannot be changed from the screen. */
  source: 'env' | 'stored' | 'default';
  /** Whether a model call can be expected to authenticate. */
  ready: boolean;
  /** One sentence for the player, saying what is wrong and where to fix it. */
  detail: string;
  keys: Record<KeyedProvider, KeyState | null>;
}

/**
 * Is the chosen provider usable, without spending anything?
 *
 * The subscription is asked through the binary, exactly as before. A keyed
 * provider is ready when a well-formed key is present — whether the endpoint
 * accepts it is `checkKey`, which is asynchronous and made when the key is
 * pasted, because a status read on every page load must not be a network call.
 *
 * Probe failure is not readiness failure, for the subscription as before: a
 * null auth status means the probe itself failed, and the first model call will
 * produce a truer error than a guess would.
 */
export function providerStatus(
  settings: Settings = readSettings(),
  env: NodeJS.ProcessEnv = process.env,
  probe: () => AuthStatus | null = readAuthStatus,
): ProviderStatus {
  const choice = chosenProvider(settings, env);
  const keys = Object.fromEntries(
    KEYED_PROVIDERS.map((p) => {
      const resolved = resolveKey(p, settings, env);
      return [p, resolved ? { hint: keyHint(resolved.key), source: resolved.source } : null];
    }),
  ) as Record<KeyedProvider, KeyState | null>;

  const id = choice.id;
  if (id === 'subscription') {
    try {
      assertLoggedIn(probe());
      return { provider: 'subscription', source: choice.source, ready: true, detail: 'Claude subscription', keys };
    } catch (err) {
      const firstLine = err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err);
      return {
        provider: 'subscription',
        source: choice.source,
        ready: false,
        detail: `${firstLine} Run \`pnpm login\` in a terminal, or choose a provider you can pay with an API key.`,
        keys,
      };
    }
  }

  const key = keys[id];
  if (!key) {
    return {
      provider: id,
      source: choice.source,
      ready: false,
      detail: missingKeyMessage(id).split('.')[0] + '.',
      keys,
    };
  }
  const problem = keyProblem(id, resolveKey(id, settings, env)!.key);
  return {
    provider: id,
    source: choice.source,
    ready: problem === null,
    detail: problem ?? `${id === 'anthropic' ? 'Anthropic API' : 'OpenRouter'} key ${key.hint}${key.source === 'env' ? ` (from ${KEY_ENV[id]})` : ''}`,
    keys,
  };
}

export interface PreflightResult {
  warnings: string[];
  status: ProviderStatus;
}

/**
 * Startup checks for the server.
 *
 * There is no TTY requirement: nothing in this project draws to a terminal.
 *
 * **Not fatal any more, and that is the inversion A.5 predicted.** The server
 * used to refuse to start without subscription auth, on the grounds that one
 * which accepts a campaign and then fails every action is worse than one that
 * refuses to start. That argument still holds and is still honoured — the
 * server refuses to START A CAMPAIGN until the provider is ready — but a key is
 * now entered in the browser, and a server that will not start cannot show the
 * screen it is entered on. So an unusable provider is a warning here, and the
 * first page the player sees is the settings screen.
 */
export function runServerPreflight(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const warnings: string[] = [];
  const status = providerStatus(readSettings(env), env);
  if (status.provider === 'subscription') {
    const notice = apiKeyNotice(env);
    if (notice) warnings.push(notice);
  }
  if (!status.ready) {
    warnings.push(`${status.detail} The browser will open on the settings screen.`);
  }
  return { warnings, status };
}
