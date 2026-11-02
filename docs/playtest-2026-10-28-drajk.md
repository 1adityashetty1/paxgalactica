# Bug-finding playtest, 2026-10-28 (third)

Two turns as the Drajk Confederacy (`bughunt5`), then a long stop on the turn-1
accord, which surfaced most of what is below. Aimed at what a raider does: a
dark raid, a letter of marque from the Combine, a debt paid down across the
table, a raid on the paymaster, and a yard order.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** A declared raid was charged 15 dissent for breaching "the captains require plunder", the compulsion that demands raids. | A compulsion with a trigger is drift's alone (`enforcedByDrift`): never charged on a declaration, an accord or a counterparty. |
| 2 | **Serious.** The letter of marque was refused under the very red line that names a marque as the most Drajk will sign. | On an accord, a code-tagged line is crossed only by the accord's acts, for the player as for the other party (`lineReadByCode`). |
| 3 | **Serious.** A 120-credit debt paydown cost 240: extraction wrote `settle_debt`, which moves the money, and the record built a `pay` as well. | A settlement comes off the record's payment from that debtor to that creditor. |
| 4 | **Serious.** The Vigil reacted to a private letter of marque against it: every responder reads one summary, and accords were in it. | Accords are kept out of the reaction brief, like secret batches. |
| 5 | The persona put the marque's stipend the wrong way round (the raider paying its paymaster), and it landed. | Refused in the reducer (journal version 34, `marqueStipendToRaider`); the persona prompt says who pays. |
| 6 | A natural 1 on laying down torpedo boats scuttled a freighter. | `scuttle_ships` in a declaration only when the player said scuttle, scrap or strike off; the critical-failure guidance says so. |
| 7 | A raid on the Combine's world, with the Combine as paymaster, was accepted without a word: it can take nothing from the Combine. | A note at issue: only other powers' cargo through the world is taken. |
| 8 | A "windfall" was announced on a raid, whose prize the engine then dropped. | No windfall beside a raid. |
| 9 | "Not as told: Shalka is held by Ojjul Nar Combine" — the story mentioned a "Shalka refit debt" and, elsewhere in the sentence, prizes the Pack "takes". | The taking word must be within a few words of the world, in its clause. |

## Noted, not fixed

- **The persona writes the player's side of the record**, and kept "a quarter
  of every prize" on it after the player refused it in words; only the strike
  button took it off.
- **Personas misstate mechanics** they are not shown: the Combine asked for
  "half of every prize" as a paymaster, which a commission's share cannot be.
