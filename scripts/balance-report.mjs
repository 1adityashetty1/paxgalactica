import { runBalance } from '../dist/balance.js';
import { createSeedState } from '../dist/seed/scenario.js';

/**
 * Prints the balance harness as a table a human can actually read. Kept out of
 * `src/balance.ts` so the simulation itself stays importable by tests without
 * dragging formatting along.
 */

const turns = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);
const trace = process.argv.includes('--trace');
// The control for item 124: the same bots on a Rim that never moves on its own.
const calm = process.argv.includes('--no-events');
// The control for intel with memory: powers that never come to know one another.
const blind = process.argv.includes('--no-intel');

const NAMES = Object.fromEntries(
  createSeedState('freeworlds').factions.map((f) => [f.id, f.name]),
);
const ETHIC = Object.fromEntries(
  createSeedState('freeworlds').factions.map((f) => [f.id, f.tradeEthic]),
);
const IDS = ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk'];

const history = runBalance(turns, (s) => {
  if (!trace) return;
  const row = IDS.map((id) => `${id.slice(0, 4)} ${String(s.perFaction[id].net).padStart(4)}`).join(' · ');
  console.log(`  t${String(s.turn).padStart(2)}  ${row}   open ${(s.openness * 100).toFixed(0)}%`);
  for (const e of s.events) console.log(`       ↳ ${e.kind}: ${e.text}`);
}, { ...(calm ? { randomEvents: false } : {}), ...(blind ? { intel: false } : {}) });

const last = history[history.length - 1];
const at = (t) => history[Math.min(t, history.length) - 1];

const pad = (v, n) => String(v).padStart(n);

console.log(`\n═══ ${turns} turns, five doctrine bots, no model calls ═══\n`);

console.log('faction                    ethic          net  terr  lane  toll  raid  fleet  systems  credits');
for (const id of IDS) {
  const f = last.perFaction[id];
  console.log(
    `  ${NAMES[id].padEnd(26)} ${ETHIC[id].padEnd(13)} ${pad(f.net, 4)} ${pad(f.territory, 5)} ${pad(f.routes, 5)} ${pad(f.tolls, 5)} ${pad(f.raided, 5)} ${pad(f.fleet, 6)} ${pad(f.systems, 8)} ${pad(f.credits, 8)}`,
  );
}

const nets = IDS.map((id) => last.perFaction[id].net);
const lo = Math.min(...nets);
const hi = Math.max(...nets);
// A ratio is meaningless once someone is insolvent, so say so instead.
const spread = lo <= 0 ? `${hi} to ${lo} (someone is insolvent)` : `${(hi / lo).toFixed(2)}x`;
console.log(
  `\n  income spread ${spread}` +
    ` · poorest ${lo}/turn · richest ${hi}/turn` +
    ` · lanes open ${(last.openness * 100).toFixed(0)}% · unclaimed ${last.uncollected}`,
);

console.log('\n── standing: who resents whom by the end ──');
for (const id of IDS) {
  const row = IDS.filter((o) => o !== id)
    .map((o) => `${o.slice(0, 4)} ${String(last.disposition?.[id]?.[o] ?? '?').padStart(4)}`)
    .join(' · ');
  console.log(`  ${NAMES[id].padEnd(26)} ${row}`);
}

console.log('\n── intel: how well each power knows the others, at the end ──');
for (const id of IDS) {
  const row = IDS.filter((o) => o !== id)
    .map((o) => `${o.slice(0, 4)} ${String(last.intel?.[id]?.[o] ?? 0).padStart(3)}`)
    .join(' · ');
  const peak = Math.max(0, ...history.flatMap((h) => Object.values(h.intel?.[id] ?? {})));
  console.log(`  ${NAMES[id].padEnd(26)} ${row}   peak ${peak}`);
}
const sweepTurns = history.reduce((n, h) => n + (h.sweeps ?? 0), 0);
const caught = IDS.map((id) => `${id.slice(0, 4)} ${last.caught?.[id] ?? 0}`).join(' · ');
console.log(`  sweep-turns ${sweepTurns} · operatives taken, by owner: ${caught} · memory rows now ${last.sightings ?? 0}`);

// The run's last turn always closes a table, so a 100-turn run says where it
// ended rather than stopping at 50.
const samples = (at) => [...new Set([...at.filter((t) => t <= turns), turns])];

console.log('\n── net income over time ──');
console.log('  turn ' + IDS.map((i) => i.slice(0, 5).padStart(6)).join(''));
for (const t of samples([1, 5, 10, 15, 20, 25, 30, 40, 50])) {
  console.log(`  ${pad(t, 4)} ` + IDS.map((id) => pad(at(t).perFaction[id].net, 6)).join(''));
}

console.log('\n── territory over time (systems held) ──');
console.log('  turn ' + IDS.map((i) => i.slice(0, 5).padStart(6)).join(''));
for (const t of samples([1, 10, 20, 30, 40, 50])) {
  console.log(`  ${pad(t, 4)} ` + IDS.map((id) => pad(at(t).perFaction[id].systems, 6)).join(''));
}

console.log('\n── did each doctrine actually pay? ──');
const sum = (id, key) => history.reduce((n, h) => n + h.perFaction[id][key], 0);
console.log(`  Ojjul tolls levied over the run   : ${sum('ojjul', 'tolls')}`);
console.log(`  Drajk credits taken by raiding   : ${sum('drajk', 'raided')}`);
console.log(
  `  Drajk lane income vs territory   : ${last.perFaction.drajk.routes} vs ${last.perFaction.drajk.territory}`,
);
console.log(
  `  Meridian lane share of gross     : ${Math.round(
    (100 * last.perFaction.meridian.routes) /
      Math.max(1, last.perFaction.meridian.routes + last.perFaction.meridian.territory),
  )}%`,
);
// Arkane is the only autarkist now: the Iron Vigil took over `monopolist`,
// which had been implemented and owned by nobody while `autarkic` was held
// twice. Labelling the Vigil an autarkist here would report the wrong doctrine.
// The network only: an autarkist's internal market is in `routes` but is its
// own worlds trading with each other, reported on its own line below.
const laneShare = (id) => {
  const f = last.perFaction[id];
  const network = f.routes - f.internal;
  return Math.round((100 * network) / Math.max(1, network + f.territory));
};
console.log(`  Autarkist's lane share of gross   : freeworlds ${laneShare('freeworlds')}%`);
console.log(`  Autarkist's internal market      : freeworlds ${last.perFaction.freeworlds.internal}/turn`);
console.log(`  Monopolist's lane share of gross  : vigil ${laneShare('vigil')}%`);

const totalTerr = IDS.reduce((n, id) => n + last.perFaction[id].territory, 0);
const totalRoute = IDS.reduce((n, id) => n + last.perFaction[id].routes, 0);
console.log(
  `\n  galaxy income mix: territory ${totalTerr} (${Math.round(
    (100 * totalTerr) / (totalTerr + totalRoute),
  )}%) · lanes ${totalRoute} (${Math.round((100 * totalRoute) / (totalTerr + totalRoute))}%)`,
);

console.log(calm ? '\n── random events: off (--no-events) ──' : '\n── random events ──');
if (!calm) {
  const events = history.flatMap((h) => h.events);
  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const hazards = ['ion_storm', 'derelict', 'unrest', 'border_incident', 'shortage', 'mutiny'];
  const hurt = events.filter((e) => hazards.includes(e.kind)).length;
  console.log(
    `  ${events.length} in ${turns} turns (${Math.round((100 * events.length) / turns)}%) · ` +
      `${hurt} hazards, ${events.length - hurt} boons`,
  );
  console.log('  ' + Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(' · '));
  const touched = {};
  for (const e of events) for (const id of e.factionIds) touched[id] = (touched[id] ?? 0) + 1;
  console.log('  touched: ' + IDS.map((id) => `${id.slice(0, 4)} ${touched[id] ?? 0}`).join(' · '));
}
