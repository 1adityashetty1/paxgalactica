/**
 * What a stateless server would have to carry per request. No model calls.
 *   node scripts/stateless-probe.mjs [turns]
 * Bots play every power (nothing staged, so endTurn makes no model call), and
 * at checkpoints we measure: the save file (journal + transcripts) raw and
 * gzipped, the redacted view, and how long a cold replay of the journal takes —
 * which is what a stateless server pays to rebuild the world from a blob.
 */
import { Campaign } from '../dist/engine/campaign.js';
import { MemoryCampaignStore } from '../dist/engine/store.js';
import { endTurn } from '../dist/engine/turn.js';
import { replay } from '../dist/engine/journal.js';
import { worldAsSeenBy } from '../dist/domain/intel.js';
import { WorldStateSchema } from '../dist/domain/state.js';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const turns = Number(process.argv[2] ?? 60);
const c = Campaign.start('meridian', 'probe', new MemoryCampaignStore(), 100);
const kb = (n) => (n / 1024).toFixed(0).padStart(6);
const time = (f) => { const t = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

console.log('turn  entries  saveKB  gzKB  brKB  stateKB  stateGzKB  viewKB  viewGzKB  replay(ms)  parseState(ms)');
for (let t = 1; t <= turns; t++) {
  await endTurn(c, () => {});
  if (t % 10 === 0 || t === 1) {
    const save = JSON.stringify(c.toSaveFile());
    const state = JSON.stringify(c.state);
    const view = JSON.stringify(worldAsSeenBy(c.state, 'meridian'));
    const [, replayMs] = time(() => replay(c.journal));
    const [, parseMs] = time(() => WorldStateSchema.parse(JSON.parse(state)));
    console.log(String(t).padStart(4), String(c.journal.entries.length).padStart(8),
      kb(save.length), kb(gzipSync(save).length).padStart(5), kb(brotliCompressSync(save).length).padStart(5),
      kb(state.length).padStart(8), kb(gzipSync(state).length).padStart(10),
      kb(view.length).padStart(7), kb(gzipSync(view).length).padStart(9),
      replayMs.toFixed(0).padStart(11), parseMs.toFixed(1).padStart(15));
  }
}
