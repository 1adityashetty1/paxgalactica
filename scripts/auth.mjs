#!/usr/bin/env node
/**
 * Report whether the game can actually authenticate.
 *
 * Checks the stored subscription token against the binary in the same
 * environment the game will use — API-key variables stripped, token injected —
 * rather than reporting whatever ambient auth happens to be visible. Reporting
 * "ready" on the strength of an API key is how this went in circles before.
 */
import { spawnSync } from 'node:child_process';
import { findClaudeBinary } from './find-binary.mjs';
import { chosenProvider, keyHint, KEY_ENV, PROVIDER_NAMES, resolveKey } from './settings-store.mjs';
import { readStoredToken, TOKEN_PATH } from './token-store.mjs';

/*
 * A keyed provider (Anthropic API, OpenRouter) is checked against the
 * provider's own free endpoint — the models list, or OpenRouter's key info —
 * rather than with a model call: nothing is spent learning whether a key works.
 */
const provider = chosenProvider();
if (provider.id !== 'subscription') {
  const resolved = resolveKey(provider.id);
  process.stdout.write(`  provider   : ${PROVIDER_NAMES[provider.id]} (${provider.source})\n`);
  if (!resolved) {
    process.stdout.write(
      `✗ No key. Paste one on the settings screen in the browser, or export ${KEY_ENV[provider.id]}.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`  key        : ${keyHint(resolved.key)} (${resolved.source})\n\n`);
  const res = await fetch(
    provider.id === 'anthropic'
      ? 'https://api.anthropic.com/v1/models?limit=1'
      : 'https://openrouter.ai/api/v1/key',
    {
      headers:
        provider.id === 'anthropic'
          ? { 'x-api-key': resolved.key, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${resolved.key}` },
      signal: AbortSignal.timeout(15_000),
    },
  ).catch((err) => ({ ok: false, status: 0, why: err instanceof Error ? err.message : String(err) }));
  if (res.ok) {
    process.stdout.write(`✓ ${PROVIDER_NAMES[provider.id]} accepted — nothing was spent checking.\n`);
    process.exit(0);
  }
  process.stdout.write(
    res.status === 401 || res.status === 403
      ? '✗ The provider rejected the key. Paste a working one on the settings screen.\n'
      : `✗ Could not confirm the key (${res.status ? `HTTP ${res.status}` : res.why}).\n`,
  );
  process.exit(1);
}

const binary = findClaudeBinary();
if (!binary) {
  process.stderr.write('Bundled Claude Code binary not found. Run `pnpm install`.\n');
  process.exit(1);
}

const shadowing = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter((k) => process.env[k]);
const token = readStoredToken();

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;

const probe = spawnSync(binary, ['auth', 'status', '--json'], { encoding: 'utf8', env });
let status = null;
try {
  status = JSON.parse(probe.stdout);
} catch {
  process.stderr.write(probe.stdout || probe.stderr || 'Could not read auth status.\n');
  process.exit(1);
}

process.stdout.write(
  [
    `  token file : ${token ? `present (${TOKEN_PATH})` : 'none'}`,
    `  as the game sees it: loggedIn=${status.loggedIn}, method=${status.authMethod}`,
    '',
  ].join('\n'),
);

if (shadowing.length > 0) {
  process.stdout.write(
    `  note: ${shadowing.join(', ')} set in this shell — the game strips it, so it is harmless.\n\n`,
  );
}

if (status.loggedIn && status.authMethod !== 'api_key') {
  // `auth status` only checks that a token is PRESENT — a made-up value still
  // reports loggedIn=true, method=oauth_token. The only way to know the token
  // actually works is to spend a few tokens using it.
  process.stdout.write(`  method looks right (${status.authMethod}); making one real call…\n\n`);

  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  try {
    let ok = false;
    let failure = '';
    for await (const message of query({
      prompt: 'Reply with the single word: ready',
      options: {
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'You reply with exactly one word.',
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        settingSources: [],
        persistSession: false,
        env,
      },
    })) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error) ok = true;
      else failure = message.subtype === 'success' ? message.result : message.errors.join('; ');
    }

    if (ok) {
      process.stdout.write('✓ Subscription auth working — a live model call succeeded.\n');
      process.stdout.write('  Run `pnpm play:web`.\n');
      process.exit(0);
    }
    process.stdout.write(`✗ The token was rejected: ${failure || 'unknown error'}\n\n`);
    process.stdout.write('  Run `pnpm login` again to mint a fresh one.\n');
    process.exit(1);
  } catch (err) {
    process.stdout.write(`✗ Live call failed: ${err instanceof Error ? err.message : err}\n\n`);
    process.stdout.write('  Run `pnpm login` again to mint a fresh one.\n');
    process.exit(1);
  }
}

process.stdout.write(
  [
    token
      ? '✗ A token is stored but the binary does not accept it. It may have been revoked or truncated on paste.'
      : '✗ No subscription token stored.',
    '',
    '  Run `pnpm login` and paste the token it prints.',
    '',
  ].join('\n'),
);
process.exit(1);
