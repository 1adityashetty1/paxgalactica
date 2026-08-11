#!/usr/bin/env node
/**
 * One command: build if needed, start the server, open the browser.
 *
 * macOS `open` is used deliberately — this is a localhost single-player game
 * and the project targets macOS. On other platforms the URL is printed instead.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Auth first: starting a server that fails every action is worse than not
// starting. The server checks too, but failing here is faster and clearer.
//
// `./start` sets PAXGALACTICA_AUTH_VERIFIED because it has already run this
// exact check. The check costs a real model call, so doing it twice on every
// launch would be spending the player's subscription to learn the same thing.
if (!process.env.PAXGALACTICA_AUTH_VERIFIED) {
  const auth = spawnSync('node', [join(ROOT, 'scripts', 'auth.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (auth.status !== 0) {
    process.stderr.write(auth.stdout ?? '');
    process.stderr.write(auth.stderr ?? '');
    process.stderr.write('\nNot authenticated. Run `pnpm login`, then try again.\n');
    process.exit(1);
  }
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
setTimeout(() => {
  if (process.platform === 'darwin') spawnSync('open', [URL]);
  else process.stdout.write(`\nOpen ${URL} in your browser.\n`);
}, 700);

const stop = (signal) => {
  server.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
