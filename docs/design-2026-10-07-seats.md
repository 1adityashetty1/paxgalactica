# Design: seats — estates, notables, and who answers for a world

`brainstorm-2026-10-02.md` §5.3 (estates), built out into a third class of
person. Commanders command fleets and operatives work in the dark; nobody
**runs a world**. A power's **institutions** — *the Trade Council*, *the fleet
commanders*, *the councils*, *the captains*, the term the refusal card and the
prompts already use — exist only as names a refusal is spoken in, and dissent is
their standing with the leader. This feature leaves them as they are and adds,
beside them:

- three **estates** a power, whose **favour** moves its weakest stats;
- a **seat** on every world with a **notable** in it, who belongs to one of the
  holder's estates, or to none on a world nobody holds;
- **marriage** between notables, across powers and into independent worlds;
- notables held as **wards and prisoners**, by the machinery captured officers
  already use;
- three operations against a notable: **turning**, **killing** and
  **seducing** them.

*Status, 2026-10-08:* **built**, as one feature in one pull request, pinned to
journal version **20** (19 is taken by coalitions and ten given names). The
code is `src/domain/estates.ts` (the shapes, sheets and numbers),
`src/domain/seats.ts` (everything that reads the whole world) and
`src/ui/court.ts` (the Court tab as data); *Settled while building* and
*Measured* at the end record what the build decided and found.

*Revised 2026-10-14, before merge, still version 20:* **the Lists**. A hub's
two seats are named **Governor** and **Chancellor**. Seats are filled only from
a power's **Lists** of waiting notables and stand **empty** until somebody is
appointed; **conquest takes whoever sits a world prisoner**, so the foreign
notable is gone; and **a marriage hands over a ward** — one spouse seated, the
other off the other side's Lists, living at the seated one's court as surety.
The problem it answers: a notable taken prisoner, the world retaken, a new
governor appointed, and then the old one ransomed home had nowhere to go but
the warehouse. The sections below are written to the revision. Operatives
handed home were made to go back on the books by themselves at the same time,
the rule the Lists follow.

## The rules in brief

- **Estates.** Each power has three, one behind each of its **three weakest
  stats**. The two strongest belong to its institutions and no estate moves
  them.
- **Favour**, −100 to 100, is a straight modifier on the estate's stat, by one
  table for every estate. It drifts toward a baseline of **seats** held against
  a fair share and **grants** paid.
- **Seats.** Every world has a Governor; a hub has a Chancellor too. A notable
  acts on its world by its estate's favour: a favoured estate's notables win
  their worlds over, a resentful one's withhold, a bitter one's let their
  worlds go. An empty seat does nothing.
- **The Lists.** Each power's notables waiting for a seat, at least one an
  estate. Every appointment comes off them; nobody on them can be reached by an
  operative.
- **Worlds changing hands.** Conquest takes whoever sits the world prisoner and
  leaves its seats empty for the conqueror to fill off its own Lists.
- **Marriage.** One seated notable and one off the other side's Lists, who goes
  to live at the seated one's court as a ward. With another power it is a
  `marriage` treaty, which is a peace; with an independent world, a declaration
  the world accepts by its standing. A grant to each estate, and a pull on the
  seated spouse's world toward the in-laws. The ward is surety.
- **Wards and prisoners.** A notable can be held as an asset, beside captured
  officers and operatives, and goes back on their own power's Lists the moment
  that power holds them.
- **Operatives.** Subversion turns a notable; assassination kills one;
  seduction is a marriage nobody signed, and its proof breaks a rival's
  marriage.
- **No promotion.** Officers, notables and operatives never move between
  rosters.
- **Dissent is unchanged.**

## Institutions and estates

Three estates per power, authored with the faction sheets, because who a
power's institutions are is character. Each stands behind one of the power's
three weakest base stats; the two strongest belong to its **institutions**.

| power | estates (stat, base) | institutions, no estate |
|---|---|---|
| **Meridian** | Standards & Practices (resolve 9) · the Security Directorate (might 10) · the Creatives (guile 13) | the Board and the Trade Council (industry 16, influence 17) |
| **Iron Vigil** | the Blue Bloods (influence 6) · the Intelligentsia (guile 11) · the Complex (industry 13) | the fleet commanders (resolve 17, might 18) |
| **Ojjul Nar** | the Made Men (might 9) · the Blood Nars (resolve 11) · the Spice Cartel (industry 12) | the old cousins (influence 15, guile 18) |
| **Arkane** | the Shipbreakers (industry 10) · the Bards & Poets (influence 10) · the Sentinels (might 11) | the councils (guile 12, resolve 19) |
| **Drajk** | the Open Hand (industry 7) · the Salt Compact (influence 8) · the Sixteenth (resolve 12) | the korvani, its captains (guile 14, might 15) |

Drajk's are its own covenant words, from its voice: the Sixteenth is the crews'
share and so the crews, the Salt Compact binds the other corsair fleets, and
the Open Hand is the ports given quarter. No estate name collides with an
officer's title, a house, or any term the game already uses.

### Why the weakest stats

**The institutions are already in the game.** Every one a faction sheet names
as refusing its leader stands behind that power's peaks: the Trade Council behind
Meridian's industry and influence, the fleet commanders behind the Vigil's might
and resolve, the old cousins behind the Combine's guile, the councils behind
Arkane's resolve, the captains behind Drajk's might and guile. Dissent is their
voice. They are what the power **is**, and nobody buys them with a stipend.
Estates are everyone else: the interests a power has never been good at
keeping, which is why it is weak in their stats.

**A buff on a peak would be the wrong shape twice over.** It makes the
strongest thing about a power stronger, which widens every gap, and mostly it
is lost to the ceiling: the Vigil's might is 18 and Arkane's resolve 19, so +2
on either is +1 or nothing once clamped at 20. A weak stat is far from the
ceiling, so the whole buff lands.

**So favour moves a power's weaknesses, and only them.** Courted, a weakness is
softened, never erased: the Vigil's influence goes from 6 to 8 at most, still
the worst on the board. Neglected, it gets worse.

**This is a purchase that patches a weakness**, which the fixture design
deliberately made a war aim instead. Three bounds keep it from undoing the
sheets: +2 at most on each weak stat, paid every turn rather than once, and
seats are zero-sum among the three estates, so lifting one weakness by seats
costs another its favour. Whether the rich buy their weaknesses away faster than
the poor is the first thing to measure (see *Measurement*).

## Favour

### What it buys

| favour | the estate's stat |
|---|---|
| 80 or more | +2 |
| 40 to 79 | +1 |
| −39 to 39 | — |
| −79 to −40 | −1 |
| −80 or less | −2 |

Read in `effectiveStats` beside terrain, fixtures, the officer's passive and the
rally — after them and **before dissent**, the place the rally takes — and
clamped 1–20. So it reaches every check, battle, yard, operative contest and
ceiling with no further wiring, exactly as a fixture does.

**Dissent is untouched.** It still rises on a refusal or a defied compulsion and
still comes off every stat. Dissent is how far a leader has strayed from the
power's character; favour is how well the leader keeps its estates. A power can
be run in character and still have starved its Creatives.

### What moves it

Favour drifts a tenth of the gap a turn toward a **baseline**, the shape
standing uses, so nothing is banked and everything has to be kept up:

| term in the baseline | |
|---|---|
| **seats** | `SEAT_FAVOUR` (20) for each seat held above the estate's fair share, −20 for each below, read continuously: a third of a seat over is +7. The fair share is the power's seats divided by three |
| **grants** | `GRANT_FAVOUR` (20) for each grant the estate holds, up to `MAX_GRANTS` (3). A stipend is a grant, and so is a marriage (see *Marriage*) |
| **hated seats** | −10 for each of its notables sitting a world that is not content with its holder — an estate does not enjoy holding down a world for you |

Which seats count where a world has changed hands is settled under *When a
world changes hands*.

With five or six seats and three estates, seats alone move an estate about ±20:
enough to matter, never enough to buff on its own. **Buffs are bought with
grants**, and seats keep the three in balance.

### Grants

A grant is a standing privilege an estate holds. The paid kind is a
**stipend**: `GRANT_COST` (15) credits a turn, on its own `Ledger` line, so
favour is a recurring bill the way fixture upkeep is.

- Made and revoked by declaration — *"grant the Blue Bloods a stipend"* — an
  action, as appointing an officer is.
- **Revoking one** takes the 20 off the baseline and costs an immediate
  `REVOKED_FAVOUR` (15): an estate notices being cut more than it notices being
  paid.

So +1 on a weakness costs two grants (30 a turn) on top of a fair share of
seats; +2 costs three grants and more than a fair share. Against nets of
50–300 a turn that is a real choice, priced against fleets and fixtures.

## Seats and notables

**One seat per world, two on a hub** (strategic value 7 or more): the
**Governor**'s and the **Chancellor**'s (`Notable.seat` 0 and 1). The two act
alike; the names keep them apart, and an appointment fills the office that is
empty. Every power
holds at least one hub on the opening board:

| power | worlds | hubs | seats |
|---|---|---|---|
| Meridian | 4 | Sekkar Gate, Torrek Anchorage | 6 |
| Iron Vigil | 4 | Vantic, Gorrun Deep | 6 |
| Ojjul Nar | 4 | Ilvenn Approach, Shalka | 6 |
| Arkane | 4 | Arkane Prime | 5 |
| Drajk | 4 | Vergesse | 5 |

The worlds most worth fighting over are the ones estates fight over too. A
world that becomes a hub by development opens a Chancellor's seat, empty until
filled; one that falls below 7 keeps the seats it has.

**A notable** is a named person — the same generator as officers and
operatives, with a family name unique in the campaign — with two facts of their
own: **which estate they belong to**, and **whom they are married to**
(`spouseId`). Everything else they do is read off their estate's favour, so a
notable is one record with no rules of its own.

**Every world has a notable, including one nobody holds.** An independent
world's notable belongs to **no estate**: it is the world's own voice, and does
nothing to the world by itself, since there is no favour to read. It is there
to be married, courted and, in a war, turned out. They are generic: drawn from a
sixth name stock for the Rim's unaligned worlds, with ten given names for the
die's twenty faces. The seed gives each of the five unaligned worlds one; a
world that secedes keeps the notable it had.

### Who fills a seat

**A notable is in exactly one place** (`whereabouts`): seated, on its power's
**Lists**, held at another court as an asset, or living on an independent world
it married into.

**The Lists** are a power's notables waiting for a seat. They are not gameplay
entities: no operative can reach anyone on them, and they do nothing. Every
seat a power fills comes off its Lists, and each estate always has someone
listed — `settleCourt`, after every batch and every tick, puts one forward for
an estate with nobody waiting. Who else is on them: notables handed home by
ransom or freed by retaking a world, a governor turned out of a seat for
another estate, a ward whose marriage ended in their favour, and one who lived
abroad and came home.

**A seat on a power's world is never filled for it.** The opening board seats
everyone by default; after that an empty seat stands at **None** until the
holder appoints. Considered and rejected: auto-appointing the vacated estate's
first listed notable. An empty seat is what makes a conquest, and the knife,
cost an action to repair.

| the seat opens because | it |
|---|---|
| a world is conquered | stands empty; whoever sat it is the conqueror's prisoner |
| a notable is killed | stands empty |
| a world becomes a hub | its Chancellor's seat stands empty |
| a world is ceded | stands empty; whoever sat it goes home to the ceder's Lists |
| a world joins a power | is kept by the independent notable, for the estate of its spouse if it married into the power, otherwise the default |
| an independent world's notable is killed | is filled at once with a new voice of its own — nobody appoints for it |

**The default** is the estate whose stat is the world's ground stat
(`WORLD_TYPE_STAT`) — an arid world (might) seats Meridian's Security
Directorate, an earthlike world (influence) the Vigil's Blue Bloods, legible
from the map as a fixture's ground is. Ground of one of the power's peaks has no
estate, and goes to **the estate with the fewest seats**; so does a hub's second
seat when the ground's estate already holds the first. The default seats the
opening board, a joining world, and the bots; the player chooses.

**Appointing is a declaration** — *"appoint Corvan Hale as Governor of
Kalzir"* — `seat_estate { systemId, notable | estate, office? }`, an action.
An empty seat is simply filled. A full one is taken from its sitter — the
estate holding the most seats first — who goes back on the Lists; that changes
the baseline both ways at once, so one estate's gain is visibly another's loss,
and shakes the world: its regard for the holder drops `RESEAT_REGARD` (5). A
married notable's seat cannot be taken, since the marriage stands on it.

### What a notable does on its world

By its estate's favour, one rule for every estate. On a hub each notable does
half, so two notables of different estates can pull a world both ways:

| estate favour | the notable |
|---|---|
| 40 or more | **lifts** the world's regard for its holder `NOTABLE_REGARD` (4) a turn |
| −39 to 39 | nothing |
| −40 or less | **withholds** half the world's income and **lowers** its regard 4 a turn |
| −80 or less, on a world not content | **lets it go**: the world secedes, through `secede`, and the notable leads it as an independent world |

A seceded world then goes wherever standing takes it — it may join a rival, or
come back. **No new way for a world to change hands**: a bitter estate is one
more reason a world rises, read by the rising that already exists.

## When a world changes hands

| event | the seat |
|---|---|
| **conquest** | whoever sits it is taken **prisoner**, a `notable` asset the conqueror holds there; the seats stand empty for the conqueror to fill off its own Lists. A marriage whose seated spouse is taken ends, and its ward, held on the same world, is the conqueror's prisoner too |
| **conquest of an independent world** | its notable has no power behind it and is turned out; a power's notable who married in and lives there is the conqueror's prisoner. The seats stand empty |
| **liberation** | a power retaking a world finds its own people held there, takes them back with it, and they go onto its Lists. The seats are still empty: it appoints |
| **cession** | nobody fought: the ceder's notables go home to its Lists, and any ward of theirs with them |
| **secession** | the notables stay and belong to no estate, the independent world's own; a marriage of theirs ends and its ward goes home |
| **joining** | the independent notable takes the seat for its spouse's estate if it married into the power, otherwise for the default; whoever married in from a power comes home |

**People held on a world taken.** A prisoner or a ward held at a world is an
asset standing there, so it changes hands with the world, whichever way the
world was taken; one of the conqueror's own goes home to its Lists.

## Marriage

Among the first things players reached for. The appraisal prompt's own worked
example is *"I offer my heir in marriage to the Ojjul Combine"*, and the first
live arbiter test was a dynastic marriage ruled exclusive. Seats give it the
people it was missing. **The player has no house, so a power marries through its
notables**.

**One seated, one off the Lists.** Every marriage pairs a **seated** notable
with one off the other side's **Lists**, who goes to live at the seated
spouse's court — as that court's **ward** between powers, or simply on the
world when marrying into an independent one. A marriage never empties a seat.
The bond lives on the people: `Notable.spouseId`, set on both. Every marriage:

- **pulls the seated spouse's world toward the in-laws**: `MARRIAGE_REGARD`
  (30) on its baseline toward the other side. The spouse who moved sits nowhere
  and pulls nothing, so the pull runs one way — the giver's payoff for handing
  over a hostage;
- **is a grant paid in alliance** to each spouse's estate: `GRANT_FAVOUR` on its
  baseline, within `MAX_GRANTS`, at no credits.

### Between powers: the `marriage` treaty

A treaty type of its own: `terms.spouses` names the two, is required on a
marriage and refused on every other type (`illegal_value`); `terms.ward` is
worked out by the engine — the one off the Lists — and must be them if named.
It needs the other power's consent, so it is made in a channel and recorded by
extraction, as every treaty is.

- **It is a peace.** `marriage` joins `PEACE_TREATIES` and `TRUCE_TREATIES`: a
  marriage signed between powers at war leaves a truce.
- **The ward is surety.** The seated spouse's power — the **receiver** — holds
  the ward at the seated spouse's world. That is what a hostage is for:

  | the marriage ends because | the ward |
  |---|---|
  | the **giver** breaks it, or attacks the receiver | stays, the receiver's **prisoner** |
  | the **receiver** breaks it, or attacks the giver | is **gone** from play |
  | the seated spouse dies, or their affair is published | goes **home** to the giver's Lists |
  | the ward's own affair is published | stays, the receiver's **prisoner** |
  | a third power takes the seated spouse's world | is that power's **prisoner**, as the seated spouse is |
  | the receiver questions the ward | is gone, a broken pact |

  And while it holds, a ward is **leverage**: their power's concession budget
  toward the receiver rises as for a favour owed (`wardsHeld`).
- **`exclusive`** works as for any treaty.
- **Supersession keys on the spouses.** Two marriages between the same powers
  are two marriages; goodwill on signature is paid once per pair and type.

### Into an independent world

**A declared action, and the world consents by its standing.** *"Marry Corvan
Hale off our Lists to the notable of Var Hollow"* —
`propose_marriage { notable, systemId }`, one of the turn's two actions. No
channel; the world's regard for you is its answer, at `MARRIAGE_CONSENT_REGARD`
(40) or better, its notable unmarried. Yours goes to live there
(`Notable.livesAt`), off the Lists.

- **It does not join on the marriage alone**; a marriage makes a courtship
  stick, 30 ahead and not out of reach.
- **When it joins you**, its notable takes a seat for your spouse's estate and
  yours comes home to the Lists. **When it joins anyone else**, yours comes home.
- **Taken by force**, its notable is turned out; yours comes home if you took
  it, and is the conqueror's prisoner if someone else did.
- **Its notable killed**, yours comes home.

## Wards and prisoners

Captured officers and operatives already become **assets**: held at the world
where they were taken, pointed at by `Asset.commanderId` or `agentId`, worth
most to the power that lost them, ransomed, traded, ceded or questioned with no
second mechanism. Notables join them: kind `notable`, pointed at by
**`Asset.notableId`**, the third twin, under the same people-standing prices.

| held as | how |
|---|---|
| **a ward** | handed over by a marriage, held by the receiver at the seated spouse's world |
| **a prisoner** | taken with a conquered world, or kept when a marriage ends against the giver |

**Brought home** — handed back, or freed by retaking the world they are held on —
a notable goes onto their own power's Lists at once, with no action: the problem
the Lists exist to solve. A captor never seats someone else's notable.

## Operatives

Three missions reach a notable. Each names them, matched by name as officers
are. **Nobody on the Lists is a target, nor is a prisoner**: they are under
guard, and their holder decides their fate. **A ward can be seduced** at the
court they live at, and nothing else.

| mission | aimed at a notable |
|---|---|
| **subversion** | a new effect, `turn_notable`: while it works, the notable acts as if its estate stood at −40 — withholding, souring its world — whatever the estate's real favour. A local threat, not a lever on the whole estate. Contested as incitement is (`counterIntelAt`) |
| **assassination** | kills them (below) |
| **seduction** | new: a marriage nobody signed (below) |

A watcher on a world shows its seat in full; `INTEL_DELIVERS` (40) on a power
shows its estates' favour in bands.

### Assassination

Everything an assassination is now — 150 credits, one attempt either way, 9 in
20 exposure, the target power's regard — and the kill takes
`ASSASSINATION_KILL_ROLL` (17+) on a roll of its own, as for an officer. That
roll is the whole of a notable's protection: an officer can sail away from the
knife, and a seated notable never leaves its world.

| the notable killed | the seat | and |
|---|---|---|
| **a power's** | stands **empty** until the holder appoints | the world's regard for its holder drops 10 in the confusion, and the estate has lost a seat until it is refilled |
| **an independent world's** | a new generic notable | if the operative is caught, the world's regard for its power drops 25, the price of conquering an independent world |

Whoever is killed: their marriage is voided and its ward goes home, and any
subversion or seduction aimed at them ends.

### Seduction

The other early example: a Combine playtest's *"seduce a Drajk-affiliated
captain at Tulgarn into an informal understanding"*. The arbiter routed it to a
watcher and a two-party `quiet_understanding` commitment: the right instinct and
the wrong shape, because nothing in it was the person. With notables it is a
mission of its own: **`seduction`**, effect `seduce`.

**A seduction is a marriage nobody signed.** It does what a marriage does,
covertly, and only while it lasts:

- **The pull.** The notable's world's regard for the seducer's power rises
  `SEDUCTION_REGARD` (3) a turn, which settles about 30 above its baseline, a
  marriage's worth, and fades a tenth a turn once the seduction ends.
- **Pillow talk.** The seducer gains intel on the notable's holder as a watcher
  on that world does.
- **Proof.** After `SEDUCTION_PROOF_TURNS` (3) turns at work, the seducer files
  an **affair**, a new secret kind about the holder. It is live while the
  seduction runs and for `DARK_PROOF_TURNS` (6) after it ends, so any hook
  built on it lapses with it.

Published, an affair is a scandal at the holder's court: the notable's estate
loses `AFFAIR_FAVOUR` (15) at once, and the world's regard for its holder drops
10. **If the notable is married, the marriage is voided**, and the in-laws'
regard for the strayer's power drops `AFFAIR_RESENTMENT` (10). A seated
spouse's affair sends the ward home; a ward's own leaves them the court's
prisoner — the affair is about the ward's power, and so is the scandal. Seduction is how a
rival's marriage is broken from outside. Blackmail spends the affair for a
strong hook on the holder, as any secret.

Priced and contested as incitement is: `AGENT_COST` 80, sabotage's exposure
(3 in 20), persistent, against `counterIntelAt`. **Caught**, the operative is
taken as any operative is, and the holder buries the affair: there is no public
scandal, and the seducer's power pays what a caught operative costs.

Only a notable can be seduced. An officer turned by a seducer is the turned
admiral this design rules out, and an operative has no public face to court.

## No promotion

Other games let a general become a governor or a governor take a fleet. This
one does not, for simplicity — three rosters, three ladders — and the fiction
says why. In every power the sword and the seat are kept apart, for its own
reason:

| power | why an officer is never seated, nor a notable given a fleet |
|---|---|
| **Meridian** | The Charter forbids it. An officer who held a seat could send the fleet to collect on it; a notable who commanded a squadron could enforce their own contracts. The Board audits the two separately, and has since the founding. |
| **Iron Vigil** | The Codes of the old Legions. Marshals who sat the worlds they took are what broke the Empire; a Legate who takes a seat is a usurper by definition, and the fleet commanders would say so. |
| **Ojjul Nar** | A seat is a house's, by blood. An Enforcer is the Family's hand, and a hand does not sit; an office cannot marry into a seat, and a house does not lend its heir to the fleet. |
| **Arkane** | Different councils choose them. The fleet councils elect wardens and the world councils seat their own, and no council may choose for the other. A warden who wanted a world would have to stand for it, and lose the fleet. |
| **Drajk** | Crews follow captains who will not put down roots. A Korvan Lord who took a seat would have grown roots by morning, and the crew would elect someone else before the tide. |

And across all five: **an operative is never seated** — their value is that
nobody knows their face, and a seat is public — and **a captured enemy officer
is never seated**, nor **a held notable by its captor**: a prisoner is worth a
ransom, and a turned admiral is a far larger idea than this design reaches.

Mechanically: separate rosters and no op that moves a person between them.
`seat_estate` appoints only off the power's own Lists — the same roster;
`recruit_commander` and `recruit_agent` refuse a notable. A declared *"make
Marshal Galba lord of Kalzir"* is **inadmissible** at the arbiter, quoting the
power's reason — the appraisal prompt carries the table — and costs nothing, as
an inadmissible ruling does.

## What the player sees

- **A Court tab**, beside Command and Agents:
  - the three estates, with favour as a bar, the stat it is moving, their seats
    and grants, and the baseline each is drifting toward; *grant a stipend* and
    *revoke* buttons;
  - marriages: each married notable, its spouse and their side; a *propose a
    marriage* button that opens a channel with the offer written, as a sale
    does, or for an independent world at 40 or better writes the declaration on
    the command line;
  - held: your notables abroad as wards or prisoners, and the notables you hold;
    an *ask for them back* button, as Command has for officers.
- **System tab:** a world's seat or seats — the notable, the estate, its spouse,
  what it is doing to the world — and on your own a *give this seat to…*
  button. A rival's world shows the estate that sits it; an independent world
  shows its notable and whether it would accept a match from you.
- **Factions panel:** the player's stat rows already show the base and what
  moves it; estates join terrain, fixtures and the rally there.
- **Briefing:** an *Estates* group — an estate crossing a threshold, a seat
  withheld or let go, a conquered notable still sitting, a notable killed, a
  marriage made or voided, an affair published.
- **Help:** a `:help court` page, with the no-promotion table.

## Prompts

- `serializeState` lists the viewer's estates with favour and grants, adds each
  world's seat to its `people:` line, and gives each independent world's
  standing with the viewer.
- **Personas** see their own notables by estate and world, so they can offer
  one; the other power's, which are public as seats are; and any wards either
  side holds.
- `appraisal.md`:
  - a grant, a revocation, a reseating and a marriage into an independent world
    are actions; the last is inadmissible below `MARRIAGE_CONSENT_REGARD`;
  - a marriage with another power is a negotiation between notables, and the
    worked example changes from *"my heir"* to a notable;
  - *"seduce"* routes to the `seduction` mission;
  - promotion is inadmissible, with the table.
- `extraction.md`: the `marriage` row, with `terms.spouses` and `terms.ward`;
  each side's notable is grounded in that side's own concession.
- **Refusals keep their speakers.** The institutions that refuse a leader are
  the ones the sheets already name, never an estate. An estate is voiced where
  favour shows: a notable withholding, a stipend revoked.

## Bots

- **`keepCourt`**, in order of need: **fill** every empty seat on its worlds
  off its Lists for the default estate, one estate at a time in a batch;
  **placate**, moving an unmarried notable's seat from the
  best-favoured estate to the worst when the worst falls to −40; **grant** the
  estate behind its weakest stat a stipend, up to `BOT_MAX_STIPENDS` (2), while
  standing income covers `BOT_STIPEND_COVER` (4) times the stipends, and revoke
  one when it runs at a loss;
- **`workNotables`** — a power at effective guile `BOT_SEDUCER_GUILE` (16),
  which is the Combine, turns a rival's notable on a bordering world when at
  war and seduces it when not, one at a time — never on a power's own home
  ground, and not at a world that took one of its operatives in the last
  `BOT_SEDUCER_BURNED_TURNS` (10). Gated on war or no warmth, as incitement is;
- **marriage**, brokered in `brokeredAccords` — two NPC powers on good terms
  (`EXCHANGE_STANDING`, 20, both ways), at peace, neither barred by its
  compulsions (`barsPeaceWith`), each with an estate below 0, marry those
  estates' notables, one marriage per pair at a time;
- **`court`** gains a match — a courting ethic marries into an independent world
  it is courting once the world will accept, with its worst-favoured estate's
  notable.

## Measurement

Against the four harness boards (30 and 100 turns, with and without events),
`pnpm balance [turns] --no-seats` as the control:

- estate favour over time, per power; how often any estate crosses ±40;
- how far grants lift each power's weakest stat, and whether the rich buy
  theirs away faster than the poor. A flat fixture price measured regressive
  for exactly this reason; if grants do the same, the Nth grant costs N ×
  `GRANT_COST`, as fixture upkeep rises with the count;
- seats withheld and worlds let go; conquered notables reseated, and how fast;
- marriages made and how long they last; independent worlds married into, and
  how many then join; affairs published, and marriages they end;
- notables killed, held as wards and prisoners, and how many come home;
- the boards. A stat buff is a might buff is a battle; sweep `GRANT_FAVOUR`,
  `GRANT_COST` and the thresholds before settling them, and check every
  property `tests/balance.test.ts` asserts.

## Journal

Pinned to version **20**: `createSeedState`'s `seats` seats the opening board,
independent worlds included, and `LegacyRules.seats` runs everything in this
document. A world with no seat recorded is how the tick and the browser know a
campaign predates it, the rule standing set with `regard`.

## Build order

One feature in one pull request; this is the order the work is done in, each
step tested before the next:

1. Estates on the faction sheets, on the three weakest base stats — a test
   holds that no estate sits on a power's top two; favour, the drift and its
   baseline; the stat table in `effectiveStats`.
2. Seats and notables, the independent worlds' included: one per world and two
   on a hub, who fills a seat, what a notable does by favour.
3. Grants and reseating: ops, ledger line, revocation.
4. Worlds changing hands: conquest, foreign notables, cession, liberation,
   secession, joining.
5. Marriage: the bond, the `marriage` treaty and `terms.spouses`, the regard and
   grant terms, peace; `propose_marriage` into an independent world; how a
   marriage ends.
6. Wards and prisoners: `Asset.notableId`, `terms.ward`, prisoners on
   reseating, `seat_estate` with `fromAssetId`, the people-standing rule.
7. Operatives: `turn_notable`, assassination of a notable, seduction and the
   affair, the watcher's view.
8. The no-promotion guards and table.
9. UI, prompts, help; bots; measure.

## Settled while building

- **Favour starts at 0** and drifts to its baseline from the first turn.
- **Withheld income is lost to everyone**: a notable who will not collect for
  you is not collecting for themselves. A `Ledger.withheld` line, and
  `Ledger.stipends` for what the estates are paid.
- **A notable's id is its family name** (`nob-galba`). Family names are never
  reused in a campaign, so an id never is either, and a secret or an asset
  pointing at a dead notable can never come to point at a living one.
- **A held notable remembers the world they left** (`Notable.homeId`), and a
  marriage's pull goes on there while they are held.
- **A notable coming home may take a seat their own estate already holds**: the
  one sitting it stands aside.
- **Marriages and their treaties are kept in step each tick**: a treaty whose
  spouses are no longer wed is voided, and a bond between two powers'
  notables with no live treaty under it ends — which is how an attack on the
  in-laws, breaking the treaty as any peace is broken, ends the marriage.
- **An operative aimed at an independent world's notable** has no holder to
  catch it: on a bad roll it is turned off the world, and a knife caught there
  costs its power `RIM_WATCHES_REGARD` (25) with the world.
- **The fleetlab arena keeps no court**, for the reason it keeps no regard.

## Measured

`pnpm balance [turns] [--no-events] [--no-seats]`. All four boards — 30 and
100 turns, with and without events — read **5/5/6/5/4 with the court and
without it**, as they did before. Every property `tests/balance.test.ts`
asserts holds. The bots pay stipends to their weakest estates: the Vigil's
Blue Bloods reach 56 (+1 influence) and end at 39–47, the Combine's Made Men
reach 47 (+1 might), Meridian's Standards & Practices 31. The lowest any
estate falls is −23, so no world is let go. One bot marriage forms in each run
(the Combine and the Confederacy, on turn 2), and over 100 turns the courting
powers make four matches with independent worlds they are courting, which
then join them as they would have anyway, sooner.

**The first seducer rule was too wide.** At effective guile 14 the Confederacy
and Meridian joined the Combine, sent operatives at the Vigil's home ground
every few turns and lost most of them; at 100 turns without events the
Confederacy fell to two worlds and the Vigil reached eight. At 16, away from
home ground and off a world that just took one of its people, every board is
back to 5/5/6/5/4. A harness run is about a tenth slower with the court.

## Later

- **More grants.** A charter (a share of a world's income), an exemption, a
  council seat — typed, as order effects are, once one kind has been measured.

## Decisions

1. **One kind of person in a seat.** There are no governors and no houses; a
   seat holds a notable, and a notable belongs to an estate, or to none on a
   world nobody holds.
2. **Estates give straight buffs and debuffs**, by one table for all of them,
   on the power's three weakest stats, one each. The two strongest are the
   power's institutions, which dissent speaks for, and no estate moves them. No
   estate-specific rules.
3. **Dissent is unchanged.** Estates are a separate layer beside it.
4. **One seat per world, two on a hub.** Every power holds at least one hub.
5. **Estates want seats; buffs are bought with grants.** Favour drifts toward a
   baseline of seats held and grants paid, so it is kept up rather than banked.
6. **No new way for a world to change hands.** A bitter estate lets a world
   rise through the secession that exists.
7. **Conquest takes whoever sits a world prisoner**, and its seats stand empty
   until the conqueror appoints off its Lists. (The first build left a foreign
   notable working against the conqueror; the Lists revision replaced it.)
8. **No promotion between rosters**, explained in each power's own terms, and
   enforced by having no op that does it.
9. **A power marries through its notables**: one seated, one off the other
   side's Lists who lives at the seated one's court. Between powers it is a
   `marriage` treaty, which is a peace, and the one who moved is a ward whose
   fate turns on who ends it; into an independent world it is a declaration the
   world accepts by its standing. A grant to each estate, and a pull on the
   seated spouse's world toward the in-laws.
10. **A notable can be held**, as a ward or a prisoner, by the asset machinery
    captured officers use: `Asset.notableId` beside `commanderId` and
    `agentId`.
11. **A killed notable's seat stands empty** on a power's world until it
    appoints; an independent world finds a new voice at once. The kill needs
    17+, because a notable cannot run.
12. **Seduction is a marriage nobody signed:** the same pull, covertly and while
    it lasts, and the proof that breaks a rival's marriage.
13. **It ships as one feature**, in one journal version.
14. **The Lists** (2026-10-14): every seat a power fills comes off them, each
    estate always has someone on them, and nobody on them is a mark.