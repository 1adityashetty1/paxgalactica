# Design: standing — courting, holding and secession

`brainstorm-2026-10-02.md` §6.1 (courting unaligned worlds), generalised: one
figure, a world's **standing** with each power, decides both whom an
independent world joins and whether a held world stays. Worked out against the
code after #58.

*Status, 2026-10-06:* **built** (`src/domain/regard.ts`; `CLAUDE.md`, "Worlds
with a view of their own"), with these departures: resolve is read before
dissent; the courting ethics also leave alone a world that chose a rival, and
the defensive ethic storms nobody else's home; a bot leaves a courtship it is
losing; envoys land after the turn's drift; and no `secession` sandbox was
built. Measured: all five neutral worlds join by turn 12 and the board is
5/5/6/5/4 in all four runs, against 6/5/5/5/4 before; no world rises in the
harness.

## The rule

Every world has a standing with every power. A world stays with its holder
while it is **content** (standing at least 20) or **held down** (enough of the
holder's warships over it). A world that is neither rises, and when its
garrison is gone it declares itself independent. An independent world joins the
power it stands best with, once that standing is high and clear of the rest.

Home ground opens content. Every other world a power holds is **occupied**:
taken, ceded or joined, including the five that open unaligned. Its standing
toward its holder has to be earned or enforced.

---

## What the harness shows today

**The five unaligned worlds are all taken by turn 3**, by conquest, for one
lifter's worth of troops each:

| world | type | value | garrison | taken |
|---|---|---|---|---|
| Ithaal `sek-3` | arid | 5 | 5 | turn 1, Meridian |
| Vosk Marker `ilv-4` | ice | 3 | 2 | turn 1, the Combine |
| Sennex `ark-2` | ice | 4 | 4 | turn 2, Arkane |
| Var Hollow `sek-5` | ice | 4 | 3 | turn 2, Meridian |
| Neth `sek-6` | gas giant | 3 | 4 | turn 3, Meridian |

**Over 100 bot turns, only six worlds are ever occupied**: those five, and
Torrek Anchorage, which the Vigil takes from Meridian on turn 16. Nothing else
changes hands. **Every occupation keeps the fleet that took it, forever.**
Meridian keeps 3 battleships and 3 escorts (4.0 battleship-equivalents) on each
of its three, and the Vigil keeps 5.7 on Torrek. No occupied world ever has
less than 4.0 over it.

**Garrisons sit at their ceiling on every world** at turns 10, 30 and 100. The
exception is Threx at 42 of 6, where a defender's lift became garrison.

Two things follow:

1. **Force has to be counted in warships, not garrison.** A garrison test is
   passed for free on almost every world every turn. That is the lesson the
   assault officer's regrowth passive taught.
2. **No bot occupation would ever fall short as the bots play today.** Under
   the requirement below, a fresh conquest needs 3.7 battleship-equivalents
   at Ithaal and 4.6 at Torrek. The fleets standing there are 4.0 and 5.7. So
   the harness will see this design through courting, not secession; secession
   has to be measured on a sandbox and in played campaigns.
   - **The constants are a cliff.** The requirement sits right at the size of
     the bots' occupation force, so it has to be swept, not picked.

## Standing

`StarSystem.regard: Record<factionId, number>`, −100 to 100, every world toward
every power. Public: a world's mood is not a secret, and the bots must see the
race to compete in it.

### Baselines

It fades toward a baseline by a tenth of the gap a turn, rounded up (the fade
intel uses).

| a world's standing toward | baseline |
|---|---|
| its home power | **+50** |
| a power holding it that is not its home power, when it has one | **−30** — it remembers whose it was |
| anyone else | 0 |

- Home ground is content with nobody lifting a finger.
- A conquered or ceded home world settles at −30 toward its occupier, and never
  forgives on its own.
- The five unaligned worlds settle at 0 toward whoever holds them: not hostile,
  and short of content.

### What moves it

| source | standing |
|---|---|
| its want met, while met (the standing wants below) | +8 a turn |
| its want met, once (`fortify`, `develop_system` landing) | +20 |
| an envoy: `political_maneuver` with a `court` payload, on a world you hold or an independent one | +(8 + influence modifier), bounded by the check like any payload |
| taking it by force | the conqueror's standing set to at most **−60** |
| a raid on a lane through it, by a power it can name | −10 a turn |
| a battle fought over it | −15, toward the attacker |
| conquering an independent world | −25 at every other independent world, toward the conqueror |
| being notorious (heat ≥ 30) | −2 a turn |

**The fade sets the arithmetic.** A standing want kept met settles near +75
from a baseline of 0, and near +50 from −30. Both are content. A one-off want
or an envoy fades back out over a few turns, so it has to be repeated or paired
with a standing want.

A dark raid moves nothing until it is traced.

## Wants, read off the ground

Each world wants one thing, keyed on the stat its type makes
(`WORLD_TYPE_STAT`). So every world has one, it is legible from the map, and
nothing is authored:

| ground | want | met when the power… | worlds |
|---|---|---|---|
| might (arid) | arms | lands a `fortify` it paid for there (+20) | 4 |
| guile (earthnight) | trade | has freighters over it, and it is not blockaded | 4, the four capitals |
| industry (industrial moon, gas giant) | development | lands a `develop_system` it paid for there (+20) | 6 |
| influence (earthlike) | peace | is at war with nobody | 4 |
| resolve (ice, oceanic) | protection | has warships over it, and no lane through it was raided this turn | 7 |

Four of the five wants authored for the neutrals in the first draft come out
the same way. Vosk Marker changes from trade to protection.

**A want counts on any world.** On an independent world, meeting it is
courting. On a world you hold, meeting it pacifies the world.
- `develop_system` and `fortify` already land on unaligned ground for a power
  with ships over it.
- A protection world is pacified by the fleet that holds it down, which is
  right: the cost of both is the same squadron staying put.

## Content, or held down

A held world is **content** at standing ≥ `CONTENT` (20). Otherwise it needs the
holder's warships over it:

> battleship-equivalents × (1 + resolve modifier × `HOLD_PER_RESOLVE`)
> ≥ strategic value × (20 − standing) / 100

Only warships count. Lifters, freighters and listeners weigh nothing in it, and
the garrison does not count (see above). It is scaled by the world's value for
the reason `OCCUPATION_COST` is: a rich world is harder to hold down than a poor
one.

| case | standing | Ithaal (value 5) | Vantic (value 9) |
|---|---|---|---|
| a fresh conquest | −60 | 4.0 | 7.2 |
| someone else's home, settled | −30 | 2.5 | 4.5 |
| unaligned at the start, settled | 0 | 1.0 | 1.8 |
| content | ≥ 20 | 0 | 0 |

These are the figures at a resolve modifier of 0. A resolute power needs fewer
ships to get there.

### Resolve decides how much a warship holds down

`HOLD_PER_RESOLVE` is 0.125, read off **effective** resolve, so terrain,
fixtures, an officer's passive and dissent all reach it, as they reach every
other check. Resolve is the stat whose own description is *"unrest
suppressed"*, and holding a world against its will is exactly that. On the
opening board:

| power | resolve | modifier | a warship holds | fresh conquest of a value-7 world |
|---|---|---|---|---|
| the Vigil | 18 | +4 | **×1.5** | 3.7 battleship-equivalents |
| Arkane | 19 | +4 | ×1.5 | 3.7 |
| the Confederacy | 14 | +2 | ×1.25 | 4.5 |
| Meridian | 10 | 0 | ×1 | 5.6 |
| the Combine | 11 | 0 | ×1 | 5.6 |

So the Vigil holds what it takes with two-thirds of the fleet anybody else
would need. Meridian and the Combine, whose doctrines are trade and money,
are the powers for whom courting is plainly the better road. Arkane's ×1.5
matters little, since it conquers nothing. The Confederacy gets a quarter more,
which helps the weakest power keep what it takes.

**Why resolve and not might.** Might gives the Vigil the same +4, and matches
the battle's arithmetic. But it would make one stat win the Vigil its battles
*and* hold its conquests. The seed exists to prevent that: a test asserts no
two powers share a peak stat and build bias, because a power good at
everything makes every check the same check. Resolve also has only defensive
readers today besides the rally, and this is an active one.

**This is the lever `CLAUDE.md` once rejected, used differently.** Item 123
turned down *"unrest suppressed"* as a cheaper `OCCUPATION_COST` for a resolute
holder, because it discounted an existing cost almost wholly for the Vigil: an
accelerator for whoever is winning. Here it softens a cost this design adds:
every power pays more to hold a conquest than it does today, and the Vigil pays
the least extra. The measurement still has to watch it:
with the rally switched off, the Vigil once ran to nine worlds by turn 100.

## Rising and seceding

Each tick, a held world that is neither content nor held down is **restless**:

- **The garrison deserts.** It does not regrow, and it loses the shortfall a
  turn, rounded up and at least 1.
- **At no garrison, the world secedes.** This is the rule unrest already
  applies, generalised:
  - the world answers to nobody;
  - the rising becomes its militia;
  - the holder's ships withdraw to their nearest holding with no losses, as a
    ceder's do;
  - its standing toward the old holder falls 20.
- **It is public**, and the briefing warns on every restless turn with the
  shortfall and the turns left.

**The unrest event becomes the spark of the same thing.** It is eligible where
a world is not content (today: *never the holder's own*), weighted by the
shortfall, and its slip is this secession. That keeps one way a world rises,
with two triggers: the steady pressure, and the Rim's dice.

## Joining

An independent world joins a power when its standing is at least `JOIN` (60)
and `JOIN_LEAD` (20) clear of the next.

- **Its garrison stays.**
- **`homeFactionId` is unchanged.** So a home world that rose against its
  occupier and rejoins its own power is home again, at +50.
- Other powers' hulls over it stay uninvited, as after a cession.
- It is a fourth way a world changes hands, after an arrival, a cession and
  unrest, and like them it is the reducer's alone.

## The loops this makes

- **Conquest is priced in a standing fleet or in pacification**, against a
  baseline that never forgives a conquered home world. It is a brake on
  whoever is winning: every world taken ties down ships or attention. It
  bites the resolute least, so the Vigil, which conquers by doctrine, keeps
  most of its reach.
- **A rising frees a conquered home world, and it leans +50 toward its old
  power.** Liberation needs no war. The Confederacy, which loses ground most
  often, gets the cheapest way back.
- **An independent world is won by being what it wants**, which is the
  non-violent expansion the defensive and free-trade doctrines have lacked.
- **Influence gets an active reader in holding ground.** The envoy is how a
  persuasive power pacifies what it took.

## What does not change

- **`OCCUPATION_COST` stays keyed on `homeFactionId`.** It prices
  institutions, not mood, and it was tuned on a cliff (decision 4).
- The rally and the span of control are unchanged.
- A cession is unchanged, except that the ceded world's people now have a view.

## What the player sees

- **System tab.** The world's want in one line, its standing with each power
  as a bar, and, on a world you hold, *content* or the force it needs against
  what is there. A restless world says how many turns its garrison has left.
- **Map.** A red ring on a restless world you hold, and a thin ring in the
  colour of whoever an independent world leans toward past 40.
- **Briefing.** Restless worlds first, then joins, risings and anything
  crossing 40 toward you.
- **Help text.** Generated from the want table, so it cannot drift.

## Prompts

- `serializeState` carries each world's want and its standing toward the viewer
  and toward its holder.
- The resolution prompt learns the envoy (*"send an envoy to Neth"*, *"win over
  the people of Torrek"*).
- Standing is moved only by the sources above; narration cannot move it.
- No channel with a world: a world is not a persona.

## Bots

- **`hold`** (every power) — send warships to a restless world it holds before
  the garrison runs out, from the `guardFronts` machinery.
- **`court`** (Meridian, Arkane, the Combine) — meet the wants they can on
  independent worlds they border, and send envoys. Never storm a world they are
  courting; Meridian's `sectorGaps` would otherwise take it on turn 2.
- **`liberate`** (every power) — court its own seceded home worlds first.
- The Vigil and the Confederacy conquer, and hold down what they take.

## Measurement

1. **Joining happens**: at least two of the five join someone by turn 30 with
   events on, and conquest of an independent world still happens.
2. **Secession, outside the harness.**
   - A `secession` sandbox: the player opens holding a conquered home world
     with too little over it.
   - A constructed test board.
   - The first played campaign that conquers and moves on.
3. **The Confederacy and Arkane**: turn-30 nets against the −40 floor, and
   world counts on the four boards, against 6/5/5/5/4.
4. **Sweeps**:
   - `CONTENT` from 10 to 30;
   - the requirement's divisor from 75 to 150;
   - the conquest standing from −40 to −80;
   - `HOLD_PER_RESOLVE` from 0.1 to 0.25, watching the Vigil's world count at
     100 turns.

## Journal

`JOURNAL_VERSION` 17, `LegacyRules.standing`. An older journal replays with no
standing, no secession, no joining, and unrest eligible on the old rule.

## Build order

1. **Standing**: state, baselines, fade and the conquest grievance, displayed
   and moving nothing. Check that it reads sensibly over 100 harness turns.
2. **Content, held down and secession**, with the unrest event regeneralised,
   and the sandbox.
3. **Wants, the envoy and joining.**
4. **Bots, prompts and help text.**

**Size: L**, four slices of about M.

## Decisions

1. **Home ground cannot be driven below content short of conquest.**
   Recommended. Tying it to dissent would charge twice for one decision:
   dissent already costs every stat, and nothing further fires at the cap on
   purpose.
2. **A −30 baseline toward an occupier of someone's home.** Recommended.
   At 0, every conquest heals in about twenty turns and needs nothing after.
3. **Warships only, not garrison**, as force. Recommended, on the measurement
   above.
4. **`OCCUPATION_COST` unchanged.** Recommended. Keying it on standing would
   charge mood twice (force and income) and move a tuned constant in the same
   change.
5. **Public standing.** Recommended.
6. **A rival fleet over a restless world** (a liberator in orbit) speeding the
   rising. Not in the first build.
7. **Which trait scales holding down.** Recommended: effective resolve, at
   0.125 a modifier point. Might gives the Vigil the same +4, but makes one
   stat decide both its battles and its occupations. A war-ethic rule (say,
   `crusading` holds at half) would be a special case for one power.
8. **Goods given to a world.** Not in the first build: it needs a world that
   can hold an asset, which nothing else needs.
