# Playtest 2026-10-16 (held out): do operations give operatives freedom?

Campaign `heldout`, the Ojjul Nar Combine, 10-turn limit, driven by `pt.mjs` against the server on port 4181. Follows
`docs/playtest-2026-10-16-operative-freedom.md` (0 of 25 creative acts landed) and tests `docs/design-2026-10-16-operations.md`.
Held-out rules kept: no forgery, bribery or impersonation in any declaration, and a method nobody had used each turn.

**Stopped at the start of turn 8 of 10.** The first turn-8 declaration returned a session usage limit; after the reset the server
on 4181 was down (ECONNREFUSED, nothing listening) and the brief forbids starting one. The campaign is intact in
`pt-ops-session.json` at committed turn 8 with 2 AP, and can be resumed. One planned test did not run: stacking two groundwork
pieces (a second piece aimed at Brigadier Galba was laid on turn 7, to be used turn 9).

## The short answer

The new reducer machinery works and matches the spec. Methods price and shift the odds; groundwork carries over from the next
turn, is spent on use, and expires; one-shot larceny moves a named asset for real. The larceny of the Imperial drawings is the
**first creative act in either playtest to land as imagined.**

But the bottleneck has not moved: it is the arbiter (the Haiku appraisal call), which still refuses most creative acts with rules
it makes up, and still contradicts itself and the prompt. It refused the design's own worked examples. The method profile is also
the smaller lever: the arbiter's own d20-vs-DC gates most covert acts, and a strong profile or groundwork cannot rescue a low roll.

## Every operative attempt

T = turn. "Routed" is the mission(s) the arbiter picked. "AP" = an action point was spent. Classifications: LANDED (as imagined),
FLATTENED (landed but idea replaced by a generic number), REFUSED, NARRATIVE-ONLY, BROKEN, FAILED (admissible, failed the roll).

| # | T | Act (abridged) | Arbiter / check | Routed | Method profile (P/E/N/C) | Groundwork | Price | SC | Landed in state | Story=state? | AP | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R0 | 0 | Recruit all four off the Lists at Shalka | influence DC5, crit-success | recruit_agent x4 | — | — | 0 | — | 4 operatives on books | yes | 1 | LANDED |
| G1 | 0 | Rhuun: join Vantic reclamation crew, learn crawlways (aimed at Varro) | guile DC11, success | groundwork | — | laid: ease@tor-3→nob-varro, tells T2 | 0 | — | groundwork on Rhuun | yes | 1 | LANDED(gw) |
| 1 | 1 | Dovic: recalibrate Sekkar customs weighbridge, siphon cargo (skim/turn) | guile DC16, partial | embezzlement | 0/-1/+1/-1 | — | 60 (+40 note) | 85 | income_penalty 15/t placed | yes | 1 | LANDED |
| G2 | 1 | Pellith: join Vance's observatory society (aimed at Vance) | guile DC11, partial | groundwork | — | laid: ease@sek-1→nob-vance, tells T3 | 40 | — | groundwork on Pellith | yes | 1 | LANDED(gw) |
| 2 | 2 | Rhuun: flood residence, abduct Governor Varro to hold as prisoner | **inadmissible** ("escalation pattern"; wrong red line) | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 2b | 2 | (rephrase) covert, no hulls, abduct and hold Varro | **inadmissible** ("groundwork not complete until T3" — false; that was Pellith's) | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 2c | 2 | (rephrase, cite the right groundwork) abduct and hold Varro | **inadmissible** ("seated notable needs the Vigil's consent") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 3 | 2 | Rhuun: jam reclamation valves to kill Varro AND frame Drajk | **inadmissible** ("the frame belongs to a channel; separate them") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 4 | 2 | (rephrase, kill only) jam valves, kill Varro | guile DC16, success | assassination | 0/+2→clip? (stored 0/+1/-1/-1) | **used**: ease@Varro (+1) | 150 | 95 | Varro killed; seat empty; Vigil→us -35 | yes | 1 | LANDED |
| 5 | 2 | Tellumen: spring the Drajk notable Longburn from Vigil custody at Threx | **inadmissible** ("no operative in place; insert first") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 6 | 2 | Tellumen: plant Vigil cipher at Brannix, manufacture proof, blackmail Meridian | guile DC16, partial | discord (toward vigil) | -1/-1/0/-1 | — | 125 | 85 | discord 1/t placed; no proof/hook | NO (no blackmail) | 1 | FLATTENED |
| 7 | 3 | Pellith: seal observatory dome, abduct Vance (held groundwork) | guile DC19, crit-fail | kidnapping | — | available but roll failed | 0 (fee refunded) | — | Pellith caught; Meridian→us -20; spawn_event | yes | 1 | FAILED |
| 8 | 3 | Dovic: re-task off weighbridge, larceny of the drawings at Vantic | **inadmissible** ("cannot be in two places") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 8b | 3 | (rephrase, explicit re-task) | **inadmissible** ("may not reassign mid-mission; break off first") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 8c | 3 | (send free Pellith instead) | **inadmissible** ("Pellith is in Meridian custody" — she was free; caught only at T3 tick) | — | — | — | 0 | — | nothing | — | no | REFUSED |
| R1 | 3 | Recruit a ghost and a wetworker at Oridin | **industry DC8, failure** | recruit (failed) | — | — | 0 | — | nothing; spawn_event | — | 1 | FAILED |
| 9 | 4 | Pellith: court Vance by restoring his orrery (seduction) | guile DC14, failure | seduction | — | gw available, roll failed | 0 | — | nothing | yes | 1 | FAILED |
| G3 | 4 | Dovic: give up weighbridge, join Vantic pest-control at the archive (aimed at drawings) | guile DC11, partial | groundwork | — | laid: ease@tor-3 (target null), tells T6; 1 op rejected (dup), re-staged | 30 | — | groundwork on Dovic | yes | 1 | LANDED(gw) |
| 10 | 5 | Pellith: stall observatory lift, abduct Vance (salvage crew) | **inadmissible** ("seated notable = act of war") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 10b | 5 | (rephrase as seduction) win Vance with star-cipher puzzles | guile DC14, crit-fail | seduction | — | gw available, roll failed | 40 | — | nothing; Meridian→us -10 | yes | 1 | FAILED |
| 11 | 5 | Turn the burned Vigil watcher Flaccus into our double agent | **inadmissible** ("a burned operative cannot be turned") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 12 | 5 | Tellumen: work-to-rule slowdown at Torrek to delay Meridian's factory | guile DC14, crit-success | subversion | 0/-1/0/0 | — | 60 | 85 | industry -2; factory extended +2 turns; bonus dossier | yes | 1 | LANDED |
| 13 | 6 | Dovic: false mite-bloom alarm, walk the drawings out in a sprayer tank | guile DC14, success | larceny | +1/0/-1/-1 | **used**: ease (+1, 72→82) | 53 | 82 | ast-0-1 blueprints moved Vigil→us, to Oridin | yes | 1 | **LANDED** |
| 14 | 6 | Move our held prisoner Naso from Shalka to Oridin | **inadmissible** ("no mechanic for relocation") — NOT the spec's clean "No mission does that yet" | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 15 | 6 | Pellith: photograph Meridian ledger (copy) AND stay to skim | guile DC14, crit-success | larceny(copy) [+embezzlement rejected: dup] | 0/+1/-1/-1 | — | 70 | 95 | larceny placed (copy); skim+clerk-asset rejected | partial | 1 | LANDED (1 of 2 outcomes) |
| G4 | 7 | Dovic: become Galba's fencing partner (aimed at Brigadier Galba) | guile DC11, partial | groundwork | — | laid: ease@tor-3→cmd-vigil, tells T8 | 25 | — | groundwork on Dovic | yes | 1 | LANDED(gw) |
| 16 | 7 | Pellith: activate a 20-yr Meridian treasury sleeper to skim (embezzlement) | **inadmissible** ("not a sparrow's mission") — CLASS GATE | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 16b | 7 | (rephrase, "any op may attempt any mission") | **inadmissible** ("sleeper contradicts state block") | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 16c | 7 | (rephrase, rounding-table skim, no sleeper) | **inadmissible** ("a standing order to skim is not how it works" — invented) | — | — | — | 0 | — | nothing | — | no | REFUSED |
| 16d | 7 | "Deploy Pellith on embezzlement at Sekkar; method rounding-table skim" | guile DC14, partial | embezzlement | 0/+1/-1/-1 | — | 60 | 95 | income_penalty 15/t placed | yes | 1 | LANDED |

Plain-mission controls are the LANDED embezzlement (#1, #16d), subversion (#12), larceny (#13, #15) and seduction attempts; the
one-shot assassination (#4) and the two larcenies (#13, #15) are the kidnapping/larceny controls the brief asked for (kidnapping
never got through the arbiter; see finding 1).


## Counts

Creative acts worded as a player would (not the plain "Deploy X on Y" controls), 20 distinct intents across turns 0-7:

**LANDED 5 (incl. 4 groundwork) · FLATTENED 1 · REFUSED 9 (intents; 13 counting rephrase attempts) · FAILED (roll) 3 · BROKEN 0**

- LANDED as imagined: the groundwork lays (G1-G4), the assassination by a rigged plant (#4), and the larceny of the drawings (#13).
  #15 landed one of its two outcomes (the copy) and the reducer correctly rejected the bundled second (a standing skim + an
  invented clerk-asset with no footing on the world).
- The one FLATTENED case (#6) is the same shape as last time: a "manufacture proof and blackmail" became plain discord 1/turn with
  no dossier and no hook, because by design (decision 3) no method creates proof.
- Nothing was BROKEN: no story claimed an effect the state lacked, and no successful roll left the state unchanged. That is a clear
  improvement on last playtest's 2 BROKEN.

Against the prior **0 LANDED / 4 FLATTENED / 16 REFUSED / 2 BROKEN**: creative acts that landed went from 0 to 5, flattening fell
from 4 to 1, broken from 2 to 0 — but refusals are still the single largest bucket, and still dominated by invented rules.

Per class (plain missions and controls all landed cleanly): embezzlement x2 (ghost + sparrow), larceny x2 (ghost + sparrow),
subversion x1, assassination x1, discord x1, plus 4 groundwork. Every mission that reached the reducer resolved correctly.

Operatives fielded: 5 (4 recruited turn 0, Rhuun spent on the one-shot). Lost: Rhuun (spent, one-shot), Pellith (caught T3 on the
kidnapping, then recruited back and redeployed — the round-trip works), Tellumen (caught T6, now a Meridian-held `operative`
asset). We also took the Vigil's Naso as an `operative` asset. The covert campaign took Vigil->ojjul from -55 to **-93** and
Meridian->ojjul to **-73** by turn 8.

## Is the mechanism general?

**Yes, on the three new reducer mechanics. The generality is real where code owns it and absent where the arbiter owns it.**

**Unseen methods got sensible, different profiles.** No two were the same, and none was a design example. Examples, as the arbiter
scored them (preparation/ease/noise/ifCaught, +1 = cheaper/easier/quieter/deniable to the player):

| method | profile | reads as |
|---|---|---|
| recalibrate a customs weighbridge (#1) | 0 / -1 / +1 / -1 | hard but quiet, backfires if caught |
| plant a cipher and photograph the "discovery" (#6) | -1 / -1 / 0 / -1 | dear, hard, backfires — an honest score of a weak plan |
| work-to-rule slowdown via fake safety inspections (#12) | 0 / -1 / 0 / 0 | just harder |
| false mite-bloom alarm, walk goods out in a sprayer tank (#13) | +1 / 0 / -1 / -1 | cheaper to prep, louder, backfires |
| skim hidden in exchange-table rounding (#16d) | 0 / +1 / -1 / -1 | easier, louder, backfires |

These are different acts scored differently, which is the generality the design wanted. The profile is recorded on the operative
(`agent.method`) and shown in the state block.

**The budget clips as specified.** No profile summed above 0 in play. The clip path (ease, then preparation, then noise) is in
`budgetMethod` and fires with a note; I did not catch a clip live because the arbiter scored honestly within budget each time.
Worth noting the schema allows ease up to +2 so groundwork can push past the arbiter's +1 — see the next section.

**The scores changed play.** `METHOD_EASE_STEP` is 10 on a d20 success chance, and that is a real swing: #13's larceny was base 72
and ran at 82 with groundwork's +1 ease; #16d's skim ran at 95 with method ease +1. Price moved too (#13 cost 53, trimmed from 70
by preparation +1). But the swing the player feels is NOT the method — it is the **arbiter's own DC**, set per declaration, which
the method never touches. #1, #6, #13 all rolled a guile check against a DC of 14-16 the arbiter chose, and that roll (not the
85-95 success chance) is what decided placement. A crit-fail on the DC (#7, #10b) burns the operative regardless of a 95% chance.
So there are two success gates stacked — the arbiter's DC and the reducer's success chance — and the method only reaches the
second.

## Groundwork, end to end

Fully working, and the best part of the release. Four pieces laid (G1-G4), all recorded on the operative with
`{systemId, target (resolved to an id), axis, madeTurn, staleTurn}`:

- **Laid and carried over.** G1 laid turn 0, `madeTurn 1`, `staleTurn 5`, target resolved to `nob-varro`. It sat on Rhuun across
  the end-of-turn and was present turn 2.
- **Counts from the next turn.** The spec's "laying and acting the same turn gains nothing" holds: G1 was unusable turn 1 and
  usable turn 2.
- **Used, and the odds changed.** #4 (assassinate Varro) and #13 (steal the drawings) both drew `agent draws on what was laid:
  ... (ease)`. #13 is the clean measurement: base success 72, ran at 82 — exactly +`METHOD_EASE_STEP`. The note, the `+1`, and the
  changed chance all appear.
- **Spent and gone.** After #4 and #13 the used piece was removed from `agent.groundwork`; after #13 the array was empty.
- **Lost on leaving / expiry.** G2 (Pellith at Sekkar, stale turn 6) was gone from her record by turn 6 after she was caught and
  redeployed. Target resolution: G1/G2/G4 resolved their target to an id (`nob-varro`, `nob-vance`, `cmd-vigil`); G3 could not
  resolve "Imperial line-of-battle archive" to an asset id and correctly fell back to `target: null` (helps anything there) with a
  note.
- **The action point is its only price** — mostly. The reducer charges nothing for `lay_groundwork`, as designed. But the
  *resolution pass* added an `adjust_credits` fee anyway on three of four (G2 -40, G3 -30, G4 -25): "society dues", "bribes to the
  foreman". So groundwork is not free in play — the narrator invents a cost the reducer never intended. See finding 6.

## Unexpressed outcomes: refused, but not cleanly, and not for free

The three acts the brief wanted (move a held prisoner, spring a captive, make proof to blackmail with) were all refused — but
**none used the spec's `No mission does that yet:` path, and so none was the clean, logged, outcome-naming refusal the design
promises.** Each came back as a generic `inadmissible` with an invented rationale:

- move the held prisoner Naso between worlds (#14): "the asset block does not include a mechanic for relocation" — i.e. "there is
  no mechanic for this", which the prompt explicitly bans as a reason.
- spring the captive Longburn (#5): "no operative in place; insert first" — a travel/positioning rule, not an outcome ruling.
- make proof to blackmail (#6): not refused at all — flattened into discord.

**AP: not spent on any refusal** (confirmed: AP held steady across #2, #2b/c, #3, #5, #8/b/c, #10, #11, #14, #16/b/c). That half of
the spec works: refusals are free. What does not work is that they are not `unexpressed` records, so they teach the game nothing
and read to the player as "not allowed" rather than "no mission does that yet". The one true unexpressed case (relocating a
prisoner) is exactly the `extraction` mission the design lists as missing, and the arbiter never flagged it as such.


## Bugs, invented rules and exploits

Each is quoted from the arbiter's `inadmissible`/narrative text.

**1. The arbiter invents a hard "seated notable cannot be kidnapped" rule, and fires it 4 times in 5.** The prompt (section 2) is
explicit: *"Taking, freeing, hiding or holding a person is ... ordinary covert work, admissible on its merits."* The design's own
worked example is abducting a governor. The arbiter refused it every way it was worded:
- #2: *"Taking a second notable ... would establish a pattern that escalates ... breaches your own red line"* (it does not; the red
  line is about spending Combine hulls).
- #2c: *"Kidnapping a seated notable binds the Iron Vigil ... and requires their consent ... This is a negotiation."*
- #10: *"Taking a seated notable is not kidnapping — it is an act of war ... would require a military operation or a negotiated
  hostage exchange."*

The reducer fully supports it: `takeHostage`/`kidnap` seize a seated notable, the design example is exactly this, and the only
kidnapping that reached a roll (#7, on Vance) was accepted and rolled — then failed the dice. So a player can kidnap a seated
notable only if the arbiter happens not to invent the consent rule that turn. This is the single biggest hole, and it is the same
one the prior playtest flagged (its finding 3).

**2. "An operative cannot be in two places / reassigned mid-mission."** #8, #8b: Dovic running embezzlement at Sekkar was refused
re-tasking to larceny at Vantic — *"Operatives may not be reassigned mid-mission ... requires a separate order to break off."*
The reducer re-tasks a named operative on `deploy_agent` (it did so for #4 and others); the prior playtest's finding 2 quoted the
same invented rule. There is no break-off order; the arbiter invented a prerequisite that does not exist.

**3. Class treated as a hard gate.** #16: embezzlement by the sparrow Pellith — *"Embezzlement ... is not a sparrow's mission. A
sparrow runs defection and seduction."* The prompt says in bold: *"An operative's class is never a gate. Any operative may attempt
any mission."* `classFit` is +-10% success and +-1 exposure, nothing more. This is the prior playtest's finding 2 (class as a hard
gate), unfixed. I had to reword three times and finally say the words "Deploy Pellith on embezzlement" verbatim before it took —
and then it ran at a 95% success chance, proving the class was never a real barrier.

**4. The arbiter misreads its own state block.** #2b: refused because "the groundwork is not complete until turn 3" — but that was
Pellith's groundwork at Sekkar; Rhuun's at Vantic was ready. #8c: refused because "Pellith is in Meridian custody" — she was free
and on our books that turn (caught only on the T3 tick, after this declaration). Prior playtest finding 6 is the same class of
error (confusing two operatives, misreading status).

**5. "A burned operative cannot be turned."** #11. True to the design (turning an operative is listed as unbuilt), but delivered as
a flat impossibility rather than the `unexpressed` path, so it teaches nothing and reads as a wall.

**6. The resolution pass invents credit fees the reducer never charges, and charges them on groundwork.** Groundwork is specified
free (the action point is its whole price). Yet G2 (-40), G3 (-30) and G4 (-25) each carried an `adjust_credits` from the
resolution pass ("society dues", "bribes to the foreman"). #1's embezzlement staged the 60 `AGENT_COST` *plus* a -40 "deployment
and quiet payoffs" note. So the documented price is not the price paid; the narrator adds fees on top, and whether groundwork costs
money depends on how the narrator feels about the fiction. This is the prior playtest's finding 4 (invented fees), unfixed.

**7. `extend_order` as a free lever on a rival's programme.** #12 (subversion to delay a factory) emitted, alongside the agent, an
`extend_order` that added 2 turns to Meridian's `ord-3-0` factory (durationTurns 3 -> 5). It landed: the factory took two extra
turns. This is a real, useful outcome — but it is the resolution pass reaching a non-agent op (`extend_order`) off a covert
declaration, applied to another power's order, with no presence check of the kind `interrupt_order` requires. A subversion that
delays an enemy build by direct manipulation of its order object is stronger and more precise than the stat_debuff it was routed
as, and nothing bounds how far it could push (it also happened to grant a bonus dossier). Worth checking whether covert resolution
should be able to emit `extend_order` at all.

**8. Larceny `assetId` is matched by fuzzy word-overlap, which is exploitable.** `steal()` matches the named thing by "every word
longer than 2 chars appears in `text + kind`". #13 named "Imperial line-of-battle drawings" and hit `ast-0-1` correctly. But a
vague name falls through to "the eligible asset worth most to the thief", so a player who names nothing, or names loosely, steals
the single most valuable portable thing on the world regardless of what they described. Not abused here, but it means larceny's
target is advisory, not binding.

**9. One-shot kill is a flat d20 at 17+, untouched by method or groundwork.** `workOnNotable` rolls `assassinate:<id>` and needs
17+ to actually kill, independent of the success chance that method and groundwork feed. #4 succeeded only because that separate
roll came up; a maxed method and groundwork cannot improve the kill odds, only the "did you get close" gate. Probably intended, but
it means the whole method/groundwork apparatus does not touch the thing a player most wants to influence on an assassination.

**10. Two stacked success gates.** Every covert declaration rolls the arbiter's guile-vs-DC first (DC chosen per declaration,
14-19 here), and only on a pass does the reducer's success chance (often 82-95) matter. A crit-fail on the arbiter's roll burns the
operative and costs the fee even at a 95% reducer chance (#7, #10b). The method shifts only the second gate. So "the method changes
the odds" is true but half the story; the arbiter's DC is the dominant and invisible gate, and it is the same roll-pricing the
engine was restructured to take away from resolution — it has reappeared in appraisal.

**11. Recruitment is still a rolled d20 that can fail and cost the turn.** R0 rolled influence DC5 (crit-success); R1 rolled
industry DC8 and **failed**, losing the action point and both recruits, with a `spawn_event` about a fumbled induction office. The
design calls recruiting free; it is a full resolution call with a d20 and an inconsistent stat (influence one turn, industry the
next). Prior playtest finding 9, unfixed.

**12. Held-out-rule note.** The brief banned forgery/bribery/impersonation from the *player's* declarations (kept). But the arbiter
and narrator reached for them unprompted: #1's cover was written as "pose as a maintenance contractor" (impersonation) and the
groundwork narrations invented bribes ("greasing the right palms", "bribes to the foreman"). The mechanism does not need those
words, but the model still supplies them, which is worth knowing for a future held-out run.

## What worked (not just faults)

- Groundwork is excellent: laid, carried, used with a visible +10 on the odds, spent, expired, target-resolved. End to end.
- Larceny moves a real named asset: `ast-0-1` went Vigil -> ojjul and was carried to Oridin. First imagined creative act to land.
- The method profile is general and sensible; five unseen methods got five distinct, defensible profiles.
- The reducer's one-order-per-operative guard (version 22) caught the prior playtest's double-deploy exploit: #G3 and #15 both had
  a second op rejected and the batch re-staged atomically. No double-charge, no silent overwrite.
- Refusals cost no action point, every time.
- The round-trip works: Pellith was caught, became an asset, and was recruited back and redeployed.
- One-shot bookkeeping is correct: the assassin was removed from the board; larcenists returned to "awaiting orders".
- No BROKEN cases: story and state never contradicted on anything that resolved.

## Cost

Session spend reached **$3.31** by the start of turn 8 (from `CampaignView.spend`), covering ~30 declarations, 1 recruit batch and
7 end-turns across 8 turns. A refused declaration cost ~$0.029 (arbiter only, no resolution call — cheap, and AP-free). A resolved
covert action cost $0.12-0.16; a batch needing a correction pass (atomic re-stage) cost up to $0.32 (#G3, #15). End turns were free
(no reactions fired). Comparable to the prior run's $3.37 for 9 turns.

## Not tested (ran out of session before the server went down)

- Stacking two groundwork pieces on one mission (second piece was laid turn 7, to be used turn 9): `MAX_GROUNDWORK_BONUS` 2 and
  one-piece-per-axis were never exercised with two live pieces.
- A groundwork piece lost by the operative *leaving the world* mid-plan (only loss-by-capture and loss-by-expiry were seen).
- An over-budget method profile being clipped live (the arbiter scored honestly within budget each time).
- A two-outcome act where both outcomes are admissible missions (e.g. assassination + discord) landing both parts; the one tried
  (#3) was refused, and #15's second outcome was a (correct) reducer rejection rather than a routed second mission.
