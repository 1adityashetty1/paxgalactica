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
    effect: 'fights harder, everywhere',
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
 * Veterancy: what an officer's own record is worth, and the whole reason a
 * death costs anything.
 *
 * Before this, losing a commander was free and, worse, **profitable**. The
 * replacement arrived on the next tick with a new name, no bill, and a freshly
 * rolled archetype — so a power whose doctrine had dealt it a `convoy` officer
 * and whose yards built torpedo boats was better off losing her, two times in
 * three. The one mechanically live consequence of the death mechanic paid out
 * on average.
 *
 * `battles` was already counted and had no mechanical reader at all: two
 * display strings and a sort that is a no-op while a power holds one officer.
 * So the thing a defeat destroyed was a name and a counter.
 *
 * It is the officer's OWN record that is worth something, which is what makes
 * this a cost rather than a fee. **A replacement cannot be bought at any
 * price** — the successor is a real officer with a real specialty and no
 * history, and the only way back up the ladder is to fight and win. That is
 * also why upkeep is the wrong instrument here: upkeep bounds a roster you can
 * stockpile, and a power can never hold two officers, so what needed fixing
 * was never the price of the replacement but its QUALITY.
 */
/**
 * **Swept against the harness, and the first guess was dead on arrival.**
 *
 * 4 and 10 read like modest numbers and are unreachable: `pnpm balance 30`
 * fights **four battles in the whole galaxy over thirty turns**, and the
 * busiest officer on the board — Meridian's, who is in three of them — ends the
 * run at 3. At 4/10 not one power in a full campaign ever leaves step 0, so the
 * ladder would have been decoration and the harness would have reported that as
 * a clean pass, since a mechanic that never fires moves nothing.
 *
 * A war in this game is rare and decisive rather than continuous, which is a
 * fact about the map and the 2:1 break-off band rather than about the bots. So
 * the ladder has to be denominated in the engagements a campaign actually
 * contains: **2 makes an officer who has fought at all worth more than a
 * replacement, and 5 is a career.** Measured at 2/5, Adrienne Vance is seasoned
 * by turn 24 and takes +2 might into the defence of Corvid.
 */
export const VETERAN_THRESHOLDS = [2, 5] as const;

/** The top of the ladder, and the answer to a power that only ever wins. */
export const MAX_VETERANCY = VETERAN_THRESHOLDS.length;

/**
 * Which step of the ladder an officer stands on: 0 (untested), 1, or 2.
 *
 * Thresholds rather than a rate, the same shape as `WORLD_BONUS_THRESHOLDS`
 * and for the same reason: a bonus that rises with every engagement is
 * unbounded in principle and compounds with itself, since the officer who wins
 * is the officer who keeps being sent.
 */
export function veterancyOf(battles: number): number {
  let step = 0;
  for (const at of VETERAN_THRESHOLDS) if (battles >= at) step += 1;
  return step;
}

/**
 * What each archetype is worth at each step, indexed by veterancy.
 *
 * **Three ladders rather than one multiplier**, which is not a stylistic
 * choice: a shared scale cannot express this, because might is integer-valued
 * and its base is 1. At x1.5 and x2 the ladder rounds to 1, 2, 2 and the
 * second step buys nothing at all — the same defect as halving a one-hull lift
 * loss, where `floor(1 / 2)` shipped a 100% discount wearing a 50% label.
 * Where the granularity cannot carry a fraction, the fraction is not the thing
 * to write down.
 *
 * Scaling each archetype's own effect rather than adding a flat might bonus on
 * top keeps the three distinct. A veteran's bonus being might whatever she is
 * known for would make every officer partly a `lineofbattle` officer, and that
 * archetype's whole claim is that its help is the small unconditional kind.
 */
/**
 * Might added by a `lineofbattle` officer, against a modifier running -1..+5.
 *
 * The top of this ladder is deliberately larger than `OPPORTUNIST_MIGHT_BONUS`,
 * which revises a claim this file used to make — that a commander is *always*
 * worth less than a doctrine, because a doctrine is what a power IS and an
 * officer is who happened to be aboard. That is right about a **fresh** officer
 * and wrong about a veteran, and the distinction is the whole point of having a
 * ladder: a doctrine is given, and this is the one thing on the field a power
 * builds by winning. It also takes five engagements and is destroyed by a
 * single bad defeat, which no doctrine ever is.
 */
export const COMMANDER_MIGHT = [1, 2, 3] as const;

/**
 * Points off the withdrawal loss, which runs 10-35%.
 *
 * Still floored at 5% in `bleed` whatever the step, because a withdrawal under
 * fire is never free however good the officer running it — the top of this
 * ladder would otherwise clear the bottom of the band outright.
 */
export const COMMANDER_WITHDRAW_RELIEF = [8, 12, 16] as const;

/** How much heavier a `gunnery` officer's opening salvo lands. */
export const COMMANDER_STRIKE_BONUS = [0.4, 0.6, 0.8] as const;

/**
 * A commander is lost when their side is broken and the die is against them.
 *
 * Only on a **defeat** - a routed fleet, or one driven off - because an officer
 * who wins does not die at a rate worth modelling, and because a death roll on
 * every battle would make the roster churn faster than a player could learn a
 * name. `roll <= 4` on the battle's own seeded d20, so it is reproducible and
 * needs no second source of randomness.
 */
export const COMMANDER_LOSS_ROLL = 4;

/* ------------------------------------------------------------------ */
/* What an officer is worth, given her record                          */
/* ------------------------------------------------------------------ */

/**
 * The three ladders, read at the step the officer's own record puts her on.
 *
 * Separate accessors rather than one `effectOf`, because the three are
 * denominated in three different things — a might modifier, a percentage off a
 * loss, and a multiplier on a salvo — and one function returning a bare number
 * for all of them is the units drift this codebase keeps having to undo.
 *
 * Each is read only after the caller has gated on the archetype, exactly as the
 * flat constants were, so the accessor answers "how much" and never "whether".
 */
export function commanderMight(c: Commander): number {
  return COMMANDER_MIGHT[veterancyOf(c.battles)]!;
}

export function commanderRelief(c: Commander): number {
  return COMMANDER_WITHDRAW_RELIEF[veterancyOf(c.battles)]!;
}

export function commanderStrike(c: Commander): number {
  return COMMANDER_STRIKE_BONUS[veterancyOf(c.battles)]!;
}

/** What a battle report calls an officer of this standing. */
export function veterancyLabel(battles: number): string {
  return ['untested', 'seasoned', 'veteran'][veterancyOf(battles)]!;
}

/**
 * What THIS officer is worth, in the same words a battle report uses.
 *
 * `COMMANDER_ARCHETYPES[].effect` describes the SHAPE of an archetype's help
 * and deliberately quotes no number any more — it used to say *"fights a point
 * harder"*, which stopped being true the moment a record could make it two.
 * A screen that says what a kind of officer does is a different thing from one
 * that says what this one does, and only the second can be checked against the
 * arithmetic in the battle card.
 */
export function commanderEffect(c: Commander): string {
  switch (c.archetype) {
    case 'lineofbattle':
      return `+${commanderMight(c)} might in every exchange, and the landing`;
    case 'gunnery':
      return `+${Math.round(commanderStrike(c) * 100)}% on the opening salvo`;
    case 'convoy':
      return `-${commanderRelief(c)}% off a withdrawal`;
  }
}

/**
 * Engagements still owed before the next step, or `null` at the cap.
 *
 * Shown because the ladder is only a reason to protect an officer if a player
 * can see where she is on it — a cost you cannot read coming is a cost you
 * cannot weigh.
 */
export function toNextVeterancy(battles: number): number | null {
  const next = VETERAN_THRESHOLDS[veterancyOf(battles)];
  return next === undefined ? null : next - battles;
}

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

/**
 * What the next officer is known for: the same thing the last one was.
 *
 * **A successor inherits the archetype and never the record**, and the split is
 * the whole of what makes a death a loss. Re-rolling the specialty made a
 * defeat a free lottery ticket — a power stuck with an officer its fleet had no
 * use for was better off losing her — so the one live consequence of the death
 * mechanic ran backwards. Inheriting it means what a defeat costs is the
 * `battles` behind her, which is a thing that took turns of winning to build
 * and cannot be bought at any price.
 *
 * It reads as the institution rather than the person, which is the right shape:
 * a power that fights its wars in the line goes on fighting them in the line,
 * and the officer it promotes is the one that school produced. What it does NOT
 * mean is that a power is locked to a specialty forever — an archetype is fixed
 * at the seed and inherited down from there, and moving off it is what an
 * appointment op would be for, if the player ever gets one.
 *
 * Falls back to a fresh roll when there is no predecessor at all — a faction
 * added mid-campaign, or a save written before commanders existed — so the
 * appointment always has an answer.
 */
export function successorArchetype(
  commanders: Commander[] | undefined,
  factionId: string,
  turn: number,
  salt: string,
): CommanderArchetype {
  // Scanned from the end: the array is append-ordered, so the last entry for a
  // faction is the officer most recently in post. Every one of them is `lost`
  // by the time this is asked, since an active officer is what stops the
  // appointment happening at all.
  const all = commanders ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.factionId === factionId) return all[i]!.archetype;
  }
  return commanderArchetype(factionId, turn, salt);
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
