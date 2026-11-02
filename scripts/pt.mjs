#!/usr/bin/env node
/**
 * A command-line client for the stateless server, for a playtester that is not
 * a browser. The server keeps no campaign: every request carries the session
 * snapshot and every answer streams the next one back (`src/server/stateless.ts`).
 * This keeps that snapshot in a file, the way the browser keeps it in IndexedDB.
 *
 *   node scripts/pt.mjs new <factionId> [maxTurns] [name]
 *   node scripts/pt.mjs state            # the whole CampaignView
 *   node scripts/pt.mjs act "<text>"     # declare an action
 *   node scripts/pt.mjs advisor [question] # ask your counsellor (costs an action)
 *   node scripts/pt.mjs end              # end the turn
 *   node scripts/pt.mjs talk <id> "<text>" [--strike kind,kind]
 *   node scripts/pt.mjs endtalk <id>
 *   node scripts/pt.mjs discard [index]
 *   node scripts/pt.mjs organise '<json>'  # rename, split, merge, assign or relieve a fleet's command
 *
 * Env: PT_BASE (default http://127.0.0.1:4173), PT_SESSION (default
 * ./saves/pt-session.json). Prints the route's result as JSON on stdout, and
 * progress lines on stderr. Exits non-zero on a non-2xx status.
 *
 * `--digest` anywhere in the arguments prints a compact reading instead: the
 * narrative, the check, every note and rejection, the ops, each reaction and
 * battle — what a playtester reads for bugs, in a dozen lines rather than a
 * CampaignView. `PT_DIGEST=1` does the same for every command.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.env.PT_BASE ?? 'http://127.0.0.1:4173';
const SESSION = process.env.PT_SESSION ?? 'saves/pt-session.json';
const argv = process.argv.slice(2);
const digest = argv.includes('--digest') || process.env.PT_DIGEST === '1';
const [cmd, ...args] = argv.filter((a) => a !== '--digest');

const routes = {
  new: () => ['/api/campaign/new', { factionId: args[0], ...(args[1] ? { maxTurns: Number(args[1]) } : {}), name: args[2] ?? 'playtest' }, true],
  state: () => ['/api/campaign', {}],
  act: () => ['/api/action', { text: args.join(' ') }],
  advisor: () => ['/api/advisor', args.length > 0 ? { question: args.join(' ') } : {}],
  end: () => ['/api/endturn', {}],
  // talk <id> "<text>" [--strike kind,kind]: withdraw your own terms with the message
  talk: () => {
    const at = args.indexOf('--strike');
    const strike = at >= 0 ? args[at + 1].split(',') : [];
    const words = at >= 0 ? args.slice(1, at) : args.slice(1);
    return [`/api/talk/${args[0]}`, { text: words.join(' '), strike }];
  },
  endtalk: () => [`/api/endtalk/${args[0]}`, {}],
  discard: () => ['/api/staged/discard', args[0] !== undefined ? { index: Number(args[0]) } : {}],
  organise: () => ['/api/fleet', JSON.parse(args.join(' '))],
};
if (!routes[cmd]) {
  console.error(`unknown command "${cmd}". One of: ${Object.keys(routes).join(', ')}`);
  process.exit(2);
}
const [path, body, fresh] = routes[cmd]();
const session = !fresh && existsSync(SESSION) ? JSON.parse(readFileSync(SESSION, 'utf8')) : null;

const res = await fetch(BASE + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ session, body }),
});
const text = await res.text();
let result = null;
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.type === 'result') result = msg;
  else if (msg.type === 'session') {
    if (msg.session) {
      mkdirSync(dirname(SESSION), { recursive: true });
      writeFileSync(SESSION, JSON.stringify(msg.session));
    }
  } else if (msg.type === 'progress') console.error(`… ${msg.label ?? msg.text ?? ''}`);
}
if (!result) {
  console.error(`no result (HTTP ${res.status}): ${text.slice(0, 500)}`);
  process.exit(1);
}
console.log(digest ? digestOf(result.body) : JSON.stringify(result.body, null, 1));
if (result.status >= 300) process.exit(1);

/** The few things a playtester reads for bugs, one per line. */
function digestOf(v) {
  if (!v || typeof v !== 'object') return String(v);
  const out = [];
  const line = (k, x) => {
    if (x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0)) return;
    out.push(`${k}: ${typeof x === 'string' ? x : JSON.stringify(x)}`);
  };
  line('ERROR', v.error ?? v.message);
  line('NARRATIVE', v.narrative);
  line('COUNSEL', v.counsel);
  line('REPLY', v.reply);
  if (v.check) line('CHECK', `${v.check.stat} d20 ${v.check.roll} ${v.check.modifier >= 0 ? '+' : ''}${v.check.modifier} = ${v.check.total} vs DC ${v.check.difficulty} → ${v.check.outcome}`);
  for (const k of ['refusal', 'defiance', 'negotiation', 'inadmissible', 'outOfActions']) line(k.toUpperCase(), v[k]);
  for (const n of v.notes ?? []) out.push(`NOTE: ${n}`);
  for (const r of v.rejections ?? []) out.push(`REJECTED [${r.code}]: ${r.message}`);
  for (const c of v.concessions ?? []) out.push(`CONCESSION ${c.by}:${c.kind}: ${c.text}${c.credits ? ` (${c.credits} cr)` : ''}${c.perTurn ? ` (${c.perTurn}/turn)` : ''}${c.assets?.length ? ` assets ${c.assets}` : ''}${c.ends?.length ? ` ends ${c.ends}` : ''}`);
  for (const b of v.blockers ?? []) out.push(`BLOCKER: ${JSON.stringify(b)}`);
  for (const o of v.ops ?? []) if (o.op !== 'log_narrative') out.push(`OP: ${JSON.stringify(o).slice(0, 300)}`);
  for (const r of v.reactions ?? []) {
    out.push(`REACTION ${r.factionName}: ${String(r.narrative).slice(0, 300)}`);
    for (const o of r.ops ?? []) out.push(`  OP: ${JSON.stringify(o).slice(0, 200)}`);
  }
  for (const b of v.briefing?.battles ?? []) out.push(`BATTLE ${b.systemName}: ${b.status}`);
  if (v.state && !v.narrative) {
    const me = v.state.playerFactionId;
    const f = v.state.factions.find((x) => x.id === me);
    out.push(`TURN ${v.state.turn} · ${f?.credits} cr · dissent ${f?.dissent} · actions ${v.actionPoints?.left ?? '?'}`);
    for (const u of v.briefing?.ultimatums ?? []) out.push(`ULTIMATUM: ${u.text}`);
    for (const w of v.briefing?.worlds ?? []) out.push(`WORLD: ${w.text}`);
  }
  if (v.costUsd !== undefined) out.push(`COST $${Number(v.costUsd).toFixed(3)}`);
  return out.join('\n') || JSON.stringify(v).slice(0, 500);
}
