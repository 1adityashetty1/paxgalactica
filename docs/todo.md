# TODO — known bugs and open design questions

## Where things stand (2026-08-13)

**Open work, in priority order.** Everything below is evidence-backed. Items
1–3 and 5's first half are done, and so is the compulsion pricing question
raised under item 11. **What is genuinely open is item 4 (no debt mechanic) and
the open half of item 5 (whether combat wants a richer resolver).**

Ahead of both, though, is a different kind of debt: **mechanisms that are built,
tested and have never been watched running.** The battle report card came off
that list on 2026-08-17 (see item 12). What remains on it is the extraction pass
emitting a hire or a debt, which no live negotiation has yet produced, and
`onComplete` payloads, which no live model call has ever set. The battle report card (item 12)
has never been seen rendering; `onComplete` payloads and commitment income have
never been exercised by a live model call; and `boundPayloadsToOutcome` was
written from a measured probe rather than from play. Live play has found every
bug in this file that the suite did not — including, twice this session, a bug
in the fix for the previous one.

**Branch state:** everything is in `main` as of PR #6 (`359f31f`), which merged
the arbiter breach rework, `classifyPrinciple`, the payload/outcome binding and
the compulsion reprice. 596 tests pass; `pnpm typecheck`, `pnpm typecheck:web`
and `pnpm build:web` are clean.

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

## 13. OPEN — a red line can be walked past through diplomacy

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

## 9. OPEN — three findings from the first live playtest of this session's work

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
- **The Ojjul Nar's two proxy lines are now half-supported.** *"Will not fight
  its own war where a proxy could be hired"* is backed by `profiteer` — its own
  wars cost it real income, so the ledger agrees with the red line. What still
  does not exist is the **hiring** half: there is no way to pay another power to
  fight for you, so the Combine is discouraged from war without being offered
  the alternative its doctrine names. That is the next piece of its identity.
- **The Combine's two debt lines still have no mechanic** ("will not forgive an
  unpaid debt", "an unpaid debt must be pursued"). Debt is not modelled at all;
  the closest existing home is a `commitment` with a negative `incomePerTurn`.
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

**Every numbered item in this file is now fixed**, each with tests. Original
write-ups are kept rather than deleted — the repro steps are the useful part
and they document why each guard exists. A "**FIXED —**" note follows each.

**Repo state:** branch `order-effects`, off `main` at `e5fb2c3`. PRs #1, #2 and
#3 are all merged. 479 tests pass; `pnpm typecheck`, `pnpm typecheck:web` and
`pnpm build:web` are clean.

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
