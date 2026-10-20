# Playtest 2026-10-19: following the advisor

A 10-turn campaign as Meridian, played live on the subscription through
`scripts/pt.mjs` against the stateless server, on branch `claude/intent-ops`
(journal version 28). Every turn the player asked the counsellor (one action
point), then did what it urged with the other action, or in a channel if it
urged a deal. From turn 7 the question was *"What is the one thing we should
do this turn?"*, because the open question kept producing observations rather
than advice.

Campaign `advisor_follow`. Trace: `saves/advisor_follow.trace.jsonl`.
Total cost **$4.36**: diplomacy $1.13, resolution $1.03, reactions $0.69,
advisor $0.57.

## What happened

| turn | the counsel | what the player did | outcome |
|---|---|---|---|
| 1 | the Vigil (−45) is massing at Vantic opposite our worlds | fortify Torrek Anchorage | critical success, ceiling 9 → 12; `cost_avoided` refunded 33 |
| 2 | Sennex wants protection, and we left it unguarded | sail 2 battleships and 1 escort to stand guard over Sennex | a **battle with Arkane**, which was already guarding it: 3 ships lost each side, Sennex −15 toward us |
| 3 | sell the 120 t of salvage while the shortage runs | sold it to the Combine for 400 in a channel | landed exactly as recorded — `pay` + `transfer_asset` built from the record (§2–3) |
| 4 | Torrek is a liability | tried to cede it to the Vigil for 500 | the Vigil's payment was struck by the budget three times; the accord was refused on a red line, +8 dissent |
| 5 | seven Vigil battleships sit over Torrek and skim it | sweep the orbit from Corvid and Brannix | the Vigil's reaction reinforced to 22 hulls; we broke off, 8 lost |
| 6 | the Vigil won't trade, can't be swept, can't be blockaded | post a 400 bounty on the Vigil | **the bounty was dropped** (§4); the story says it was posted |
| 7 | the `torrek_supremacy` commitment is a lie on the books | dissolve it | done |
| 8 | Torrek is occupied; "Three things. First, Sorel is green…" | move Sorel's battle line to Corvid | landed at once |
| 9 | break the stalemate | Sorel sweeps Torrek | 21 of ours and 19 of theirs destroyed; the Vigil keeps the orbit, 3 battleships to 2 |
| 10 | no second assault; the Board wants a return | develop Corvid toward a hub | failed its roll; failed work cost nothing |

Meridian ended on its four opening worlds, the richest treasury in the Rim
(5,482) and the thinnest navy. Three battles at Torrek cost it 39 ships
(10, 8 and 21) and the Vigil 32. The Vigil sits at −73.

## What worked

- **An accord from the record (§2–3).** Each side's concession carried its ids,
  extraction filled `accepted`, and the engine built both transfers once.
- **Critical-success bonus (§4).** `cost_avoided` refunded a quarter of the
  outlay.
- **Failed work costs nothing.** The turn-10 development failed its roll and
  spent nothing.
- **The epilogue records the refusal (§5).** It says "the Board's own officers
  refused an order — the ledger notes it, once", although dissent had decayed
  to 0.
- **The fortification paid.** The Vigil's turn-3 assault on Torrek failed
  against it.

## Findings

### Bugs

**B1. A buyer's payment is struck by the concession budget for naming the world
it buys.** `concessionWorth` (`src/domain/leverage.ts:219`) values every system
in `c.systems` at twelve turns of its income, whether or not the conceder holds
it. The Vigil's concession *"500 credits for Torrek Anchorage"* named `tor-1`,
which it was receiving. It was valued at 1,088 against a budget of 1,076 and
struck, three times. Measured on the seed, it is worth 1,088 with the world and
500 without, against a budget of 1,089. The persona said "five hundred moves
to your account" each time, but the record carried only Meridian's side.
Closing the channel would have ceded the world for nothing. **Fix:** count
only systems the conceder controls.

**B2. §4 drops the act itself when the arbiter forgets the reach.** "Post a
bounty of 400 on the Iron Vigil" was ruled without `reaches: ['coercion']`, so
`opsAsRuled` left out `post_bounty`, which was the whole act. The player spent
an action and no bounty was posted. `post_bounty` is the actor's own money in
escrow and arguably not a reach at all. More generally, a reaching op that *is*
the act should send the ruling back to the arbiter once rather than drop the
op.

**B3. When the rewrite is refused, the false draft stands (§5).** On B2's
turn the reconcile pass ran, and `flavourKeepsTheFacts` refused its rewrite,
presumably because the rewrite named the 400. The draft then stood, saying
"Four hundred credits go into escrow". The guard protects against invented
numbers, and the fallback reinstates the one story known to be wrong. A
refused rewrite should fall back to the plain facts, or to the draft with the
correction notes appended.

**B4. The player cannot withdraw a concession.** On turn 4 the player said
"we withdraw the cession" and then "strike our cession from the record: no
deal". The persona retracted its own concession, but Meridian's cession stayed
on the record, because `retractions` only strike what the persona's own power
conceded. The close was saved only by B5's refusal. Otherwise extraction could
have built a cession the player had explicitly withdrawn.

**B5. Spurious record commitments become real obligations.** The arbiter ruled
`establishes` on three ordinary acts:

- `torrek_fortification`, on the turn-1 fortify;
- `torrek_supremacy`, on the turn-5 sweep: *"Meridian's fleets hold Torrek
  Anchorage's orbit unchallenged"*, written before the battle and false after
  it;
- `vigil_bounty_expansion`, on the bounty that never landed.

Each has consequences:

- **Turn 4:** the accord appraisal read `torrek_fortification` as "a commitment
  made in turn 0" and ruled that ceding Torrek "repudiates" it. That crossed
  Meridian's red line and cost +8 dissent, on an accord that had already been
  withdrawn.
- **Turn 7:** the counsellor read `torrek_supremacy` as "a lying ledger" and
  told the player to fix it, which cost an action.

`prompts/appraisal.md` already says programmes and attacks are not
commitments; the arbiter ignored it three times in ten turns. Code could refuse
an `establishes` on an act whose overt part is a programme or a move.

**B6. A move that names no force sails the whole port.** "Sorel takes the
battle line from Corvid" became a `move` with no `force`, so Corvid's 2 lifters
and its freighter sailed into the battle and died.

### Design gaps

**D1. "Stand guard" over a world another power is guarding is an attack.**
The player declared "protect it, not land or take it". Arkane's squadron
defended Sennex as if invaded, and both were destroyed. Neither the arbiter
nor resolution warned of it, and the narrative described a "tangled guard",
not a battle. There is no way to share an unaligned orbit short of
`basing_rights`.

**D2. Resolution narrates battles before they are fought, and reactions read
the narration.**

- **Turn 5:** the story said "a clean sweep", and the battle was lost.
- **Turn 9:** the story said "a rout". The Vigil's reaction, written before the
  tick, answered *"Torrek Anchorage lost in a single disciplined pass"*, a
  battle that went the other way.

§5's reconcile pass covers what the reducer did at staging. Arrivals settle in
the tick, after both the story and the reactions.

**D3. The epilogue says Meridian's worlds were never contested.** "Not one of
them was ever contested — no fleet came for Meridian's charter", after three
battles at Torrek that cost 39 Meridian ships. The dossier's `contested`
counts only worlds that changed hands. Battles that moved no border are
invisible, so the prose filled the gap with peace. It also calls the Vigil's
fleet "intact" after it lost 32 hulls.

### The counsellor

**A1. Truncated mid-word.** Three of ten counsels hit the 560-character cap
and were cut mid-sentence ("the Board will ask you by quarte…"). `cappedProse`
keeps a cut at a sentence end only in the last quarter, and the counsel runs
as one long sentence. The cut falls exactly where the counsel was arriving at
its point.

**A2. Meridian's voice fights the plan guard.** Meridian's sheet says *"numbers
his points — 'Three things. First —'"*; `looksLikeAPlan` refuses an
enumeration. Six of ten advisor calls failed the guard on the first attempt,
paying for a retry each time. On turn 8 the counsel that passed opened "Three
things. First…" and stopped after the first.

**A3. It misreads the board.**

- **Turn 3:** it put us at "spoilage at Sennex and Neth both", but we have
  nothing at Neth.
- **Turn 8:** it called the 21 troops at Torrek "the Vigil's garrison"; they
  are ours.
- It never mentioned the 10–11 Vigil lifters massing at Vantic, the most
  urgent fact on the board in turns 7–10.

**A4. Most counsel describes and does not advise.** Turns 4, 6 and 8 named a
problem and no move. Asking "what is the one thing" helped: turns 9 and 10
gave a direction. A player who always follows it fights the same war
repeatedly, because nothing in the counsel weighs the cost of the last
attempt until afterwards.

### Smaller

- **Pronouns.** Resolution and the counsellor called officer Sorel "she";
  generated officers are they/them. The Vigil's persona called Meridian's Chief
  Executive "her"; his sheet says he/him.
- **Untrivial moves.** Moving one's own ships between one's own worlds was
  rolled (might, DC 5) rather than priced trivial.
- **Note formatting.** The accord note ends "…had underwritten. the terms
  agreed" (the reason is appended lowercase).
- **Resolution cost.** $0.31 for the first call: a 71k-character system prompt
  before the cache warmed. Later calls were about $0.10.
