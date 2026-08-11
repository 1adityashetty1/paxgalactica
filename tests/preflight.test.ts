import { describe, expect, it } from 'vitest';
import {
  apiKeyNotice,
  assertLoggedIn,
  PreflightError,
  readAuthStatus,
} from '../src/preflight.js';
import { buildAuthEnv, looksLikeOAuthToken } from '../src/model/auth.js';
import { ModelOpSchema, ModelTurnOutputSchema, OpSchema } from '../src/domain/ops.js';
import { z } from 'zod';

describe('API key handling', () => {
  it('says nothing when no key is set', () => {
    expect(apiKeyNotice({})).toBeNull();
    expect(apiKeyNotice({ ANTHROPIC_API_KEY: '' })).toBeNull();
    expect(apiKeyNotice({ ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });

  it('notes a key without refusing to start, since the game strips it', () => {
    const notice = apiKeyNotice({ ANTHROPIC_API_KEY: 'sk-ant-whatever' });
    expect(notice).toMatch(/ANTHROPIC_API_KEY/);
    expect(notice).toMatch(/strips it/);
  });

  it('also notes ANTHROPIC_AUTH_TOKEN', () => {
    expect(apiKeyNotice({ ANTHROPIC_AUTH_TOKEN: 'tok' })).toMatch(/ANTHROPIC_AUTH_TOKEN/);
  });

  it('strips both key variables from the environment handed to the binary', () => {
    const env = buildAuthEnv({
      ANTHROPIC_API_KEY: 'sk-ant-key',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      PATH: '/usr/bin',
    });
    // This is what makes a key exported from a shell profile harmless: it never
    // reaches the child, so it cannot shadow the subscription or bill an API
    // account, no matter how the user's shell is configured.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('OAuth token store', () => {
  it('accepts a well-formed subscription token', () => {
    expect(looksLikeOAuthToken('sk-ant-oat01-abcdefghij_KLMNOP-123')).toBe(true);
  });

  it('rejects an API key, which is a different kind of credential entirely', () => {
    expect(looksLikeOAuthToken('sk-ant-api03-abcdefghijklmnop')).toBe(false);
    expect(looksLikeOAuthToken('')).toBe(false);
    expect(looksLikeOAuthToken('   ')).toBe(false);
    expect(looksLikeOAuthToken('sk-ant-oat')).toBe(false);
  });
});

describe('login preflight', () => {
  it('passes when signed in', () => {
    expect(() => assertLoggedIn({ loggedIn: true, authMethod: 'claudeai' })).not.toThrow();
  });

  it('blocks at startup rather than failing on the first action', () => {
    expect(() => assertLoggedIn({ loggedIn: false, authMethod: 'none' })).toThrow(PreflightError);
    try {
      assertLoggedIn({ loggedIn: false });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/pnpm login/);
      // `setup-token` is the working path: it mints a subscription token we
      // store and inject. `auth login` alone is not enough, because its
      // keychain write can silently do nothing — the message must say so.
      expect(message).toMatch(/setup-token/);
      expect(message).toMatch(/keychain/i);
    }
  });

  it('rejects api_key auth even though the binary calls it signed in', () => {
    // The binary reports loggedIn:true / method:"api_key" whenever a key is
    // present. Accepting that would let the game run on API billing while
    // claiming to use the subscription.
    expect(() => assertLoggedIn({ loggedIn: true, authMethod: 'api_key' })).toThrow(PreflightError);
    expect(() => assertLoggedIn({ loggedIn: true, authMethod: 'claudeai' })).not.toThrow();
    expect(() => assertLoggedIn({ loggedIn: true, authMethod: 'oauth' })).not.toThrow();
  });

  it('does not block when the probe itself fails', () => {
    // A null status means we could not ask. Let the real model call report the
    // real error instead of inventing one.
    expect(() => assertLoggedIn(null)).not.toThrow();
  });

  it('treats a malformed probe response as unknown', () => {
    const fake = (() => ({ stdout: 'not json' })) as unknown as typeof import('node:child_process').spawnSync;
    expect(readAuthStatus(fake)).toBeNull();
  });

  it('reads a well-formed probe response', () => {
    const fake = (() => ({
      stdout: JSON.stringify({ loggedIn: true, authMethod: 'claudeai' }),
    })) as unknown as typeof import('node:child_process').spawnSync;
    expect(readAuthStatus(fake)).toEqual({ loggedIn: true, authMethod: 'claudeai' });
  });
});

describe('the model-facing op vocabulary', () => {
  it('excludes transfer_control so the model cannot even express it', () => {
    const modelOps = ModelOpSchema.options.map((o) => o.shape.op.value);
    expect(modelOps).not.toContain('transfer_control');
    expect(ModelOpSchema.safeParse({ op: 'transfer_control', systemId: 'a', toFactionId: 'b' }).success).toBe(false);
  });

  it('includes transfer_control in the reducer vocabulary', () => {
    expect(OpSchema.options.map((o) => o.shape.op.value)).toContain('transfer_control');
  });

  it('rejects a non-Fibonacci duration at the schema level', () => {
    const bad = ModelOpSchema.safeParse({
      op: 'issue_order', factionId: 'a', type: 'garrison_raising',
      originId: 'x', targetId: 'y', durationTurns: 4,
    });
    expect(bad.success).toBe(false);
  });

  it('converts to a JSON schema for structured output without throwing', () => {
    const json = z.toJSONSchema(ModelTurnOutputSchema, { target: 'draft-7', io: 'input' });
    expect(json).toHaveProperty('properties.narrative');
    expect(json).toHaveProperty('properties.ops');
    expect(JSON.stringify(json)).not.toContain('transfer_control');
  });
});
