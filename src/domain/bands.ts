import { BITTER, DOTING, FAVOURED, RESENTFUL } from './estates.js';
import { MUTINY_DISSENT } from './events.js';
import { HEAT_NOTORIOUS } from './heat.js';
import { INTEL_DELIVERS, INTEL_DIG, INTEL_OPERATIVES, INTEL_TYPED } from './intel-levels.js';
import { CONTENT_REGARD, JOIN_REGARD } from './regard.js';
import { DOCTRINE_CHANGE_DISSENT_CEILING, WAR_DISPOSITION_THRESHOLD } from './state.js';

/**
 * The meters whose value crosses a line where something starts or stops
 * happening, each stated once: regard between powers, dissent, heat, intel,
 * an estate's favour and a world's standing with a power.
 *
 * Every line is the constant the mechanic reads, imported rather than restated,
 * so a threshold moved in its own module moves here. The table only names the
 * stretches between lines and says what each one means, so the Factions panel,
 * the briefing and the prompts all say "hostile, 5 from war" of the same
 * number. Before it, the UI coloured regard at ±10 and ±40/−50 and the prompts
 * named it at ±20 and ±60, and neither said where war began.
 *
 * Read-only: nothing here changes what any mechanic does.
 */

export interface Band {
  /** The lowest value in the band, inclusive. The first band starts at the meter's floor. */
  from: number;
  name: string;
  /** What being in this band does, in a clause. */
  means: string;
}

export interface Meter {
  label: string;
  /** Ascending by `from`. */
  bands: readonly Band[];
  /**
   * Which way trouble lies: the line `watchLine` names. Regard falls toward
   * war; dissent and heat climb toward mutiny and notoriety; intel and favour
   * climb toward what they buy.
   */
  watch: 'up' | 'down';
  /** How close a line must be before `watchLine` names it; omitted, always. */
  near?: number;
}

/**
 * What one power thinks of another. War is either side at or below
 * `WAR_DISPOSITION_THRESHOLD` with nothing holding them apart; the bots form a
 * coalition against a power both regard at `COALITION_GRIEVANCE`; a bot attacks
 * nobody it regards above `BOT_AGGRESSION_CEILING` outside a war; and goods are
 * exchanged, and coalitions formed, from `EXCHANGE_STANDING`.
 *
 * The three bot lines live in `initiative.ts`, which imports half the domain,
 * so they are restated here and `tests/bands.test.ts` holds them equal.
 */
export const REGARD_BANDS: Meter = {
  label: 'regard',
  watch: 'down',
  near: 20,
  bands: [
    { from: -100, name: 'war', means: 'at war, unless a treaty or a truce holds the two apart' },
    { from: WAR_DISPOSITION_THRESHOLD + 1, name: 'hostile', means: 'ill-willed enough to join a coalition against the power it regards so' },
    { from: -39, name: 'cool', means: 'its doctrine may attack the power it regards so, even outside a war' },
    { from: 1, name: 'warm', means: 'its doctrine will not attack the power it regards so outside a war' },
    { from: 20, name: 'friendly', means: 'it trades goods with, and may bind a coalition beside, the power it regards so' },
  ],
};

export const DISSENT_BANDS: Meter = {
  label: 'dissent',
  watch: 'up',
  near: 15,
  bands: [
    { from: 0, name: 'steady', means: 'the institutions follow' },
    { from: MUTINY_DISSENT, name: 'mutinous', means: 'crews may walk' },
    { from: DOCTRINE_CHANGE_DISSENT_CEILING, name: 'ungovernable', means: 'doctrine can no longer be changed' },
  ],
};

export const HEAT_BANDS: Meter = {
  label: 'heat',
  watch: 'up',
  near: 15,
  bands: [
    { from: 0, name: 'quiet', means: 'the Rim lets it be' },
    { from: HEAT_NOTORIOUS, name: 'notorious', means: 'the Rim answers: crackdowns, bounties, turned contacts' },
  ],
};

/** How well one power knows another. The words are the Factions panel's tooltip. */
export const INTEL_BANDS: Meter = {
  label: 'intel',
  watch: 'up',
  bands: [
    { from: 0, name: 'rumour', means: 'their work shows only as rumour' },
    { from: INTEL_TYPED, name: 'typed', means: 'their rumours say what kind of work it is' },
    { from: INTEL_DELIVERS, name: 'delivers', means: 'and what it will deliver' },
    { from: INTEL_OPERATIVES, name: 'operatives', means: 'their operatives on your worlds show, and are caught more often' },
    { from: INTEL_DIG, name: 'dig', means: 'your watchers dig their secrets more easily, and you trace their dark raids' },
  ],
};

/** An estate's favour: −2 to +2 on its stat, and what its notables do on their worlds. */
export const FAVOUR_BANDS: Meter = {
  label: 'favour',
  watch: 'up',
  bands: [
    { from: -100, name: 'bitter', means: '−2 on its stat, and its notables let a restless world go' },
    { from: BITTER + 1, name: 'resentful', means: '−1 on its stat, and its notables withhold income' },
    { from: RESENTFUL + 1, name: 'indifferent', means: 'nothing either way' },
    { from: FAVOURED, name: 'favoured', means: '+1 on its stat, and its notables warm their worlds' },
    { from: DOTING, name: 'doting', means: '+2 on its stat' },
  ],
};

/** A world's standing with a power. */
export const STANDING_BANDS: Meter = {
  label: 'standing',
  watch: 'up',
  bands: [
    { from: -100, name: 'unwilling', means: 'held only by force' },
    { from: CONTENT_REGARD, name: 'content', means: 'stays with its holder unforced' },
    { from: JOIN_REGARD, name: 'eager', means: 'an independent world joins, if no rival is close' },
  ],
};

export interface Reading {
  value: number;
  band: Band;
  /** The band above, if any. */
  up?: Band;
  /** The band below, if any; it begins one below `band.from`. */
  down?: Band;
}

export function bandOf(meter: Meter, value: number): Reading {
  let i = 0;
  while (i + 1 < meter.bands.length && value >= meter.bands[i + 1]!.from) i += 1;
  return { value, band: meter.bands[i]!, up: meter.bands[i + 1], down: meter.bands[i - 1] };
}

/**
 * The line to watch, said: "5 from war at −60", "3 from mutinous at 25". In the
 * meter's `watch` direction, and only within `near` of it; `null` otherwise.
 */
export function watchLine(meter: Meter, value: number): string | null {
  const r = bandOf(meter, value);
  if (meter.watch === 'up') {
    if (!r.up) return null;
    const gap = r.up.from - value;
    if (meter.near !== undefined && gap > meter.near) return null;
    return `${gap} from ${r.up.name} at ${r.up.from}`;
  }
  if (!r.down) return null;
  const line = r.band.from - 1;
  const gap = value - line;
  if (meter.near !== undefined && gap > meter.near) return null;
  return `${gap} from ${r.down.name} at ${line}`;
}

/** "−55 (hostile; 5 from war at −60)" — a number with its band, for a prompt or a tooltip. */
export function describeReading(meter: Meter, value: number): string {
  const r = bandOf(meter, value);
  const line = watchLine(meter, value);
  return `${value} (${r.band.name}${line ? `; ${line}` : ''})`;
}
