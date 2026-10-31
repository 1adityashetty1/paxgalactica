# Bug-finding playtest, 2026-10-29 (fourth round of the loop)

Four turns as the Arkane Free Worlds (`bughunt11`): a hospital at Vashka
refused and then rolled on the right stat, an envoy to Neth, a coalition with
Meridian against the Vigil bought with the note of sanctuary, a stipend to the
Sentinels, an agitator off the Lists sent to stir the Vigil's new occupation
of Threx, a picket over Neth and a levy on full barracks.

## Fixed

| | found | fix |
|---|---|---|
| 1 | "Raise a hospital at Vashka" was ruled an industry check, rolled a critical success, and the hospital refused for not being a resolve undertaking; the action was spent on nothing. | A fixture the words name is rolled on its own primary attribute, looked up in `ASSET_ARCHETYPES`. Retried live, it rolled resolve. |
| 2 | "this was a industry undertaking" | "an industry undertaking", and the kind without underscores. |
| 3 | "university at Vantic completed at Vantic" in fourteen completion lines. | `doneAt` (in `words.ts`) leaves out a place the label already names; the scan now catches the shape. |
| 4 | "the world is no longer meridian's and the levy dispersed" | "the world has changed hands and the levy dispersed." |

## Noted, not fixed

- **A coalition's trigger is free text.** Meridian agreed to answer "only a
  Vigil move against Arkane Prime and Delvane", and the narrative says so; the
  pact answers an attack on any of a member's worlds.
- **A levy on full barracks was rolled and spent the action**, though the full
  barracks could be read before the roll.
