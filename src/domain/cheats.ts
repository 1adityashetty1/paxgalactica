import { z } from 'zod';
import { ASSET_ARCHETYPES } from './assets.js';
import { CommanderArchetypeSchema } from './command.js';
import { HullClassSchema } from './hulls.js';

/**
 * The cheat menu: a fixed set of things a player may do to the world directly,
 * for testing edge cases without playing into them.
 *
 * **Fixed, not free-form.** Every cheat is one of five shapes and every number
 * in it is one of a few listed values, so there is no cheat that sets a treasury
 * to a million or a disposition to −100 in one go. The menu is a test harness,
 * and a harness that can put the world anywhere is one that stops meaning
 * anything the moment it is used.
 *
 * **It never passes through a model**, which is what keeps it out of normal
 * play. The server builds the op from a validated request; the reducer refuses
 * it from any source but `cheat`, and it is absent from every schema a model is
 * handed. What it does is journaled like anything else so a campaign replays
 * exactly, and what it LOGS is `kind: 'cheat'`, visible to the player alone and
 * left out of every prompt — so no persona, arbiter or resolution call is ever
 * told that the world was edited, only what the world now is.
 */

export const CHEAT_CREDITS = [100, 500, 2000] as const;
export const CHEAT_DISPOSITION = [-25, -10, 10, 25] as const;
export const CHEAT_SHIP_COUNTS = [1, 5, 10] as const;

/** A haul of a divisible kind arrives as this many units; anything else as one. */
export const CHEAT_ASSET_QUANTITY = 10;

/**
 * What a cheat-made asset is worth to each power other than its holder, per
 * unit — nominal, so it shows on a counterparty's shelf and can be bargained
 * over, which is most of what testing an asset needs.
 */
export const CHEAT_ASSET_VALUE = 20;

/**
 * Asset kinds the menu offers. Every archetype except the two that are PEOPLE
 * with a record behind them — an `officer` or `operative` asset points at a
 * commander or agent, and inventing one without the person would be a record
 * of nobody. Use the officer cheat for a commander.
 */
export const CHEAT_ASSET_KINDS: readonly string[] = ASSET_ARCHETYPES.map((a) => a.kind).filter(
  (k) => k !== 'officer' && k !== 'operative',
);

const literals = <T extends readonly number[]>(xs: T) =>
  z.union(xs.map((x) => z.literal(x)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>]);

export const CheatSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('credits'),
    factionId: z.string().min(1),
    amount: literals(CHEAT_CREDITS),
  }),
  z.object({
    kind: z.literal('disposition'),
    factionId: z.string().min(1),
    towardFactionId: z.string().min(1),
    delta: literals(CHEAT_DISPOSITION),
  }),
  z.object({
    kind: z.literal('asset'),
    /** One of `CHEAT_ASSET_KINDS`; a fixture kind stands on the world, anything else is a haul held there. */
    archetype: z.string().refine((k) => CHEAT_ASSET_KINDS.includes(k), 'not an asset kind the menu offers'),
    /** Held by whoever holds this world. */
    systemId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('ships'),
    factionId: z.string().min(1),
    systemId: z.string().min(1),
    hull: HullClassSchema,
    count: literals(CHEAT_SHIP_COUNTS),
  }),
  z.object({
    kind: z.literal('officer'),
    factionId: z.string().min(1),
    systemId: z.string().min(1),
    archetype: CommanderArchetypeSchema,
  }),
]);
export type Cheat = z.infer<typeof CheatSchema>;
