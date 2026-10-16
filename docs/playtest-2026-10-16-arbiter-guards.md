# Playtest 2026-10-16: the arbiter guards

Campaign `guards`, the Ojjul Nar Combine, 10 turns (0–9), played to the epilogue against the server on port 4181. Follows
`docs/playtest-2026-10-16-operations-heldout.md` and tests the four changes since it: invented refusals retried in code,
covert work sent rather than rolled, covert sends carrying only the sending, and `/advisor <question>`. Spend $3.23.

The playtester finished the campaign but its report write was blocked, so this report was rebuilt from its raw responses
(one JSON per declaration, end of turn and advisor call) and the final state. Where the playtester's intent is not in the
response, the act is described from what the arbiter and resolution said.

## Counts

| | this run | previous run |
|---|---|---|
| landed as imagined | 9 (3 of them groundwork or recruiting) | 5 |
| flattened | 0 | 1 |
| refused | 4 | 9 intents |
| failed on the tick (sent, then the operative's own roll failed) | 6 | 3 (failed the declaration roll) |
| broken (story and state disagree) | 2 | 0 |

## Every attempt

T = turn. "Sent" = staged with no declaration roll (`check: null`, binding `sent`).

| # | T | Act (abridged) | Ruling | Retry? | Roll | What happened | Class |
|---|---|---|---|---|---|---|---|
| a1 | 0 | Recruit all four off the Lists | admissible, guile DC 5 | — | **rolled** (crit success) | 4 operatives on the books; the groundwork in the same order was dropped (recruiting is alone) | LANDED |
| a2b | 0 | Rhuun: join Vantic reclamation crew, aimed at Governor Varro | groundwork, ease | — | sent | laid, tells from turn 2 | LANDED (gw) |
| t1a | 1 | Pellith: skim the Sekkar exchange | embezzlement + method | — | sent | 40 a turn from turn 2 | LANDED |
| t1b | 1 | Tellumen: forged letters setting Meridian against Drajk | discord | — | sent | 2 a turn, 8 of 20 by turn 5 | LANDED |
| t2a | 2 | Rhuun: kidnap Varro using the groundwork | **inadmissible**: "cannot be attempted in the same order that completes the groundwork" | no | — | nothing; no AP | REFUSED (invented) |
| t2a2 | 2 | (rephrase) kidnap Varro | kidnapping, method clipped, groundwork used (+1 ease) | — | sent | turn 3: Varro seized and carried to Oridin | LANDED |
| t2b | 2 | Pellith re-tasked by name: seduce Chancellor Vance | seduction | — | sent | turn 5: affair proven, dossier filed | LANDED |
| t3a | 3 | Move the prisoner Varro to Shalka | **admitted as an ordinary act**, industry DC 10 | — | rolled (crit) | resolution emitted `consume_asset` on Varro (an interrogation, which removed the notable from play and filed a dossier), then `create_asset` of a new generic "prisoners" record named Varro, and a second dossier | **BROKEN** |
| t3b | 3 | Spring a named Drajk captive at Threx | inadmissible: no such captive on the board | no | — | nothing; no AP | REFUSED (on a fact) |
| t3c | 3 | (rephrase) Dovic springs the captive | inadmissible: no such captive; also "ghosts excel at… not at taking and holding people" | **no** | — | nothing; no AP | REFUSED (fact + class claim) |
| t3d | 3 | Kill Chancellor Scaeva and pin it on Drajk | inadmissible: "the incitement of war is not yours to declare" | no | — | nothing; no AP | REFUSED (invented) |
| t4a | 4 | Rhuun: kidnap Scaeva posing as a courier | kidnapping | — | sent | turn 5: operative exposed and taken | FAILED on tick |
| t4b | 4 | Dovic: larceny of the Imperial drawings, original | larceny, method dearer (88 = 70 × 1.25) | — | sent | turn 5: drawings moved from the Vigil to the Combine at Oridin | LANDED |
| t5a | 5 | Fleet to Vantic and Dovic re-tasked to surveillance | surveillance | — | sent | **`issue_order` left out with the note**; surveillance came to nothing on turn 6 | FAILED on tick (guard held) |
| t5b | 5 | Tellumen re-tasked by name to subversion at Sekkar | subversion | — | sent | turn 6: taken | FAILED on tick |
| t6a | 6 | Move the prisoner Naso from Shalka to Riqel | **admitted as an ordinary act**, guile DC 10 | — | rolled (crit) | a `courier` order and a new dossier ("Naso's confession"); the prisoner asset never moved (still at Shalka) | **BROKEN** |
| t6b | 6 | Dovic (a ghost): assassinate Scaeva by sabotaging the lift | first ruling refused on class | **yes** | **rolled** (partial) | the retry's ruling had no `covert` entry, so the act was rolled; resolution placed the assassin itself and added `adjust_disposition` −10; turn 7: taken | FAILED, guard bypassed |
| t7a | 7 | Recruit two more | admissible, guile DC 10 | — | **rolled** | on the books at Oridin | LANDED |
| t7b | 7 | Ulvik: night porter at the chancellery, aimed at Scaeva | groundwork, ease | — | sent | tells from turn 9 | LANDED (gw) |
| t8a | 8 | Zevric: seduce Governor Gannet at Var Hollow | seduction | — | sent | turn 9: found out and expelled (the world joined Meridian that turn) | FAILED on tick |
| t9a | 9 | Ulvik: kill Scaeva and leave Drajk cant (two outcomes) | assassination + discord | — | sent | discord **rejected**: "one operative takes one order at a time"; assassination used the groundwork and failed on turn 10 | FAILED on tick |

## The four guards

1. **Invented refusals retried — held where it matched, missed three shapes.** It fired once (t6b, class) and the retry
   admitted the act. It did not fire on t2a ("groundwork cannot be used in the order that completes it" — false: it was laid
   on turn 0 and told from turn 2), t3c (a class claim phrased "ghosts excel at… not at", which the pattern does not catch;
   the refusal also cited a real board fact, so it would likely have stood), or t3d ("not yours to declare" for a discord,
   which is exactly what discord is for). **"No mission does that yet" never appeared**: the two prisoner moves (t3a, t6a) —
   the design's own example of an unexpressed act — were admitted as ordinary rolled actions.
2. **Covert work sent, not rolled — held every time the arbiter ruled the act covert** (11 declarations, every one `check:
   null`, binding `sent`, the operative's own roll deciding on the tick). **Bypassed once**: on t6b the retried ruling
   carried no `covert` entry, so the act took the rolled path and resolution emitted the `deploy_agent` itself.
3. **Covert sends carry only the sending — held.** t5a's fleet movement was left out with the note. No covert batch moved
   credits other than the mission's price times the method step. The one invented consequence (t6b, `adjust_disposition`
   −10) came through the bypass in 2.
4. **The advisor question — held, with one slip.** Three questions, each answered in prose in the Combine's voice with no
   enumeration, each one action. The plan-shaped question (taking Vantic) was answered with what holds it and what it would
   cost, not a plan. The third answer said "that was turn five" (the fourth wall) and attributed motives to Meridian and the
   Vigil that the state does not show. A bare `/advisor` was not run (out of actions).

## Findings, ranked

1. **A prisoner move destroyed a notable (t3a).** Moving a held person is unexpressed by design, but the arbiter admitted it
   as an ordinary act, and resolution wrote the move as `consume_asset` (which interrogates and removes the person) plus
   `create_asset` of a new generic prisoner. The real notable record is gone, the Combine holds a fake prisoner with no
   `notableId`, and two dossiers were minted. t6a did the same in a milder form: a courier order and an invented dossier,
   while the prisoner never moved.
2. **The send-only path depends on the arbiter writing `covert`.** When it does not (t6b), resolution can still place an
   operative on the rolled path and add consequences. The guard should key on what the batch does — a `deploy_agent` or
   `lay_groundwork` in the ops — not only on the ruling.
3. **Unexpressed acts are admitted instead of turned away**, so the log that is meant to decide the next mission records
   nothing, and the acts reach resolution, which improvises (finding 1).
4. **Three invented refusal shapes the code does not catch**: a false groundwork-timing rule, "not yours to declare", and a
   class claim phrased as "excels at". Previous run's "requires consent" and "act of war" did not recur.
5. **A two-outcome act by one operative cannot land both parts.** The design doc says "kill the governor and blame Drajk" is
   assassination plus discord; the reducer's one-order-per-operative rule rejects the second, so the act needs two
   operatives. The doc and the rule disagree.

Also seen, not new:
- **Recruiting is still rolled** (a1, t7a): both succeeded, but a recruit can fail its check and spend the action.
- **A burned operative keeps its mission and reports "burned and out of contact" every turn**: Rhuun from turn 6 to the
  end, Tellumen from turn 7, Zevric from turn 10.
- Re-tasking by name worked three times (t2b, t5a, t5b); the "cannot be reassigned" refusal did not recur.
