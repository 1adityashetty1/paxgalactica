#!/usr/bin/env node
/**
 * One-time subscription sign-in.
 *
 * Two hard-won constraints shape this:
 *
 *  1. `claude auth login` stores its credential in the macOS keychain, and on
 *     some setups that write silently does nothing — no error, no keychain
 *     item, and every later model call reports "not logged in".
 *
 *  2. `claude setup-token` mints a usable token, but it is an interactive TUI:
 *     with piped stdio it renders nothing and hangs, and on a terminal it can
 *     wipe its own output when the alternate screen buffer is restored on
 *     exit — so the token flashes past and is gone.
 *
 * So the command is run under script(1), which gives it a real PTY (satisfying
 * 2) while transcribing everything to a file we can scan afterwards, even if
 * the screen was cleared. Failing that, we fall back to a plain run and ask you
 * to paste.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findClaudeBinary } from './find-binary.mjs';
import { promptFromTty } from './prompt-tty.mjs';
import { storeToken, looksLikeOAuthToken, normalizeToken, TOKEN_PATH } from './token-store.mjs';

/**
 * setup-token prints the token wrapped across terminal lines, e.g.
 *
 *     sk-ant-oat01--DEzHacv...nIeA
 *     xAAA
 *
 * so the pattern deliberately continues across a single newline. It stops at a
 * blank line, which is what separates the token from the prose that follows.
 * Matching only `[\w-]+` would capture the first line and silently store a
 * truncated, useless token.
 */
const TOKEN_PATTERN = /sk-ant-oat[\w-]+(?:[ \t]*\n[ \t]*[\w-]+)*/;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '\n');

const binary = findClaudeBinary();
if (!binary) {
  process.stderr.write('Bundled Claude Code binary not found. Run `pnpm install`.\n');
  process.exit(1);
}

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

process.stdout.write(
  [
    'Pax Galactica — subscription sign-in',
    '',
    'A browser will open. Approve access with your Claude Pro/Max account, and',
    'follow any prompt the command shows (it may ask you to paste a code back).',
    '',
    'The whole session is transcribed, so the token will be recovered even if',
    'the screen clears before you can read it.',
    '',
    '─'.repeat(66),
    '',
  ].join('\n'),
);

const dir = mkdtempSync(join(tmpdir(), 'paxgalactica-login-'));
const transcript = join(dir, 'session.log');

/** BSD (macOS) and util-linux `script` take their arguments differently. */
function scriptArgs() {
  if (process.platform === 'darwin') return ['-q', transcript, binary, 'setup-token'];
  return ['-q', '-c', `${binary} setup-token`, transcript];
}

let captured = '';
let ranUnderPty = false;

if (existsSync('/usr/bin/script') || existsSync('/bin/script')) {
  const result = spawnSync('script', scriptArgs(), { stdio: 'inherit', env });
  if (!result.error) {
    ranUnderPty = true;
    try {
      captured = stripAnsi(readFileSync(transcript, 'utf8'));
    } catch {
      captured = '';
    }
  }
}

if (!ranUnderPty) {
  // No usable script(1): run it plainly and rely on the paste fallback.
  spawnSync(binary, ['setup-token'], { stdio: 'inherit', env });
}

process.stdout.write(`\n${'─'.repeat(66)}\n`);

let token = normalizeToken(captured.match(TOKEN_PATTERN)?.[0] ?? '');

if (token) {
  process.stdout.write('\nToken recovered from the session transcript.\n');
} else {
  if (ranUnderPty && captured.trim().length > 0) {
    // Show the tail so a failure mode is visible rather than mysterious.
    const tail = captured.split('\n').filter((l) => l.trim()).slice(-12).join('\n');
    process.stdout.write(
      `\nNo token found in the session. The last few lines were:\n\n${tail}\n`,
    );
  }
  process.stdout.write('\nIf you can see a token above, paste it now.\n\n');
  token = normalizeToken(await promptFromTty('Token (starts with sk-ant-oat, or Enter to skip): '));
}

rmSync(dir, { recursive: true, force: true });

if (!token) {
  process.stderr.write(
    [
      '',
      'No token stored.',
      '',
      'Run the command directly and watch what it asks for:',
      '',
      `    ${binary} setup-token`,
      '',
      'Then store whatever token it prints:',
      '',
      '    pnpm save-token sk-ant-oat...',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (!looksLikeOAuthToken(token)) {
  process.stderr.write(
    `\nThat does not look like a Claude OAuth token (got ${token.length} chars).\nExpected a value beginning "sk-ant-oat".\n\n`,
  );
  process.exit(1);
}

storeToken(token);
process.stdout.write(`\n✓ Token stored at ${TOKEN_PATH} (readable only by you).\n`);
process.stdout.write('  Verify with `pnpm auth` — it makes a real call.\n');
