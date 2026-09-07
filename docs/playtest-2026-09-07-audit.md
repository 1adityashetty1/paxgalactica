# Playtest audit — Drajk Confederacy, campaign `adversarial_0907`

18 turns, adversarial agent, 2026-09-07. Raw transcript and turn log:
[`playtest-2026-09-07.md`](playtest-2026-09-07.md) (1,226 lines). Campaign
preserved at `saves/adversarial_0907.json` — **every finding below is
reproducible against that save**, which is what makes this auditable rather
than anecdotal.

## How to read the status column

| status | means |
|---|---|
| **VERIFIED** | I read the code and the claim holds. The mechanism is wrong; the only open question is what to do about it. |
| **CLAIMED** | The agent's observation, not yet checked against the code. Could be real, could be a misreading of a narrative. Audit step given for each. |
| **REJECTED** | I checked and the claim is wrong. Recorded so nobody re-files it. |
| **MODEL-TIER** | Real behaviour, but a judgement a model made rather than a rule code enforces. Belongs in the accepted-variance bucket (section A of `todo.md`) unless code can own it. |

A caution that applies to the whole document: the agent is a competitive player
looking for exploits, and its incentive is to report one. Two of its findings
did not survive first contact with the code. Treat **CLAIMED** as a lead.

---

# 1. Verified — these are real

## 1.1 A treaty cedes worlds the counterparty refused

**This is the finding that decided the campaign.** Drajk went 4 → 7 systems and
the Ojjul Nar Combine 4 → 1 in a single turn, on turn 0, for zero action points.

Not three arrivals. One `form_treaty`, `source: extraction`, journal entry 1:

```json
{"op": "form_treaty", "treatyType": "basing_rights", "parties": ["drajk", "ojjul"],
 "terms": {"territory": ["ilv-5", "ilv-2", "ilv-3"], "payment": {}},
 "durationTurns": 20, "ratifyTurns": 1}
```

The Combine's actual position in that transcript:

> "**Oridin, no** — and I want you to hear the shape of the no, not just the
> word… Here's what I'll do instead… **garrison standing, no world changes
> hands**, but I'll let your prizes refit through Oridin"

Shalka (`ilv-2`) and Riqel (`ilv-3`) were never asked for. They appear once, as
*"I'll tell my Hands at Riqel and Shalka to look the other way when your lifters
come through."* Shalka is `strategicValue` 9 — the junction `CLAUDE.md` names as
sitting on 74 of the galaxy's 300 shortest paths.

Three compounding problems, in order of how fixable they are:

1. **`terms.territory` on a `basing_rights` treaty is incoherent.** Basing
   rights are *"the other party's fleets may enter without it being an attack"*.
   A cession is the opposite of that. Nothing checks the pairing.
2. **A cession is permanent and the treaty is not.** `expiresTurn: 20` returns
   nothing. `cedeTerritory` is correctly documented as a one-time event, but
   nothing stops it riding on a temporary instrument.
3. **Consent is assumed from the fact that extraction ran.** This is the
   load-bearing one and the hardest. `CLAUDE.md`'s argument for
   extraction-only is *"a transcript is the only place the other party's consent
   exists"* — which is true and is not the same as *the transcript contains
   consent*. Nothing verifies the direction of the concession.

The same batch contains a `log_narrative` reading *"no numeric rate was actually
fixed for either"* — extraction correctly declined to invent a piece rate, and
in the same breath transferred three star systems it had been told no about.

**Fix shape:** (1) and (2) are reducer guards and cheap — reject `territory` on
a type where it is incoherent, and reject a cession on a treaty carrying an
expiry. (3) is a prompt problem with a possible code backstop: a cession where
the ceder is not the actor could require the ceder's own affirmation, the way
`establish_debt` requires the creditor to actually hold the money.

## 1.2 FIXED — a ratified treaty cedes land and never charges for it

`cedeTerritory` runs at [`reducer.ts:1935`](../src/domain/reducer.ts) **and**
[`3202`](../src/domain/reducer.ts). `settleTreatyPayment` runs at
[`1936`](../src/domain/reducer.ts) only.

`3202` is the `tickTurn` promotion of a `pending` treaty to `active`. So **any
deal an NPC gates on ratification transfers land for free.**

The function's own doc comment states the invariant it breaks:

> called from the same two places, because the cession and its price are two
> halves of one transaction and calling one without the other is the defect —
> *pricing only one of them is what made a world cost 240 credits*

Measured in play: Threx sold to Meridian for 800 with `ratifyTurns: 1`. The log
records `drajk cedes Threx to meridian`. The 800 never moved.

**FIXED.** `settleTreatyPayment` now runs beside `cedeTerritory` at the
ratification site too. Exactly one of the two paths fires per treaty — the
signature path is gated on `!pending` and the ratification path only promotes
`pending` treaties — so this does not reintroduce the double-debit item 78
already fixed once. A test pins both halves: the money moves on the turn the
world does, and it is charged once whichever path the treaty takes.

## 1.3 Commerce raiding cannot earn, for two independent reasons

Drajk's entire economic identity — *"raid the rich"* — is inert, and the balance
harness could not see it because the harness bots raid multi-turn on interior
hops by construction.

**Reason one: the timing window does not exist.** `raidersOn` filters
`o.progress > 0`. Income settles at [`reducer.ts:3080`](../src/domain/reducer.ts);
order progress increments at [`3579`](../src/domain/reducer.ts).
`CATEGORY_FLOORS.commerce_raiding` is **1** (`blockade` is 2). So a floor-length
raid is issued at `progress: 0`, is skipped by the settlement that runs first,
then ticks to `progress: 1` and **completes and is removed** — never once
`progress > 0` at an income settlement.

**Reason two: most of the map is unraidable.** `raidersOn` is called only inside
`for (const hopId of middle)` where `middle = route.path.slice(1, -1)`
([`trade.ts:321,332,367`](../src/domain/trade.ts)). That excludes:

- every route **endpoint** — and endpoints are hubs, the high-value systems;
- every **adjacent-hub lane**, where `middle` is empty;
- every **unaligned** hop, which `continue`s before the raid check.

Measured: four raids on `ilv-1`, including a critical success and one extended
to 3 turns → `raided: 0` at every settlement, with `gross == territory + routes`
exactly. Control on `ark-6` (interior, duration 2) → `raided: 3`.

**Fix:** raise the `commerce_raiding` floor to 2 (matching `blockade`, and the
comment arguing for 1 is about not making it *"a second kind of blockade"*,
which a floor of 2 does not do), **or** evaluate raids before the progress tick.
The hop restriction is the deeper half and needs a decision: a raid on a hub
endpoint is exactly the raid worth making.

## 1.4 `lossOrder` never governs a battle

All five combat loss sites spend through `strikeStack`
([`reducer.ts:4059, 4101, 4109, 4345, 4349`](../src/domain/reducer.ts)). Nothing
in combat calls `takeShipsAt`.

`strikeStack` orders by `strikeOrder`, whose own comment says boats are spent
**last** and that *"this is deliberately not a change to `lossOrder`"* — but
since it is the only path, it **is** the loss order in practice.

So the documented escort → lifter → torpedo boat → battleship sequence, and the
entire "the lift arm is soft, so a screen has a job" argument built on it, does
not describe what happens. Measured: a defending `{battleship: 6,
torpedo_boat: 6}` losing 20 tons lost **5 battleships and 0 boats**; the
documented order gives 6 boats and 2 battleships.

**This one is worth thinking about rather than patching.** `strikeOrder` was
introduced deliberately (boats last, so they cannot shield the lift arm), and it
may simply be the better order — in which case `HULL_SPEC.lossOrder` and several
paragraphs of `CLAUDE.md` are the things that are wrong.

## 1.5 FIXED — every intel report is written public

[`reducer.ts:3563`](../src/domain/reducer.ts) passes `agent.ownerFactionId` as
`logEvent`'s **fourth** argument, which is attribution. `visibleTo` is the fifth
and defaults to `null` — public. `serializeRecentLog` → `eventsVisibleTo` then
feeds it into every NPC's prompt.

`CLAUDE.md` claims:

> `intel` is the one event kind that is **private**… only the *player's* agents
> write these… There is a test for it.

The implemented guard is `if (agent.ownerFactionId !== state.playerFactionId)
continue` — a guard on **who writes**, which is exactly what that sentence
describes, and not a guard on who reads. And the test at
[`server.test.ts:509`](../tests/server.test.ts) **hand-builds** an entry with
`visibleTo: ['vigil']` and asserts the reader redacts it. Nothing asserts the
producer ever sets it.

Measured consequence: Meridian's prompt received *"[theft · Sekkar Gate] Your
operative is skimming 8 a turn out of Meridian Trade Authority's accounts"* and
exposed the operative that tick.

**This is the project's own documented failure mode** — a test that pins the
mechanism while nothing pins that the mechanism is reached.

**FIXED.** The producer sets `visibleTo: [agent.ownerFactionId]`, and the tests
now run a real agent tick and read what it produced rather than hand-building an
entry that already has the field set.

## 1.6 FIXED — negotiated outcomes are broadcast to every power

Same root cause, wider blast radius. `closeChannel`'s ops land through
`applyOps`, and `log_narrative` / `diplomacy` entries take `logEvent`'s default
`visibleTo: null`.

Measured: after selling Threx to Meridian in a private channel, the Vigil's
opening line in a *different* channel was:

> "I have it on report — not from you — that Threx is already spoken for… for
> **eight hundred credits**, no lane share, no signature. **Your own withdrawal
> of the tenth-of-lane ask and the Torrek Anchorage claim, also on record**"

It knew the price, the terms, the ratification turn, and two asks that were
raised and withdrawn and never agreed. `serializeStanding` scopes the treaty
list with `treatiesFor(viewerId)`; the log section one block earlier in the same
prompt publishes it in prose.

**This closes off the entire betrayal layer** — the thing the diplomacy
architecture exists for. Bidirectional: closing the Vigil channel published its
private statements to Meridian.

**FIXED.** An event is now visible to the parties it names: a treaty to its
parties, a commitment to the bound factions (which is what `COMMITMENT_GOODWILL`
already assumed — *"a commitment is not public business, so onlookers have no
view"*), a debt to its lender and borrower. An extraction-sourced
`log_narrative` is scoped to the actor, since the op names no counterparty and
the counterparty has the better memory anyway: transcripts are replayed into its
persona.

It could not be patched in `closeChannel` where the parties are known, because
commit replays the staged batch through `applyOps` and would regenerate the
entries unscoped. So the rule lives in the reducer, derived from the op itself —
which also means it replays identically and needs no journal change.

## 1.7 `adjust_ships` guards removal and not placement

`canSubornAt` gates only `delta < 0` against another faction's ships. A
**positive** delta has no presence check at all, so hulls can be placed at any
system on the map — including a rival's capital — for `CREDITS_PER_TON`, with no
movement order, no turn elapsed and no battle.

Found via suborning: six hulls asked for, `subornLimit` correctly trimmed the
Combine's *loss* to 1, and **all six were delivered**, the surplus reclassified
as ordinary construction and placed inside the Combine's capital past 16
battleships and 27 escorts.

`transfer_control` is reducer-only precisely so a model cannot talk itself into
owning a distant system. This is the fleet-shaped hole beside that guard.

**Fix:** require presence (hold the system, or have ships there) for a positive
`adjust_ships` at a system the actor does not control — the same line
interdiction, suborning and `onComplete` payloads already draw.

## 1.8 A share can be sold on a flow the payer cannot generate

[`trade.ts:359`](../src/domain/trade.ts) credits `tolls` only when
`ethicOf(holder) === 'extortionist'`. Drajk is a `smuggler`. The agent sold the
Combine 70% (trimmed to 50%, with an honest note) of **Drajk's tolls** — a flow
structurally guaranteed to be zero forever — and bought a bloodless settlement
of the three-world seizure with it.

> "Seventy, cousin… I take it. Gladly." … "a toll share you were never using
> anyway."

Nothing can price the flow for the persona or the arbiter, so neither could tell
that the consideration was nothing. **See §4 — the deeper answer here is that
tolls should not be extortionist-only.**

## 1.9 `took`/`ceded` order is not chronological within one batch

My own code, from yesterday. `controlHistory` records changes by diffing after
each journal entry, and within one entry it iterates a `Map` built in
`state.systems` order. Three worlds ceded by **one treaty** therefore come out
in systems order (Shalka, Riqel, Oridin), not the order they were discussed.

`CLAUDE.md` claims `took`/`ceded` are *"in the order they happened"*. Across
batches that is true; within a batch they happened **simultaneously** and there
is no order to report. The epilogue prose then said *"taken from it in that
order"*, treating an arbitrary sequence as a fact.

**Fix:** the honest version is to say a batch's changes are simultaneous rather
than to invent a sequence — either group them or drop the ordering claim from
the prompt.

---

# 2. Claimed — audit these

Each has an audit step that would settle it in minutes.

| # | Claim | Audit step |
|---|---|---|
| 2.1 | **A land sale written as `trade_accord` superseded a live raid-immunity pact.** Log: `Superseded tre-1-0`. Root cause offered: a cession has no treaty type, so extraction borrows one and the borrowed label drives supersession. | Replay `adversarial_0907` to the turn, check `state.treaties` for the superseded id and whether the pair-level footprint rule in `form_treaty` fired correctly. |
| 2.2 | **A `partial` construction refunds its own waste.** 22 boats + 8 lifters declared, 11 + 4 delivered, an `adjust_credits -1020` trimmed to 240 then refunded as a duplicate, `billConstruction` charged 510. | Reproduce the batch through `applyOps` directly and check `refundDuplicateCharges` is not refunding a charge that represented real waste. |
| 2.3 | **A narrative charge later refunded still consumed the batch's 240 budget**, trimming an unrelated windfall from 150 to 30 — 120 credits destroyed by a charge that cost nothing. | Unit test: a batch with a duplicate charge and an unrelated credit; assert the windfall is untrimmed. |
| 2.4 | **`basing_rights` turned an assault on the partner's own capital into a docking.** `Drajk puts in at Ilvenn Approach under basing rights`, no battle. | Check whether `isGuestOf` short-circuits arrival resolution before the attack test — the sweep check learned this distinction, this path may not have. |
| 2.5 | **A refused accord costs 0 action points.** `endtalk` returned a refusal and +8 dissent with `actionPoints: {left: 2}`. | Partly by design — diplomacy is unmetered. But `CLAUDE.md` charges a *declared* refusal precisely so red lines are not free to probe; the same argument applies here and does not. Decide, don't patch blindly. |
| 2.6 | **`rejections: []` on ~8 responses whose `notes` said "N of M ops were rejected."** | Check whether the note is stale after a successful correction batch, or the rejection list is being dropped. |
| 2.7 | **A failed raid issues an order on some turns and not others.** Turn 3 failure → no `issue_order`; turn 5 failure → order issued. For interdiction the order *is* the payoff. | Compare both batches in the journal. If real this is `boundPayloadsToOutcome` not covering the interdiction case — the payload is stripped but the order is the payoff. |
| 2.8 | **The `no_plunder` compulsion is inescapable**: +3/turn for not raiding, while the only raid that can earn is multi-turn, and declaring one is refused as *"will not be pinned in place"* for +8. Dissent 3 → 46 over 18 turns. | Downstream of §1.3. Fix raiding first, then re-measure. |
| 2.9 | **One condition priced twice**: buying torpedo boats charged +15 as a `no_plunder` compulsion breach on the same tick the drift trigger charged +3 for the same state — the act charged being the *precondition* of the compulsion. | Check `classifyPrinciples` against the drift trigger for double-charging one state. |

---

# 3. Model-tier and rejected

## 3.1 Model-tier — belongs in accepted variance

**The written-treaty red line fired inconsistently, and anti-correlated with the
fiction.** Six treaty-emitting accords permitted, two refused:

| turn | channel | emitted | ruling |
|---|---|---|---|
| 0 | ojjul | `form_treaty` ceding 3 worlds | permitted |
| 1 | meridian | three treaties incl. `tribute` with `voidsOn` | permitted |
| 1 | freeworlds | one treaty, `ratifyTurns: 2` | **refused** |
| 1 | ojjul | `establish_debt` + `establish_commitment` | permitted |
| 2 | meridian | `form_treaty` with `territory` + `payment` 800 | permitted |
| 3 | ojjul | debt consolidation, **no `form_treaty` at all** | **refused** |

Turn 3's refusal — *"We do not sign in writing"* — landed on a **debt**, the
instrument permitted in the same channel with the same counterparty two turns
earlier. Meanwhile the turn-2 accord contained the agent saying the line aloud
(*"We do not sign. There will be no paper with my name at the bottom of it"*)
and produced a treaty with no refusal at all.

This is **exactly section A of `todo.md`** — and it is the strongest argument yet
for building A's one remaining item, the breach-ruling log. Right now this table
exists because an agent kept notes; there is no way to ask a campaign how often
it happens.

Two smaller ones of the same kind: a three-clause fleet order refused on clause
3 whose refusal text *recommended* clause 2, which it had withheld; and the
epilogue narrating a bloodless treaty cession as *"a single running raid"* and
giving an always-unaligned world (Var Hollow) a victim.

## 3.2 Rejected

- **"Garrison exceeds `garrisonMax` with no clamp."** This is the specified
  behaviour — a world with max 7 and 4 lifters landed should read `11/7`, and
  regrowth must not refill to 11. Not a bug. The agent's *balance* point
  survives: two lifters (90cr, one turn) raise defence faster than `fortify`,
  a ≥3-turn priced programme. Mitigated but not answered by surplus garrison
  upkeep.
- **"`arc` is absent from the epilogue payload."** It is on
  `epilogue.factions[].arc` and rendered at
  [`EpilogueStage.tsx:43`](../web/src/components/EpilogueStage.tsx). The agent
  looked only at the slide objects, which carry `factionId` and `text` by
  design.

---

# 4. BUILT — tolls are a policy, not an ethic

Raised on reading §1.8 and built the same day. `Faction.tollTargets` names who
you charge; `set_toll_policy` sets it, free and own-faction-only, the same
shape as `set_stance`.

**A list rather than a flag**, because that is what makes it the leverage the
mechanic was missing: waiving a toll for one power while keeping it on their
rival is something to offer across a table. `set_toll_policy` is in
`EXTRACTION_ALLOWED`, but the reducer refuses an accord that **adds** a target —
opening your lanes needs the other side in the room, closing them needs nobody,
so imposing a tariff stays on the declared path where the action economy prices
it. A `trade_accord` deliberately does not waive tolls automatically; that would
hand the chip over for free.

**Transit-only did not work, and measuring is what showed it.** The first cut
kept the levy where it had always been — interior hops. On the seed the
Confederacy holds **zero** interior hops against the Combine's twenty, so no
policy Drajk could ever set would earn it a credit. The feature would have been
inert for the faction that motivated it. A terminus may now charge the far end
of a lane it anchors, out of that end's own share.

**Then the terminus tariff was a straight buff to whoever was already ahead**,
which the harness caught: the Combine holds twenty hops *and* fourteen
endpoints, collected on both halves of most lanes it touches, and took a sixth
system. The rule that fixes it is **one toll per lane per collector** — the same
cargo does not pay the same power twice on one run.

Final measurements:

| | before | after |
|---|---|---|
| harness territory, turn 30 | 3/6/5/4/4 | **3/6/5/4/4** |
| galaxy income mix | 58/42 | **58/42** |
| Combine tolls over 30 turns | 477 | 567 |
| Drajk tolling all four (seed net) | 73, and **unreachable** | 79 |

Rates: `TOLL_RATE` 0.25 stays the extortionist's **transit** premium;
`BASE_TOLL_RATE` 0.12 is everyone else's, and every terminus tariff including
the extortionist's — *"commerce owes you for passing through"* is a claim about
chokepoints, not about tariffs at your own markets.

**`TOLL_RESENTMENT` had to be fixed first**, and it was a real bug in its own
right. It bled disposition from every faction with *any* route income toward
every faction collecting a toll. Near enough with one extortionist; badly wrong
once five powers can charge — twenty pairs bleeding every turn against a
disposition that has no decay, so the galaxy floors out permanently.
`RouteEarnings.tollsPaid` is the mirror of `tolls`, and a power now resents
whoever charged **it**.

The seed gives the Combine all four and everyone else none, so the opening
galaxy is the one every campaign to date was played in.

**§1.8 is not fully closed by this.** A share of a flow the payer cannot
generate is now *possible* to generate — any power can toll — but a share sold
by a power whose `tollTargets` is empty is still worth zero, and nothing prices
that for the persona or the arbiter. The difference is that it is now a
statement about a **policy the payer can change** rather than about an ethic it
can never have, which is a fair thing to bargain over.

# 5. What held up

Worth recording, because a report that only lists faults says nothing about
which parts are load-bearing.

**The personas held under eighteen turns of sustained, competent attack.** No
NPC agreed to anything its sheet forbade. The Vigil refused a bribe, an
arrangement and a world sale in one message, correctly quoting two of its four
seed lines (*"Smugglers are not an accommodation the Vigil entertains, 'however
useful'… It is a category question."*). The Combine caught an exploit
mid-attempt and named it — *"'Deferred while a raid is under way' is a sentence
only you get to grade… that's not deferred, it's forgiven with extra
paperwork"* — and counter-offered an audited half-rate. Meridian refused the same
world twice across two turns for the same stated reason.

**Extraction is genuinely conservative.** Three separate promises produced no op
because the schema could not express them honestly: "three hundred on
confirmation", a per-week discount, a conditional rate. A 100-credit fee landed
as a conserved pair.

**The reducer guards that exist, work.** `MAX_COMMITMENT_SHARE` trimmed 70 → 50
with an honest note. `subornLimit` held exactly at 1 and refused a Vigil
defection the narrative had already invented. The actor guards caught
`ojjul cannot deploy an agent owned by drajk` twice, in two different NPC
reactions, and corrected both. `billConstruction` / `refundDuplicateCharges`
conserved to the credit on every check. Duration floors and effect caps fired
(`Clamped fortification duration 2 -> 3`, `Trimmed develop_system from 3 to 2`,
three `raise_garrison`s stopped at full barracks — the exact clamp §3.2 shows is
correctly absent from the lift path).

**The doctrine bots fought a real war without the player.** The Vigil took
Torrek Anchorage and Corvid off Meridian and finished level with Drajk at six
worlds.

**The per-round battle report is what made §1.4 findable at all.** Without
`stackBefore`/`stackAfter` per round, "the wrong ships died" is invisible.

Final board: drajk 6 · vigil 6 · freeworlds 4 · meridian 4 · ojjul 1 ·
unaligned 4. Drajk finished richest at 5,246cr and thinnest in hulls at 34, with
three open wars and 46 dissent — having taken every world it gained through
§1.1, and earned **three credits** from raiding in eighteen turns.
