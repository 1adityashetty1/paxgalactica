#!/usr/bin/env node
/**
 * `npx paxgalactica` — the installed-package entry point (docs/architecture.md
 * A.4 option 4, A.10 step 4).
 *
 * A clone has `./start` and `pnpm play:web`, which build before they run. An
 * installed package is already built — `dist/` and `dist/web` ship in it, and
 * `prompts/` beside them — so this only starts the server and opens a browser.
 * The first page is the settings screen whenever no provider is usable, which
 * is how a player with no subscription and no terminal habits pastes a key.
 *
 *   paxgalactica                    start the game and open the browser
 *   paxgalactica --no-open          start it and print the URL
 *   paxgalactica --port 4174        another port, if 4173 is taken
 *   paxgalactica resume <file>      install an exported .tar.gz and play it
 *
 * Saves live in ~/.paxgalactica/saves for an installed copy (A.7); an exported
 * archive is how a campaign moves between a clone and an installed copy.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from '../scripts/open-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'server', 'index.js');
const RESUME = join(ROOT, 'dist', 'resume.js');

const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major >= 24 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19))) {
  process.stderr.write(`Pax Galactica needs Node ^20.19, ^22.12 or >=24; this is ${process.versions.node}.\n`);
  process.exit(1);
}

if (!existsSync(SERVER) || !existsSync(join(ROOT, 'dist', 'web', 'index.html'))) {
  process.stderr.write(
    'This copy has not been built. From a clone, run `pnpm play:web` instead; a packed copy is built by `pnpm pack`.\n',
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};

if (flag('--help') || flag('-h')) {
  process.stdout.write(
    [
      'paxgalactica                  start the game and open the browser',
      'paxgalactica --no-open        start it and print the URL',
      'paxgalactica --port <n>       listen on another port (default 4173)',
      'paxgalactica resume <file>    install an exported .tar.gz and play it',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const port = option('--port') ?? process.env.PAXGALACTICA_PORT ?? '4173';
const noOpen = flag('--no-open');
const url = `http://127.0.0.1:${port}`;
const env = { ...process.env, PAXGALACTICA_PORT: port };

const [command, ...rest] = argv;
const child =
  command === 'resume'
    ? spawn(process.execPath, [RESUME, ...rest], { env, stdio: ['inherit', 'pipe', 'inherit'] })
    : command === undefined
      ? spawn(process.execPath, [SERVER], { env, stdio: ['inherit', 'pipe', 'inherit'] })
      : null;

if (!child) {
  process.stderr.write(`Unknown command "${command}". Try --help.\n`);
  process.exit(1);
}

// Open the browser when the server says it is listening, not on a guess at how
// long that takes — and not at all if it never does (a port in use, say).
let opened = false;
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!opened && /server on http:/.test(String(chunk))) {
    opened = true;
    if (noOpen) process.stdout.write(`Open ${url} in your browser.\n`);
    else openBrowser(url);
  }
});

const stop = (signal) => child.kill(signal);
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
