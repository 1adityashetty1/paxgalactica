# Bug-finding playtest, 2026-10-27

Eight turns as the Ojjul Nar Combine (`bughunt2`), on journal version 31 and then
32, driving the stateless server with `scripts/pt.mjs`. Aimed at what changed
since the last one: standing guard without landing, landing as its own act,
one-ship listener, freighter and courier fleets, envoys, and the counsellor.

The flow the changes were for works end to end: the 3rd House Fleet took
station over Var Hollow without landing, three envoys courted it, and on turn 8
it joined the Combine of its own accord at a standing of 72. The campaign
replays with no rejections.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** "Take station at Hollow Star without landing", a Drajk world the Combine is on good terms with, was fought as an attack and lost a battleship. | Standing guard in another power's orbit needs its basing rights or a war: refused otherwise, and the order spends no action. Journal version 32 (`guardNeedsBasing`). |
| 2 | "Send Ulquine alone to Riqel" was ruled inadmissible: "officers sail with a fleet". | `appraisal.md`: an officer may travel alone, in a courier of their own. |
| 3 | The refusal of a landing told a fleet already standing guard to "take station without landing". | The hint is true either way: a fleet keeping its lifters aboard stands guard and takes nothing. |
| 4 | A second envoy in one order was noted as "Not done, because no mission does it yet". | One order is one act: the note now reads "Not done in this order: a second act, which needs an order of its own". |
| 5 | A "Not as told" correction said the same thing twice. | Each note once. |
| 6 | Merging fleets said in words was rolled and spent an action; from the Fleets tab it is free. | An order that only organises fleets spends no action. |
| 7 | A fleet with no lift arriving over a world nobody holds or orbits was reported as a battle ("commands the orbitals … no troops to land"), and counted on its officer's record. | It takes station. Journal version 32 (`stationAlone`); a world with no garrison is still walked into. |
| 8 | Envoy orders kept noting "left out courtship_progress". | `resolution.md`: a courtship is the envoy, with no commitment beside it. |

Found while fixing: folding a rule into version 31 replayed this campaign under
it after a server restart, and the turn-2 battle dropped out of its history.
Both rule changes are pinned to version 32, and it replays as played.

## Noted, not fixed

- **A failed envoy spent a trade good the player never offered.** Resolution
  wrote `consume_asset` on a crate of Nar luxuries "seized" at Var Hollow. A
  consumed thing is a cost and is allowed on a failure, but nothing ties it to
  what the order put at stake.
- **"1 ships", and "X and Y commands"** in battle notes.
- **The counsellor's facts still slip**: an envoy "costs nothing", and once it
  called sending a Hand to a Drajk world an envoy.
