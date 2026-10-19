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
 *   node scripts/pt.mjs talk <id> "<text>"
 *   node scripts/pt.mjs endtalk <id>
 *   node scripts/pt.mjs discard [index]
 *
 * Env: PT_BASE (default http://127.0.0.1:4173), PT_SESSION (default
 * ./saves/pt-session.json). Prints the route's result as JSON on stdout, and
 * progress lines on stderr. Exits non-zero on a non-2xx status.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.env.PT_BASE ?? 'http://127.0.0.1:4173';
const SESSION = process.env.PT_SESSION ?? 'saves/pt-session.json';
const [cmd, ...args] = process.argv.slice(2);

const routes = {
  new: () => ['/api/campaign/new', { factionId: args[0], ...(args[1] ? { maxTurns: Number(args[1]) } : {}), name: args[2] ?? 'playtest' }, true],
  state: () => ['/api/campaign', {}],
  act: () => ['/api/action', { text: args.join(' ') }],
  advisor: () => ['/api/advisor', args.length > 0 ? { question: args.join(' ') } : {}],
  end: () => ['/api/endturn', {}],
  talk: () => [`/api/talk/${args[0]}`, { text: args.slice(1).join(' ') }],
  endtalk: () => [`/api/endtalk/${args[0]}`, {}],
  discard: () => ['/api/staged/discard', args[0] !== undefined ? { index: Number(args[0]) } : {}],
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
console.log(JSON.stringify(result.body, null, 1));
if (result.status >= 300) process.exit(1);
