import { z } from 'zod';
import { rollD20 } from './checks.js';

/**
 * Commanders: a named officer who takes one side of one battle.
 *
 * ## Archetypes, with generated names — and the split is the whole design
 *
 * The same division of labour as `ASSET_ARCHETYPES` and `classifyPrinciple`:
 * **the table decides what a kind of thing is like, and generation only ever
 * touches identity.** A commander's *effect* comes from a closed list of three;
 * their name, and nothing else, is procedural.
 *
 * Generated *effects* is the failure this codebase closes everywhere — a leader
 * whose bonus is invented is a leader whose bonus can be invented favourably,
 * which is `onComplete` before `boundPayloadsToOutcome` and `set_doctrine`
 * before the actor check. A closed vocabulary with generated identity gets the
 * variety at none of the cost, and it is why a hundred campaigns can produce a
 * hundred different Grand Admirals without producing a single new rule.
 *
 * ## Three officers, differently SHAPED — not one per phase
 *
 * The first draft of this said there was one archetype per phase of a battle,
 * which was a tidy story the code does not support: `attackMod` is read by the
 * orbital exchange **and** by the landing (`assault` is troops scaled by it),
 * so an officer who raises it helps both. Caught by a combat test that flipped,
 * and recorded here rather than patched around, because contorting the
 * arithmetic to protect a framing is how a mechanic ends up with a rule nobody
 * can explain.
 *
 * What actually distinguishes them is the SHAPE of the help:
 *
 * - `lineofbattle` is **small and unconditional** — one point of might, which
 *   every fight reads.
 * - `gunnery` is **large and conditional on a class** — it multiplies the
 *   opening salvo, so she is worth a great deal to a power that builds torpedo
 *   boats and exactly nothing to one that brought none.
 * - `convoy` is **large and conditional on losing** — it is worth nothing at
 *   all until the day you have to run, and a great deal on that day.
 *
 * That is a better set than one-per-phase would have been, because it means the
 * three are not substitutes: which one you want depends on the fleet you build
 * and the war you are losing or winning.
 *
 * **None of the three duplicates a war ethic**, which was the real constraint.
 * `crusading` already refuses to break off and `opportunist` already takes a
 * conditional might bonus, so a commander who did either would flatten a
 * doctrine rather than add to one — the same argument that prices suborning
 * against the `defection` agent. The withdrawal is the clearest case: the
 * retreat loss is a fixed band that **nothing in the game currently touches**,
 * so an officer who brings a beaten fleet home is doing something no doctrine,
 * stance or hull can do.
 */

export const COMMANDER_ARCHETYPES = [
  {
    kind: 'lineofbattle',
    phase: 'every exchange, and the landing',
    /** What it reads as in a battle report. */
    effect: 'fights a point harder, everywhere',
    /** Voice for a prompt: what this officer is known for. */
    known: 'holding formation under fire, and for being dull about it',
  },
  {
    kind: 'gunnery',
    phase: 'the torpedo strike',
    effect: 'opens with a heavier salvo',
    known: 'the opening salvo — she fires before the fleets close, and well',
  },
  {
    kind: 'convoy',
    phase: 'the withdrawal',
    effect: 'brings more of a beaten fleet home',
    known: 'getting a broken fleet out, which is a reputation nobody wants',
  },
] as const;

export type CommanderArchetype = (typeof COMMANDER_ARCHETYPES)[number]['kind'];
export const CommanderArchetypeSchema = z.enum(
  COMMANDER_ARCHETYPES.map((a) => a.kind) as [CommanderArchetype, ...CommanderArchetype[]],
);

export function archetypeOf(kind: CommanderArchetype) {
  return COMMANDER_ARCHETYPES.find((a) => a.kind === kind)!;
}

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a `lineofbattle` officer adds to her side's might modifier.
 *
 * One point, against a modifier that runs -1 to +5 across the five powers and
 * an `OPPORTUNIST_MIGHT_BONUS` of 2. Deliberately smaller than a doctrine: a
 * doctrine is what a power *is* and a commander is who happened to be aboard.
 */
export const COMMANDER_MIGHT = 1;

/**
 * Points off the withdrawal loss, which runs 10–35%.
 *
 * The largest of the three in absolute terms, and it is the one worth having
 * because **nothing else in the game reaches this number**. A screen changes
 * *which* hulls are spent getting clear and not how many; a stance changes
 * whether you run at all. This is the only thing that changes the price of
 * running.
 */
export const COMMANDER_WITHDRAW_RELIEF = 8;

/** How much heavier a `gunnery` officer's opening salvo lands. */
export const COMMANDER_STRIKE_BONUS = 0.4;

/**
 * A commander is lost when their side is broken and the die is against them.
 *
 * Only on a **defeat** — a routed fleet, or one driven off — because an officer
 * who wins does not die at a rate worth modelling, and because a death roll on
 * every battle would make the roster churn faster than a player could learn a
 * name. `roll <= 4` on the battle's own seeded d20, so it is reproducible and
 * needs no second source of randomness.
 */
export const COMMANDER_LOSS_ROLL = 4;

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export const CommanderSchema = z.object({
  id: z.string().min(1),
  factionId: z.string().min(1),
  /** Generated, never authored. See `commanderName`. */
  name: z.string().min(1).max(60),
  archetype: CommanderArchetypeSchema,
  appointedTurn: z.number().int().min(0),
  /**
   * Engagements fought. Seniority, and the tie-break for who takes the next
   * battle — so a power's best-known officer keeps turning up, which is what
   * makes losing one cost something a player can feel.
   */
  battles: z.number().int().min(0).default(0),
  status: z.enum(['active', 'lost']).default('active'),
});
export type Commander = z.infer<typeof CommanderSchema>;

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/**
 * Per-faction name stock.
 *
 * Five powers that should never be mistaken for one another is a rule this
 * project already applies to voice, ethics, red lines and build bias — a
 * generated name that could belong to any of them would be the one place that
 * rule lapsed. So the stock is per faction and the shape of the name differs
 * too: the Vigil takes a cognomen, the Combine a house, the Arkane a patronym
 * off the ground they hold.
 */
const NAME_STOCK: Record<string, { first: string[]; second: string[]; join: string }> = {
  meridian: {
    first: ['Adrienne', 'Caspar', 'Teodor', 'Lira', 'Odile', 'Marcus', 'Sabine', 'Yusuf'],
    second: ['Vance', 'Okonjo', 'Reyes', 'Haldane', 'Brandt', 'Sorel', 'Achebe', 'Marchetti'],
    join: ' ',
  },
  vigil: {
    first: ['Legate Caius', 'Legate Valeria', 'Legate Drusus', 'Legate Marcia',
            'Legate Aulus', 'Legate Livia', 'Legate Quintus', 'Legate Sabina'],
    second: ['Ferrata', 'the Elder', 'Corvinus', 'Nasica', 'the Steadfast',
             'Longinus', 'Severa', 'of the Ninth'],
    join: ' ',
  },
  ojjul: {
    first: ['Nar Vessine', 'Nar Ojjuk', 'Nar Tallim', 'Nar Serek',
            'Nar Halvane', 'Nar Osk', 'Nar Dovic', 'Nar Ruille'],
    second: ['the Patient', 'of Shalka', 'the Younger', 'Two-Ledgers',
             'of Riqel', 'the Quiet', 'Cousin-of-Cousins', 'the Debt-Holder'],
    join: ', ',
  },
  freeworlds: {
    first: ['Watch Oria', 'Watch Kell', 'Watch Devain', 'Watch Sarn',
            'Watch Mira', 'Watch Tolen', 'Watch Ysra', 'Watch Bran'],
    second: ['of Arkane Prime', 'Stonecount', 'of the Second Mark', 'Vesskeeper',
             'of Pell Reach', 'Throatholder', 'of Delvane', 'Nine-Generations'],
    join: ' ',
  },
  drajk: {
    first: ['Kess', 'Ravel', 'Tannic', 'Voss', 'Sherrin', 'Doram', 'Aleska', 'Prynn'],
    second: ['Longburn', 'the Hollow', 'Deeprunner', 'Coldwake',
             'Vergesse-Born', 'Halfshare', 'the Unlit', 'Threxwind'],
    join: ' ',
  },
};

const FALLBACK = NAME_STOCK['drajk']!;

/**
 * A name from a seed, deterministic and therefore replayable.
 *
 * Built on `rollD20`'s hash rather than a second generator, so a commander
 * appointed on turn 9 of a replayed campaign is the same person with the same
 * name as in the live one. Nothing here may reach for a clock or `Math.random`
 * — a roster that differs between a campaign and its replay would break
 * `verifyReplay` on a string comparison, which is exactly the class of bug key
 * ordering already caused once.
 */
export function commanderName(factionId: string, turn: number, salt: string): string {
  const stock = NAME_STOCK[factionId] ?? FALLBACK;
  const a = rollD20(turn, `commander-first:${factionId}:${salt}`) - 1;
  const b = rollD20(turn, `commander-second:${factionId}:${salt}`) - 1;
  return `${stock.first[a % stock.first.length]}${stock.join}${stock.second[b % stock.second.length]}`;
}

/** Which of the three an appointment turns out to be. Also seeded. */
export function commanderArchetype(factionId: string, turn: number, salt: string): CommanderArchetype {
  const n = rollD20(turn, `commander-kind:${factionId}:${salt}`) - 1;
  return COMMANDER_ARCHETYPES[n % COMMANDER_ARCHETYPES.length]!.kind;
}

/* ------------------------------------------------------------------ */
/* Who takes the battle                                                */
/* ------------------------------------------------------------------ */

/**
 * The officer who commands this power's contingent.
 *
 * **Doctrine picks, not the player**, and that is a decision rather than a
 * shortcut. A commander a player has to assign is a commander the four NPCs
 * never get, and the thing this was filed to fix is that a battle between two
 * rival powers looks like arithmetic. Letting the player *name* one is a real
 * decision and a good follow-on; it is not what makes the mechanic exist.
 *
 * Seniority by battles fought, then by id, so it is a pure function of state
 * and replays exactly. The effect is that a power's best-known officer keeps
 * turning up, which is what makes losing one cost something a player can feel.
 */
export function commanderFor(
  commanders: Commander[] | undefined,
  factionId: string,
): Commander | undefined {
  return (commanders ?? [])
    .filter((c) => c.factionId === factionId && c.status === 'active')
    .sort((a, b) => b.battles - a.battles || a.id.localeCompare(b.id))[0];
}

/**
 * Whether a beaten contingent's commander is lost with it.
 *
 * Reads the battle's OWN roll rather than drawing a new one, so a commander's
 * fate is part of the engagement that decided it and costs the determinism
 * nothing.
 */
export function commanderLost(roll: number): boolean {
  return roll <= COMMANDER_LOSS_ROLL;
}
