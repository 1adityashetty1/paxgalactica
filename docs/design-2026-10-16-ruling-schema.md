# Closing identity and conservation, keeping expression open

Draft for review, revised 2026-10-16. Follows `docs/playtest-2026-10-16-arbiter-guards.md` and must not undo
`docs/design-2026-10-16-operations.md`: the operative is the player's hand in the world, and the point of the last commit was
that a player can describe almost anything and have it reach the state.

## The problem

The guards built after the held-out playtest worked where they applied and leaked where the schema let them. The last run
had two broken outcomes, one guard bypass and four invented refusals:

| bug | what the schema allowed |
|---|---|
| t3a: "move the prisoner" destroyed a notable and minted a fake prisoner and two dossiers | `consume_asset` on a person interrogates them; `create_asset` can mint a person who already has a record |
| t6a: a prisoner "moved" by a courier order that moved nothing, and a dossier from nowhere | there is no verb for moving a holding, so one was improvised |
| t6b: an assassination was rolled, and resolution placed the assassin itself and added −10 standing | the retried ruling omitted `covert`; resolution may emit `deploy_agent` and a raw `adjust_disposition` |
| t2a, t3c, t3d: a false groundwork rule, a class claim, "not yours to declare" | a refusal's reason is free text, and `refusals.ts` pattern-matches it after the fact |

A first draft of this doc answered with narrower vocabularies: one kind of act per declaration, resolution reduced to
narration for covert work, no named people from a model, `consume_asset` replaced by interrogation alone. Each of those is
safe, and each takes something away from the player:

| first-draft proposal | what it cost |
|---|---|
| one kind per declaration | "sail the fleet to Vantic and slip Rhuun ashore under its cover" became two actions (the code already drops the fleet half, t5a) |
| covert resolution emits nothing | "take the drawings and burn the archive behind me" lost its second half |
| no named people from a model | a defector who walks out with the codes, or an informant bought on the docks, could not exist |
| interrogation as the only fate | releasing a prisoner, or executing one, had no verb |

This revision keeps the safety and gives those back.

## The principle

**Close identity, authority, conservation and refusal. Leave expression open.**

Every bug above broke one of four invariants, and none of them needs the player's vocabulary to shrink:

1. **Identity.** A record with an id — a person, an operative, an officer, a world's control — is created and ended by the
   reducer alone. (t3a)
2. **Authority.** Each kind of op has a set of callers that may emit it. A resolution call does not send operatives; the
   ruling does. (t6b)
3. **Conservation.** Money, standing and holdings move through a mechanism that prices them, never as a free-standing number
   attached to a covert act. (t6b's −10)
4. **Refusal.** An act is refused only for a fact code can check on the board. (t2a, t3c, t3d)

What stays open, deliberately:

- **How it is done.** Methods are already scored on four axes, not listed. Nothing here touches them.
- **What a thing is.** Non-person asset kinds stay open slugs anchored by `ASSET_ARCHETYPES`.
- **How many things one act does.** A declaration is as many parts as the player said.
- **Who is new.** A new informant, defector or hostage can be named into the world, as long as nobody already has that name.
- **The story.** Narration is free, and nothing in the reducer reads it.

## 1. A declaration is a list of parts, each a typed choice

Today the ruling is `admissible` plus optional `covert`, `groundwork`, `unexpressed`, `negotiation`, `establishes` and
`breach`, and code infers the kind of act from which fields are present. The arbiter can omit the one that matters.

Proposed: the ruling carries `parts`, a list, and each part is a discriminated union with a required `kind`.

```ts
type Part =
  | { kind: 'overt';       what: string; stat: StatName; difficulty: number; establishes?: Establishes }
  | { kind: 'covert';      agent?: string; mission: AgentMission; systemId: string; target?: string;
                           method?: Method; riders?: Rider[] }
  | { kind: 'groundwork';  agent?: string; systemId: string; text: string; axis: MethodAxis; target?: string }
  | { kind: 'unexpressed'; outcome: string };

type Ruling =
  | { kind: 'act';          parts: Part[]; breach?: Breach }      // 1+ parts
  | { kind: 'negotiation';  withFactionIds: string[]; what: string; supported: boolean }
  | { kind: 'inadmissible'; ground: RefusalGround; reason: string }; // see 2
```

- **Every part is one tagged branch**, so the arbiter cannot leave a part unclassified. A covert act ruled without its covert
  part is no longer a possible answer.
- **Hybrids are back.** Overt parts share one roll and resolve as an ordinary action; covert parts are sent and roll on the
  tick; groundwork is laid; unexpressed parts are logged. "Sail the fleet and land Rhuun under its cover" is one action with an
  overt part and a covert part.
- **An unexpressed part does not block the others.** A declaration of only unexpressed parts is turned away at no action, as
  now; one with other parts goes ahead and records the missing outcome.
- **A breach is ruled once, on the whole act**, and a red line still refuses before anything is rolled or sent.
- **Code checks one thing it can see:** an `overt` part whose words name one of the actor's own operatives is sent back once
  with the outcome table (open question 4 is whether to match words or have the arbiter list the operatives involved).

### Riders: one operative, more than one outcome

"Kill the governor and pin it on Drajk" and "take the drawings and burn the archive behind me" are one operative doing two
things on one order. Two covert parts naming the same operative would break the one-order-per-operative rule, which exists for
a good reason (a send must not be silently replaced by another in the same batch). So a covert part may carry **riders**:
secondary outcomes on the same order.

- A rider names an outcome from the same table (discord, sabotage, larceny of a second thing on the same world).
- It is **priced at its own mission's cost and adds its own exposure** to the order: a rider makes the act dearer and louder,
  never free.
- It resolves on the tick **only if the primary succeeds**, since the frame needs the killing and the fire needs the theft.
- At most one rider per part, so an order cannot become a list of everything an operative might do.

## 2. A refusal names a ground code can check; everything else is admitted or unexpressed

An `inadmissible` ruling requires a `ground` from a closed list, each carrying what code needs to verify it:

| ground | carries | code checks |
|---|---|---|
| `no_such_entity` | `name`, `kind` (person, world, thing, power) | the name resolves to nothing of that kind |
| `not_present` | `who`, `systemId` | that power has no ships, operative or holding there (an operative's travel never counts) |
| `not_held` | `assetId` or `name` | the actor does not hold it |
| `commitment_conflict` | `commitmentId` or `treatyId` | the record exists, is live and binds the actor |
| `already_so` | the record it names | the thing asked for is already true |

**When in doubt, never refuse.** If the arbiter cannot cite one of these, the act is admitted as parts, and whatever no
mission produces is an `unexpressed` part. Even "teleport the fleet to Vantic" is unexpressed — logged, costing nothing, with
a line saying why — rather than a reason the arbiter made up. A refusal is the one outcome that gives the player nothing back,
so it is reserved for facts.

- **A ground that fails its check** is sent back once with what failed. A second failure is read as `unexpressed`, with the
  arbiter's own words as the outcome.
- **The reason stays** as the sentence the player reads. It is narration; code no longer reads it.
- **`refusals.ts`'s patterns stay one release as a backstop**, then go: a typed ground leaves them nothing to catch.

## 3. Authority: who may emit which op

The first draft gave each call an allowlist. This revision narrows only the ops that touch the invariants, and leaves every
other op open to every caller that has it today.

| op | who may emit it | why |
|---|---|---|
| `deploy_agent`, `lay_groundwork`, `recall_agent` | the engine, from a ruling's parts; reactions and bots | an operative is sent because the arbiter ruled a covert part, never because resolution decided to (t6b) |
| a person's fate (see 4) | the engine, from a ruled part; reactions; extraction (a ransom) | ending a record is an act with a price |
| `create_asset` naming a person on a roster | nobody | that person already has a record (t3a) |
| `transfer_control` | the reducer | unchanged |
| `adjust_disposition`, `adjust_credits` | resolution only for **overt** parts, under today's caps | a covert part's consequences come from its mission on the tick: exposure, the discord rate, the prize. A raw number beside a covert send double-charges a mechanism that already prices it (t6b) |

Everything else — `log_narrative`, `create_asset` of a thing, `establish_commitment`, orders, fleet movements for an overt
part — is open as it is now. **The "yes, and" of a covert act lives in its parts and riders**, which the arbiter writes and
the engine prices, not in improvised side effects.

**Every refused op names its route.** When an op is dropped for authority, the note says what would express it: "standing
changes for a covert act come from its exposure; to sour them openly, declare it" — so the player is never told no without a
pointer to the yes.

## 4. People: one record per person, and a fate is a choice

`PEOPLE_KINDS` today are `prisoners`, `officer`, `operative`, `hostage` and `defector`. Officers, operatives and notables
already have roster records, and when one is held their asset carries the record's id.

**Creating a person.** `create_asset` of a people kind is allowed, with one rule: **a named individual must not match anyone
on a roster** — a notable, officer or operative, living, listed, held or dead. The name is resolved with the same matcher the
knife uses (`resolveCommander`'s rules, extended to notables and operatives). A match is refused with the record it matched,
so the act can be pointed at the real person. A new informant, a defector who walks out with the codes, a hostage taken off a
liner: all still creatable, each given an id like any other asset. Anonymous hauls (`prisoners` as crews, with a quantity) are
unchanged.

**A person's fate.** `consume_asset` on a person interrogates them, as a side effect of a generic verb — which is how a move
became a destruction. Proposed: `consume_asset` refuses people, and their fate is one explicit op:

```ts
{ op: 'decide_fate', assetId, fate: 'interrogate' | 'release' | 'execute' | 'relocate', toSystemId? }
```

| fate | does | priced by |
|---|---|---|
| `interrogate` | today's interrogation: a dossier at `INTERROGATION_SHARE` | `INTERROGATION_RESENTMENT` with their power |
| `release` | sent home: a roster person back on their power's Lists, a minor person gone | `REPATRIATION_GOODWILL` when they are someone's |
| `execute` | the person is dead; a roster record is marked so | a resentment above interrogation's, with their power, and a reputation cost with onlookers |
| `relocate` | moved to another world the holder holds, by a path the holder holds (see 5) | free: it is your own prisoner, inside your own space |

More fates than today, each one named, so a model that means "move" can no longer write "destroy". Ransom and sale stay where
they are, as `transfer_asset` and `terms.assets`.

## 5. Small verbs, so nothing gets improvised

- **`relocate_asset`**: move a portable thing or person you hold between two of your worlds, along a path through your own
  space. Reducer-checked, unrolled. The two prisoner moves in the last run are exactly this. Moving one through or into
  someone else's space stays `unexpressed` until there is a mission for it (extraction, in the operations doc).
- **The `unexpressed` log is a backlog with an owner.** Each entry is either built or recorded as a deliberate gap, and the
  playtest report counts them.

## 6. Missions carry their effects

`deploy_agent` becomes a union keyed on `mission`, each variant listing the effects it may carry, so the JSON schema in every
prompt shows the legal pairs. `MISSION_EFFECTS` does this today as a reducer check for three missions; the type covers all
eleven. This narrows nothing a player can say — the effect is the engine's reading of the mission, not the player's choice.

## 7. The advisor's fourth wall is a refine

`AdvisorReplySchema` already rejects enumeration with `looksLikeAPlan`. A second refine rejects game terms its prompt already
forbids: "turn N", "action point", "DC", "d20". Shape, not meaning.

## Determinism

Nothing here makes the reducer read prose. The model chooses tags and fills fields; code checks the fields against the board
and prices them; the journal records the ops. Replay never sees the arbiter's reasons or the narration.

- 1, 2, 3 and 7 change model calls and the engine's routing only. The journal records ops, so replay is untouched.
- 4, 5 and 6 change what the reducer accepts: `decide_fate`, `relocate_asset`, the roster-name rule on `create_asset`, and
  the mission union. They are pinned to the next `JOURNAL_VERSION` through `LegacyRules`. An old `consume_asset` on a person
  keeps interrogating, so old journals replay as played.

## Proving it did not cost freedom

Freedom is measured, not argued. The acceptance test is a playtest that re-runs every act from the last two reports
(`operations-heldout` and `arbiter-guards`), row by row, and holds this change to:

1. **Nothing that landed stops landing.** The nine landed acts land again, with the same outcome in state.
2. **Every refusal cites a checked ground.** No refusal without one.
3. **Every broken row is fixed or unexpressed.** No story-state disagreement.
4. **The hybrids land.** At least: a fleet movement with a covert landing, an assassination with a frame rider, a theft with
   a sabotage rider, a prisoner relocated, a prisoner released, a named informant created.

A version that is safer and lands less is a regression.

## What each change would have caught

| bug | 1 parts | 2 grounds | 3 authority | 4 people | 5 relocate |
|---|---|---|---|---|---|
| t3a notable destroyed, fake prisoner | | | | ✓ | ✓ |
| t6a prisoner moved by a courier order | ✓ (must classify) | | | ✓ (`relocate`) | ✓ |
| t6b rolled assassination, invented −10 | ✓ (covert part required) | | ✓ | | |
| t2a, t3c, t3d invented refusals | | ✓ | | | |
| t5a fleet half dropped | ✓ (hybrid) | | | | |
| t9a frame dropped | ✓ (rider) | | | | |

## Open questions

1. **Rider limits.** One rider per part, and only when the primary succeeds: is "only if the primary succeeds" right for every
   pairing, or should a frame land even if the killing fails?
2. **The execution price.** How far above interrogation, and does executing a roster person end their record or leave it
   marked dead (as a fallen officer's is)?
3. **Name matching for new people.** Exact full-name match only, or the knife's looser matcher, which could refuse a new
   "Galba" because an officer carries the family name? Family names are already unique per campaign, so the looser match is
   probably right.
4. **Overt parts that name an operative.** Match the act's words against the actor's roster (cheap, loose), or have the
   arbiter list the operatives each part involves and check that list (exact, one more field)?

## Order of work

1. Authority (3) and people (4): the roster-name rule, `decide_fate`, and covert sends written only by the engine. Closes both
   broken outcomes and the t6b leak.
2. Parts (1), with riders, and the appraisal prompt rewritten around the part table.
3. `relocate_asset` (5).
4. Refusal grounds (2), then retire the patterns in `refusals.ts`.
5. Typed missions (6) and the advisor refine (7).
6. The acceptance playtest above.
