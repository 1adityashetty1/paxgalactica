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
| **joining** | the independent notable takes the seat for the default estate; the people chose, and their notable came with them |

A foreign notable is the old power's fifth column without any special rule: it
still counts as a seat of the old power's estate, so that estate's favour does
not fall at once when the world is lost — and the old power has every reason to
take it back.

## Operatives

Two existing missions reach a notable. No new mission:

| mission | aimed at a notable |
|---|---|
| **subversion** | a new effect, `turn_notable`: while it works, the notable acts as if its estate stood at −40 — withholding, souring its world — whatever the estate's real favour. A local threat, not a lever on the whole estate. Contested as incitement is (`counterIntelAt`) |
| **assassination** | can name a notable, matched by name as officers are. The seat refills by default the same tick; the world's regard for its holder drops 10 in the confusion, and the estate loses the seat to nobody, so its favour does not move |

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
is never seated**: a prisoner is worth a ransom, and a turned admiral is a far
larger idea than this design reaches.

Mechanically: separate rosters and no op that moves a person between them.
`seat_estate` names an estate, never a person, and draws a new notable;
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
- **Briefing:** an *Estates* group — an estate crossing a threshold, a seat
  withheld or let go, a conquered notable still sitting.
- **Help:** a `:help court` page, with the no-promotion table.

## Prompts

- `serializeState` lists the viewer's estates with favour and grants, and adds
  each world's seat to its `people:` line.
- `appraisal.md`: a grant, a revocation and a reseating are actions; promotion
  is inadmissible, with the table.
- **Refusals keep their speakers.** The institutions that refuse a leader are
  the ones the sheets already name, never an estate. An estate is voiced
  where favour shows: a notable withholding, a stipend revoked.

## Bots

- **Seats** fill by the default rule and the bots leave them, except:
- **`placate`** — a bot reseats from its best-favoured estate to its worst when
  the worst falls below −40, one seat at a time;
- **`grant`** — a solvent bot grants a stipend to the estate behind its weakest
  stat, up to two, judged against standing income as fixtures are.
- **`subvert`** — high-guile ethics turn a rival's notable on a world they want;
  `honourTreaties` and `honourStanding` gate it as they gate incitement.

## Measurement

Against the four harness boards (30 and 100 turns, with and without events),
`pnpm balance [turns] --no-seats` as the control:

- estate favour over time, per power; how often any estate crosses ±40;
- how far grants lift each power's weakest stat, and whether the rich buy
  theirs away faster than the poor. A flat fixture price measured regressive
  for exactly this reason; if grants do the same, the Nth grant costs N ×
  `GRANT_COST`, as fixture upkeep rises with the count;
- seats withheld and worlds let go; conquered notables reseated, and how fast;
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
6. The no-promotion guards and table.
7. UI, prompts, help; bots; measure.

## Later

- **Marriage between notables.** A notable married into another power's estate
  pulls its world's regard toward the in-laws, and a spouse held abroad is a
  hostage through `voidsOn: asset_lost`. When the notable's estate turns bitter,
  the world it lets go is likelier to join the in-laws. Every piece but the
  notable exists already.
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
