import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackCampaign } from './engine/archive.js';
import { FileCampaignStore, SAVE_DIR } from './engine/store.js';
import { getFaction } from './domain/state.js';
import { replay, type Journal } from './engine/journal.js';

/**
 * Resume a campaign from an exported archive.
 *
 *   pnpm resume ~/Downloads/campaign-2026-08-09-14-02.tar.gz
 *
 * Verifies the archive by replaying its journal in full, installs it into
 * `saves/`, and then starts the server with that campaign already loaded — so
 * the round trip a player actually wants (download in the browser, resume from
 * a terminal) is one command, not three steps and a JSON file to hand-place.
 *
 * `--as <name>` saves under a different name, `--no-serve` stops after
 * installing, and `--inspect` verifies and reports without writing anything.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  file: string | null;
  as: string | null;
  serve: boolean;
  inspect: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: null, as: null, serve: true, inspect: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--as') args.as = argv[++i] ?? null;
    else if (arg === '--no-serve') args.serve = false;
    else if (arg === '--inspect') {
      args.inspect = true;
      args.serve = false;
    } else if (arg.startsWith('-')) fail(`Unknown option "${arg}".`);
    else args.file ??= arg;
  }
  return args;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  process.stderr.write(
    [
      '',
      'Resume a Pax Galactica campaign from an exported archive.',
      '',
      '  pnpm resume <archive.tar.gz> [--as <name>] [--no-serve] [--inspect]',
      '',
      '  <archive.tar.gz>  a file downloaded with "Export" in the browser',
      '  --as <name>       install under this save name instead of the archived one',
      '  --no-serve        install the save but do not start the server',
      '  --inspect         verify and report only; write nothing',
      '',
      'To resume a save already in saves/, start the server and pick it on the',
      'title screen, or pass its name to "pnpm replay" to inspect it offline.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const path = resolve(args.file);

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(readFileSync(path));
} catch (err) {
  fail(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
}

let unpacked;
try {
  unpacked = unpackCampaign(bytes);
} catch (err) {
  fail(`\n${err instanceof Error ? err.message : String(err)}\n`);
}

const { manifest, save } = unpacked;
const name = args.as ?? manifest.name;
if (!/^[\w.-]+$/.test(name)) {
  fail(`"${name}" is not a usable save name. Use --as to supply one.`);
}

// Replay again for the report. `unpackCampaign` already proved it replays; this
// second pass is for the details a human wants to see before adopting a file.
const { state } = replay(save.journal as Journal);
const player = getFaction(state, state.playerFactionId)?.name ?? state.playerFactionId;
const transcripts = Object.values(save.transcripts).reduce((n, list) => n + list.length, 0);

process.stdout.write(
  [
    '',
    `Verified ${path}`,
    `  campaign      ${manifest.name}`,
    `  exported      ${manifest.exportedAt}`,
    `  playing       ${player}`,
    `  turn          ${state.turn}`,
    `  journal       ${manifest.journalEntries} entries, replayed clean${
      unpacked.rejectionCount > 0 ? ` (${unpacked.rejectionCount} ops rejected, as recorded)` : ''
    }`,
    `  systems held  ${state.systems.filter((s) => s.controllerFactionId === state.playerFactionId).length}`,
    `  pending       ${state.pendingOrders.length} orders`,
    `  transcripts   ${transcripts} conversations`,
    '',
  ].join('\n'),
);

if (args.inspect) process.exit(0);

const store = new FileCampaignStore();
const existed = await store.exists(name);
await store.save(name, save);
process.stdout.write(
  `${existed ? 'Overwrote' : 'Installed'} ${join(SAVE_DIR, `${name}.json`)}\n`,
);

if (!args.serve) {
  process.stdout.write(`\nStart the game with "pnpm serve" and resume "${name}".\n\n`);
  process.exit(0);
}

// Hand off to the server, telling it which campaign to open. Spawned rather
// than imported so the server keeps its own preflight, signal handling and
// graceful save — this script is a launcher, not a second entry point.
process.stdout.write(`\nStarting the server with "${name}" loaded…\n`);
const child = spawn(process.execPath, [join(HERE, 'server', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, PAXGALACTICA_CAMPAIGN: name },
});
child.on('exit', (code) => process.exit(code ?? 0));
