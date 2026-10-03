#!/usr/bin/env node
/**
 * One command: build if needed, start the server, open the browser.
 *
 * The browser is opened with `open`, `xdg-open` or `start` by platform — see
 * open-browser.mjs — and the URL is printed if none of them works.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './open-browser.mjs';
import { chosenProvider, PROVIDER_NAMES } from './settings-store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PAXGALACTICA_PORT ?? '4173';
const URL = `http://127.0.0.1:${PORT}`;

const run = (cmd, args, label) => {
  process.stdout.write(`${label}…\n`);
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.stderr.write(`\n${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
};

const npx = (args, label) => run('npx', args, label);

// Auth first, when the subscription is what pays: a live check here is faster
// and clearer than a refused campaign in the browser.
//
// `./start` sets PAXGALACTICA_AUTH_VERIFIED because it has already run this
// exact check. The check costs a real model call, so doing it twice on every
// launch would be spending the player's subscription to learn the same thing.
//
// A keyed provider is not checked here: its key is entered, checked and stored
// in the browser, and the server opens on that screen when it is missing. Nor
// does a failed subscription check stop the launch any more — the settings
// screen is where a player with no subscription chooses to pay with a key.
const provider = chosenProvider();
if (provider.id === 'subscription' && !process.env.PAXGALACTICA_AUTH_VERIFIED) {
  const auth = spawnSync('node', [join(ROOT, 'scripts', 'auth.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (auth.status !== 0) {
    process.stderr.write(auth.stdout ?? '');
    process.stderr.write(auth.stderr ?? '');
    process.stderr.write(
      '\nThe subscription is not signed in. Run `pnpm login` — or choose an API key on the\nsettings screen the browser opens on.\n\n',
    );
  }
} else if (provider.id !== 'subscription') {
  process.stdout.write(`Model calls: ${PROVIDER_NAMES[provider.id]} (checked in the browser).\n`);
}

npx(['tsc'], 'Compiling server');
npx(['vite', 'build'], 'Building browser client');

if (!existsSync(join(ROOT, 'dist', 'web', 'index.html'))) {
  process.stderr.write('\nClient build produced no index.html. Aborting.\n');
  process.exit(1);
}

const server = spawn('node', [join(ROOT, 'dist', 'server', 'index.js')], {
  cwd: ROOT,
  stdio: 'inherit',
});

// Give the listener a moment before pointing a browser at it.
setTimeout(() => openBrowser(URL), 700);

const stop = (signal) => {
  server.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
