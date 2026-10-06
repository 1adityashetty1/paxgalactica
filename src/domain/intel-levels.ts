/**
 * Intel levels: how well one power knows another, 0–100, built up by watching
 * and worn down by time and counter-intelligence. A leaf, because `state.ts`
 * reads a threshold (`agentsVisibleTo`) and `intel.ts` reads `state.ts`.
 *
 * See `accrueIntel` in `intel.ts` for what raises it and `docs/design-2026-10-04.md`
 * §2 for the design.
 */

/** Turns a sighting is remembered after the order was last seen in full. */
export const INTEL_MEMORY_TURNS = 8;

/** At this level a rival's rumours carry the order's type. */
export const INTEL_TYPED = 20;
/** …and what the work will deliver. */
export const INTEL_DELIVERS = 40;
/**
 * …its unexposed operatives on your own worlds show, and roll exposure one in
 * twenty worse.
 */
export const INTEL_OPERATIVES = 60;
/** …your watchers dig its secrets more easily, and you trace its dark raids. */
export const INTEL_DIG = 80;

export const INTEL_MAX = 100;

/**
 * A turn's gain, per source. A listener directly over a rival's world sees what
 * a watcher there sees — `watchedSystems` treats the two alike, at the same
 * price — so it earns what a watcher earns; one only within `EMISSION_RANGE`
 * hears loud work and earns half.
 */
export const INTEL_PER_WATCHER = 6;
export const INTEL_PER_LISTENER_OVER = 6;
export const INTEL_PER_LISTENER_IN_RANGE = 3;
export const INTEL_PER_TRADE_ACCORD = 2;
export const INTEL_PER_BATTLE = 5;
export const INTEL_PER_OPERATIVE_TAKEN = 10;
/**
 * What a level loses each turn, as a share of itself, rounded up — so what is
 * known fades in proportion to how much is known, and every source settles at
 * a level rather than adding up to the cap.
 *
 * A flat fade was first, at 2 a turn, and measured: with the bots running
 * watchers and listeners all the time, most pairs watched at all sat at 100
 * by turn 30 and every threshold fired everywhere — the ladder was a switch.
 * In proportion, a source holds where its gain meets the fade: one watcher or
 * one listener over their world settles near 50 (their work's type and what it
 * will deliver), a listener within range near 20, a trade accord near 10, and
 * it takes two instruments to reach 60 and 80.
 */
export const INTEL_FADE = 0.1;
/** Each counter-intelligence programme a power runs on its own ground takes this off every rival's level on it. */
export const INTEL_COUNTER_SWEEP = 4;

/** Watchers dig at `SECRET_DISCOVERY_ROLL` less this, at `INTEL_DIG`. */
export const INTEL_DIG_BONUS = 3;
/** A dark raid is traced at this much more, at `INTEL_DIG`. */
export const INTEL_TRACE_BONUS = 4;

/** What `viewer` knows of `subject`, 0 when it has never looked. */
export function intelOn(
  state: { factions: readonly { id: string; intel?: Record<string, number> }[] },
  viewer: string,
  subject: string,
): number {
  if (viewer === subject) return INTEL_MAX;
  return state.factions.find((f) => f.id === viewer)?.intel?.[subject] ?? 0;
}
