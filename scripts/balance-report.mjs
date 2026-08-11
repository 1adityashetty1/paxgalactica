import { runBalance } from '../dist/balance.js';
import { createSeedState } from '../dist/seed/scenario.js';

/**
 * Prints the balance harness as a table a human can actually read. Kept out of
 * `src/balance.ts` so the simulation itself stays importable by tests without
 * dragging formatting along.
 */

const turns = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);
const trace = process.argv.includes('--trace');

const NAMES = Object.fromEntries(
  createSeedState('freeworlds').factions.map((f) => [f.id, f.name]),
);
const ETHIC = Object.fromEntries(
  createSeedState('freeworlds').factions.map((f) => [f.id, f.tradeEthic]),
);
const IDS = ['meridian', 'vigil', 'hutt', 'freeworlds', 'krayt'];

const history = runBalance(turns, (s) => {
  if (!trace) return;
  const row = IDS.map((id) => `${id.slice(0, 4)} ${String(s.perFaction[id].net).padStart(4)}`).join(' · ');
  console.log(`  t${String(s.turn).padStart(2)}  ${row}   open ${(s.openness * 100).toFixed(0)}%`);
});

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

console.log('\n── net income over time ──');
console.log('  turn ' + IDS.map((i) => i.slice(0, 5).padStart(6)).join(''));
for (const t of [1, 5, 10, 15, 20, 25, 30, 40, 50].filter((t) => t <= turns)) {
  console.log(`  ${pad(t, 4)} ` + IDS.map((id) => pad(at(t).perFaction[id].net, 6)).join(''));
}

console.log('\n── territory over time (systems held) ──');
console.log('  turn ' + IDS.map((i) => i.slice(0, 5).padStart(6)).join(''));
for (const t of [1, 10, 20, 30, 40, 50].filter((t) => t <= turns)) {
  console.log(`  ${pad(t, 4)} ` + IDS.map((id) => pad(at(t).perFaction[id].systems, 6)).join(''));
}

console.log('\n── did each doctrine actually pay? ──');
const sum = (id, key) => history.reduce((n, h) => n + h.perFaction[id][key], 0);
console.log(`  Hutt tolls levied over the run   : ${sum('hutt', 'tolls')}`);
console.log(`  Krayt credits taken by raiding   : ${sum('krayt', 'raided')}`);
console.log(
  `  Krayt lane income vs territory   : ${last.perFaction.krayt.routes} vs ${last.perFaction.krayt.territory}`,
);
console.log(
  `  Meridian lane share of gross     : ${Math.round(
    (100 * last.perFaction.meridian.routes) /
      Math.max(1, last.perFaction.meridian.routes + last.perFaction.meridian.territory),
  )}%`,
);
const autarkists = ['vigil', 'freeworlds'].map(
  (id) =>
    `${id} ${Math.round(
      (100 * last.perFaction[id].routes) /
        Math.max(1, last.perFaction[id].routes + last.perFaction[id].territory),
    )}%`,
);
console.log(`  Autarkists' lane share of gross  : ${autarkists.join(' · ')}`);

const totalTerr = IDS.reduce((n, id) => n + last.perFaction[id].territory, 0);
const totalRoute = IDS.reduce((n, id) => n + last.perFaction[id].routes, 0);
console.log(
  `\n  galaxy income mix: territory ${totalTerr} (${Math.round(
    (100 * totalTerr) / (totalTerr + totalRoute),
  )}%) · lanes ${totalRoute} (${Math.round((100 * totalRoute) / (totalTerr + totalRoute))}%)`,
);
