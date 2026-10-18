# Intent ops: what else the model should say instead of compute

`adjust_ships` was retired in journal version 23 because one op carried five
acts: build, move, suborn, scuttle, and a casualty nobody fought. The reducer
guessed which act was meant from the sign and the owner. A wrong guess sank an
atomic batch: a move came back refused as suborning. The fix was to give each
act its own op and keep the arithmetic in the reducer.

This document applies the same test to the rest of `ModelOpSchema`:

> **Could two different acts be written as this op?** If so, the reducer is
> inferring, and a wrong inference is either a refused batch or a free effect.

Counts are for ops in the 11 saved campaigns on this machine, with bot batches
(`initiative`) left out. The engine stages some ops in batches that a model did
not write, and those are counted separately where it matters.

| op | total | declared | reaction | accord |
|---|---|---|---|---|
| `log_narrative` | 389 | 267 | 93 | 29 |
| `adjust_disposition` | 310 | 63 | 195 | 52 |
| `issue_order` | 268 | 63 | 205 | — |
| `deploy_agent` | 82 | 19 | 63 | — |
| `adjust_credits` | 78 | 48 | 14 | 16 |
| `spawn_event` | 39 | 37 | 1 | 1 |
| `adjust_dissent` | 37 * | 35 | 2 | — |
| `establish_commitment` | 23 | 14 | — | 9 |
| `create_asset` | 9 | 9 | — | — |

\* 27 of the 37 are the engine's own charges, not a model's (§0).

`log_narrative` is a record, and `deploy_agent` already carries a mission, a
method and a class. Everything else in the table fails the test.

## 0. How a removal is done, so it breaks nothing

Version 23 retired `adjust_ships` with a reducer guard: the op is refused from
any `model` or `extraction` batch that has an actor. **That pattern is wrong for
most of what follows**, because the engine and the bots write ops under the same
source:

- **The engine stages its own charges as `adjust_dissent` under `model`, with
  an actor.** That covers a refusal (8), a compulsion defiance (15, appended to
  the resolution's own batch) and an objection to an accord. Of the 37
  `adjust_dissent` ops in the saves, 21 are these charges, and 6 more are
  engine charges under source `engine`. A reducer guard would refuse the 21,
  and red lines and compulsions would cost nothing.
- **Every bot batch is committed under `model`, with an actor and atomically**,
  and the engine appends a `spawn_event` to it carrying the bot's rationale. A
  reducer guard on `spawn_event` would sink every bot turn.
- **Bots write `issue_order` in twelve shapes**: moves, raids, blockades, sweeps,
  envoys, fixtures, repairs and others. Retiring it means converting the bots,
  as version 23 converted their ship buying.

So until §7 is built, the default is a **schema removal**: the op leaves
`ModelOpSchema`, which is what a model's reply is validated against, and stays in
`OpSchema`. The reducer keeps accepting it from the engine, from bots and from
old journals. A reducer guard is added only where the engine and the bots no
longer write the op.

**§7 removes the need for this workaround.** Once every batch carries the path
it came by, the reducer can refuse `adjust_dissent` from a declaration or a
reaction and still accept the engine's own charge. Every item still gets its own
journal version and `LegacyRules` flag.

## 1. `issue_order` → one op per kind of work

**Today.** One op carries fourteen order categories, an optional `onComplete`
payload, a duration the model estimates (1, 2, 3 or 5 turns), and four fields
the model fills in:

| field | set by models on the 132 work orders in the saves |
|---|---|
| `label` | 112 — what the Orders panel and the log call it |
| `onInterrupt` | 38 non-default: 33 `partial` (unspent money refunded) and 5 `persist` |
| `visibility` | 19 — the acting power choosing to be seen |
| `interruptible: false` | 3 |

The reducer infers the act from the category plus the payload:

- `commissionCategory` re-files a ship programme by its hull (item 121);
- `boundPayloadsToOutcome` strips a payload;
- `EFFECT_CATEGORIES` refuses a payload on the wrong category.

**What it costs.**

- **Orders that complete and do nothing.** Of the 111 non-movement orders in
  the saves that are not raids, 31 carried nothing (raids and the 8
  payload-less counter-intelligence sweeps are left out, because the reducer
  reads both live while they run):
  - political manoeuvre 8, fortification 7, courier 7, espionage 4;
  - refit 2, decree 1, infrastructure 1, garrison 1.

  Each one completed and changed nothing. This is playtest 2026-10-15 §C: an
  envoy order with no `court` payload "completed doing nothing".
- **Unrequested work.** B5: one envoy declaration staged a payload-less
  political manoeuvre, a fleet movement nobody asked for, and a stipend.
- **Categories whose real mechanism lives elsewhere.** `espionage` is
  `deploy_agent`, and `treaty_ratification` is `form_treaty.ratifyTurns`.

**Proposed.** One op for each piece of work that does something. **Every one of
them keeps `label`, `onInterrupt`, `interruptible` and `visibility`.** Dropping
them would lose the partial refund 33 orders chose, a power's choice to be seen,
and every order's name.

| intent | today | the reducer decides |
|---|---|---|
| `move { originId, targetId, force?, officers? }` | `issue_order` with `fleet_movement` | whether it lands now or sails (v23's rule, unchanged) |
| `fortify { systemId, magnitude }` | `fortification` + `fortify` | category, floor, price, visibility |
| `raise_garrison { systemId, magnitude }` | `garrison_raising` + `raise_garrison` | the same |
| `develop { systemId, magnitude }` | `construction_infrastructure` + `develop_system` | the same, priced by `developmentCost` |
| `found_fixture { systemId, kind }` / `repair_fixture` | as now | the same |
| `send_envoy { systemId }` | `political_maneuver` + `court` | the same |
| `blockade` / `raid { systemId, dark? }` | as now | as now |
| `sweep { systemId }` | `counter_intelligence` | read live, as now |

**`move` is needed because `issue_order` is leaving.** Version 23's move rule
lives on `issue_order` with type `fleet_movement`, and goes with it.

**Ship programmes are not a second build op.** A `commission` beside
`build_ships` would be two ops for one intent, the shape just folded out of
movement: the model would pick between "lay them down now" and "a programme".
Fold them into `build_ships`, with a `programme: true` flag that makes the work
a hidden, interruptible order paid at issue. The flag says the power wants it
built out of sight; the reducer decides everything else.

**A programme must count against yard capacity.** Today it bypasses
`yardCapacityFor`: up to 12 hulls a programme, delivered in the tick, outside
`billConstruction`'s per-declaration berth cap, and any number of programmes at
once. Count a programme's tonnage against the berths of the declaration that
issues it.

`courier`, `decree` and bare `political_maneuver` leave the model's vocabulary.
`espionage` and `treaty_ratification` leave it too, since each has a real op
already. An act with no mechanism belongs in `log_narrative`, or in the
arbiter's `unexpressed`. It should not become an order that completes doing
nothing.

**One capability is lost, and that is accepted.** A bare covert order is a
rumour to rivals ("something under way at X"), so it can serve as a feint. The
fog's rumours of real programmes remain.

**Durations: derive them per kind, from the floor plus a base where models
disagree with the floor.** In the saves, every category was estimated at or
below its floor (and clamped up to it), with one exception: all 10 envoy orders
were estimated at 2 turns against a floor of 1. Deriving from the floor alone
would make envoys land twice as fast, and standing would move twice as fast with
them. So `send_envoy` takes 2, and every other kind takes its floor scaled by
magnitude. This is optional and its own decision; until then, keep the estimate.

**The bots convert in the same change.** Their twelve `issue_order` shapes
become the ops above. Then a reducer guard can refuse `issue_order` from a
model batch with an actor, as version 23 did for `adjust_ships`. Measure: the
four harness boards and `pnpm fleetlab`.

**Pin.** Journal version 24, `LegacyRules.workIntents`.

## 2. `adjust_credits` → `pay` and `spend`

**Today.** A signed number on any faction. The reducer infers what it means
from the sign, the actor and the rest of the batch:

- a positive amount from a declaration is deferred, and funded from what the
  same batch paid out;
- a debit from a non-actor is refused on the declared path;
- on the accord path, a transfer is conserved by `moveConserved` and is
  **uncapped**: a conserved transfer cannot invent a credit, which is the rule
  `terms.payment` was built on;
- `MAX_NARRATIVE_CREDITS` (240) caps a declaration's money;
- `refundDuplicateCharges` guesses which charge duplicates a mechanism's bill.

**What it costs**, every item measured and recorded in CLAUDE.md:

- a 60-crate lot "sold" back and forth for about 600 credits minted;
- 1,440 paid for 1,200 credits of hulls;
- a 450-credit settlement that could not be written down;
- seven worlds for 1,200 credits against 13,950 agreed.

**Proposed.**

- `pay { to, amount, for }`: credits from the payer to a named power, conserved
  by construction. On the declared path the payer is the actor. In an accord
  either party may pay, because consent is in the transcript.
- `spend { amount, for }`: the actor's credits to nobody. This is the cost of an
  attempt: a bribe to someone off the board, materials, a hire.

**The cap applies to a declaration only.** `MAX_NARRATIVE_CREDITS` bounds a
declaration's `pay` and `spend` together, as it bounds `adjust_credits` today.
An accord's `pay` stays uncapped and conserved. Capping it would bring back
seven worlds for 1,200 credits.

No `pay` or `spend` credits the actor. Money reaches a power through somebody
else's `pay` or through a mechanism. **One mechanism still has a figure a model
chose**: a commitment's `incomePerTurn`, which is held to `MAX_COMMITMENT_INCOME`
and the influence ceiling. Three commitments in the saves invented revenue that
way (`free_port` +20, `compact_repudiation` +20, `shalka_scrip` +25). That
belongs to §5, not here.

The deferral and funding pass goes away. `refundDuplicateCharges` becomes exact
when `for` names an order in the same batch.

## 3. `adjust_disposition` → a regard ruling, priced in code

**Today.** The largest model-written op after narration: 310 in the saves. It is
held to the actor's own pair and to `MAX_NARRATIVE_DISPOSITION` (25) per batch.
That bounds the size and says nothing about the cause. Both directions are
used, and both signs:

| path | whose view moves | warmer | cooler |
|---|---|---|---|
| declared | the target's view of the actor | 12 | 50 |
| declared | the actor's view of the target | — | 1 |
| reaction | the reacting power's own view | 48 | 146 |
| reaction | the other's view of it | 1 | — |
| accord | either side | 41 | 11 |

**What it costs.**

- **B11:** an accord that signed a treaty paid the treaty's goodwill and the
  narrated warmth on top (5 → 17 → 42), and being blackmailed *raised* regard.
- **Double counting.** The reducer already prices most hostile acts: an attack,
  suborning, piracy, coercion, a broken pact, a bounty. A narrated cooling on
  top charges the same act twice. The 50 declared coolings of the target's view
  are mostly that: the fallout of the actor's own act.

**What it must not lose.**

- **The 12 declared warmings are the payoff of an influence check.** Without
  them a successful charm, propaganda or state visit does nothing.
- **The 48 reaction warmings are how an NPC comes to like the player.**
  Disposition has no decay, so a vocabulary that can only cool ratchets the
  galaxy toward war. Disposition is the bots' main input: it gates aggression,
  ranks targets, and decides exchanges and coalitions.

**Proposed.** The model judges *that* something happened and why; the reducer
looks up *how much*. This is the division `classifyPrinciple` already uses.

- `sway { whom }` on a declared action that rolled `influence`. It moves `whom`'s
  view of the actor by an amount set from the band in code: nothing on a
  failure, less on a partial, more on a success. A failure that offended them
  is a `regard` ruling, below.
- `regard { toward, because }` in a reaction. It moves the reacting power's own
  view. `because` comes from a closed list with both signs: `insult`, `threat`,
  `slight` and `promise_broken` on one side; `aid`, `deference` and
  `promise_kept` on the other. Each has a fixed size in code.
  - `promise_broken` and `promise_kept` mean a promise made in conversation and
    recorded nowhere. A broken treaty, loan or favour is already priced, and
    the reducer refuses `regard` when the same batch or the last tick charged
    one between the pair.
  - No reason on the list names an act the reducer prices.
- `gift { to, amount }`: a `pay` that buys regard at a published rate.
- **Accords:** treaty and commitment goodwill as now. A narrated warming lands
  only when the accord signed no treaty between the pair, which is the v22
  rule. A cooling still lands, through `regard`.

**Risk.** This moves played boards and not the harness, because the harness
never narrates. It needs a played campaign before and after, read off the
trace and off the epilogue's standing table, with the share of warming against
cooling compared to the table above.

## 4. `create_asset` → prizes the ruling names

**Today.** The resolution pass mints a thing on a good band. The reducer bounds
it by outcome, presence and archetype, and refuses a person who already exists
(v22). A reaction may create one too, with no check behind it; only fixtures
are refused there.

**What it costs.** A10: routine court acts at DC 5 produced charts, contraband
and dossiers on a critical success, each sellable. A prize is invented after
the roll, by the pass with every reason to be generous.

**Proposed.** The arbiter names what an overt part *could* yield, before the
roll, as `yields` beside `establishes`. The reducer mints only that, sized by
the band, which matches "sends are the ruling's" for covert work. The other
sources of assets are unchanged: larceny, kidnapping, interrogation, a derelict
event and an accord's dossier.

**Two consequences, stated rather than discovered later.**

- **A battle yields no prize under this rule, and none today.** The reducer
  mints captured officers from a battle, and nothing else: crew prisoners and
  salvage come only from the derelict event. An attack's `yields` cannot land at
  resolution either, because the presence guard refuses a prize where the
  attacker does not yet stand. Prisoners from a won battle would be a reducer
  mechanic of their own, and are out of scope.
- **Reactions lose asset creation altogether**, because a reaction has no
  ruling to name a yield. This matches the reason fixtures were taken from
  reactions.

## 5. `establish_commitment` → fill the mechanism, or use the right op

**Today.** Free-form `kind`. All 23 in the saves are distinct. Read against what
each one said:

| | count | kinds | what should have happened |
|---|---|---|---|
| a commitment field left empty | 5 | `indemnity_pact`, `insurance_syndicate`, `claimant_seal_surety` (contingency); `raid_tithe`, `corridor_rate_pact` (share) | the same op, with `contingency` or `share` filled in |
| another op | 4 | `agent_asset` (a bribed dockmaster: an operative), `listening_post` (a listener or a watcher), `trade_route_opened` (freighters sailing), `free_port` (a toll lift, and the rest is residue) | that op |
| a treaty term | 1 | `letter_of_marque` | `contract` with `terms.commission`, in an accord |
| restating the board | 1 | `territorial_holding` ("Meridian holds Ithaal…") | nothing |
| residue | 12 | `marque_ratchet`, `shalka_mark_premium`, `factional_subsidy`, `reputation_campaign`, `arbitration_compact`, `bench_impartiality`, `bill_of_attainder`, `claimant_seat`, `compact_repudiation`, `oridin_denial`, `shalka_judgment`, `shalka_scrip` | a record, as now |

So most of the failure is not a missing op: it is a mechanism the commitment op
already has, left empty.

**Built, and narrowed while building it.** The proposal had the arbiter name
any of `share`, `contingency`, `income` or `record`. But a declared commitment
binds the actor alone, while a share or a contingency needs two parties bound —
so on a declaration only `income` and `record` can work, and a declared act that
needs a share or a contingency is a negotiation. Reading the 23 again by path:

- **Declared (14).** Five carried an income nobody ruled (+20, +20, +25, −20,
  −25), and four should have been another op. The arbiter now names
  `mechanism: income | record`, `commitmentsAsRuled` keeps only the commitment
  it ruled and stamps the mechanism on it, and the reducer refuses a ruled
  income left unwritten and leaves out an unruled one. The arbiter is told
  where the common cases already live: an informant is a covert part, a
  listening post a listener, a free port a toll policy, freighters a move.
- **Accord (9).** The five that left a share or a contingency empty were all
  accords, which the arbiter does not rule. The extraction prompt already
  teaches both fields; the saves may predate them. Nothing more is enforced
  there yet.

**Not a slug lookup.** All 23 slugs are distinct, so a table keyed on `kind`
would match nothing — the closed field on the ruling is what replaced it.

## 6. Out of the model's vocabulary: `spawn_event` and `adjust_dissent`

**`spawn_event`** (37 in declarations, all written by a model) writes a log line,
which `log_narrative` already does. `markNotesPrivate` marks only
`log_narrative` private. So a `spawn_event` in a batch that mixes open and covert
work, or in a reaction that places an operative, is logged in public. Purely
covert batches already drop it (`COVERT_SEND_OPS`). Remove it from
`ModelOpSchema` only: the engine appends one to every bot batch under `model`
(§0).

**`adjust_dissent`**: of the 37 in the saves, 27 are the engine's own charges
(§0), and 10 were written by a model. Those 10 raise the actor's own dissent by a
figure the model chose, on top of prices that live in code: a refusal, a
defiance, a doctrine change, the span of control, drift. If a fallout has no
mechanism, it is a breach the arbiter should rule. Remove it from `ModelOpSchema`
only. The engine goes on staging its charges, and the reducer's up-only,
own-faction rule stays as the guard on them.

## 7. Who may write what: the path a batch came by

**Today the reducer cannot tell the player from an NPC.** A declared action, a
reaction and a bot turn all arrive as source `model` with an actor. The only
thing that tells them apart is a free-text label. They are bounded very
differently before they get there:

| | arbiter, roll, action points | treaty filter | what bounds it |
|---|---|---|---|
| the player's declared action | yes | — | the ruling, the band, two actions a turn |
| an NPC reaction | **no** | **no** | the reducer's guards alone |
| an NPC bot | — | yes (`honourTreaties`) | code, and its post-filters |
| an accord | — | — | consent grounding, `EXTRACTION_ALLOWED` |

That makes a reaction the least-bounded writer in the game.

**Reactions do not honour treaties.** Tested: the Vigil holds a non-aggression
pact with the Combine, and a reaction from the Vigil sends a fleet at Oridin.
The reducer accepts the move, breaks the pact on arrival, and charges the
betrayal: the Combine's view of the Vigil goes from −49 to −74, plus the
reputation cost with every onlooker. A bot would have withheld the attack. The
reaction prompt calls an attack across a truce "legal and the dearest public act
there is", and the prompt is the only thing between a reaction and a betrayal.

**Three ops depend on bounds a reaction does not have.** None of the three
appears in a reaction in the saves yet, so the risk is latent:

- **`lay_groundwork`**: its whole price is the player's action point. For a
  reaction it is free and repeatable.
- **`create_asset`**: the arbiter's ruling and the roll bound it. A reaction can
  mint a prize for itself with no check (§4 is the declared-path fix).
- **`set_doctrine`**: a reaction can rewrite its own power's ethics, paying
  dissent. That is a model editing an authored character sheet mid-campaign.

### Proposed

**1. Tag each batch with its path:** `declared`, `reaction`, `bot`, `accord`,
`engine` or `cheat`. The tag goes on each journal entry and is passed to
`applyOps` beside `source`, which stays as it is. So the twelve existing
`source === 'model'` guards keep covering all three model-driven paths.

- **The engine's own charges go on the `engine` path, in batches of their own.**
  That covers a refusal's dissent, an objection to an accord and a bot's
  rationale line. A defiance charge is appended to the resolution's batch today,
  so it moves into a batch of its own. Otherwise a rule that keeps
  `adjust_dissent` off the `declared` path would refuse the price of every
  compulsion breach (§0).
- **An old journal entry carries no path, and no path rule applies to it.** It
  replays as played, so the rules need no `LegacyRules` flag of their own. The
  entry schema gains the field, which is optional.

**2. Add one table, `OP_PATHS`, in `ops.ts`:** for every op, the paths that may
write it.

- It is typed as a `Record` over every op name, so an op added later does not
  compile until it is given its paths. That is the closed-allowlist argument
  `EXTRACTION_ALLOWED` already makes.
- `EXTRACTION_ALLOWED` becomes the table's accord column.
- It is checked once, at the top of `applyOps`, before the op's case runs. An op
  off its path is rejected as `wrong_path`, with the path named. On the
  declared and reaction paths that rejection feeds the one correction pass, as
  every other rejection does.

**3. The rules for each path:**

| op or act | player (declared) | NPC reaction | NPC bot | accord |
|---|---|---|---|---|
| `lay_groundwork` | ✓ | — | — | — |
| `create_asset` | ✓, bounded by the ruling (§4) | — | — | a dossier only |
| `set_doctrine` | ✓ | — | — | — |
| `adjust_dissent`, `spawn_event` | — (§6) | — | `spawn_event` for the rationale | — |
| attack, blockade or raid on a power bound by a pact, truce, accord or contract | ✓, at the betrayal price | **only if the order names what it breaks** (`breaks`) | withheld, as now | — |
| `adjust_disposition` | the target's view of the actor | the reacting power's own view only | — | as now |
| everything else in `ModelOpSchema` | ✓ | ✓ | ✓ | as now |

**On the treaty row.** A reaction keeps betrayal as a move, but makes it
deliberate. The bot filter is shared rather than restated: `honourTreaties`
moves out of `initiative.ts` into a module both paths read.

- **A reaction's attack, blockade or raid on a bound partner is held back unless
  the order says what it breaks**: a `breaks` field naming the treaty or truce.
  It is held back the way a bot's is, so the rest of the reaction still lands,
  and it is shown on the feed card as held back (`heldBack`), with the reason.
- **The price does not change.** A named betrayal is charged where an attack is
  charged now: on arrival, −25 with the victim, `PACT_BREAKING_REPUTATION_COST`
  (10) with every onlooker, or `TRUCE_BREAKING_REPUTATION_COST` (20) across a
  truce, and heat. The field only proves the reaction meant it.
- **Why not require a `break_treaty` in the same batch.** It would make NPC
  betrayal cheaper than it is now: `break_treaty` costs 25 each way and heat, and
  nothing with onlookers. It also cannot end a truce, which is its own record and
  not a treaty.
- **The filter runs in the engine,** before the reaction commits, rather than as
  a reducer rejection. Batches are atomic, so a reducer rejection would sink the
  whole reaction.

**This turned up a gap that is not about reactions.** Repudiating first and then
attacking is the cheaper betrayal for anyone, the player included: the attack
arrives against a broken pact and the onlooker price is never charged. CLAUDE.md
says breaking a treaty costs "a permanent reputation hit with every onlooker",
and `break_treaty` does not charge one. Either `break_treaty` charges
`PACT_BREAKING_REPUTATION_COST` with onlookers, or a break followed by an attack
on the same party within a turn is charged as the attack's auto-break. That is
its own change, with its own journal pin.

**On the regard row.** The saves already nearly follow it. Of 195 regard
movements in reactions, one moved another power's view of the reacting power;
of 63 in declarations, one moved the actor's own view. The rule makes it
structural. §3's `sway` and `regard` replace the op on these two paths later.

**What reactions keep, deliberately:**

- **No standing ceiling.** A bot will not attack a power it is on good terms with
  outside a war. A reaction answers what the player did this turn, which is the
  point of having one, and the reducer has usually already moved its regard.
- **No action points.** A reaction is one answer per power per turn, three
  powers at most, and that is its pacing.

**Measure:** the four harness boards (bots only, so they should not move), then
a played campaign comparing pacts broken by reactions before and after, read off
the journal's `break_treaty` entries and the auto-break notes.

## Order of work

1. **Paths and `OP_PATHS` (§7)**: everything after it can then use a reducer
   guard keyed on the path, instead of a schema removal. It also closes the
   reaction gaps: treaties, groundwork, prizes and doctrine.
2. **`spawn_event` and `adjust_dissent`**: removals with no new mechanism, and
   they close a leak.
3. **`issue_order` → work intents and `move`**, with the bots converted and
   programmes counted against yard capacity.
4. **`adjust_credits` → `pay` / `spend`**: removes four inference rules; the
   cap stays on declarations only.
5. **`create_asset` → `yields`**: one field on the ruling.
6. **`establish_commitment` → a named mechanism**: one closed field on the
   ruling, and a correction pass.
7. **`adjust_disposition` → `sway`, `regard` and `gift`**: last, because it moves
   played boards and needs a played campaign before and after.

Each item gets its own journal version and `LegacyRules` flag. The old op stays
in `OpSchema` so a campaign replays as it was played. Each item ends with the
four harness boards and `pnpm fleetlab` unchanged, or with the change explained.
