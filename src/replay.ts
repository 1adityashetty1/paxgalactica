import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_DIR, SaveFileSchema } from './engine/campaign.js';
import { replay, type Journal } from './engine/journal.js';
import { fleetStrengthOf, getFaction } from './domain/state.js';

/**
 * Rebuild a campaign from its ops journal with no model calls at all, and
 * print the resulting state. This is how a prompt change gets evaluated: run
 * the same journal before and after and compare the worlds it produces.
 */

const name = process.argv[2] ?? 'campaign';
const path = join(SAVE_DIR, `${name}.json`);

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  process.stderr.write(
    `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

const save = SaveFileSchema.parse(raw);
const journal = save.journal as Journal;

const started = Date.now();
const { state, rejectionCount } = replay(journal);
const ms = Date.now() - started;

const opsEntries = journal.entries.filter((e) => e.kind === 'ops').length;
const ticks = journal.entries.filter((e) => e.kind === 'tick').length;

const lines = [
  `Replayed ${name}: ${journal.entries.length} journal entries (${opsEntries} op batches, ${ticks} ticks) in ${ms}ms.`,
  `No model calls were made.`,
  ``,
  `Turn ${state.turn} · playing ${getFaction(state, state.playerFactionId)?.name ?? state.playerFactionId}`,
  `${state.pendingOrders.length} pending orders · ${state.eventLog.length} log entries · ${rejectionCount} ops rejected during replay`,
  ``,
  `Systems held:`,
  ...state.factions.map((f) => {
    const held = state.systems.filter((s) => s.controllerFactionId === f.id);
    return `  ${f.name.padEnd(26)} ${String(held.length).padStart(2)} systems · fleet ${fleetStrengthOf(state, f.id)} · ${f.credits}cr`;
  }),
  `  ${'unaligned'.padEnd(26)} ${String(state.systems.filter((s) => s.controllerFactionId === null).length).padStart(2)} systems`,
];

if (state.pendingOrders.length > 0) {
  lines.push('', 'Orders in progress:');
  for (const o of state.pendingOrders) {
    lines.push(
      `  ${o.label.padEnd(30)} ${o.progress}/${o.durationTurns} turns · ${getFaction(state, o.factionId)?.name ?? o.factionId}`,
    );
  }
}

process.stdout.write(`${lines.join('\n')}\n`);
