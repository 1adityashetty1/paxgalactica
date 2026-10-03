import { mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ROUTES } from '../src/api/contract.js';
import { MemoryCampaignStore, resolveSaveDir } from '../src/engine/store.js';
import { callStructured, stats } from '../src/model/client.js';
import { NotLoggedInError, SpendCapError } from '../src/model/errors.js';
import { costFor, priceFor } from '../src/model/pricing.js';
import {
  anthropicProvider,
  checkKey,
  openRouterProvider,
  setProviderOverride,
  type AttemptMetrics,
  type Provider,
} from '../src/model/provider.js';
import { API_TIERS, apiTierFor, OPENROUTER_TIERS } from '../src/model/router.js';
import {
  chosenProvider,
  keyHint,
  keyProblem,
  readSettings,
  resolveKey,
  settingsPath,
  SettingsSchema,
  spendCap,
  writeSettings,
} from '../src/model/settings.js';
import { NULL_SINK, setTelemetrySink, type TraceRecord } from '../src/model/telemetry.js';
import { providerStatus, runServerPreflight } from '../src/preflight.js';
import { dispatch } from '../src/server/router.js';
import { GameSession } from '../src/server/session.js';

/**
 * The provider seam and the credential that goes with it
 * (docs/architecture.md A.1, A.5, A.6). Nothing here leaves the process: the
 * HTTP providers are handed a fake client or a fake `fetch`, and every
 * settings file is written under a temporary `PAXGALACTICA_HOME`.
 */

const ANTHROPIC_KEY = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ';
const OPENROUTER_KEY = 'sk-or-v1-' + 'b'.repeat(56) + '4f2a';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pax-home-'));
  vi.stubEnv('PAXGALACTICA_HOME', home);
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENROUTER_API_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  setProviderOverride(null);
  setTelemetrySink(NULL_SINK);
});

const settingsWith = (over: Partial<z.input<typeof SettingsSchema>> = {}) => SettingsSchema.parse(over);

describe('settings', () => {
  it('round-trips through a file only its owner can read', () => {
    writeSettings(settingsWith({ provider: 'openrouter', keys: { openrouter: OPENROUTER_KEY } }));
    expect(readSettings().provider).toBe('openrouter');
    expect(readSettings().keys.openrouter).toBe(OPENROUTER_KEY);
    expect(statSync(settingsPath()).mode & 0o777).toBe(0o600);
  });

  it('reads a missing or broken file as empty rather than failing', () => {
    expect(readSettings()).toEqual(settingsWith());
  });

  it('defaults to the subscription, and an exported API key does not change that', () => {
    // The guarantee the subscription path's key-stripping exists for: a key in
    // a shell profile never chooses a paying provider on its own.
    expect(chosenProvider(settingsWith(), { ANTHROPIC_API_KEY: ANTHROPIC_KEY })).toEqual({
      id: 'subscription',
      source: 'default',
    });
  });

  it('takes PAXGALACTICA_PROVIDER over the stored choice', () => {
    const stored = settingsWith({ provider: 'anthropic' });
    expect(chosenProvider(stored, {})).toEqual({ id: 'anthropic', source: 'stored' });
    expect(chosenProvider(stored, { PAXGALACTICA_PROVIDER: 'openrouter' })).toEqual({ id: 'openrouter', source: 'env' });
    expect(chosenProvider(stored, { PAXGALACTICA_PROVIDER: 'nonsense' }).id).toBe('anthropic');
  });

  it('prefers a stored key to the environment, and reads the environment once the provider is chosen', () => {
    expect(resolveKey('anthropic', settingsWith(), { ANTHROPIC_API_KEY: ANTHROPIC_KEY })).toEqual({
      key: ANTHROPIC_KEY,
      source: 'env',
    });
    expect(
      resolveKey('anthropic', settingsWith({ keys: { anthropic: 'sk-ant-api03-stored' } }), {
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      })?.source,
    ).toBe('stored');
    expect(resolveKey('openrouter', settingsWith(), {})).toBeNull();
  });

  it('catches the wrong credential, and a truncated paste, before it is stored', () => {
    expect(keyProblem('anthropic', ANTHROPIC_KEY)).toBeNull();
    expect(keyProblem('openrouter', OPENROUTER_KEY)).toBeNull();
    expect(keyProblem('anthropic', 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz')).toMatch(/subscription token/);
    expect(keyProblem('anthropic', OPENROUTER_KEY)).toMatch(/OpenRouter/);
    expect(keyProblem('openrouter', ANTHROPIC_KEY)).toMatch(/Anthropic/);
    expect(keyProblem('openrouter', 'sk-or-v1-abc')).toMatch(/cut short/);
    // Wrapped across terminal lines, which is how keys get pasted.
    expect(keyProblem('openrouter', OPENROUTER_KEY.slice(0, 20) + '\n' + OPENROUTER_KEY.slice(20))).toBeNull();
  });

  it('shows a hint that never carries the body of a key', () => {
    expect(keyHint(OPENROUTER_KEY)).toBe('sk-or-…4f2a');
    expect(keyHint(ANTHROPIC_KEY)).toBe('sk-ant-…WXYZ');
    expect(keyHint(OPENROUTER_KEY)).not.toContain('bbbb');
  });

  it('takes the spend cap from the environment over the stored one', () => {
    expect(spendCap(settingsWith({ spendCapUsd: 5 }), {})).toBe(5);
    expect(spendCap(settingsWith({ spendCapUsd: 5 }), { PAXGALACTICA_SPEND_CAP: '2.5' })).toBe(2.5);
    expect(spendCap(settingsWith(), {})).toBeNull();
  });
});

describe('tiers and prices', () => {
  it('sends Haiku no effort, since the API rejects it there', () => {
    expect(API_TIERS.flavor.effort).toBeUndefined();
    expect(OPENROUTER_TIERS.flavor.effort).toBeUndefined();
    expect(API_TIERS.flavor.model).toBe('claude-haiku-4-5');
  });

  it('lets a player route a tier elsewhere without assuming the new model takes the old knobs', () => {
    const tier = apiTierFor('openrouter', 'reaction', { narrative: 'moonshotai/kimi-k3' });
    expect(tier).toEqual({ model: 'moonshotai/kimi-k3', maxTokens: OPENROUTER_TIERS.narrative.maxTokens, tier: 'narrative' });
    expect(apiTierFor('openrouter', 'reaction').thinking).toBe('disabled');
  });

  it('prices any spelling of a model id', () => {
    expect(priceFor('anthropic/claude-haiku-4.5')).toEqual(priceFor('claude-haiku-4-5'));
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual(priceFor('claude-haiku-4-5'));
    expect(priceFor('moonshotai/kimi-k3')).toBeNull();
  });

  it('charges cache reads at a tenth and writes at a quarter more', () => {
    // Sonnet 5: $2 in, $10 out per million.
    expect(costFor('claude-sonnet-5', { inTok: 1_000_000, outTok: 0 })).toBeCloseTo(2);
    expect(costFor('claude-sonnet-5', { inTok: 0, outTok: 1_000_000 })).toBeCloseTo(10);
    expect(costFor('claude-sonnet-5', { inTok: 0, outTok: 0, cacheReadTok: 1_000_000 })).toBeCloseTo(0.2);
    expect(costFor('claude-sonnet-5', { inTok: 0, outTok: 0, cacheWriteTok: 1_000_000 })).toBeCloseTo(2.5);
  });
});

describe('the Anthropic API provider', () => {
  const request = { system: 'SYSTEM', user: 'USER', jsonSchema: { $schema: 'x', type: 'object' }, rawJson: true };

  function fakeClient(reply: object | Error) {
    const create = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
    return { create, make: () => ({ messages: { create } }) as never };
  }

  const message = (text: string) => ({
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
  });

  it('caches the system prompt and says each tier the way the API wants it', async () => {
    const { create, make } = fakeClient(message('{"a":1}'));
    const settings = settingsWith({ keys: { anthropic: ANTHROPIC_KEY } });
    const p = anthropicProvider(() => settings, make);

    await p.call({ kind: 'resolution', ...request }, {});
    await p.call({ kind: 'reaction', ...request }, {});
    await p.call({ kind: 'appraisal', ...request }, {});
    const [reasoning, narrative, flavor] = create.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);

    expect(reasoning!.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(reasoning!.output_config).toEqual({ effort: 'medium' });
    expect(reasoning!.thinking).toBeUndefined();
    expect(narrative!.thinking).toEqual({ type: 'disabled' });
    expect(flavor!.model).toBe('claude-haiku-4-5');
    expect(flavor!.output_config).toBeUndefined();
    expect(flavor!.thinking).toBeUndefined();
  });

  it('hands the schema to the API only under structured output, without strict or $schema', async () => {
    const { create, make } = fakeClient(message('{"a":1}'));
    const p = anthropicProvider(() => settingsWith({ keys: { anthropic: ANTHROPIC_KEY } }), make);
    await p.call({ kind: 'appraisal', ...request, rawJson: false }, {});
    const sent = (create.mock.calls[0] as unknown[])[0] as { output_config: unknown };
    expect(sent.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
  });

  it('computes what the call cost from its tokens', async () => {
    const { make } = fakeClient(message('{"a":1}'));
    const metrics: AttemptMetrics = {};
    const out = await anthropicProvider(() => settingsWith({ keys: { anthropic: ANTHROPIC_KEY } }), make).call(
      { kind: 'resolution', ...request },
      metrics,
    );
    // 1000 in at $2/M + 200 out at $10/M + 5000 cache reads at $0.2/M.
    expect(out.costUsd).toBeCloseTo(0.002 + 0.002 + 0.001);
    expect(out.result).toBe('{"a":1}');
    expect(metrics).toMatchObject({ model: 'claude-sonnet-5', inTok: 1000, outTok: 200, cacheReadTok: 5000, numTurns: 1 });
  });

  it('names the settings screen, not a package manager, when there is no key', async () => {
    const p = anthropicProvider(() => settingsWith(), fakeClient(message('')).make);
    await expect(p.call({ kind: 'resolution', ...request }, {})).rejects.toThrow(NotLoggedInError);
    await expect(p.call({ kind: 'resolution', ...request }, {})).rejects.toThrow(/Settings/);
    await expect(p.call({ kind: 'resolution', ...request }, {})).rejects.not.toThrow(/pnpm/);
  });
});

describe('the OpenRouter provider', () => {
  const request = { system: 'SYSTEM', user: 'USER', jsonSchema: { type: 'object' }, rawJson: true };

  function fakeFetch(status: number, body: object) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  const ok = {
    choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 6000, completion_tokens: 100, cost: 0.0123, prompt_tokens_details: { cached_tokens: 5000 } },
  };
  const keyed = () => settingsWith({ keys: { openrouter: OPENROUTER_KEY } });

  it('sends the key as a bearer token and asks for the cost back', async () => {
    const { calls, impl } = fakeFetch(200, ok);
    await openRouterProvider(keyed, impl).call({ kind: 'resolution', ...request }, {});
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(body.model).toBe('anthropic/claude-sonnet-5');
    expect(body.usage).toEqual({ include: true });
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.response_format).toBeUndefined();
  });

  it('asks an Anthropic model to cache the system prompt, and leaves any other model alone', async () => {
    const { calls, impl } = fakeFetch(200, ok);
    await openRouterProvider(keyed, impl).call({ kind: 'resolution', ...request }, {});
    const other = settingsWith({ keys: { openrouter: OPENROUTER_KEY }, models: { openrouter: { reasoning: 'moonshotai/kimi-k3' } } });
    await openRouterProvider(() => other, impl).call({ kind: 'resolution', ...request }, {});
    const [claude, kimi] = calls.map((c) => JSON.parse(String(c.init.body)) as { messages: { content: unknown }[]; reasoning?: unknown });
    expect(claude!.messages[0]!.content).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(kimi!.messages[0]!.content).toBe('SYSTEM');
    expect(kimi!.reasoning).toBeUndefined();
  });

  it('turns reasoning off for the narrative tier', async () => {
    const { calls, impl } = fakeFetch(200, ok);
    await openRouterProvider(keyed, impl).call({ kind: 'reaction', ...request }, {});
    expect((JSON.parse(String(calls[0]!.init.body)) as { reasoning: unknown }).reasoning).toEqual({ enabled: false });
  });

  it('takes the cost OpenRouter charged, and splits cached input out', async () => {
    const { impl } = fakeFetch(200, ok);
    const metrics: AttemptMetrics = {};
    const out = await openRouterProvider(keyed, impl).call({ kind: 'resolution', ...request }, metrics);
    expect(out).toEqual({ result: '{"a":1}', costUsd: 0.0123 });
    expect(metrics).toMatchObject({ inTok: 1000, cacheReadTok: 5000, outTok: 100 });
  });

  it('reads a rejected key as signed out, and an empty account as something else', async () => {
    await expect(
      openRouterProvider(keyed, fakeFetch(401, { error: { message: 'No auth' } }).impl).call({ kind: 'flavor', ...request }, {}),
    ).rejects.toThrow(NotLoggedInError);
    await expect(
      openRouterProvider(keyed, fakeFetch(402, { error: { message: 'Insufficient credits' } }).impl).call(
        { kind: 'flavor', ...request },
        {},
      ),
    ).rejects.toThrow(/out of credit/);
  });

  it('reports a timeout in the words the retry loop reads one by', async () => {
    const impl = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await expect(openRouterProvider(keyed, impl).call({ kind: 'flavor', ...request }, {})).rejects.toThrow(/went silent/);
  });
});

describe('checking a key', () => {
  it('makes no request while the network is off', async () => {
    const impl = vi.fn() as unknown as typeof fetch;
    expect((await checkKey('openrouter', OPENROUTER_KEY, impl)).status).toBe('unchecked');
    expect(impl).not.toHaveBeenCalled();
  });

  it('tells a rejected key from an unreachable provider', async () => {
    vi.stubEnv('PAXGALACTICA_NO_NETWORK', '0');
    const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
    expect((await checkKey('anthropic', ANTHROPIC_KEY, reply(200))).status).toBe('ok');
    expect((await checkKey('anthropic', ANTHROPIC_KEY, reply(401))).status).toBe('rejected');
    expect((await checkKey('openrouter', OPENROUTER_KEY, reply(503))).status).toBe('unchecked');
  });
});

describe('the client above the providers', () => {
  const Answer = z.object({ answer: z.number() });
  const ask = () => callStructured({ kind: 'appraisal', system: 'S', user: 'U', schema: Answer });

  beforeEach(() => {
    vi.stubEnv('PAXGALACTICA_NO_NETWORK', '0');
    stats.costUsd = 0;
  });

  function scripted(...replies: (string | Error)[]): Provider & { calls: number; seen: { system: string; user: string }[] } {
    const p = {
      id: 'openrouter' as const,
      calls: 0,
      seen: [] as { system: string; user: string }[],
      async call(req: { system: string; user: string }, metrics: AttemptMetrics) {
        p.calls += 1;
        p.seen.push({ system: req.system, user: req.user });
        metrics.model = 'test-model';
        const next = replies.shift();
        if (next instanceof Error) throw next;
        return { result: next ?? '', costUsd: 0.5 };
      },
    };
    return p;
  }

  it('asks every provider for the same thing, schema inlined and rule restated', async () => {
    const p = scripted('{"answer":1}');
    setProviderOverride(p);
    await ask();
    expect(p.seen[0]!.system).toMatch(/## Output format/);
    expect(p.seen[0]!.user).toMatch(/Answer with the JSON object alone/);
  });

  it('records which provider and model answered', async () => {
    const records: TraceRecord[] = [];
    setTelemetrySink({ write: (r) => void records.push(r) });
    setProviderOverride(scripted('{"answer":1}'));
    await ask();
    expect(records[0]).toMatchObject({ type: 'call', provider: 'openrouter', model: 'test-model', costUsd: 0.5 });
  });

  it('stops before a call once the spend cap is reached, and does not retry it', async () => {
    vi.stubEnv('PAXGALACTICA_SPEND_CAP', '1');
    const p = scripted('{"nope":1}', '{"nope":1}', '{"answer":1}');
    setProviderOverride(p);
    // Two attempts at $0.50 reach the cap; the third is never made.
    await expect(ask()).rejects.toThrow(SpendCapError);
    expect(p.calls).toBe(2);
    await expect(ask()).rejects.toThrow(/spend cap of \$1\.00/);
    expect(p.calls).toBe(2);
  });

  it('does not retry a missing key', async () => {
    const p = scripted(new NotLoggedInError('No OpenRouter API key is set.'));
    setProviderOverride(p);
    await expect(ask()).rejects.toThrow(NotLoggedInError);
    expect(p.calls).toBe(1);
  });
});

describe('provider status and startup', () => {
  it('is not ready without a key, and ready with a well-formed one', () => {
    const none = providerStatus(settingsWith({ provider: 'openrouter' }), {});
    expect(none).toMatchObject({ provider: 'openrouter', ready: false, keys: { openrouter: null } });
    const some = providerStatus(settingsWith({ provider: 'openrouter', keys: { openrouter: OPENROUTER_KEY } }), {});
    expect(some).toMatchObject({ ready: true, keys: { openrouter: { hint: 'sk-or-…4f2a', source: 'stored' } } });
    expect(JSON.stringify(some)).not.toContain(OPENROUTER_KEY);
  });

  it('asks the binary only when the subscription is chosen', () => {
    const probe = vi.fn(() => ({ loggedIn: false }));
    expect(providerStatus(settingsWith(), {}, probe).ready).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    providerStatus(settingsWith({ provider: 'anthropic' }), {}, probe);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('starts the server whatever the provider state, so the key can be entered in the browser', () => {
    writeSettings(settingsWith({ provider: 'openrouter' }));
    const result = runServerPreflight({ PAXGALACTICA_HOME: home });
    expect(result.status.ready).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/settings screen/);
  });
});

describe('the settings routes', () => {
  const session = () => new GameSession(new MemoryCampaignStore());
  const deps = (status: 'ok' | 'rejected' | 'unchecked' = 'ok') => ({
    statusOf: (s: ReturnType<typeof readSettings>) => providerStatus(s, {}, () => ({ loggedIn: true, authMethod: 'claudeai' })),
    checkKey: vi.fn(async () => ({ status, detail: `check ${status}` })),
  });

  it('answers before any campaign exists', async () => {
    const res = await dispatch(session(), 'GET', ROUTES.settings, {}, deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'subscription', ready: true, spendCapUsd: null });
  });

  it('stores a checked key and never sends it back', async () => {
    const d = deps();
    const res = await dispatch(
      session(),
      'POST',
      ROUTES.settings,
      { provider: 'openrouter', key: { provider: 'openrouter', key: OPENROUTER_KEY } },
      d,
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(OPENROUTER_KEY);
    expect(res.body).toMatchObject({ provider: 'openrouter', ready: true, keys: { openrouter: { hint: 'sk-or-…4f2a' } } });
    expect(readFileSync(settingsPath(), 'utf8')).toContain(OPENROUTER_KEY);
    expect(d.checkKey).toHaveBeenCalledWith('openrouter', OPENROUTER_KEY);
  });

  it('refuses a key the provider rejects, and one that is plainly the wrong kind', async () => {
    const rejected = await dispatch(
      session(),
      'POST',
      ROUTES.settings,
      { key: { provider: 'openrouter', key: OPENROUTER_KEY } },
      deps('rejected'),
    );
    expect(rejected.status).toBe(400);
    expect(readSettings().keys.openrouter).toBeUndefined();

    const wrong = await dispatch(
      session(),
      'POST',
      ROUTES.settings,
      { key: { provider: 'anthropic', key: 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz' } },
      deps(),
    );
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toMatch(/subscription token/);
  });

  it('keeps a key it could not check, and says so', async () => {
    const res = await dispatch(
      session(),
      'POST',
      ROUTES.settings,
      { key: { provider: 'openrouter', key: OPENROUTER_KEY } },
      deps('unchecked'),
    );
    expect(res.body).toMatchObject({ check: { status: 'unchecked' } });
    expect(readSettings().keys.openrouter).toBe(OPENROUTER_KEY);
  });

  it('forgets a key, sets a cap, and routes a tier — an empty model clearing the override', async () => {
    writeSettings(settingsWith({ keys: { openrouter: OPENROUTER_KEY } }));
    await dispatch(session(), 'POST', ROUTES.settings, {
      clearKey: 'openrouter',
      spendCapUsd: 3,
      models: { provider: 'openrouter', flavor: 'google/gemini-3-flash' },
    }, deps());
    expect(readSettings()).toMatchObject({ keys: {}, spendCapUsd: 3, models: { openrouter: { flavor: 'google/gemini-3-flash' } } });

    const res = await dispatch(session(), 'POST', ROUTES.settings, { models: { provider: 'openrouter', flavor: '' } }, deps());
    expect(readSettings().models.openrouter).toEqual({});
    expect(res.body).toMatchObject({ models: { openrouter: { flavor: 'anthropic/claude-haiku-4.5' } } });
  });
});

describe('a campaign on a provider that cannot answer', () => {
  it('is refused, naming the settings screen', async () => {
    const s = new GameSession(new MemoryCampaignStore(), () => {}, () => ({ ready: false, detail: 'No OpenRouter API key is set.' }));
    const res = await dispatch(s, 'POST', ROUTES.newCampaign, { factionId: 'meridian' });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/not_authenticated.*Settings/);
  });

  it('is shown what has been spent, and the cap', async () => {
    vi.stubEnv('PAXGALACTICA_SPEND_CAP', '4');
    stats.costUsd = 1.25;
    const s = new GameSession(new MemoryCampaignStore());
    const res = await dispatch(s, 'POST', ROUTES.newCampaign, { factionId: 'meridian' });
    expect((res.body as { spend: unknown }).spend).toEqual({ usd: 1.25, capUsd: 4 });
    stats.costUsd = 0;
  });
});

describe('where saves live', () => {
  it('keeps a clone on its own saves directory, and puts an installed copy in the user directory', () => {
    const clone = mkdtempSync(join(tmpdir(), 'pax-clone-'));
    mkdirSync(join(clone, '.git'));
    expect(resolveSaveDir({}, clone)).toBe(join(clone, 'saves'));
    const installed = mkdtempSync(join(tmpdir(), 'pax-pkg-'));
    expect(resolveSaveDir({}, installed)).toMatch(/\.paxgalactica[/\\]saves$/);
    expect(resolveSaveDir({ PAXGALACTICA_HOME: '/x/home' }, installed)).toBe(join('/x/home', 'saves'));
    expect(resolveSaveDir({ PAXGALACTICA_SAVE_DIR: '/x/saves' }, installed)).toBe('/x/saves');
  });
});
