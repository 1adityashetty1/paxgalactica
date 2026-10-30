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
| 4 | **Asked, and decided by the user: everything that sails is a fleet.** Drajk's reaction wrote `fleet: 1st Pack` with four battleships and four torpedo boats, and six and six sailed, leaving Vergesse empty; "six battleships and five escorts at Gorrun Deep" took the fleet's lifters too. | Journal version 35: a force smaller than the fleet it names is split off it, and a force naming no fleet is formed into one (whole fleets merged into the senior, the rest split off), free, keeping its identity where it lands. The bots' massing still rejoins the senior fleet. |
| 3 | "Sabotage on Threx: Drajk Confederacy loses 4 fleet strength." | "loses 4 hulls". |
| 5 | The gate tried to replay the playtest's own session snapshot (`saves/bughunt8-session.json`). | `*-session.json` is skipped. |

## Noted, not fixed

- **An ultimatum was priced at might DC 16** where the prompt says to price the
  nerve, failed, and its logged narrative said the demand was issued; the
  reactions then answered an ultimatum that does not exist.
- **Meridian's persona forgot it had agreed forty a turn** in the refused
  accord, and refused the same terms at fifty.
