# Bug hunt 2026-10-29: the noted items, fixed

The five rounds of 2026-10-29 left items under "Noted, not fixed". These are
closed:

| | found (round) | fix |
|---|---|---|
| 1 | A coalition agreed "only for Arkane Prime and Delvane" answered an attack on any member world; the limit lived in `mutualDefenseTrigger`'s prose (Arkane). | `terms.defends` names the worlds a defence pact or coalition answers for; the call to arms skips any other. Refused unless each world is a party's. Extraction is told to fill it. |
| 2 | A levy on full barracks was rolled and spent the action (Arkane). | Turned away before the roll as already so, which costs no action, when every world the words name is full. |
| 3 | A bounty was priced influence DC 10 and came in partial (Meridian). | A bounty is priced `trivial` in code. |
| 4 | An ultimatum's story told the target's answer the turn it was issued, and the reactions believed it (Combine). | `resolution.md`: narrate the act, not another power's answer to it. |
| 5 | Resolution narratives counted turns: "by turn three" (Drajk, Meridian). | `resolution.md`: no turn numbers in a narrative. |
| 6 | "took blueprints from Vantic and carried it to Oridin" (Combine). | "carried them" for a plural kind. |

Still open, as model behaviour rather than a rule: a persona forgetting terms
it agreed in a refused accord (Vigil), gendered nouns for a generated notable
("a son", and "him" in a sentence that also names a leader, which the pronoun
pass leaves alone) (Meridian), and a crate taken "against the arrears" while
the debt stood unchanged (Drajk). Items 4 and 5 are prompt changes and are
not yet verified live.
