#!/usr/bin/env node
/**
 * The gate a bug-hunt round must pass before its fixes are pushed: the three
 * typechecks, the whole suite, and every bug-hunt save replaying with no more
 * rejections than it had before the round (a fix that makes an old journal
 * reject is a fix that changed history; pin it to a journal version instead),
 * and with every person in exactly one place at every step of it
 * (`personViolations` in `src/domain/people.ts`).
 *
 *   node scripts/bughunt-gate.mjs            # check, and print the baseline
 *   node scripts/bughunt-gate.mjs --record   # write the replay baseline
 *
 * The baseline lives at saves/.bughunt-baseline.json (saves/ is gitignored, so
 * it is this machine's, as the saves are). Exit 0 only when everything passes.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const record = process.argv.includes('--record');
const baselinePath = resolve(root, 'saves/.bughunt-baseline.json');
let failed = false;

const step = (label, cmd) => {
  const t = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf8' });
  const ok = r.status === 0;
  const tail = `${r.stdout}${r.stderr}`.trim().split('\n').slice(-12).join('\n');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  if (!ok) {
    console.log(tail.replace(/^/gm, '    '));
    failed = true;
  }
  return ok;
};

if (!record) {
  step('typecheck', 'pnpm -s typecheck');
  step('typecheck:web', 'pnpm -s typecheck:web');
  step('typecheck:tests', 'pnpm -s typecheck:tests');
  step('tests', 'pnpm -s test');
}
execSync('pnpm -s build', { cwd: root, stdio: 'ignore' });

const saves = existsSync(resolve(root, 'saves'))
  ? readdirSync(resolve(root, 'saves')).filter((f) => /^bughunt.*\.json$/.test(f) && !f.endsWith('-session.json')).map((f) => f.replace(/\.json$/, ''))
  : [];
const counts = {};
for (const name of saves) {
  const r = spawnSync('node', ['dist/replay.js', name], { cwd: root, encoding: 'utf8' });
  const m = `${r.stdout}${r.stderr}`.match(/(\d+) ops rejected during replay/);
  counts[name] = m ? Number(m[1]) : r.status === 0 ? 0 : -1;
}
if (record) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 1));
  console.log(`Recorded the replay baseline for ${saves.length} save(s).`);
  process.exit(0);
}
// Every person in exactly one place, at every step of every save.
const { replay } = await import(resolve(root, 'dist/engine/journal.js'));
const { personViolations } = await import(resolve(root, 'dist/domain/people.js'));
for (const name of saves) {
  const save = JSON.parse(readFileSync(resolve(root, 'saves', `${name}.json`), 'utf8'));
  const broken = new Set();
  try {
    replay(save.journal ?? save, (state) => {
      for (const v of personViolations(state)) broken.add(`turn ${state.turn}: ${v}`);
    });
  } catch {
    continue; // reported as a failed replay above
  }
  if (broken.size > 0) {
    console.log(`FAIL people ${name}: ${[...broken].slice(0, 3).join('; ')}${broken.size > 3 ? ` (+${broken.size - 3})` : ''}`);
    failed = true;
  }
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
for (const [name, n] of Object.entries(counts)) {
  const was = baseline[name];
  if (n < 0) {
    console.log(`FAIL replay ${name}: did not replay`);
    failed = true;
  } else if (was !== undefined && n > was) {
    console.log(`FAIL replay ${name}: ${n} rejections, ${was} before`);
    failed = true;
  }
}
console.log(`${failed ? 'GATE FAILED' : 'GATE PASSED'} — ${saves.length} save(s) replayed`);
process.exit(failed ? 1 : 0);
