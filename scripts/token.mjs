#!/usr/bin/env node
/**
 * Store a subscription token directly:  pnpm save-token sk-ant-oat...
 *
 * The escape hatch for when `pnpm login` cannot capture the token itself. Run
 * `claude setup-token` by hand, then hand the result to this.
 */
import { storeToken, looksLikeOAuthToken, normalizeToken, TOKEN_PATH } from './token-store.mjs';
import { promptMultiline } from './prompt-tty.mjs';

// normalize, not trim: a token copied from the wrapped terminal output carries
// an embedded newline that would otherwise be stored verbatim.
let token = normalizeToken(process.argv.slice(2).join(' '));

if (!token) {
  token = normalizeToken(
    await promptMultiline(
      [
        'Paste the token — it may span two lines, paste all of it.',
        'Then press Enter on a blank line to finish.',
        '',
        '> ',
      ].join('\n'),
    ),
  );
}

if (!token) {
  process.stderr.write('\nNothing supplied. Usage: pnpm save-token sk-ant-oat...\n');
  process.exit(1);
}

if (!looksLikeOAuthToken(token)) {
  process.stderr.write(
    [
      '',
      `That does not look like a Claude OAuth token (got ${token.length} chars).`,
      'Expected a value beginning "sk-ant-oat".',
      '',
      'An API key (sk-ant-api...) will not work — this game needs subscription auth.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// A real setup-token value is ~108 characters. A well-formed but short one is
// almost always the first line of a wrapped paste, which stores cleanly and
// then fails with a 401 — the least obvious failure of the lot.
if (token.length < 90) {
  process.stderr.write(
    [
      '',
      `⚠ That token is only ${token.length} characters; a full one is around 108.`,
      '',
      '  This is what a truncated paste looks like — the token wraps across two',
      '  terminal lines and only the first was captured. Paste all of it, or pass',
      '  it as a single quoted argument.',
      '',
      '  Storing anyway; `pnpm auth` will tell you definitively.',
      '',
    ].join('\n'),
  );
}

storeToken(token);
process.stdout.write(`\n✓ Token stored at ${TOKEN_PATH} (${token.length} chars)\n`);
process.stdout.write('  Verify with `pnpm auth` — it makes a real call.\n');
