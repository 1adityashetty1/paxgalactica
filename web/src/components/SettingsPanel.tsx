import { useEffect, useState } from 'react';
import type { SettingsView } from '../../../src/api/contract.js';
import type { ProviderId } from '../../../src/model/provider-ids.js';
import { api } from '../api.js';

/**
 * Who pays for the model calls (docs/architecture.md A.5, A.6).
 *
 * The first screen a new player sees when no provider is usable, and the
 * Settings button's overlay after that. A key is pasted here, posted to the
 * server, checked against the provider and stored there — this screen only
 * ever sees `sk-or-…4f2a` afterwards.
 *
 * It says what the game costs before a key is pasted, because under a key the
 * game is spending the player's money and a downloaded thing that can bill a
 * stranger's card should say so first.
 */

const PROVIDERS: { id: ProviderId; name: string; blurb: string }[] = [
  {
    id: 'subscription',
    name: 'Claude subscription',
    blurb: 'Pro or Max. Billed as plan usage, not per token. Set up in a terminal with `pnpm login`.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic API key',
    blurb: 'sk-ant-api… from console.anthropic.com. The models the game was built and measured on, billed per token.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter key',
    blurb: 'sk-or-… from openrouter.ai. The same models by default, and any other model per tier, billed per token.',
  },
];

const TIERS = [
  { id: 'reasoning', label: 'Reasoning', what: 'resolving actions, diplomacy, reading an accord, the ending' },
  { id: 'narrative', label: 'Narrative', what: 'how the other powers react each turn' },
  { id: 'flavor', label: 'Flavour', what: 'pricing an action, the advisor, colour text' },
] as const;

const money = (usd: number) => `$${usd.toFixed(2)}`;

export function SettingsPanel({
  firstRun,
  onDone,
}: {
  /** No campaign behind this screen, and nothing can be played until it is ready. */
  firstRun: boolean;
  /** Called with the settings once the player is finished — or immediately ready, on first run. */
  onDone: (view: SettingsView) => void;
}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [choice, setChoice] = useState<ProviderId>('subscription');
  const [key, setKey] = useState('');
  const [cap, setCap] = useState('');
  const [models, setModels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const adopt = (v: SettingsView) => {
    setView(v);
    setChoice(v.provider);
    setCap(v.spendCapUsd === null ? '' : String(v.spendCapUsd));
    setKey('');
  };

  useEffect(() => {
    void api
      .settings()
      .then(adopt)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!view) {
    return <div className="loading">{error ?? 'Reading settings…'}</div>;
  }

  const keyed = choice === 'anthropic' || choice === 'openrouter' ? choice : null;
  const locked = view.source === 'env';
  const stored = keyed ? view.keys[keyed] : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const capValue = cap.trim() === '' ? null : Number(cap);
      if (capValue !== null && (!Number.isFinite(capValue) || capValue < 0)) {
        throw new Error('The spend cap is a number of dollars, or blank for none.');
      }
      const overrides = keyed
        ? Object.fromEntries(TIERS.map((t) => [t.id, models[`${keyed}.${t.id}`] ?? undefined]).filter(([, v]) => v !== undefined))
        : {};
      const next = await api.updateSettings({
        ...(locked ? {} : { provider: choice }),
        ...(keyed && key.trim() ? { key: { provider: keyed, key: key.trim() } } : {}),
        ...(view.capSource === 'env' ? {} : { spendCapUsd: capValue }),
        ...(keyed && Object.keys(overrides).length > 0 ? { models: { provider: keyed, ...overrides } } : {}),
      });
      adopt(next);
      setModels({});
      if (next.ready && (!firstRun || next.check?.status !== 'unchecked')) onDone(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    if (!keyed) return;
    setBusy(true);
    setError(null);
    try {
      adopt(await api.updateSettings({ clearKey: keyed }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="picker settings">
      <h1>{firstRun ? 'PAX GALACTICA' : 'Settings'}</h1>
      <p className="tagline">
        {firstRun
          ? 'Every action, reaction and conversation is a model call. Choose who pays for them.'
          : 'Who pays for the model calls, and how much this session may spend.'}
      </p>

      <p className={view.ready ? 'settings-status ok' : 'settings-status bad'}>
        {view.ready ? '● Ready — ' : '● Not ready — '}
        {view.detail}
      </p>
      {view.check && (
        <p className={view.check.status === 'ok' ? 'hint' : 'error'}>Key check: {view.check.detail}.</p>
      )}
      {error && <p className="error">{error}</p>}

      <h2>Provider</h2>
      {locked && (
        <p className="hint">
          Chosen by <code>PAXGALACTICA_PROVIDER</code> in the server's environment, so it cannot be
          changed here.
        </p>
      )}
      <div className="faction-cards">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`faction-card provider-card${choice === p.id ? ' chosen' : ''}`}
            disabled={locked && p.id !== view.provider}
            onClick={() => setChoice(p.id)}
            aria-pressed={choice === p.id}
          >
            <strong>{p.name}</strong>
            <span>{p.blurb}</span>
          </button>
        ))}
      </div>

      {choice === 'subscription' && (
        <p className="hint">
          In a terminal in the game's directory, run <code>pnpm login</code> and then{' '}
          <code>pnpm auth</code>, then press Save here.
        </p>
      )}

      {keyed && (
        <>
          <h2>{keyed === 'anthropic' ? 'Anthropic API key' : 'OpenRouter key'}</h2>
          {stored && (
            <p className="hint">
              Stored: <code>{stored.hint}</code>
              {stored.source === 'env' ? ' (from the environment)' : ''}.{' '}
              {stored.source === 'stored' && (
                <button type="button" className="link" disabled={busy} onClick={() => void clearKey()}>
                  forget it
                </button>
              )}
            </p>
          )}
          <input
            className="settings-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={stored ? 'paste a new key to replace it' : keyed === 'anthropic' ? 'sk-ant-api…' : 'sk-or-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="hint">
            Kept on this machine in <code>~/.paxgalactica/settings.json</code> (readable only by you),
            checked with the provider before it is saved, and never sent back to the browser.
          </p>
        </>
      )}

      <h2>Cost</h2>
      <p className="hint">
        About {money(view.estimatePerTurnUsd)} a turn on the default models when paying per token — a
        30-turn campaign is roughly {money(view.estimatePerTurnUsd * 30)}. A turn spent talking costs
        more; ending a quiet turn costs nothing. This session has spent {money(view.spentUsd)}.
      </p>
      <div className="length-picker">
        <label htmlFor="spend-cap">Stop spending at $</label>
        <input
          id="spend-cap"
          className="settings-input narrow"
          inputMode="decimal"
          placeholder="no cap"
          disabled={view.capSource === 'env'}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
        <span className="hint">per server session</span>
      </div>
      {view.capSource === 'env' && <p className="hint">Set by <code>PAXGALACTICA_SPEND_CAP</code>.</p>}

      {keyed && (
        <>
          <p>
            <button type="button" className="link" onClick={() => setAdvanced((a) => !a)}>
              {advanced ? '▾' : '▸'} Models per tier
            </button>
          </p>
          {advanced && (
            <div className="settings-models">
              {TIERS.map((t) => {
                const field = `${keyed}.${t.id}`;
                const current = view.models[keyed][t.id];
                const fallback = view.defaults[keyed][t.id];
                return (
                  <label key={t.id}>
                    <span>
                      {t.label} <em className="hint">— {t.what}</em>
                    </span>
                    <input
                      className="settings-input"
                      spellCheck={false}
                      value={models[field] ?? (current === fallback ? '' : current)}
                      placeholder={fallback}
                      onChange={(e) => setModels((m) => ({ ...m, [field]: e.target.value.trim() }))}
                    />
                  </label>
                );
              })}
              <p className="hint">
                Blank uses the default. The game's prompts were built and measured on the defaults, so
                another model is a real change — cheaper is often fine for Flavour, riskier for Reasoning.
              </p>
            </div>
          )}
        </>
      )}

      <p className="settings-actions">
        <button type="button" className="resume-btn" disabled={busy} onClick={() => void save()}>
          {busy ? 'Checking…' : 'Save'}
        </button>
        {!firstRun && (
          <button type="button" className="resume-btn" disabled={busy} onClick={() => onDone(view)}>
            Close
          </button>
        )}
        {firstRun && view.ready && (
          <button type="button" className="resume-btn" disabled={busy} onClick={() => onDone(view)}>
            Continue →
          </button>
        )}
      </p>
    </div>
  );
}
