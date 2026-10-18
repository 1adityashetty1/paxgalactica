# Intent ops: what else the model should say instead of compute

`adjust_ships` was retired in journal version 23 because one op carried five
acts: build, move, suborn, scuttle, and a casualty nobody fought. The reducer
guessed which act was meant from the sign and the owner. A wrong guess sank an
atomic batch: a move came back refused as suborning. The fix was to give each
act its own op and keep the arithmetic in the reducer.

This document applies the same test to the rest of `ModelOpSchema`:

> **Could two different acts be written as this op?** If so, the reducer is
> inferring, and a wrong inference is either a refused batch or a free effect.

Counts are for model-written ops in the 11 saved campaigns on this machine.
Bot batches (`initiative`) and engine batches are left out. Columns are
declared actions, reactions and accords.

| op | total | declared | reaction | accord |
|---|---|---|---|---|
| `log_narrative` | 389 | 267 | 93 | 29 |
| `adjust_disposition` | 310 | 63 | 195 | 52 |
| `issue_order` | 268 | 63 | 205 | — |
| `deploy_agent` | 82 | 19 | 63 | — |
| `adjust_credits` | 78 | 48 | 14 | 16 |
| `spawn_event` | 39 | 37 | 1 | 1 |
| `adjust_dissent` | 30 | 28 | 2 | — |
| `establish_commitment` | 23 | 14 | — | 9 |
| `create_asset` | 9 | 9 | — | — |

`log_narrative` is a record, and `deploy_agent` already carries a mission, a
method and a class. Everything else in the table fails the test. Ranked by how
much the reducer infers multiplied by how often the op is written:

## 1. `issue_order` → one op per kind of work

**Today.** One op carries fourteen order categories, an optional `onComplete`
payload, and a duration the model estimates (1, 2, 3 or 5 turns). The reducer
infers the act from the category plus the payload:

- `commissionCategory` re-files a ship programme by its hull (item 121);
- `boundPayloadsToOutcome` strips a payload;
- `EFFECT_CATEGORIES` refuses a payload on the wrong category.

**What it costs.**

- **Orders that complete and do nothing.** Of the 111 non-movement orders in
  the saves that are not raids, 31 carried nothing (raids and the 8 payload-less
  counter-intelligence sweeps are left out, because the reducer reads both live
  while they run):
  - political manoeuvre 8, fortification 7, courier 7, espionage 4;
  - refit 2, decree 1, infrastructure 1, garrison 1.

  Each one completed and changed nothing. This is playtest 2026-10-15 §C: an
  envoy order with no `court` payload "completed doing nothing".
- **Unrequested work.** B5: one envoy declaration staged a payload-less
  political manoeuvre, a fleet movement nobody asked for, and a stipend.
- **Categories whose real mechanism lives elsewhere.** `espionage` is
  `deploy_agent`, and `treaty_ratification` is `form_treaty.ratifyTurns`. A
  model that writes the category gets an order and no effect.

**Proposed.** One op for each piece of work that does something:

| intent | today | the reducer decides |
|---|---|---|
| `fortify { systemId, magnitude }` | `fortification` + `fortify` | category, floor, price, visibility |
| `raise_garrison { systemId, magnitude }` | `garrison_raising` + `raise_garrison` | the same |
| `develop { systemId, magnitude }` | `construction_infrastructure` + `develop_system` | the same, priced by `developmentCost` |
| `commission { systemId, hull, count }` | three categories + `commission_ships` | the category, from the hull — `commissionCategory` stops being a correction |
| `found_fixture { systemId, kind }` / `repair_fixture` | as now | the same |
| `send_envoy { systemId }` | `political_maneuver` + `court` | the same |
| `blockade` / `raid { systemId, dark? }` | as now | as now |
| `sweep { systemId }` | `counter_intelligence` | read live, as now |
| `fleet_movement` | — | **done in v23**: one jump inside your own territory lands at once |

`courier`, `decree` and bare `political_maneuver` leave the model's vocabulary.
`espionage` and `treaty_ratification` leave it too, since each has a real op
already. An act with no mechanism belongs in `log_narrative`, or in the
arbiter's `unexpressed`. It should not become an order that completes doing
nothing.

**Duration can be derived, not estimated.** For every intent above, the
category floor already decides the duration in practice. The only things a
model estimate adds are a longer wait or a clamp note. Deriving it as the floor
scaled by magnitude would remove the duration rubric from these prompts. This is
optional and its own decision.

**Pin.** Journal version 24, `LegacyRules.workIntents`. `issue_order` stays in
`OpSchema` for old journals and the engine.

## 2. `adjust_credits` → `pay` and `spend`

**Today.** A signed number on any faction. The reducer infers what it means
from the sign, the actor and the rest of the batch:

- a positive amount from a declaration is deferred, and funded from what the
  same batch paid out;
- a debit from a non-actor is refused on the declared path and conserved on the
  accord path (`moveConserved`);
- `MAX_NARRATIVE_CREDITS` caps the batch;
- `refundDuplicateCharges` guesses which charge duplicates a mechanism's bill.

**What it costs**, every item measured and recorded in CLAUDE.md:

- a 60-crate lot "sold" back and forth for about 600 credits minted;
- 1,440 paid for 1,200 credits of hulls;
- a 450-credit settlement that could not be written down;
- seven worlds for 1,200 credits against 13,950 agreed.

Each needed its own inference rule, and each rule exists because the op cannot
say who pays whom for what.

**Proposed.**

- `pay { to, amount, for }`: the actor's credits to a named power, conserved by
  construction. In an accord either party may be the payer, because consent is
  in the transcript.
- `spend { amount, for }`: the actor's credits to nobody. This is the cost of an
  attempt: a bribe to someone off the board, materials, a hire.

No model op credits the actor. Money arrives as somebody else's `pay` or from a
mechanism. The deferral and funding pass goes away. The cap stays on `spend` and
`pay` alike. `refundDuplicateCharges` becomes exact when `for` names an order in
the same batch.

## 3. `adjust_disposition` → a grievance or a gift, priced in code

**Today.** The largest model-written op after narration: 310 in the saves, 208
of them negative, 195 of them in reactions. It is held to the actor's own pair
and to `MAX_NARRATIVE_DISPOSITION` per batch. That bounds the size and says
nothing about the cause. Most hostile acts are already priced in the reducer:
an attack, suborning, piracy, coercion, a broken pact, a bounty. So a reaction
that also narrates −15 for one of those acts is charging the same act twice.

**What it costs.** B11:

- an accord that signed a treaty paid the treaty's goodwill and the narrated
  warmth on top (5 → 17 → 42);
- being blackmailed *raised* regard.

The v22 batch cap fixed the size. Nothing fixes double counting, because the
op cannot say what it is for.

**Proposed.** The model judges *that* something happened, and the reducer looks
up *how much* it is worth. This is the division `classifyPrinciple` already
uses.

- `grievance { against, because }`, with `because` from a closed list: `insult`,
  `threat`, `slight`, `broken_word`. Each is a fixed cost in code. An act the
  reducer already prices is not on the list, so it cannot be charged twice.
- `gift { to, amount }`: a `pay` that buys regard at a published rate.

In an accord, regard comes from treaty and commitment goodwill and nothing
else.

**Risk.** Disposition is the bots' main input: it gates aggression, ranks
grievances, and decides exchanges and coalitions. Removing 195 narrated movements
a campaign will move played boards, not the harness, which never narrates. This
needs a played campaign before and after, read off the trace and the epilogue's
standing table.

## 4. `create_asset` → prizes the ruling names

**Today.** The resolution pass mints a thing on a good band. The reducer bounds
it by outcome, presence and archetype, and refuses a person who already exists
(v22).

**What it costs.** A10: routine court acts at DC 5 produced charts, contraband
and dossiers on a critical success, each sellable. A prize is invented after
the roll, by the pass with every reason to be generous. That is the failure the
arbiter split was built to end.

**Proposed.** The arbiter names what an overt part *could* yield, before the
roll, as `yields` beside `establishes`. The reducer mints only that, sized by
the band, which matches "sends are the ruling's" for covert work. Prizes of a
battle, a larceny or a kidnapping stay the reducer's own. An accord keeps its
one exception, the dossier.

## 5. `establish_commitment` → the typed home when there is one

**Today.** Free-form `kind`. All 23 in the saves are distinct, and most of them
now have a mechanism:

| written as | has a home in |
|---|---|
| `letter_of_marque`, `marque_ratchet` | `contract` with `terms.commission` |
| `indemnity_pact`, `insurance_syndicate`, `claimant_seal_surety` | a contingency |
| `raid_tithe`, `shalka_mark_premium`, `corridor_rate_pact` | `Commitment.share`, a toll policy |
| `free_port`, `trade_route_opened` | `set_toll_policy`, `trade_accord` |
| `territorial_holding` | `cession` |
| `listening_post`, `agent_asset` | a listener hull, an operative |
| `factional_subsidy` | `grant_stipend`, or a `contract` |

That leaves 8 of the 23 as genuinely new institutions: `bill_of_attainder`,
`shalka_judgment`, `bench_impartiality`, `arbitration_compact`,
`claimant_seat`, `compact_repudiation`, `oridin_denial` and `shalka_scrip`.

**Proposed.** The arbiter's `establishes` maps a kind to its typed op through a
lookup table in code, and the resolution emits that op. `establish_commitment`
stays for the residue, where its record and goodwill are the honest whole of
it. A recorded marque that pays nothing is the inert record this project keeps
finding.

## 6. Leave the vocabulary: `spawn_event` and `adjust_dissent`

**`spawn_event`** (39 in the saves, 37 of them in declarations) writes a log line,
which `log_narrative` already does. `markNotesPrivate` scopes only
`log_narrative`, so a `spawn_event` in a secret batch is logged in public. The
engine keeps it for bot rationales and brokered accords. The model loses it.

**`adjust_dissent`** (30, 28 of them in declarations) raises the actor's own
dissent. Every intended source already has a price in code: a refusal (8), a
compulsion breach (15), a doctrine change, the span of control, drift. A
narrated amount on top of an arbiter's breach ruling is the same act charged
twice. If the fallout has no mechanism, it is a breach the arbiter should rule.
The model loses this op.

## Order of work

1. **`spawn_event` and `adjust_dissent`**: removals with no new mechanism, and
   they close a leak.
2. **`issue_order` → work intents**: the most dead orders, and it reuses every
   bound that already exists.
3. **`adjust_credits` → `pay` / `spend`**: removes four inference rules.
4. **`create_asset` → `yields`**: one field on the ruling.
5. **`establish_commitment` routing**: a lookup table.
6. **`adjust_disposition` → `grievance` / `gift`**: last, because it moves played
   boards and needs a played campaign before and after.

Each item gets its own journal version and `LegacyRules` flag. The old op stays
in `OpSchema` so a campaign replays as it was played. Each item ends with the
four harness boards and `pnpm fleetlab` unchanged, or with the change explained.
