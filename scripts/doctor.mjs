#!/usr/bin/env node
/**
 * `pnpm doctor` — check everything the game needs, and say what to do about
 * whatever is missing.
 *
 * Deliberately separate from the server's own preflight. Preflight decides
 * whether it is safe to START; this decides why a setup is broken, runs every
 * check rather than aborting on the first, and is safe to run at any time.
 *
 * Every failure prints the command that fixes it. A diagnostic that reports a
 * problem without a remedy has only moved the confusion somewhere else.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PAXGALACTICA_PORT ?? 4173);

const results = [];
const ok = (name, detail) => results.push({ level: 'ok', name, detail });
const warn = (name, detail, fix) => results.push({ level: 'warn', name, detail, fix });
const bad = (name, detail, fix) => results.push({ level: 'bad', name, detail, fix });

/* ---------------- runtime ---------------- */

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk =
  major >= 24 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
if (nodeOk) ok('node', `v${process.versions.node}`);
else
  bad(
    'node',
    `v${process.versions.node} is below the floor (^20.19, ^22.12 or >=24) that Vite sets`,
    'brew upgrade node   —   or: nvm install 22 && nvm use 22',
  );

try {
  const pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
  ok('pnpm', pnpm);
} catch {
  bad('pnpm', 'not on PATH', 'corepack enable pnpm');
}

/* ---------------- dependencies ---------------- */

let depsPresent = true;
if (existsSync(join(ROOT, 'node_modules'))) {
  const lock = join(ROOT, 'pnpm-lock.yaml');
  const modules = join(ROOT, 'node_modules', '.modules.yaml');
  // A few seconds of tolerance: any pnpm command can touch the lockfile, and
  // a diagnostic that cries wolf on a healthy checkout teaches people to
  // ignore it.
  const stale =
    existsSync(lock) &&
    existsSync(modules) &&
    statSync(lock).mtimeMs - statSync(modules).mtimeMs > 5000;
  if (stale) warn('dependencies', 'lockfile is newer than node_modules', 'pnpm install');
  else ok('dependencies', 'installed');
} else {
  depsPresent = false;
  bad('dependencies', 'node_modules is missing', 'pnpm install');
}

/* ---------------- the Claude Code binary ---------------- */
// Resolved in two steps, from the SDK's own location. Under pnpm's strict
// layout the platform package is a dependency of the SDK rather than of this
// project, so resolving from the project root fails — silently, and in a way
// that looks exactly like being unauthenticated.
let binaryPresent = false;
try {
  const { findClaudeBinary } = await import('./find-binary.mjs');
  const binary = findClaudeBinary();
  if (binary && existsSync(binary)) {
    binaryPresent = true;
    ok('claude binary', binary.replace(homedir(), '~'));
  } else {
    bad('claude binary', 'not found inside the Agent SDK', 'pnpm install');
  }
} catch (err) {
  bad(
    'claude binary',
    err instanceof Error ? err.message : String(err),
    'pnpm install — the binary ships inside @anthropic-ai/claude-agent-sdk',
  );
}

/* ---------------- authentication ---------------- */

const tokenPath = join(homedir(), '.paxgalactica', 'oauth-token');
if (existsSync(tokenPath)) {
  const mode = statSync(tokenPath).mode & 0o777;
  if (mode !== 0o600) {
    warn(
      'token file',
      `${tokenPath.replace(homedir(), '~')} is mode ${mode.toString(8)}, not 600`,
      `chmod 600 ${tokenPath}`,
    );
  } else {
    ok('token file', '~/.paxgalactica/oauth-token (mode 600, outside the repo)');
  }
} else {
  bad('token file', 'no subscription token stored', 'pnpm login');
}

// An API key in the environment is only a note: buildAuthEnv() strips it from
// the child process, so it cannot shadow the subscription or bill an API
// account. This used to be a fatal error, which made every fresh terminal a
// puzzle for no safety benefit.
for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
  if (process.env[key]) {
    warn(
      key,
      'set in this shell — it is stripped before the game calls the model, so it will not be used or billed',
      'no action needed',
    );
  }
}

// Only meaningful once the binary it would call actually exists. Running it
// anyway on a fresh clone reported an auth failure and told the user to run
// `pnpm login`, which is the wrong remedy and sends them down the one rabbit
// hole this project has already cost people an afternoon in.
if (!depsPresent || !binaryPresent) {
  warn(
    'subscription auth',
    'not checked yet — the Claude binary ships with the dependencies',
    'pnpm install, then run pnpm doctor again',
  );
} else {
  const auth = spawnSync('node', [join(ROOT, 'scripts', 'auth.mjs')], { encoding: 'utf8' });
  if (auth.status === 0) ok('subscription auth', 'a live model call succeeded');
  else {
    const why = `${auth.stdout ?? ''}${auth.stderr ?? ''}`
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    bad('subscription auth', why || 'the check failed', 'pnpm login');
  }
}

/* ---------------- port ---------------- */

const portFree = await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(PORT, '127.0.0.1');
});
if (portFree) ok('port', `${PORT} is free`);
else
  warn(
    'port',
    `${PORT} is already in use — another copy of the game may be running`,
    `PAXGALACTICA_PORT=4174 pnpm play:web   —   or stop the other process`,
  );

/* ---------------- report ---------------- */

const MARK = { ok: '✓', warn: '!', bad: '✗' };
process.stdout.write('\nPax Galactica — setup check\n\n');
for (const r of results) {
  process.stdout.write(`  ${MARK[r.level]} ${r.name.padEnd(18)} ${r.detail}\n`);
  if (r.fix && r.level !== 'ok') process.stdout.write(`      fix: ${r.fix}\n`);
}

const broken = results.filter((r) => r.level === 'bad');
const notes = results.filter((r) => r.level === 'warn');

process.stdout.write('\n');
if (broken.length === 0) {
  process.stdout.write(
    notes.length === 0
      ? 'Ready. Run ./start (or pnpm play:web).\n\n'
      : `Ready, with ${notes.length} note${notes.length === 1 ? '' : 's'} above. Run ./start.\n\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `${broken.length} problem${broken.length === 1 ? '' : 's'} to fix before the game will run.\n\n`,
);
process.exit(1);
