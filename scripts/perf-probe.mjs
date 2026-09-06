/**
 * Where a long campaign's time actually goes. No model calls.
 *
 *   pnpm perf [turns]
 *
 * Written because "turns are slow in long games, probably the log" is two
 * claims and only one survives measurement: the turn loop is FLAT — ending a
 * turn costs the same at turn 90 as at turn 3 — while the API payload grows
 * linearly with the event log, which is 61% of a real campaign's state. The
 * cost is transport and render, not the reducer. See the `p.X` section at the
 * top of docs/todo.md.
 */
import { Campaign } from '../dist/engine/campaign.js';
import { FileCampaignStore } from '../dist/engine/store.js';
import { worldAsSeenBy } from '../dist/domain/intel.js';
import { LOG_PUSH_TAIL } from '../dist/server/session.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ms = async (f) => { const t = process.hrtime.bigint(); await f(); return Number(process.hrtime.bigint() - t) / 1e6; };
const dir = mkdtempSync(join(tmpdir(), 'pg-perf-'));
const c = Campaign.start('meridian', 'perf', new FileCampaignStore(dir), 100);

// Roughly the op load a played turn carries: the 12-turn playtest wrote 434
// log entries, ~36 a turn.
const turnOps = (t) => Array.from({ length: 9 }, (_, i) => ({
  op: 'log_narrative',
  text: `turn ${t} entry ${i}: a dispatch of about the length these actually run to, naming a world and a power and what was done there`,
}));

console.log('turn  logEntries  stateKB  save(ms)  fullKB  pushKB  buildPayload(ms)');
for (let turn = 1; turn <= 90; turn++) {
  c.stage(turnOps(turn), 'model', 'meridian');
  c.commitTurn(); c.tick();
  const saveMs = await ms(() => c.save());
  const t0 = process.hrtime.bigint();
  const full = worldAsSeenBy(c.state, 'meridian');
  const payload = JSON.stringify(full);
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // What a PUSH now carries: the same world with only the log's tail.
  const tail = JSON.stringify({
    ...full,
    eventLog: full.eventLog.slice(Math.max(0, full.eventLog.length - LOG_PUSH_TAIL)),
  });
  if (turn % 15 === 0 || turn <= 2) {
    console.log(
      String(turn).padStart(4), String(c.state.eventLog.length).padStart(11),
      String(Math.round(JSON.stringify(c.state).length / 1024)).padStart(8),
      saveMs.toFixed(1).padStart(9), String(Math.round(payload.length / 1024)).padStart(7),
      String(Math.round(tail.length / 1024)).padStart(7),
      buildMs.toFixed(2).padStart(17));
  }
}
