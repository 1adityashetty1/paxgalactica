# Bug-finding playtest, 2026-10-29 (fifth round of the loop)

Four turns as the Ojjul Nar Combine (`bughunt12`): a ghost off the Lists, three
escorts split into the Shalka Pickets and sent to Vosk Marker, a five-turn toll
lift sold to Meridian for 225 and the line-of-credit note, a theft of the
Vigil's line-of-battle drawings at Vantic (failed, then succeeded), a tribute
ultimatum to Arkane that ran out into war, and an officer given command of the
1st House Fleet.

## Fixed

| | found | fix |
|---|---|---|
| 1 | "Steal the Vigil's line-of-battle drawings" was sent as a copy, which leaves the original with the Vigil. | A theft takes the thing unless the words ask for a copy (`spendsAsSaid`). The retry took the original. |

## Noted, not fixed

- **An ultimatum's story told its answer.** The declaration narrated Arkane
  "blinking first" on the turn the demand was issued; Arkane's reaction then
  spoke of an answer given, and at the deadline it let the ultimatum run out.
- **"took blueprints from Vantic and carried it to Oridin"**: a plural kind with
  a singular pronoun.
