# Bug-finding playtest, 2026-10-28

Six turns as the Iron Vigil Remnant (`bughunt3`), driving the stateless server
with `scripts/pt.mjs`. Aimed at what the last one did not reach: war with a
seeded enemy, an ultimatum and its deadline, a bounty, an operative, tolls, and
accords that trade prisoners and paper. The Vigil took Threx and Torrek
Anchorage, signed a ceasefire with Drajk for a captured governor, and bought
the end of the Combine's letter of marque.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** The Vigil paid 150 credits and a set of drawings for the Combine to revoke its letter of marque; the payment landed and the revocation was only narrated. A concession had no way to say "this treaty ends". | `Concession.ends`: treaty ids the conceding power ends, built into `break_treaty` with `factionId` naming it, which only an accord may. Persona and extraction prompts say so. |
| 2 | **Serious.** Meridian let the Vigil's ultimatum run out, and Drajk, which had backed Meridian, was put at war with the Vigil — the turn it signed a ceasefire with the Vigil. | At the deadline a pair bound to peace or a truce is left out of the war, and of the note. Journal version 33 (`peaceHoldsAtDeadline`). |
| 3 | **Serious.** The Combine's tribute ultimatum on the Vigil, war at the deadline, was in the event log alone: not in the briefing, not in the end-of-turn notes. | A **Ultimatums** group on the briefing (`ultimatumLines`): demands made of you, by you, and ones you back. |
| 4 | "Answered by turn 7" came due at the end of turn 6. | The briefing says "within N turns" or "before this turn ends"; the log and the prompts say "before turn N begins"; the Treaties tab says "due this turn". |
| 5 | A reaction whose first try was refused and corrected showed the player "Nothing in this batch was applied" and a raid on Sarsuma the correction had dropped. | The first try's all-or-nothing note goes when the correction lands, and the reaction card shows the ops that landed. |
| 6 | "Move the 1st fleet to Vantic, and hold Threx with the 4th" was noted "not done in this order: a second act" — and both moves landed. | Resolution is told what the ruling left out, and to do nothing for it. |
| 7 | A declaration wrote `regard` and was refused once before its correction: the rule against it sat mid-table and read as "about yourself". | `resolution.md`: never write `regard`, after the table. |
| 8 | Drajk swore off the Vigil's shipping in a ceasefire, and raided Threx the next turn. A ceasefire does not stop raids. | `extraction.md`: a promise not to raid is also a `contract` with `protection`, fee or none. |
| 9 | "takes to their immediately". | The pronoun rewriter reads "her" before an -ly adverb as an object. |
| 10 | Dissent drift named powers by id ("at war with meridian, ojjul"); a fixture finished on a lost world named its holder by id. | Names, or "the power that holds the world now". |
| 11 | "1 lifters", "1 troops", "transport(s)", "X and Y storms", "Meridian breaks off … losing 13 ships between them". | Counts and verbs agree. |
| 12 | A treaty broken in an accord left no line in the notes. | "Treaty broken by …" is noted. |

## Noted, not fixed

- **Narratives drift from facts**: "three jumps toward Tulgarn" for six, Vantic
  called a "granary world", "Brigadier anyone".
- **"and says nothing"** after a rewritten "They mean …": the rewriter agrees
  only the verb after the pronoun.
- **`tests/fleetlab.test.ts` times out** in the full suite (30s) on HEAD as well
  as here; it passes alone.
