#!/usr/bin/env node
/**
 * Which fleet composition actually wins, at equal credits?
 *
 *   pnpm fleetlab [attackBudget] [defenceBudget] [--steps N] [--fine]
 *
 * Prints the best attacking and defending mixes, and — the question this exists
 * to answer — whether a fleet carrying three or more classes beats everything
 * simpler, and by how much.
 */
import { tournament, mixedWins } from '../dist/fleetlab.js';

const args = process.argv.slice(2);
const nums = args.filter((a) => /^\d+$/.test(a));
// An attacker needs local superiority for the question to be well posed: at
// equal credits the defender holds ~100% of the time and no composition can be
// told from any other. Three to one is roughly what a power actually brings.
const budget = Number(nums[0] ?? 3600);
const defenceBudget = Number(nums[1] ?? 1200);
const steps = args.includes('--fine') ? 6 : Number(args[args.indexOf('--steps') + 1]) || 4;

const t0 = Date.now();
const res = tournament({ budget, defenceBudget, steps });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (n) => `${(n * 100).toFixed(0)}%`;
const shape = (why) =>
  Object.entries(why)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${pct(v / Object.values(why).reduce((a, b) => a + b, 0))}`)
    .join(', ');

console.log(`\nFleet composition tournament — attacker ${budget}cr vs defender ${defenceBudget}cr + garrison`);
console.log(`${res.battles.toLocaleString()} battles in ${secs}s · garrisons ${res.garrisons.join('/')} · holders ${res.ethics.join('/')}\n`);

for (const [side, list, verb] of [
  ['ATTACKERS (share of battles that took the world)', res.attackers, 'took'],
  ['DEFENDERS (share of battles that held it)', res.defenders, 'held'],
]) {
  console.log(`── ${side}`);
  for (const c of list.slice(0, 6)) {
    console.log(`  ${pct(c.rate).padStart(4)} ${verb}  ${String(c.classes)}cls  ${c.label.padEnd(52)} ${shape(c.why)}`);
  }
  console.log('  ...');
  for (const c of list.slice(-2)) {
    console.log(`  ${pct(c.rate).padStart(4)} ${verb}  ${String(c.classes)}cls  ${c.label.padEnd(52)} ${shape(c.why)}`);
  }
  console.log();
}

for (const [name, list] of [['attacker', res.attackers], ['defender', res.defenders]]) {
  const m = mixedWins(list, 3);
  console.log(`── does a 3+ class ${name} win out?`);
  console.log(`  best overall     ${pct(list[0].rate).padStart(4)}  ${list[0].classes} classes  ${list[0].label}`);
  console.log(`  best 3+ classes  ${pct(m.mixed?.rate ?? 0).padStart(4)}  ${m.mixed?.label ?? '(none)'}`);
  console.log(`  best 1-2 classes ${pct(m.simple?.rate ?? 0).padStart(4)}  ${m.simple?.label ?? '(none)'}`);
  console.log(`  ${m.mixedIsBest ? 'YES' : 'NO '} — mixed is${m.mixedIsBest ? '' : ' NOT'} the top fleet; margin over simpler ${(m.margin * 100).toFixed(1)} points\n`);
}
