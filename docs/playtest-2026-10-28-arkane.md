# Bug-finding playtest, 2026-10-28 (fourth)

Four turns as the Arkane Free Worlds (`bughunt6`): an envoy, a mutual defence
pact with Meridian bought with the note of sanctuary, an operative recruited
and sent to stir Threx, Tulgarn stormed with a battle line and a lifter sent as
two moves, the seeded prisoners released, and a levy. The pact answered a
Drajk raid on Delvane with Meridian's pledged hulls, and Tulgarn fell.

## Fixed

| | found | fix |
|---|---|---|
| 1 | "Arkane Free Worlds's" in some eighty lines. | `possessive()` in a new leaf, `src/domain/words.ts`, at every site. |
| 2 | Recruiting an agitator off Arkane's own Lists was priced DC 10, failed, and spent the action. | `appraisal.md`: taking someone off your own Lists is `trivial`. Re-tested live at DC 5. |
| 3 | The new "no lifters" note fired on a battle line whose lifter sailed to the same world in the same order. | Checked at the end of the batch, over every move in it. |
| 4 | The same note fired for an NPC reaction's move. | The player's moves only. |
| 5 | The operative "slips through Threx" in the story, seven jumps and two turns out. | The timing check covers operatives the act sent, so the story is reconciled to when they arrive. |
| 6 | "Arkane Free Worlds lets Crews off hulls … at Arkane Prime. go." | Named by count and kind, its own text beside it. |

## Noted, not fixed

- **Anonymous prisoners have no owner.** Twenty-four crews "of the Vigil" were
  released; the haul names nobody, so nobody's regard moved, though the
  narrative said every power noticed.
- **A reaction got its own home wrong**: Drajk called Tulgarn "a world that is
  neither mine nor theirs".
- **A force sent by count is "a detachment"** in a battle report, and pledged
  hulls carry no fleet name.
