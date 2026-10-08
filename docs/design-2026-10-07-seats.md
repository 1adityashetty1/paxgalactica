# Design: seats — governors, notables and who answers for a world

`brainstorm-2026-10-02.md` §5.3 (estates), reworked into a third class of
person. Commanders command fleets and operatives work in the dark; nobody
**runs a world**. The institutions that refuse a leader — *the Trade Council*,
*the fleet commanders*, *the councils* — exist only as names a refusal is
spoken in, and the only governor in the code is the one an `influence` check
charms in a comment. This design gives every held world a **seat** and someone
in it, and makes that person the place where a power's politics happen.

*Status, 2026-10-07:* proposed. Nothing built. Journal version **20** if built
(19 is taken by coalitions and ten given names).

## The rule

Every world a power holds has one **seat**, and one person sits in it:

- a **notable** — the local house that runs the world by its own right. Every
  held world starts with one. A notable has a view of every power, may act
  without being told, and can be persuaded — by its holder, or by a rival.
- a **governor** — the holder's own appointee, sent from the capital. A
  governor is the player's proxy: it does what the power wants, has no view of
  its own, and cannot be persuaded.

**The two open questions of the first sketch are one decision.** Whether a
seat is filled by appointment or by default, and whether its occupant carries
dissent, are the same choice seen twice: a person the leader chose speaks for
the leader, so a governor carries **no** dissent; a person who holds the world
by their own right speaks for the world, so a notable **is** where dissent
lives. Appointing a governor is how a leader buys a seat out of politics, and
what it costs is the reason not to do it everywhere.

## Consent or control

Standing already has two ways a world stays: **content** (its regard for its
holder at 20 or better) or **held down** (enough warships over it). The two
kinds of seat map onto them exactly, and that is the core of the design:

| | notable | governor |
|---|---|---|
| answers to | its world, its house | the capital |
| what it adds | **consent**: a loyal notable lifts the world's regard toward its holder each turn | **control**: counts toward holding the world down, as a garrison of police does |
| dissent | carries it: the leader's dissent drags its loyalty | carries none |
| can be persuaded | yes, by anyone | no |
| can be killed | yes | yes |
| costs | nothing to keep | an action and credits to appoint, upkeep, and a slot |
| on a world that hates you | resents you too, and may take the world elsewhere | holds it without making it love you |

A governor is to a seat what a warship is to an orbit: it keeps a world you
cannot win over. A loyal notable is to a seat what an envoy is: it wins the
world over. A world can be held by a notable for nothing as long as the
notable is loyal, and the question every turn is whether they still are.

## Notables

A notable is a named person — the same generator as officers and operatives,
with a family name unique in the campaign. **The family is a house**, which is
what dynastic marriage will bind (see *Later*).

### Favour

A notable keeps a **favour** toward every power, −100 to 100, the shape a
world's regard already has (`StarSystem.regard`) and read the same way.
Favour toward the holder is the notable's **loyalty**.

It drifts a tenth of the gap a turn toward a baseline:

- **the world's own regard** for that power — a house does not stray far from
  the mood of its people;
- **less half the holder's dissent**, toward the holder only — a leader whose
  institutions have stopped following them has stopped being followed here too.

That second term is how dissent reaches the map. Today dissent is one number
that comes off every stat; with seats it also turns up as particular houses on
particular worlds starting to act on their own.

| moves favour | how much |
|---|---|
| the holder **courts** the notable — an envoy to the house rather than the people (`court` aimed at the seat) | as an envoy: 5 a point plus influence |
| a rival courts the notable | the same, toward the rival |
| a **subversion** operative turned on the notable | lowers loyalty and raises favour toward its owner each turn it succeeds (see *Operatives*) |
| the holder overrules its own institutions — a refusal or a compulsion defied | each notable's loyalty falls by the dissent charged, on top of the drift |
| the holder wins a battle over the world, or loses one | +5 / −10 |
| a **privilege** granted (see *Later*) | a typed, standing lift paid for in income |

### What a notable does on its own

Thresholds on **loyalty**, checked in the tick after standing:

| loyalty | the notable |
|---|---|
| 50 or better | **lifts** the world's regard for its holder `NOTABLE_REGARD` (4) a turn — consent, earned for free |
| 0 to 49 | keeps the world and does nothing for you |
| below 0 | **acts independently**: withholds half the world's income (`NOTABLE_WITHHOLD`), lets the garrison go unrenewed, and lowers the world's regard for its holder by the same 4 a turn |
| −40 or worse, and the world not content | **defects**: takes the world to the power it favours most, if that favour is at least `JOIN_REGARD` (60); to independence otherwise |

**A defection is the fifth way a world changes hands**, after an arrival, a
cession, the Rim's unrest and a world joining — and the first one a person
decides. It goes through the same `secede` and joining code: the holder's
ships and officers withdraw, the garrison stays with the world, and
`homeFactionId` does not move. A notable who defects keeps their seat under the
new holder, with loyalty at the favour that brought them over.

## Governors

A governor is appointed by declaration — *"send a governor to Torrek
Anchorage"* — and is an action of its own, like appointing an officer or
recruiting an operative. `appoint_governor { systemId }`:

- **on a world the power holds**, with a seat not already held by a governor;
- **costs** `GOVERNOR_COST` (100) and `GOVERNOR_UPKEEP` (4) a turn — an
  officer is 120 and 5, and a governor commands nothing in a battle;
- **counts against a cap: the power's span of control** (`spanOfControl`).
  A capital can only staff so many worlds from its own people; everywhere past
  that is left to the houses. This couples the existing span to the seat
  without changing its numbers: span still charges dissent for every world
  held past it, and now also bounds how many of those worlds a leader can take
  out of politics.

What a governor does:

- **holds**: counts `GOVERNOR_HOLD` (2) battleship-equivalents toward the force
  a world needs to be held down — a police apparatus where a squadron would
  otherwise sit. Scaled by the holder's resolve exactly as warships are
  (`holdingFactor`).
- **collects in full**: no withholding, ever.
- **does not lift regard.** A governor is the capital's person; the world's
  people know it.

**Displacing a notable has a price.** The house does not vanish: it sits out
of office, its favour toward the holder drops `DISPLACED_FAVOUR` (30), and the
world's regard for the holder drops 10 — the people watched their house put
aside. The displaced notable stays on the world's record, and **recalling the
governor** (`recall_governor`) gives the seat back to that house, with the
favour it has by then. A world whose house was put aside and never restored
remembers it.

## Conquest, secession, joining

| event | the seat |
|---|---|
| **conquest** of a world with a **governor** | the governor is **taken alive** — a prisoner asset of the conqueror, worth most to the power that appointed them, ransomed or questioned like a captured officer. A governor does not fight, so there is no death roll |
| **conquest** of a world with a **notable** | the house **stays**: the conqueror inherits it. Its favour toward the conqueror starts at the world's regard for the conqueror (−60 after a storming), and toward the old holder it keeps what it had. A conquered house is the old power's fifth column, and courting it back is the old power's cheapest way home |
| **cession** | the same as conquest, without the taking: a governor goes home with the ceder's ships; a notable stays and starts at the world's regard for the new holder |
| **liberation** (a power retakes its own home world) | the house's favour toward it is restored to at least 50, and a governor the occupier installed is captured |
| **a world rises** (secession) | a governor is expelled with the holder's ships and officers; the notable leads the independent world |
| **a world joins** | its notable takes the seat with loyalty at the regard that brought it over — the people chose, and the house with them |
| **opening board** | every held world has a notable. No governor: the seed has none, so every campaign opens in politics and a leader chooses where to leave it |

## Operatives

Three missions reach a seat. Each is an existing mission with a new target, not
a new mission:

| mission | aimed at a seat |
|---|---|
| **subversion** | a new effect, `turn_notable`: each turn it succeeds, the notable's loyalty to its holder falls `perTurn` (1–5) and its favour toward the operative's owner rises as much. **A governor cannot be turned**, and the arbiter refuses the attempt before the price. Contested like incitement: against the holder's effective resolve, or its founding resolve plus `HOME_GROUND_DEFENCE` on its own home ground (`counterIntelAt`) |
| **assassination** | can name a governor or a notable, matched by name as officers are (`resolveCommander` generalised to people). A governor killed leaves the seat to the displaced house if there is one, or to a newly drawn notable at the world's regard. A notable killed is succeeded by their house — a new person, same family — whose favour toward whoever is **blamed** (the killer, once exposed) drops 40 |
| **surveillance** | a watcher on a world shows its seat in full: who sits, their loyalty, and which power they favour most. Without one, a rival's seat shows who sits and nothing else. `INTEL_DELIVERS` (40) on that power shows its notables' loyalty in bands |

**Incitement and subversion are the two levers, and they are different.**
Incitement works on the **people** (regard) and is answered by warships or a
loyal notable. Subversion works on the **house** (favour) and is answered by
courting the notable, or by replacing it with a governor — which is the one
thing a turned house cannot survive. That answers the first sketch's third
question: a rival courts the people with envoys and incitement, and the house
with envoys and subversion, and the two are different defences.

Operative effects on a seat are **read on the tick** like `incite`, and the
holder is told its house is being worked on and not by whom.

## No promotion

Other games let a general become a governor or a governor take a fleet. This
one does not, for simplicity — three rosters, three ladders, three ways to lose
someone — and the fiction says why rather than the rule. In every power the
sword and the seal are kept apart, for that power's own reason:

| power | why an officer is never made governor, or a governor given a fleet |
|---|---|
| **Meridian** | The Charter forbids it. An officer who held a franchise could send the fleet to collect on it; a factor who commanded a squadron could enforce their own contracts. The Board audits the two separately, and has since the founding. |
| **Iron Vigil** | The Codes of the old Legions. Marshals who governed the worlds they took are what broke the Empire; a Legate who sits a world's seat is a usurper by definition, and the fleet commanders would say so. |
| **Ojjul Nar** | A seat is a house's, by blood. An Enforcer is the Family's hand, and a hand does not sit; an office cannot marry into a seat, and a house does not lend its heir to the fleet. |
| **Arkane** | Different councils elect them. The fleet councils elect wardens and the world councils elect stewards, and no council may elect for the other. A warden who wanted a world would have to stand for it, and lose the fleet. |
| **Drajk** | Crews follow captains who will not put down roots. A Korvan Lord who took a seat would have grown roots by morning, and the crew would elect someone else before the tide. |

And across all five:

- **An operative is never appointed to anything.** Their value is that nobody
  knows their face; a public office burns it the day it is announced. A
  ransomed operative goes back into the field or nowhere.
- **A notable is never made a governor.** They belong to their world's house,
  not to the capital; making one the capital's person would make them their
  own house's enemy.
- **A captured enemy officer or governor is never appointed.** They are a
  prisoner, worth a ransom; a turned admiral is a far larger idea this design
  does not reach.

Mechanically: three rosters with separate records, and no op that moves a
person between them. `appoint_governor` draws a new person and takes no
`fromAssetId` except one of the power's **own captured governors**, brought
home; `recruit_commander` and `recruit_agent` refuse a governor's asset. A
declared *"make Marshal Galba governor of Kalzir"* is **inadmissible** at the
arbiter, quoting the power's reason above — the appraisal prompt carries the
table, so the refusal reads as the fiction speaking, and it costs nothing, as
an inadmissible ruling does. A resolution that narrates a promotion anyway
produces no op that can carry it out.

## What the player sees

- **System tab, a world you hold:** the seat — who sits, notable or governor,
  loyalty as a bar for a notable, the displaced house if there is one — with
  two draft buttons: *court the notable* and *send a governor* (or *recall the
  governor*). A rival's world shows who sits, and more with a watcher.
- **A Court tab**, beside Command and Agents: every seat you hold, sorted by
  loyalty, lowest first — the worlds about to act on their own at the top — and
  your governors against the span that caps them.
- **Map:** a mark on a world whose notable is acting independently.
- **Briefing:** a *Houses* group — a notable gone independent, a defection,
  a house displaced, a governor taken.
- **Help:** a `:help court` page, and the no-promotion table in it.

Titles follow each power's convention, as officers' do:

| | governor | notable |
|---|---|---|
| Meridian | Resident Factor | Chartered House |
| Iron Vigil | Prefect | Old Family |
| Ojjul Nar | Steward of the Family | Cousin-House |
| Arkane | Steward | Elder of the Hold |
| Drajk | Harbourmaster | Dockholder |

## Prompts

- `serializeState` adds the seat to each world's `people:` line: who sits, and
  for the viewer's own worlds the notable's loyalty and whom it favours.
- `appraisal.md`: appointing a governor is an action; courting a house is an
  envoy; turning a rival's house is subversion; promotion is inadmissible, with
  the table.
- `resolution.md` and `extraction.md`: a governor is never created by
  narrative, only by `appoint_governor`; a house's favour moves only by the
  mechanisms above.
- **Refusals get a speaker.** When a refusal or a defiance is charged, the
  notable whose loyalty fell most is named as the voice that refused — *"the
  Chartered House of Okonjo, sitting at Brannix, will not put its name to
  this"* — so *the Trade Council* stops being a label and starts being people.

## Bots

- **`govern`** — a bot sends a governor to a world it holds down by force,
  where the warships it keeps there cost more in upkeep than the governor
  would. The Vigil at Torrek Anchorage is the case the harness already has.
- **`tend`** — a bot courts its least loyal notable when that loyalty is
  falling toward zero, one envoy at a time, the way `court` tends a world.
- **`subvert`** — the high-guile ethics (the Combine; Drajk at war) send a
  subversion operative at a rival's least loyal notable on a world they want.
  The defensive ethic does not: Arkane works on the people, not the houses.
- `honourTreaties` and `honourStanding` gate subversion as they gate incitement.

## Measurement

Against the four harness boards (30 and 100 turns, with and without events):

- how many seats ever go independent, and how many defect;
- whether a `govern` governor at Torrek frees warships, and what the Vigil does
  with them;
- whether `subvert` ever turns a house into a defection, and against whom;
- the boards themselves — a fifth way for worlds to change hands is exactly the
  kind of rule that moves one marginal conquest, so sweep `NOTABLE_REGARD`,
  `GOVERNOR_HOLD` and the defection threshold before settling them.

`pnpm balance [turns] --no-seats` is the control.

## Journal

Pinned to version **20**: `createSeedState`'s `seats` seats a notable on every
held world, and `LegacyRules.seats` runs them. A world with no seat recorded is
how both the tick and the browser know a campaign predates them — the rule
standing set with `regard`.

## Build order

1. Seats, notables and favour; the drift; loyalty's three readers (regard,
   income, garrison); defection through `secede` and joining.
2. Governors: appoint, recall, the span cap, holding, displacement.
3. Conquest, cession, liberation, secession and joining handled per the table.
4. Operatives: `turn_notable`, assassination of seated people, surveillance.
5. The no-promotion guards, arbiter and reducer, with the Watsonian table.
6. UI, prompts, help; bots; measure.

## Later

- **Houses marry.** A dynastic marriage binds a notable's house to another
  power: the house's favour toward it rises, the spouse is a person-asset held
  by the other side, and `voidsOn: asset_lost` makes them a hostage. Every piece
  but the house exists already; this is what the house is for.
- **Privileges.** A leader buys a house's loyalty with a standing grant — a
  tax exemption (less income from that world), a seat on a council (a dissent
  discount), a monopoly (a share of a lane) — typed, like order effects.
- **Dissent as the houses.** If seats work, the next question is whether the
  faction-wide dissent number should *become* the houses' loyalty rather than
  sit beside it. Deferred: dissent's stat penalty is tuned and measured, and
  this design should earn its place before it replaces anything.

## Decisions

1. **Appointment and dissent are one decision.** A governor is the leader's and
   carries no dissent; a notable is the world's and carries it. Recorded above.
2. **A seat per world, one person in it.** Not per sector, not per power: the
   world is the unit standing, income and conquest already use.
3. **Consent and control map onto content and held down.** Notables lift
   regard; governors count toward holding. Neither does the other's job.
4. **Governors are capped by span of control**, not by a new constant.
5. **No promotion between rosters**, explained in each power's own terms, and
   enforced by having no op that does it.
6. **Subversion turns houses; incitement turns people.** Two levers, two
   defences.
7. **A conquered house stays**, and is the old holder's road back.
