import { z } from 'zod';

/**
 * D&D-style faction statistics.
 *
 * The player can attempt literally anything, so the game needs a general way
 * to price "how likely is this to work" that does not depend on the model
 * inventing a standard each time. Five stats cover the space of actions the
 * game can express, and every action resolves against exactly one of them.
 *
 * Scale is 1–20 with the classic modifier, so the numbers read the way a
 * player expects: 10 is unremarkable, 18 is a defining strength, 5 is a real
 * weakness.
 */
export const STAT_NAMES = ['might', 'guile', 'industry', 'influence', 'resolve'] as const;
export type StatName = (typeof STAT_NAMES)[number];
export const StatNameSchema = z.enum(STAT_NAMES);

export const STAT_MEANINGS: Record<StatName, string> = {
  might: 'fleets, guns, and the will to use them — battles, raids, invasions, blockades',
  guile: 'spies, saboteurs, bribes, smuggling, forged writs, assassination',
  industry: 'shipyards, factories, logistics — anything that must be BUILT or supplied',
  influence: 'diplomacy, treaties, propaganda, courting client worlds, buying loyalty',
  resolve: 'holding on — sieges endured, unrest suppressed, long programmes not abandoned',
};

export const FactionStatsSchema = z.object({
  might: z.number().int().min(1).max(20),
  guile: z.number().int().min(1).max(20),
  industry: z.number().int().min(1).max(20),
  influence: z.number().int().min(1).max(20),
  resolve: z.number().int().min(1).max(20),
});
export type FactionStats = z.infer<typeof FactionStatsSchema>;

/** Classic D&D ability modifier: 10–11 is +0, every 2 points is ±1. */
export function statModifier(value: number): number {
  return Math.floor((value - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/* ------------------------------------------------------------------ */
/* Deterministic dice                                                   */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a. Small, fast, and — the only property that matters here — completely
 * deterministic across runs and platforms.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  // Avalanche the result before anyone takes it modulo anything.
  //
  // FNV-1a alone leaves its low bits weakly mixed: the multiplier is odd, so
  // low bits are a near-deterministic function of the low bits of the input,
  // and `% 20` reads exactly those (20 = 4 x 5). A playtester found the
  // consequence — appending SPACES to an action, which never touches the low
  // five bits, reached only {1, 5, 9, 13, 17}, five of twenty faces. Any
  // odd-coded character searched all twenty, so this was never a bias in
  // ordinary play, but it made the die's uniformity depend on the shape of
  // the input rather than on the hash.
  //
  // This is the murmur3 finalizer. Cheap, deterministic, and it spreads the
  // high bits down so the low ones stop echoing the input.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A d20 derived from campaign state rather than from Math.random().
 *
 * Replay must reproduce a campaign exactly, so nothing may depend on a clock
 * or an RNG the journal does not capture. Seeding from (turn, salt) means the
 * same action on the same turn always rolls the same number — the dice are
 * real from the player's side and reproducible from the engine's.
 */
export function rollD20(turn: number, salt: string): number {
  return (hash(`${turn}:${salt}`) % 20) + 1;
}

export const CheckOutcomeSchema = z.enum([
  'critical_success',
  'success',
  'partial',
  'failure',
  'critical_failure',
]);
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;

export interface CheckResult {
  stat: StatName;
  roll: number;
  modifier: number;
  total: number;
  difficulty: number;
  outcome: CheckOutcome;
  margin: number;
}

/**
 * Resolve a roll against a difficulty.
 *
 * A natural 1 or 20 always dominates, as at the table — it keeps a weak
 * faction's long shots alive and a strong faction honest. Otherwise the margin
 * decides, with a band around the difficulty reserved for partial success:
 * most interesting outcomes in a strategy game are "yes, but" rather than a
 * flat no.
 */
export function resolveCheck(
  stat: StatName,
  statValue: number,
  roll: number,
  difficulty: number,
): CheckResult {
  const modifier = statModifier(statValue);
  const total = roll + modifier;
  const margin = total - difficulty;

  let outcome: CheckOutcome;
  if (roll === 20) outcome = 'critical_success';
  else if (roll === 1) outcome = 'critical_failure';
  else if (margin >= 5) outcome = 'critical_success';
  else if (margin >= 0) outcome = 'success';
  else if (margin >= -4) outcome = 'partial';
  else if (margin >= -9) outcome = 'failure';
  else outcome = 'critical_failure';

  return { stat, roll, modifier, total, difficulty, outcome, margin };
}

/** Difficulty guidance, so the model prices actions on a stable scale. */
export const DIFFICULTY_BANDS: { dc: number; label: string; example: string }[] = [
  { dc: 5, label: 'trivial', example: 'a courier run through your own space' },
  { dc: 10, label: 'straightforward', example: 'levying troops on a loyal world' },
  { dc: 13, label: 'demanding', example: 'turning a rival’s minor official' },
  { dc: 16, label: 'hard', example: 'storming a fortified system, or a treaty against real interests' },
  { dc: 19, label: 'formidable', example: 'toppling a government, or building beyond your means' },
  { dc: 22, label: 'near-impossible', example: 'what your faction was never built to do' },
];

export function describeCheck(result: CheckResult): string {
  return `${result.stat} check: d20 ${result.roll} ${formatModifier(result.modifier)} = ${result.total} vs DC ${result.difficulty} → ${result.outcome.replace('_', ' ')}`;
}
