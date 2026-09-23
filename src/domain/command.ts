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
 *   opening salvo, so they are worth a great deal to a power that builds torpedo
 *   boats and exactly nothing to one that brought none.
 * - `convoy` is **large and conditional on losing** — it is worth nothing at
 *   all until the day you have to run, and a great deal on that day.
 * - `assault` is **large and conditional on taking ground** — it multiplies the
 *   troops the lift arm lands, so it decides conquests and is worth nothing in
 *   a battle nobody is trying to win a world with.
 *
 * That is a better set than one-per-phase would have been, because it means the
 * four are not substitutes: which one you want depends on the fleet you build
 * and the war you are losing or winning.
 *
 * ## Why there is a fourth, and why the draw is not uniform
 *
 * `gunnery` is conditional on a **class that one power in five builds**. The
 * bots buy torpedo boats for Drajk and nobody else, because a screen is a
 * defensive purchase and preying on fleets it could never beat in orbit is the
 * whole of the Confederacy's doctrine — so for the other four powers a third of
 * every roster had a battle effect that **could not fire at all**. Measured, not
 * inferred: the draw is uniform over the schools and reads `buildBias` nowhere.
 *
 * That is the inert-mechanic failure this codebase keeps closing — the first
 * veterancy thresholds, `lineofbattle`'s occupation passive, `monopolist` owned
 * by nobody. The fix has two halves and needs both:
 *
 * - **A school for the landing**, which every power reaches for, because a
 *   fourth school is what lets the draw take `gunnery` away from powers that
 *   would never use it without leaving a hole where it was.
 * - **A weighted draw** (`SCHOOL_WEIGHTS`), so `gunnery` is Drajk's school and
 *   is merely *rare* elsewhere rather than impossible. Rare rather than absent
 *   on purpose: a Meridian player who decides to build boats should be able to
 *   find an ordnance officer eventually, and a school no power can ever draw is
 *   the same dead branch one step along.
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
    known: 'the opening salvo — they fire before the fleets close, and well',
  },
  {
    kind: 'convoy',
    phase: 'the withdrawal',
    effect: 'brings more of a beaten fleet home',
    known: 'getting a broken fleet out, which is a reputation nobody wants',
  },
  {
    kind: 'assault',
    phase: 'the landing',
    effect: 'puts more of the lift arm onto the ground',
    known: 'the landing itself — going down with the first wave, and being hard to throw off',
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
 * and whose yards built torpedo boats was better off losing them, two times in
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
 * top keeps the three distinct. A veteran's bonus being might whatever they are
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
 * `assault`: the share added to the troops the lift arm puts ashore.
 *
 * Sized against the might modifier it sits beside rather than picked: `assault`
 * is already `troops * (1 + attackMod / 20)`, so a veteran `lineofbattle`
 * officer's +3 might is +15% on the same quantity. A veteran here is +35% — more
 * than twice that, which is the "large and conditional" shape, and the price is
 * that it does nothing whatever in a battle with no landing in it.
 *
 * **Attacker's only**, and that is the honest version rather than a gap. A
 * defender has no lift phase; the thing an officer could do for them on the
 * ground is make the garrison fight above its size, and that is
 * `DEFENSIVE_GARRISON_BONUS` — Arkane's entire doctrine. A commander who did it
 * too would flatten a war ethic, which is the constraint that shaped the
 * original three.
 */
export const COMMANDER_ASSAULT = [0.15, 0.25, 0.35] as const;

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

/**
 * Inside the loss band, who is killed and who is taken alive.
 *
 * Read off the **same roll**, so capture costs no second source of randomness
 * and replays exactly: `1–2` is a death, `3–4` is a capture. An even split of a
 * band that was already there, rather than a new die and a new tuning constant.
 *
 * A capture needs a **captor**, so a beaten side with nobody to take prisoners —
 * a fleet driven off by an unaligned world's militia — kills instead. Ground
 * with no flag over it does not run a prison.
 */
export const COMMANDER_CAPTURE_ROLL = 2;

export function commanderTaken(roll: number): boolean {
  return commanderLost(roll) && roll > COMMANDER_CAPTURE_ROLL;
}

/* ------------------------------------------------------------------ */
/* A roster, and what it costs to have one                             */
/* ------------------------------------------------------------------ */

/**
 * How many officers a power may have in post at once.
 *
 * Until recruitment there was no roster at all: `tickTurn` appointed a
 * successor only when a power had nobody, so the answer was permanently one and
 * `commanderFor`'s seniority sort was dead code. Five is enough that a power can
 * cover its fronts and specialise — a gunner with the boats, a quartermaster
 * behind the line — and few enough that losing one still matters.
 */
export const MAX_ACTIVE_COMMANDERS = 5;

/**
 * What hiring one costs, and what keeping one costs a turn.
 *
 * **Upkeep is the right instrument now, and it was the wrong one before.** The
 * argument against it when a death was free was that upkeep bounds a roster you
 * can stockpile and a power could never hold two officers — so there was nothing
 * to stockpile and a per-turn charge was noise. Recruitment is exactly the
 * change that makes the premise true, so the charge arrives with the thing it
 * was always the answer to.
 *
 * A full roster runs `5 × COMMANDER_UPKEEP` a turn against net incomes of
 * 60–300, so it is a real line in the ledger rather than a rounding error, and a
 * poor power that hires five is choosing officers over hulls.
 */
export const COMMANDER_COST = 120;
export const COMMANDER_UPKEEP = 5;

/** Officers a power currently has in post. Captured and lost do not count. */
export function activeCommanders(
  commanders: Commander[] | undefined,
  factionId: string,
): Commander[] {
  return (commanders ?? []).filter((c) => c.factionId === factionId && c.status === 'active');
}

/**
 * What a captured officer is worth, to their own power and to anybody else.
 *
 * Worth most to the power that lost them, which is the whole of why an asset is
 * worth trading rather than hoarding — and the same claim `prisoners` makes.
 * Scaled by their record, because a veteran is the officer a power actually wants
 * back: losing their cost them a ladder that took engagements to climb.
 *
 * Everyone else pays a flat, small figure. An enemy admiral is worth something
 * to a third party — as leverage, or as a thing to sell on — and nothing like
 * what they are worth at home.
 */
export const OFFICER_LEVERAGE = 60;

/**
 * What a power will pay to get its own operative back.
 *
 * Below an officer's, and the gap is the point: a commander is a post, and a
 * spy is a person who can be replaced by deploying another at `AGENT_COST`.
 * What makes them worth anything at all is what they know, which is why the
 * file made out of them is worth a share of this rather than of nothing.
 */
export const OPERATIVE_RANSOM = 120;

/**
 * A hostage taken is worth this per point of the world's `strategicValue` to
 * the house they were taken from, and `OFFICER_LEVERAGE` to anybody else.
 *
 * Scaled off the world rather than flat, because *"someone who matters"* means
 * something different on a nine-value capital than on a backwater: the person
 * a conqueror finds worth holding at Shalka is a different person from the one
 * at Vosk Marker, and the map already says which is which.
 */
export const HOSTAGE_VALUE_PER_POINT = 35;

/**
 * The roll a storming or a subversion must make to come away with a hostage.
 *
 * Read off the top of the same seeded d20 the event already rolled, never a new
 * one, so a campaign replays exactly — the rule `commanderTaken` and the agent
 * exposure ladder both follow.
 *
 * Deliberately uncommon. A hostage is leverage over a power, and a mechanism
 * that produced one on every capture would flood the table with them and make
 * each worth nothing; at 17+ a conqueror takes a person roughly one storming in
 * five, which is often enough to be a thing that happens and rare enough to be
 * worth something when it does.
 */
export const HOSTAGE_ROLL = 17;

export const hostageTaken = (roll: number): boolean => roll >= HOSTAGE_ROLL;

/**
 * What a prisoner's file is worth against the prisoner.
 *
 * A fraction, because interrogating them **spends** them: the ransom goes and
 * what is left is paper worth a share of it, only to the power that did the
 * questioning. That is the whole decision — a veteran is worth 450 alive to the
 * power that wants them back, and a file on them is worth 180 to you.
 */
export const INTERROGATION_SHARE = 0.4;

/* ------------------------------------------------------------------ */
/* What trafficking in people costs, and what handing them back buys   */
/* ------------------------------------------------------------------ */

/**
 * Disposition moved by what a power does with the people it is holding.
 *
 * Assets have been tradeable since they existed and **moving one cost nobody
 * anything** — a power could sell another's admiral to their worst enemy, or
 * question one and throw them away, and the only thing that moved was credits.
 * The same defect `COERCION_RESENTMENT` was added for: an act that is plainly an
 * insult, priced at nothing, because nothing read it.
 *
 * The asymmetry is the design. **Giving somebody back is worth more than taking
 * them cost**, because a repatriation is a choice and a capture was a battle —
 * which is what makes a prisoner a diplomatic instrument rather than a
 * scoreboard.
 *
 * Only for **people**: an asset carrying a `commanderId` or an `agentId`.
 * Selling a hold of ore to somebody's enemy is commerce, and so is a hold of
 * anonymous crews — `prisoners` names nobody, and a power cannot resent the
 * sale of people it cannot name.
 */
export const REPATRIATION_GOODWILL = 25;
export const TRAFFICKING_RESENTMENT = 15;
export const INTERROGATION_RESENTMENT = 20;
/** What a third party thinks of a power that deals in prisoners at all. */
export const TRAFFICKING_REPUTATION_COST = 4;

export function officerRansom(
  c: Commander,
  factionIds: readonly string[],
): Record<string, number> {
  const worth: Record<string, number> = {};
  for (const id of factionIds) {
    worth[id] = id === c.factionId ? 150 + veterancyOf(c.battles) * 150 : OFFICER_LEVERAGE;
  }
  return worth;
}

/**
 * Killing one outright takes a **17 or better**, on a roll of its own.
 *
 * A separate die from the operation's, which is unavoidable rather than
 * careless: the success test reads the BOTTOM of the d20 (`roll * 5 <=
 * successChance`) and this has to read the top, so one roll cannot carry both.
 * It is seeded on the agent and the turn like everything else, so it replays.
 *
 * Deliberately long odds on top of everything an assassination already costs —
 * 150 credits, a slot against `maxAgentsFor`, spent after one attempt either
 * way, and caught nearly half the time. A commander is the most concentrated
 * thing on the board now that a veteran is worth three points of might or a
 * seventh of a fleet's upkeep, and a reliable way to remove one would make
 * every other use of an operative a mistake.
 */
export const ASSASSINATION_KILL_ROLL = 17;

/* ------------------------------------------------------------------ */
/* Passives: what an officer is worth on a turn with no battle         */
/* ------------------------------------------------------------------ */

/**
 * Each archetype also does something outside a battle, and the sizes are
 * deliberately uneven.
 *
 * The problem this answers is `convoy`. Its battle effect is the most
 * conditional thing in the set — worth **nothing at all** until the turn you
 * have to run — so on any turn a player is choosing an officer it reads as the
 * weak pick, right up to the campaign where it isn't. A conditional effect
 * needs an unconditional counterweight or nobody ever takes it.
 *
 * So the passive runs **opposite to the battle effect's conditionality**:
 *
 * | | in battle | out of it |
 * |---|---|---|
 * | `lineofbattle` | always | least — they are already earning every fight |
 * | `gunnery` | only with boats | middling |
 * | `convoy` | only when losing | **most**, and it is the largest recurring number in the ledger |
 *
 * All three are **read where they are used** rather than applied on the tick,
 * which is the rule `commitmentFlow`, `assetYield` and the agent effects all
 * follow: a per-turn mutation compounds instead of recurring.
 *
 * They scale with veterancy like everything else here, so the officer a power
 * has kept alive is worth more at home as well as in the line — and losing them
 * costs something on a turn nobody fought at all, which is the whole of what
 * `battles` was supposed to mean.
 */

/**
 * `lineofbattle`: points of **resolve**, added like terrain and clamped the same.
 *
 * Their crews do not come apart, which is what `resolve` defends: `subornLimit`
 * is the suborner's guile modifier against the target's, so an officer known
 * for holding formation under fire makes a power's ships harder to turn. Never
 * might, for the reason the gunner's is never might — `bestMod` reads
 * `effectiveStats().might`, so it would pay their twice for the same battle.
 *
 * **The first version of this was occupation relief and it was worth nothing.**
 * Discipline holding ground that is not yours is a better sentence, and it was
 * measured at **zero credits for every power holding a line officer** over
 * thirty harness turns: three of the four occupy no foreign ground at all. Same
 * failure as the first veterancy thresholds, caught the same way — by checking
 * the mechanic fired rather than that the board was unchanged. A passive
 * conditional on conquest is not a passive.
 */
export const COMMANDER_RESOLVE = [1, 2, 3] as const;

/**
 * `gunnery`: points of **industry**, added like terrain and clamped the same.
 *
 * An ordnance officer runs the establishment that makes the guns, so what they
 * is worth at home is the industrial base rather than money. Industry
 * deliberately, and never might: `bestMod` reads `effectiveStats().might`, so a
 * might passive would pay their twice for the same battle.
 */
export const COMMANDER_INDUSTRY = [1, 2, 3] as const;

/**
 * `convoy`: the share of fleet upkeep their logistics save. The big one.
 *
 * Upkeep is the largest standing charge any power carries — on the opening
 * board it is roughly a third of gross — so this is the only passive here that
 * changes what a power can afford to build. That is the point: it is the
 * counterweight to a battle effect that does nothing until the day you lose.
 */
export const COMMANDER_UPKEEP_RELIEF = [0.06, 0.1, 0.14] as const;

/**
 * `assault`: points of **influence**, added like terrain and clamped the same.
 *
 * A power whose officers can put troops on a world is listened to by powers that
 * would rather they did not — an army in being is leverage at a table, which is
 * the same claim `COERCION_RESENTMENT` already makes from the other side. It is
 * also the last stat available: `bestMod` reads might, so a might passive would
 * pay this officer twice for the same landing, and `lineofbattle` and `gunnery`
 * have taken resolve and industry.
 *
 * **It was extra garrison regrowth first, and that measured at nothing.**
 * `+1..3` on `GARRISON_REGROWTH` for every world the power holds reads like a
 * landing officer's obvious trade, and over thirty harness turns it moved the
 * board by **3 garrison for one power and zero for the other four** — including
 * Arkane, which opens with an officer of this very school. The reason is
 * structural rather than bad luck: regrowth is clamped to `garrisonMax` and
 * garrisons sit AT their ceiling almost always, so a faster rate only does
 * anything in the few turns after a fight. The clamp that made a per-turn
 * mutation safe is the same clamp that made it inert.
 *
 * That is the third time this exact shape has been caught — the 4/10 veterancy
 * thresholds, `lineofbattle`'s occupation relief, and now this — and all three
 * were found the same way, by measuring that the mechanic FIRED rather than that
 * the board was unchanged. A stat passive cannot fail that way, because
 * `effectiveStats` is read by every check in the game.
 */
export const COMMANDER_INFLUENCE = [1, 2, 3] as const;

export function commanderResolve(c: Commander): number {
  return c.archetype === 'lineofbattle' ? COMMANDER_RESOLVE[veterancyOf(c.battles)]! : 0;
}
export function commanderIndustry(c: Commander): number {
  return c.archetype === 'gunnery' ? COMMANDER_INDUSTRY[veterancyOf(c.battles)]! : 0;
}
export function commanderUpkeepRelief(c: Commander): number {
  return c.archetype === 'convoy' ? COMMANDER_UPKEEP_RELIEF[veterancyOf(c.battles)]! : 0;
}
export function commanderInfluence(c: Commander): number {
  return c.archetype === 'assault' ? COMMANDER_INFLUENCE[veterancyOf(c.battles)]! : 0;
}

/**
 * The passive, in the words a panel uses.
 *
 * Unlike `commanderEffect`, these accessors gate on the archetype themselves —
 * a ledger asks "what relief does this power's officer give me" without caring
 * which school they are from, and making every caller test the archetype first is
 * how one of them eventually forgets.
 */
export function commanderPassive(c: Commander): string {
  switch (c.archetype) {
    case 'lineofbattle':
      return `+${commanderResolve(c)} resolve`;
    case 'gunnery':
      return `+${commanderIndustry(c)} industry`;
    case 'convoy':
      return `-${Math.round(commanderUpkeepRelief(c) * 100)}% fleet upkeep`;
    case 'assault':
      return `+${commanderInfluence(c)} influence`;
  }
}

/* ------------------------------------------------------------------ */
/* What an officer is worth, given their record                          */
/* ------------------------------------------------------------------ */

/**
 * The three ladders, read at the step the officer's own record puts their on.
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

export function commanderAssault(c: Commander): number {
  return COMMANDER_ASSAULT[veterancyOf(c.battles)]!;
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
    case 'assault':
      return `+${Math.round(commanderAssault(c) * 100)}% troops ashore in a landing`;
  }
}

/**
 * Engagements still owed before the next step, or `null` at the cap.
 *
 * Shown because the ladder is only a reason to protect an officer if a player
 * can see where they are on it — a cost you cannot read coming is a cost you
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
  /**
   * `lost` is dead; `captured` is alive and in somebody else's hands.
   *
   * A captured officer is **not on anybody's roster** — they count against no
   * cap, commands nothing, and draws no pay — but they still exists, which is
   * what lets their come home. The `Asset` holding their is the thing that moves;
   * this record is what they IS.
   */
  status: z.enum(['active', 'lost', 'captured']).default('active'),
  /**
   * Where they are standing, or `null` while they are in transit with a fleet.
   *
   * **An officer is in a fleet without being tonnage**, which is the whole
   * shape of this. They are not a `ShipStack` entry and never enters the loss
   * order: everything in that order is denominated in tons, and putting a
   * person there would need an `orbitalWeight` — where the codebase has already
   * established that nothing may weigh exactly nothing, because a side with no
   * weight reads as "nothing to fight" to every branch of the resolver. "Last
   * in the loss order" is also precisely the bug `lifter` shipped with, which
   * made transports the safest thing in a fleet.
   *
   * So they ride alongside the hulls rather than among them, and the only thing
   * that can kill their is `commanderLost` on a defeat — a considered rule rather
   * than an emergent one that would need an exception to stop being a coin
   * flip.
   *
   * In transit they belong to the ORDER (`PendingOrder.commanderId`) and this
   * is `null`, which is exactly how their ships work: a fleet under way is in
   * `order.force` and not in `system.ships`, and `shipsInTransit` derives from
   * `pendingOrders`. One convention, not two.
   */
  atSystemId: z.string().nullable().default(null),
});
export type Commander = z.infer<typeof CommanderSchema>;

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/**
 * Per-faction name stock: a given name, a family name, and a title.
 *
 * **Three parts, generated independently**, which is what makes the set large
 * enough to feel like a service rather than a list. Eight firsts against ten
 * lasts is eighty people per power before the title, where a first-plus-epithet
 * pair read as the same handful of characters recurring.
 *
 * **The title is the archetype, said out loud.** One per school per power, so
 * a Line Captain and a Master Gunner are visibly different appointments and a
 * player learns what a school is called before learning what it does. It is not
 * a leak: an officer's archetype is already on the Command tab for every power,
 * and it is a fact about a fleet rather than about a plan. It also does the
 * work inheritance needs — a successor holds the same school and therefore the
 * same title, so the continuity of the institution is legible in the name
 * itself while the person is plainly somebody new.
 *
 * Five powers that should never be mistaken for one another is a rule this
 * project applies to voice, ethics, red lines and build bias, so the stocks are
 * per faction and so is the SHAPE: the Vigil and the Arkane wear the title in
 * front, the Combine carries it behind the house name the way it carries every
 * other obligation.
 */
interface NameStock {
  first: string[];
  last: string[];
  /** One per archetype. The name a power gives that school of officer. */
  titles: Record<CommanderArchetype, string>;
  /** Where the title sits relative to the name. */
  place: 'prefix' | 'suffix';
}

const NAME_STOCK: Record<string, NameStock> = {
  /* A chartered company, and it does not pretend to be a navy: the ranks are
     the ones on the org chart, because that is what the Authority is. */
  meridian: {
    first: ['Adrienne', 'Caspar', 'Teodor', 'Lira', 'Odile', 'Marcus', 'Sabine', 'Yusuf'],
    last: ['Vance', 'Okonjo', 'Reyes', 'Haldane', 'Brandt', 'Sorel', 'Achebe',
           'Marchetti', 'Delacroix', 'Ferreira'],
    titles: {
      lineofbattle: 'Operations Executive',
      gunnery: 'Senior Director',
      convoy: 'Comptroller',
      assault: 'Acquisitions Director',
    },
    place: 'prefix',
  },
  /* The remnant of a state: praenomen and cognomen, and the flag ranks of a
     service that still keeps its establishment on paper. */
  vigil: {
    first: ['Caius', 'Valeria', 'Drusus', 'Marcia', 'Aulus', 'Livia', 'Quintus', 'Sabina'],
    last: ['Ferrata', 'Corvinus', 'Nasica', 'Longinus', 'Severa', 'Galba',
           'Cinna', 'Rufus', 'Varro', 'Scaeva'],
    titles: {
      lineofbattle: 'Iron Marshal',
      gunnery: 'Commodore',
      convoy: 'Rear Admiral',
      assault: 'Brigadier',
    },
    place: 'prefix',
  },
  /* A family before it is a fleet: the given name is yours, the house name is
     what you answer to, and the office comes last because it is what you are
     owed rather than what you are called. */
  ojjul: {
    first: ['Serek', 'Halvane', 'Dovic', 'Ruille', 'Tallim', 'Osk', 'Vessine', 'Miral'],
    last: ['Nar Kheline', 'Nar Ossik', 'Nar Duvane', 'Nar Serrel', 'Nar Halq',
           'Nar Ojjuk', 'Nar Tevin', 'Nar Rissa', 'Nar Belline', 'Nar Aquen'],
    titles: {
      lineofbattle: 'Underboss',
      gunnery: 'Second Elder',
      convoy: 'Hand of the Family',
      assault: 'Enforcer',
    },
    place: 'suffix',
  },
  /* Elected, and the office is the name: an Arkane officer is introduced by
     what the councils asked them to do, not by a rank they hold. Every one of
     them is a -warden under the Highwarden, so an Arkane officer is placeable
     from the title alone even before the name. */
  freeworlds: {
    first: ['Oria', 'Kell', 'Devain', 'Sarn', 'Mira', 'Tolen', 'Ysra', 'Bran'],
    last: ['Stonecount', 'Vesskeeper', 'Throatholder', 'Ninefold', 'Dustborn',
           'Marklen', 'Pellrun', 'Delvane', 'Ashkeep', 'Windward'],
    titles: {
      lineofbattle: 'Fleetwarden',
      gunnery: 'Gunwarden',
      convoy: 'Lanewarden',
      assault: 'Fieldwarden',
    },
    place: 'prefix',
  },
  /* No commissions and no register: a Drajk title is a thing crews call
     somebody until it sticks, and half of them started as insults. The -master
     suffix is theirs the way -warden is the Arkane's, and it runs up to the
     Huntmaster — a quartermaster on a raiding crew is elected and answers to
     the hold rather than to the captain, which is the Confederacy exactly. */
  drajk: {
    first: ['Kess', 'Ravel', 'Tannic', 'Voss', 'Sherrin', 'Doram', 'Aleska', 'Prynn'],
    last: ['Longburn', 'Deeprunner', 'Coldwake', 'Halfshare', 'Threxwind',
           'Ashlott', 'Greywake', 'Skeln', 'Hollowmark', 'Sundrift'],
    titles: {
      lineofbattle: 'Korvan Lord',
      gunnery: 'Packmaster',
      convoy: 'Quartermaster',
      assault: 'Swordmaster',
    },
    place: 'prefix',
  },
};

const FALLBACK = NAME_STOCK['drajk']!;

/**
 * A name from a seed, deterministic and therefore replayable.
 *
 * Three independent draws off `rollD20`'s hash — given name, family name, and
 * the title that comes with the school. Nothing here may reach for a clock or
 * `Math.random`: a roster that differed between a campaign and its replay would
 * break `verifyReplay` on a string comparison, which is exactly the class of bug
 * key ordering already caused once.
 *
 * The archetype is an argument rather than something this rolls for itself,
 * because a successor **inherits** one and a seeded officer is **dealt** one,
 * and a name that disagreed with the record would be a second source of truth
 * about what an officer is.
 *
 * `rollD20` returns 1..20 and the stocks are 8 and 10 long, so the modulo is
 * not uniform — 20 % 8 is 4, and half the given names are drawn slightly more
 * often. That is a cosmetic bias on a cosmetic field and is left alone
 * deliberately: the uniformity that matters is the die's, which the murmur3
 * finalizer already guarantees, and widening a name list to 20 to flatten it
 * would be arithmetic driving the fiction.
 */
export function commanderName(
  factionId: string,
  turn: number,
  salt: string,
  archetype: CommanderArchetype,
): string {
  const stock = NAME_STOCK[factionId] ?? FALLBACK;
  const a = rollD20(turn, `commander-first:${factionId}:${salt}`) - 1;
  const b = rollD20(turn, `commander-last:${factionId}:${salt}`) - 1;
  const person = `${stock.first[a % stock.first.length]} ${stock.last[b % stock.last.length]}`;
  const title = stock.titles[archetype];
  return stock.place === 'prefix' ? `${title} ${person}` : `${person}, ${title}`;
}

/**
 * A name nobody in this campaign is already using.
 *
 * Eighty officers per power sounds like plenty and is not: the birthday problem
 * bites at five on a roster and again every time one is replaced, and a
 * campaign that fields *Kess Coldwake* twice has told the player the generator
 * is a generator. Measured before this: two of six draws collided in one power.
 *
 * Resolved by **bumping the salt and drawing again**, not by editing the name —
 * a suffixed *"Kess Coldwake II"* is a worse answer than a different person.
 * Deterministic, because the retry is a pure function of the taken set and the
 * taken set is a pure function of state, so a replay walks the same path.
 *
 * Gives up after `TRIES` and returns the collision, which is right rather than
 * defensive: exhausting eighty names means a power has fielded eighty officers
 * and a repeat is no longer the surprising thing.
 */
export function unusedName(
  taken: ReadonlySet<string>,
  draw: (attempt: number) => string,
): string {
  const TRIES = 24;
  let name = draw(0);
  for (let i = 1; i < TRIES && taken.has(name); i++) name = draw(i);
  return name;
}

/** Every name this campaign has already used, officers and operatives alike. */
export function namesInUse(state: {
  commanders?: Commander[];
  agents?: { name?: string }[];
}): Set<string> {
  const taken = new Set<string>();
  for (const c of state.commanders ?? []) taken.add(c.name);
  for (const a of state.agents ?? []) if (a.name) taken.add(a.name);
  return taken;
}

/**
 * An operative's name: the same stock, and no title.
 *
 * Same people, so the same given and family names — an operative is one of the
 * power's own, not a separate species. **No rank**, because a title here names
 * a school of command and an operative commands nothing; what they have instead
 * is a `cover`, which the game already asks for and which is the thing a rival
 * actually sees.
 */
export function agentName(factionId: string, turn: number, salt: string): string {
  const stock = NAME_STOCK[factionId] ?? FALLBACK;
  const a = rollD20(turn, `agent-first:${factionId}:${salt}`) - 1;
  const b = rollD20(turn, `agent-last:${factionId}:${salt}`) - 1;
  return `${stock.first[a % stock.first.length]} ${stock.last[b % stock.last.length]}`;
}

/** Exported so a test can hold the stocks to the archetypes rather than to itself. */
export const NAME_STOCK_FACTIONS = Object.keys(NAME_STOCK);
export function titlesFor(factionId: string): Record<CommanderArchetype, string> {
  return (NAME_STOCK[factionId] ?? FALLBACK).titles;
}

/**
 * Which of the three an appointment turns out to be. Also seeded.
 *
 * **Two rolls, not one**, and that is a correction rather than a flourish.
 * `rollD20` returns 1–20, so a single draw taken `% 3` lands 7/7/6 — `convoy`
 * comes up 30% of the time against 35% for the others. That mattered little
 * when a power had exactly one officer for a whole campaign and matters now
 * that recruitment draws up to five, because the archetype being quietly
 * under-drawn is the one carrying the largest passive.
 *
 * Two rolls give 400 values, of which 3 divides 399 — a residual bias of a
 * quarter of a percent, which is the same order as the name stocks' and for the
 * same reason left alone. Measured: 160/165/155 over 480 draws before, even
 * after.
 */
/**
 * How often each power's appointments come out of each school.
 *
 * **`gunnery` is Drajk's, and `assault` is everybody else's.** A gunnery officer
 * multiplies the opening salvo, which is worth a great deal to a power that
 * builds torpedo boats and *nothing whatever* to one that brought none — and
 * only the Confederacy builds them, because a screen is a defensive purchase and
 * preying on fleets it could never beat in orbit is its whole doctrine. Drawn
 * uniformly, a third of every other power's roster had a battle effect that
 * could not fire.
 *
 * Mirrored on Drajk's side rather than special-cased: *"never hold ground worth
 * besieging"* is the sheet of the one power that should almost never produce a
 * landing officer.
 *
 * `RARE_SCHOOL_WEIGHT` is 1 against 8 — **4%, not 0%** — because a player is not
 * a bot. A Meridian leader who decides to build boats should be able to find an
 * ordnance officer eventually, and a branch no power can ever reach is the same
 * dead code this table exists to remove. It also keeps `successorArchetype`
 * honest: an inherited school is never one its power could not have drawn.
 *
 * The weights total **25**, which divides the draw's 400 values exactly, so
 * unlike the name stocks this carries no residual bias at all.
 */
const COMMON_SCHOOL_WEIGHT = 8;
const RARE_SCHOOL_WEIGHT = 1;

/** The school each power almost never appoints. */
const RARE_SCHOOL: Record<string, CommanderArchetype> = {
  drajk: 'assault',
};
const DEFAULT_RARE_SCHOOL: CommanderArchetype = 'gunnery';

function schoolWeights(factionId: string): { kind: CommanderArchetype; weight: number }[] {
  const rare = RARE_SCHOOL[factionId] ?? DEFAULT_RARE_SCHOOL;
  return COMMANDER_ARCHETYPES.map((a) => ({
    kind: a.kind,
    weight: a.kind === rare ? RARE_SCHOOL_WEIGHT : COMMON_SCHOOL_WEIGHT,
  }));
}

export function commanderArchetype(
  factionId: string,
  turn: number,
  salt: string,
  /**
   * False for a journal written before `assault` existed (version 6 and
   * earlier): those campaigns drew uniformly from the first three schools, and
   * every appointment they made has to come out the same on replay.
   */
  fourSchools = true,
): CommanderArchetype {
  const hi = rollD20(turn, `commander-kind:${factionId}:${salt}`) - 1;
  const lo = rollD20(turn, `commander-school:${factionId}:${salt}`) - 1;
  if (!fourSchools) return COMMANDER_ARCHETYPES[(hi * 20 + lo) % 3]!.kind;
  const weights = schoolWeights(factionId);
  const total = weights.reduce((n, w) => n + w.weight, 0);
  let draw = (hi * 20 + lo) % total;
  for (const w of weights) {
    if (draw < w.weight) return w.kind;
    draw -= w.weight;
  }
  return weights[0]!.kind;
}

/**
 * What the next officer is known for: the same thing the last one was.
 *
 * **A successor inherits the archetype and never the record**, and the split is
 * the whole of what makes a death a loss. Re-rolling the specialty made a
 * defeat a free lottery ticket — a power stuck with an officer its fleet had no
 * use for was better off losing them — so the one live consequence of the death
 * mechanic ran backwards. Inheriting it means what a defeat costs is the
 * `battles` behind them, which is a thing that took turns of winning to build
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
  fourSchools = true,
): CommanderArchetype {
  // Scanned from the end: the array is append-ordered, so the last entry for a
  // faction is the officer most recently in post. Every one of them is `lost`
  // by the time this is asked, since an active officer is what stops the
  // appointment happening at all.
  const all = commanders ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.factionId === factionId) return all[i]!.archetype;
  }
  return commanderArchetype(factionId, turn, salt, fourSchools);
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
/**
 * The officer of this power standing at this system, if any.
 *
 * What `commanderFor` is to a power, this is to a place — and the split is the
 * point of giving an officer a location at all: their **passives** are theirs
 * wherever they are, because they run the power's establishment, while them
 * **battle** effect reaches only the engagement they are actually present for.
 * Before this they commanded every battle their power fought, simultaneously,
 * across the galaxy.
 */
export function commanderAt(
  commanders: Commander[] | undefined,
  factionId: string,
  systemId: string,
): Commander | undefined {
  return (commanders ?? []).find(
    (c) => c.factionId === factionId && c.status === 'active' && c.atSystemId === systemId,
  );
}

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

/* ------------------------------------------------------------------ */
/* Naming a person the model did not invent                            */
/* ------------------------------------------------------------------ */

/**
 * Words that carry no identity, so a query keeps its meaning without them.
 *
 * Deliberately tiny, and deliberately free of anything that appears in a title:
 * `marshal`, `elder`, `warden`, `master`, `hand` and the rest are exactly the
 * tokens a player uses to name somebody they only know by rank, and dropping one
 * of those would throw away the discriminating half of *"Marshal Galba"*.
 *
 * The possessives here are the they/them set and no other, which is the
 * convention rather than an oversight: officers are they/them everywhere in this
 * game because their names are generated, so *"their Iron Marshal"* is the form
 * a player writes. A gendered determiner in front of an officer's name falls
 * through as an unmatched token and the query reports that it identified
 * nobody — which is the honest outcome, and a great deal better than a list that
 * quietly contradicts the rule `naming.test.ts` pins.
 */
const NAME_FILLER = new Set([
  'the', 'their', 'theirs', 'them', 'they', 'our', 'ours', 'your', 'yours',
  'its', 'of', 'and', 'a', 'an', 'to', 'at', 'on',
  'that', 'this', 'enemy', 'rival', 'opposing',
]);

/** Lowercase, drop punctuation, split, and discard filler. */
function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NAME_FILLER.has(w));
}

/**
 * Does one token of a written name answer to one token of a query?
 *
 * Exact, or an **initial**: `m` answers `marcia`, which is the whole of what
 * makes *"M. Galba"* work. Deliberately one direction only — a one-letter token
 * in the officer's own name would be a generator bug, not an abbreviation.
 */
function tokenAnswers(nameToken: string, queryToken: string): boolean {
  if (nameToken === queryToken) return true;
  return queryToken.length === 1 && nameToken.startsWith(queryToken);
}

/**
 * The officer a free-text name refers to, or `null`.
 *
 * ## Why this is code and not a prompt rule
 *
 * `Commander.name` stores the title baked in — *"Iron Marshal Marcia Galba"*,
 * *"Miral Nar Halq, Hand of the Family"* — because a title names the school and
 * the school is the officer's whole mechanical identity. A player does not write
 * it that way. They write *"Marcia Galba"*, *"M. Galba"*, *"Marshal Galba"*, and
 * before this every one of those reached a `targetCommanderId` that matched no
 * record: the assassination was admissible, priced, rolled, and then killed
 * nobody while the officer went on commanding battles. The inert success this
 * codebase closes everywhere else.
 *
 * The division of labour is the one `classifyPrinciple` already sets, for the
 * same stated reason — **the model is good at judgement and unreliable at
 * lookup**. Asking a prompt to remember an id is asking it to do the lookup;
 * asking it to name the person it means is asking for the judgement. So the
 * model writes down a name and this resolves it, which is also why an id is
 * accepted: a caller that already has one should not be forced to round-trip
 * through prose.
 *
 * ## The rule
 *
 * **Every content token of the query must be answered**, so a name that is
 * merely adjacent does not match. Among the candidates that clear that bar the
 * most specific wins — the one that answered the most tokens — and a **tie is
 * `null`**, because two officers a query fits equally is a query that has not
 * identified anybody and guessing between them is worse than saying so.
 */
export function resolveCommander(
  commanders: Commander[] | undefined,
  query: string,
  /** Narrow the field before matching: rivals only, active only, and so on. */
  eligible: (c: Commander) => boolean = () => true,
): Commander | null {
  const all = (commanders ?? []).filter(eligible);
  if (all.length === 0) return null;

  // An id is not a name and must never go through the token matcher: ids are
  // `cmd-3-0`, so tokenising one produces `cmd`, `3`, `0` and a single-letter
  // rule that was built for initials starts answering digits.
  const byId = all.find((c) => c.id === query.trim());
  if (byId) return byId;

  const wanted = nameTokens(query);
  if (wanted.length === 0) return null;

  let best: Commander | null = null;
  let bestScore = 0;
  let tied = false;
  for (const c of all) {
    const have = nameTokens(c.name);
    let score = 0;
    for (const w of wanted) {
      if (have.some((h) => tokenAnswers(h, w))) score++;
    }
    // Partial credit is not credit. "Galba" must not resolve to an officer who
    // merely shares a title with the one Galba.
    if (score < wanted.length) continue;
    if (score > bestScore) {
      best = c;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}
