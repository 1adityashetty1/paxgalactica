# Playtest 2026-10-26: bug hunt on named fleets

**Setup.** A 10-turn campaign as Meridian (`bughunt`), driven by hand through
`scripts/pt.mjs`. Every turn exercised fleets and their commanders: moves by
name, a detachment, split, merge, rename, assigning and relieving a
commander, an officer travelling alone, a recall, an attack, a battle, an
accord, and a red line. After every step a checker held these invariants:

- each world's `ships` equals the sum of its fleets;
- every fleet is numbered, non-empty and unique;
- every commander is real, present and commands one fleet;
- every officer is in exactly one place.

They held throughout. The campaign replays from its journal.

## Fixed

| | found | fix |
|---|---|---|
| 1 | The arbiter refused a move with "there is no record `flt-meridian-3`". `checkGround` did not know fleets, so a call was spent re-ruling. | A fleet is a thing on the board for `no_such_entity`. A fleet existing does not make a move of it "already so". |
| 2 | Battle reports named a bot's detachment "5th Battle Squadron", a fleet that vanishes into another on arrival. | A detachment is reported as "a detachment". |
| 3 | Resolution sent an officer alone and assigned them a command at the far end in one batch. The assignment was refused while they were under way, which forced a correction call. | `resolution.md`: an officer takes command where they stand, in a later order once arrived. |
| 4 | **Serious.** "Move the Strike Group" was ruled inadmissible as already under way, citing Sorel's solo passage. `already_so` checked only that the cited record existed. | An `already_so` on a voyage needs the actor's own order, carrying ships, for the fleet the action names. `checkGround` takes the action's words. |
| 5 | Voyage label "Strike Group: Strike Group redeploys…". | The fleet's name is not prefixed when the label already says it. |
| 6 | A recall wrote `cancel_order` plus a move of the fleet to the world it was already back at, which sailed a pointless one-turn order. | A named fleet moved to the world it holds is dropped with a note. |
| 7 | A merge declared in words was rolled, and on a partial billed 40 credits of "overtime". The same merge from the Fleets tab is free. | `organisingIsFree` drops a charge beside a declaration that only organises fleets. `appraisal.md` prices organising as trivial. |
| 8 | A Vigil reaction wrote "hold position" as a move from Threx to Threx, which sailed a turn. | A move onto a world the mover already holds is dropped. This applies only to campaigns that keep fleets, and only to writers' batches. |
| 9 | "The works now serve nobody in particular, who holds the world." | The world answers to nobody, and the works serve whoever comes for it. |

## Noted, not fixed

- **Narration overstates.** "The warships multiply" was written of a split. "Nakagawa hands the Home Guard off to Sorel" was written when no command changed hands. No op was wrong.
- **The epilogue misattributes.** Losses at Kalzir were credited to the taking of Sennex, and Meridian was called "a war never joined" after attacking Kalzir. The dossier is right; the prose departs from it.
- **The counsellor invented "frigates".** Left as asked: counsellor mistakes are out of scope.
- **The end-of-turn notes repeated an attempt's failed first batch** ("Nothing in this batch was applied…"). This predates fleets. Fixed afterwards: `commitTurn` journals a batch that lands nothing, so replay reproduces the rejection, and does not say its notes a second time.
