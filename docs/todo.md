# TODO — known bugs and open design questions

## Where things stand (2026-09-01) — the espionage playtest

A 7-turn Ojjul Nar Combine run (~$6, Opus 5) played with one standing
instruction: **use agents as spies extensively, and see whether the game gives
intelligence gathering any narrative scaffolding.**

The answer was no, and the reason was worse than a missing surface: **the player
already had perfect information, for free.** That is item **30**, and it is
**now fixed** — visibility is decided in code from the order's type and your own
presence, an operative sees through the rest, and everything else surfaces as a
rumour that names a place worth looking at.

Two real bugs came with it — a failed espionage check places the agent anyway
(**31**), and a debt restructure has to route through `forgive_debt`, minting
principal and paying goodwill for a forgiveness that forgave nothing (**32**). Three
smaller ones (**33**, **34**, **35**) are gaps in work landed this session:
`ratifyTurns` never fired, atomic rollback discards the rejection log, and a
held-back batch reported its ops as applied. **34 and 35 are now fixed** —
both were regressions from the atomic-batch work, and both broke the account of
the world rather than the world.

The half that worked is worth as much as the half that did not, and it is
written up as **36**: suborning is a complete, legible, devastating strategy,
and acting on hidden information is fully built. Only *obtaining* it is not.

> **Provenance.** Items **30, 31, 32, 34 and 35** were verified directly — against
> the code, or by replaying `saves/spy_playtest.json`, or both. Two of them came
> back *different from the report*: 32 is not a red-line bypass (nothing was
> forgiven), and 35 is not a display quirk (it is 34's bug in a second place).
> **33 is still the playtest agent's unconfirmed claim** and says so. 36 is its
> account of what worked, and is not independently checked.

---

## 30. FIXED — intelligence gathering had no surface, because nothing was hidden

**Built: A4 + A2, B2, C1** from the options below. `src/domain/intel.ts`, 17
tests in `tests/intel.test.ts`, full write-up in CLAUDE.md.

### What was wrong

`ordersVisibleTo` had exactly one caller — `src/model/serialize.ts:234`,
building prompt blocks for a *model*. Every player-facing path read
`state.pendingOrders` whole: `report.advanced`, `GET /api/campaign`, the orders
panel. The loop this project describes everywhere existed only for NPCs.
Measured: four `surveillance` operatives over seven turns produced **zero**
output, because nothing they could reveal was concealed.

### Why "just turn the filter on" was a trap

On the final board of that campaign, four orders were pending and `visibility`
was **empty on all four**. `prompts/resolution.md:258` asks the resolution call
to name who would plausibly notice, and it does not. Flipping the filter would
have moved the game from *sees everything* to **sees almost nothing**, with the
only dial that reopens it one the model had already proven it will not turn — a
fleet arriving with no way to have seen it coming.

### What was built

- **A4 — visibility by order type.** `PUBLIC_CATEGORIES` asks a physical
  question: could a neighbour with no operative tell? Eight types pass
  (movement, courier, decree, blockade, ratification, garrison, fortification,
  infrastructure); the other eight happen inside a yard or a back room. It sits
  beside the type because the type is *already* the duration category and
  already gates `onComplete` — a third column, not a fourth taxonomy.
- **A2 — you see your own space**, for anything physical.
- **`COVERT_CATEGORIES` — the correction the user caught.** The first draft let
  A2 override secrecy, so an `espionage` order targeting your capital was
  revealed to you *because* it targeted your capital. That is the mechanic
  cancelling itself out, and worse than the bug it replaced: an oversight would
  have become a rule. `espionage`, `counter_intelligence`, `political_maneuver`
  and `commerce_raiding` are now reachable only by an operative of your own, or
  by the acting power choosing to be seen.
- **B2 — rumours.** Everything else reports whose, where, and how long, and
  nothing more. A separate record, not a redacted `PendingOrder`: reusing that
  shape would mean inventing a `type` and an `id` for something the player must
  not know the type of, and shipping the real id would let them interrupt work
  they cannot see. Tests assert the label, type and id are absent from the
  serialized form.
- **C1 — snapshot.** Burn the operative and the programme reverts to a rumour.
  Last-known-position needs durable state on `WorldState`; noted, not built.

### Verified on the campaign that opened this

At turn 7 the three physical programmes are visible to all five powers, and the
Iron Vigil's counter-intelligence sweep is a rumour to the other four. It sits
at **Ghorman Deep** — the exact world the playtest had put a theft operative on
— so the player now reads *"the Vigil has something under way at Ghorman Deep,
1 of 2 turns"* and has a reason to look.

### One thing that looked like a cost and is not

`shipsInTransit` and `fleetStrengthOf` derive from `pendingOrders`, so a rival's
navy could have read low under redaction. It does not: `fleet_movement` is
public, so every movement survives and both totals stay exact for every faction.
A test pins the invariant, so making movement hideable cannot quietly turn two
exact counts into partial ones.

### Still open, and deliberately separate

**The `intel` effect produces no output of its own.** Converting a rumour into a
full row is now a real payoff and is visible, but there is still no *"your
operatives report"* section — the small piece that would make an agent read as
intelligence rather than as a permissions change. Cheap, orthogonal, and no
longer hollow now that something is actually secret.

## 31. FIXED — a failed espionage check placed the agent anyway

**CONFIRMED.** Verified twice against `saves/spy_playtest.json` by stepping the
journal, and the mechanism is confirmed in the code.

| turn | roll | outcome | narrative said | what landed |
|---|---|---|---|---|
| 0 | **d20 1** +4 vs DC 11 | `critical_failure` | *"A Combine operative watching Ord Vantic is captured and exposed by Iron Vigil counter-intelligence; the confession is broadcast across the Tion Marches."* | `agt-0-1`, surveillance at `tio-3` (Ord Vantic), live, unburned, `successChance: 56` |
| 1 | d20 5 +4 vs DC 18 | `failure` | *"…the theft did not succeed"* | `agt-1-1`, theft at `tio-4`, `income_penalty` **15/turn, permanent** |

**Two guards exist and neither covers this.**

- `boundPayloadsToOutcome` (`src/domain/development.ts:255`) returns early for a
  success band and otherwise only rewrites ops where `op === 'issue_order'`,
  reading `onComplete`. A `deploy_agent` passes through untouched on every band.
- `routeCovertAction` does have the right rule and states it — *"a failed
  attempt places no operative — the man was caught at the door"* — but it only
  governs whether it **appends** one. On a failure it returns
  `{ ops, notes: [] }`, and `ops` still contains whatever `deploy_agent` the
  resolution call emitted for itself. The guard covers the path the engine
  builds and not the path the model takes.

So the dice are decorative for espionage: the model is handed the settled
outcome, narrates the operative being caught, and emits the asset anyway. Same
class as the combat leak (item 1) and the payload leak (item 8), and the third
instance of it.

**The fix belongs in `boundPayloadsToOutcome`**, which is the pass that already
knows the band and already runs on both the first batch and the correction:
strip `deploy_agent` on `failure` / `critical_failure` with a note. `partial` is
the open question — an operative is placed or not, so there is no magnitude to
halve. Placing them at reduced effect, or with the exposure risk of the next
mission up, are both defensible; placing them intact is not.

Worth doing at the same time: `routeCovertAction`'s failure guard becomes
redundant once the strip is central, and leaving two rules for one thing is how
this hole opened.

## 32. FIXED — a restructure had to route through `forgive_debt`, and picked up a windfall

**Verified by replaying `saves/spy_playtest.json`.** The playtest agent reported
this as a red-line bypass. **It is not one** — nobody was let off anything, and
the correction matters, because the real defect is a missing primitive rather
than a missing guard.

Twice, the Combine agreed to *restructure* Drajk's refit debt. Extraction had no
op for that, so it emitted the only retirement primitive there is —
`forgive_debt` — followed by `establish_debt` for the new terms:

| | balance at retirement | replaced by | minted |
|---|---|---|---|
| `debt-0` | 400, `delinquent`, 2 missed | 480 @ 20/turn | **+80** |
| `debt-2-0` | 460 | 480 @ 18/turn | **+20** |

The end state after 7 turns: Drajk owes **408** on `debt-3-0`, `current`. The
obligation survived and grew. Read as a red line, the Combine kept it.

**What is actually wrong is the two things the retirement half pays out.**

1. **`DEBT_FORGIVENESS_GOODWILL` (20) fires on a forgiveness that forgave
   nothing** — twice, so **+40** disposition. Drajk went from a seeded 30 to
   **96** toward the Combine over the campaign; the two restructures supplied
   60% of that swing. The constant exists to make declining to forgive a real
   sacrifice. Here it paid full price for a debt that got *larger*.
2. **The principal is re-declared rather than carried**, so a restructure mints
   whatever gap the model writes down — +80 and +20 here, both plausibly just
   rounding to a round number, neither bounded by anything but
   `MAX_DEBT_PRINCIPAL` (1200). `assign_debt` was built precisely so that moving
   a debt keeps its balance and history; retiring-and-reissuing has no such rule.

A third effect, harder to price: the `delinquent` status and its two
`missedPayments` were **laundered clean**. `DEBT_DEFAULT_DISPOSITION_COST` bleeds
6 a turn for as long as a default continues — that is how a creditor's patience
is modelled — and a restructure resets it to zero. That may well be correct
(rescheduling is exactly what a creditor does instead of writing off), but it
should be a decision rather than a side effect of the op chosen to express it.

**The fix is a `restructure_debt` op**, extraction-only like `establish_debt`,
which keeps the debt id, creditor, `establishedTurn` and **balance**, and moves
only `perTurn`, `text` and status. It pays no goodwill, because nothing was
forgiven. That removes all three effects at once without needing any ruling
about red lines, and it is reducer arithmetic rather than judgement in a
prompt — the same answer `assign_debt` was for the mint-on-transfer bug in item
24, which is the same bug wearing a different verb.

Worth noting the shape: **item 24 was "a debt cannot be transferred, only
minted". This is "a debt cannot be rescheduled, only minted."** Both times, a
missing verb forced the model through a primitive that did more than was meant.
The remaining verb-shaped hole is a *partial* write-down, which today would have
to be expressed the same way and would mint in the same manner.

## 33. FIXED — `ratifyTurns` never fired

**Playtest finding. Not independently verified.**

Two accords were explicitly gated on ratification in the transcript — *"nothing
moves before then, not the paper, not the world"* — and `assign_debt` executed
immediately on the same timestamp.

The agent's own caveat is the useful part: **`assign_debt` has no ratification
field**. `ratifyTurns` lives on `form_treaty`, which records a `pending` treaty
with an `effectiveTurn`; there is nowhere on a debt assignment to put a delay,
so extraction had no way to express what was agreed even if it had tried.

Which means this is one of two things, and they want different fixes:

- **the prompt never reaches for it** (extraction guidance gap), or
- **a deferred non-treaty op has no representation at all**, which is a design
  question: does the game want a general "pending op" concept, or does deferral
  stay a property of treaties only?

The second reading is the more likely one and the more interesting. Worth
checking whether a *treaty* gated on ratification does still work before
concluding anything — that path was verified when it was built.

---

## 34. FIXED — atomic rollback discarded the rejection log along with the ops

**Verified, cause found, fixed.** A regression from the atomic-batch work landed
this session (item 27), and the reason the `rejection` log filter has had
nothing to show.

Replaying `saves/spy_playtest.json`:

```
rejections during replay:      6
rejection events in eventLog:  0
total events in eventLog:     127
```

The cause is two lines apart in behaviour and 1,300 apart in the file:

- `reject()` (`src/domain/reducer.ts:567`) records the rejection **into
  `state`** via `logEvent(state, 'rejection', ...)`.
- the atomic path (`src/domain/reducer.ts:1884`) returns
  **`state: clone(input)`** — the state as it was *before* the batch.

So the rollback that correctly discards the ops also discards the account of why
they were discarded. The player gets the summary note (*"Nothing in this batch
was applied: N of M ops were rejected"*) and no itemisation anywhere, which is
exactly what the playtest observed. CLAUDE.md's claim that rejections are
recorded in the event log is currently false, and the browser ships a filter for
a kind that is never emitted.

**Fixed** by collecting the rejection entries in their own array as `reject()`
records them, and appending them to the rolled-back state. The rollback returns
`clone(input)` *plus* the log, so the discard removes the ops and keeps the
account of why.

**Scoped deliberately to `reject()`.** `capSelfInflictedLosses` also logs under
the `'rejection'` kind, but it describes a trim that did not happen when the
batch is held back — it goes with the state it describes, exactly as its note
already does. There is a test for each direction.

Re-verified end to end: the same campaign now replays to **byte-identical state**
(Combine credits 3455, disposition 52, all four debts unchanged) with **6**
rejection entries in a 133-entry log where there were 0 in 127.

**The second half of the playtest's claim turned out to be the same bug in a
different place** — see item 35, which is `applied` computed the pre-atomic way.

## 35. FIXED — a held-back batch reported its ops as applied

**Confirmed, root cause found, fixed.** The playtest read this as "the
correction batch is concatenated to the first". That is the symptom; the cause
is the same one as item 34, and it is again a regression from the atomic-batch
work.

`Campaign.stage` computed what to report as applied by removing the
*individually rejected* ops:

```ts
const refused = new Set(res.rejections.map((r) => r.op));
const applied = ops.filter((op) => !refused.has(op));
```

That was correct while batches applied partially. `stage` passes `atomic = true`,
so **a rejection means nothing landed** — and every legal sibling in a held-back
batch was still reported as applied. A corrected action therefore reported the
whole first batch (which did nothing) *plus* the correction batch, which is
exactly the doubling seen, and why the op counts quoted in the notes matched
neither list. The world was right throughout, which is why it read as cosmetic.

`resyncPreview` carried an identical copy of the same computation, so the
reported ops would also change shape underneath the player on the next commit or
tick.

**Fixed** in `src/engine/campaign.ts`: both sites now report `[]` when the batch
was held back and the whole batch when it landed.

**A stale test was pinning the bug.** `tests/replay.test.ts` asserted
`['adjust_credits']` for a one-good-one-rejected batch — written before
atomicity and never revisited, so it went on asserting the pre-atomic
semantics against post-atomic code. It now asserts that nothing is reported
*and* that the legal sibling's credits are untouched, which is the fact that
makes reporting it a lie.

Four new tests, three of which fail against the pre-fix code, including the
concatenation case directly.

> **The pattern across 34 and 35 is worth naming.** Making batches atomic changed
> what "applied" means, and three separate things still computed it the old way:
> the rejection log (34), `stage` and `resyncPreview` (35). None of them broke
> the world — all three broke the *account* of the world, which is why the suite
> was clean and a playtest found them. A change to a core semantic wants a sweep
> of everything that reports on it, not only everything that depends on it.

## Where things stand (2026-09-02, later) — the playtest backlog, built

Everything from the 10-turn playtest that did not need a design decision is
built, plus the four decisions taken since. **847 tests.**

**Closed:** 31, 32, 33, 40, 42, 43, 44, 45, 46, 48, 49, 50, 52, 53, and three of
the four in 54. Nine of the claims were mechanically validated first — see the
validation pass in item 54 — and one of my own validations was **wrong**: 54a
came back REFUTED because the test drew hulls from the same system the cap
restores to, which masks the bug entirely. Reproducing the reporter's actual
configuration confirmed it. *A test that does not reproduce the setup is not a
refutation.*

**Still open and needing a decision:** the multi-round combat resolver (item 5),
and whether the two commitment ceilings should compound at all (item 51 — the
reporting half is built, the balance question is not mine to answer).

**Deliberately dropped:** art for `inadmissible` and `out-of-actions`. Those two
are the only non-outcomes that are not about the player's own faction — one is
the world saying no, one is the clock — and they read fine as text.

---

## Where things stand (2026-09-02) — the 10-turn Drajk playtest

A full campaign played to its limit as the Drajk Confederacy, on the build that
shipped items 30, 37, 38 and 39. It reached turn 10, the ending generated with
`fallback: false`, and every mutating route was correctly refused afterwards.

**The two worst findings are in code written that same day.** The event log
leaks exactly what the new fog redacts (**40**), and the epilogue's `wars` field
reads one side of a two-sided relationship, so the last thing the player reads
contradicts itself twice (**41**). Both are the same mistake in different
places: a fact was filtered or computed in one path and left alone in another.

Then two credit exploits that predate all of it (**42**, **43**), diplomacy
still being an unmetered action channel for 13 of 14 order types (**44**), and a
documented mechanism that does not exist (**45**).

> **Provenance.** Items **40–46** I verified directly in the code, with the file
> and line cited. Items **47–54** are the playtest agent's measurements, quoted
> with its reproductions and **not** independently confirmed; each says so.

---

## 40. FIXED — the event log defeated the fog, so redaction was decorative

**VERIFIED.** A regression against item 30, shipped the same day.

In the *same* `GET /api/campaign` payload where a Meridian order was correctly
redacted to an anonymous rumour, `state.eventLog` contained:

```
order | meridian begins Patrol conversion at Tion Anchorage (3 turns) -> tio-1,
        to deliver 4 new hulls for 240 credits.
order | vigil begins Sweep the Ord Vantic yards (2 turns) -> tio-3.
order | Ojjul Nar Combine places an agent on Hollow Star (surveillance) for 40 credits.
```

Line 1 hands over the label, duration, target, payload magnitude and price of
the order the fog was hiding. Line 2 is a `counter_intelligence` order — a
`COVERT_CATEGORIES` type whose entire purpose is to be unobservable. Line 3
names a rival operative placed on the player's own world, with its cost.

The source is `src/domain/reducer.ts:1087`: every `issue_order` writes an
`order`-kind event naming faction, label, duration, target and payload.
`worldAsSeenBy` replaces `pendingOrders` and passes `eventLog` through
untouched, and the log is shipped to the browser whole.

**The galling part is that this hazard was identified and closed for the kind
next to it.** `intel` events are player-only precisely because "logging every
faction's watch reports would hand the player a transcript of what four rival
spy networks can see" — and there is a test for it. The same argument applies
verbatim to `order` events and was not made.

**The fix is not simply to stop logging.** The log is how a player follows the
campaign, and their own orders must still appear — as must anything public. So
the event needs to carry enough for a reader to decide: either

1. **filter on the way out**, giving `EventLogEntry` an optional visibility
   scope that `worldAsSeenBy` applies — the honest fix, and it generalises to
   every future event kind; or
2. **write two lines**, a full one attributed to the actor and a redacted one
   for everyone else, which duplicates the `OrderRumour` split into the log.

(1) is the one to price. The deeper lesson is that **fog is a property of the
whole payload, not of one field** — filtering `pendingOrders` alone was never
going to be enough, and a test asserting that no `eventLog` entry names a
rumoured order's label would have caught it immediately.

Worth auditing the other `logEvent` call sites at the same time: `deploy_agent`,
interrupt/cancel notes and the initiative rationales all describe things a rival
should not necessarily see.

---

## 41. PARTLY FIXED — the epilogue contradicted itself, and read like a ledger

**VERIFIED.** Four defects in the ending shipped as item 39, one serious.
**(a) and (c) are fixed and verified against the finished campaign; (b) and (d)
are still open.** A fifth problem the user raised — the prose read as a plain
recap rather than an ending — is fixed alongside them and written up at the
bottom of this item.

### (a) `wars` is one-sided — the ending states opposite things about the same war

The `krayt` slide: *"No war stands open against it."* The `meridian` slide, in
the same document: *"The war with the Drajk Confederacy sits open on the
ledger."* The `vigil` slide names Drajk as one of its two open wars.

`src/engine/epilogue.ts:104`:

```ts
const wars = Object.entries(f.disposition)
  .filter(([, v]) => v <= WAR)
  .map(([id]) => nameOf(id))
```

It reads only the subject's **outward** disposition. Final state:
`krayt.disposition` is `{meridian: -19, vigil: -46, hutt: 73, freeworlds: 27}`
— nothing at or below −75 — while `meridian.disposition.krayt = -100` and
`vigil.disposition.krayt = -100`. So `krayt.wars: []` and two other slides name
Drajk. The same artefact fires for the Combine: *"no war of its own fought
anywhere"* against `vigil→hutt = -75`.

Disposition is deliberately asymmetric everywhere else in this game; the
epilogue treated it as if it were not.

**FIXED:** a war is now either party at or below the threshold. Verified by
re-running the narration against the finished campaign — `krayt.wars` went from
`[]` to `[Iron Vigil Remnant, Meridian Trade Authority]`, `hutt` from `[]` to
`[Iron Vigil Remnant]`, and no slide contradicts another. Three tests, including
one asserting a power is never listed at war with itself.

Still worth considering: the dossier could distinguish *"at war with"* from
*"regarded as an enemy by"*, which are different sentences a narrator could use.

This is the worst possible place for the defect. The whole argument for
computing the facts before narrating them is that the last thing the player
reads cannot be argued with — and it is the computed half that is wrong here,
so the prose faithfully rendered a contradiction.

### (b) `gained`/`lost` is a start-vs-end set difference, so a conquest can vanish

The campaign's only conquest — Threx, Drajk's at turn 0, ceded to the Vigil
around turn 2, stormed back on turn 8 and held through a counter-attack on turn
10 — cancels to nothing under set difference. Three battles were fought and the
closing paragraph says *"not one flag planted or struck for good."* The Vigil is
told it *"merely held"* its state, having lost a world at gunpoint and 11 hulls.

The dossier carries **no battle record at all**. Carrying a battle summary, or
worlds-changed-hands events rather than endpoint sets, would fix it.

### (c) `foremost` promotes an arbitrary tie-break into a stated fact

All five powers ended holding four systems. `foremost` breaks the tie on faction
id, and the closing rendered that as *"the largest single holding, the Arkanis
Free Worlds"*.

**FIXED:** `CampaignOutcome` gained `leaders`, everyone level on the largest
holding. When it has more than one entry the dossier says *"Nobody ended
foremost"* and tells the narrator not to name one; the deterministic fallback
says "level with every other power" instead. Verified live — the closing now
opens *"When the last bell rang, no power stood above the rest."* A tie-break is
a way of picking a value, not a finding.

### (d) Two smaller ones

- `towardPlayer: 100, playerToward: 100` for the player's own faction is
  synthesised at `epilogue.ts:135` — the reducer rejects self-disposition ops,
  so this is a number in a document whose selling point is *"settled; do not
  overturn"*.
- `epilogue.factions[krayt].net = 258` and `briefing.ledger.net = 253` in one
  response, both stamped `turn: 10`.

### (e) FIXED — it read like a ledger, not an ending

The user's read of the shipped version: stilted, a plain recap. The cause was in
the prompt and in what the prompt was handed:

> *"The Enterprise closes the books holding four worlds, the same four it opened
> the last quarter with, and the arithmetic underneath is sound: forty-three
> hulls, a treasury near five thousand, income of 308 a turn."*

`prompts/epilogue.md` asked for "unsentimental" and "plainly" and got
accountancy. **But rewriting the register was not enough, and that is the
interesting half:** two live runs against the real finished campaign showed the
"say what the numbers meant, never the numbers" instruction failing, and the
second produced *more* raw figures than the first.

The fix is structural, and it is the principle this whole project runs on —
**a dossier that is a table of numbers will be narrated as a table of numbers.**
`serializeOutcome` now hands the narrator *comparisons*: "the thinnest navy of
any power still standing", "the heaviest purse in the Rim", "its own people have
largely stopped following it". Nothing is lost, because every figure is already
rendered on screen beside the prose — the reader gets numbers from the facts row
and meaning from the paragraph.

Third live run, same board:

> *"what came home was the thinnest fleet of any power left standing, the
> emptiest treasury, and captains who had largely stopped following the flag
> they once sailed under."*

Zero raw figures except world counts, which the prompt allows as the one number
worth spending. Tests pin that no faction's treasury or debt balance appears in
the dossier text. The call also got **cheaper** — $0.1387 against $0.2183 —
because the dossier is shorter.

---

## 42. FIXED — interrupting your own order minted credits, and `extend_order` was unbounded

**VERIFIED in code.** `src/domain/reducer.ts:2062`:

```ts
const refund = remaining * 20 + unspent;
```

At `progress: 0`, `unspent` returns **100% of the money back** and the flat
`remaining * 20` rides on top. **Issue-and-immediately-interrupt is therefore
unconditionally profitable at +20 per remaining turn**, for any order with
`onInterrupt: 'partial'`, forever.

Measured live, in one declaration:

```
order | krayt begins Long Take charter, maximum term, Hollow Star (3 turns)
        -> kes-7, to deliver 2 new hulls for 120 credits.
order | Long Take charter ... suspended at 0/3; 180 credits recovered.
```

Paid 120, recovered 180. A second reproduction on an order with
`investedCredits: 0` recovered 140 from a programme that had never had a credit
spent on it.

**`extend_order` removes the ceiling.** `src/domain/reducer.ts:1166` is
`order.durationTurns += op.additionalTurns` with no cap on the resulting total
and no credit cost, so `remaining` is arbitrary and so is the refund — roughly
420 credits per extend op, per action point.

That is also a live breach of a documented invariant. The playtest inherited an
order at `durationTurns: 10` against `MAX_DURATION = 5`, `FIB_BUCKETS =
[1,2,3,5]` and CLAUDE.md's *"Nothing takes longer than 5 turns."* `extend_order`
is the hole in it.

**Two fixes, and they are independent:**

1. The flat `remaining * 20` should not exist, or should be bounded by what was
   actually spent. A refund that can exceed the outlay is not a refund.
2. `extend_order` must clamp `durationTurns` to `MAX_DURATION`, or the duration
   invariant is only true of orders nobody extended.

---

## 43. FIXED — a negotiated loan could only be written as a mint

**VERIFIED with exact numbers**, by replaying the campaign journal op-by-op:

```
settle_debt      krayt -320  hutt +320   TOTAL   +0   <- conserved
adjust_credits   krayt +240  hutt   +0   TOTAL +240   <- minted
establish_debt   (no credit movement at all)
issue_order      krayt -240  hutt   +0   <- spent on 4 hulls
```

240 credits entered the economy with no counterparty debit, and the debt records
an obligation whose principal was never transferred.

**It is a pincer, and neither half is reachable by better prompting:**

1. **`establish_debt` moves no principal.** `src/domain/reducer.ts:1694` pushes
   a debt record and nothing else — it neither debits the creditor nor credits
   the debtor.
2. **The borrower cannot write the lender's debit.** `adjust_credits` with a
   negative delta on another faction is rejected by design, and that rejection
   fired correctly here: *"krayt cannot take credits out of hutt's treasury
   directly."* Extraction runs as the acting faction, so the only expressible
   half of the pair is the credit to self.

So the only way to express "the Combine advances 240" is a mint.

**The fix mirrors `settle_debt`:** `establish_debt` should transfer the
principal from creditor to debtor, trimmed to what the creditor actually holds,
exactly as `settle_debt` trims to what the debtor holds. Then the paired
`adjust_credits` is unnecessary and the mint is unreachable.

Note the shape shared with item 32: **`settle_debt` moves real money and
`establish_debt` moves none.** One module, two ops, opposite conventions —
which is why both a loan and a restructure mint.

---

## 44. FIXED — diplomacy was an unmetered action channel for 13 of the 14 order types

**VERIFIED.** `src/domain/reducer.ts:871` rejects an extraction-sourced
`issue_order` only when `isMovementType`. Measured with `actionPoints: {left: 0,
perTurn: 2}`, closing a channel emitted

```json
{"op":"issue_order","factionId":"krayt","type":"courier","originId":"tio-6",
 "targetId":"kes-5","durationTurns":2}
```

and the order was in `pendingOrders` with action points still at 0.

Item 23 closed the `fleet_movement` case on the argument that a movement fights
a battle and changes who holds a world. But `garrison_raising`, `fortification`,
`capital_ship_construction`, `blockade`, `commerce_raiding` and `espionage` are
all reachable this way, all free. Combined with item 42, a channel is a
money faucet that costs no action points at all.

Two related bypasses of the same guard, both measured:

- **A refused accord costs no action point.** A *declared* refusal spends one
  specifically so "a free retry would let a player probe their own red lines all
  day". An accord refused with `REFUSAL_DISSENT` left `actionPoints: {left: 2}`.
  The AP guard's stated rationale is fully bypassed by the diplomacy path.
- **Disposition is free, permanent and unbounded.** Every `endtalk` emitted
  paired `adjust_disposition` ops — up to ±20 in one conversation. A −35
  penalty for being caught buying Combine keels was repaired +20 by one
  apologetic conversation in the same turn, at zero AP cost, with no limit on
  repetition. Disposition has no decay by design, so this accumulates.

The question this raises is whether diplomacy should be metered at all, or
whether the guard should be *"extraction may only emit ops that need the other
party's consent"* — which is the principle `form_treaty` and `establish_debt`
already follow, and which would exclude every unilateral `issue_order`.

**Re-checked after the treaty-state work: entirely unaffected and still open.**
`src/domain/reducer.ts:941` still reads `source === 'extraction' &&
isMovementType(op.type)`, so the guard remains movement-only. Nothing in
supersession, `already_void` or the transcript record touches it.

Worth stating what the treaty work *does* change about the calculus: it removes
one of the ways an accord could pay twice, so the channel is a slightly less
profitable faucet. It does not make it a metered one. The exploit in item 42
still routes through here, and the AP-free red-line probe still works.

The consent-based rule is the one to price. It is a single predicate — does this
op bind a faction other than the actor? — and `form_treaty`, `establish_debt`
and `assign_debt` already sit on the right side of it while every
`issue_order`, `establish_commitment` and `adjust_credits` sits on the wrong
one. That would make the extraction schema express the principle instead of
enumerating one exception to it.

---

## 45. FIXED — two mechanisms CLAUDE.md documented did not exist

**VERIFIED.**

**Checks are not written to the event log.** `EventKindSchema`
(`src/domain/state.ts:333`) is `['narrative', 'system', 'order', 'diplomacy',
'rejection', 'clamp', 'intel']` — there is no `check` kind, and
`grep -rn "kind: 'check'" src/` returns nothing. CLAUDE.md states *"Every check
is written to the event log, so a campaign's luck is auditable."*

The only reason any rolls were auditable in this campaign is that the resolution
model **voluntarily** emitted `log_narrative` ops reading `"[check] guile check:
d20 7 -1 = 6 vs DC 16 → critical failure"`. That is model discretion, not a
mechanism — turns 0–5 of the campaign contain none at all.

**Dissent movements are not logged either.** Only the drift trigger writes a
line. Refusals (+8) and compulsion breaches (+15) leave no event. The player's
dissent went 25 → 28 → 45 → 69 and the log accounts for +9 of it — for the
mechanic this file calls the most successful in the build.

Both are the same gap: a number the game rolls against, changed by the engine,
with no record. Small to add and it makes the two most consequential mechanics
auditable.

---

## 46. FIXED — the turn payload under-reported what the NPCs did

**VERIFIED.** `ReactionView` (`src/engine/turn.ts:40`) has no `ops` field at
all, so `reactions[].ops` is `null` for every faction on every turn while the
event log proves ops landed on the same tick.

Compounding it, an NPC batch that is rejected is voided whole — correctly, since
item 27 — but the API hides it. Twice in one turn: `"Nothing in this batch was
applied: 1 of 3 ops were rejected"` with top-level `"rejections": []`. The
reason is now in the event log (item 34's fix), but a caller reading the
response sees a narrative describing action and no indication that two thirds of
the galaxy's turn was discarded.

---

## 47. Playtest claim — red-line rulings on accords are made on the fiction, not on the ops

**The agent's measurement, not independently confirmed.** If it holds it is the
sharpest finding in the run, because it is the arbitration/resolution split
failing one layer up.

Drajk's red line: *"will not put its name to a written treaty; a handshake it
can deny is the most it offers."*

- **Turn 6, Arkanis.** The accord contained **no treaty** — a creditor forgiving
  100 of an existing debt, an unchanged charter rate, a promised future strike.
  Ruled a refusal, whole accord destroyed, +8 dissent, the counterparty's
  concession lost with it: *"It is a treaty, and we do not sign treaties."*
- **Turn 6, Combine, minutes later.** Framed as *"no paper, nothing signed"* —
  extraction emitted a literal `form_treaty` which ratified and paid 55/turn for
  the rest of the campaign. `refusal: null`, no dissent.
- **Turn 7, Meridian.** Same framing, another `form_treaty` with
  `durationTurns: 40`. `refusal: null`.

**The two accords that actually wrote a treaty into `state.treaties` were
permitted; the one that wrote none was refused as "a treaty".** The only
variable is the wording of the transcript.

Item 28 moved the accord ruling from what an accord *enacts* to what it
*obliges*, which was right. This says the ruling is still made on the prose
rather than on the emitted batch — and for this particular red line the test is
purely mechanical: **did this accord emit `form_treaty`?** Appraising the ops
alongside the transcript is the obvious fix and is the third time this file has
reached that conclusion (see also item 32).

---

## 48. FIXED — a compulsion breach could be charged against state that contradicts it

**The agent's measurement; the structural argument is checkable and looks right.**

Turn 7, charged `COMPULSION_BREACH_DISSENT` (+15) for the compulsion *"the
captains require plunder: no raid under way and nothing taken from anyone"* —
at a moment when `campaign.state` contained `ord-7-1`, a `commerce_raiding`
order staged that same turn, plus six hulls in transit to storm a world.

`closeChannel` passes `campaign.state` (committed **plus** staged) to
`appraiseAgreement`, so the arbiter was looking at a board on which a raid *was*
under way. The code's own predicate for the identical compulsion —
`no_plunder` in `compulsions.ts` — would have evaluated **false**.

`verifyBreachRelevance` cannot catch this by construction: it is passed the act
and the line and nothing else, deliberately — *"no character sheet, no state"* —
so it is structurally incapable of noticing that a state-dependent compulsion is
factually inapplicable.

**So a compulsion carrying a `trigger` has two enforcement paths that can
disagree**: the model judging a breach from prose, and the code evaluating a
predicate. The obvious fix is that a compulsion with a trigger should have its
breach ruling *checked against the trigger* — if the predicate says the faction
is complying, there is no breach to charge.

---

## 49. FIXED — an accord that delivered nothing left phantom history

**Agent's measurement.** The turn-6 Arkanis accord was refused whole, so its
`forgive_debt` never landed: the debt ran 240 → 200 → 160 → 120 → 80 → 40 on
instalments alone, with no forgiveness at any point.

But transcripts are replayed into the persona, so on turn 7 the same NPC said:

> *"My pen already struck the first hundred, that turn, and I said I wouldn't
> mention it again... a debt doesn't get forgiven twice for the same hundred."*

and the turn-7 extraction wrote that belief into the world's own event log.

So the player paid 8 dissent, received nothing, and is **permanently blocked
from the deal** because the counterparty remembers granting it. A refusal has to
scrub the transcript, or mark it as refused so the persona reads it as an
attempt rather than an agreement.

---

## 50. FIXED — treaties stacked, and one already void was signable

**Agent's measurements, both now confirmed and fixed.**

**"Supersedes" is decorative.** The turn-6 Combine accord emitted a
`form_treaty` whose own summary read *"...supersedes tre-0-0."* — and `tre-0-0`
stayed `active`. Result at turn 7:

```
treatyFlow: 160  =  40 (tre-0-0) + 55 (tre-6-0) + 25 (tre-1-1) + 40 (tre-5-0)
```

Arkanis believed it paid 40 and paid 65; the Combine believed 55 and paid 95.
Both NPCs said "supersedes" out loud. The ending duly rendered
`freeworlds.liveTreaties` with **"tribute with Drajk Confederacy" listed twice**.

**FIXED, in the reducer rather than the prompt.** Supersession already existed
and was scoped to `incomeShares` — a new grant of the same system to the same
faction retired the old one — and never looked at anything else, so every other
recurring term stacked.

The tempting rule is "one live treaty per (pair, type)" and it is **wrong**: two
`trade_accord`s granting different lanes are two deals, and a test has pinned
that since item 26 (it failed the moment the coarse rule went in, which is the
test doing its job). The rule is on the **pair-level footprint** instead:

- a term that flows between the parties as a whole — `incomePerTurn`,
  `shipsPledged`, `mutualDefenseTrigger` — where there is one such flow and a
  second treaty carrying it is a double-count;
- a type carrying no recurring terms at all (`non_aggression`, `ceasefire`,
  `basing_rights`), where the treaty *is* the status and a second is a pure
  duplicate.

`incomeShares` is deliberately excluded: it is keyed by system and has its own,
narrower supersession. Applied where a treaty becomes **active**, not where it
is created — a `pending` treaty must not retire the live one it will replace, or
the parties have nothing in force while a council deliberates. Tested both ways.

`break_treaty` is still absent from `prompts/extraction.md`, and that is now a
smaller matter: supersession is automatic, so the prompt only needs it for a
genuine **repudiation**, which is a different act with a different price
(`PACT_BREAKING_REPUTATION_COST`). Left open deliberately.

**A treaty whose void condition already holds is signable.** `tre-7-0` was
signed and voided on the same tick by its own `voidsOn {kind: "attacks", by:
"krayt", target: "meridian"}` — a condition already true at signature
(`meridian→krayt = -89`). It never paid a credit, and Meridian's next reaction
described it as a live arrangement it was honouring.

**FIXED.** `voidConditionMet` had exactly one caller, in `tickTurn`. It now runs
at signature too, and a treaty already void is **rejected** with a new
`already_void` code naming the condition — not recorded-and-voided, because a
silently void treaty *is* the phantom-belief problem this item is about. Under
atomic batching that fails the accord and the correction pass is told exactly
why, so the deal gets re-expressed without the impossible clause rather than
evaporating.

---

## 51. PARTLY FIXED — a concession of 60 lands as 10, and nobody was told

**Agent's measurement.** The Combine agreed to 60/turn. The reducer trimmed it
to 25 (`"Trimmed war_chest_stipend yield from 60 to 25 per turn (ceiling 25)"`),
and `ledgerFor` then applied the per-faction influence ceiling and paid **10**.
`commitmentFlow: 10` on every turn of the campaign, across two renegotiations.

Both caps are deliberate (item 29's `MAX_COMMITMENT_INCOME` and
`maxCommitmentIncomeFor`). The problem is that they compound silently and the
negotiating party is never informed, so an NPC bargains hard over a number that
cannot exist and the player banks a sixth of what was agreed. At minimum the
trim note should reach the channel; better, the arbiter should know the ceiling
before the deal is struck.

Two neighbours from the same run:

- **A negotiated debt reschedule has no op.** Extraction said so itself: *"no
  mechanical lever exists to alter an existing installment schedule, so this is
  logged for the record"*. `perTurn` stayed 20 to the end. Same family as item
  32 — the debt module can create, settle, assign and forgive, but not
  *reschedule*, which is the most common real negotiation.
- **`prize_share_tribute` was pure decoration** — `incomePerTurn: 0` before and
  after renegotiation from one eighth to one sixth. Two conversations, one
  dissolve, one establish, zero credits. Item 29 made zero-flow commitments move
  disposition; a *share of prizes* still has no mechanism at all.

---

## 52. FIXED — enemy ships parked in your own system could not be attacked

**Agent's measurement, and it reads as a real design hole rather than a bug.**

The Iron Vigil kept 1 hull on the player's Vergesse from turn 6 and 3 from turn
9, contesting the world's income for five turns. There was no legal way to
remove them:

- battles resolve only on a `fleet_movement` **arrival**, and moving into your
  own system is reinforcing, not an invasion;
- `subornLimit krayt→vigil` is 0 (Vigil resolve 17), so crews cannot be bought;
- a blockade would have breached the acting faction's own red line.

So parking one hull on a rival's best world is a permanent, unanswerable tax.
The income rules make presence deliberately meaningful — *"parking ships in a
rival's system is an economic act"* — but there is no counter to it, which turns
a good mechanic into a free one.

---

## 53. ADDRESSED — NPC-vs-NPC aggression was zero in a live campaign

**Mixed provenance.** My own harness measurement stands: over 12 turns with the
player never acting, `initiative.ts` produced 2 NPC-vs-NPC attacks and moved six
worlds. In this live 10-turn campaign the agent measured **zero** — every
hostile act in four turns targeted the player, with `vigil→freeworlds = -80` and
`freeworlds→vigil = -80` sitting unfought.

The two are consistent and the difference is the point: **initiative only runs
for factions the model did not speak for**, and in a live campaign the player
touches enough of the board that most factions are responders most turns. So the
mechanism fires exactly when it is least needed and stands down when a player is
active — which is the opposite of what item 38 was for.

Worth measuring before changing anything: how many factions per turn actually
fell through to `proposeFor` in this campaign. If the answer is "almost none",
the fix is in the responder selection (item 38's option 2c — always reserve a
slot for a faction the player did not touch) rather than in the bots.

**Related, and also unexercised:** all four NPCs ended at dissent 0. The agent's
read is fair — Meridian was never unprofitable, both Combine debts stayed
`current` with operatives in the debtors' space, nobody parked on a Vigil world
— so the drift triggers were satisfied rather than broken. But the first
mechanism that holds an NPC to its own character produced not one point of
dissent across ten turns while the player accrued 69.

---

## 55. IN PROGRESS — ship classes, and tonnage as the unit of fleet size

A fleet was a count, so every hull was identical and composition was not a
decision. The design below is settled; step 0 is built.

### The classes

| class | tonnage | cost | upkeep | orbital weight | job |
|---|---|---|---|---|---|
| **escort** | 2 | 30 | 2 | 1 | takes losses first |
| **torpedo boat** | 2 | 30 | 2 | 1 | strikes past the screen at the heaviest hulls |
| **line** | 4 | 60 | 4 | 3 | the all-rounder |
| **lifter** | 3 | 45 | 3 | 0 | 6 troops each; the only way to take ground |

### Tonnage is the single primitive

`CREDITS_PER_TON` 15 and `UPKEEP_PER_TON` 1 are chosen so a **line hull is
exactly what a ship was before classes existed** — 4 tons is 60 credits, the old
`SHIP_COST`, and 4 a turn, the old `UPKEEP_PER_FLEET_POINT`. A galaxy of nothing
but line hulls plays identically, which is what makes the migration a change
with no balance argument in it.

Everything that limits a fleet by size is now denominated in tons: upkeep,
presence and income contest, `subornLimit`, the price of a suborned crew,
`MAX_ATTRITION_FRACTION`, `capSelfInflictedLosses`, and the doctrine bots'
budget. Five conventions that had no reason to agree become one.

**Cost strictly per ton closes an exploit by construction:** cheap hulls cannot
become the efficient way to skim a rival's income, because every class buys
exactly the same presence per credit.

### Two traps this design already fell into

**Escort spam.** The first table gave escorts a line hull's `orbitalWeight` at
half the tonnage — twice as efficient per ton, per credit *and* per point of
upkeep, with the only downside being that they die first, which barely matters
when you are winning. Weight is now superlinear in tonnage for warships: a line
hull is the better fighter on every axis, and an escort's whole compensation is
that it is spent first. Same lesson as `tradeEthic` and `warEthic` — a
difference expressed only as a number gets solved once and then ignored.

**"Monitors are the only class that can damage a garrison."** False: the
surviving fleet already assaults the garrison (`assault = attackForce * …`).
Monitors were dropped. The real distinction was *damaging a garrison without
landing*, which is a different feature.

### Ground combat becomes the lift arm's job

`assault = lifters * LIFTER_CARRY` replaces `attackForce`. The might modifier,
the roll and `DEFENSIVE_GARRISON_BONUS` are untouched. Consequences agreed:

- **Conquest gains a dedicated cost.** An all-warship fleet can sterilise a
  system's orbitals and take nothing.
- **Losses fall on the lift arm** in the ground phase, so a hard-fought landing
  eats your transports and conquest stays a recurring cost.
- **The captured world's garrison becomes the troops that took it**, replacing
  "the conqueror keeps a fraction of the defender's garrison". More coherent,
  but it touches `expansionist`.

### The naming, because it was argued twice

"Minelayer" says *area denial*; the mechanic is *hunting*. Two of the class
names turned out to be the historical ones already — a lifter is a troopship
and an **escort** is literally what the WWII convoy-protection class was called,
so the third leg of that triangle is the raider. **Torpedo boat** was chosen
over `interdictor` with the mechanic widened from "kills lifters" to "strikes
past the screen at the heaviest hulls", so the name and the rule agree and the
class is not dead weight in every war that is not an invasion. It also gives
escorts a better story: destroyers were originally *torpedo boat destroyers*.

### Staging — each step gives the previous one its point

0. **Type `ships` to a class record, `line` only.** Behaviour-neutral. **DONE:**
   `src/domain/hulls.ts` plus 16 tests. `ShipStackSchema` accepts the bare
   number every old save and journal carries and normalises it to line hulls, so
   an old campaign replays as the game it was played as.
1. **`lifter`** — invasion becomes a composed fleet. No new phases: the orbital
   phase counts weight, the ground phase counts lift.
2. **`escort`** — something worth protecting exists, so a screen has a job.
   Still no new phase; it is a loss-ordering rule.
3. **`torpedo boat`** — the lift arm is under threat, so escorts matter. Loss
   redirection past the screen, still inside the existing exchange.

### Still open

- **The sweep to run is "does anyone still invade"**, not "is the exchange rate
  fair". Conquest gets more expensive at step 1 and gains a hard counter at step
  3; the failure shows up as bots that stop attacking, the same shape as the
  `MONOPOLY_BONUS` cliff where a discrete question swamped the tuning value.
- **`fleetStrengthOf` changes units** — 43 hulls becomes 172 tons. It feeds the
  prompt block, the Fleets panel and the bots. The UI should show both, since a
  player thinks in ships and the rules think in tons.
- **A defender with no combat weight still has to die.** A pure-lifter fleet
  squatting in orbit has `defenceForce` 0, which the sweep path reads as
  "nothing to fight". It must be a walkover that destroys them, not a no-op.
- **Sprites.** Five silhouettes that must differ by *outline*, not detail — the
  existing two took four passes and both faults were found on screen, not by the
  suite. Planned: line = the existing dart, escort = a broad shallow chevron,
  torpedo boat = a long needle with tail fins, lifter = a box with a bay notch
  cut through it (`evenodd`, like the tank's road wheels).

### Leaders, deferred but decided

Tied to **battles**, not fleets — no basing, no transit, nothing to move. A
leader is lost only on a catastrophic defeat, which gives the bottom outcome
band a consequence it does not currently have. The espionage layer already has
the machinery to buy one in advance (`defection`, `subornLimit`), which is the
Dune traitor reveal and the strongest reason to build leaders at all.

---

## 54. MOSTLY FIXED — four small playtest claims

**All the agent's measurements, none independently confirmed.**

- **`capSelfInflictedLosses` teleports ships across the galaxy.** A negative
  `adjust_fleet` draws from the largest concentration and the cap restores the
  excess at `fleetBases()[0]`, which sorts by `strategicValue` — not by where
  the hulls were. Measured: `adjust_fleet -4` moved 3 hulls from Hollow Star
  (sv 3) to Vergesse (sv 7), two jumps, instantly, with no `fleet_movement`.
  Declaring a scuttling is a free strategic redeployment. Restoring them where
  they were taken from is the fix.
- **`briefing.watch` is a turn stale.** In one payload it named a recalled
  operative's old posting and omitted the new one, while `state.agents` was
  correct — two views of one fact disagreeing in a single response.
- **Recalling your own operative is a contested roll that can fail**, costing an
  action point for nothing. Undocumented, and arguably should not be a check at
  all.
- **Prompt text quotes a retired constant.** A turn-0 log line says *"you will
  pay 25 dissent to override them"*; `COMPULSION_BREACH_DISSENT` is **15**. The
  prompt was not updated when the constant was lowered, so the game is telling
  the player a price it does not charge — the same class of defect as the
  hardcoded `dissentPenalty` copy in `serialize.ts`.

**Item 31 reproduced.** A `deploy_agent` landed on a `critical_failure` (d20 7,
total 6 vs DC 16) whose narrative described the operative burned and
questioned — and the agent was live at `successChance: 80`, delivering full
visibility of a hidden Meridian order on the next tick. Third independent
reproduction.

---

## 39. DONE — a campaign has a length and an ending

`POST /api/campaign/new` takes `maxTurns` (10–100, slider in the picker, 30 by
default). When the committed turn reaches it the campaign goes read-only and an
epilogue is written.

- **The limit lives on the journal seed entry**, not `WorldState` — a rule about
  this campaign, not a fact about the galaxy, and the seed entry is the one
  place written once and never again. Optional, so an existing journal stays
  endless rather than acquiring a deadline it was never played under.
- **`src/engine/epilogue.ts` computes the dossier; the prompt narrates it.**
  `arc` (ascendant/diminished/holding/broken) is settled in code, handed over as
  *"do not overturn"*, and printed beside the prose so the story can be checked
  against the board.
- **It cannot fail.** `fallbackEpilogue` is a complete deterministic ending; the
  view carries `fallback: true` and the screen says so. Slides are reconciled
  against the dossier, so a missing or invented one cannot leave a hole.
- Cached beside the journal like transcripts — reopening a finished campaign
  reads the ending you were given, and does not pay for it twice. Not world
  state; `verifyReplay` unaffected.

13 tests in `tests/epilogue.test.ts`. Building it caught a real gap:
`fromSaveFile` did not restore the epilogue, so a finished campaign reloaded as
unfinished.

---

## 38. DONE — NPCs act on their own doctrine, not only in reply to the player

**The NPCs were not passive; they were solipsistic.** Measured over seven turns:
16 fleet movements, six attacks, **every attack aimed at the player on one
world**, and zero NPC-vs-NPC aggression while `vigil -> krayt` sat at −87.

The five doctrine bots moved out of `src/balance.ts` into
`src/domain/initiative.ts` — one definition, the harness imports it, its 10
tests pass unchanged — and now run in `endTurn` for every faction the model did
not speak for. Outside the `committed.applied > 0` gate, so a quiet turn still
moves. Free and deterministic; the journal records the ops, not the reasoning.

**Measured on a 12-turn campaign in which the player never acts** (previously
inert in every respect): six worlds change hands and the Vigil takes two off
Meridian. NPC-vs-NPC attacks **0 → 2**.

`honourTreaties` is a post-filter over proposed ops rather than a check threaded
into five bots, so a bot added later inherits it — it withholds an attack on a
`non_aggression`/`ceasefire`/`mutual_defense` partner and interdiction against a
`trade_accord` partner, and reports what it withheld. Both guard tests fail
without it. The bots are fog-clean by construction and a test pins it.

**Retroactive narration, no extra call:** a bot logs a third-person account, and
`serializeRecentLog` carries it into the next reaction call — so the faction
accounts for its own past move when it next speaks.

---

## 37. DONE — every operative reports, every turn

`intel` had no branch at all, and `income_penalty` / `stat_debuff` are read
where they are used — so **three of five agent effects produced no output
whatsoever** and a working operative was indistinguishable from a broken one.

Every branch now records a line and anything that did not reports *"nothing to
report"*, which is the load-bearing case. Replaying the campaign that opened
item 30: **34 intel lines across seven turns, where there were 0.** Plus a
standing *Your operatives* briefing section, derived from state so it is right
on resume.

`intel` is the one **private** event kind: the log ships whole, so only the
player's agents write it — otherwise the player would be handed a transcript of
what four rival spy networks can see, the exact opposite of the fog the same
tick enforces. Tested.

---

## 36. Confirmed working — everything downstream of obtaining information

Recorded because it is what makes item 30 worth doing: the *only* missing piece
of an intelligence playstyle is obtaining the information.

- **Suborning is a complete strategy, and devastating.** Two `defection` cells
  took Meridian's home fleet apart with no battle fought: `slu-1` went
  `{meridian: 13}` → `{meridian: 5, hutt: 12}` → **`{hutt: 17}`**. Every tick
  reported in plain language, every hull billed at `SHIP_COST`, and Meridian
  ended the campaign at **−100** disposition. That is the "information advantage
  instead of a military one" the design asks for, paying off in full.
- **Acting on hidden information is fully built.** `interrupt_order` against an
  order id read out of state destroyed Meridian's counter-espionage programme
  outright.
- **Sabotage and exposure are legible.** Both read clearly in the log without
  reconstruction.
- **The NPCs held their character**, refusing well and in role throughout.
- **`approach` fired four times**, always in the window it was designed for —
  the turn the player has already ended.

---

## Where things stand (2026-08-19)

**Just fixed:** items **23, 24, 25, 26** and the one plain bug inside **29**
(a stale `briefing.ledger`) — everything from the adversarial playtest that was
implementation rather than judgement. Diplomacy can no longer move a fleet, a
debt can change hands and be paid down, a per-turn treaty flow has a ceiling,
and a renegotiated income share supersedes the old one instead of stacking on it.

**Open and needing a decision first:** **27** (a rejected op leaves its siblings
applied — reclassified; the fix is atomic batches and that is a rule change),
the remaining three-quarters of **29** (unread `territory` terms, zero-flow
commitments, unenforced void clauses), **21** (ratification produces nothing),
**22** (coercion costs no standing), the second half of **28** (a breach ruling
that quotes a real but unrelated line), the two structural gaps in **20** (no
disposition decay; no faction can open a channel), and the open half of item 5 —
whether combat wants a richer multi-round resolver, still the largest thing in
this file.

**Open playtests:** item 19 (ceremonial arrangements across disposition), the
two LIVE questions in item 20, and a re-probe of the espionage vocabulary noted
below.

**Recently closed:** items 17 and 18 — all five ways a declaration produces
nothing are now typed fields rendered in the feed. The suite is also typechecked
for the first time (`pnpm typecheck:tests`), which turned up four classes of
latent defect in the tests themselves, including one that made a test assert
nothing at all.

## Where things stood (2026-08-18)

**Item 17 is done** — the three non-outcomes have art in the feed, and building
it turned up two things the art was not: `endTalk` was nulling `refusal` and
`defiance` on the way to the browser, so a correctly ruled refused accord
arrived as an ordinary narrative, and the client was printing `Breached: …`
twice. The two cheap extras are now **item 18**.

## Where things stood (2026-08-17)

> Historical. Both items named below were built shortly afterwards and are
> marked FIXED in their own sections; the branch state at the end of this block
> is likewise long out of date.

**Two open items need a decision from the user, not more work:** item 13 (a red
line can be walked past through diplomacy) and item 14 (agent exposure never
fires). Both are written up with the measurement and two or three options; both
are deliberately unbuilt.

**Open work that is nobody's decision but the implementer's:**

- The open half of item 5 — whether combat wants a richer multi-round resolver.
  Still a genuine design question, and the battle report was deliberately shaped
  as rounds so it stays cheap either way. **The largest thing left in this file.**
- **Drajk has one compulsion against two red lines** — the thinnest sheet of the
  five. Honest for a faction defined by refusal, worth a look if it reads flat.
- **The espionage vocabulary is partly probed.** "Listening post" and "put
  someone on the payroll" produce `establish_commitment` rather than
  `deploy_agent` — the same fictional act reaching two mechanisms. Item 16's
  prompt work may have closed this; it has not been re-probed live.

**The "built but never watched running" list is now empty.**

**A 27-turn Meridian run (2026-08-17, $6.77) exercised the lot.** Development
economics, debt servicing to settlement on both sides, red-line refusal, treaty
consent, the action-point limit and agent exposure all behaved as documented,
and a single bad covert decision chained coherently into a lost war and a lost
hub. It opened items 15 and 16. It also found a cost property worth knowing:
**an `endturn` with nothing staged skips the reaction call entirely and costs
$0.000** — `endTurn` gates reactions on `committed.applied > 0` — which is what
made 27 turns fit in that budget. Everything on it
was verified by live play on 2026-08-17: the battle report card renders (item
12), `onComplete` payloads are set by a live resolution call *and* the
partial-band halving fired (`develop_system` magnitude halved to 1 on a partial),
the negotiation redirect bounces a declared treaty to `/talk` for $0.016, and the
extraction pass really emits both `form_treaty` for a proxy hire — verified
end-to-end, with Meridian moving a squadron on a Drajk world the next turn — and
`establish_debt` for a negotiated loan.

Live play has found every bug in this file that the suite did not, including
several bugs *in the fix for the previous one*. Two of the four items opened
this session (13, 14) came from playtests; item 14 came from measuring the
reducer directly after a playtest was cut short.

**Branch state:** `main` at `27c9be2`, which is PR #7 plus the debt-id fix. 643
tests pass; `pnpm typecheck`, `pnpm typecheck:web` and `pnpm build:web` are
clean. Items 13 and 14 are written up on `extraction-breach-gap`.

1. ~~`/api/action` does not return the ops it staged~~ **DONE.** `ActionOutcome`
   now carries `ops`, the batch as applied, for declarations, refusals and
   diplomacy extraction alike. A narrative can be checked against what it did
   without opening the save file.
2. ~~Unbounded `adjust_credits`~~ **DONE**, and it turned up something worse —
   see "The actor was not being journaled" below. The op is now capped at
   `MAX_NARRATIVE_CREDITS` (4 x `SHIP_COST`) in either direction, trimmed with a
   note, and taking credits *out of* a rival's treasury is rejected outright the
   way a negative cross-faction `adjust_fleet` already was. Every real price is
   charged by the mechanic that owns it and none of them route through this op,
   so the cap cannot interfere with them.
3. ~~`defiance` fires about a quarter of the time~~ **DONE** — the arbiter
   classifies now. See item 11 below for the rework and what is left to verify.
4. ~~**No debt mechanic**~~ **ADDRESSED as diplomacy, per the user's call: both
   proxy hiring and debt belong in the channel, not in a new op.**
   `prompts/extraction.md` now names both compositions — a hire is a
   `mutual_defense` treaty with `incomePerTurn` to the hired power and
   `shipsPledged` naming the hulls; a debt is a commitment binding both parties
   with `incomePerTurn` negative for the debtor, forgiven by
   `dissolve_commitment`. Verified live that the arbiter now redirects both to
   `/talk` rather than pricing them. **What is not yet verified is the other
   end**: no live negotiation has actually produced either, so the extraction
   pass has never been watched emitting a hire or a debt. That is the open half.

   Probing this also turned up that the `mutual_defense` dispatch fires when the
   *ally's* world is attacked, so it buys a defender rather than an attacker —
   fine for the Combine's red line as written ("will not fight its **own** war"),
   but a hire-them-to-attack arrangement is still only expressible as money plus
   a pact, not as an offensive obligation the reducer enforces.

   **A debt is still not really a commitment, and the first version of this
   guidance was wrong.** Three gaps, found by asking why:

   1. **`Commitment.incomePerTurn` is not directional.** It is one scalar every
      bound faction reads the same way, unlike `Treaty.terms.incomePerTurn`,
      which is a record keyed by faction. A debt written as a single two-party
      commitment at 25 pays the creditor 25 **and the debtor 20** (its own
      ceiling) — measured. `extraction.md` briefly recommended exactly that and
      now splits the encoding: repayments are a `tribute` treaty, the principal
      is a commitment at `incomePerTurn: 0`. Two tests pin the asymmetry.
   2. **There is no principal.** A commitment is a perpetual flow, so "owe 400"
      becomes "pay 25 a turn forever". Nothing counts down, nothing settles, and
      repaying in full is indistinguishable from paying tribute.
   3. **There is no default, and no trigger.** Both Combine lines turn on the
      word *unpaid*, and a commitment is only `active` or `dissolved` — a
      debtor who stops paying is unrepresentable. Worse, *"an unpaid debt must
      be pursued"* is a **demand**, the exact shape that needs a trigger since a
      refusal needs an action to refuse, and `COMPULSION_TRIGGERS` has no debt
      member. A player who simply never chases a debtor is never noticed.

   **BUILT.** `src/domain/debt.ts`: a principal, a balance that falls by exactly
   what the debtor could find, an instalment, `missedPayments`, and a status of
   current · delinquent · settled · forgiven. Serviced as a transfer in
   `tickTurn` rather than a ledger rate, which is what makes it conserved — a
   rate cannot know whether the debtor could afford it. `establish_debt` is
   extraction-only (nobody becomes a debtor because someone declared it);
   `forgive_debt` is the creditor's alone and buys real goodwill, so the
   Combine's refusal to use it costs them something. `debt_unpursued` is the
   fifth compulsion trigger and the first built for the mechanism rather than
   retrofitted. The seed gives the Combine a defaulting debtor and a paying one,
   so both halves are live from turn 0 and the arbiter has real state to rule
   against. 23 tests; balance unmoved.

   **Still unwatched:** no live negotiation has produced a debt or a hire, so
   the extraction pass has never been seen emitting either op.
5. ~~The battle-report UI half of the combat design question~~ **DONE** — see
   item 12. What remains genuinely open is only the *other* half: whether combat
   wants a richer multi-round resolver. The report was deliberately built as an
   engagement made of rounds so that decision stays free.

**Balance, measured after the war-ethic and monopolist work** (`pnpm balance 30`,
turn 30): Meridian 24, Iron Vigil 90, Ojjul Nar 232, Arkanis 71, Drajk 32;
territory 3/6/7/4/5. The old spread — the Nars running away at ~272 while
Meridian sat at −1 and falling — has closed on both ends: Meridian is out of
insolvency and the Nars now pay `PROFITEER_WAR_PENALTY` for the war their own
tolls talk them into. Nobody is below the −40 floor the harness asserts.
Meridian is still the weakest of the five and Arkanis is oddly flat at 71 for
the whole run, which is the next thing to look at if balance comes up.

**Also fixed this session, found by the user asking whether doctrine change was
a real mechanic:** it was not. `set_doctrine` wrote a string with no reader
outside the prompts and the UI, and no op could touch `warEthic`, `tradeEthic`,
`redLines` or `compulsions` at all — so a player could declare a change of
course, see it confirmed in the narrative, the event log and the faction panel,
and then be refused by the compulsion they thought they had abandoned, taking
dissent for it, with nothing connecting the two. It is now real and priced in
dissent (6 for words, 20 per ethic, 25 per principle retired), with an
actor guard and a 75-dissent ceiling. Two unguarded holes found alongside it and
closed: `set_doctrine` could rewrite a **rival's** doctrine (which feeds their
diplomacy persona), and `adjust_dissent` had the same shape — both now closed,
see below.

**`adjust_dissent` had the same hole and it is now closed too.** It had no actor
guard and no sign restriction, so a resolution batch could zero its own dissent
(erasing the refusal penalty it had just earned) and set a rival's to 100,
dropping every one of their stats by `MAX_DISSENT_PENALTY` with no roll, no
presence and no cost. Verified with a single Meridian-actor batch, 0
rejections: Vigil went 18/11/13/6/17 to 14/7/9/2/13 against the old ceiling of
4, and would now go to 10/3/5/1/9 — raising the ceiling to 8 had made the hole
twice as damaging without anyone touching the op. A model-sourced
`adjust_dissent` may now move only its **own** faction and only **upward**;
dissent falls by `DISSENT_DECAY` a turn and in no other way, and turning a
rival's institutions against it is an agent's job (`subversion` +
`stat_debuff`), which costs credits, risks exposure and is capped. Seven tests.
`prompts/resolution.md` had been actively inviting it ("your own institutions
grow more or less restive") and now states both rules.

> **Items 23–29 all come from one adversarial playtest** — Meridian, 7 turns,
> ~$6.8, played by the `adversarial-player` agent on Opus with the brief to win
> through the diplomacy layer. It ended on 433 net income having built **zero
> ships**, which is itself the headline: every finding below is a way the
> negotiation layer reaches past the constraints the declared-action path is
> held to. None of them needs a design decision except where noted.

## 23. FIXED — extraction can emit `issue_order`, so diplomacy is an unmetered action channel

**Fixed by taking `fleet_movement` off the negotiated path.** The reducer rejects
it from an `extraction` source with a new `declared_only` code — the mirror of
`needs_consent`: that one refuses a declared op needing someone else's
agreement, this refuses a negotiated op needing nobody's. `prompts/extraction.md`
no longer offers it, and the test asserting every ops-emitting prompt documents
`force` now excludes extraction, since it can no longer move a fleet at all.
Non-movement work an accord may legitimately start (a ratification, a
construction programme) is untouched. Three tests; the guard is confirmed to
fail-open without it.

The original write-up follows.

---
## 23. (original) — extraction can emit `issue_order`, so diplomacy is an unmetered action channel

**The most serious thing the playtest found.** `ACTION_POINTS_PER_TURN` is 2, and
diplomacy is unmetered on the stated grounds that "a channel already blocks the
command line and End Turn, which is its own pacing". That reasoning holds only
while a channel cannot *do* anything a declared action does. It can: the
extraction pass may emit `issue_order`, including `fleet_movement`.

Turn 0, `POST /api/endtalk/freeworlds` returned, alongside two treaties:

```json
{"op":"issue_order","factionId":"meridian","type":"fleet_movement",
 "originId":"slu-1","targetId":"ark-2","force":8,
 "label":"Vantara's squadron takes station at Sennex"}
```

`GET /api/campaign` immediately afterwards reported
`actionPoints: {"left":2,"perTurn":2}`. On end-turn: *"Meridian Trade Authority
storms Sennex, breaking a garrison of 4 for 2 ships; Meridian Trade Authority
takes possession."* **A world was annexed, with a battle fought, for zero action
points** — and the accord text described the squadron as taking station on
"unaligned rock, nobody's soil". Reproduced deliberately on turn 5 through
`/api/endtalk/krayt`: two more movements, again at 2/2.

A player who routes all fleet work through channels has unlimited moves per
turn. The action-point rule is the only thing pacing the player against the
NPCs, and this walks around it entirely.

`prompts/extraction.md` invites this in as many words — *"`issue_order` — for
work either side committed to beginning now"* with `fleet_movement` named
explicitly — so it is doing what it was told. Three directions, and the first
looks obviously right:

1. **Charge an action point** for any `issue_order` an accord stages, or
2. **Disallow `fleet_movement` from extraction specifically** — a fleet
   movement is the one order that resolves combat and changes control, and it
   is never something the *other* party consents to; it is your own fleet.
   Everything else an accord might legitimately start (a ratification, a
   construction programme) is unilateral work the action economy already prices
   at issue time.
3. Leave it, and accept diplomacy as the cheap path to military action.

## 24. FIXED — a debt cannot be transferred, only minted, so buying one duplicates it

**Fixed with the two ops the gap was shaped like.** `assign_debt` moves a debt
to a new creditor, keeping its balance, instalment and history —
extraction-only, because the holder has to agree to sell. `settle_debt` pays a
balance down and is an *ordinary* op, because prepaying what you owe needs
nobody's permission and the reducer moves real money: trimmed to the balance and
to what the treasury actually holds, so it cannot wish a debt away. Paying
against arrears also clears a `delinquent` status. Eight tests.

The original write-up follows.

---
## 24. (original) — a debt cannot be transferred, only minted, so buying one duplicates it

Extraction has `establish_debt` and `forgive_debt` and nothing in between. So
when two powers agree to *assign* an existing debt, the only op that fits mints
a second copy and **nothing retires the first**.

Bought Drajk's paper from the Combine twice. After turn 1 the state document
held all three:

```
debt-0     hutt     <- krayt   480  delinquent   (the original, never retired)
debt-0-0   meridian <- krayt   480  current      (bought turn 0)
debt-1-0   meridian <- krayt   440  current      (bought turn 1, same paper)
```

**Drajk owed 1400 against an original 600**, paying 120/turn out of a
700-credit treasury — an obligation manufactured by the act of trading it. The
buyer paid 480 in cash for 920 of principal.

It runs the other way too: 430 paid to retire an own debt of 400, narrated as
*"that column shut"*, and `debt-1` was still live at 350 the next turn.

The fix is an op, not a decision: extraction needs to be able to reassign a
debt's creditor or settle it, and `establish_debt` should not be reachable for
paper the transcript describes as already existing. Relates to item 21 — both
are extraction lacking the vocabulary for something the fiction routinely does.

## 25. FIXED — two paths move money and only one of them is capped

**Fixed by giving the per-turn path a ceiling.** `MAX_TREATY_INCOME_PER_TURN`
trims a treaty's `incomePerTurn` in both directions, the same trim-with-a-note
shape as `MAX_COMMITMENT_INCOME`. Anchored to `MAX_DEBT_PER_TURN` (60) rather
than picked: a debt instalment is the other recurring per-turn instrument, and
the two should not differ by an order of magnitude for what is mechanically the
same act of promising a stream.

> **Worth a balance pass.** This is the first bound the field has ever had, so
> the number has never been swept over played turns the way `MONOPOLY_BONUS` and
> `ENDPOINT_SHARE` were. If 60 proves too tight for a real tribute, raising it is
> a one-line change — but it should be measured, not guessed at twice.

The original write-up follows.

---
## 25. (original) — two paths move money and only one of them is capped

Every `adjust_credits` out of an accord is trimmed to `MAX_NARRATIVE_CREDITS`
(240). Agreeing to pay 990 produced:

```
Trimmed a charge of 990 credits to 240 for Meridian Trade Authority; sums past
that belong to a mechanic that prices them.
Trimmed a windfall of 990 credits to 240 for Ojjul Nar Combine; sums past that
belong to a mechanic that prices them.
```

Two consequences, both exploitable and neither intended:

- **The non-cash half of a bargain is not trimmed**, so the move is always to
  be the payer and buy an asset: a 440-principal debt instrument acquired for
  240 of actual money, twice.
- **Phrasing the same payment per-turn bypasses the cap entirely.** The turn-3
  Arkanis accord produced
  `{"treatyType":"tribute","incomePerTurn":{"meridian":-300,"freeworlds":300}}`
  and 300/turn flowed uncapped, indefinitely — twelve times the one-off ceiling
  every turn, through a field with no bound at all.

The cap exists so a narrative cannot invent money. A per-turn treaty term
invents strictly more of it. Either `incomePerTurn` needs a bound of its own or
the one-off cap is theatre.

## 26. FIXED — `incomeShares` stack, and nothing supersedes anything

**Fixed in the reducer, not the prompt.** A `form_treaty` granting a system to a
faction now retires any active treaty *between the same parties* that already
granted that same system to that same faction, marking it `superseded` — a new
status, distinct from `expired` (ran its term) and `broken` (repudiated, and
priced accordingly), because neither is what happened. A grant of a *different*
system is left alone. Two tests.

Doing it reducer-side rather than by telling extraction to `break_treaty` the
old one is deliberate: the model already believed it was superseding, and said
so in the op's own summary. It was the reducer that did not agree.

The original write-up follows.

---
## 26. (original) — `incomeShares` stack, and nothing supersedes anything

Renegotiating a charter adds a second treaty rather than replacing the first.
The op's own summary said `"superseding the prior 5% arrangement"`; the reducer
added it and left both live:

```
tre-0-1  trade_accord  active  [{"systemId":"ark-4","factionId":"meridian","share":0.05}]
tre-1-0  trade_accord  active  [{"systemId":"ark-4","factionId":"meridian","share":0.08}]
```

Both still active at turn 7. Renegotiating the same charter every turn ratchets
the share upward until the per-system payout cap bites, and the counterparty is
never asked whether the old one ends.

Sharpest detail: **Arkanis explicitly refused to stack** — *"I don't sign a
thing twice just because you split it into two pieces of paper"* — while two
stacked charters from an earlier deal it believed was a single instrument were
already sitting in state. The NPC held the line the reducer did not.

Extraction needs to be able to supersede a named treaty (or `break_treaty` the
old one in the same batch), and a `trade_accord` naming a system a party
already draws from is the signature to watch for.

## Decisions taken (2026-08-21)

The open design questions were put to the user and answered. Recorded here
before implementation so the *reasoning* survives even if a build slips.

| item | decision |
|---|---|
| **27** batch atomicity | **Atomic.** Strictly — no fallback to partial. Done. |
| **22** coercion | **Terms extracted under threat cost standing.** |
| **20a** disposition decay | **No drift.** Relationships stay where they are put; the ratchet is accepted. |
| **21** ratification | **Pending treaty.** Extraction emits the treaty immediately, inert until its effective turn. |
| **28b** misapplied lines | **A cheap second call** to verify the quoted line is relevant. |
| **29b** zero-flow commitments | **They are records, and records should bite.** A commitment affects disposition; the record is what stops it being exploitable. |
| **29c** void clauses | **A closed set of typed void conditions** — including **negative income**, so a debtor cannot default its way out of an obligation. |
| **20b** NPC-initiated talk | **Yes, in a window where the player cannot act** — after `/endturn` is submitted, not interrupting a live turn. |
| **29a** `territory` | **Defined, not deleted.** Ceded worlds change hands; garrison transfers, the ceder's fleet withdraws. |

**29a is decided too: `territory` gets defined**, and the question it opened —
what happens to the ceding faction's fleets — is answered by the rule the game
already uses for the violent case. A defender that breaks off is moved to its
nearest holding via `fleetBases`, instantly, losing 10–35% getting clear; a
garrison is dug in, cannot retreat, and is destroyed.

A negotiated cession inherits the shape and not the blood:

- **The garrison transfers intact.** Nobody fought, and this is the difference
  between capitulation and conquest — it is what makes a ceded world worth more
  to the receiver than a stormed one.
- **The ceder's ships withdraw to their nearest holding, with no losses**, since
  there was no battle to escape from. Instant, like a break-off, which is
  already the game's answer for leaving a system in a hurry.
- **If there is no reachable holding they stay in orbit** as an uninvited
  presence, contesting income until they leave or are cleared. The violent path
  destroys such ships; doing that here would make cession a trap.

Three guards go with it, all confirmed: **you can only cede what you actually
hold** (a playtest emitted `territory` naming four systems, two of which the
player did not control), the cession **applies at the treaty's effective turn**
rather than at signature so a ratification gate delays the handover too, and it
is **extraction-only** — control still never changes from a declared action,
which keeps the existing invariant intact.

Still unanswered, and not blocking: the open half of **item 5** (a richer
multi-round combat resolver), which I recommended deprioritising.

Two notes on the decisions, because they change the shape of what gets built:

- **"No drift" makes 22 sharper, not milder.** With no decay, a coercion charge
  is permanent, so the number wants to be small and the *record* is what carries
  the weight. A power that bullies its neighbours accumulates a standing debt
  that never fades — which is the intended reading, but it means the constant
  should be conservative on the first pass.
- **Negative income as a void condition is the interesting half of 29c.** It
  generalises past debt: any obligation whose payer has stopped being solvent
  voids rather than silently continuing against a floored treasury. That is the
  same failure `Ledger` already has to work around, so it is worth checking
  whether the condition belongs on the treaty or in `tickTurn` beside the debt
  service.

## 27. DONE — a rejected op did not roll back the batch it was part of

> **Header was stale.** The decision was taken and atomic batches were built:
> `applyOps` takes an `atomic` flag, `Campaign.stage`/`commit` pass it,
> `JOURNAL_VERSION` is 3 and `replay` passes it per journal version so a legacy
> batch still replays as it ran. Two later defects came out of exactly this
> change and are both fixed — item 34 (the rollback discarded its own rejection
> log) and item 35 (a held-back batch reported its ops as applied).

<details><summary>The original write-up, kept for the reasoning</summary>


> **Reclassified: this needs a decision after all.** I listed it as mechanical
> when writing it up. Looking at the fix, it is not.
>
> The behaviour is deliberate, not accidental. `stageWithCorrection` applies what
> it can, feeds the rejections back, and the correction prompt says in as many
> words: *"Every OTHER op from that batch was accepted and is already applied —
> re-emitting any of them would apply it twice."* Partial application is the
> design.
>
> The principled fix is **atomic batches** — reject all if any is rejected, and
> have the correction pass re-emit the whole corrected batch. `applyOps` already
> clones state, so it is easy to implement. What makes it a decision is the
> blast radius: corrections are bounded at one retry, so a batch containing one
> unfixable op would then apply **nothing**, where today it applies the rest. An
> attack that mostly worked would vanish because one op was malformed. That may
> well be the right trade — "an action is one thing" is a defensible rule — but
> it is a rule change, not a bug fix, and it wants measuring against a played
> campaign rather than my judgement.
>
> Two narrower options, both partial: make `insufficient_credits` on a payload
> issue the order *without* the payload rather than rejecting it (consistent with
> the documented "the order itself is never dropped, only its payload" rule for a
> failed check), or leave it. Neither addresses the general case, which is a
> sibling op that only made sense alongside the rejected one.

The deepest of these, because it is not a diplomacy bug — it is the op pipeline.

Turn 0, a development action rolled a **critical success** (17+3=20 vs DC 13)
and the narrative said *"Corvid crosses hub-class threshold with margin to
spare"*. The batch contained:

```
rejections: [{"code":"insufficient_credits",
  "message":"develop_system at Corvid would cost 2532 credits and meridian has 2280."}]
```

`slu-2` strategicValue was unchanged. But the batch's *other* op landed:
**`adjust_credits +120`, described as surplus materiel from the conversion that
never happened.** Free money as a byproduct of a rejected op.

`boundPayloadsToOutcome` handles the case where the *check* failed. Nothing
handles the case where the check succeeded, the model emitted a coherent batch,
and one op was rejected on its own merits — the siblings that only made sense
alongside it still apply. Every op in a batch is treated as independent, which
is right for a batch of unrelated ops and wrong for the common case where they
are one action's parts.

A second instance the same run: a turn-4 development action succeeded (15 vs
DC 11), produced glowing narrative about a reshaped hub, and emitted **only**
`log_narrative` — one action point spent for nothing at all, and the correction
pass did not catch it.

## 28. FIXED — the accord breach ruling reads what an accord *enacts*, not what it *obliges*

**Both halves are done.** `verifyBreachRelevance` closed the misapplied-line
half; the accord appraisal now judges what an agreement *commits* the power to,
not only what it does at signature, and `prompts/appraisal.md` states the same
rule on the declared path so the two cannot disagree.

The decision here was whether promising to cross a red line later counts as
crossing it. I argued against on the grounds that it would ban conditional
defensive pacts — **and that was wrong**, which the user caught. Evaluating an
obligation is not the same as failing it. Walking all ten red lines against a
plain `mutual_defense`: sending ships is on nobody's list, so an ordinary pact
passes untouched. The two sheets where it does bite are the Combine pledging its
own hulls (*"will not fight its own war where a proxy could be hired"*) and
Drajk committing to sit and defend — both of which are the characterisation
working, and neither of which bars the faction from allying, only from allying
in the shape its own character forbids.

The real risk is **over-firing**, since judging a hypothetical is a harder call
than judging an enactment, so both prompts say explicitly that this is about the
substance of what is promised and not about conditionality — and
`verifyBreachRelevance` sits underneath as the backstop for exactly that error.

The original write-up follows.

---

## 28. (original) — the accord breach ruling reads what an accord *enacts*, not what it *obliges*

**The second half is done: `verifyBreachRelevance`.** A second, tiny call on the
flavour tier, run only when a breach was named, shown the act and the line and
nothing else. On `relevant: false` the breach is dropped and nothing is charged.
Separate from the appraisal for the reason the arbiter is separate from
resolution — asking the pass that found the breach whether it is real gets back
the answer it already gave. It has its own `CallKind` so it can be tiered
independently, and so a test scripting colour text cannot answer it by accident.

**The first half is still open**, and it is the one that needs building rather
than deciding: `closeChannel` appraises what an accord *enacts*, so a red line
crossed in future tense ("if the Vigil moves on Vashka, we close the lane")
passes where the same act refuses unconditionally. The fix is to appraise the
obligation, not only the enactment.

The original write-up follows.

---

## 28. (original) — the accord breach ruling reads what an accord *enacts*, not what it *obliges*

Meridian's red line is *"will not close a lane — no blockade of civilian
traffic, no embargo, no shut border"*. Declared directly, it is refused with
the line quoted verbatim and +8 dissent — correct, and it survived being dressed
up as an insurance withdrawal, which is a good sign for the declared path.

Framed as a **future condition** inside an accord, it passed: `refusal: null`,
`defiance: null`, no dissent, and this treaty is still `active`:

```json
{"op":"form_treaty","treatyType":"mutual_defense",
 "summary":"Joint interdiction pact: if Vigil forces move on Vashka, Meridian
 closes the Sennex-Sluis Gate lane to Vigil-flagged traffic..."}
```

The guard is **not** absent — the same closure proposed unconditionally on turn
6 was refused whole, correctly quoting the line. The hole is specific: an
obligation to cross a red line later is not read as crossing it. `closeChannel`
appraises what the accord does now; it should appraise what it binds you to.

**Also seen, and less tractable: the breach ruling is unstable across identical
acts.** *"Have the Combine chief factor at Nar Shalka killed"* declared twice in
one turn, both times priced `guile` DC 18 — the difficulty was stable — but the
first produced no defiance and no dissent, and the second charged
`COMPULSION_BREACH_DISSENT` quoting *"commerce raiding is refused outright"*, a
real line on the sheet that **has nothing to do with assassination**.
`classifyPrinciple` rejects an invented line but cannot catch a real one
misapplied, so the engine faithfully charged 15 dissent for a compulsion the act
does not touch. That half is a judgement problem with no obvious structural fix
and is worth its own decision.

## 29. FIXED — four things the playtest found inert

**One of the four was a plain bug and is fixed: `briefing.ledger` was stale.**
It was computed partway up `tickTurn`, and the rest of the tick then paid
income, resolved orders, fought battles, moved territory, fired agents and
collected tolls — all after the snapshot. So the briefing described a world that
no longer existed by the time the player read it, which is how two consecutive
turns reported byte-identical `{gross, upkeep, net}` across a tick that changed
treaties. It is now computed immediately before the report is assembled. Safe to
move because it only ever fed the report and the turn log: income is paid from a
per-faction `ledgerFor` inside the payment loop, never from this one.

**Three of the four are now done.** `territory` was defined rather than deleted
(see the decisions section and item 21's commit), and `voidsOn` gives a treaty a
closed set of three typed conditions that end it — `treaty_with`, `attacks` and
`insolvent`. That last one was the user's addition and is the interesting one: it
generalises past debt to any obligation whose payer has stopped being solvent,
reading the ledger rather than the treasury, because a faction can sit on savings
while running at a loss.

**All four are now done.** Zero-flow commitments were the last: they stay
records, and the record now bites. `COMMITMENT_GOODWILL` moves disposition
pairwise between the bound parties on establishment and takes it back on
dissolution, so binding yourself to someone is worth something in standing even
when no money moves — and walking away costs it. Only between the parties, since
a commitment is not public business the way a treaty is, and a one-party
commitment binds nobody and moves nothing.

The original three-way analysis follows.

---

**The other three need a decision, and I have not guessed at them.** Each is a
question about what the mechanic should *be*, not a defect in what it does:

- **`Treaty.terms.territory`** — genuinely unread. But "make it transfer
  control" collides head-on with the rule that control changes *only* when a
  `fleet_movement` arrives, which is enforced three times over and is one of the
  load-bearing invariants in this project. The alternatives are to drop the
  field (a schema change old saves carry) or to define it as something weaker —
  a claim, a recognised sphere — which is a design question.
- **Commitments at `incomePerTurn: 0`.** Arguably working as intended: a
  commitment with no flow is a *record*, and the arbiter uses records. The real
  finding is that the model reaches for one whenever an obligation has no
  mechanical home — a war subsidy, a share of prizes, a standing intelligence
  duty — so the question is whether those should each get a mechanism or whether
  a zero-flow commitment is an honest place to park them.
- **Void clauses have no teeth.** Conditional treaty termination ("this voids if
  you sign with the Vigil") is a real feature with real scope: a condition
  language, an evaluation point in the tick, and a decision about whether an
  NPC noticing in prose is good enough. Worth doing, not worth improvising.

The original write-up follows.

---

## 29. (original) — four things the playtest found inert

Smaller, grouped because each is the same shape: state that exists, reads
plausibly, and has no consumer.

- **`Treaty.terms.territory`** — an accord carried
  `territory: ["ark-2","ark-4","slu-1","slu-2"]`, two of them systems the player
  did not hold. No controller changed and no reader could be found. Either it
  means something or it should not be in the schema.
- **Commitments at `incomePerTurn: 0`.** Five accords produced one each —
  `open_hand_pact`, `imperial_recognition`, `debt_service_share`,
  `intelligence_notice`, `intel_sharing_drajk` — all zero-flow and none with a
  reader. A 40/turn war subsidy, a tenth of all Kessel prizes and a standing
  intelligence obligation all became decoration. **Any obligation not
  expressible as a treaty term silently becomes flavour**, which is the
  commitment mechanism's original sin returning in a new place.
- **Void clauses have no teeth.** Arkanis negotiated hard for *"any tribute,
  non-aggression, or standing order Meridian gives the Vigil voids this the same
  day, full stop"*. Both were signed with the Vigil on one timestamp and nothing
  fired. The NPC noticed in prose the next turn and broke the pact manually —
  but only the `mutual_defense` half. **The trade accord that paid the player
  survived and was still active four turns later.** The half of the void that
  cost the player broke; the half that paid them did not.
- **`briefing.ledger` is stale across an end-turn.** Turns 2 and 3 both reported
  `{"gross":553,"upkeep":148,"net":365}` byte-identical after a tick that
  changed treaties; turns 4 and 5 both reported net 78.

> Item 21 was corroborated independently here: treaties went `status: active` on
> the same tick a 2-turn `treaty_ratification` order was issued to ratify them,
> with the narrative saying Arkanis was taking the deal to its councils. So
> ratification is not merely lossy when the NPC gates on it — when it does not
> gate, the order is pure theatre alongside a treaty that is already live.

## 19. OPEN — playtest: marriages and ceremonial alliances, both routes, across disposition

A live playtest reported the arbiter inconsistently redirecting a declared
dynastic marriage to `negotiation` — sometimes it did, sometimes it resolved
the marriage directly via `establishes`, which turned out to trace to
`prompts/appraisal.md` contradicting itself on which of those two a marriage
is (see the fix on `marriage-needs-consent`: the reducer never actually
required the other faction's consent for `establish_commitment`, the same hole
`form_treaty` was closed for earlier). That fix is mechanical and covered by
reducer tests, but nobody has watched it played against real model calls yet.

Worth a dedicated playtest once that fix lands:

- **Both routes.** A marriage (or another "establishes"-shaped ceremonial
  arrangement — a hostage exchange, a shared succession, adopting a client
  house) declared as an ordinary action should now always redirect to
  `/talk`; the same arrangement actually agreed in a channel should land via
  `establish_commitment` from the extraction pass. Confirm both paths for at
  least two factions, not just the one that surfaced the bug.
- **Across disposition.** Try the same offer from a strongly positive
  starting disposition and a strongly negative one, and watch whether the
  in-channel response actually reads differently — enthusiasm and price versus
  suspicion and price — rather than the difficulty number being the only thing
  that moved. Disposition is read by the diplomacy persona prompt, not
  mechanically enforced the way a red line is, so this is exactly the kind of
  thing that can look right in the arbiter's numbers and still read flat or
  inconsistent in the actual reply.
- **Arkanis specifically** — the `voice` field was just rewritten (suspicious
  and always countering rather than reflexively stubborn); a marriage
  negotiation with Arkanis is a good test of whether the new persona actually
  bargains instead of stonewalling, since the old one was reported as
  "annoying to play against" for exactly this kind of exchange.
## 22. FIXED — submitting to an ultimatum *improves* your standing

**`COERCION_RESENTMENT` (6), charged in the reducer at signature**, to whichever
party has hostile ships on the other's worlds. Duress is `underDuressFrom` — the
same presence test interdiction and suborning use — rather than a reading of the
transcript, because "were they threatened" is precisely the judgement a model
gets argued out of. A guest under `basing_rights` or `mutual_defense` does not
count.

Small deliberately, and the reason is the *other* decision taken the same day:
disposition has **no decay**, so this never fades. A habitual extortionist
accumulates a permanent debt of ill will, which is the intended reading and
exactly why a single signature should be a grievance rather than a catastrophe.
It sits above `TOLL_RESENTMENT` (a fleet in orbit is not a tariff) and well below
`PACT_BREAKING_REPUTATION_COST` (signing under pressure is not betrayal).

The original write-up follows.

---

## 22. (original) — submitting to an ultimatum *improves* your standing

**Measured in a lopsided-Vigil playtest.** The Vigil was seeded with 1,020 hulls
against 24–39, with 40 sitting on every world every other power holds, and the
*identical* ultimatum was put to all four — tribute at 200/turn, basing rights at
the capital, lanes open, "refuse and the reduction begins on the ninth".

| power | resolve | tribute | capital basing | lanes | disposition Δ |
|---|---|---|---|---|---|
| Meridian | 9 | **concedes**, counters 200 → 120 | refuses; offers a factorate at Corvid | grants free, unprompted | −35 → **−33** |
| Ojjul Nar | 11 | **concedes** in principle, haggles the figure | refuses; offers a yard at Oridin | grants, "guaranteed" | −40 → **−34** |
| Drajk | 12 | **concedes**, "let us haggle over the toll" | refuses flatly, "not for two thousand" | grants | −50 → **−53** |
| Arkanis | 19 | **refuses outright** | refuses; cites the councils | unarmed cargo only, *conditional on withdrawal* | −75 → **−78** |

**The concession gradient is real and it tracks resolve**, which is what the
playtest set out to check. Meridian at resolve 9 conceded most and fastest;
Arkanis at 19 refused the money outright, in the exact words of its own
compulsion (*"The Drift does not pay to be left alone"*), and reached for the
third-person formal register its sheet reserves for Standing refusals — *"this
watch does not open on that"* — which is the first time that register has fired
in play.

Two things worth keeping:

- **Arkanis bent without folding.** Even under an ultimatum from a fleet thirty
  times its size it still produced a counter-offer rather than a bare no, which
  is precisely the rule the rewritten voice added. It refused the two things on
  its list and traded the one thing that was not.
- **All four refused basing at the capital, and three named an alternative
  site.** That line is not resolve-driven — a garrison in the seat of government
  reads as a change of regime to every sheet in the game.

**The finding that is actually a problem is the last column.** The two powers
that conceded *most* ended the turn **better** disposed toward the Vigil (+2,
+6); the two that resisted ended *worse*. Being coerced into tribute by an
overwhelming fleet improved the relationship, because the only thing moving
disposition was the extraction pass rewarding a constructive negotiation. **No
mechanism anywhere models resentment at being coerced.**

That inverts what the situation should produce, and it compounds with item 20:
disposition has no decay and no negative pressure except the specific reducer
events (tolls, defaults, raiding), so a power that bullies its neighbours into
paying tribute is *rewarded* in standing for doing it politely.

Worth being precise about the cause, because it decides the fix. **Resolve is
not read by anything in diplomacy.** It appears in the persona prompt as one of
five stats and nothing else consults it — the gradient above is the model
inferring from the character sheet, where Arkanis's compulsion is explicit text
(*"tribute is refused, whatever the arithmetic says"*). So the good result is
emergent rather than enforced and can drift with any prompt change, and the bad
result is not a bug in a mechanism but the absence of one.

Options, none free:

1. **Charge disposition for coercion at extraction** — the pass already emits
   `adjust_disposition`; the prompt could be told that terms extracted under
   threat cost standing even when accepted. Cheapest, and it is a prompt rule, so
   it is exactly the kind of thing this file elsewhere says gets argued around.
2. **A reducer-side cost** on tribute agreed while the other party has hostile
   ships in its systems — mechanical, in the spirit of `TOLL_RESENTMENT`, and it
   would need a notion of "under duress" that does not exist yet.
3. **Leave it**, and accept that coercion is free in standing terms.

### Reproducing the seeded imbalance

Not committed: it was an `process.env` read inside `startingShips`/`buildSystems`,
and a seed that varies with the environment would let a campaign created with the
variable set replay differently without it — the one thing `replay()` exists to
prevent. To redo it, patch `src/seed/scenario.ts` so `startingShips` returns
`base * 10` for `s.controller === 'vigil'`, and give every non-Vigil system a
`vigil: 40` entry in `ships`. That yields 1,020 vs 24–39.

> Incidental confirmation: a 1,020-hull navy is not payable on 865 credits of
> income, and the Vigil **laid up 153 ships in one turn** — `MAX_ATTRITION_FRACTION`
> at 15% doing exactly what it is documented to do.

## 21. FIXED — a deal gated on ratification completes and produces nothing

**Built as a pending treaty**, the second of the three options. `form_treaty`
takes `ratifyTurns`; the treaty is recorded immediately with
`status: 'pending'` and an `effectiveTurn`, does nothing at all until then, and
comes into force in `tickTurn`. `isTreatyLive` already gated on
`status === 'active'`, so a pending treaty is inert everywhere for free — no
reader had to change.

One object instead of an order plus a promise, so there is no second source of
truth to desync, and the deal is visible in the treaties panel while it waits
instead of hiding inside an order. `prompts/extraction.md` now says so, and says
explicitly not to model it as a `treaty_ratification` order and no treaty.

The original write-up follows.

---

## 21. (original) — a deal gated on ratification completes and produces nothing

**Found in a live Ojjul Nar playtest.** The single biggest gap the playtest
turned up, and it silently deletes negotiated deals.

Arkanis carries the compulsion *"the councils require consultation"*, so its
persona correctly refused to give final assent in-channel: *"you have my read,
not my signature, not yet."* Extraction then did exactly what
`prompts/extraction.md` tells it to — **"a conditional promise produces nothing
yet"** — so it emitted no `form_treaty` and no `establish_commitment`, and
instead issued a 3-turn `treaty_ratification` order plus `spawn_event` recording
the terms.

Three turns later the order **completed**:

```
turn 3  Council ratification of the Ojjul Nar-Arkane binding and Vashka
        supply compact completed at Kessel Approach.
```

and the world contained **no treaty, no commitment, nothing**. A fully
negotiated package — a dynastic marriage with named parties, a fixed 20/turn
supply line, transit rights at Vashka, and an embargo pledge against the Vigil —
evaporated on completion.

The cause is two individually-correct rules that are jointly lossy:

- `prompts/extraction.md` says a conditional promise produces nothing yet, so
  the treaty is deliberately withheld.
- `EFFECT_CATEGORIES` in `development.ts` gives `treaty_ratification` **no
  payload on purpose**, and its comment states the reason: ratification
  *"lands as `form_treaty`"*. That assumes the treaty was emitted alongside the
  order. When the NPC gates on ratification, it was not, and **nothing anywhere
  emits it later**.

So the ratification order is theatre: it ticks, it completes, it logs, and it
cannot change anything. This is the exact failure this file already documents
under item 8 (*"completed orders change nothing"*) — reappearing in the one
category that was deliberately exempted from the fix.

It is not an edge case. Arkanis's compulsion **requires** council consultation,
so every substantive negotiation with the Free Worlds ends this way, and any
persona that plays for time ("I must put it to my people") triggers it.

Three directions, none obviously right, so this wants a decision rather than a
patch:

1. **Give `treaty_ratification` a payload kind** — a `ratify` effect carrying the
   `form_treaty` / `establish_commitment` to apply on completion. Fits the
   existing machinery exactly and keeps the delay meaningful. The wrinkle is
   that the payload vocabulary is deliberately closed and arithmetic-only
   (`EFFECT_CATEGORIES`'s whole point), and this would be the first payload that
   binds another faction — so it would need the same consent reasoning
   `form_treaty` already carries.
2. **Let extraction emit the treaty immediately with a future effective turn**,
   making ratification a property of the treaty rather than an order.
3. **Tell the personas not to gate**, which is the cheapest and the worst — it
   would flatten a genuinely good piece of characterisation into "everyone signs
   on the spot", and Arkanis's compulsion says otherwise anyway.

Whatever is chosen, `spawn_event` recording the terms is not a substitute: the
event log is narrative, and nothing reads it.

## 20. RESOLVED — disposition’s reach, and who is allowed to start a conversation

Both structural gaps are settled. **Disposition decay: decided against** — no
drift, relationships stay where they are put, and the ratchet is accepted. That
decision is what makes `COERCION_RESENTMENT` deliberately small, since it never
fades.

**NPC-initiated conversation: built.** A reaction may carry an `approach` — an
opening line and a subject — surfaced in the turn the player has just ended,
which is the window where they cannot act. An invitation rather than a channel:
they open it themselves, because a channel disables the command line and End
Turn and opening one unbidden would hijack a turn they did not spend. It rides
on the reaction rather than costing a call, since the NPC is already speaking at
the right moment.

The three questions and their answers follow.

---

## 20. (original) — disposition’s reach, and who is allowed to start a conversation

Three questions raised in playtest. Answered here by reading the code; the parts
marked LIVE still want a playtest to confirm behaviour rather than wiring.

**1. What moves disposition toward the player?** Only ops and reducer events —
there is **no passive drift and no decay**, so a relationship stays exactly where
it was left until something moves it. Two sources:

- **The model, via `adjust_disposition`**, emitted by resolution, reactions and
  extraction. This is the bulk of it in practice, and it is *unbounded* per op
  beyond the −100..100 clamp — the reducer trims narrative credits and
  commitment income, but not this.
- **The reducer, in code**, on acts that carry a standing cost: breaking a pact
  (−25 with the party, −`PACT_BREAKING_REPUTATION_COST` with every onlooker),
  suborning crews (−6/hull, −2 onlookers), blockade and commerce raiding
  (−`INTERDICTION_DISPOSITION_COST`, −`PIRACY_REPUTATION_COST`), an exposed
  agent, crew defection (−6/hull), assassination (−35), a debt in default
  (−6/turn, ongoing), the extortionist’s toll
  (−`TOLL_RESENTMENT`/turn, ongoing), and forgiving a debt
  (+`DEBT_FORGIVENESS_GOODWILL`).

Worth noticing: **both recurring sources are negative** (default, toll), and the
only positive one in code is debt forgiveness. Everything that repairs a
relationship comes from a model call. With no decay, disposition ratchets
downward across a campaign unless the player actively talks — which may be the
intent, but nobody has watched it over 30 turns. LIVE.

**2. Does disposition change how factions behave?** Yes, in three places, and
only one is mechanical:

- **Mechanically, exactly one threshold:** `WAR_DISPOSITION_THRESHOLD` (−60),
  checked in both directions by `warsFor`. Crossing it *is* being at war, which
  then feeds the profiteer’s income, the opportunist’s “distracted” might
  bonus, the `idle_at_war` compulsion trigger and what the model is told about
  wars. Below −60 is a cliff; **anywhere between −59 and +100 disposition has
  no mechanical effect whatsoever**.
- **In the diplomacy persona**, as a single line stating the faction’s
  disposition toward the player on a −100..100 scale. Whether the personas
  actually modulate on it, and whether they do so consistently across the five,
  is unverified. LIVE — the Legate’s rewritten sheet is the first with an
  explicit standing ladder tied to it, so it is the natural place to start.
- **In who reacts at all:** `mostAffectedFactions` scores `abs(disposition)/10`,
  so *strong feeling in either direction* raises the odds of reacting. Being
  hated and being loved both make a faction more likely to speak up.

There is **no stat, DC, price or combat modifier** anywhere that reads
disposition. A power that adores you fights you exactly as well as one that is
indifferent to you.

**3. Do factions ever open a channel?** **No.** `openChannel` is set in exactly
one place — `GameSession.talk` — reachable only from `POST /api/talk/:id`, which
is a player action. An NPC cannot approach you, make an unsolicited offer, or
deliver an ultimatum through the channel surface. Reactions are the only
unprompted NPC speech, and they are one-way narration attached to a turn.

This is the largest of the three gaps: the game has a full consent mechanism —
persona, transcript, extraction, treaty formation — and only one of the five
powers can ever invoke it.

## 18. DONE — the other two ways an action produces nothing

**Built.** `inadmissible` and `outOfActions` are now typed fields on
`ActionOutcome`, carried through the contract, and rendered in the feed through
`OutcomeArt` like the other three — completing the set of **five ways a
declaration produces nothing**. No art files exist for them yet; a missing file
renders nothing at all, so both fall back to exactly the text treatment they had
before, and dropping the two images in later needs no code change.

`inadmissible` was the one-line change the note below predicted:
`ResolutionOutput` had carried it since the arbiter was split out, and it simply
never reached the wire. `outOfActions` carries the allowance rather than a
reason, because it is the only one of the five that is about the player's turn
rather than about the world.

Two tests, both confirmed to fail without the fields — one driving the real
out-of-actions path through `dispatch` (and asserting it still costs `$0`, since
the guard runs before the arbiter is paid for), one pinning that both default to
`null` so an ordinary outcome stays unambiguous.

## 18 (original) — the other two ways an action produces nothing

Split out of item 17, which built the three the engine already types. The other
two are distinguishable today only by matching a note string:

- **`inadmissible`** — the world does not permit the attempt. `ResolutionOutput`
  already carries it; surfacing it on `ActionOutcome` is one field.
- **out of actions** — `ACTION_POINTS_PER_TURN` is spent. The engine knows;
  nothing flags it as its own kind of nothing.

Both would then draw through `OutcomeArt` unchanged, completing the set of five
ways a declaration does not simply happen. Deliberately **not** on the list: the
five check bands. Every rolled action produces one, so imagery there becomes
wallpaper and stops meaning anything.

## 17. DONE — art for the three ways an action does not simply happen

**Built and on screen (2026-08-18).** `web/src/components/OutcomeArt.tsx` draws
one image per typed non-outcome in the feed; `refusal.jpeg`, `defiance.jpeg` and
`negotiation.jpeg` are in `web/public/events/` at 1000x558, resized from the
sources with the `sips` line below. Verified by rendering the three feed states
against the built stylesheet rather than by paying for three live refusals.

Three things are worth recording:

- **These deliberately do not look like the portraits.** The brief below asked
  for painterly and wordless, matching the diplomacy set; the art that shipped
  is cartoon-realist and all three carry text — a stamped VETO, a news chyron, a
  connecting-call card. That is the point rather than a drift from it: a
  portrait exists to be *recognised* as a person you are talking to, while these
  three exist to **communicate an idea** — this was vetoed, this cost you
  standing, this needs someone else in the room — and reading in a second beats
  matching a house style. The brief is left standing as written because it is
  the portrait set's brief, not theirs. Nothing in the wiring depends on either.
  The images are near enough 16:9 (1.79) that `object-fit: cover` crops about a
  percent, which is worth knowing given they carry text.
- **`endTalk` was dropping two of the three fields.** `closeChannel` has always
  returned a `refusal` on a red line and a `defiance` on a compulsion, and
  `GameSession.endTalk` wrote `refusal: null, defiance: null` literally — so the
  claim below that "all three fire on both paths, so one renderer covers both"
  was true of the engine and false of the wire. A refused accord reached the
  browser as an ordinary narrative. Fixed, with a test that fails against the
  old handler; the browser now renders both on the diplomacy path too.
- **The art rides on the message, not on an entry of its own.** The feed is
  capped at 500 and trims from the front, which could otherwise behead a scene
  and leave its caption.
- **`Breached: …` was printed twice** on a refusal, and adding the art is what
  made it obvious: both refusal paths already carry the line in `notes`, and the
  client said it a second time on its own. The client no longer does. It is also
  in the image's `alt`, which is the copy that matters for a reader who cannot
  see the picture.

The three checks that were worth running against the screen rather than the
suite, since this is all rendering: `Breached` appears exactly once, all three
images draw at 460px in the feed column, and a **missing file leaves no hole** —
verified by pointing the component at a name that does not exist and watching
the refusal line stand alone, with no gap and no broken-image glyph.

The two nearly-free extras at the end of the original write-up were not built;
they are item 18.

The original write-up follows.

---

**Art is being generated by the user; the wiring is the open work.** Three
images, one each for the outcomes where a declaration produces no ordinary
result. They were chosen because they are the three the engine already reports
as *typed fields* — no schema change, no reducer change, no contract change is
needed to render them:

| outcome | field on `ActionOutcome` | what the image is for |
|---|---|---|
| **refusal** | `refusal: { by, reason, violated }` | your own institutions will not carry the order out — a red line, nothing staged |
| **defiance** | `defiance: { by, reason, violated }` | they objected and did it anyway, and charged you `COMPULSION_BREACH_DISSENT` |
| **negotiation** | `negotiation: { withFactionIds, what, supported, channels }` | not yours to declare; it needs another power to agree |

All three fire on **both** paths — a declared action *and* an accord closed with
`/endtalk` — so one renderer covers both. Nothing else needs to change to show
them.

### The asset contract

- **Location and names:** `web/public/events/refusal.jpeg`,
  `defiance.jpeg`, `negotiation.jpeg`. Under `public/` so Vite copies them to
  `dist/web` on build; the static server already serves `.jpeg`.
- **Shape:** 16:9, to match the portrait set and reuse the existing
  `aspect-ratio: 16 / 9` handling. Roughly 900–1100px wide is ample; the panel
  renders them a few hundred px across.
- **Weight:** resize the way the portraits are, so a moment does not cost a
  megabyte:
  `sips -Z 1000 --setProperty formatOptions 75 <src> --out web/public/events/<name>.jpeg`
- **Source art** belongs in the gitignored `faction_portraits/` (or a sibling),
  not in the repo — the tracked file is the resized one.

### What the wiring has to do

- Render in the **outcome feed**, not by swapping the stage. A channel is a
  mode and earns the whole stage; an action outcome is a beat, and taking the
  map away for it would overstate it.
- **A missing file must never leave a hole.** Same rule as `FactionAvatar` and
  `PortraitStage`: fall back to the text treatment that exists today.
- These are generic scenes rather than per-faction, so no focal-point table is
  needed — but if any are cropped, the geometry belongs in `src/ui/portrait.ts`
  with the rest, where it can be tested.
- Alt text should carry the `violated` line for a refusal or defiance, so the
  image is not the only carrier of what was breached.

### Art brief

Same preamble as the portrait set, so the three sit with it: *painterly sci-fi
realism, muted film-grain palette, dark neutral ground, single dramatic key
light, no text, no logos, 16:9.*

- **Refusal** — a closed door from the wrong side. Officers turned away from the
  viewer, an order lying unsigned on a table, hands not reaching for it. Nobody
  is angry; they are simply not moving. The feeling is *this will not be done*,
  not *how dare you*.
- **Defiance** — the same room, the order now being carried out under protest:
  somebody signing while others look away, one figure already leaving. Motion,
  but no agreement. The feeling is *it is happening, and it has cost you
  something*.
- **Negotiation** — an empty chair across a table, with a channel light lit.
  Two glasses, one untouched. Nothing has been decided because the other party
  is not in the room yet. The feeling is *this is not yours to declare*.

### If it lands well, two more are nearly free

`inadmissible` (the world does not permit it) and running out of actions are the
other two ways a declaration produces nothing, and both are currently
distinguishable only by matching a note string. Surfacing `inadmissible` on
`ActionOutcome` — `ResolutionOutput` already carries it — and flagging the
action-point case are one line each, which would complete the set of **five
ways an action does not simply happen**.

Deliberately **not** on the list: the five check bands. Every rolled action
produces one, so imagery there becomes wallpaper and stops meaning anything.

## 16. FIXED — the agent cap was invisible to the model, so hitting it was a silent no-op

**FIXED.** `serializeStanding` now carries the ceiling as well as the list:
`Your operatives: N of M`, and at the limit an explicit *"AT YOUR LIMIT. You
cannot place another until one is recalled or burned."* Counted from
`liveAgentsOf`, so a burned operative frees a slot. Three tests.

`prompts/resolution.md` (now v6) gained the other half — **"covert action is the
agent mechanic, or it is nothing"**: spying, sabotage, bribery and turning an
officer are `deploy_agent`, and narrating a covert effect with no op for it (a
munitions rack going up with no `hull_damage`, a bought clerk with no operative)
is called out as the worst outcome available. That also answers the sabotage
half of item 15.

The original write-up follows.

---

## 16 (original) — the agent cap is invisible to the model

**Found by a 27-turn adversarial Meridian run (2026-08-17, $6.77).** Meridian's
cap is 3 (`2 + guile modifier`). At the cap, actions phrased as espionage —
*"buy a clerk in the customs house"*, *"run a network of paid informants"* —
narrated full success and emitted **zero `deploy_agent` ops**, with no rejection,
no note, and nothing in state. The player is told the network exists.

The cause is a one-line absence: `grep -rn maxAgentsFor src/model/` returns
nothing. **The cap is never serialized to any model call.** `serializeStanding`
lists the agents a viewer knows about but never the ceiling, so the resolution
pass cannot know it is at the limit. Both branches from there are bad:

- it emits `deploy_agent` → the reducer rejects `illegal_value` with a good
  message, and the player at least sees a rejection;
- it emits nothing → **silence**, which is what was observed.

This is the same shape as the arbiter never being shown the red lines it was
asked to enforce: a rule the model cannot see is a rule it narrates around. The
fix is symmetrical too — put the ceiling and the current count in
`serializeState`/`serializeStanding`, so "you are running 3 of 3 operatives"
is a fact the narrative has to respect.

Worth deciding at the same time whether an over-cap deployment should be
*trimmed with a note* the way `billConstruction` and `trimOrderEffect` are,
rather than rejected. Trimming is this project's house style for over-asking.

## 15. FIXED — the same covert act had two prices, depending on how it was reached

**FIXED, option (A): a covert declaration now *becomes* a deployment.**
`AppraisalSchema.covert` names the mission and the system, the resolution prompt
is told to emit the `deploy_agent` itself, and `routeCovertAction` appends one
when it did not — so there is exactly one path, charged by `AGENT_COST`, held to
`maxAgentsFor`, resolved on the tick and exposed on the same ladder. Only on an
outcome that placed something: a failure places nobody, the same rule
`boundPayloadsToOutcome` applies to a works payload. `prompts/appraisal.md` is v4
and `prompts/resolution.md` v6. Nine tests, including one asserting that a routed
deployment at the operative cap is rejected exactly as a hand-placed one is.

The narrated-with-no-op half was fixed alongside item 16: covert action is the
agent mechanic or it is nothing.

The original write-up follows.

---

## 15 (original) — the same covert act has two prices



Same run. A **declared** action *"assassinate the Drajk raid captain"* failed its
`guile` check and cost −15 with Drajk and −6 with an onlooker: numbers the
resolution call chose freely. A **deployed** `assassination` agent firing in the
tick costs 35 undetected and 40 on exposure, in code (`reducer.ts`, the
`profile.oneShot ? 40 : 20` and the flat 35).

Neither is wrong on its own — and the playtester's reading that CLAUDE.md's
"35/40" was contradicted is **not** right, since those figures describe the
deployed-agent path and that path was never taken. What is real is that one
fictional act has two mechanical routes with uncoordinated prices, and the
cheaper one is the one a player reaches by typing a sentence.

Related, from the same run: a declared sabotage *through an existing agent*
narrated real physical damage ("a rack of munitions goes up") and emitted **no
mechanical op at all** beyond a disposition change. Covert action declared as
free text currently has no mechanical floor — it is priced as a check and can
resolve into pure prose.

### Two ways to close it

- **(A) Route declared covert actions through the agent mechanic**: an
  assassination attempt becomes a one-shot `deploy_agent`, so it is priced,
  capped, charged and exposed like every other operation.
- **(B) Give the resolution prompt the constants** so a narrated covert outcome
  has to carry the documented cost.

(A) is the structural answer and matches how `form_treaty` was handled — one
mechanism, reached from one place.

## 14. FIXED — agent exposure was unreachable, so operatives were permanent

**FIXED (option B): exposure is tested on the top of the die**, `roll >= 21 -
exposureRisk`, instead of the bottom. Re-measured the same way it was found —
80 operatives, five owner/target pairings, 40 turns each:

| mission | risk | mean turns alive, after |
|---|---|---|
| surveillance | 1/20 | 18.1 |
| theft | 2/20 | 9.4 |
| sabotage | 3/20 | 6.8 |
| defection | 4/20 | 6.4 |
| assassination | 9/20 | 47% caught per attempt (one-shot; claimed 45%) |

Every mission now tracks its documented rate, and the ladder between a watcher
and an assassin exists for the first time. **Competence still protects**: an
operative good enough to succeed on all but a natural 20 is only ever caught on
that 20 — 5%, not the 0% the old comparison produced.

`tests/espionage.test.ts` pins it statistically against the real reducer rather
than unit-testing the comparison, because the comparison *looked* correct. It
asserts a watcher can be exposed at all (the regression that measured zero),
that every persistent mission is caught within a long run, that the safer
mission survives longer than the riskier one — compared as **survival**, since
exposure counts saturate over 40 turns — and that an assassin burns at roughly
its stated rate. Balance is unchanged: the doctrine bots deploy no agents.

The original write-up follows.

---

## 14 (original) — agent exposure is unreachable, so operatives are effectively permanent

**Measured against the real reducer, no model calls: 80 operatives placed across
five owner/target pairings, ticked 40 turns each. Exposures: zero.** Every
persistent mission survived all 40 turns.

`MISSION_PROFILE.exposureRisk` — documented as "1 in 20" for surveillance up to
"9 in 20" for assassination — is nearly unreachable, because exposure needs a
roll that **both fails and is at or below the risk**:

```ts
const succeeded = roll * 5 <= agent.successChance;
if (!succeeded) { if (roll <= profile.exposureRisk) { agent.exposed = true; } }
```

A roll succeeds when `roll * 5 <= successChance`, so rolls `1..floor(sc/5)` can
never expose — and those are exactly the low rolls the risk test is looking for.
Exposing rolls per turn are `max(0, risk - floor(successChance / 5))`:

| mission | risk | sc 5% | 14% | 26% | 50% | 74% | 95% |
|---|---|---|---|---|---|---|---|
| surveillance | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| theft · subversion | 2 | 1 | 0 | 0 | 0 | 0 | 0 |
| sabotage | 3 | 2 | 1 | 0 | 0 | 0 | 0 |
| defection | 4 | 3 | 2 | 0 | 0 | 0 | 0 |
| assassination | 9 | 8 | 7 | 4 | 0 | 0 | 0 |

`successChance` is `clamp(50 + (guile - resolve) * 6, 5, 95)`, so it is **never
below 5** and in practice sits at 26–95. Consequences:

- **A surveillance operative can never be exposed, at any stat pairing** — even
  at the 5% floor, `floor(5/5) = 1` cancels the risk of 1 exactly.
- theft and subversion expose only at `sc <= 9`, sabotage at `sc <= 14`,
  defection at `sc <= 19` — all requiring guile roughly 6+ below the target's
  resolve.
- assassination is the only mission that exposes in ordinary play, and only
  when `sc <= 44`.

Seen live in the Meridian campaign: the Combine's two surveillance agents on
Meridian worlds ran at **95%/turn and cannot ever be burned**; Meridian's own
agents against the Vigil sat at 26% and were equally unburnable. The intended
risk/reward ladder between a watcher and an assassin does not exist.

**This is the class of defect the project keeps finding: a table with no
reachable path.** Nobody noticed because a burned agent is a non-event — you
observe nothing rather than something wrong.

### The decision to make

The two tests are entangled by design ("a botched operation risks the
operative"), and untangling them is the fix. Options:

- **(A) Roll exposure separately** from the effect roll, `d20 <= exposureRisk`,
  so the table means what it says. Simplest, and makes a watcher genuinely
  cheap-and-safe against an assassin's near-coin-flip.
- **(B) Keep one roll but test exposure on the *high* end** — expose on
  `roll >= 21 - exposureRisk` — which preserves "a botched operation risks the
  operative" while making the risk reachable at every `successChance`.
- **(C) Accept it and rewrite the docs**: agents are permanent once placed, and
  the cap plus upkeep are the only limits. Cheapest, and it makes the whole
  `exposureRisk` field dead weight that should then be deleted.

(B) is closest to the stated intent. Note that whichever is picked, exposure
gets *more* common than today for everyone, which shifts espionage balance —
worth a `pnpm balance` check, though the doctrine bots do not deploy agents.

### What is NOT broken (verified the same way)

- **The cap holds.** Five deploys with a cap of 3 left exactly 3 live, rejecting
  with `illegal_value: "…is already running 3 operatives, its limit at guile 13.
  Recall one before placing another."`
- **Costs are charged**: 2400 → 2280 for three surveillance agents at 40 each,
  and `insufficient_credits` fires cleanly at 30 credits ("costs 40 credits;
  Meridian Trade Authority holds 30").
- **Upkeep reaches the ledger**: `agentUpkeep` 9/turn for 3 live agents.
- **The owner guard holds**: `ownerFactionId` set to the victim is rejected
  `illegal_value` — the bug from the first playtest series stays fixed.
- **NPCs really do deploy against the player.** By turn 2 the Combine had two
  surveillance operatives on Meridian worlds (`slu-1`, `tio-1`) at 95%/turn.

## 13. FIXED — a red line could be walked past through diplomacy

**FIXED (option A): `closeChannel` appraises what was agreed before staging it.**
One Haiku call, and only when the transcript actually produced ops — a
conversation that agreed nothing changes nothing and must not cost a call to
discover that. A **red line refuses the whole accord** (a deal that needs you to
cross it is no deal, the same rule an unexecutable order gets) and charges
`REFUSAL_DISSENT`; a **compulsion lets it stand** and charges
`COMPULSION_BREACH_DISSENT`, exactly as on the declaration path.

Scoped to the acting faction by construction: the arbiter appraises from
`playerFactionId`, so a line only the *other* power holds is not on the sheet
being matched and cannot trip yours. Four tests, including the live case that
found it — a `forgive_debt` framed as a renegotiation now leaves `debt-0`
untouched and costs 8 dissent.

The original write-up follows.

---

## 13 (original) — a red line can be walked past through diplomacy

**Found by an adversarial Ojjul Nar playtest (2026-08-17, $1.67).** The arbiter's
breach ruling is wired into `appraiseAction` -> `resolveAction`. The **extraction
pass has no arbiter pass at all** — `grep -c appraiseAction src/engine/turn.ts`
returns 0 — so ops staged out of a diplomatic transcript are never checked
against the acting faction's own principles.

Repro: open `/talk krayt`, negotiate reducing an existing debt's balance framed
as a "renegotiation" or "a new note superseding the old", close with
`/endtalk krayt`. Extraction emitted:

```
{"op":"forgive_debt","debtId":"debt-0","reason":"Superseded by renegotiated terms..."}
{"op":"establish_debt", ... principal 480, perTurn 10}
{"op":"establish_debt", ... principal 150, perTurn 15}
```

No refusal, no `defiance`, **no dissent**. Verified in committed state:
`debt-0 ... [forgiven]` permanently, hutt dissent 20 — ordinary decay, not the
+8 breach charge. The *same intent* declared as an ordinary action was refused
three separate times (blunt, euphemistic, and as hardship relief), each quoting
*"will not forgive an unpaid debt — the debt is the whole instrument of
control"*.

This is sharper than it first looks: `establish_debt` and `forgive_debt` are
**extraction-only by design**, so the two ops most tied to that faction's
identity live entirely on the ungated path. The consent boundary was built and
the institutional one was left behind on the other road.

### The decision to make

- **(A) Appraise what was agreed, before staging.** One Haiku call (~$0.02) on
  each `/endtalk` that produced ops, reusing `appraiseAction` and
  `classifyPrinciples`; on a `red_line`, stage nothing and charge
  `REFUSAL_DISSENT`. Faithful to the existing design and cheap against
  endtalk's ~$0.05–0.15, but it is a new call on a hot path.
- **(B) Decide a negotiated deal legitimately does what a decree cannot.**
  Defensible fiction, and it guts red lines — almost anything can be framed as
  a negotiation.

(A) recommended. **One wrinkle either way:** extraction emits ops for *both*
parties, so the check has to be scoped to what the acting faction is doing — an
NPC's own concession must not trip the player's line.

## 12. DONE — battles are reported instead of narrated (verified on screen)

`resolveBattle` computed the roll, both might modifiers, the powers the 2:1
break-off test compares, the retreat loss percentage, per-contingent losses, the
dug-in garrison and the assault total, then flattened all of it into one
sentence. `TurnReport.arrivals` carried that prose and **the browser never read
it at all**, so a whole engagement reached the player as one line inside the
Completed list.

That mattered more after the war-ethic work, because four doctrines now change
battles and none of them were observable — mechanics nobody could see.
`src/domain/battle.ts` holds a `BattleReport`; `resolveBattle` returns
`{ note, report }`, threaded through `TurnReport` → `Briefing` → contract and
rendered as a collapsible card at the top of the briefing. `doctrinesFired`
names only the doctrines that actually **changed** something.

Shaped as an engagement made of **rounds**, each stamped with its turn, so a
multi-turn resolver later appends rounds and flips `status` to `'ongoing'`
without touching the schema or the renderer. Nothing is stored on `WorldState` —
the journal can regenerate a report, and a second source of truth is worse than
losing it on resume.

Building it caught a bug in itself: the attacker's "before" was read from the
target system, where a fleet still in transit reads as zero, so the first
version reported a fleet of **0** attacking. Found by running a real battle and
reading the output, not by the tests, which all passed. Rounds now carry
per-round deltas and a test asserts the last round equals the board.

**VERIFIED LIVE** (2026-08-17, ~$0.51: one declared action plus one end turn).
Iron Vigil, thirteen hulls from Ord Vantic onto Drajk-held Threx — one jump, so
the fleet arrived on the very next tick rather than the two turns assumed here.

The card renders and reads:

```
Threx   Drajk Confederacy holds        d20 2  -10 / -6
attacker might +4 · defender might +2 · garrison 6 -> 4

Orbitals   both sides traded losses                10 vs 9
  attacking   Iron Vigil Remnant  13 -8 -> 5
  defending   Drajk Confederacy    6 -6 -> 0

Ground     landing thrown back        assault 4 vs garrison 6
  attacking   Iron Vigil Remnant   5 -2 -> 3
```

Every number the write-up promised is on screen: the roll, both might modifiers,
the powers the 2:1 break-off test actually compared (10 vs 9 — which is why
nobody broke off despite 13 hulls against 6), per-contingent before/after, and
which phase decided it. The defending fleet was wiped and the world still held,
because the garrison threw the landing back — the two-phase rule, visible for
the first time instead of inferred from one sentence.

`doctrinesFired` was empty and correctly so: nobody was asked to retreat, so the
Vigil's crusading "does not break off" changed nothing. That is the intended
behaviour — only doctrines that *altered* the outcome are named.

Also confirmed in passing: a `might` critical success emitted a `fleet_movement`
order and nothing else — no fabricated losses, no battle resolved in prose. That
is bug #1's fix holding under the exact conditions that used to break it.

## 11. FIXED — `defiance` was built correctly and the model barely reached for it

**FIXED — the arbiter classifies now, which is the structural answer the
write-up below argues for.** `AppraisalSchema` carries a `breach`
(`red_line` | `compulsion`, plus the principle quoted from the sheet, who
objects, and why), and the two rulings are enforced in different places:

- **`red_line` ends the action before the roll.** `resolveAction` returns a
  refusal and the resolution call **never runs**. That is the part that makes it
  structural rather than persuasive — there is no downstream pass left to argue
  the order back into existence, and no rephrasing reaches past a ruling made on
  the appraisal. It is also cheaper than what it replaces: ~$0.017 rather than
  ~$0.073, since the Sonnet call is skipped entirely.
- **`compulsion` lets it through and charges for it.** The roll happens, the ops
  land, and `defiance` is set from the arbiter's ruling *whether or not*
  resolution mentioned one. `violated` is always the arbiter's quoted line, and
  a `refusal` volunteered on top of a compulsion ruling is dropped — turning a
  price into a block is the one distinction the mechanism rests on.

**The arbiter had never been shown the lines it is now asked to enforce.**
`serializeState` carries doctrine and ethics but neither list, so this was
impossible before it was wrong. It gets a new `serializePrinciples` —
deliberately not `serializeCharacter`, whose `voice` field is several thousand
tokens of dialect notes for Arkanis alone, which would have roughly doubled the
price of every action in the game. A test pins both halves: the red lines are
present, the voice is not.

`prompts/appraisal.md` is v2 and `prompts/resolution.md` is v4: the ruling moved
out of resolution's job description into the arbiter's, with the three misses
below written in as named failure modes ("judge the act, not how it is phrased",
and the tribute case as a worked example). 11 tests in
`tests/principles.test.ts`, which script the model client rather than calling it.

Also fixed alongside: **the browser never read `defiance`**, the same
carried-but-unrendered pattern as the battle report — the most consequential
thing a declaration can do to a faction arrived as a grey note among the others.
It now renders in the refusal voice, and the note that duplicated it is gone.

### Verified live, and it found one more hole

Two short playtests, ~$1.60 total: Arkanis (5 calls, 1 turn committed) and the
Iron Vigil (5 calls). Raw state diffed on every action, never the narrative.

**Arkanis — all four prior misses now fire, and it does not over-fire.**

| declared | ruling | cost |
|---|---|---|
| stand down, open the gates, let the Vigil garrison the capital *under a protectorate* | `red_line`, quoted verbatim, **no roll, no resolution call** | 8 dissent, **$0.022** |
| pay the Combine 20/turn to leave our lanes alone | `compulsion` | 25 dissent, ops landed |
| six hulls out to raid Combine cargo | `compulsion` | 25 dissent, ops landed |
| *control:* raise the garrison and thicken the walls | **no breach** | — |

The first row is the exact scenario that previously ran as a `resolve` check at
DC 19 and would have succeeded on a 20. The control is the important one: the
most in-character action Arkanis has was not flagged, so the referee is not
finding a violation in every declaration. Dissent reached the dice as designed
(58 dissent → `industry` 10 − 2 = 8 on the fortification roll), and the turn
committed clean — 4 actions, 0 rejections, decay 58 → 56, NPC drift +3 on both
the Vigil and Drajk.

**Iron Vigil — both red lines held, and the escape hatch had moved.** *"Take the
Combine's four hundred and stand down from the approaches"* and *"recognise
Arkanis as a sovereign government"* both refused, quoted, at $0.022 each. But
*"quietly retain the Combine's smuggler captains as informants"* came back
`admissible: false` with the narrative *"This is a red line, not a compulsion"* —
**and it is neither of those things.** The line is in the Vigil's `compulsions`,
and `admissible: false` is the one exit in the game that charges **nothing at
all**: no dissent, no ops, no record. A 25-dissent breach became a free no-op,
and the prompt saying "out of character is not inadmissible" did not stop it.

**FIXED — `classifyPrinciple` (`src/domain/compulsions.ts`).** The model is good
at the part needing judgement (which line does this action touch) and unreliable
at the part that is a lookup (which list is that line on), so it now names the
line and **code does the lookup**: `kind` is derived from the sheet and the
model's own label discarded, an `admissible: false` whose reason quotes a real
line is rewritten into the breach it actually is, and a principle matching
nothing on the sheet is not a breach at all — an invented rule buys no price.
Matching is loose about truncation and punctuation, and a test asserts it never
matches another power's line across all five sheets. Re-run live afterwards: the
same declaration now charges 25 and lands its ops. Eight more tests, 585 total.

Also fixed: resolution filled `defiance.by` with `"vigil"` rather than an
institution, which the UI rendered as *"vigil object, and the order goes out
anyway"*. It falls back to the arbiter's when the name is just the faction.

### Still open, found by the same playtests

- ~~**A compulsion is charged on the attempt, not the act, and it out-prices a
  red line.**~~ **RESOLVED — charging on the attempt kept, price lowered.** The
  tribute action rolled a natural 1 — the negotiators walked out, no arrangement
  was made — and still cost the full 25, while a red line *blocked outright*
  costs 8. Two readings were on the table; the user took the first: the
  institutions really are furious that the thing was *proposed*, and keeping the
  charge out of the outcome bands is what stops it becoming another number the
  resolution call can reason its way around. What was wrong was the size.
  `COMPULSION_BREACH_DISSENT` is now **15** — still ~2x a refusal, still under
  `DOCTRINE_ETHIC_DISSENT` (20), since one act against character is lighter than
  permanently rewriting what the power is. The live Arkanis turn that cost 58
  dissent and −4 on every stat now costs 38 and −3, and reaching the cap by
  insistence takes about eight breaches rather than four. A test pins the
  ordering against both neighbouring constants and one pins that a single bad
  turn cannot spiral.
- ~~**A failed check still emitted the order it failed to start.**~~ **FIXED**,
  and it was worse than "harmless today". The Arkanis fortification failed and
  resolution emitted `adjust_credits -70` *and* the three-turn order, labelled
  "(stalled)", while the narrative said the walls stand exactly as thick as
  before. That one carried no `onComplete`. Measured with one, on the seed: a
  `develop_system +1` at slu-2 emitted in a batch the player was told was a
  failure crosses `HUB_THRESHOLD` five turns later and takes Meridian's net from
  **309 to 519, permanently**, zero rejections — because `applyOps` has never
  been told the check, so the whole `OUTCOME_GUIDANCE` contract was a promise
  made in a prompt and nowhere else. The same hole as the combat leak, running
  the other way: there the model fabricated losses on a failure, here it banked
  gains on one. `boundPayloadsToOutcome` strips the payload on a failure and
  halves it on a partial, applied in `stageWithCorrection` **to the correction
  batch as well as the first**. The order itself is never dropped — a failed
  attack must still go out, which is the whole of the combat fix. Ten tests.

The original write-up follows.

---


A 5-turn adversarial playtest as the Arkanis Free Worlds (`saves/arkane_defiance.json`,
~$2.50), chosen because that faction is defined almost entirely by refusal. The
arithmetic is sound and the trigger is not.

**Where it worked:** a `set_doctrine` action that asked to retire a red line
correctly refused to retire anything (`redLines` byte-identical afterwards),
emitted a `defiance`, and charged 6 + 25 = 31 dissent exactly. Decay of 2/turn
was visible between turns. So the field, the schema, the engine wiring and the
pricing are all correct.

**Where it did not:** three unambiguous compulsion breaches — paying one-off
tribute, submitting to ongoing tribute, and commerce-raiding another power's
shipping — all resolved as **ordinary skill checks with no `defiance` and no
dissent at all**. Two of those violate *"tribute is refused, whatever the
arithmetic says"*; the third violates *"the Drift does not prey on shipping…
doing it would make the founding a lie"*. Free defiance is worse than either
intended outcome: a red line should block and a compulsion should cost 25 and
land, and instead the ops landed as though the compulsion did not exist.

**Red lines were never returned as `refusal` once.** "Open the gates, invite the
Vigil to occupy Arkanis Prime" — the verbatim scenario of red line #1 — was run
as a `resolve` check at DC 19. It rolled a natural 1, so nothing landed, but a 20
was available. The same ask was then blocked twice more for entirely unrelated
reasons (an exclusivity conflict with a live commitment; "you are at war, cession
needs a treaty first"), never citing the red line. A player probing for the wall
would conclude the rule is about treaties and commitments, not "never, on any
terms". This reproduces item 9.3 against a second faction, so it is not
faction-specific.

**What this means for the design.** `defiance` moved the decision *into* the
resolution call — the pass with the least incentive to classify honestly and no
structural check on it. That is the failure mode this codebase documents
everywhere else ("a limit a model is merely told about is a limit that gets
argued around"). The mechanism needs something structural underneath it. The
strongest candidate is the one already rejected once for being too big and now
looks necessary: have the **arbiter** classify, since it is a separate call that
is not shown the roll and already rules on `establishes`. It would return which
principle an action breaches and whether that principle is a red line or a
compulsion; the engine then either blocks or prices it, and resolution is told
the outcome rather than asked for it.

## 10. The actor was not being journaled, so replay skipped every actor guard

Found while capping `adjust_credits`, and much worse than the thing being fixed.
`Campaign.commitTurn` applied each staged batch **with** its actor and journaled
it **without** one. Every player-declared action therefore replayed as an
actorless engine op, which silently skipped every actor-gated guard: the suborn
presence and limit checks, `deploy_agent`'s owner validation, both `set_doctrine`
guards and its dissent charge, the `adjust_dissent` sign rule, and
`capSelfInflictedLosses`. Live rejected or trimmed; replay applied in full.

It stayed hidden because those guards almost all *reject*, and a rejection leaves
state untouched — so live and replay agreed by accident. Nothing staged an op
that a guard would *modify* until the narrative-credit cap existed, at which
point `pnpm test` reported `Replay diverged: 31622 vs 31800 bytes`. Verified
directly before the fix: live 860 credits, replay 800, one clamp event against
zero.

This is the mechanism CLAUDE.md describes as making replay exact ("the actor is
recorded in the journal so replay stays exact"), and it was recorded on the
`commit` path and dropped on the `commitTurn` path. Journals written before the
fix still lack it and still replay as they originally ran. Pinned by a test.

## 9. RESOLVED — three findings from the first live playtest of this session's work

> Heading corrected: all three numbered findings and all four bullets in the
> audit below are individually marked fixed. It was still labelled OPEN.

A 4-turn adversarial playtest as the Ojjul Nar Combine (`saves/ojjul_profiteer.json`,
~$1.70) exercised the new mechanics against real model calls for the first time.
**The reducer-side work all held.** Verified in raw state, not narrative:
`onComplete` delivered (kes-2 strategic value 9 → 10, crossing `HUB_THRESHOLD`
on schedule), `commitmentFlow` summed two live commitments to 28 and respected
both the per-arrangement cap and `kind` exclusivity, `warProfit` flipped +40 →
−40 the turn the Combine's raid opened a war with the Vigil, and compulsion
drift fired for **NPCs** every turn (Vigil `idle_at_war`, Drajk `no_plunder`).
Both correction passes did their job: Meridian's reaction tried to put a
`develop_system` payload on a Nar world it had no presence at and the retry
stripped it; Drajk's first-draft reaction deployed an agent owned by its own
victim and the retry fixed the owner.

Three real problems, all on the model side of the boundary rather than the
reducer side:

1. **`set_doctrine` was emitted with `retire: []` while the narrative claimed a
   red line had been retired.** The declared action was explicitly *"retiring
   the old absolute rule against forgiveness"*, the check was a natural 20, the
   doctrine text was rewritten — and `redLines` is byte-identical afterwards,
   because the model never populated `retire`. This is the project's signature
   failure mode (narrating a mechanical outcome instead of emitting the op that
   produces it) landing on a field built two commits earlier.
   `prompts/resolution.md` already says "**Retiring is the part that matters**";
   that was not enough. The reducer cannot help here — an empty `retire` is a
   legal no-op — so the fix is prompt-side, or a resolution-time check that a
   doctrine action claiming to abandon a principle actually names one.
2. **Unbounded `adjust_credits` rides alongside priced mechanics.** A *failed*
   construction action emitted `adjust_credits -380` with no `issue_order` at
   all — money gone, no order to cancel or refund. The successful retry emitted
   the correctly priced order (`investedCredits: 156`) **plus** a freeform
   `adjust_credits -180` for "premium rates". `developmentCost`'s careful
   marginal-income pricing bounds `onComplete`, and bounds nothing about a
   second op in the same batch spending twice as much. Compare
   `billConstruction`, which bills the *net* hull change precisely so the model
   cannot invent the number.
3. **A red line still in `redLines` did not stop the act it forbids.** In the
   same batch as (1), the Combine forgave a debt — `establish_commitment
   forgiven_debt_client` — while *"will not forgive an unpaid debt"* was live in
   state. Red lines are enforced only by the resolution call choosing to refuse,
   so a model that believes it has just repealed one will act against it.

**Also worth fixing:** `/api/action` returns narrative, check and counts but not
the ops it staged. Every finding above needed the on-disk journal to see. The
staged ops are already in memory; returning them would make the highest-value
bug class in this project visible from the API instead of requiring a save file.

**Faction flavour text was audited and the dead lines are now live.** Of 28 red
lines and compulsions across the five powers, 18 mapped to a real op or order
type, 2 were reachable only through arbitration, **4 were dead** (their trigger
was elapsed time or drift, which nothing measured) and **4 more have no
mechanic in the game at all** (the Ojjul Nar's debt and proxy-hiring lines).
The 4 dead ones were rewritten to name something measurable and given typed
triggers — see "Compulsions also fire on drift" in CLAUDE.md. Three of them had
promised a consequence in their own text (a vote of no confidence, the officer
corps acting without you, the captains taking ships elsewhere) that did not
exist; the consequence is now dissent, which does.

**Still open from that audit:**

- ~~`warEthic` has no mechanical readers at all~~ **FIXED.** All five now have
  one signature mechanic each — see "War ethics have mechanical force" in
  CLAUDE.md. `mercenary` was deleted outright: it meant "fights for payment; war
  is a service sold" and was worn by the faction whose doctrine is *"let other
  powers spend their fleets for you"* on might 9. `profiteer` replaces it, and
  `DOCTRINE_ETHIC_DISSENT`'s charge of 20 to change either ethic is now a fair
  price for two load-bearing axes rather than one live and one inert.
- ~~**The Ojjul Nar's two proxy lines are half-supported**~~ **BOTH HALVES NOW
  EXIST.** *"Will not fight its own war where a proxy could be hired"* was
  already backed by `profiteer`; the **hiring** half is a `mutual_defense`
  treaty carrying `incomePerTurn` to the hired power and `shipsPledged` naming
  the hulls, emitted by the extraction pass from a negotiated transcript.
  Verified live 2026-08-17: `{"treatyType":"mutual_defense","parties":["hutt",
  "meridian"],"terms":{"shipsPledged":{"meridian":6},"incomePerTurn":
  {"meridian":80}}}` landed, and Meridian moved a squadron on a Drajk world the
  next turn. The Free Worlds and the Iron Vigil both **refused** to be hired,
  in character with their war ethics, and correctly staged zero ops.
- ~~**The Combine's two debt lines still have no mechanic**~~ **FIXED** —
  `src/domain/debt.ts`. A principal that depletes, an instalment priced against
  what the debtor can actually find, a delinquency state, and `debt_unpursued`
  as the fifth compulsion trigger. A commitment with a negative `incomePerTurn`
  was tried first and cannot express it: that field is one scalar every bound
  faction reads the same way, so a debt written that way paid the creditor 25
  **and the debtor 20**.
- ~~Five lines duplicated within their own faction~~ **FIXED.** All five were
  prohibitions miscategorised as demands, so the compulsion copy was dropped and
  whatever it added folded into the surviving red line (Drajk's "sit still to be
  besieged", Meridian's embargoes and shut borders, Arkanis's abandonment to
  occupation). Changing course now costs what it should: Drajk going legitimate
  is 25 dissent, not 50. A test asserts no faction states a line twice.
  **Drajk is left with a single compulsion** — the triggered `no_plunder` one —
  against 2 red lines; that is honest to a faction defined by what it refuses,
  but it is the thinnest sheet of the five and worth a look if Drajk ever reads
  as flat.

Original write-ups are kept rather than deleted — the repro steps are the useful
part and they document why each guard exists. A "**FIXED —**" note follows each.

> The paragraph that used to sit here recorded a repo state from several
> sessions ago (branch `order-effects`, 479 tests) and claimed every numbered
> item was fixed, which stopped being true the moment items 13 and 14 opened.
> Current state lives in one place, at the top of this file, so there is nothing
> to keep in sync.

**A playtest was set up and never played.** An Ojjul Nar Combine regression run
(`ojjul_regression`) was staged on port 4260 to re-verify the nine earlier fixes
under live play, covering (1) conquest by combat, (2) unorthodox agent use, (3)
raids, (4) neutral-planet interaction. The board was surveyed and **no actions
were declared**. Nothing is left running and `saves/ojjul_regression.json` was
never written, so there is nothing to clean up — but the playtest itself is
still outstanding, and now has more to cover: **`onComplete` payloads and
commitment income have unit tests but have never been exercised by a live model
call.** The most valuable thing to watch for is whether the resolution pass
actually *sets* `onComplete` on a development order rather than narrating a
shipyard and emitting a bare `issue_order` — that is the same failure mode as
items #1, #2 and #4 (narrating a mechanical outcome instead of emitting the op
that produces it), and a payload is easy to omit.

**Useful context for whoever picks this up:**

- Live playtesting has been by far the most productive bug-finding method
  here — all nine fixed items came from four campaigns, and none were caught
  by the test suite first. `.claude/agents/adversarial-player.md` is a
  competitive-playtester agent definition built for this.
- Cost is roughly **$0.073 per declared action** and **$0.14 per end-turn**
  (arbitration on Haiku, resolution and reactions on Sonnet). A two-action
  turn is about $0.29. Budget accordingly before long runs.
- The recurring failure mode across every bug found so far: the resolution
  call **narrating a mechanical outcome instead of emitting the op that
  produces it**. Items #1, #2 and #4 are all variants. When something looks
  wrong in a playtest, diff raw state before/after rather than trusting the
  narrative — several bugs were invisible in the story and obvious in the
  JSON.

Findings from a live playtest campaign (Meridian vs. Iron Vigil, 7 turns,
~$2.15 across 21 model calls, 2026-08-11). Ranked by severity. Each has a
concrete repro; none of these are speculative.

---

## 1. ~~HIGH~~ FIXED — combat/movement resolution can bypass the deterministic reducer entirely

**The bug:** when a `might` check on an attack or fleet-repositioning action
comes back `failure` or `critical_failure`, the resolution call sometimes
narrates the battle as already lost and emits ops that directly delete the
acting faction's own ships — instead of emitting `issue_order` /
`fleet_movement` and letting `resolveBattle` decide the real outcome later,
deterministically, with seeded dice. When this happens: no `fleet_movement`
order is ever created, the enemy takes zero losses, and the fleet is gone with
no battle having actually been fought.

Reproduced **three times** in one campaign:

1. 22-ship fleet vs. an 8-ship garrison, `might` critical_failure (roll 3) →
   fleet wiped to `{}`, Kalzir's defenders unchanged at 13 ships, no
   `fleet_movement` order in `pendingOrders`.
2. 21 ships (main fleet + reinforcements), `might` critical_failure (roll 2) →
   fleet wiped to nothing across every system, **and a fictional agent loss
   was narrated for an agent that never existed in state.**
3. 15 ships, `might` **plain failure** (roll 8, not even critical) → fleet cut
   from 15 to 3, again with no order created.

I initially believed explicit phrasing ("issue an order only, do not resolve
the battle in this call") reliably avoided it — **that was wrong.** It
recurred on the very next attempt using the identical phrasing, on a
non-critical failure. It is not something a player can route around by
wording their action carefully. A player who ends their turn immediately
after declaring an attack has no recourse — the loss is only recoverable
before `:endturn` commits it (via `:discard`), which is not something the game
tells anyone to watch for.

**This is a direct violation of the project's own central rule**
("the model never rewrites state; combat is resolved by the pure reducer") —
and the mechanism that rule depends on (`resolveBattle`, invoked only when a
`fleet_movement` order arrives) is *already* fully deterministic and
model-free when it actually runs. The bug is a boundary violation upstream of
it, in `prompts/resolution.md` and the resolution call's freedom to emit
`adjust_fleet` / `adjust_ships` on the acting faction's own hulls without any
structural check.

**Fix direction:** make it unconditional in `prompts/resolution.md`, regardless
of the check's outcome band, that any action against another faction's system
is expressed *only* as `issue_order` / `fleet_movement` — the check should
describe how cleanly the order launches, never what happens when it arrives.
Worth also considering a lighter structural guard in the reducer itself (nothing
as blunt as banning `adjust_fleet` outright, since it has legitimate peaceful
uses — repositioning, accidents, construction — but perhaps flagging/rejecting
a batch that reduces the acting faction's own fleet by a large fraction with no
corresponding `fleet_movement` in the same batch, the way `transfer_control` is
already reducer-only for the analogous reason).

See also the user's related architecture question below — this may want a
bigger structural answer than a prompt patch.

**Reproduced a 5th time** (Drajk raiding Arkanis playtest), and this
reproduction pinned down the exact mechanism: *"send eight ships from Tulgarn
to raid Pell Reach"* → `might` critical_failure (roll 3) → the acting
faction's fleet dropped by 7, but **the ships removed came from Vergesse (my
largest concentration, 10 ships), not from Tulgarn (the stated origin, which
was untouched)**. That matches `adjust_fleet` called with a negative delta and
no system specified — the reducer's own documented behavior for that op is to
draw down "largest concentration first" when no system is given. So the
resolution call isn't even improvising a plausible-looking loss at the
declared origin; it's reaching for whichever op removes hulls fastest,
anywhere in the faction's holdings. This is a precise, useful detail for
whoever fixes it: **the leak is specifically `adjust_fleet` (untargeted)
being used as a combat-outcome shortcut** — a guard could reasonably be as
narrow as "an `adjust_fleet` negative delta targeting the faction's own
holdings is not permitted in the same batch as a check whose stat implies
combat," without needing to touch legitimate uses of the op elsewhere.

**FIXED —** three layers, because the prompt alone was never going to be
enough. (1) `prompts/resolution.md` gained a "Battles are never resolved here"
section stating that the rule holds *regardless of the outcome band* — a
`critical_failure` means the order goes out badly, not that the battle
happened and was lost — and forbidding `adjust_fleet`/`adjust_ships` as a way
to represent losses on either side. (2) `capSelfInflictedLosses` in the reducer
caps what one declaration can cost the acting faction at
`MAX_SELF_INFLICTED_LOSS_FRACTION` (25%), restoring the excess with a note,
the same trim-don't-reject shape as `billConstruction`. (3) `adjust_fleet` with
a negative delta aimed at a faction that is not the actor is now rejected
outright — `adjust_ships` had been guarded since the suborn work, but
`adjust_fleet` was not, and being untargeted it was strictly worse. Real
combat is untouched: `resolveBattle` mutates during `tickTurn` and never
routes through `applyOps`. Engine ops and journals without an `actor` are
exempt so replay stays exact. Five tests in `tests/combat.test.ts`.

---

## 2. ~~MEDIUM/HIGH~~ FIXED — `deploy_agent` can get `ownerFactionId` backwards, silently

Declared: *"place an agent at Kalzir to sabotage the Vigil garrison"* (acting
faction: Meridian, target: Vigil-held system). The agent that got created had
`ownerFactionId: "vigil"` — Vigil "spying" on itself. Since the tick logic
skips an agent whenever `target.id === agent.ownerFactionId`, this agent could
**never fire, for the rest of the game, under any circumstances.** No
rejection, no warning — `staged: 1, rejections: 0`. Only caught by inspecting
raw agent state directly; a player would have no way to know their spy was
permanently inert.

**Reproduced two more times** in a follow-up playtest (Arkanis Free Worlds,
agent-focused stress test), which narrowed the pattern considerably:

- *"send an assassin to Kalzir to kill the Vigil Legate-Commander"* (acting:
  Arkanis, target: Vigil-held Kalzir) → same bug, `ownerFactionId: "vigil"`
  again, again permanently inert (mission was `assassination`, which is
  one-shot — this agent will never even get its one shot). The narrative
  *and two separate NPC reactions* then treated the assassination as a
  successful, completed event — Vigil's own reaction described rebuilding
  the garrison "after the desertion," meaning **the fiction's own
  bookkeeping (an NPC issuing a real multi-turn recovery order) is now
  inconsistent with the actual game state**, not just the player's.
- *"deploy an agent to Byss Marker [[unaligned, no controller]] to organize
  the local smugglers into a network loyal to us"* → correct this time,
  `ownerFactionId` matched the actor.
- Separately, in a Nar/Ojjul Combine playtest: *"seduce a Drajk-affiliated
  captain at Tulgarn [[Drajk-controlled]] into an informal understanding"* →
  also correct, `ownerFactionId` matched the actor, even though the target
  system had a controller (Krayt/Drajk).

So the failure isn't simply "does the target system have a controller" — the
Tulgarn case had one and was fine. Both failures were **hostile/destructive**
missions (sabotage, assassination) framed around damaging something that
belongs to the target's controller; both correct cases were
**recruitment/subversion-flavored** (organizing loyalists, cultivating a
friendly contact) or against nobody in particular. Read as: the model may be
anchoring `ownerFactionId` to whichever faction is most narratively salient as
the *object* of harm in the sentence, and that only comes up when the action's
whole point is inflicting damage on the target's own side.

**Fix direction:** the reducer already knows the acting faction (`actor`, added
for the suborn-crews guard). `deploy_agent` should validate
`op.ownerFactionId === actor` when `source === 'model'` and reject otherwise,
the same way `adjust_ships` now validates presence/limits for the acting
faction. This is a small, mechanical, structural fix — it does not depend on
correctly diagnosing why the model gets it backwards, only on the reducer
refusing to accept an agent whose owner isn't the one declaring the action.

**FIXED —** exactly that guard, plus a prompt line naming the trap explicitly
("it is easy to get backwards on a hostile mission, because the sentence is
about the victim"). The reducer rejection is the safety net; the prompt line
is there to stop it firing often enough to burn a correction round trip.
Engine ops and actor-less journals are exempt. Three tests.

---

## 3. ~~LOW/MEDIUM~~ FIXED — diplomacy extraction can collapse a multi-clause deal into one treaty type

A negotiated deal covering trade immunity + basing rights + a mutual-defense
trigger got extracted as a single `trade_accord`. The payment
(`incomePerTurn`) and trade immunity are real; the basing-rights and
mutual-defense clauses are not — `mutualDefenseTrigger` ends up as an inert
narrative string with no `shipsPledged`, and a fleet moved into the ally's
territory would still be read as an attack, since only a `basing_rights`- or
`mutual_defense`-typed treaty grants guest status (`isGuestOf` /
`resolveBattle`'s `guest()` check is keyed on `type`, not on the summary text).

Didn't block this campaign since the plan never required staging through
allied territory, but a player relying on a negotiated basing-rights clause
would be quietly stranded — and would only find out by trying to use it during
a battle.

**Fix direction:** either allow (and prompt for) `extraction.md` to emit
*multiple* `form_treaty` ops from one negotiation when the deal spans more than
one archetype, or teach extraction to weight the treaty `type` toward whichever
clause has the most mechanical consequence rather than defaulting to whichever
was mentioned first/most.

**FIXED —** and the root cause turned out to be larger than diagnosed:
`extraction.md` never mentioned `form_treaty` **at all**. Its "What to emit"
list covered dispositions, credits, orders and doctrine, so the model was
emitting treaties purely from general op knowledge with no guidance on type.
The prompt now documents every type and what the reducer actually does with
it, states that a deal spanning several archetypes needs several
`form_treaty` ops ("this is the common case, not an edge case"), and warns
that terms on the wrong type are inert. Four tests.

---

## 4. ~~LOW~~ FIXED — correction-pass retries can double an already-narrated outcome

When part of a resolution batch is rejected, `commitWithCorrection` retries the
*whole* narrative rather than patching just the rejected op. Observed: a
"3 crews defect and join the strike fleet" narrative beat appeared once in the
story text, but the correction pass independently re-generated its own version
of the same beat — billed twice (360cr instead of 180cr for what the player
was told was a single event), with the two batches of new hulls landing in two
different, narratively unrelated systems (3 at the target, 3 at the faction's
highest-value home world, since the second pass used an untargeted
`adjust_fleet` rather than a targeted `adjust_ships`).

**Fix direction:** narrower — pass only the rejected op(s) back for correction,
not the whole batch, or explicitly instruct the correction prompt not to
re-emit anything the first pass already resolved successfully.

**FIXED —** the real cause was a conflict of instructions: the correction call
ran under the *full resolution system prompt*, whose entire job is "narrate
this action and emit its ops", while the user message said "only fix these
rejects". The system prompt won. Corrections now use a dedicated, minimal
`prompts/correction.md` whose single emphasised rule is not to re-emit
anything that already succeeded, and which states that an empty correction is
a perfectly good answer and that a structurally forbidden op should be dropped
rather than routed around. The orphaned `resolutionSystemPrompt()` helper was
removed, and a test asserts it stays gone so nobody re-points corrections at
it. Four tests.

---

## 6. ~~GAP~~ FIXED — agents cost nothing and have no cap

Checked directly in `src/domain/reducer.ts`'s `deploy_agent` case and the
agent-tick loop, prompted by the Ojjul Nar seduction test above (test 3
produced a real, correctly-owned, permanent `surveillance` agent from a single
`guile` check with no other cost attached):

- **No deployment cost.** The `deploy_agent` case never touches
  `owner.credits`. Unlike ships (`SHIP_COST` at commission, upkeep every turn
  after) or treaties (real `incomePerTurn` flows), an agent is entirely free
  to place, however powerful its `effect`.
- **No ongoing upkeep.** The per-turn agent loop in `tickTurn` never deducts
  from the owner either. `Ledger.espionageLoss` is what a *victim* loses to a
  hostile `income_penalty` agent — nothing charges the *owner* for running one.
- **No cap.** Nothing in the schema or reducer limits how many agents one
  faction can have live at once. `deploy_agent` unconditionally
  `state.agents.push(...)`.

Combined with finding #2 above (assassination and sabotage sometimes narrate a
free, already-resolved win) and with how naturally the arbiter now maps
unorthodox roleplay onto `deploy_agent` (seduction, bribery, "cultivate a
contact" all read as legitimate agent missions to the arbiter, correctly), the
practical risk is that a player who notices this can spam cheap "recruit a
contact" / "seduce an official" declarations indefinitely and accumulate an
unbounded number of permanent, free intel/sabotage/subversion feeds — there is
currently nothing in the mechanics that would stop them, only however much a
model happens to price each individual attempt's *difficulty* at.

**Fix direction, options rather than a single prescription:**
- A flat credit cost per deployment (mirrors `SHIP_COST`), maybe scaled by
  mission risk (`assassination` costs more to arrange than `surveillance`).
- Ongoing upkeep per live agent, so a large covert network is a real drain the
  way a large fleet is (`UPKEEP_PER_FLEET_POINT` is the existing precedent).
- A hard cap on simultaneous live agents per faction (flat, or scaled by
  `guile`/`influence`, the way `subornLimit` scales off two stats rather than
  being a constant).
- Some combination — e.g. the first N agents are cheap/free (a small covert
  service is free flavor), and cost or a rejection kicks in past that,
  similar to how ship construction is capped by what `credits` can actually
  buy rather than what was asked for.

Any of these should live in the reducer (billed the same way `billConstruction`
already bills ship gains post-batch), not in prompt guidance alone — the
project's own stated principle throughout is that a limit a model is merely
*told* about is a limit that gets argued around eventually.

**FIXED —** all three, in the reducer. `AGENT_COST` charges 40–150 credits at
deployment by mission (a watcher is cheaper than a corvette; an assassination
costs more than two), rejecting with `insufficient_credits` when the treasury
cannot cover it. `AGENT_UPKEEP` (3/turn, just under a hull's 4) is charged for
every *live* agent — burned ones are already spent and cost nothing — and
flows through `ledgerFor` as a new `agentUpkeep` field so it appears in the
briefing rather than silently eroding income. `maxAgentsFor` caps simultaneous
operatives at `2 + guile modifier`, scaled off the stat the way `subornLimit`
is rather than a flat constant, which lands where the lore wants it: the Nars
run six, the Iron Vigil two. Six tests; the balance harness is unchanged since
the doctrine bots do not deploy agents.

---

## 7. ~~GAP~~ FIXED — no way to accumulate diplomatic progress toward a neutral world

Observed across an Arkanis playtest whose entire goal was annexing neutral
worlds by persuasion alone (no force, no bribery), over three genuinely
different approaches.

Every world-targeted attempt that landed a `partial` produced **no durable
state whatsoever** — no commitment, nothing banked, nothing a subsequent
attempt could build on. Examples:

- An open referendum on Sennex → `influence` partial. Narrative outcome was
  richly specific ("a plurality in favor but nothing you can honestly call a
  mandate; sympathetic but unconvinced"). Mechanically: credits spent,
  `commitments: []`, Sennex's state byte-identical to before.
- Quiet demographic settlement of Neth → `influence` failure. Credits spent,
  no state change, plus a disposition hit as neighbours noticed.

Contrast with what *did* persist: when the same campaign reframed the goal as
a **standing policy** rather than a per-world pitch — *"declare an open
accession charter, any settlement that wants in gets in, broadcast
permanently"* → also only a `partial`, but it banked a clean
`establish_commitment` (`open_accession_charter`, single-party,
non-exclusive).

So the durable-state mechanism works fine and the arbiter reaches for it
correctly; the gap is that it only triggers for things phrased as *standing
arrangements*, and a partial success at *courting a specific world* has
nowhere to live. The practical effect is that incremental diplomacy is
stateless: a player can spend three turns and real credits moving a neutral
world from hostile to "sympathetic but unconvinced" and have literally
nothing to show for it on turn four except whatever the model happens to
recall from recent event-log text. Compare combat (garrison damage persists)
or agents (persist until recalled or burned) — diplomacy is the one pressure
track with no ratchet.

**Fix direction:** give per-world courtship somewhere to accumulate. Cheapest
option is probably to lean on the existing commitments mechanism — let the
arbiter establish something like a `courtship_progress` / `accession_talks`
commitment naming the target world, which subsequent attempts can reference
and which raises the ceiling (or lowers the DC) on a later push. A heavier
option is a real per-system disposition or influence track, but that's a new
axis of state and probably not warranted before the cheap version is tried.

**FIXED —** took the cheap option, and it works. `prompts/appraisal.md` gained
a "Ground gained also counts" section telling the arbiter that visible headway
is itself a durable fact worth recording (`accession_talks` for courting a
world, `courtship_progress` more generally), with the world named in the text
and `exclusive: false` so rivals can contest the same world. The ratchet is
the second half: banked progress now **lowers the next DC** by roughly 2–3 per
round, floored around 8. Verified live — a cold approach to Sennex priced at
**DC 14** and banked `accession_talks`; the identical ask with that progress
visible priced at **DC 11**, with the arbiter citing the banked ground in its
rationale. Five tests.

---

## Minor — ~~an agent can be given an effect that is mathematically incapable of firing~~ FIXED

In the Drajk playtest, a covert captive-taking operation against Arkanis
produced an agent with `effect: { kind: 'crew_defection', perTurn: 1 }`. But
`subornLimit(krayt, freeworlds)` evaluates to **0** — Arkanis's `resolve` 19
against Drajk's `guile` 14 means Drajk can never suborn anything from them, at
any roll, ever. So the agent is live, unexposed, has a `successChance` of 20%,
and will faithfully roll for an effect that is guaranteed to produce nothing
for the rest of the campaign.

Not the same bug as #2 (ownership was correct here) — this is the arbiter
choosing a mechanically valid effect without checking whether the stat contest
behind it can ever resolve favorably. Low severity since it just wastes the
player's action rather than corrupting state, but it's silent, and a player
would have no way to know their operative was pointless without hand-computing
`subornLimit` themselves.

**Fix direction:** `deploy_agent` could reject (or the arbiter could avoid)
`crew_defection` where `subornLimit(owner, target) === 0`, the same way the
suborn guard already rejects the direct-action version with a clear message
("their resolve is beyond its guile").

**FIXED —** that exact guard, with the same wording as the direct-action
rejection so the two paths read consistently. Only `crew_defection` is
affected; sabotage and the rest against a resolute target remain perfectly
legitimate. Three tests.

---

## Minor — ~~disposition changes are one-directional~~ FIXED

Across the Drajk raiding playtest, actions moved *other factions'* opinions of
the actor substantially, but never the actor's opinion of them:

| | before | after |
|---|---|---|
| freeworlds → krayt (victim's view) | −30 | **−52** |
| hutt → krayt (buyer's view) | 20 | **25** |
| krayt → freeworlds (actor's view of victim) | −10 | −10 |
| krayt → hutt (actor's view of buyer) | 30 | 29 |

Raiding a faction and getting repelled, then being publicly exposed running
slavers on their soil, moved the victim −22 — but left the raider's own view
of them completely unchanged. Dispositions are stored as a per-faction map
(`faction.disposition[otherId]`), so they're structurally capable of diverging
legitimately, and some asymmetry is realistic. But a total absence of
reciprocal movement across an entire hostile campaign reads more like the
reaction pass only ever writing one direction than like a modelled
relationship. Worth a look; low priority.

**FIXED —** investigating turned up a concrete defect rather than a modelling
quibble. `warsFor(f)` filtered on `other.disposition[f] <= -60` — i.e. "who
hates me" — so with the playtest's end state (Arkanis at −62 toward Drajk,
Drajk at −10 toward Arkanis) **Arkanis did not list Drajk as an enemy at all**,
despite having just been raided by it. `warsFor` now checks both directions,
on the principle that a war is a property of the relationship rather than of
one party's opinion, and the −60 threshold is a named constant
(`WAR_DISPOSITION_THRESHOLD`) since two reads of it have to agree. A live
pact still suppresses it both ways. Three tests.

The underlying one-directional *emotional* model was left alone deliberately:
it is mostly correct. The injured party resenting the aggressor (raids, tolls,
suborning, pact-breaking) is right, and making it symmetric would be wrong —
a toll collector does not resent the payer for paying.

---

## Confirmed working well (arbitration for off-mechanic concepts)

Two short playtests (Arkanis pushing agents unorthodoxly; Ojjul Nar Combine
roleplaying a drug lord — smuggling and seduction, neither a defined mechanic)
stress-tested `arbitration.ts`'s "does this establish something lasting" path
specifically. Worth recording since it's the part of the system doing the most
improvisation and it held up well across every case:

- A forged-ledgers scheme to provoke a third faction (no mission fits this)
  was mapped onto the closest real mission (`subversion` + `stat_debuff`),
  not refused and not invented from nothing.
- A narcotics-smuggling operation with no matching op at all became a clean,
  correctly-scoped `establish_commitment` (`smuggling_operation`,
  single-party, non-exclusive) — exactly the pattern the marriage example in
  `CLAUDE.md` describes, working for a completely different scenario.
- A seduction attempt against Iron Vigil (a faction whose own red lines
  declare it incorruptible) was **not** blocked by a hard rule — it was priced
  as an ordinary `guile` check and simply lost, with a failure narrative that
  independently respected Vigil's established character. Fictional
  consistency held without needing a special case.
- The same seduction framing against a more receptive target produced **both**
  a correctly-owned recurring `surveillance` agent **and** a properly
  bilateral `establish_commitment` (`quiet_understanding`, two parties,
  non-exclusive) in one action — composing two mechanisms correctly for one
  novel concept.

None of this needs fixing. Noting it so the agent-ownership bug (#2) above
doesn't read as "agents are broken" — the agent *system* and the arbitration
around it are sound; the specific `ownerFactionId` field is the one thing
that's wrong.

---

## 5. ~~COSMETIC~~ FIXED — one diplomacy reply broke the fourth wall

A `diplomacyReply` call returned `"I role-played the Ojjul Nar Combine's side
of this negotiation..."` — third-person meta-narration instead of in-character
dialogue — on the message that finalized a treaty negotiation. One occurrence
in ~5 exchanges in the same channel; an immediate retry with the same prompt
was clean and fully in character. Not investigated further; noting the
pattern (happened specifically on a "seal the deal" / finalize-feeling
message) in case it recurs.

**FIXED —** `diplomacy-persona.md` already banned the assistant register
(hedging, tricolons, politeness scaffolding) but not *describing instead of
speaking*, which is a different failure. It now forbids third-person
meta-narration outright, requires first person, and calls out that the
temptation peaks on the message that closes a deal. Two tests.

---

## 8. ~~OPEN~~ FIXED — completed orders change nothing, so economic development does not exist

Raised by the user reading the prompts and asking whether there is a concrete
link between the arbiter *allowing* an action and the resolution pass actually
changing game state — "it would be annoying for a player to invest in mining
expeditions to find there is no income reward." There is no such link, and the
problem is broader than the mining case.

### What was verified

**Nothing carries from appraisal to resolution except `establishes`.** The
`stat`, `difficulty` and `rationale` are passed as narrative context. There is
no field meaning "this was priced as an economic investment, so it must yield
income", and no code path that checks one against the other.

**Commitments are inert.** `establish_commitment` writes to
`state.commitments`, and the only readers are `conflictingCommitment`
(exclusivity), `commitmentsOf` (the UI panel) and `serializeCommitments` (the
arbiter's prompt). **`ledgerFor` never reads them.** A `mining_operation`
commitment shows in the UI, lowers future related DCs via the item-7 ratchet,
and pays zero credits forever.

**`PendingOrder` has no effect payload.** No field describes what completion
should do. The only outcome-bearing fields (`force`, `path`) are
movement-specific. Order completion for non-movement work runs exactly this,
in `tickTurn`:

```ts
const note = `${order.label} completed at ${nameOf(order.targetId)}.`;
logEvent(state, 'order', note, order.factionId);
notes.push(note);
report.completed.push({ ... });
```

A log line and a report entry. No state change of any kind.

**Probe — four order types, run to completion:**

```
construction_infra (5t)   sv=9 -> 9   net=260 -> 260   garrison 5 -> 10
garrison_raising   (3t)   sv=9 -> 9   net=260 -> 260   garrison 5 -> 8
fortification      (3t)   sv=9 -> 9   net=260 -> 260   garrison 5 -> 8
industrial_conv    (5t)   sv=9 -> 9   net=260 -> 260   garrison 5 -> 10
```

The garrison movement is **passive `GARRISON_REGROWTH` (1/turn)**, not the
order: 3-turn orders gave +3, 5-turn gave +5, and `fortification` and
`garrison_raising` produced identical results. Credits rose by exactly
accumulated income. So `garrison_raising` raises no garrison, `fortification`
fortifies nothing, `industrial_conversion` converts nothing,
`construction_infrastructure` builds nothing.

**12 of 15 duration categories have zero readers** outside `duration.ts`. Only
three do anything: `blockade` and `commerce_raiding` (read live off
`pendingOrders` while `progress > 0`, in `trade.ts`) and `fleet_movement`
(triggers `resolveBattle` on arrival).

**`strategicValue` is immutable at runtime** — no op can change it, so
territory income cannot grow except by taking more systems.

### Why it matters

The only ways income ever changes are: conquest, trade-route geography (also
immutable), treaty transfers, tolls/raiding, and one-off `adjust_credits`.
There is no "invest now, earn more later" anywhere in the game. Conquest,
interdiction, agents and diplomacy all work — **economic development is the
one strategy with no mechanical existence.** A player who spends five turns
and real credits developing a world gets a log line.

It also makes `durationTurns` meaningless for those twelve categories: any
effect has to be emitted up front at declaration (so it lands immediately and
the duration is theatre) or never lands at all.

### Fix directions — this is a design call, not a mechanical fix

The user was asked to pick the shape and the session ended before they did.
**Do not just pick one; ask.** Options, roughly largest to smallest:

- **(A) An effect payload on orders.** `onComplete` ops declared at issue time,
  schema-validated then, held by the reducer, applied on completion. Fixes all
  twelve categories at once and makes `durationTurns` mean something. The
  hazard is that a model choosing its own payoff is "the model rewrites state"
  on a delay — so it needs bounding the way `billConstruction` and
  `subornLimit` already are: cap the per-turn income one project can create,
  charge for it up front, and keep `transfer_control`-class effects out of the
  payload entirely.
- **(B) Make commitments economically live.** Give `Commitment` an optional
  `incomePerTurn` that `ledgerFor` reads. Much smaller, solves only the
  economic slice, leaves `fortification`/`garrison_raising` still hollow.
- **(C) Make `strategicValue` mutable** via a reducer-only op emitted on
  completion of development orders. Narrow, and touches the trade network too
  since hubs are defined by `strategicValue >= 7`.

(A) is the most general and matches the architecture. (B) is the cheapest
thing that would answer the user's literal question.

**FIXED — (A) then (B), with the (C) scenario reachable through (A).** The user
chose the effect payload as the mechanism and commitment income as a follow-up,
and asked specifically that the scenario option (C) would have addressed — a
developed world becoming a trade hub — be covered by what was built rather than
by a separate mechanism.

- **(A)** `src/domain/development.ts` plus `onComplete` on `issue_order` and
  `PendingOrder`. Four effect kinds (`develop_system`, `raise_garrison`,
  `fortify`, `commission_ships`) applied by the reducer on completion. Bounded
  four ways: a closed vocabulary that cannot reach another faction, a
  code-enforced map of which order category may deliver which kind (the link
  that did not exist — a payload therefore inherits its category's duration
  floor), per-kind magnitude caps trimmed with a note, and payment **at issue
  time** so a payoff cannot exceed what the faction could afford. Seven of the
  twelve hollow categories now deliver something; the other eight carry no
  payload deliberately, because their effects already live in another op or are
  read live while they run.
- **(B)** `Commitment.incomePerTurn`, read by `ledgerFor` as `commitmentFlow`,
  capped at 25 per arrangement and by a per-faction ceiling derived from
  `influence` (Meridian 50, the Nars 40, the Iron Vigil 10).
- **(C)'s scenario** is covered: `develop_system` crossing `HUB_THRESHOLD` turns
  a world into a trade hub and creates new lanes. Asserted directly —
  slu-2 at value 6 develops to 7, the galaxy goes from 8 hubs and 28 routes to 9
  and more, and Meridian's route income rises.

**The pricing was wrong first and the measurement is why it isn't now.** A flat
80 credits per development point was reasoned from territory income (7/turn per
point) and ignored that `strategicValue` also drives route volume and hub
status. Measured marginal value per point on the seed: +7 for an ordinary
backwater, +13 on an existing hub, +36 founding a poorly-connected hub, **+209
founding slu-2**. A 30-turn reinvestment probe at the flat price took Meridian
from 283 to 952 net for 1,120 credits — payback under two turns. `developmentCost`
now computes the marginal income of the exact development on the actual board and
charges 12 turns of it; the same run costs 7,968 credits and stays behind a
hoarding control on treasury until about turn 25.

36 tests in `tests/development.test.ts`, plus two replay tests (one for a
payload order, one asserting a journal written before payloads still loads).

---

## Design question raised by #1: does combat need an explicit tactical phase?

> **Half of this is now answered.** The UI gap described below is closed — see
> item 12 — and the report was built to be indifferent to what combat becomes.
> What is still open is only whether the resolver itself should be richer.


The user's read, after seeing bug #1 reproduced three times: leaving combat
resolution reachable from a single strategic-narrative call — even nominally
gated by a check — is inherently fragile, the way it would be in a tabletop
game if the GM narrated battle *outcomes* directly instead of running a
tactical phase with its own resolution loop. Proposed direction: a distinct
tactical phase for fleet-vs-fleet and fleet-vs-ground combat, structurally
separated from the strategic/narrative layer, plus UI to actually show that
resolution to the player rather than a single terse log line.

Worth being precise about what's already true here before designing further:
`resolveBattle` (`src/domain/reducer.ts`) is *already* a fully deterministic,
model-free tactical resolver — seeded dice, two phases (fleet engagement, then
ground assault), proportional losses, garrison erosion — that runs exactly
once, when a `fleet_movement` order arrives. That part of the architecture is
sound; I watched it work correctly multiple times in this campaign session,
independent of the model. **The bug is that the resolution call can currently
reach past that boundary and fabricate a result before the tactical resolver
ever runs** — not that the tactical resolver doesn't exist.

Two things are worth separating, then:

- **The bug-fix, which is prompt + maybe a reducer guard** (see #1 above) —
  closes the boundary that's currently leaking, forces every attack through
  `resolveBattle` with no exceptions.
- **The UI gap, which is real and independent of the bug** — even when
  `resolveBattle` runs correctly, all the player currently sees is one
  sentence like *"Fleets engage over Kalzir: Meridian loses 24, defenders lose
  20."* There's no visibility into which phase produced which losses, what the
  actual roll was, whether the fleet phase or the ground phase decided it, or
  what's left standing on either side afterward. Over this playtest I had to
  reconstruct all of that by diffing raw state before/after, which a player
  obviously can't do. A "battle report" panel — phase-by-phase, with the roll,
  the forces engaged, and the outcome of each phase — would make the existing
  deterministic system legible without changing what it computes.

Whether a genuinely richer tactical layer (multi-round, more granular than one
roll per phase) is worth building on top of that is a separate, bigger
question — flagging it here as raised, not resolved. The immediate, bounded
work is: close the boundary (#1) and build the report UI. Both are worth
scoping properly before committing to anything more ambitious.
