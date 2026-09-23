/**
 * Where a played campaign's time went, from its trace. No model calls.
 *
 *   pnpm trace <campaign>                  per call kind and per turn phase
 *   pnpm trace <campaign> <other>          two runs side by side
 *   pnpm trace <campaign> --perfetto       write <campaign>.trace.perfetto, a
 *                                          waterfall for ui.perfetto.dev (it
 *                                          reads the JSON by content; the
 *                                          extension is not `.json` because
 *                                          the save store lists every
 *                                          `saves/*.json` as a campaign)
 *
 * A campaign's trace is `saves/<name>.trace.jsonl`, written as it is played —
 * see `src/model/telemetry.ts`. A path to a `.trace.jsonl` file works too.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_DIR } from '../dist/engine/store.js';
import { formatComparison, formatReport, parseTrace, toPerfetto } from '../dist/model/trace-report.js';

const args = process.argv.slice(2);
const perfetto = args.includes('--perfetto');
const names = args.filter((a) => !a.startsWith('--'));

if (names.length === 0 || names.length > 2) {
  console.error('usage: pnpm trace <campaign> [other-campaign] [--perfetto]');
  process.exit(1);
}

const pathOf = (name) => (name.endsWith('.jsonl') ? name : join(SAVE_DIR, `${name}.trace.jsonl`));
const load = (name) => {
  const path = pathOf(name);
  if (!existsSync(path)) {
    console.error(`No trace at ${path}. A campaign writes one as it is played, from the build that added tracing on.`);
    process.exit(1);
  }
  return parseTrace(readFileSync(path, 'utf8'));
};

const first = load(names[0]);
if (names.length === 2) {
  console.log(formatComparison(first, load(names[1]), [names[0], names[1]]));
} else {
  console.log(formatReport(first, names[0]));
}

if (perfetto) {
  const out = pathOf(names[0]).replace(/\.jsonl$/, '') + '.perfetto';
  writeFileSync(out, JSON.stringify(toPerfetto(first)));
  console.log(`\nWrote ${out} — open it at https://ui.perfetto.dev`);
}
