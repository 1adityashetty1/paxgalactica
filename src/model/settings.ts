import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderIdSchema, type KeyedProvider, type ProviderId } from './provider-ids.js';

/**
 * Who pays for the model calls, and with what credential (docs/architecture.md
 * A.5, A.6).
 *
 * Three providers:
 *
 * | id             | credential                          | billed as                      |
 * |----------------|-------------------------------------|--------------------------------|
 * | `subscription` | `claude setup-token`, via `pnpm login` | usage against a Pro/Max plan |
 * | `anthropic`    | an Anthropic API key, `sk-ant-api…` | per token, to that API account |
 * | `openrouter`   | an OpenRouter key, `sk-or-…`        | per token, to that account     |
 *
 * **Nothing selects a paying provider by accident.** An `ANTHROPIC_API_KEY`
 * exported from a shell profile was the reason the subscription path strips key
 * variables, and that guarantee survives: a key in the environment is *read* by
 * the `anthropic` provider once that provider has been chosen, and never chooses
 * it. The choice is `PAXGALACTICA_PROVIDER`, or what the player picked on the
 * settings screen, and the default is the subscription — the configuration
 * every campaign to date was played under.
 *
 * Stored at `~/.paxgalactica/settings.json`, mode 0600, beside the subscription
 * token and for the same reason: outside the repo, so it cannot be committed.
 * `PAXGALACTICA_HOME` moves the directory, which is what keeps the suite from
 * ever reading a developer's real keys.
 */

export { KEYED_PROVIDERS, PROVIDER_IDS, ProviderIdSchema } from './provider-ids.js';
export type { KeyedProvider, ProviderId } from './provider-ids.js';

export const MODEL_TIER_NAMES = ['reasoning', 'narrative', 'flavor'] as const;

/** A model id a player may route a tier to. Loose, because ids change shape between vendors. */
const ModelIdSchema = z.string().regex(/^[\w.:/@-]{1,120}$/);

const TierModelsSchema = z
  .object({
    reasoning: ModelIdSchema.optional(),
    narrative: ModelIdSchema.optional(),
    flavor: ModelIdSchema.optional(),
  })
  .default({});

export const SettingsSchema = z.object({
  provider: ProviderIdSchema.optional(),
  keys: z
    .object({ anthropic: z.string().optional(), openrouter: z.string().optional() })
    .default({}),
  /**
   * Models per tier for the keyed providers, overriding the tables in
   * `router.ts`. The answer to the architecture document's open question
   * "does `ROUTES` become configuration?": which CALL goes to which tier stays
   * source, because that is a design decision with reasoning attached to every
   * line; which MODEL serves a tier is configuration, because the right answer
   * changes month to month and the player is the one paying for it.
   */
  models: z
    .object({ anthropic: TierModelsSchema, openrouter: TierModelsSchema })
    .partial()
    .default({}),
  /** Dollars this server process may spend before model calls stop. Null for no cap. */
  spendCapUsd: z.number().min(0).max(10_000).nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAXGALACTICA_HOME?.trim() || join(homedir(), '.paxgalactica');
}

export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'settings.json');
}

const EMPTY: Settings = SettingsSchema.parse({});

/**
 * Read the stored settings. A missing or unreadable file is the empty settings,
 * not an error: the first run has no file, and a file somebody broke by hand
 * should send them to the settings screen rather than stop the server.
 */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  try {
    const parsed = SettingsSchema.safeParse(JSON.parse(readFileSync(settingsPath(env), 'utf8')));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Write atomically and 0600: a half-written key file is a lost key. */
export function writeSettings(settings: Settings, env: NodeJS.ProcessEnv = process.env): void {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true });
  const path = settingsPath(env);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(SettingsSchema.parse(settings), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function updateSettings(
  change: (current: Settings) => Settings,
  env: NodeJS.ProcessEnv = process.env,
): Settings {
  const next = change(readSettings(env));
  writeSettings(next, env);
  return next;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a well-formed key looks like, per provider.
 *
 * The subscription's validator was one regex (`sk-ant-oat…`); a pasted API key
 * or OpenRouter key has its own prefix, and what this is really for is catching
 * a truncated paste or the wrong kind of credential before it is stored — an
 * OAuth token pasted as an API key is the commonest mistake, and it is the one
 * that matters, because the two bill different accounts.
 */
const KEY_PATTERN: Record<KeyedProvider, RegExp> = {
  anthropic: /^sk-ant-api\d\d-[\w-]{20,}$/,
  openrouter: /^sk-or-[\w-]{20,}$/,
};

export function normalizeKey(key: string): string {
  // A key wrapped across terminal lines comes back with whitespace inside it.
  return key.replace(/\s+/g, '');
}

export function keyProblem(provider: KeyedProvider, key: string): string | null {
  const clean = normalizeKey(key);
  if (clean.length === 0) return 'The key is empty.';
  if (provider === 'anthropic' && clean.startsWith('sk-ant-oat')) {
    return 'That is a subscription token, not an API key. Choose the subscription provider and run `pnpm login` instead.';
  }
  if (provider === 'anthropic' && clean.startsWith('sk-or-')) {
    return 'That is an OpenRouter key. Choose the OpenRouter provider for it.';
  }
  if (provider === 'openrouter' && clean.startsWith('sk-ant-')) {
    return 'That is an Anthropic credential. Choose the Anthropic provider for it.';
  }
  if (!KEY_PATTERN[provider].test(clean)) {
    return provider === 'anthropic'
      ? 'That does not look like an Anthropic API key, which begins "sk-ant-api". It may have been cut short when it was copied.'
      : 'That does not look like an OpenRouter key, which begins "sk-or-". It may have been cut short when it was copied.';
  }
  return null;
}

/** The environment variable each keyed provider also reads, once it has been chosen. */
export const KEY_ENV: Record<KeyedProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export interface ResolvedKey {
  key: string;
  source: 'stored' | 'env';
}

/** The stored key wins over the environment: the settings screen is the one the player can see. */
export function resolveKey(
  provider: KeyedProvider,
  settings: Settings = readSettings(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedKey | null {
  const stored = settings.keys[provider];
  if (stored && stored.length > 0) return { key: stored, source: 'stored' };
  const fromEnv = env[KEY_ENV[provider]]?.trim();
  if (fromEnv) return { key: normalizeKey(fromEnv), source: 'env' };
  return null;
}

/** `sk-…4f2a`. A key is posted in and never comes back out — this is all a screen ever shows. */
export function keyHint(key: string): string {
  const clean = normalizeKey(key);
  return clean.length <= 8 ? '…' : `${clean.slice(0, clean.indexOf('-', 3) + 1 || 3)}…${clean.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Which provider                                                       */
/* ------------------------------------------------------------------ */

export interface ProviderChoice {
  id: ProviderId;
  /** Where the choice came from, so the settings screen can say why it cannot change it. */
  source: 'env' | 'stored' | 'default';
}

export function chosenProvider(
  settings: Settings = readSettings(),
  env: NodeJS.ProcessEnv = process.env,
): ProviderChoice {
  const fromEnv = ProviderIdSchema.safeParse(env.PAXGALACTICA_PROVIDER?.trim());
  if (fromEnv.success) return { id: fromEnv.data, source: 'env' };
  if (settings.provider) return { id: settings.provider, source: 'stored' };
  return { id: 'subscription', source: 'default' };
}

/** The spend cap in force: `PAXGALACTICA_SPEND_CAP` over the stored one. */
export function spendCap(
  settings: Settings = readSettings(),
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.PAXGALACTICA_SPEND_CAP?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return settings.spendCapUsd;
}
