# The ruling is a choice, a refusal has grounds, and each call has its own ops

Draft for review, 2026-10-16. Follows `docs/playtest-2026-10-16-arbiter-guards.md`.

## The problem

The arbiter guards built after the held-out playtest worked where they applied and leaked where the schema let them. Every
failure in the last run has the same shape: **a guard reads a field the model may leave out, or trusts a field the model may
fill with anything.**

| bug | what the schema allowed |
|---|---|
| t6b: an assassination was rolled, and resolution placed the assassin itself and added −10 standing | the retried ruling omitted `covert`; resolution's ops include `deploy_agent` |
| t3a, t6a: "move the prisoner" was rolled as an ordinary act | the arbiter never wrote `unexpressed`; nothing made it choose |
| t3a: the move destroyed a notable and minted a fake prisoner and two dossiers | `consume_asset` on a person interrogates them; `create_asset` can mint a named person |
| t2a, t3d, t3c: refusals citing a false groundwork rule, "not yours to declare", a class claim | a refusal's reason is free text; `refusals.ts` pattern-matches it after the fact |
| t9a: "kill and frame" lost its second half | `covert[]` lets two parts share one operative; the reducer allows one order per operative |
| an assassination carried `turn_notable`, another `stat_debuff` | `deploy_agent`'s mission and effect are typed separately |

Pattern-matching the output found three new refusal shapes in one run. A guard that lists the bad answers is always one
answer behind. These changes make the bad answers unrepresentable instead.

## Principles

1. **A model makes a choice, and the schema makes it choose.** An optional field the model can omit is a decision the model
   can skip. Where an answer must be one of several kinds, it is a discriminated union with a required tag.
2. **A model names; code looks up.** The rule `classifyPrinciple` already follows, extended to refusals: the arbiter names
   the fact on the board, code checks the fact exists.
3. **Each call emits only its own ops.** `transfer_control` is reducer-only, and `EXTRACTION_ALLOWED` narrows an accord. The
   same rule now applies to resolution: what it may emit depends on what the arbiter ruled.
4. **Records with identity are minted and destroyed by the reducer alone.** People have roster records with ids. A model
   refers to a person by id or name; it never creates or ends one through a generic op.
5. **A missing verb gets improvised from destructive ones.** Every gap the `unexpressed` log shows is either closed with an
   op, or made impossible to compose.

## 1. The ruling is a discriminated union

Today `AppraisalSchema` is `admissible` plus optional `covert`, `groundwork`, `unexpressed`, `negotiation`, `establishes` and
`breach`, with `stat`/`difficulty` required by a refine on some combinations. The arbiter may write any combination, and code
infers the kind of act from which fields are present.

Proposed: one required `kind`, and each branch requires what it needs.

```ts
type Ruling =
  | { kind: 'overt';        stat: StatName; difficulty: number; rationale: string; establishes?: Establishes; breach?: Breach }
  | { kind: 'covert';       covert: CovertPart[];  groundwork?: never; breach?: Breach }   // 1+ parts
  | { kind: 'groundwork';   groundwork: GroundworkPart[]; breach?: Breach }               // 1+ parts
  | { kind: 'unexpressed';  outcome: string }                                            // no mission produces it
  | { kind: 'negotiation';  withFactionIds: string[]; what: string; supported: boolean }
  | { kind: 'inadmissible'; ground: RefusalGround; reason: string }                       // see 2
```

- **Every answer is one branch**, so "admissible, with no covert field, about an operative" is no longer a possible answer:
  the arbiter has to say `overt` and own it.
- **Code checks the choice where it can.** An `overt` ruling on an act that names one of the actor's own operatives, or uses a
  covert verb the outcome table lists, is sent back once with the outcome table. That check reads the act and the roster,
  both of which code has.
- **Breach rides on the branches that can be attempted.** A red line on any branch still refuses before the roll, as now.
- **Mixed covert and groundwork** (an operative prepares while another acts) stays possible as two declarations; one
  declaration is one kind. That matches what code already does: a covert declaration carries only the sending.
- **Accords** (`appraiseAgreement`) use only `breach`, so they keep a smaller schema of their own.

The old field `admissible: false` maps onto `inadmissible`, `negotiation` onto its branch, and everything else onto `overt`
or `covert`, so the prompt's rules move over branch by branch.

## 2. A refusal names a ground code can check

`inadmissible` requires a `ground` from a closed list, and each ground carries what code needs to verify it:

| ground | carries | code checks |
|---|---|---|
| `no_such_entity` | `name`, `kind` (person, world, thing, power) | the name resolves to nothing of that kind |
| `not_present` | `who`, `systemId` | the power has no ships, operative or holding there |
| `not_held` | `assetId` or `name` | the actor does not hold it |
| `commitment_conflict` | `commitmentId` or `treatyId` | the record exists, is live and binds the actor |
| `already_so` | the record or field it names | the thing asked for is already true |
| `out_of_reach` | `systemId` | no path, or the world is not one the act can touch (an operative's travel is never this) |
| `nobody_to_send` | — | the actor has no operative on the books (code already decides this before the arbiter) |

- **Grounds that are not facts are not in the list.** There is no ground for an operative's class, "there is no mechanic", "it
  belongs in a channel" or "only the target may decide that". A ruling cannot cite them because the type has no slot for them.
- **A ground that fails its check is not a refusal.** It is retried once with what failed; a second failure is read as
  `unexpressed` with the arbiter's own words as the outcome, so it costs no action and is logged.
- **The reason stays**, as the sentence the player reads. It is narration, and code no longer reads it.
- `src/domain/refusals.ts`'s patterns stay as a backstop for one release, then go: with typed grounds they have nothing to
  catch.

## 3. Resolution's ops depend on the ruling

Resolution is handed the whole model vocabulary today. Proposed: a resolution op list per ruling kind, checked in code the way
`EXTRACTION_ALLOWED` is, with what is refused reported in a note.

| ruling | resolution may emit |
|---|---|
| `overt` | the model vocabulary **minus** the covert ops and the people ops below |
| `covert`, `groundwork` | `log_narrative` only; the engine writes the sends from the ruling (today's `routeCovertAction`) |
| `unexpressed`, `negotiation`, `inadmissible` | resolution is not called |

**Covert ops leave resolution entirely.** `deploy_agent`, `lay_groundwork` and `recall_agent` are written by the engine from a
covert or groundwork ruling, and by reactions and the bots, never by resolution. If the arbiter rules an act `overt`, no
operative is sent; the act misses visibly instead of being sent on the rolled path with consequences resolution made up (t6b).

## 4. People are the reducer's to create and to end

`PEOPLE_KINDS` today are `prisoners`, `officer`, `operative`, `hostage` and `defector`. An officer, operative or notable held
as an asset carries the id of their roster record; that is what lets them be ransomed, sent home or interrogated as the person
they are. Two model ops can break that:

- **`create_asset` of a people kind** minted "Gnaeus Varro of the Intelligentsia" as a generic prisoner with no record behind
  it. Proposed: a model may not create an asset of kind `officer` or `operative` at all, nor any people-kind asset that names
  an individual. People enter the warehouse through capture, kidnapping and conquest, all reducer paths. Anonymous hauls stay
  creatable: `prisoners` with a quantity of crews from a won boarding action is still a prize.
- **`consume_asset` on a person** is interrogation, a destructive side effect behind a generic verb, and resolution reached
  for it to mean "take them out of here". Proposed: `consume_asset` refuses people kinds, and interrogation is its own op,
  `interrogate`, with the existing pricing (`INTERROGATION_RESENTMENT`, the dossier at `INTERROGATION_SHARE`). A model that
  means "move" can no longer write "destroy" by accident.

## 5. Small verbs, so nothing gets improvised

**`relocate_asset`**: move a portable thing or person you hold from one of your worlds to another of your worlds. The reducer
checks you hold both ends and that a path exists. No roll, no risk: it is moving your own property inside your own space. The
two prisoner moves in the last run (t3a, t6a) are exactly this. Moving one *through* or *into* someone else's space stays
`unexpressed` until there is a mission for it (extraction, in the operations doc).

The `unexpressed` log is a backlog with an owner: each entry is either built, or recorded as a deliberate gap.

## 6. Missions carry their effects, and a part carries its operative

- **`deploy_agent` becomes a union keyed on `mission`**, each variant listing the effects it may carry. `MISSION_EFFECTS`
  already does this for embezzlement, larceny and kidnapping as a reducer check; the type covers all eleven, so the arbiter
  and resolution both see the legal pairs in the JSON schema in their prompt. An assassination is a strike, so it carries a
  target rather than a free effect.
- **A covert part names its operative**, and two parts in one ruling name different operatives. "Kill and frame" with one
  operative is then one of two things, and this is the open question below.

## 7. The advisor's fourth wall is a refine

`AdvisorReplySchema` already rejects an enumeration with `looksLikeAPlan`. A second refine rejects game terms the prompt
already forbids: "turn N", "action point", "DC", "d20", "roll". Shape, not meaning, for the reason `looksLikeAPlan` gives.

## What each change would have caught

| bug | 1 union | 2 grounds | 3 ops by ruling | 4 people | 5 relocate | 6 typed missions |
|---|---|---|---|---|---|---|
| t6b rolled assassination, invented −10 | ✓ (overt ruling sent back) | | ✓ (no `deploy_agent` from resolution) | | | |
| t3a / t6a prisoner moves rolled | ✓ (must choose) | | | | ✓ | |
| t3a notable destroyed, fake prisoner | | | | ✓ | ✓ | |
| t2a, t3c, t3d invented refusals | | ✓ | | | | |
| mismatched assassination effects | | | | | | ✓ |
| t9a frame dropped | | | | | | ✓ (made explicit) |

## Journal and replay

- 1, 2, 3 and 7 change model calls only. The journal records ops, so replay is untouched.
- 4 (`create_asset` and `consume_asset` refusals), 5 (`relocate_asset`) and 6 (the mission union) change what the reducer
  accepts. They are pinned to the next `JOURNAL_VERSION` through `LegacyRules`, so old journals replay as played. An old
  `consume_asset` on a person keeps interrogating; `interrogate` is new and appears in no old journal.

## Open questions

1. **Two outcomes, one operative.** Allow a covert part a secondary outcome on the same order (a discord rider on an
   assassination, at the rider's price and exposure), or require a second operative? The rider is closer to how players
   phrase it; the second operative needs no new mechanism.
2. **Named hostages and defectors.** These have no roster records. Mint them only through a reducer path (a kidnapping, a
   defection), or leave them creatable but unnamed?
3. **One kind per declaration.** Is splitting "lay groundwork with one operative and act with another" into two declarations
   acceptable, or should `covert` and `groundwork` share a branch?
4. **Where the "overt but names my operative" check lives.** Matching the act's words against the roster is cheap but loose;
   the alternative is to have the arbiter state which operatives the act involves, and check that list instead.

## Order of work

1. Ops by ruling (3) and people as reducer records (4), with `interrogate`. Smallest, and it closes both broken outcomes.
2. The ruling union (1), with the appraisal prompt rewritten branch by branch.
3. `relocate_asset` (5).
4. Typed refusal grounds (2), then retire the patterns in `refusals.ts`.
5. Typed missions (6) and the advisor refine (7).
6. A playtest re-running every act in the guards report, compared row by row.
