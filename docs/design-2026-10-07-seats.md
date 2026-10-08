# Design: seats — estates, notables and who answers for a world

`brainstorm-2026-10-02.md` §5.3 (estates), reworked into a third class of
person. Commanders command fleets and operatives work in the dark; nobody
**runs a world**. A power's **institutions** — *the Trade Council*, *the fleet
commanders*, *the councils*, *the captains*, the term the refusal card and the
prompts already use — exist only as names a refusal is spoken in, and dissent is
their standing with the leader. This design leaves them as they are and gives
each power three **estates** beside them, gives
every held world a **seat** with a **notable** in it, and makes each notable
belong to an estate. Which estate sits which world is the power's politics.

*Status, 2026-10-07:* proposed. Nothing built. Journal version **20** if built
(19 is taken by coalitions and ten given names).

*Revised the same day.* The first draft had two kinds of seat-holder — a local
**notable** with its own view and a **governor** sent from the capital who had
none — and **houses** as the families behind notables. Two kinds of person in
one seat, behaving by different rules, is a schema that splits in two, so both
are gone: there is one kind of person, the notable, and what differs between
seats is which **estate** it belongs to. Estates give straight buffs and
debuffs, by one rule for all of them, rather than estate-specific rules.
**Dissent is unchanged.**

*Revised again.* Estates sit on a power's **three weakest stats**, one each,
not on its strongest. A power's peaks belong to its institutions, which no
estate moves (see *Why the weakest stats*).

*And again.* **Marriage** and **seduction** are in the design, not left for
later: a power marries through its notables, and a seduction is the covert
version of the same bond. **Independent worlds have notables too**, so a power
can marry into one, and **a notable can be held** — a ward sent abroad, or a
prisoner — through the asset machinery captured officers already use.

## The rule

- Each power has **three estates**, one behind each of its **three weakest
  stats**, and each has a **favour**, from −100 to 100. The two strongest stats
  have no estate.
- **An estate's favour is a straight modifier on its stats**, by one table for
  every estate. That is what a player gets for keeping an estate happy, and
  what it costs to neglect one.
- Every world a power holds has **one seat**; a **hub** (strategic value 7 or
  more) has **two**. Every seat has a **notable** in it, and every notable
  belongs to one of the holder's estates.
- **Estates want seats.** Favour drifts toward a baseline set by how many seats
  an estate holds against its fair share, plus what it has been granted.
  Seating an estate's notable raises its favour; unseating one lowers it.
- A notable does on its world what its estate's favour says: a favoured
  estate's notables win their worlds over, a resentful one's withhold, and a
  bitter one's let their worlds go.

## Estates

Three per power, authored with the faction sheets, because who a power's
institutions are is character. Each stands behind one of the power's three
weakest base stats; the two strongest belong to its **institutions**.

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

**A buff on a peak was the wrong shape twice over.** It made the strongest
thing about a power stronger, which flattens nothing and widens every gap, and
mostly it was lost to the ceiling: the Vigil's might is 18 and Arkane's resolve
19, so a +2 on either was +1 or nothing once clamped at 20. A weak stat is far
from the ceiling, so the whole buff lands.

**So favour moves a power's weaknesses, and only them.** Courted, a weakness is
softened, never erased: the Vigil's influence goes from 6 to 8 at most, still
the worst on the board. Neglected, it gets worse. The peaks never move by
estates at all.

**This is a purchase that patches a weakness**, which the fixture design
deliberately made a war aim instead. Three bounds keep it from undoing the
sheets: +2 at most on each weak stat, paid every turn rather than once, and
seats are zero-sum among the three estates, so lifting one weakness by seats
costs another its favour. Whether the rich buy their weaknesses away faster than
the poor is the first thing to measure (see *Measurement*).

### What favour buys

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
ceiling with no further wiring, exactly as a fixture does. It is the whole
answer to *"what does favour get me"*: one of the power's weaknesses, up or
down.

**Dissent is untouched.** It still rises on a refusal or a defied compulsion and
still comes off every stat. Estates are a second, separate layer: dissent is
how far a leader has strayed from the power's character, favour is how well
the leader keeps its estates. A power can be run in character and still have
starved its Creatives.

### What moves favour

Favour drifts a tenth of the gap a turn toward a **baseline**, the shape
standing uses, so nothing is banked and everything has to be kept up:

| term in the baseline | |
|---|---|
| **seats** | `SEAT_FAVOUR` (20) for each seat held above the estate's fair share, −20 for each below. The fair share is the power's seats divided by three |
| **grants** | `GRANT_FAVOUR` (20) for each grant the estate holds (below) |
| **hated seats** | −10 for each of its notables sitting a world that is not content with its holder — an estate does not enjoy holding down a world for you |

With five or six seats and three estates, seats alone move an estate about ±20:
enough to matter, never enough to buff on its own. **Buffs are bought with
grants**, and seats keep the three in balance.

### Grants

A grant is a standing privilege an estate holds, paid for every turn, so
favour is a recurring bill on the ledger the way fixture upkeep is. One kind
for every estate, by one rule:

- **A stipend**: `GRANT_COST` (15) credits a turn, its own `Ledger` line.
  Each grant adds `GRANT_FAVOUR` to the estate's baseline, up to `MAX_GRANTS`
  (3) per estate.
- Made and revoked by declaration — *"grant the Blue Bloods a stipend"* —
  an action, as appointing an officer is. **Revoking one** takes the 20 off the
  baseline and costs an immediate `REVOKED_FAVOUR` (15): an estate notices being
  cut more than it notices being paid.

So +1 on a weakness costs two grants (30 a turn) on top of a fair share of
seats; +2 costs three grants and more than a fair share. Against nets of
50–300 a turn that is a real choice, priced against fleets and fixtures.

## Seats and notables

**One seat per world, two on a hub.** Every faction holds at least one hub on
the opening board:

| power | worlds | hubs | seats |
|---|---|---|---|
| Meridian | 4 | Sekkar Gate, Torrek Anchorage | 6 |
| Iron Vigil | 4 | Vantic, Gorrun Deep | 6 |
| Ojjul Nar | 4 | Ilvenn Approach, Shalka | 6 |
| Arkane | 4 | Arkane Prime | 5 |
| Drajk | 4 | Vergesse | 5 |

The worlds most worth fighting over are the ones estates fight over too. A
world that becomes a hub by development opens a second seat; one that falls
below 7 keeps the seats it has until one comes free.

A notable is a named person — the same generator as officers and operatives,
with a family name unique in the campaign — whose only fact of their own is
**which estate they belong to**. Everything else they do is read off that
estate's favour, so a notable is one record with no rules of its own.

### Independent worlds have notables

Every world has a notable, including one nobody holds. An independent world's
notable belongs to **no estate**: it is the world's own voice, and it does
nothing to the world by itself, since there is no favour to read. It is there
to be married, courted and, in a war, taken.

They are **generic**: drawn by the same `drawPerson`, from a sixth name stock
for the Rim's unaligned worlds, with ten given names for the die's twenty faces
and family names unique in the campaign as everyone's are. The seed gives each
of the five unaligned worlds one; a world that secedes keeps the notable it
had.

### Who fills a seat

A seat is never empty. Whenever one opens — at the seed, on a conquest, a
joining, a world becoming a hub, a notable killed — it is filled by default:

1. **the estate whose stat is the world's ground stat** (`WORLD_TYPE_STAT`):
   an arid world (might) seats Meridian's Security Directorate, an earthlike
   world (influence) the Vigil's Blue Bloods. Legible from the map, as a
   fixture's ground is;
2. otherwise — ground of one of the power's peaks, which has no estate — **the
   estate with the fewest seats**.

**Reseating is a declaration** — *"give Kalzir to the Complex"* —
`seat_estate { systemId, estateId }`, an action. It changes the baseline both
ways at once, so one estate's gain is visibly another's loss, and it shakes the
world: its regard for the holder drops `RESEAT_REGARD` (5). A hub's second seat
is chosen the same way.

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

## Conquest, cession, secession, joining

| event | the seat |
|---|---|
| **conquest** | the conquered notable stays, still of the **old holder's** estate: a **foreign notable**, which acts for its new holder as an estate at −40 does (withholds, lowers regard) and counts toward its old estate's seats. Reseating it is the conqueror's first act of government |
| **liberation** | a power retaking its own world finds its own notable still in the seat, and they count for it again at once |
| **cession** | as a conquest without the taking |
| **secession** | the notable stays and belongs to no estate; it is the independent world's notable |
| **joining** | the independent notable takes the seat for the estate of its spouse if it married into the power, otherwise for the default estate; the people chose, and their notable came with them |

A foreign notable is the old power's fifth column without any special rule: it
still counts as a seat of the old power's estate, so that estate's favour does
not fall at once when the world is lost — and the old power has every reason to
take it back.

## Marriage

Among the first things players reached for. The appraisal prompt's own worked
example is *"I offer my heir in marriage to the Ojjul Combine"*, and the first
live arbiter test was a dynastic marriage ruled exclusive. Today it lands as an
exclusive treaty that names nobody, so it is worth only what a treaty is. Seats
give it the people it was missing. **The player has no house, so a power
marries through its notables**: *"offer the Blue Bloods' notable at Vantic in
marriage to the Combine"*.

**A treaty type of its own, `marriage`**, the shape `coalition` took:
`terms.spouses` names one notable of each party, is required on a marriage and
refused on every other type (`illegal_value`). It needs the other power's
consent, so it is made in a channel and recorded by extraction, as every treaty
is. A separate type was argued against when a marriage named nobody, because it
would carry no mechanics another type lacked. With spouses it carries five:

- **One spouse each.** A notable already married cannot marry again. A power
  may marry several of its notables into several powers. `exclusive` still
  works as it does now: the arbiter may rule that one marriage forecloses any
  other with anyone.
- **The in-laws are family to the world.** Each spouse's world adds
  `MARRIAGE_REGARD` (30) to its baseline toward the other power, so its standing
  with the in-laws drifts up and stays there while the marriage stands.
- **A marriage is a grant paid in alliance.** It counts as one of the estate's
  grants: `GRANT_FAVOUR` on its baseline, within `MAX_GRANTS`, at no credits.
  What it costs instead is the peace.
- **It is a peace.** `marriage` joins `PEACE_TREATIES` and `TRUCE_TREATIES`:
  attacking the in-laws breaks it, priced as a broken pact, and a marriage
  signed between powers at war leaves a truce. Ending a war with a wedding is
  the oldest settlement there is.
- **A spouse never works against the in-laws.** A married notable whose world
  the in-laws conquer is not a foreign notable to them: it acts as if its
  estate stood at 0, not −40. A marriage is the one path to a conquest that
  does not sour.

| it ends when | how | cost |
|---|---|---|
| a party repudiates it | `break_treaty`, a divorce | a broken pact's price; the estate loses the grant and takes `REVOKED_FAVOUR` |
| either spouse dies | voided, nobody's fault | the estate loses the grant |
| an affair is published | voided (see *Seduction*) | the estate loses the grant; the betrayed in-laws resent the strayer's power |

**What it does to a world that lets go.** A seceded world keeps its notable,
and its notable keeps its marriage, so its standing with the in-laws stays 30
higher. `JOIN_REGARD` is 60, so a bitter estate's world is far likelier to
join the in-laws than anyone else, and their envoys have less to do.

**Supersession keys on the spouses.** A marriage is neither superseded by
another treaty between the same pair nor supersedes one, so two marriages
between the same powers are two marriages. Goodwill on signature is paid once
per pair and type, as now, so a second marriage between the same powers buys
standing only through its estates and worlds.

**The bond lives on the people.** `Notable.spouseId`, set on both, is the one
record of who is married to whom: a pointer, as `Asset.commanderId` is. A
`marriage` treaty is how two powers agree to it, and voids when the bond ends;
breaking the treaty ends the bond. A marriage into an independent world (below)
has no treaty, because there is nobody to sign one, and is the bond alone.

### Into an independent world

**A declared action, and the world consents by its standing.** *"Marry the
Security Directorate's notable to the notable of Var Hollow"* —
`propose_marriage { notable, systemId }`, one of the turn's two actions. No
channel, since an independent world has no persona; its regard for you is its
answer. At `MARRIAGE_CONSENT_REGARD` (40) or better, and its notable unmarried,
it accepts. Below, the arbiter rules it inadmissible and it costs nothing, the
way a world that will not have you is a fact rather than a roll.

- **The pull is the same.** The world adds `MARRIAGE_REGARD` (30) to its
  baseline toward you, so its standing settles 30 higher than it otherwise
  would and stays there. It does not join on that alone: `JOIN_REGARD` is 60,
  and the rest is envoys and what the world wants, as now. A marriage makes a
  courtship stick.
- **The grant is the same.** Your notable's estate counts it as a grant.
- **When it joins you**, its notable takes a seat for **your spouse's estate**:
  the estate that made the match gets the world. The marriage is then within
  one power and does nothing more.
- **There is no peace to break**, since there is no treaty. Attacking a world
  you married into ends the marriage and costs what storming any world costs.
  If you take it anyway, its notable does not sour for you, as any spouse's
  does not.
- **Rivals can still court it.** A rival's envoys and its want met still move
  its standing toward them; a marriage puts you 30 ahead, not out of reach.

## Wards and prisoners

Captured officers and operatives already become **assets**: an `officer` or
`operative` held at the world where they were taken, pointed at by
`Asset.commanderId` or `agentId`, worth most to the power that lost them,
ransomed, traded, ceded or questioned with no second mechanism, and brought
home by `recruit_commander` or `deploy_agent` with `fromAssetId`. Notables join
them: kind `notable`, pointed at by **`Asset.notableId`**, the third twin.

A notable is held in two ways:

| how | what happens |
|---|---|
| **a ward**, by marriage | a `marriage` treaty may name one spouse in `terms.ward`. That notable leaves its seat and goes to live at the in-laws' court, a `notable` asset they hold at their best world. Its seat refills **for the same estate**, so the estate loses nothing by the match. The ward is surety: the treaty may carry `voidsOn: asset_lost` on it, and if its own power breaks the marriage, the in-laws are holding its notable |
| **a prisoner**, by reseating | a conqueror that reseats a foreign notable takes the displaced notable prisoner, held at that world. Before, reseating drew a new notable and the old one went nowhere |

What the holder can do is what it can do with a captured officer, priced the
same way: hand them home (`REPATRIATION_GOODWILL`), sell them to anyone else
(`TRAFFICKING_RESENTMENT`), or question them (`INTERROGATION_RESENTMENT`) for a
dossier. **A notable is a person**, so `notableId` joins `commanderId` and
`agentId` in the people-standing rule. A ward questioned is a marriage
betrayed: the treaty is broken by the holder, at a broken pact's price.

**Brought home**, a notable goes back into a seat for its own estate by
`seat_estate` with `fromAssetId`, as an officer goes back into post. Only your
own: a held notable is never seated by its captor.

A married notable taken prisoner stays married; the marriage's pull on its home
world goes on while it is held. An independent world's notable displaced by a
conquest is released, not held: there is no power to ransom it to.

## Seduction

The other early example: a Combine playtest's *"seduce a Drajk-affiliated
captain at Tulgarn into an informal understanding"*. The arbiter routed it to a
watcher and a two-party `quiet_understanding` commitment. That was the right
instinct and the wrong shape, because nothing in it was the person. With
notables it is a mission of its own: **`seduction`**, effect `seduce`, aimed at
a notable by name (matched as officers are).

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
regard for the holder drops `AFFAIR_RESENTMENT` (10). Seduction is how a
rival's marriage is broken from outside. Blackmail spends the affair for a
strong hook on the holder, as any secret.

Priced and contested as incitement is: `AGENT_COST` 80, sabotage's exposure
(3 in 20), persistent, against `counterIntelAt`. **Caught**, the operative is
taken as any operative is, and the holder buries the affair: there is no public
scandal, and the seducer's power pays what a caught operative costs.

Only a notable can be seduced. An officer turned by a seducer is the turned
admiral this design rules out, and an operative has no public face to court.

## Operatives

Two existing missions reach a notable, and seduction (above) is new:

| mission | aimed at a notable |
|---|---|
| **subversion** | a new effect, `turn_notable`: while it works, the notable acts as if its estate stood at −40 — withholding, souring its world — whatever the estate's real favour. A local threat, not a lever on the whole estate. Contested as incitement is (`counterIntelAt`) |
| **assassination** | can name a notable, matched by name as officers are. The seat refills by default the same tick; the world's regard for its holder drops 10 in the confusion, and the estate loses the seat to nobody, so its favour does not move. A married notable's marriage is voided |
| **seduction** | see *Seduction* |

A watcher on a world shows its seat in full; `INTEL_DELIVERS` (40) on a power
shows its estates' favour in bands.

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
`seat_estate` names an estate and draws a new notable, or brings one of the
power's own notables home from captivity (`fromAssetId`) — the same roster;
`recruit_commander` and `recruit_agent` refuse a notable. A declared *"make
Marshal Galba lord of Kalzir"* is **inadmissible** at the arbiter, quoting the
power's reason — the appraisal prompt carries the table — and costs nothing, as
an inadmissible ruling does.

## What the player sees

- **A Court tab**, beside Command and Agents: the three estates with their
  favour as a bar, the stats it is moving, their seats and grants, and the
  baseline each is drifting toward. Draft buttons: *grant a stipend*, *revoke*.
- **System tab, a world you hold:** its seat or seats — the notable, the estate,
  what it is doing to the world — and a *give this seat to…* draft button. A
  rival's world shows the estate that sits it.
- **Factions panel:** the player's stat rows already show the base and what
  moves it; estates join terrain, fixtures and the rally there.
- **Court tab, marriages:** each married notable, its spouse and their power,
  and a *propose a marriage* button that opens a channel with the offer
  written, as a sale does — or, for an independent world at 40 or better,
  writes the declaration on the command line.
- **Court tab, held:** your notables held abroad, as wards or prisoners, and
  the notables you hold; an *ask for them back* button, as Command has for
  officers.
- **System tab:** a married notable shows its spouse; an independent world
  shows its notable and whether it would accept a match from you.
- **Briefing:** an *Estates* group — an estate crossing a threshold, a seat
  withheld or let go, a conquered notable still sitting, a marriage made or
  voided, an affair published.
- **Help:** a `:help court` page, with the no-promotion table.

## Prompts

- `serializeState` lists the viewer's estates with favour and grants, and adds
  each world's seat to its `people:` line.
- `appraisal.md`: a grant, a revocation and a reseating are actions; promotion
  is inadmissible, with the table. A marriage is a negotiation between
  notables, and the worked example changes from *"my heir"* to a notable;
  *"seduce"* routes to the `seduction` mission.
- **Personas** see their own notables by estate and world, so they can offer
  one, and the other power's, which are public as seats are, and any wards
  either side holds.
- `appraisal.md`: a marriage into an independent world is a declaration, and
  is inadmissible below `MARRIAGE_CONSENT_REGARD`; the state block gives each
  independent world's standing with the viewer.
- `extraction.md`: the `marriage` row, with `terms.spouses`; each side's
  notable is grounded in that side's own concession.
- **Refusals keep their speakers.** The institutions that refuse a leader are
  the ones the sheets already name, never an estate. An estate is voiced
  where favour shows: a notable withholding, a stipend revoked.

## Bots

- **Seats** fill by the default rule and the bots leave them, except:
- **`placate`** — a bot reseats from its best-favoured estate to its worst when
  the worst falls below −40, one seat at a time;
- **`grant`** — a solvent bot grants a stipend to the estate behind its weakest
  stat, up to two, judged against standing income as fixtures are.
- **`subvert`** — high-guile ethics turn a rival's notable on a world they want
  when at war, and seduce it when not; `honourTreaties` and `honourStanding`
  gate both as they gate incitement.
- **Marriage**, brokered in `brokeredAccords`: two NPC powers on good terms
  (`EXCHANGE_STANDING`, 20, both ways), at peace, neither barred by its
  compulsions (`barsPeaceWith`), each with an estate below 0, marry those
  estates' notables. One marriage per pair at a time.
- **`court`** gains a match: a courting ethic marries into an independent world
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
- marriages made and how long they last; affairs published, and marriages
  they end; independent worlds married into, and how many then join;
- notables held as wards and prisoners, and how many come home;
- the boards. A stat buff is a might buff is a battle; sweep `GRANT_FAVOUR`,
  `GRANT_COST` and the thresholds before settling them, and check every
  property `tests/balance.test.ts` asserts.

## Journal

Pinned to version **20**: `createSeedState`'s `seats` seats the opening board,
and `LegacyRules.seats` runs estates and notables. A world with no seat recorded
is how the tick and the browser know a campaign predates them, the rule standing
set with `regard`.

## Build order

1. Estates on the faction sheets, on the three weakest base stats — a test
   holds that no estate sits on a power's top two; favour, the drift and its
   baseline; the stat table in `effectiveStats`.
2. Seats and notables: one per world and two on a hub, the default fill, the
   notable's three behaviours by favour.
3. Grants and reseating: ops, ledger line, revocation.
4. Conquest, cession, liberation, secession and joining.
5. Operatives: `turn_notable`, assassination of a notable, the watcher's view.
6. Independent worlds' notables: the sixth name stock, the seed's five.
7. Marriage: the bond, the treaty type and `terms.spouses`, the regard and
   favour terms, peace, how it ends; then `propose_marriage` into an
   independent world.
8. Wards and prisoners: `Asset.notableId`, `terms.ward`, prisoners on
   reseating, `seat_estate` with `fromAssetId`, the people-standing rule.
9. Seduction: the mission, the pull and the affair secret; publishing an
   affair voids a marriage.
10. The no-promotion guards and table.
11. UI, prompts, help; bots; measure.

## Later

- **More grants.** A charter (a share of a world's income), an exemption, a
  council seat — typed, as order effects are, once one kind has been measured.

## Decisions

1. **One kind of person in a seat.** Governors and houses are gone; a seat
   holds a notable, and a notable belongs to an estate.
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
7. **No promotion between rosters**, explained in each power's own terms, and
   enforced by having no op that does it.
8. **A power marries through its notables.** The bond is on the two notables.
   Between powers it is agreed as a `marriage` treaty, which is a peace; into
   an independent world it is a declaration the world accepts by its
   standing. Either way it is a grant to the estate and a pull on the worlds
   toward the in-laws.
9. **Seduction is a marriage nobody signed:** the same pull, covertly and while
   it lasts, and the proof that breaks a rival's marriage.
10. **Every world has a notable.** An independent world's is generic and of no
    estate.
11. **A notable can be held**, as a ward or a prisoner, by the asset machinery
    captured officers use: `Asset.notableId` beside `commanderId` and
    `agentId`.
