# Bug-finding playtest, 2026-10-29 (second round of the loop)

Four turns as the Meridian Trade Authority (`bughunt9`): a partial force sent
to stand guard over Ithaal as a new fleet (the rule the first round put to the
user), a stipend, a marriage with Arkane made twice, a ghost off the Lists sent
to skim Vantic, a bounty on the Vigil, a fortification that came in partial, an
ultimatum to Drajk and a fleet recalled by name.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** The marriage failed whole: Arkane's persona put the groom's notable id in `assets`, the transfer built from the record was refused, and nothing landed. | `transfersFromRecord` skips an id that is a notable, officer or operative; the persona prompt says a person is not a thing. Signed again, it landed. |
| 2 | **Serious.** The Vigil's reaction opened "a Meridian ghost settles into Torrek Anchorage": a recruitment's account was in the summary every responder reads. | `recruit_agent` and `recall_agent` make a batch secret, as a send does. |
| 3 | **Serious.** An ultimatum declared on its own was ruled, rolled a critical success, and left out: the ruling forgot the `coercion` reach. | A demand, ultimatum, blackmail or publication in the words stamps `coercion`, as a call-in stamps `their_paper`. |
| 4 | An arbiter call the watchdog abandoned at 180s ran 542s: the teardown waited on the hung process. | The teardown waits `TEARDOWN_GRACE_MS` (5s) at most. |
| 5 | "prizes taken from it and hulls of its destroyed are paid for" | "whoever takes its prizes or destroys its hulls is paid." |
| 6 | "A partial result: the Hardening Torrek Anchorage delivers 1 rather than 3." | A label is quoted: `"Hardening Torrek Anchorage" delivers`. |

## Noted, not fixed

- **A bounty was priced influence DC 10 and came in partial**, where the prompt
  says posting one is `trivial`.
- **Gendered words for a generated notable**: Arkane's persona called Joran
  Dustborn "a son", and the accord's narrative "predecease him" survived
  because the sentence also names the Highwarden, whose pronouns are on the
  sheet.
- **A diplomacy call took 916s for 17s of API time**, which reads as the
  machine sleeping mid-call rather than a hang.
