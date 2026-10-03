import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Plain-JS mirror of the read half of src/model/settings.ts, so the setup
 * scripts know which provider is chosen before (and independently of) a
 * TypeScript build — the same reason token-store.mjs mirrors auth.ts.
 *
 * Read-only on purpose: keys are written by the server's settings route, which
 * checks them first, and by nothing here.
 */

const PROVIDERS = ['subscription', 'anthropic', 'openrouter'];
export const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

export function configDir(env = process.env) {
  return env.PAXGALACTICA_HOME?.trim() || join(homedir(), '.paxgalactica');
}

export const settingsPath = (env = process.env) => join(configDir(env), 'settings.json');

export function readSettings(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** `PAXGALACTICA_PROVIDER`, else the stored choice, else the subscription. */
export function chosenProvider(env = process.env) {
  const fromEnv = env.PAXGALACTICA_PROVIDER?.trim();
  if (PROVIDERS.includes(fromEnv)) return { id: fromEnv, source: 'env' };
  const stored = readSettings(env).provider;
  if (PROVIDERS.includes(stored)) return { id: stored, source: 'stored' };
  return { id: 'subscription', source: 'default' };
}

/** The key a keyed provider would use, and where from — never printed whole. */
export function resolveKey(provider, env = process.env) {
  const stored = readSettings(env).keys?.[provider];
  if (typeof stored === 'string' && stored.length > 0) return { key: stored, source: 'stored' };
  const fromEnv = env[KEY_ENV[provider]]?.trim();
  return fromEnv ? { key: fromEnv.replace(/\s+/g, ''), source: 'env' } : null;
}

export const keyHint = (key) =>
  key.length <= 8 ? '…' : `${key.slice(0, key.indexOf('-', 3) + 1 || 3)}…${key.slice(-4)}`;

export const PROVIDER_NAMES = {
  subscription: 'Claude subscription',
  anthropic: 'Anthropic API key',
  openrouter: 'OpenRouter key',
};
