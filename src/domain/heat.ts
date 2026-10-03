/**
 * Heat: what a power's dirty work makes it notorious for, and the Rim answering.
 *
 * Borrowed from *Blades in the Dark* and *Scum and Villainy*, where a crew's
 * jobs build heat and heat rolls up into the entanglements the GM rolls after
 * each one. Here every way a power acts outside the law — covert work, raiding
 * without a commission, breaking its word — already had a price, and every one
 * of those prices was flat and immediate: a reputation hit with onlookers, paid
 * once and forgotten by nothing but the ratchet. Heat is the same acts read as
 * a pressure that **builds and breaks**: it accumulates, decays slowly, and past
 * `HEAT_NOTORIOUS` the Rim's pulse starts drawing the four notoriety events
 * (`RIM_NOTORIETY`) for that power, weighted by how hot it runs. Each one that
 * lands sheds `HEAT_ANSWERED` — the Rim has answered.
 *
 * Public, because notoriety is what the Rim knows about you: a power's heat is
 * on the Factions panel for everyone, and in every prompt that describes it.
 *
 * A leaf: `state.ts` builds the faction schema's bound from it, so it imports
 * nothing from the domain.
 */

/** The scale, 0–100, the same as dissent's. */
export const HEAT_MAX = 100;

/** Lost every turn, whatever else happens. Slower than dissent: notoriety lingers. */
export const HEAT_DECAY = 1;

/** Heat at which the notoriety events become eligible for a power. */
export const HEAT_NOTORIOUS = 30;

/**
 * What sending an operative on a mission adds, by mission. The quiet ones
 * barely register; a knife in the dark is talked about for years.
 */
export const HEAT_FOR_MISSION: Record<string, number> = {
  surveillance: 1,
  theft: 2,
  subversion: 2,
  sabotage: 3,
  defection: 3,
  discord: 4,
  assassination: 8,
};

/** An operative taken — by exposure on the tick, or by a crackdown. */
export const HEAT_CAUGHT = 6;

/**
 * A turn of prizes taken from a power with no commission naming it. Per victim
 * robbed, so a raid across a busy junction runs hotter than one on a quiet lane.
 * A raid under a letter of marque, against a power the letter names, adds none:
 * that is the whole difference a commission makes.
 */
export const HEAT_PER_RAID = 2;

/** Breaking your word in public: a pact, a truce, a favour owed, a loan kept. */
export const HEAT_PACT_BROKEN = 8;

/** Letting a power know what you hold on it. Covert, and it should run hot. */
export const HEAT_BLACKMAIL = 4;

/**
 * Each notoriety kind's weight at `HEAT_NOTORIOUS`, scaling with the hottest
 * candidate's heat — so at the threshold a notoriety event is as likely as any
 * one of the ten fortunes, and at twice it, twice as likely.
 */
export const NOTORIETY_WEIGHT = 0.05;

/** What a notoriety event takes off its subject's heat when it lands. */
export const HEAT_ANSWERED = 15;

/** Raise (or with a negative, lower) a power's heat, inside the scale. */
export function addHeat(faction: { heat?: number } | undefined, amount: number): void {
  if (!faction || amount === 0) return;
  faction.heat = Math.max(0, Math.min(HEAT_MAX, (faction.heat ?? 0) + amount));
}
