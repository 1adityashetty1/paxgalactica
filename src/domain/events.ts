import { z } from 'zod';

/**
 * Random events: the Rim moving on its own (item 124).
 *
 * The shapes and the constants, and the two readers the rest of the game needs
 * while an event is still in force. Deliberately a leaf — `state.ts` builds its
 * schema from this and `trade.ts` reads a storm through it, so it may import
 * nothing from the domain. Choosing an event is `pulse.ts`; doing it is the
 * reducer's, because doing it is changing the world.
 *
 * **A closed vocabulary**, for the reason `OrderEffect` is closed: a list has to
 * be edited when an event is added, and the edit is where the thinking happens.
 * Every kind reuses a mechanic that already has force, so none is flavour.
 */

/** The six that hurt. Weighted toward the powerful. */
export const RIM_HAZARDS = [
  'ion_storm',
  'derelict',
  'unrest',
  'border_incident',
  'shortage',
  'mutiny',
] as const;

/**
 * The four that help. Weighted toward the power on the back foot — the Rally
 * principle again (item 123), so luck is a brake on whoever is ahead rather
 * than a second engine for them.
 */
export const RIM_BOONS = ['rich_seam', 'volunteers', 'free_captains', 'envoys_of_peace'] as const;

export const RIM_EVENT_KINDS = [...RIM_HAZARDS, ...RIM_BOONS] as const;
export const RimEventKindSchema = z.enum(RIM_EVENT_KINDS);
export type RimEventKind = z.infer<typeof RimEventKindSchema>;

/**
 * How likely each kind is, against the turn rather than against each other.
 *
 * **They sum to 0.5**, so on average one turn in two carries an event — and
 * that total is read as the chance an event fires at all (`RIM_EVENT_RATE`),
 * while the individual weights only decide WHICH, renormalised over whatever is
 * eligible. So the rate is exactly one in two whenever anything is eligible,
 * however eligibility moves; a turn with nothing eligible passing quietly is
 * the only way the average dips. The split between hazards and boons is the
 * dial to sweep, not the total.
 */
export const RIM_EVENT_WEIGHT: Record<RimEventKind, number> = {
  ion_storm: 0.05,
  derelict: 0.05,
  unrest: 0.05,
  border_incident: 0.05,
  shortage: 0.05,
  mutiny: 0.05,
  rich_seam: 0.05,
  volunteers: 0.05,
  free_captains: 0.05,
  envoys_of_peace: 0.05,
};

/** The chance a turn carries an event at all: the weights' total. */
export const RIM_EVENT_RATE = Object.values(RIM_EVENT_WEIGHT).reduce((n, w) => n + w, 0);

/** Turns before the same kind can come round again. */
export const RIM_KIND_COOLDOWN = 4;
/** Turns before an event can single out a power it has already touched. */
export const RIM_POWER_COOLDOWN = 3;

/** An ion storm lasts 1–3 turns, off the die. */
export const STORM_MAX_TURNS = 3;
/** A shortage lasts this long. */
export const SHORTAGE_TURNS = 3;
/** And every buyer pays this much more per unit while it does. */
export const SHORTAGE_FACTOR = 1.5;
/**
 * The only goods a shortage can touch: the catalogue's **stuff** group.
 * People are not a commodity whose price rises with scarcity, paper is one
 * thing whatever its supply, and a fixture cannot be bought at all.
 */
export const SHORTAGE_KINDS = ['ore', 'salvage', 'contraband', 'relic'] as const;

/** Standing each side loses in a border incident. */
export const BORDER_INCIDENT_COST = 8;
/** Dissent at which a fleet can mutiny. Two ignored compulsions reach it in a few turns. */
export const MUTINY_DISSENT = 25;
/** How much of a fleet a mutiny takes, by tonnage, before the floor. */
export const MUTINY_FRACTION = 0.05;
export const MUTINY_MIN_TONS = 2;
/** A rich seam pays this many turns of the world's own income, once. */
export const RICH_SEAM_TURNS = 3;
/** The most a garrison rises when volunteers come forward. */
export const VOLUNTEERS_MAX = 4;
/** A war this long without a battle between the pair can see envoys. */
export const ENVOYS_QUIET_TURNS = 5;
/** Standing each side regains when they do. */
export const ENVOYS_GOODWILL = 10;

/**
 * One event, as it happened. Kept on `WorldState` for three readers: the storms
 * and shortages still in force, the cooldowns, and the briefing on a resumed
 * campaign.
 *
 * `text` is the plain line the reducer writes, complete on its own. The flavour
 * line a model writes over it is display only and never stored — the same
 * position as the epilogue's prose.
 */
export const RimEventSchema = z.object({
  /** `rim-<turn>`: at most one a turn, so the turn is the identity. */
  id: z.string(),
  turn: z.number().int().min(0),
  kind: RimEventKindSchema,
  /** Who it happened to, for the per-power cooldown. Empty for a storm or a market. */
  factionIds: z.array(z.string()).default([]),
  systemId: z.string().nullable().default(null),
  /** The goods a shortage is of. */
  assetKind: z.string().nullable().default(null),
  /** Last turn a storm or a shortage is in force; null for a one-off. */
  untilTurn: z.number().int().nullable().default(null),
  text: z.string(),
  /**
   * Who may know it happened, by the event log's own rule: `null` is everyone.
   * A power's own affairs — a mutiny, a windfall — reach that power and
   * whoever can see the world it happened on.
   */
  visibleTo: z.array(z.string()).nullable().default(null),
});
export type RimEvent = z.infer<typeof RimEventSchema>;

/** Minimal shape the readers need, so this module imports nothing. */
interface HasRimEvents {
  turn: number;
  rimEvents?: readonly RimEvent[];
}

function inForce(state: HasRimEvents, e: RimEvent): boolean {
  return e.untilTurn !== null && e.untilTurn >= state.turn;
}

/**
 * Whether an ion storm has closed this system's lanes. Read by `trade.ts` as a
 * blockade nobody declared, which is what makes "the smuggler still runs it"
 * true without a second rule: `runsBlockade` already lets a smuggler through.
 */
export function stormbound(state: HasRimEvents, systemId: string): boolean {
  return (state.rimEvents ?? []).some(
    (e) => e.kind === 'ion_storm' && e.systemId === systemId && inForce(state, e),
  );
}

/** Stands in for the blockader when the blockade is weather. Never a faction id. */
export const STORM_BLOCKER = '@storm';

/**
 * What scarcity does to a kind of goods right now: `SHORTAGE_FACTOR` while a
 * shortage of it is in force, 1 otherwise. Applied where worth is READ, never
 * written into the assets — a shortage ends, and dividing every row back out
 * would miss whatever was split, traded or minted in between.
 */
export function shortageFactor(state: HasRimEvents, kind: string): number {
  return (state.rimEvents ?? []).some(
    (e) => e.kind === 'shortage' && e.assetKind === kind && inForce(state, e),
  )
    ? SHORTAGE_FACTOR
    : 1;
}

/** Events a power may know about, by the log's rule. */
export function rimEventsVisibleTo<T extends HasRimEvents>(state: T, factionId: string): RimEvent[] {
  return (state.rimEvents ?? []).filter(
    (e) => e.visibleTo === null || e.visibleTo.includes(factionId),
  );
}

export function isBoon(kind: RimEventKind): boolean {
  return (RIM_BOONS as readonly string[]).includes(kind);
}

/** A short title for a card: what kind of thing happened. */
export const RIM_EVENT_TITLE: Record<RimEventKind, string> = {
  ion_storm: 'Ion storm',
  derelict: 'Derelict',
  unrest: 'Unrest',
  border_incident: 'Border incident',
  shortage: 'Shortage',
  mutiny: 'Mutiny',
  rich_seam: 'Rich seam',
  volunteers: 'Volunteers',
  free_captains: 'Free captains',
  envoys_of_peace: 'Envoys of peace',
};
