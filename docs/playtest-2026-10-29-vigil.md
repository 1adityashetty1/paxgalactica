# Bug-finding playtest, 2026-10-29 (first round of the loop)

Four turns as the Iron Vigil Remnant (`bughunt8`): an assault on Threx lost
whole to a Drajk fleet that landed beside the defence, a hull hire negotiated
with Meridian twice, a credit loan from the Combine against the escort note, a
wetworker off the Lists sent to sabotage Threx, an ultimatum that failed its
roll, four battleships and two lifters laid down, an Iron Marshal appointed and
a second assault thrown back by Drajk lifters converted to garrison.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** The Vigil's rent for Meridian's hulls was flagged against "will not accept payment to stand down" as it was conceded, and the whole accord was refused at the close — though that line is read off the accord's acts and the Vigil was paying. | The per-message blocker skips a line `lineReadByCode`, as the close already does. |
| 2 | "Requested 23 ships from Vantic but only 11 battleships, 7 escorts, 4 lifters could sail" of a fleet that sailed whole: the officer's courier was counted. | A courier in a move's force is not counted as a ship asked for. |
| 3 | "Sabotage on Threx: Drajk Confederacy loses 4 fleet strength." | "loses 4 hulls". |
| 4 | The gate tried to replay the playtest's own session snapshot (`saves/bughunt8-session.json`). | `*-session.json` is skipped. |

## Noted, not fixed

- **A named fleet sails whole even when a smaller force is written beside it.**
  Drajk's reaction wrote `fleet: 1st Pack` with `force: 4 battleships, 4
  torpedo boats` and 6 and 6 sailed, emptying Vergesse; the player's "six
  battleships and five escorts at Gorrun Deep" was written as the whole fleet
  and took its lifters too. This is the rule as written (`IssueOrderOp.fleet`:
  "`force` is ignored") — put to the user.
- **An ultimatum was priced at might DC 16** where the prompt says to price the
  nerve, failed, and its logged narrative said the demand was issued; the
  reactions then answered an ultimatum that does not exist.
- **Meridian's persona forgot it had agreed forty a turn** in the refused
  accord, and refused the same terms at fifty.
