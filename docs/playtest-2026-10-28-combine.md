# Bug-finding playtest, 2026-10-28 (fifth)

Four turns as the Ojjul Nar Combine (`bughunt7`): an operative off the Lists,
the delinquent Drajk debt sold to Meridian, a watcher sent to Vantic, an
ultimatum to Arkane for basing rights, Drajk's dark raid traced and turned into
a blackmail hook, and the hook called in to bring Drajk behind the ultimatum.
The ultimatum ran out into war with Drajk on the Combine's side.

## Fixed

| | found | fix |
|---|---|---|
| 1 | **Serious.** "Call in the hook we hold over Drajk" was sent to a channel with Drajk, though calling in a favour needs nobody's agreement. | When the act names a favour and the arbiter rules it a negotiation with a power that owes the actor one, it is put back once with the favour named. |
| 2 | **Serious.** Ruled again, the call itself was left out: `call_obligation` reaches the debtor's paper and the ruling did not name the reach. | A call-in is stamped `reaches: their_paper` in code; the prompt says so too. |
| 3 | Rejection messages named powers by id ("meridian has no ships at …", "the fleets of vigil") at some forty sites, and the player reads every one. | `reject` puts every bare faction id as the power's name, possessive included. |
| 4 | A debt sold across the table landed with no note and a log line of raw ids. | Named, and noted. |
| 5 | The persona put the debt's id where a favour goes, and the player was told "No favour 'debt-0' to give up" about a sale that landed. | A debt id in that field is skipped; the persona prompt says a debt is not a favour. |

## Noted, not fixed

- **A counteroffer the player never answered was, correctly, not agreed** — but
  the channel closing on it is the only signal; nothing says "they countered
  at 50" until the narrative.
- **Some rejection messages quote raw system ids** ("has no ships at tor-1").
