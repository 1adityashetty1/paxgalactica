#!/usr/bin/env node
/**
 * The mechanical half of a bug hunt: read a played campaign and list what
 * looks wrong without a model having to notice it. Every finding names the
 * turn and the evidence, so it can be validated (reproduced in a test) before
 * anything is fixed. What a model reads badly — a narrative contradicting the
 * board, a persona misstating a rule — is the playtester's to catch; this
 * catches the shapes that have recurred in every hunt so far.
 *
 *   node scripts/bughunt-scan.mjs <campaign> [--json] [--since <turn>]
 *
 * Reads `saves/<campaign>.json` (replayed, no model calls) and
 * `saves/<campaign>.trace.jsonl` if present. Needs `pnpm build` first: it
 * imports the engine from `dist/`, as `pnpm replay` does.
 *
 * Exit code 0 always; the findings are the output. `--json` prints them as an
 * array for a loop to consume.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const sinceAt = args.indexOf('--since');
const since = sinceAt >= 0 ? Number(args[sinceAt + 1]) : 0;
if (!name) {
  console.error('usage: node scripts/bughunt-scan.mjs <campaign> [--json] [--since <turn>]');
  process.exit(2);
}

const savePath = resolve(root, 'saves', `${name}.json`);
if (!existsSync(savePath)) {
  console.error(`No save at ${savePath}.`);
  process.exit(2);
}
const { replay } = await import(resolve(root, 'dist/engine/journal.js'));
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const replayed = replay(save.journal);
const state = replayed.state ?? replayed;
const me = state.playerFactionId;
const entries = save.journal.entries ?? save.journal;

/** @type {{ check: string; severity: 'serious' | 'minor' | 'cosmetic'; turn: number | null; evidence: string; hint: string }[]} */
const findings = [];
// One finding per template, not per line: the same "lays down N hull(s)" every
// bot turn is one bug. The shape is the text with numbers and names blanked.
const names = [];
const shapeOf = (text) => {
  let t = text.replace(/\d+/g, '#');
  for (const n of names) t = t.split(n).join('@');
  return t.slice(0, 60);
};
const add = (check, severity, turn, evidence, hint, fragment) => {
  if (turn !== null && turn < since) return;
  // Collapsed on what matched, where a check knows it: every "hull(s)" is one.
  const shape = `${check}|${shapeOf(fragment ?? evidence)}`;
  const same = findings.find((f) => f.shape === shape);
  if (same) {
    same.count += 1;
    return;
  }
  findings.push({ check, severity, turn, evidence: evidence.slice(0, 240), hint, shape, count: 1 });
};

names.push(...state.factions.map((f) => f.name), ...state.systems.map((x) => x.name));
const factionIds = state.factions.map((f) => f.id);
const systemIds = state.systems.map((s) => s.id);
const seen = state.eventLog.filter((e) => e.visibleTo == null || e.visibleTo.includes(me));

/* --- Text the player reads ------------------------------------------- */
const ID = new RegExp(`(?<![\\w"'\`/-])(${factionIds.join('|')})(?![\\w"'\`/-])`);
const SYS = new RegExp(`(?<![\\w"'\`/-])(${systemIds.map((s) => s.replace('-', '\\-')).join('|')})(?![\\w"'\`/-])`);
const PLURAL = /\b1 (ships|lifters|troops|hulls|crates|tonnes|battleships|escorts|turns|credits)\b|\b([2-9]|\d{2,}) (crate|tonne|ship|lifter|troop|hull|battleship|escort|set)\b(?![s'])|\(s\)/;
const POSSESSIVE = /\b\w+s's\b/;
const JUNK = /\bnull\b|\bundefined\b|\[object Object\]|\bNaN\b/;
const SELF = /\b(?:leaves|from) ([A-Z][\w ]+?) (?:for|to) \1\b/;
const SPLICE = /\. go\.|\.\s+[a-z]/;
const STALE = /Nothing in this batch was applied(?! .*corrected)/;
for (const e of seen) {
  const text = e.text ?? '';
  if (e.kind === 'rejection') continue; // listed on their own below
  if (ID.test(text)) add('raw-faction-id', 'minor', e.turn, text, 'name the power: nameFor / possessive in the template that wrote it', text.replace(ID, '@').slice(0, 30));
  if (SYS.test(text) && !/^\[/.test(text)) add('raw-system-id', 'cosmetic', e.turn, text, 'name the world: getSystem(...).name');
  if (PLURAL.test(text)) add('plural', 'cosmetic', e.turn, text, 'countOf / a plural in the template', text.match(PLURAL)[0]);
  if (POSSESSIVE.test(text)) add('possessive', 'cosmetic', e.turn, text, 'possessive() from src/domain/words.ts', text.match(POSSESSIVE)[0]);
  if (JUNK.test(text)) add('junk-text', 'minor', e.turn, text, 'a field read after it was reset, or a missing value interpolated');
  if (SELF.test(text)) add('self-reference', 'cosmetic', e.turn, text, 'a template that does not handle origin === destination');
  if (SPLICE.test(text) && e.kind !== 'narrative') add('spliced-sentence', 'cosmetic', e.turn, text, 'a template joining a stored sentence mid-sentence');
  if (STALE.test(text)) add('stale-all-or-nothing', 'minor', e.turn, text, 'a corrected batch still reporting its first attempt');
  const twice = text.match(/\bat ([A-Z][\w ]+?) (?:completed )?at \1\b/);
  if (twice) add('doubled-place', 'cosmetic', e.turn, text, 'a label that already names the world, given "at <world>" again', 'at @ at @');
}

/* --- Rejections, grouped: each is a model writing something the reducer refused */
const rejections = seen.filter((e) => e.kind === 'rejection');
const byCode = new Map();
for (const r of rejections) {
  const code = (r.text.match(/^\[(\w+)\]/) ?? [])[1] ?? 'unknown';
  if (!byCode.has(code)) byCode.set(code, []);
  byCode.get(code).push(r);
}
for (const [code, list] of byCode) {
  for (const r of list.slice(0, 3)) {
    add(`rejection:${code}`, 'minor', r.turn, r.text, 'a prompt offering an op the path refuses, or a guard refusing something legitimate');
  }
  if (ID.test(list[0].text)) add('raw-faction-id', 'minor', list[0].turn, list[0].text, 'namedPowers() in reject should catch this');
}

/* --- The journal: money, dissent and ops that contradict each other --- */
const triggered = new Set(
  state.factions.flatMap((f) => f.compulsions.filter((c) => c.trigger).map((c) => c.text)),
);
for (const e of entries) {
  if (e.kind !== 'ops' || !Array.isArray(e.ops)) continue;
  const turn = e.turn ?? null;
  const ops = e.ops;
  // A debt paid twice: a settlement and a payment, debtor to creditor, in one batch.
  for (const s of ops.filter((o) => o?.op === 'settle_debt')) {
    const debt = (state.debts ?? []).find((d) => d.id === s.debtId);
    if (debt && ops.some((o) => o?.op === 'pay' && o.factionId === debt.debtorFactionId && o.to === debt.creditorFactionId)) {
      add('double-payment', 'serious', turn, `${e.label}: settle_debt ${s.amount} and a pay to the same creditor`, 'closeChannel nets settle_debt against the record');
    }
  }
  // A drift compulsion charged on an act.
  for (const o of ops.filter((x) => x?.op === 'adjust_dissent' && e.path !== 'tick')) {
    if (o.reason && [...triggered].some((t) => t.startsWith(String(o.reason).slice(0, 40)))) {
      if (!/drift|neglect/.test(e.label ?? '')) add('drift-charged-on-act', 'serious', turn, `${e.label}: ${o.reason}`, 'enforcedByDrift');
    }
  }
  // A declaration scuttling, or spending a thing, beside a failed check.
  const check = ops.find((o) => o?.op === 'log_narrative' && /^\[check\]/.test(o.text ?? ''));
  const failed = check && /failure/.test(check.text);
  if (failed && e.path === 'declared') {
    for (const o of ops.filter((x) => ['scuttle_ships', 'consume_asset'].includes(x?.op))) {
      add('loss-on-failure', 'minor', turn, `${e.label}: ${o.op} on a failed check`, 'spendsAsSaid in refusals.ts');
    }
  }
}

/* --- What the trace says about the model calls ----------------------- */
const tracePath = resolve(root, 'saves', `${name}.trace.jsonl`);
let spend = 0;
if (existsSync(tracePath)) {
  const lines = readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const calls = lines.filter((l) => l.type === 'call');
  spend = calls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
  const bad = calls.filter((c) => c.outcome !== 'ok' && (c.turn ?? 0) >= since);
  const byKind = new Map();
  for (const c of bad) byKind.set(`${c.kind}:${c.outcome}`, (byKind.get(`${c.kind}:${c.outcome}`) ?? 0) + 1);
  for (const [k, n] of byKind) add('model-call', n > 1 ? 'minor' : 'cosmetic', null, `${k} ×${n}`, 'the reply shape in the prompt, or a schema the model cannot satisfy');
  const turns = new Set(calls.map((c) => c.turn));
  if (calls.length > 0 && turns.size <= 1 && entries.filter((e) => e.kind === 'tick').length > 1) {
    add('trace-gap', 'minor', null, `trace covers turn(s) ${[...turns].join(', ')} of ${entries.filter((e) => e.kind === 'tick').length}`, 'the trace sink is pointed on every restore (session.ts traceTo)');
  }
} else {
  add('trace-missing', 'minor', null, `no ${name}.trace.jsonl`, 'the trace sink was never pointed at this campaign');
}

/* --- Report ----------------------------------------------------------- */
const order = { serious: 0, minor: 1, cosmetic: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.turn ?? 0) - (b.turn ?? 0));
if (asJson) {
  console.log(JSON.stringify({ campaign: name, turn: state.turn, spendUsd: Number(spend.toFixed(3)), findings: findings.map(({ shape: _s, ...f }) => f) }, null, 1));
} else {
  console.log(`${name}: turn ${state.turn}, ${findings.length} finding(s), model spend $${spend.toFixed(2)}`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.check}${f.turn !== null ? ` (turn ${f.turn})` : ''}${f.count > 1 ? ` ×${f.count}` : ''}: ${f.evidence}`);
    console.log(`      → ${f.hint}`);
  }
}
