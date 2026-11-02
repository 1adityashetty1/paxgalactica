# Bug-finding playtest, 2026-10-28 (second)

Six turns as the Meridian Trade Authority (`bughunt4`), on the build with the
morning's twelve fixes. Aimed at the economic and courtly side: settling a debt,
founding fixtures, an envoy, a marriage, a hired squadron, larceny, a
kidnapping and its ransom, and standing guard then landing.

The marriage, the hire, the larceny, the kidnapping and the ransom all landed as
agreed.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** "Found a factory at Corvid" spent 120 units of the player's salvage, which they never offered. | `spendsAsSaid`: a declaration's `consume_asset` must name the thing, by id or by the words of its kind; otherwise it is left out, and the player is told. |
| 2 | **Serious.** The same factory also created a 12-a-turn income charter for itself. | An income commitment beside work that pays for itself — a fixture, a development, a build, a levy — is dropped. |
| 3 | **Serious.** A server restart stopped the campaign's trace: nothing after it was recorded. | The trace is pointed at the campaign on every restore. |
| 4 | **Serious.** The Combine paid 120 credits to ransom its own governor and was charged dissent for "nothing given away for nothing". The model read the Combine's half of the deal alone. | A line that code reads off the acts is crossed only when the acts cross it. The model's reading of a counterparty's concessions no longer charges on it. |
| 5 | The hired battleships "delivered at Corvid" changed flag at Shalka, and the note said Corvid. | The note says where they change flag and that the borrower sails them; extraction is told to hand them over at the nearest world. |
| 6 | A partial stock exchange: nothing was built, and the story said "it stands". | A partial fixture is noted as unbuilt, which sends the story to be reconciled; resolution is told to narrate it so. |
| 7 | "Land troops on Ithaal" from a squadron of battleships was rolled and narrated as a landing, then took station with no reason given. | When a fleet sails to land with no lifters aboard, a note says so as it sails. |
| 8 | A kidnapping that worked was reported only in the log, headed "[null · Shalka]". | A one-attempt mission's outcome is in the end-of-turn notes, under the mission it was. |
| 9 | Every envoy noted "left out accession_talks", and every recruitment "left out operative_recruitment". | `appraisal.md` no longer asks for an `accession_talks` record (the world's standing is the record); only a dropped income is mentioned to the player. |
| 10 | Arkane's persona wrote in a widow's clause because "you didn't argue it", and extraction logged it as agreed. | Persona: the other side's silence is not agreement. Extraction: an unanswered term is not agreed, and is not narrated as agreed. |
| 11 | A story told ahead of its time ("makes Corvid days ahead") stood when the rewrite was refused. | The fallback appends the timing, as it already did for whose a world is. |
| 12 | Raw ids in log lines: "meridian pays 300 against debt-1", "meridian begins … -> sek-2". Paying off a debt left no note. | Names, and a note for the debt settled. |
| 13 | "2 crate", "6 tonne", "the last of Sorted hull plate … Salvage stock …", and "leaves Shalka for Shalka … already there". | Units pluralised; a spent thing named by its kind; an operative already on site "goes to work". |

## Noted, not fixed

- **Declarations that cannot fail are still rolled**: settling a debt, moving
  your own ships, recruiting off your own Lists. The roll only decides the
  bonus or the bill.
- **Narratives invent mechanics**: Ithaal's council would join "only if a
  fortification programme is funded there first", which nothing in the game
  reads.
- **`tests/fleetlab.test.ts` times out** in the full suite, as on HEAD.
