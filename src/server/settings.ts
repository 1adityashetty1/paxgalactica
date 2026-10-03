import type { SettingsUpdate, SettingsView } from '../api/contract.js';
import { stats } from '../model/client.js';
import { ESTIMATED_USD_PER_TURN } from '../model/pricing.js';
import { checkKey, type KeyCheck } from '../model/provider.js';
import { API_TIER_TABLES, type ApiTierConfig, type ModelTier } from '../model/router.js';
import {
  keyProblem,
  normalizeKey,
  readSettings,
  spendCap,
  updateSettings,
  type KeyedProvider,
  type Settings,
} from '../model/settings.js';
import { providerStatus, type ProviderStatus } from '../preflight.js';
import { ApiFailure } from './errors.js';

/**
 * The settings screen's server half (docs/architecture.md A.5).
 *
 * A key is POSTed in, checked against the provider, stored at mode 0600 beside
 * the subscription token, and never returned by any route — the view carries
 * `sk-or-…4f2a` and where the key came from. Kept out of `GameSession` because
 * none of it is about a campaign: it is answerable, and changeable, before
 * there is one, which is the whole point of the first-run screen.
 */

/** How the server learns provider readiness; a seam so the suite never spawns the binary. */
export type StatusOf = (settings: Settings) => ProviderStatus;

const defaultStatus: StatusOf = (settings) => providerStatus(settings);

function tierModels(table: Record<ModelTier, ApiTierConfig>, overrides: Partial<Record<ModelTier, string>> = {}) {
  return {
    reasoning: overrides.reasoning || table.reasoning.model,
    narrative: overrides.narrative || table.narrative.model,
    flavor: overrides.flavor || table.flavor.model,
  };
}

export function settingsView(
  check: KeyCheck | null = null,
  statusOf: StatusOf = defaultStatus,
  settings: Settings = readSettings(),
): SettingsView {
  const status = statusOf(settings);
  const envCap = process.env.PAXGALACTICA_SPEND_CAP?.trim();
  return {
    provider: status.provider,
    source: status.source,
    ready: status.ready,
    detail: status.detail,
    keys: status.keys,
    models: {
      anthropic: tierModels(API_TIER_TABLES.anthropic, settings.models.anthropic),
      openrouter: tierModels(API_TIER_TABLES.openrouter, settings.models.openrouter),
    },
    defaults: {
      anthropic: tierModels(API_TIER_TABLES.anthropic),
      openrouter: tierModels(API_TIER_TABLES.openrouter),
    },
    spendCapUsd: spendCap(settings),
    capSource: envCap ? 'env' : 'stored',
    spentUsd: stats.costUsd,
    estimatePerTurnUsd: ESTIMATED_USD_PER_TURN,
    check,
  };
}

/**
 * Apply one update. A key is checked BEFORE it is stored, and one the
 * provider rejects is refused rather than saved — the commonest failure is a
 * truncated paste, and storing it would only move the error to the first
 * action of the campaign. One that cannot be checked (offline, or the suite)
 * is stored with the check's result shown, since being offline is no reason to
 * lose what was pasted.
 */
export async function applySettingsUpdate(
  update: SettingsUpdate,
  statusOf: StatusOf = defaultStatus,
  check: (provider: KeyedProvider, key: string) => Promise<KeyCheck> = checkKey,
): Promise<SettingsView> {
  let keyCheck: KeyCheck | null = null;
  let key: string | null = null;

  if (update.key) {
    key = normalizeKey(update.key.key);
    const problem = keyProblem(update.key.provider, key);
    if (problem) throw new ApiFailure('bad_request', problem);
    keyCheck = await check(update.key.provider, key);
    if (keyCheck.status === 'rejected') {
      throw new ApiFailure('bad_request', `${keyCheck.detail}. The key was not saved.`);
    }
  }

  const next = updateSettings((current) => {
    const out: Settings = {
      ...current,
      keys: { ...current.keys },
      models: { ...current.models },
    };
    if (update.provider) out.provider = update.provider;
    if (update.key && key) out.keys[update.key.provider] = key;
    if (update.clearKey) delete out.keys[update.clearKey];
    if (update.spendCapUsd !== undefined) out.spendCapUsd = update.spendCapUsd;
    if (update.models) {
      const { provider, ...tiers } = update.models;
      const merged: Partial<Record<ModelTier, string>> = { ...(current.models[provider] ?? {}) };
      for (const [tier, model] of Object.entries(tiers) as [ModelTier, string | undefined][]) {
        if (model === undefined) continue;
        if (model === '') delete merged[tier];
        else merged[tier] = model;
      }
      out.models[provider] = merged;
    }
    return out;
  });

  return settingsView(keyCheck, statusOf, next);
}
