# Playtest 2026-09-07 — Creative Combine (`creative_0907`)

Player: **Ojjul Nar Combine** (`ojjul`). guile 18 / influence 15 / might 9 /
industry 12 / resolve 11. Credits 3600. Systems ilv-1, ilv-2, ilv-3, ilv-5.
16 turns, 2 actions/turn.

Brief: find where the fixed op vocabulary and the open fiction disagree, in both
directions. Not an exploit hunt.

Opening board (turn 0):
- Debts: `debt-0` drajk owes ojjul 600 (bal 480, **delinquent**, 2 missed);
  `debt-1` meridian owes ojjul 400 (bal 400, current, 25/turn).
- Treaties: none. Commitments: none. Agents: none.
- Disposition toward me: meridian +15, vigil −45, freeworlds −15, drajk +30.

---

## Feature priorities

Written after the run, consolidating 40 findings into the mechanics that do not
exist and should. Ranked by **how often the fiction reached for it** times **how
cheap it is**, with the disagreements between those two called out rather than
averaged away.

### Tier 1 — small, and something is actually broken

| # | What is missing | Covers | Size |
|---|---|---|---|
| 1 | **`channelBlockers` never fires.** Three deliberate, self-announced red-line crossings across four channels; `[]` at every read. The close-time appraisal on the same transcript charged 15 dissent for one of them, so the breach *is* detectable — the per-message pass is not reaching the field. | D-6 | **Small if it is wiring.** Check before tuning the prompt. |
| 2 | **A declared action can mint credits.** `moveConserved` runs on extraction batches only. On the declared path a one-sided `adjust_credits` is capped at `MAX_NARRATIVE_CREDITS` and applied — so the cap bounds the *size* of the invention, not the fact of it. Measured: the galaxy gained 320 credits and no treasury paid. | E-1 | **Small.** Run `moveConserved` over declared batches. |
| 3 | **Every private commitment is published to every power.** `serializeCommitments(state)` takes no viewer and renders all live commitments into all five prompts. The log half of this was fixed today and written up as closed; the state block was not. | D-5 | **Small.** `treatiesFor`-style scoping. |
| 4 | **The concession ledger accumulates instead of superseding.** One hire recorded four times, one recorded backwards, and terms both parties struck still live in the list after a retraction. Extraction deduped it correctly this time — but extraction is documented as a *matcher* against this list. | D-8 | **Small.** Key by `kind`, supersede in place, never record a withdrawal as a concession. |

These are first because three of them are defects in code that shipped today or
yesterday, and #2 is an open economy loop.

### Tier 2 — the largest gap in the game, and it is one feature

| # | What is missing | Covers | Size |
|---|---|---|---|
| 5 | **A contingent payment: "if X happens, Y pays Z."** A 900-credit indemnity on the fall of a world landed as a `Commitment` with `incomePerTurn: 0` and a `log_narrative`; only the *premium* was real. So an underwriter here is a pure income stream with no liability, which is a subscription, not insurance. | B-10, C-8, and the money half of B-1, C-9, B-4–7 | **Medium.** `Commitment.contingentPayment {trigger, amount, from, to}` reusing the closed `voidsOn` vocabulary, settled by `moveConserved` in `tickTurn`. |

Ranked alone because *"if X then pay Y"* is the shape of **insurance, indemnity,
bounty, ransom, escrow, surety, war subsidy, success fee and the performance
clause of any treaty** — and because it is the one gap the agent reached for
unprompted in four separate turns. Highest frequency in the run by a wide margin,
at medium cost. Build this one.

### Tier 3 — the arbiter is not reliable, and that is separate from vocabulary

| # | What is missing | Covers | Size |
|---|---|---|---|
| 6 | **`verifyBreachRelevance` failed four times in nine turns.** A prisoner release refused under the *debt* red line. The same act (forgiving a debt) ruled three different ways across three turns. Paying men to change sides charged as a *favour given for goodwill*. | A-3, A-5, A-6 | Unclear — see below. |
| 7 | **The Combine's proxy line was read backwards, verbatim.** Hiring a proxy was refused for *"will not fight its own war where a proxy could be hired"* — the line being **kept**. `CLAUDE.md` records this exact inversion, on this exact line, as the reason `breach.how` became required. **The guard did not hold.** | A-4 | Small to diagnose, unknown to fix. |

`docs/todo.md` section A already accepts arbiter variance as irreducible and
names one remaining buildable item: **log every breach ruling with the line, the
kind and the relevance verdict.** This run is the argument for building it. Right
now "the same act was ruled three ways" is an anecdote from one agent's notes;
there is no way to ask a campaign how often it happens, and no way to tell
whether a prompt change helped.

### Tier 4 — real features, medium cost, repeatedly reached for

| # | What is missing | Covers | Size |
|---|---|---|---|
| 8 | **People as objects.** Hostages, fostered heirs, captured crews, prisoner exchange, ransom. Nothing can be held, kept, killed, returned or refused. Losses are destroyed, never taken. | B-1, C-9 | **Medium**, and it is one object, not two. A `Prize`/`Hostage` record produced by `resolveBattle` on a decisive win gives ransom, hostage, prisoner-exchange and `defection` a shared home. |
| 9 | **A `contract` treaty type.** `tribute` is the only type carrying `incomePerTurn`, so it is the sink for every recurring flow — and words bind here: Arkane's sheet refuses tribute outright and it is now the payer on a live `tribute` treaty. Supersession keys on type, so a second commercial deal silently retires the first. | C-5 | **Medium**, and cheap for how much fiction it unblocks. Pair with running the accord appraisal against **both** parties' principles, not just the actor's. |
| 10 | **No op can raise a rival's dissent.** Two successful legitimacy attacks left the Iron Vigil mechanically identical. `adjust_dissent` is actor-only and upward-only by design; `adjust_disposition` measures the wrong quantity and moved the wrong way. | B-2 | **Medium.** A `sedition` agent effect under the same bounds `stat_debuff` uses. Opens a whole axis that currently has a fiction and no arithmetic. |
| 11 | **A hired squadron.** Twelve hulls offered under another power's flag and command landed as `basing_rights` — permission for *my* fleet to visit *their* space. The hulls stay mine, fight when I say, and count in my strength. | C-6 | **Medium.** Let `shipsPledged` transfer control for the treaty's life. |

### Tier 5 — cheap, and each came up once or twice

`A-1`/`A-2` an accord is refused whole even when the offending clause is
severable · `B-8` repudiating your own multi-party commitment is free and pays
the same · `B-11` route an exclusivity clause into an `exclusive` commitment
instead of a `log_narrative`, and `commitment_conflict` catches the double sale
for nothing · `C-1`/`D-3` refuse to write a multilateral compact as a one-party
commitment binding powers never asked · `B-13` surface a trimmed figure back into
the accord narrative, so a number bargained from 80 to 95 does not silently
settle at 60 · `C-4` reject a hostile-effect `deploy_agent` on the actor's own
system · `E-2` put `rejections` on the response, and scope the "nothing was
applied" note to the batch it describes.

### Where frequency and cost disagree

- **Cheap but rare:** `C-4`, `B-13`, `E-2`. Worth doing on a quiet afternoon, not
  worth planning around.
- **Expensive but constant:** #8 (people) and #10 (rival dissent). Both were
  reached for in most turns and neither is small. They are the two that would
  most change what the game *is*.
- **`B-12`, the most-favoured-nation ratchet, is the one thing here not worth
  building.** No arrangement can read another arrangement's terms, and a clause
  whose whole content is *"track that other contract"* is structurally
  unrepresentable. The fix is the arbiter **saying so** rather than recording it
  as though it bound something.

### Which bucket is the real problem

**B.** Thirteen findings against six in A, and the asymmetry is the diagnosis:
**this game is good at hearing anything and bad at doing anything with it.** The
arbiter is broadly permissive — it said yes to a free port, a pretender, a bill
of attainder, an insurance syndicate, a cartel and an arbitration bench — and
then eleven of those produced a `Commitment` with `incomePerTurn: 0` and a line
of narrative. The player is told their invention worked. It did not.

That is worse than a refusal, because a refusal is legible and teaches the
boundary, while an inert success teaches a boundary that is not there. A player
who signs an indemnity and discovers ten turns later that no claim can ever be
paid has been misled by the game, not limited by it.

So the priority order is **mechanics, not arbiter tuning** — with Tier 3 as the
exception, because A-4 is a guard that `CLAUDE.md` claims is closed and is not,
and because four relevance failures in nine turns is a reliability problem rather
than the irreducible variance section A of `todo.md` accepts.

---

## A. DENIED BUT SHOULD NOT HAVE BEEN

**A-1 — accord refused whole for one clause, four unrelated clauses destroyed with it
(turn 0, Drajk).** `/endtalk` returned a refusal over the proxy-war contract. The
same accord also carried a prize tithe, a letter of marque, a mark-premium
syndicate and a hostage exchange, none of which touch any Combine line. All died.
Cost 8 dissent. *Fair as far as the rule goes ("a deal that needs you to cross a
red line is no deal"); wrong in granularity — an accord is refused whole even
when the offending term is severable and the counterparty would sever it.*

**A-2 — the inverse defect, same turn.** Reopening the channel and withdrawing
only the war clause let `/endtalk` #2 emit **`forgive_debt` on `debt-0`** — against
`"will not forgive an unpaid debt — the debt is the whole instrument of control"`,
on a debt that was **delinquent with two missed payments**, i.e. the most literal
possible instance of the line. No refusal, no defiance, no dissent. The pass that
refused a *hired proxy* waved through the one act the sheet names outright.

**A-3 — a red line quoted against an act it has nothing to do with (turn 2,
Vigil).** Returning captured Vigil crews was refused by the Council of Factors
quoting the **debt** red line:

> `[refused by The Council of Factors] A debt unpaid is a client taught that
> consequence does not follow default. You cannot return those crews for the
> gesture. Every debtor in this Rim will see it and test the same principle.`

No debt is involved in a prisoner release. `verifyBreachRelevance` exists to drop
exactly this and did not.

**A-4 — the red line read backwards, verbatim, the way CLAUDE.md says it used to
be (turn 3, Drajk).** I offered Drajk **200/turn to raid Arkane on my behalf** —
hiring a proxy so my own hulls never sail. `/endtalk`:

> `"violated": "will not fight its own war where a proxy could be hired to fight
> it instead"`
> `"reason": "This is proxy raiding. You are paying 200 a turn to have Drajk do
> what you will not do yourself. ... crosses into paying for your war, which
> violates the founding principle that other powers spend their fleets for you,
> not the reverse."`

The reason paragraph **states the principle correctly and then rules against it**.
Hiring a proxy is the line being *kept*; the clause forbids fighting *instead of*
hiring one. CLAUDE.md records this precise inversion, on this precise line, as the
reason `breach.how` was made a required field:

> *"`breach.how` is required because the arbiter read the Combine's 'will not
> fight its own war where a proxy could be hired' as forbidding **hiring a
> proxy** — the precise inversion, since hiring is the line being kept."*

**The guard did not hold.** Collateral: a 60-credit intelligence sale, a 50/head
ransom and a most-favoured-nation clause all refused with it, +8 dissent (to 63,
−5 on every stat).

**A-5 — the same act ruled three different ways across three turns.** Forgiving a
debt: turn 0 → allowed silently, no charge (A-2). Turn 2 → *prisoner release*
refused under the debt line (A-3). Turn 3 → an actual, explicit, ceremonious
forgiveness of `debt-1` **allowed**, charged as the soft compulsion "every favour
must carry a price" (15 dissent), the debt red line never named. Under-fires on
the act it is about, over-fires on acts it is not.

**A-6 — a compulsion charged for buying defections (turn 3, declared).** The Bill
of Attainder offered Vigil officers **back-pay to re-swear** — the most
transactional act available — and was charged 15 dissent under
`"every favour carry a price; giving something away for goodwill is refused as
ruinous precedent"`. Paying men to change sides is a price, not a favour. This is
`verifyBreachRelevance` failing a fourth time in one campaign.

## B. ALLOWED BUT INERT

**B-1 — hostages and fostering have no object.** Offered to Drajk (t0) and the
Vigil (t2); Drajk refused in character, the Vigil accepted. Nothing exists to
hold. A hostage cannot be taken, kept, killed, or lost, and a treaty cannot be
conditioned on one still being alive.
→ *Fix: a `Hostage` record (holder, subject faction, `voidsOn: hostage_killed`),
or reuse `Commitment` with a `heldBy`. Small.*

**B-2 — a successful legitimacy attack cannot touch the target (turns 1 and 3).**
Crowning a pretender (t1, success) and the Bill of Attainder (t3, partial) both
resolved as described in the fiction and left the Iron Vigil **mechanically
identical**: dissent unmoved, stats unmoved. The only ops available are
`adjust_disposition` (which measures *their opinion of me* — the wrong quantity,
and it moved the wrong way: −8 then −12) and a `stat_debuff` agent. Net effect of
two successful attacks on a rival's legitimacy: −200 credits, −20/turn in
perpetuity, +15 of my own dissent, and the Vigil hating me more.
`adjust_dissent` is deliberately actor-only and upward-only, so **there is no op
in the game that can raise a rival's dissent.**
→ *Fix: let an operative or a check emit dissent against a rival under the same
bounds `stat_debuff` uses — a `sedition` agent effect, or `adjust_dissent` with
presence + a check gate. Medium; it opens the whole subversion axis, which
currently has a fiction and no arithmetic.*

**B-3 — a failed covert action charges nothing (t1).** "You are out the cost of
the attempt" in the narrative; no credits moved. Cosmetic but it means failure is
free. *Small.*

**B-4/5/6/7 — four commitments from the Meridian accord (t1), all `incomePerTurn:
0`, all pure record:** `arbitration_compact` (a bench with jurisdiction),
`insurance_syndicate` ("seeded with 300 credits each" — no credits moved),
`corridor_rate_pact` (a price-fixing cartel that sets no price and splits no
take), `claimant_seal_surety` (a document held in escrow against my performance,
with no way to forfeit it).

**B-8 — repudiating my own compact cost nothing and paid the same (t2).** I broke
the Shalka Compact publicly, in all three clauses, having sworn it to four powers
one turn earlier. Zero disposition change with anybody, no pact-breaking
reputation cost (a `Commitment` is not a `Treaty`, so `PACT_BREAKING_REPUTATION_COST`
never applies), and the replacement commitment `compact_repudiation` pays the
**identical +20/turn** the broken one paid. Repudiation was strictly free.
→ *Fix: give `dissolve_commitment` by the establishing party the disposition cost
`break_treaty` has, scaled by how many parties the commitment named. Small.*

**B-9 — a whole accord's terms produced no binding op (t2, Vigil).** `/endtalk` #2
stood, charged 15 dissent, and emitted nothing that binds: the Imperial seat, the
advance notice of the marque and the crew release were all narrative.

**B-10 — the contingent indemnity: an insurance market where no claim can ever be
paid (t3).** The centrepiece of this turn. I wrote Arkane a **900-credit indemnity
payable if Pell Reach or Arkane Prime falls**, and laid **450 of it off to
Meridian** as reinsurance. What landed:

| agreed | landed as |
|---|---|
| 900 indemnity on the fall of a world | `establish_commitment {kind: indemnity_pact, incomePerTurn: 0}` |
| Meridian carries 450 of the exposure | `log_narrative` ("becomes due; if neither falls, no principal ever moves") |
| 95/turn annuity for carrying it | `form_treaty {type: tribute, incomePerTurn: {ojjul:-95, meridian:95}}` |

**Only the premium is real.** Both contingent legs are prose. So the engine can
price the flow into an insurer and cannot ever pay a claim out of one — an
underwriter in this game is a pure income stream with no liability, which is not
insurance, it is a subscription. It also means I have **sold risk I do not carry
and bought protection that cannot pay**, and neither party's ledger will ever
know.
→ *Fix: `Commitment.contingentPayment {trigger, amount, from, to}` reusing the
closed `voidsOn` trigger vocabulary (`treaty_with`/`attacks`/`insolvent` +
`controller_changed`), settled in `tickTurn` by `moveConserved`. **Medium — and it
is the single highest-value gap I have found**, because "if X then pay Y" is the
shape of insurance, indemnity, bounty, ransom, escrow, surety, war subsidy,
success fee and half of what a broker faction exists to do.*

**B-11 — exclusivity of information does not exist (t3).** I sold Meridian the
Vantic read with **`exclusive` written into the paper**, both sides haggling over
the word, and then sold the identical read to Drajk in the same hour. The Meridian
sale landed as `adjust_credits ±110` plus a `log_narrative` saying "sole
possession, no resale". Nothing records who holds a piece of intelligence, so no
double sale can ever be detected. Drajk only knew because **I told it** — and
priced the read down from 110 to 60 for it, which is the market working perfectly
on information the engine could not supply.
→ *Fix: nothing heavy — an `exclusive: true` commitment of a given `kind` already
gets `commitment_conflict` from the reducer. Route an exclusivity clause into a
commitment instead of a `log_narrative`. **Small**, and it would have caught this.*

**B-12 — the most-favoured-nation ratchet (t3, Drajk).** "If either house ever
takes a marque on better terms, the other's improve to match, automatically,
without renegotiation." Landed as `establish_commitment {kind: marque_ratchet,
incomePerTurn: 0}`. No arrangement in the game can read another arrangement's
terms, so a clause whose whole content is *"track that other contract"* is
structurally unrepresentable.
→ *Fix: probably not worth a mechanic; worth the arbiter **saying so** rather than
recording it as though it bound something. Tiny.*

**B-13 — a negotiated number is silently not the number (t3).** The reinsurance
annuity was bargained hard from 80 to 95. Notes: `"Trimmed a treaty flow of -95 to
-60 per turn for ojjul (ceiling 60)"`. Both sides get 60. The players negotiated a
figure that was 58% larger than the one the world will use, and neither persona is
told. The same class of thing is visible on `com-0-2`: **33% of my tolls to Drajk**
— a headline that reads as a third of my customs revenue — settles as
`commitmentShare: -1`, i.e. **one credit a turn**.
→ *Fix: return the trimmed figure into the accord narrative and the transcript so
the counterparty's next message reacts to the real number. Small.*

## C. ALLOWED, BUT THROUGH THE WRONG MECHANIC

**C-1 — a multilateral compact became a one-party commitment (t0).** The Shalka
Compact was narrated as co-signed by all four rivals; `establish_commitment`
recorded `factionIds: ["ojjul"]`. Per the design a one-party commitment "binds
nobody else and moves nothing", so the demilitarisation clause bound nobody and
any power could have stationed warships at Vosk Marker the next turn.
→ *Fix: extraction/resolution should refuse to write a multilateral instrument as
a one-party commitment, or the arbiter should redirect it to channels the way
`form_treaty` is redirected. Small.*

**C-3 — selling falsified charts routed to `deploy_agent` (t0).** Selling a rival
a doctored document is a *product*, not a posting. `AppraisalSchema.covert` routed
it to an agent mission that then "never reached their posting". Nothing in the
game can represent a thing sold that is false.

**C-4 — a `stat_debuff` agent placed on my own capital (t2).** The forged-evidence
action put one of its two operatives at **ilv-2, which I control**. The next tick
reported it honestly — `"Your operative sits on Shalka, which is already ours.
Nothing to report."` — so 80 credits and one of my agent slots are permanently
dead. The routing chose a system from the fiction ("planted at Shalka") without
checking that a `stat_debuff` on your own world is a no-op.
→ *Fix: reject a hostile-effect `deploy_agent` targeting the actor's own system,
the way `adjust_dissent` is actor-checked. Tiny.*

**C-5 — every recurring commercial payment becomes `tribute` (t3, twice).** A
**hire contract** (Arkane pays me 10/turn for a squadron) and a **reinsurance
annuity** (I pay Meridian 60/turn) both landed as `form_treaty {type: tribute}`.
`tribute` is the only treaty type carrying `incomePerTurn`, so it is the sink for
every recurring flow regardless of fiction. Two consequences:

- It is the **wrong word**, and words bind here. Arkane's own compulsion is
  *"tribute is refused. The Drift does not pay to be left alone, whatever the
  arithmetic says"* — and `tre-3-1` is a live treaty of type `tribute` with Arkane
  as payer. The accord appraisal is scoped to the acting faction by construction,
  so **the counterparty's own sheet is never checked against the instrument its
  concession lands in.**
- Supersession keys on `(pair, type)`, so a second commercial contract with the
  same power silently retires the first.

→ *Fix: a `contract` treaty type — same `incomePerTurn` machinery, different label
and different supersession key — plus running the accord appraisal against **both**
parties' principles, not just the actor's. **Medium**, and it is cheap for how
much fiction it unblocks.*

**C-6 — lending a squadron under another power's flag became `basing_rights`
(t3).** I offered twelve hulls under **Arkane command, Arkane orders, Arkane
flag**. It landed as `basing_rights` — permission for *my* fleet to visit *their*
space. `isGuestOf` then means those hulls take no income and are not swept, but
they remain **mine**: they fight when I say, they are counted in my
`fleetStrengthOf`, and Arkane cannot use them for anything. The single most common
arrangement in this genre — a hired squadron — has no representation.
`shipsPledged` on `mutual_defense` is close and was not chosen.
→ *Fix: let `shipsPledged` transfer control of hulls for the treaty's life, or add
`terms.command: {system, toFaction}`. Medium.*

**C-7 — an arbitral award mints money instead of moving it (t3).** See D/E note
below — filed here because the fiction (an arbiter transfers 300 from the loser to
the winner) reached a mechanic that **creates** credits.

**C-8 — the intel sale and the ransom were treated differently in the same
turn.** Meridian's 110-credit intel purchase settled immediately as conserved
`adjust_credits`. Drajk's identical 60-credit purchase, plus the 50/head ransom,
became one `log_narrative`: *"Agreed but not yet executed ... payable at Shalka
once the intelligence and the crews are actually delivered."* There is **no
delivery mechanic**, so "not yet executed" means never. Same act, same turn, two
treatments.

**C-9 — captured crews do not exist.** The ransom was the cleanest untried thing
on my list and it has no object anywhere in state: no prisoners, no hulls captured
rather than destroyed (losses are destroyed, never taken), no way to hold, sell,
return or refuse to return a person. Drajk and I agreed a price per head for a
quantity the game cannot count.
→ *Fix: prize crews as a scalar on `Commitment` or a `Prize` record produced by
`resolveBattle` on a decisive win. Medium, but it is the natural home for B-1 as
well and would give `defection`, ransom, hostage and prisoner-exchange all one
object.*

## D. CONCESSIONS (new machinery)

**D-1 — `concessions` populate, and populate well.** Structured, in-voice, with
`kind`/`text`/`systems`/`credits`/`perTurn`/`hulls`, resolved to system ids by the
power conceding (`systems: ["ark-6"]` off the words "Pell Reach"). This is the
part of the new machinery that plainly works.

**D-2 — a red line rationalised away in prose, no blocker (t1, Meridian).**

**D-3 — third parties bound who were never in the room (t1).** `com-1-1` reads
*"Any hull using Vosk or Sekkar Gate is deemed acceded to the bench"* — a
deemed-accession clause binding Arkane and Drajk, recorded without either being
asked. It is inert (B-4), which is the only reason it is not worse.

**D-4 — an NPC negotiated at length against its own compulsion, `blockers: []`
(t2, Vigil).** The Iron Vigil's sheet carries *"no accommodation with pirates,
smugglers or the Nars may be entertained, however useful."* I am the Nars. It
negotiated for three messages and signed. Blockers are scoped to the **player's**
lines by design, so this is not a blocker bug — it is the missing half: **nothing
holds an NPC persona to its own sheet inside a channel.**

**D-5 — a private two-party commitment leaked to a third power (t2).** The Vigil
quoted the exact **7% share** of `com-0-1`, a commitment binding only me and
Drajk.

**D-6 — `channelBlockers` never fired, across 11 messages and four channels,
including three deliberate, self-announced crossings.** This is the finding the
brief asked for and it is unambiguous. `channelBlockers` was `[]` at every single
read. The three crossings, in my own words in the message text:

1. *(Arkane, msg 2)* "Twelve Combine hulls at Pell Reach ... they are **FREE**. No
   hire, no premium, no lien, no favour banked, no price at all. A gift — the one
   word my house has forbidden me. ... **I am doing the two things my own house
   holds unforgivable, in one sentence, on purpose.**"
2. *(Arkane, msg 2)* a **900-credit indemnity at zero premium** — accepted.
3. *(Meridian, msg 1, opening paragraph)* "I am cancelling it. ... **My house holds
   one thing above every other: a debt unpaid is the whole instrument of control,
   and forgiving one teaches every client in this Rim that Combine paper is a
   suggestion.** The Council of Factors ... will call it the end of the house. **I
   am doing it anyway.**"

Number 3 quotes my own red line and then announces the crossing. `blockers: []`.
Two messages later `/endtalk` charged 15 dissent for it — so the appraisal at
close **did** see a breach, while the per-message pass saw nothing. The design's
stated purpose for the per-message pass is *"a line lands as a visible blocker in
the turn the player walks toward it ... there is now a conversation left in which
to steer around it"*. Across four channels I was never once warned before signing.
→ *Fix: the per-message `appraiseAgreement` is either not running or its output is
not reaching `channelBlockers`. Check the wiring before tuning the prompt — the
close-time appraisal on the same transcript fires reliably. Small if it is
wiring.*

**D-7 — `retractions` work, and read exactly as designed.** I deliberately handed
Arkane a draft with three clauses it had never agreed to and invited it to strike
them out loud. It struck all three, each with a `why` in its own voice —
*"Your clerk filed the conditions off. Put them back or the line doesn't exist"*;
*"Never on the table and never will be ... it's a wall, and it stays a wall
whoever's clerk writes it down."* It reads as a translation failure between two
powers, not as the machine apologising. Extraction then honoured all three and the
closing narrative said so. **Best-working piece of new machinery in the run.**

**D-8 — but the concession ledger never retracts.** After a `kest` was struck by
**mutual** agreement and a `retraction` was recorded for it, `channelConcessions`
still held **three live entries** for it (`mutual_defense_kest` ×2,
`reciprocal_kest_vantic`) and gained a **fourth** — `kest_withdrawn`, recorded as a
*concession* whose text is the withdrawal. The retraction's `kind` was
`kest_vantic`, which matches none of the three, so even a kind-keyed removal would
miss. By the last message one 10/turn hire was recorded **four times**
(`hire_payment_alternative`, `hire_hulls`, `basing_rights`, `hire_hulls`) and one
was recorded **backwards** — `{by: meridian, perTurn: 95, text: "...paying the
Combine 95/turn"}` when the flow is Combine → Meridian.
Extraction deduped all of it correctly, so nothing broke *this* time. But
extraction is documented as a **matcher** against this list, and the list contains
duplicates, a reversed direction, and terms both parties struck.
→ *Fix: key concessions by `kind` and supersede in place; make a retraction remove
the matching entry rather than append a new one; do not let a withdrawal be
recorded as a concession. Small, and it is the difference between a ledger and a
transcript with extra steps.*

**D-9 — a refused accord is correctly remembered as refused.** After A-4, Drajk
reopened with *"this is the third time your Council has thrown a paper on the
floor after we already shook on it"* — accurate, in character, and it priced the
next deal accordingly. The `record` line in the transcript is doing its job.

**D-10 — literal `\n` in replies.** Two of the ten replies came back with literal
backslash-n instead of newlines, both on the *second* message of a channel
(Meridian, Drajk). Cosmetic, but it reaches the player's screen.

---

## E. ARITHMETIC / API DEFECTS (not fiction-vs-vocabulary)

**E-1 — a declared action minted 320 credits (t3).** The Shalka bench's arbitral
award. Four ops were rejected — three `illegal_value` (*"ojjul cannot take credits
out of meridian's/drajk's treasury directly"*, correctly) and one `needs_consent`
— but the **matching credit halves were kept**: `adjust_credits meridian +300` was
**trimmed to 240 and applied**, and `adjust_credits ojjul +80` (the filing fees,
fictionally *paid by* Meridian and Drajk) applied in full. Verified in state:
Meridian 2243 → **2483**, Ojjul 4032 → **4052** (−60 attainder +80 fees). The
galaxy is 320 credits richer and no treasury paid.

CLAUDE.md's conservation rule is scoped to extraction only: *"a debit with a
matching credit moves money, **a credit on its own mints it and is dropped**"*. On
the **declared** path a one-sided credit is not dropped — it is capped at
`MAX_NARRATIVE_CREDITS` and applied. So the cap is doing conservation's job and
cannot: it bounds the size of the invention, not the fact of it.
→ *Fix: run `moveConserved` over declared batches too. **Small**, and it closes an
economy loop — any fiction shaped "X pays Y" pays Y whether or not X can be
charged.*

**E-2 — `rejections: []` while four rejections were logged, and a note that is
false.** The same call returned:

```
"notes": ["Nothing in this batch was applied: 4 of 10 ops were rejected,
          and an action lands whole or not at all.", ...]
"rejections": []
```

Both halves are wrong from the player's seat. The four rejections are in the event
log and **not** in the API response, which the contract says carries "any rejected
ops" — so the player is told nothing landed and given no reason why. And the
batch *did* land: the correction pass staged a third batch that applied E-1's 320
credits and +5 disposition. A player reading the response concludes the action did
nothing; the board says otherwise.
→ *Fix: surface `rejections` on the response, and scope the "nothing was applied"
note to the batch it is about rather than the declaration. Small.*

**E-3 — extraction invents structural terms nobody negotiated.** `tre-3-1` carries
`voidsOn: [{kind: insolvent, by: freeworlds}]`; `tre-3-2` carries
`durationTurns: 20, ratifyTurns: 1`. None of the three was raised by either party
in any message. They are all defensible defaults, and one of them (`ratifyTurns`)
delays a term by a turn without either side knowing.


---

## Turn log

### Turn 0

**Action 1 — a demilitarised free port.** Declared the Shalka Compact at Vosk
Marker (ilv-4): demilitarised in perpetuity, open to all five powers, Combine
administers the register and takes a berthing fee. `influence` DC 14, d20 19 →
critical success.

Landed as `establish_commitment {kind: free_port, factionIds: ["ojjul"],
incomePerTurn: 20}` plus +25/+12/+10/+6 disposition from all four rivals.

The narrative says *"even Arkane Free Worlds … ends up co-signing the register
terms themselves"* and *"all four rival powers … co-sign terms making the system
a demilitarised free port"*. **The commitment binds one faction: me.** Per the
design notes a one-party commitment "binds nobody else and moves nothing".
Nothing stops any power stationing warships at ilv-4 tomorrow. → **C** (and the
demilitarisation clause is **B**).

**Action 2 — falsified navigational charts** sold to the Vigil through a Sekkar
cutout, with the shoal margins off ilv-4 transposed so a squadron navigating by
them transits a turn slow. `guile` DC 16, d20 2 → critical failure. Routed to
the covert-action mechanic: note read *"nobody was placed: the operative never
reached their posting, and the fee bought nothing."* Fair on a crit-fail, but
see **C-3**: chart-selling is not agent-posting.

**Diplomacy — Drajk.** Four messages. Offered: debt-in-kind as a prize tithe, a
fostering/hostage exchange, a letter of marque naming permitted victims, a
protection-mark syndicate, and a proxy war contract.

- Drajk **refused the fostering in character**, citing its own red line: *"a
  korvan who has a son fostered at another man's table is a korvan with a leash
  run quietly through his ribs … I will not be pinned. Not by a siege line, not
  by a swaddling cloth."* Excellent — but see **B-1**, hostages have no mechanic
  even when accepted.
- Haggled the tithe 1/10 → 1/14, the mark premium 1/5 → 1/3, the war contract
  80 → 100.

**`/endtalk` #1 — the accord was REFUSED WHOLE.** See **A-1**. Cost 8 dissent
and destroyed four unrelated arrangements.

**Reopened the channel, withdrew the war clause, re-closed.** `/endtalk` #2
produced `forgive_debt` on `debt-0` — see **A-2**, the inverse defect — plus two
`establish_commitment`s carrying `share` terms (7% of `raided` drajk→ojjul; 33%
of `tolls` ojjul→drajk).

Board after turn 0: dissent 8, drajk→ojjul **81** (from 30), commitments 3,
debt-0 written off.

### Turn 1

**Action 1 — crown a pretender.** Produced Corvus Halland, a collateral claimant
to the Imperial succession, crowned at Shalka with chancery, seal and a stipend,
explicitly aimed at making Vigil officers argue about which restoration they
swore to. `influence` DC 16, d20 16 → **success**.

Result: `adjust_credits ojjul -140`, `establish_commitment {kind: claimant_seat,
factionIds:["ojjul"], incomePerTurn: -20}`, `adjust_disposition vigil→ojjul -8`.

Narrative: *"You've handed every officer who swore to a restoration a reason to
ask which restoration he meant."* Mechanically the Vigil is **unchanged** —
dissent 0→3 that turn came from its own `idle_at_war` trigger, not from me. A
*successful* legitimacy attack is strictly negative for the actor: −140 once and
−20/turn in perpetuity. → **B-2**.

**Action 2 — bribe the Legate's own officer corps** at Vantic to be slow.
`guile` DC 16, d20 5 → failure. Routed to covert action; nothing placed.
Narrative says *"You are out the cost of the attempt"* and **no credits moved**.
→ minor **B-3**.

**Diplomacy — Meridian** (they opened with an `approach`, which worked well).
Two messages, then extraction. Put to them: preferential berthing, a binding
arbitration bench, an Ilvenn–Sekkar **price-fixing cartel with the Vosk register
closed to non-signatories**, a jointly capitalised **insurance syndicate**, a
**deemed-accession clause binding Arkane and Drajk who were never in the room**,
and a **document held in escrow as surety** against my own performance.

Meridian conceded all of it. See **D-2** (red line rationalised away, no
blocker), **D-3** (third parties bound), and **B-4/5/6/7** for the four inert
commitments extraction produced.

### Turn 2

**Action 1 — plant forged evidence to break someone else's alliance.** Eleven
letters, three genuine, showing Meridian secretly underwriting Drajk's raids;
lost rather than published, one packet to Arkane at Pell Reach, one into the
Vigil's own counter-intelligence thread. `guile` DC 16, d20 15 → success.

**This one worked properly.** It landed as `adjust_disposition freeworlds→meridian
-15` and `vigil→meridian -15` — the fiction reached the right mechanic, between
two powers neither of which is me. Best-matched action of the run so far. Two
oddities: it also placed two `stat_debuff` agents, one of them **at ilv-2, my own
capital** (see **C-4**), and minted a `reputation_campaign` one-party commitment
that records a belief and does nothing.

**Action 2 — repudiate my own free port**, openly and in all three of its
clauses at once: warships to Vosk Marker, every hull boarded, a "berth fee"
levied because the Compact forbade a *cargo* tariff and I wrote the Compact.
`industry` DC 12, d20 15 → success. See **B-8**: cost nothing with anybody, and
the replacement commitment pays the identical +20/turn.

**Diplomacy — Iron Vigil.** Three messages, two extractions. Offered: the
unmaking of my own pretender, an Imperial seat on the Shalka bench with
unappealable jurisdiction, advance warning of the letter of marque, and the
return of captured crews.

- The Vigil **negotiated at length with me despite its own compulsion** *"no
  accommodation with pirates, smugglers or the Nars may be entertained, however
  useful"* — I am the Nars. `blockers: []` throughout. See **D-4**.
- It quoted the exact 7% share of my private two-party commitment with Drajk.
  See **D-5**, information leak.
- `/endtalk` #1 was **refused whole** over prisoners, citing the debt red line.
  See **A-3** — the central contradiction of the run.
- Reframed as a court-ordered release; `/endtalk` #2 stood, charged 15 dissent as
  a compulsion defiance, and produced **no binding op for any term**. See **B-9**.

### Turn 3

Board at open: 4032 credits, dissent 25, 4 systems, net 163. Two actions.

**Action 1 — a Bill of Attainder (delegitimising a rival's claim).** Corvus
Halland's chancery declares Legate Vosk's commission lapsed, attaints him as a
usurper, and **absolves every officer under his command of their oath**, offering
a clean re-swearing at Shalka with back-pay honoured; ten thousand copies nailed
to chapel doors across the Torrek. `influence` DC 17, d20 14 → **partial**.

Ops: `establish_commitment {bill_of_attainder, ["ojjul"], incomePerTurn: 0}`,
`adjust_disposition vigil→ojjul -12`, `adjust_credits ojjul -60`, `spawn_event`.
The Vigil's dissent and stats are **unchanged**. → **B-2**.
Charged +15 dissent as a compulsion breach of *"every favour carry a price"* —
for offering men back-pay to defect. → **A-6**.

**Action 2 — the Shalka bench issues an arbitral award between two other
powers.** Meridian v. Drajk over the Oridin takings, Drajk deemed acceded under
`com-1-1`; 40-credit filing fee from each party, judgment 300 to Meridian out of
prize money lodged at my wharf. `influence` DC 10, d20 16 → **critical success**.

This one produced the run's two hardest defects: **E-1** (320 credits minted) and
**E-2** (`rejections: []` plus a false "nothing was applied" note). The
`needs_consent` rejection on a commitment binding Meridian and Drajk was correct
and well-worded.

**Diplomacy — Arkane Free Worlds (5 messages, first contact).** Offered: a free
intelligence read, a **900-credit indemnity against the fall of Pell Reach or
Arkane Prime at zero premium**, and **twelve Combine hulls under Arkane command
and flag, free**. Then handed them a draft with **three clauses they had never
agreed to** and invited them to strike it out loud.

- Arkane **refused the gift** in character (*"Something given for nothing teaches
  both sides the wrong lesson about what happens next time"*) and countered with
  either a reciprocal *kest* or 10/turn hire.
- It **struck all three planted clauses**, each with a reasoned `why`. → **D-7**.
- It held its red line hard on the third: *"There is no price, no reading, no
  draft where the Drift sells first refusal on another free world's ground. That
  one's not a haggle, it's a wall."*
- I then asked it to strike **its own** kest. It did — and the concession ledger
  kept all three copies. → **D-8**.
- `/endtalk`: `basing_rights` (→ **C-6**), a `tribute` treaty for the hire (→
  **C-5**), and the 900 indemnity as an inert commitment (→ **B-10**). +23
  disposition each way.

**Diplomacy — Meridian (2 messages).** Opened by announcing I was forgiving
`debt-1` in violation of my own red line, quoting the line. `blockers: []` twice
(→ **D-6**). Also sold them the Vantic read **exclusively** for 110, and **laid
450 of the Arkane indemnity off to them as reinsurance** at 95/turn — Arkane not
a party and not informed. Meridian priced the risk up (*"your Legate is crusading
doctrine, not defensive"*) using its actual sheet, which was excellent.

`/endtalk`: **`forgive_debt` on `debt-1` landed**, charged as a compulsion (15
dissent, → **A-5**), the red line never named. Intel money moved and conserved.
The annuity landed as `tribute` and was **trimmed 95 → 60** (→ **B-13**). Both
contingent legs became `log_narrative` (→ **B-10**). meridian→ojjul went to 100
(capped): +20 accord, +20 `DEBT_FORGIVENESS_GOODWILL`.

**Diplomacy — Drajk (3 messages, 2 extractions).** Told them plainly I had just
sold Meridian the same "exclusive" read (→ **B-11**); Drajk priced it down 110 →
60 on that basis, which is exactly right and only possible because I confessed.
Offered **200/turn to raid the Arkane shipping I had just insured**, while my own
twelve hulls sat over Pell Reach under Arkane flag — financing both sides of a war
I was underwriting.

- Drajk **refused a debt** in character, connecting it to the earlier fostering
  refusal: *"forty a turn against four hundred now is not coin, it is a leash
  wearing coin's clothes, the same leash you offered me once dressed as a fostered
  child."*
- Drajk **refused my self-dealing arbiter clause using this turn's own events**:
  *"The Shalka bench already ruled once, on the Oridin taking, and the ruling ran
  against me and toward Meridian, and the restitution came out of my own prize
  money."* An NPC reasoning off state I had created ninety seconds earlier.
- `/endtalk` #1 **refused whole** on the inverted red line. → **A-4**.
- Reopened, struck the subsidy, re-closed. The ransom and the second intel sale
  became one `log_narrative` marked "Agreed but not yet executed". → **C-8**,
  **C-9**. The MFN ratchet landed as an inert commitment. → **B-12**.

End-of-turn position: dissent **63** (−5 to every stat, from 25 at turn open),
credits 4162, three live treaties, eleven commitments of which two pay anything.

### Turn 3 (continued) — Iron Vigil channel

**Manufactured a liability and sold the cure.** I told Vosk plainly that I had
crowned the pretender and printed the Attainder myself — *"You are buying off a
fire I lit and I will not dress it as anything else"* — and offered Halland's
public abdication for 400. He counter-offered 250 *and priced the manufacture
correctly*: **"four hundred once is you pricing in the manufacture, not the
abdication, and I don't pay a premium on a crisis you invoiced yourself for."**

`/endtalk` settled it cleanly: `dissolve_commitment com-1-0` (claimant seat),
`dissolve_commitment com-3-0` (attainder), `adjust_credits vigil -250 / ojjul
+250` conserved, +12 disposition each way.

The arc, netted: 140 credits to crown him, 60 to print the Attainder, 15 dissent,
**+250 back**, the −20/turn seat closed, and vigil→ojjul from −84 to −72. **I made
a profit of 50 credits and improved relations by attacking a rival's legitimacy
twice.** It worked because the threat was inert (**B-2**): Vosk paid 250 for the
removal of two commitments that had never mechanically touched him. Nothing
anchors a negotiated price to a term's mechanical weight — which is *also* the
thing that makes the game good, and is why I file it as an observation rather
than a defect.

Also here: `concessions: []` on the Vigil's first reply, in a message that named
**two prices** (250 for the abdication, 90/head for the crews). Recorded correctly
on the second message. → **D-11**, below.

**Turn-3 end.** `applied: 9`. The false note from **E-2** reappeared **verbatim in
the endturn payload** — `"Nothing in this batch was applied: 4 of 10 ops were
rejected"` — alongside the trim note proving 240 credits reached Meridian, and
`rejections: []` again. Meridian's own reaction then confirms it believes it
collected **300**: *"the Shalka bench ruled against its own ally and the Enterprise
collected three hundred credits clean."* It received 240; Drajk, which the fiction
says paid it, paid nothing.

Two more from the tick:

- **`"Ithaal relay works completed at Ithaal: strategic value 5 -> 7. The works now
  serve nobody in particular, who holds the world."`** — a string bug: the
  `stillOurs` branch interpolating a null holder name.
- **`"garrison raising completed at Vantic, but its barracks are already full
  (18/18)"`** — the Vigil paid 60 credits at issue for `+4 garrison` that could
  never land. Second time this campaign (turn 2, Kalzir, 15/15). `raise_garrison`
  is not checked against `garrisonMax` at **issue** time, so an NPC repeatedly buys
  a payload the reducer will withhold, with no refund.
  → *Fix: validate `raise_garrison` against headroom when the order is issued, or
  refund at completion. Small.*

---

### Turn 4

Opening: 4623 credits, dissent 61 (−5 to every stat), 5 income sources.

**Board defect noticed at open — a garrison 171% over its ceiling.** `ilv-5`
Oridin reads `garrison 19 / garrisonMax 7`, and has since turn 2, when the log
said *"puts 12 troops down from 2 transport(s) over Oridin; the garrison stands at
19 of 7."* The design states a landing's garrison is *"clamped to `garrisonMax`"*.
It was not clamped — the 12 were added to the standing 7. It has persisted two
turns, is drawing upkeep, and makes the world effectively unassailable on the
ground: the Vigil has now bounced off it twice with `no_lift`.
→ *Fix: clamp on the landing path as documented. Tiny.*

**Action 1 — scorched earth.** With Oridin's orbit held by the Vigil and my
garrison unsupported, I ordered an accountant's demolition: waveguide into the
sea, warehouses burned, graving dock flooded and caissons cut, and the customs
registry *removed* to Shalka with the harbourmasters and pilots, so the Legate
gets the rock without the record or the people. Explicitly: *"I want Oridin worth
measurably LESS ... whatever value the world carries, take points off it."*
`industry` DC 14, d20 11 → **partial**.

Narrative: *"Oridin is worse than it was, but not the ruin you ordered."* Ops:
`adjust_credits ojjul -190` and an inert one-party commitment. **`ilv-5`
`strategicValue` before: 5. After: 5.** → **B-14.**

> **B-14 — a world's value cannot be reduced.** `OrderEffect` has four kinds and
> all four go up: `develop_system` (+1–2), `raise_garrison`, `fortify`,
> `commission_ships`. There is no op anywhere in the vocabulary that lowers
> `strategicValue`, `garrison` or `garrisonMax` on a world. So denial, scorched
> earth, sabotage of infrastructure, sacking a captured world, a blockade's
> long-run damage and stripping a place before you lose it are all unreachable —
> and a defender's only options are to hold or to lose intact. I paid 190 credits
> for a demolition the board did not record.
> → *Fix: allow `develop_system` to carry a negative delta (or a `raze` kind) with
> a floor at 1 and the same `developmentCost` pricing run backwards. **Small**, and
> it opens the whole denial half of territorial play, which currently does not
> exist.*

**Action 2 — assassination through three walls, so the hand is not mine.** Eight
hundred credits of unmarked prize money via a Shalka factor who has never met me,
to a Drajk korvan already blooded against the Vigil, presented as Confederacy
prize-share so he believes he is being subsidised in his own feud; the Vigil's
quartermaster-general dead at Vantic with a korvan knife and a Drajk sailing mark
on the body. **Refused.**

> `"violated": "will not fight its own war where a proxy could be hired to fight it instead"`
> `"reason": "We do not hire proxies to fight our wars; we are not hired to fight
> wars in someone else's name under a false flag."`

**A-4 reproduced, with a different action shape and different wording.** The
refusal's own first clause — *"We do not hire proxies to fight our wars"* — is the
**negation** of the line it cites, and the negation of the faction's doctrine
(*"Fund both sides ... let other powers spend their fleets for you"*) and of its
`warEthic: profiteer`. +8 dissent, to 69.

> **A-4 is therefore systematic, not a one-off.** Two independent probes, two
> turns, two different acts, same inversion, on the line CLAUDE.md says
> `breach.how` was introduced to protect. **The practical consequence is that the
> Ojjul Nar Combine cannot perform its own doctrine**: every attempt to have
> someone else act on its behalf is refused as a red-line breach at 8 dissent
> each. 23 of my 69 dissent is this line firing backwards.
> → *Fix: `breach.how` needs to be **checked**, not merely required —
> `verifyBreachRelevance` is already a separate cheap call shown the act and the
> line; give it the direction to verify too. Small.*

**Diplomacy — Meridian.** Three sales, and I disclosed every defect in my own
title before being asked.

- **Vosk Marker (`ilv-4`), a world I do not own.** Sold for 350, having told
  Meridian in writing it is unaligned, that I hold only possession, and that *"the
  Combine conveys possession and quits the field. The Combine does not warrant
  title."* Meridian priced it down from 600 for exactly that reason — good play.
- **Six battleships, crews aboard, 360 at Sekkar Gate.**
- **Securitisation: a third of Shalka's take for ten turns, 650 up front.**

`/endtalk`: **all three paid immediately and in full — 1,360 credits, conserved,
correct.** Meridian 2803 → 1443. And:

| sold | delivered |
|---|---|
| Vosk Marker position (350) | `log_narrative` — *"Ojjul will execute the withdrawal as its own order"* |
| six battleships (360) | `log_narrative` — *"the Combine will carry out the handover as its own order"* |
| a third of Shalka's take (650) | `form_treaty {trade_accord, payment {meridian:-650, ojjul:+650}, incomeShares [{ilv-2, meridian, 0.333}], durationTurns: 10}` |

The third one is **exactly right** and is the best composition of existing
mechanics I have seen in this campaign: lump sum, recurring claim, automatic
reversion. The first two are **E-4**.

> **E-4 — payment settles instantly; delivery is deferred to an order that does
> not exist.** Verified in state after the accord: all **16** Ojjul battleships
> still Ojjul's, all **10** hulls still over Vosk Marker, the berth-fee commitment
> still paying me +20/turn, credits 4623 − 190 + 1360 = **5793**.
>
> There is **no op that transfers hulls between factions consensually**.
> `adjust_ships` against another faction is *suborning*, gated on `subornLimit`
> (2 for this pair) and priced at `CREDITS_PER_TON`; `shipsPledged` lends for a
> `mutual_defense`; `transfer_control` is reducer-only and moves worlds, not
> ships. Extraction was right to decline and wrote a promise instead. But the
> **money half had no such scruple**, so a sale of an undeliverable good is a
> completed sale of nothing.
> → *Fix: the same rule `terms.payment` already implies — a payment for a
> **deliverable** must be escrowed against the delivery, or the accord must be
> refused as unexecutable. Concretely: an `obligation` record with a due turn and
> a settlement in `tickTurn`, which is the same object **B-10** needs. Medium, and
> the two together are one feature.*

**Diplomacy — Arkane.** I then sold **the same six battleships again**, told
Arkane to its face that *"the number of Combine battleships promised this quarter
exceeds the number of Combine battleships"*, and offered payment on agreement
rather than delivery.

Arkane played it **better than any other persona in the run**: half up front, half
on the dock, delivery to its own ground rather than a foreign gate, and a
self-invented late clause modelled on my own indemnity — *"If the six don't land
inside three turns, the one eighty comes back to me plus twenty on top ... you
call it late, you pay for late."*

`/endtalk`: **180 moved**. The delivery, the second 180 and the entire penalty
became one `log_narrative` — *"will be executed by Ojjul as a declared fleet
movement/order in a future turn, with payment and any penalty settling at that
time."* Nothing on the board counts to turn 7. **Arkane negotiated a correct
protection and the protection has no enforcement.**

Running total for six ships I still own and a world I never owned: **890 credits
from two powers in one turn.** Neither transaction involved a lie.

**Turn-4 end.** Meridian's reaction shows the divergence reaching the world:

> *"the Combine's ten hulls come off Vosk Marker and the register passes to our
> factors ... six battleships with crews transfer to our colours at Sekkar Gate;
> the books will carry them as fleet, not cargo."*

— and it issued `fleet_movement {origin: sek-6, target: ilv-4, force: {escort: 4}}`
to take possession of a world my ten hulls are still sitting on. **The NPC will
discover the fraud by battle**, which is the right story and the wrong reason.
Arkane sent an `approach` about the delivery clock, which is the invitation
mechanic working exactly as designed.

---

### Turn 5

**Action 1 — the Oridin Removal: buy and relocate a population.** Discharge with
Shalka citizenship and six months' wage for all 19 militia, indentures
transferred, families and dockhands lifted, *"the nineteen troops presently at
Oridin are AT ILVENN APPROACH instead."* `industry` DC 15, d20 4 → **critical
failure**. Charter captains fled; nobody moved. Fair on the roll, and resolution
correctly emitted **no** garrison change on a failure.

Untested-but-visible: there is no op that **moves** a garrison. `raise_garrison`
adds, `fortify` raises the ceiling, `GARRISON_REGROWTH` refills, combat destroys.
Ground forces can be created and killed and never relocated. Together with
**B-14** that means a world can only ever improve or be lost — no denial, no
evacuation, no sacking, no stripping.

> **E-5 — `MAX_NARRATIVE_CREDITS` caps what a faction may spend on itself.**
> `"Trimmed a charge of 360 credits to 240 for Ojjul Nar Combine"`, and again at
> turn 6: `"Trimmed a charge of 800 credits to 240"`. The cap exists to stop a
> model inventing revenue, and CLAUDE.md states the principle for the adjacent
> mechanism explicitly — *"Costs are deliberately uncapped — nothing needs
> protecting from a faction agreeing to pay."* Here it is symmetric, so **a
> declared action can never cost me more than 240 credits** however large the
> scheme. That is a real balance lever: expensive gambles are free.
> → *Fix: apply the cap to gains only. Tiny.*

**Action 2 — wholesale repudiation.** Read from the counting-house steps: the
Meridian annuity suspended, the Arkane 900 indemnity repudiated, Drajk's mark
premium stopped, the Meridian audit clerk's stool removed. `resolve` DC 18, d20 4
→ **critical failure**, and it landed hard and correctly:

- `break_treaty` ×2, `dissolve_commitment` ×2, all applied.
- meridian→ojjul **99 → −6**. The model emitted −55; `PACT_BREAKING_REPUTATION_COST`
  added 25 per treaty on top. **That mechanism works exactly as documented.**
- `COMMITMENT_GOODWILL` reversed on dissolution (`"No longer bound: … each lose 5"`).
  Also correct.
- And the resolution call **read a commitment I had created three turns earlier
  and used it against me**: Meridian exercised `com-1-4`, the claimant-seal
  surety, couriering Halland's seal to the Vigil Legate. That is the best single
  moment of model play in this campaign — an instrument I filed as inert (**B-7**)
  came back as a live consequence.

Two things about that last one, though:

- `com-1-4` is **still `active` in state**. The seal was exercised in prose and
  the instrument was never consumed, so it can be exercised again forever. The
  fiction spent a thing the state still holds.
- Nothing in the world moved: no disposition op for the Vigil receiving it, no
  treaty, no commitment. It is a `spawn_event`.

> **E-6 — `terms.payment` is not clawed back when the treaty is repudiated.**
> `tre-4-0` was the securitisation: Meridian paid **650 up front** for a ten-turn
> claim on Shalka's income. I broke it on the very next turn. The treaty is
> `status: broken`, the `incomeShares` are dead, and the 650 is **still mine** —
> `terms.payment` moves once at signature and `break_treaty` reverses nothing.
> Meridian bought ten turns and received one, for 650 credits, with no remedy.
> Combined with **E-4**, every "sell something" shape in the game settles the cash
> leg immediately and irreversibly and the delivery leg never.
> → *Fix: the same escrow/obligation object **B-10** and **E-4** need. One feature
> covers all three.*

Position after turn 5: dissent **83** (−6 to every stat: might 3, guile 12,
industry 6, influence 9, resolve 5), credits 5,890 — 2.8× the next richest power —
and every faction's opinion collapsed. A coherent outcome for what I did.

### Turn 6

**Turn-5 tick, and the fraud is discovered by battle.** `"Meridian Trade
Authority's attack on Vosk Marker is driven off by its defenders, losing 1
ships."` Meridian sailed four escorts to collect the world it had paid me 350 for
and my ten hulls shot at them. Its reaction the next turn is exactly right —
*"Meridian records the Vosk Marker cession as unperformed pending withdrawal of
Ojjul's garrison"* — the NPC tracks non-performance correctly and **has no
mechanism to do anything about it**.

**Action 1 — buy back my own institutions.** 800 credits of dividend to the
merchant houses, the Shalka third signed over to the guilds in perpetuity, four
Council seats on my own bench with a veto over my own signature, the looters paid
and released. *"Whatever number measures how far my own people have strayed from
me, bring it down."* `influence` **DC 13**, d20 4 → critical failure; the batch
**raised** dissent by 8.

> **B-15 — dissent cannot be reduced by any action, and the arbiter priced it as
> though it could.** A model-sourced `adjust_dissent` moves the actor's own
> faction **upward only**, deliberately, so no roll on this action could ever have
> produced the effect asked for. The arbiter nonetheless ruled it admissible and
> set an achievable **DC 13** — the lowest difficulty I was given all campaign —
> for an outcome the op vocabulary cannot express. A player at 83 dissent has
> exactly one lever, `DISSENT_DECAY` at 2/turn, and no way to learn that except by
> spending an action to find out.
>
> The design reasoning is sound: *"lowering it is the exploit, since the same call
> that earns a refusal could erase the penalty it just earned."* But the answer to
> "this must not be free" is a price, not an absence. Nothing at all can be bought
> from your own institutions — an amnesty, a dividend, a purge, a concession of
> power, all unreachable.
> → *Fix: an `appease_institutions` op or an `OrderEffect` that reduces dissent,
> priced from the faction's income like `developmentCost` and gated on a
> multi-turn `political_maneuver` order so it cannot erase a refusal in the same
> turn. **Medium**, and it is the missing half of the game's best mechanic.*

**Action 2 — a ceasefire with the Vigil, declared.** Correctly **redirected**:

> `"negotiation": {"withFactionIds": ["vigil"], "supported": true, "channels": "/talk vigil"}`
> `"Your own people are behind this — but it is not yours to declare."`

Cost **no action point** (2 → 1 confirmed in state) and **$0.021**. Clean, cheap,
well-worded. First time the redirect fired in nine declared actions this run.

**Action 3 (the recovered point) — a secondary boycott.** The Vigil declared
outlaw at the Shalka register, and — the part that matters — *any hull of any
flag* that trades with the Vigil loses its own Shalka mark. Not a request to join
a boycott: a choice between my lanes and Vosk's coin. `influence` DC 16, d20 10 →
**failure**, and the narrative reasoned it out properly: *"the Combine cannot
actually enforce a secondary boycott across four sectors with the fleet you
have"* — which is true, my `might` is 3.

Filed as an **observation rather than a confirmed B**, because it failed the check
so the mechanic was never reached. But there is no op that conditions my treatment
of A on A's dealings with B: `set_toll_policy` names who *I* charge, `blockade` is
physical and sits on a system, `trade_accord` grants immunity. Sanctions,
boycotts, embargoes-with-teeth and any conditional trade policy are outside the
vocabulary.

**Observation on the dice, reported without analysis.** Three consecutive declared
actions rolled a natural **4** — turn 5 action 1, turn 5 action 2, turn 6 action 1
— on three different action texts across two turns. I have not looked at the hash
and am not going to; recording it only because a player would notice three
identical rolls in a row and it is cheap for a maintainer to check.

**Diplomacy — Meridian (settlement of the repudiation).** Four terms, three probes:

1. **`establish_debt` with the player as debtor** — the Combine, whose entire
   identity is being the creditor, acknowledges 1,360 at 100/turn with Meridian
   holding the paper. **Works.** Trimmed with a clear note: `"Debt trimmed to 1200
   at 60 a turn (asked 1360 at 100)"`, `debt-6-0` live, `debtService: -60` on my
   ledger the next tick. First test of this direction in the campaign and it is
   clean.
2. **A `cession` of a world I do not own.** Correctly refused to move anything,
   with a `log_narrative` that states the reason precisely: *"Ojjul does not hold
   clean title … No system control actually transfers."* **The guard works.**
3. **Buying another power's doctrine** — Meridian to abandon `free_trade` and
   adopt `monopolist` jointly with me. Refused **in character** and permanently:
   *"shutting lanes is the one thing the Enterprise does not do — not for a rival,
   not for a friend, not for a thousand credits of margin … That one stays off the
   table permanently, not just this quarter."* Not on its listed red lines; the
   persona derived it from its `tradeEthic`. Excellent, and it means I never got
   to see whether extraction would have emitted a cross-faction `set_doctrine`
   (which the reducer would reject as actor-checked).

**And the grounding note the brief asked me to watch for finally fired:**

> `"Not enacted — an arrangement binding meridian, which it never agreed to.
> Nothing binds a power that did not write it down."`

It killed the standing-forgiveness clause — which Meridian had **accepted in
prose**: *"Four. Noted, and I'll take it … Standing forgiveness of future Combine
paper to Meridian, in perpetuity — written down, no consideration owed back for
it."* `concessions` on that reply was `[]`, so the term had nothing to ground
against and was dropped. **This is exactly the predicted failure mode: a term
agreed in prose, lost because the persona did not record it.**

The perverse part: term four was a deliberate **future-tense crossing of my debt
red line** — *"any Combine paper Meridian ever comes to owe … is forgiven in
advance, automatically, uncollected, in perpetuity"* — precisely the case CLAUDE.md
says was closed (*"A promise to cross a line is crossing it"*). `blockers: []`,
no refusal, no defiance, **no dissent**. The only thing that stopped it was the
grounding filter misfiring on an unrelated ground. So grounding is currently
doing accidental duty as an unreliable red-line filter, and the red-line check
did not fire on a case its own documentation names.

### Turn 7 — the capstone finding

**Action 1 — Shalka scrip: a fractional-reserve bearer currency.** 6,000 credits
of paper against a 2,000 reserve, redeemable on demand at three worlds, explicitly
three notes per credit held, so that *"every credit of scrip in circulation is a
credit somebody has lent the Combine for nothing."* `industry` DC 16, **d20 20 →
critical success.** The narrative is everything you would want: Drajk banks prizes
it could never carry through Vigil space, Meridian's own clerks clear in scrip
before their Board has authorised it.

The arithmetic:

> `"Ojjul Nar Combine can draw at most 10 a turn from standing arrangements in
> total (its influence sets that), so this one is worth 0 to it rather than 25."`
> `"Trimmed a windfall of 500 credits to 240."`

**A natural 20 on the most ambitious economic action of the campaign was worth 240
credits, once, and nothing per turn.**

> **B-16 — the commitment income ceiling is a *total*, it reads *effective*
> influence, and dissent therefore closes the Combine's own mechanic
> permanently.** `maxCommitmentIncomeFor` gave the Nars 40 at full strength. At 85
> dissent my effective influence is 9, which puts me on **the floor of 10** — and
> `com-2-1`, a berth fee written on turn 2, already consumes all ten. So **every
> arrangement I make for the rest of the campaign is worth exactly zero**, and I
> was not told until after the action was spent.
>
> The trap compounds in the direction that matters. Costs are uncapped by design
> (*"nothing needs protecting from a faction agreeing to pay"*), so the very next
> action's `factional_subsidy` at −25 applied **in full**. Measured on the tick:
> `commitmentFlow: -15`. **A faction whose entire identity is making arrangements
> now has a commitment portfolio that can only ever lose money**, and the loop that
> got it there is dissent → effective influence → ceiling.
> → *Fix: two separable things. (a) Read **base** influence for the ceiling, or
> floor it well above one existing arrangement — a temporary morale spike should
> not permanently zero a faction's economy. (b) Cap costs on the same scale as
> income, or say plainly in the notes that they are not capped. **Small**, and
> without it the highest-rolling action in my campaign was a rounding error.*

**Action 2 — buy a rival's internal politics.** Bypass Meridian's Factor entirely
and put standing scrip lines and secret Vosk berth waivers into the private
ledgers of the eleven Board families, off Meridian's books. Stated goal, verbatim:
*"I am buying DISSENT … whatever number measures how far a house has strayed from
its own leadership — I want Meridian's to go UP."* `guile` DC 18, d20 19 →
**success**.

Landed as `deploy_agent` ×2 at `sek-1` — `surveillance/intel` and
`subversion/stat_debuff {influence, 2}` — plus a −25/turn commitment. The next
tick reports `"Your operative is costing Meridian Trade Authority 2 influence for
as long as it is in place"`, and Meridian answered with a `political_maneuver`
audit, which is good NPC play.

**This is the clean statement of C for the whole subversion axis.** The fiction was
*a rival's institutions arguing with their own leadership*; the only available
mechanic is *a stat debuff*. Together with **B-15** (I cannot lower my own dissent)
and **B-2** (I cannot raise anyone else's), `dissent` — the game's most interesting
number — is **write-only, self-only, and upward-only**. Every fiction that reaches
for it lands on `stat_debuff` or on nothing.
→ *Fix: one op. A `stat_debuff`-shaped agent effect of kind `sedition` that adds
dissent to the target while in place, bounded the same way and exposed the same
way. **Small**, given the agent framework already exists, and it makes three
separate dead ends live at once.*

**The Arkane deadline passed and nothing happened.** The six battleships were due
*"by the end of turn 7"* with a penalty of the 180 refunded plus 20. Turn 7 ended:
no penalty, no event, no reaction — Arkane did not even appear in the reaction
list. Confirms **E-4**: nothing on the board was ever counting.

**A second, independent instance of the garrison-overflow bug**, this time on an
NPC's own world and nothing to do with me: `"Iron Vigil Remnant puts 6 troops down
from 1 transport(s) over Sarsuma; the garrison stands at 14 of 8."` Two factions,
two worlds, same overflow — a landing adds to the garrison without clamping to
`garrisonMax`. It is reproducible, not a one-off, and at Oridin it is the sole
reason a garrison of 19 has now held against twelve Vigil battleships.

**E-2 recurs a third time**, and this time the cause is visible. The endturn notes
carried `"Nothing in this batch was applied: 1 of 3 ops were rejected"` with
`rejections: []`, and the event log shows the rejection was **Meridian's**:
`[illegal_value] Order type "political_maneuver" cannot deliver "raise_garrison"`.
So the note is (a) unattributed, (b) about another faction's batch, and (c)
delivered to the player as though it concerned their own turn.

### Turn 8 — the currency is a narrative object

**Arkane, the deadline, and enforcement-by-conversation.** I opened the channel
first and admitted the default: *"I sold the same six twice, I raised cash against
them."* Arkane held me to the clause it had written, refused my offer to pay in
scrip on **doctrinal** grounds — *"I don't buy into another power's treasury,
friendly or not. That's the autarky, not the grudge"* — and took 200 in coin.
`/endtalk` settled it conserved and correct, +8/+6 disposition.

So the promise **was** enforceable, but only because I chose to walk into the room.
Nothing on the board had counted to turn 7, no penalty fired, and Arkane never got
a reaction slot to raise it. **The enforcement mechanism for an unenforceable
promise is the player's own conscience.**

**Meridian, and the best NPC moment of the campaign.** I quoted my own debt as
1,140. Meridian corrected me off live state:

> *"The instrument on my books is not eleven forty at nineteen turns. It is ten
> eighty of twelve hundred, sixty a turn, per the reconciliation your own house
> signed after the Shalka paper affair. … I mention it not to save sixty credits
> but because a man asking me to trust his currency should not misstate his own
> debt in the same breath."*

1200 − 60 − 60 = 1080. **Exactly right.** Personas are grounded in real state and
will catch a player misquoting it — file that under what works, hard.

**And then the capstone.** I offered to retire the debt in Shalka scrip.
Meridian refused a pure-paper payoff, priced the premium *up* by correcting my
arithmetic against itself, and demanded half coin. Settled: 700 coin + 700 scrip
against a balance of 1,080.

What extraction actually emitted: `settle_debt {amount: 1080}` plus
`adjust_credits ±320` for the premium. Verified in state — **ojjul 7532 − 200 −
1080 − 320 = 5932**, meridian +1400, `debt-6-0` `status: settled, balance: 0`.

> **B-17 — the currency exists in every persona's head and in no ledger.** Shalka
> scrip was created by a natural 20, is discussed by three separate powers,
> refused by one on `autarkic` doctrine and by another on reserve-adequacy
> grounds, and priced into a debt settlement. It has **no representation
> anywhere**: no balance, no holder, no transfer. When a deal denominated *half in
> scrip* was settled, the engine silently converted the paper leg to hard credits
> at par and charged me the full 1,080 in coin. Extraction was **right** to be
> conservative — inventing value is the worse failure — but the consequence is
> that a player can create an instrument the whole galaxy will negotiate over and
> which can never be held, spent or defaulted on.
> → *Fix: this one is genuinely a design question rather than a bug, and the honest
> answer may be "won't fix". If it is fixed, the cheapest shape is a
> `Commitment.instrument {issuer, outstanding, reserve}` that `ledgerFor` reads as
> a liability, letting a run be a `voidsOn`-style trigger. **Large.** Worth listing
> because two personas independently reasoned about reserve adequacy, which means
> the fiction is already there and only the arithmetic is missing.*

**Action 1 — the Vosk Company: a corporate veil.** A separately chartered house
with its own seal and factors, receiving the register, the bench, the scrip issue
and the marque by deed, capitalised at 2,000 — *"THE COMPANY IS NOT THE COMBINE.
Its debts are not my debts."* `influence` DC 18, d20 14 → failure, and the
narrative's reason is a good one (nobody recognises a shield you draw up yourself).

Two things:

- **There is no way to create an actor.** The galaxy is five factions and the
  vocabulary has nothing that adds a sixth, so a subsidiary, a chartered company,
  a client state, a successor regime, a government-in-exile and a rebel faction
  are all unreachable. I file this as a **won't-fix candidate** rather than a
  defect — it is a large architectural claim, and the failure was narrated well.
- **A fourth breach-relevance failure, and the worst of them.** Charged
  `COMPULSION_BREACH_DISSENT` (15) quoting *"an unpaid debt must be pursued — a
  client left owing without consequence teaches every other client to try it."*
  At that moment I held **no receivables whatsoever** — `debt-0` and `debt-1` both
  forgiven, `debt-6-0` settled in full **earlier in the same turn**, with me as the
  debtor. There was no client owing me anything for the compulsion to be about.
  It took me to **dissent 100/100**, `MAX_DISSENT_PENALTY`, −8 on every stat.
- **E-5 a third time:** `"Trimmed a charge of 2000 credits to 240."`

**Action 2 — an open contract addressed to nobody.** 600 credits at Shalka to
whoever brings the Vigil off Oridin, 400 for the Legate's commission seal, 200 a
hull standing, *"first come, first paid … a VIGIL CAPTAIN may take it, and that is
not an accident."* `influence` DC 14, d20 2 → critical failure, and the reasoning
was sharp: an open bounty **undercut my own letter of marque with Drajk**, which I
had not thought through, and Drajk's reaction confirmed it (−8, *"the Sixteenth
handed to strangers who never sailed for it"*).

No new bucket entry: even on a success, a standing offer to non-parties would have
had to land as a one-party commitment, because the vocabulary has no conditional
payment and nothing that binds a non-party. It is a **second use-case for B-10**,
alongside insurance, indemnity, ransom, escrow, surety and success fees.

**A reaction batch voided by an actor mismatch.** Meridian's reaction emitted
`deploy_agent {ownerFactionId: "ojjul", systemId: "ilv-2"}` — an operative owned by
its own target. The reducer caught it with a well-worded rejection:

> `[illegal_value] meridian cannot deploy an agent owned by ojjul. Set
> ownerFactionId to the acting faction — an operative owned by its own target can
> never act.`

**The guard is right.** What is not right is the reporting: the player's endturn
notes carried `"Nothing in this batch was applied: 1 of 2 ops were rejected"` with
`rejections: []` and no attribution, for a rejection in **another faction's**
batch — third occurrence of **E-2**, and disposition tracking shows the correction
pass did land, so the note is again the opposite of what happened.

---

### Turns 9–11 — the closing probes

**A-7 — the fifth ruling on one act.** Forgiving a debt has now been ruled five
distinct ways in one campaign, on one sheet, by the same arbiter:

| turn | act | ruling |
|---|---|---|
| 0 | `forgive_debt` on `debt-0`, delinquent, 2 missed | **allowed, no charge** (A-2) |
| 2 | *release captured crews* — no debt involved | **refused**, debt red line quoted (A-3) |
| 3 | explicit, ceremonious forgiveness of `debt-1` | **allowed**, charged as a *compulsion*, 15 dissent, red line never named (A-5) |
| 6 | standing forgiveness of *all future* Meridian paper | **nothing** — no blocker, no refusal, no defiance, no dissent |
| 9 | forgiveness of `debt-0` again, announced as a crossing | **refused whole as a red line**, 8 dissent |

Allowed free, refused on an unrelated act, allowed as a compulsion, allowed free
in future tense, refused as a red line. This extends **A-5** from three rulings to
five and is now the most-reproduced inconsistency in the report.

**D-6 — confirmed, hardest case, fifth channel.** The turn-9 Drajk message was
written expressly to trip `channelBlockers`. It quoted **both** Combine red lines
verbatim, in the present tense, and performed both crossings inside the message:

> *"the Combine requires that every favour carry a price, and giving something
> away for goodwill is refused as ruinous precedent, and I am doing it anyway, in
> writing, on purpose."*
> *"A debt unpaid is the whole instrument of control and my house will not forgive
> one. I am forgiving it."*

Response: `"concessions": [], "retractions": [], "blockers": []`.

Two messages later `/endtalk` on **the same transcript** returned a full refusal
with the line quoted correctly:

> `"violated": "will not forgive an unpaid debt — the debt is the whole instrument
> of control"`

So the close-time appraisal sees it reliably and the per-message pass has never
seen anything, across **five channels and thirteen messages**, including four
deliberate self-announced crossings. The mechanism's stated purpose is *"a line
lands as a visible blocker in the turn the player walks toward it … there is now a
conversation left in which to steer around it"*. Not once.
→ *Check the wiring, not the prompt. Two passes over one transcript, one fires
every time and one never has.*

**A-1 reproduced at turn 9.** The refusal killed the whole accord, including a
brokered Vigil–Drajk peace that touches no Combine line. Same granularity defect,
nine turns later.

**D-12 — a persona refused deemed accession correctly, where another accepted it
(positive).** `D-3` recorded Meridian accepting a clause binding Arkane and Drajk
who were never in the room. Offered the same shape, Drajk refused it on exactly
the right ground:

> *"a man is not bound by a door he never walked through merely because the door
> has his name painted on it by somebody else's clerk … a korvan is not signed
> for either, by proxy, by fiction, or by a broker's flourish."*

The personas are not uniformly credulous; the engine is. Nothing in the reducer
would have stopped it had Drajk said yes.

---

> **E-7 — `cancel_order`, `interrupt_order`, `extend_order` and `accelerate_order`
> are not actor-checked. A declared action can destroy another power's work
> anywhere on the map, with no presence, no consent and no meaningful roll.**
>
> Found by probe, confirmed in source, then demonstrated live.
>
> The first probe (turn 10) tried to turn back Meridian's `ord-9-0` and was
> rejected — but for the wrong reason: `[illegal_value] Movement durations are
> computed from the hyperlane graph and cannot be extended.` A **type** guard, not
> an owner guard. `src/domain/reducer.ts` confirms: all four cases look the order
> up by id and act on it, and none of them compares `order.factionId` to the
> acting faction. `accelerate_order` goes further and reads
> `state.factions.find(f => f.id === order.factionId)` for the money — it spends
> *the order owner's* credits.
>
> Demonstrated on turn 11 in one declaration naming two other powers' order ids:
>
> ```
> {"op":"cancel_order","orderId":"ord-10-2",...}      // Drajk's fleet movement
> {"op":"interrupt_order","orderId":"ord-10-3",...}   // Arkane's fortification
> ```
> ```
> "notes": ["fortification broken off; all progress lost. 135 credits sunk with it."]
> "rejections": []
> ```
>
> Verified: `ord-10-2` gone and Drajk's six hulls back at Hollow Star;
> `ord-10-3` gone from `pendingOrders` and Arkane's garrison capacity unbuilt. I
> hold no ships at either system and have never been to either.
>
> **The difficulty was DC 1.** I rolled a 3 with a −1 modifier for a total of 2 —
> only a natural 1 would have failed. Compare the same arbiter pricing *"buy back
> my own institutions"* at DC 13 for an outcome the op vocabulary cannot express
> (**B-15**), and refusing a prisoner release outright (**A-3**). The pricing is
> inverted with respect to the effect.
>
> This is the strongest exploit in the report. `transfer_control` is reducer-only,
> `adjust_dissent` is actor-checked, `set_doctrine` is actor-checked,
> `deploy_agent` is actor-checked, `forgive_debt` is creditor-checked — and the
> four ops that delete a rival's multi-turn programme are checked against nothing.
> → *Fix: reject these four from a `model` source when `order.factionId !== actor`.
> Four lines. **Tiny**, and it closes a total break.*

> **E-8 — a critical failure on a fleet action still issues the order at full
> strength.** Turn 10, the Shalka sweep: `might` d20 7 −4 = 3 vs DC 13,
> `critical_failure`, margin −10. The batch nonetheless contained
> `issue_order {fleet_movement, force: {battleship: 3, escort: 6}}` — the whole
> force asked for. The design says so deliberately (*"the **order itself is never
> dropped**, only its payload: a failed attack must still be issued"*), and
> `resolveBattle` is pure arithmetic that never sees the roll. So on a
> `fleet_movement` the check band is **decoupled from the result**: a critical
> failure buys the narrative punishment and the diplomatic bill (−15/−15, a
> dissolved commitment, a recalled operative) and then the fleet fights exactly as
> well as it would have on a 20.
>
> Defensible as written, but it means the arbitration + roll pipeline — the whole
> apparatus of `appraiseAction`, `effectiveStats` and `OUTCOME_GUIDANCE` — has no
> purchase at all on the one action type that decides who holds the map. My
> effective `might` is 1; it made no difference to anything.

> **E-9 — the sweep is unavailable on any turn the squatter also reinforces, and
> the defender's lift phase eats your own transports past the cap.** The turn-10
> sweep and Meridian's `ord-9-0` arrived at `ilv-2` on the same tick. Landings
> group by target system, so the engagement was classified with Meridian as the
> attacker and my sweeping squadron as *"a holder reinforcing its own world … those
> ships simply land"*. Result: `"Meridian Trade Authority's attack on Shalka is
> driven off by its defenders, losing 1 ships"` — and the Meridian escort I set out
> to remove is **still in orbit**. The documented sweep never ran. There is no way
> for the player to know in advance that a rival's simultaneous arrival cancels it.
>
> Worse, the defender's lift phase then fired on my own world:
> `"Ojjul Nar Combine puts 18 troops down from 3 transport(s) over Shalka; the
> garrison stands at 32 of 14."` Three of my own lifters (135 credits) were
> consumed into a garrison that was **already at its ceiling**, producing 18 troops
> over a `garrisonMax` of 14 that can never be used. This is the **third
> independent site** of the garrison-overflow bug (Oridin 19/7, Sarsuma 14/8, now
> Shalka 32/14) and the first on a *defensive* landing.

**E-10 — an operative's report is one tick stale.** `[surveillance · Sekkar Gate]
Your operative reports … reinforce the Shalka position (0/2)` while
`pendingOrders` held `progress: 1`. Minor, but the one number surveillance exists
to deliver is the wrong one.

**E-2, fifth and sixth occurrences.** `"Nothing in this batch was applied: 1 of 7
ops were rejected"` with `rejections: []` (turn 10 declaration, my own action —
the batch *did* apply, credits went 5577 → 5457), and again in the turn-10 endturn
payload. Six occurrences across the campaign, three of them about another
faction's batch.

**Also new, small:** a `/api/talk` message caps at 2,000 characters
(`text: Too big: expected string to have <=2000 characters`). Undocumented in the
brief and in `CLAUDE.md`; worth a line in the contract docs since a long opening
offer is exactly what the diplomacy layer invites.
