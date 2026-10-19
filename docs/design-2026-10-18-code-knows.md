# What code knows, code decides

The architectural findings of `docs/audit-2026-10-18.md`, designed. Each one
has the same shape: **the engine holds a fact, and a model is asked to say it
again.**

| finding | what code already knows | what a model is asked instead |
|---|---|---|
| 1. lines read acts | that this batch breaks treaty `tre-0-3`, signs a written treaty, forgives a debt | whether the prose sounds like a breach |
| 2–3. accords from the record | the ids each power wrote down as it conceded | the transfers, re-read from the transcript |
| 4. ops as ruled | which parts the arbiter ruled before the roll | any op in the vocabulary, as a flourish |
| 5. narrate what landed | which ops were rejected, dropped or trimmed | a story written before the verdict |
| 6. prize worth | the world the prize came from, and the band | a quantity and a price per unit |

CLAUDE.md states the rule these break, at `classifyPrinciple`: *the model is
good at judgement and unreliable at lookup*. Each section below moves a lookup
from a model to code, and leaves the model the judgement that remains.

Two decisions close the document (§7, §8), and one limit is left alone (§9).

---

## 1. A line reads the acts it forbids (B4, C10, C11)

### What happened

- **B4.** Meridian's red line *"will not repudiate a contract it has signed"*
  refused *"repudiate the pact, then take Kalzir"*, at +8 dissent. The next
  turn, *"15 battleships sail to take Kalzir"* came back with
  `breaks: "tre-0-3"`, the pact was broken on arrival, and the line was never
  consulted.
- **C11.** Drajk's *"will not put its name to a written treaty"* signed a
  public `contract` with commission terms. The persona said, in its own words,
  that it wrote nothing down.
- **C10.** The Vigil's *"will not accept payment to stand down"* sold a
  non-aggression pact for 300.

The arbiter rules on breaches from prose, before the roll. That ordering is
right: a ruling made with the roll in hand is a verdict. But the ops are not
known until resolution writes them, after the roll, and nothing reads them
against the sheet. CLAUDE.md already records that whether a breach is spotted
at all is unstable: *"code guarantees that a naming is classified correctly,
not that the naming happens."*

### The design

**A line names the acts it forbids, at seed time.** `Compulsion.barsPeaceWith`
is the precedent: the Vigil's *"no accommodation with pirates, smugglers or the
Nars"* names its targets in prose, and only the seed can say them as ids. Red
lines become objects the way compulsions did, through a preprocess, so every
save still loads:

```ts
const PrincipleActsSchema = z.object({
  /** Acts this line forbids, which code detects. Empty: judgement only. */
  forbids: z.array(ActKindSchema).default([]),
  /** Restricts an act to these counterparties, as `barsPeaceWith` does. */
  with: z.array(z.string()).optional(),
});
// redLines: string[]  →  RedLine = { text } & PrincipleActs
// Compulsion gains the same two fields; `barsPeaceWith` becomes
// { forbids: ['peace_signed'], with: [...] }.
```

**The reducer reports the acts a batch commits.** `ApplyResult` gains
`acts: Act[]`, written beside `chargeBreach` and at the op cases below. The
reducer already decides each of these and logs most of them. Nothing in the
world changes, so no journal version is needed.

```ts
interface Act { kind: ActKind; actor: string; with: string[]; opIndex: number }
```

| act | written where | detected from |
|---|---|---|
| the ten `BreachKind`s | `chargeBreach` | as now |
| `pact_attack_ordered` | `issue_order`, movement | target held by a power the actor is bound to in peace, or `breaks` named |
| `blockade_ordered` · `raid_ordered` | `issue_order` | category |
| `treaty_signed` | `form_treaty` | each party, with the other as `with` |
| `peace_signed` | `form_treaty`, `call_obligation: sign` | a type in `PEACE_TREATIES` |
| `debt_forgiven` | `forgive_debt` | the creditor |
| `tribute_paid` | a `tribute` treaty, or conceding a tribute ultimatum | the payer |
| `territory_ceded` | `cedeTerritory` | the ceder |
| `basing_granted` | a `basing_rights` treaty | the host |
| `protection_accepted` | a `contract` naming the actor in `terms.protection` | the protected |
| `invasion_launched` | `issue_order`, movement with lift aboard | a target another power holds |
| `defence_pledged` | `shipsPledged` on a defence pact or coalition | the pledger |
| `person_trafficked` | the trafficking charge | the seller |
| `gift_given` | `gift` | the giver |
| `paid_for_peace` · `given_for_nothing` | the engine, from the whole accord | below |

The last two are facts about the whole accord, so the engine reads them from
the batch and the concession record rather than the reducer from one op:
credits to the actor beside a peace with the payer, or concessions by the actor
and none by the other party.

**The seeded lines, tagged.** The tags below were read off the sheets. There
are 23 lines: 16 take tags, 5 are already code-checked by a trigger, and 2 stay
judgement alone.

| power | line | forbids |
|---|---|---|
| Meridian | R0 *will not close a lane* | `blockade_ordered` |
| | R1 *will not repudiate a contract* | `treaty_repudiated`, `marriage_repudiated`, `pact_attack_ordered`, `loan_defaulted`, `favour_repudiated`, `commitment_walked` |
| | C0 *commerce raiding is refused* | `raid_ordered` |
| | C1 *trafficking … refused* | `person_trafficked` (narcotics and weapons stay judgement) |
| | C2 *unprofitable quarter* | trigger, as now |
| Iron Vigil | R0 *will not accept payment to stand down* | `paid_for_peace` |
| | R1 *will not recognise a rebel government* | judgement |
| | C0, C1 | triggers, as now |
| | C2 *no accommodation with pirates, smugglers or the Nars* | `treaty_signed`, `peace_signed` with `drajk`, `ojjul` |
| | C3 *will not turn pirate* | `raid_ordered` |
| Ojjul Nar | R0 *will not spend Combine hulls on a war of conquest* | `invasion_launched` |
| | R1 *will not forgive an unpaid debt* | `debt_forgiven` |
| | C0 *nothing given away for nothing* | `gift_given`, `given_for_nothing` |
| | C1 | trigger, as now |
| Arkane | R0 *will never accept occupation or a protectorate* | `protection_accepted` (occupation stays judgement) |
| | R1 *will not sell out another free world* | judgement |
| | C0 *the councils require consultation* | `territory_ceded`, `basing_granted` |
| | C1 *tribute is refused* | `tribute_paid` |
| | C2 *does not prey on shipping* | `raid_ordered` |
| Drajk | R0 *will not hold a defensive line* | `defence_pledged` |
| | R1 *will not put its name to a written treaty* | `treaty_signed` — see the decision below |
| | C0 | trigger, as now |

### How a hit is answered, path by path

The check runs after the ops are known and before anything is staged: a dry
run of `applyOps` on the preview, reading `acts`. **Code reads these acts, so
nothing can argue them back into existence.** The reason the arbiter rules
before the roll does not apply.

| path | a red line | a compulsion |
|---|---|---|
| declared | refused as an arbiter red line is: `REFUSAL_DISSENT`, nothing staged, the refusal card naming the line. The action point is spent, as any refusal's is | `COMPULSION_BREACH_DISSENT`, the ops land; skipped when the arbiter already charged the same line |
| reaction | the offending ops are held back, by `opIndex`, and shown as held back, as `honourTreaties` does | charged on the engine path, as a counterparty's breach is |
| bot | held back (`honourLines`, a post-filter in `proposeFor` beside `honourTreaties`; replaces the `barsPeaceWith` reads) | held back too: a doctrine bot does not defy its own sheet, the decision `barsPeaceWith` already made |
| accord, the player's | refuses the whole accord, as now | charged, as now |
| accord, the counterparty's | `COUNTERPARTY_BREACH_DISSENT.red_line`, a price and not a veto, as now | `COUNTERPARTY_BREACH_DISSENT.compulsion` |

**The arbiter keeps every line**, tagged or not. It still rules from the prose
before the roll; a tagged line simply cannot be missed afterwards. A line that
is both named by the arbiter and hit by an act is charged once.

**The personas are told.** `serializePrinciples` prints each line's `forbids`,
so a persona that is about to sign what its sheet forbids knows the price
before it agrees.

### Decision: is a letter of marque a written treaty?

Drajk's R1 forbids `treaty_signed`. The bots currently sign two kinds of
treaty with Drajk: **letters of marque** (`contract`, ten in 100 harness turns)
and **ceasefires** (from turn 38, many of them with the Combine). Tagging the
line as written stops both, and will move the board.

- **(a) Honour the sheet.** A Drajk arrangement is a handshake: a peace or a
  commission becomes a `Commitment` binding both parties, private and
  deniable, which is what the sheet describes. This needs a peace that a
  commitment can carry: the `kind: 'peace'` slug read by `warsFor`.
- **(b) Narrow the line** to public treaties. A `contract` is not "a written
  treaty" for this purpose. Then the C11 instance stands as legitimate.
- **Recommendation: (a)**, measured over the four harness boards before it
  ships. The line is the faction's identity, and (b) defines it away.

### Cost and replay

No model calls are added: the check is a dry run. `ApplyResult.acts` is
output only. Refusals and charges are journaled as ops, as they are now. A
bot's withheld op is absent from its journaled batch, so replay is exact
without a version. The bots' board will move: Drajk's marque, the Vigil's
peace with the Combine. Measure all four boards, and gate the change on
`tests/balance.test.ts`.

---

## 2–3. An accord is built from the record, and lands whole (C4, C7, C8)

### What happened

- **The NPC's half of a barter was dropped.** Ojjul conceded crates of
  luxuries (`ast-2-0`, later `ast-7-0`). Extraction moved only Meridian's half,
  writing *"the Combine will dispatch these on its own turn"*.
- **Buying an existing asset minted a duplicate.** The Vigil conceded its
  drawings (`ast-0-1`). Extraction minted a new dossier for 500 and the Vigil
  kept the original.
- **Half a bargain landed.** A toll lift was refused while the 400 paid for it
  went through, in two channels. The 2026-10-15 playtest found the same
  shape: a marriage dropped as bigamous while the toll lift given for it
  stood.

Each persona records what it concedes, as it speaks, **resolved to ids**:
worlds, credits, a flow, hulls, assets, favours. Extraction then re-reads the
transcript and writes the transfers again from prose, and
`groundInConcessions` checks its work against the record. The band-aid shows
extraction the record. It still writes the transfers, so it can still write
them wrong. The correction pass can still drop the leg that failed and keep
the leg that paid for it.

### The design: the record is the deal

**The engine builds every transfer the record names.** Extraction no longer
writes them.

| concession field | the op the engine writes |
|---|---|
| `credits` | `pay`, `by` → the other party |
| `assets` | `transfer_asset` of each id → the other party |
| `obligations` | `release_obligation` when the favour's debtor is the other party; otherwise `assign_obligation` to them |
| `systems` | a `cession` treaty, `by` the ceder, with no duration |
| `lifts` *(new)* | `set_toll_policy` for `by`: its current targets less these, for `liftTurns` when given |
| `perTurn` · `hulls` | **stay extraction's**: a flow needs a type (tribute, contract or debt) and hulls a shape (a loan or a pledge), which are judgement. Grounded against the record, as now |

**Extraction's job becomes two judgements:**

1. **Which recorded concessions were agreed.** `accepted: string[]`, keyed
   `by:kind`. A term on the table and a term agreed are different things, and
   deciding which is reading the conversation. This was always extraction's
   real work.
2. **The terms with no field.** Treaty types and their conditions (`voidsOn`,
   `exclusive`, `ratifyTurns`), commitments, debts, loans, favours owed, a
   concession of an ultimatum, the narrative. Ops of the kinds in the first
   table are dropped from its output with a note: *"the record writes this"*.

**An accord lands whole, or not at all.** The batch is already atomic. What
breaks it is the correction pass, which may rewrite the batch smaller. So:

- **Built ops are never handed to the correction call.** Rejection of one — a
  ward that may not be transferred, a world no longer held — cannot be repaired
  by rewording, so the accord fails with the reducer's reason.
- **A correction of extracted ops may change fields, never remove an op.** The
  engine compares op kinds before and after; a correction that is shorter
  fails the accord.
- **A failed accord says so** in its transcript (the existing `record` line),
  so neither persona goes on believing it.

One accord, one bargain, by default. Splitting an accord into independent
bargains that stand or fall separately is deferred: none of the 18 accords in
the playtest needed it, and whole-accord atomicity is what the parties
believe they agreed.

### Schema and prompt changes

- `ConcessionSchema` gains `lifts: string[]` and `liftTurns?: number`.
- `ExtractionOutputSchema` gains `accepted`. Its op vocabulary loses `pay`,
  `transfer_asset`, `release_obligation`, `assign_obligation`,
  `set_toll_policy`, and `terms.territory` / `terms.payment` on `form_treaty`.
- `extraction.md`: rewritten around the two judgements.
- `diplomacy-persona.md`: the record now IS the deal, so a persona must write
  down both sides' terms. The player's side is already recorded, with the
  channel panel showing it live.

### Risks

- **A persona that fails to record the player's own payment** leaves the
  player's side unpaid. The panel shows the record as it is written, which is
  where the player catches it. `accepted` naming a concession the record lacks
  is dropped with a note.
- **Fewer accords land** while extraction learns the new contract. Measure:
  accords closed against accords landed, in the trace.

### Replay

The ops are journaled as before, and the reducer is unchanged. `groundInConcessions`
shrinks to the two fields extraction still writes. No journal version.

---

## 4. A declaration produces what was ruled (D3, the B7 class)

### What happened

A critical success on an attack wrote `interrupt_order` on the Vigil's relief
fleet, and eight battleships went home with no battle fought. Resolution is
told to add *"one concrete bonus"* on a critical, and it holds the whole
declared vocabulary: **60 op kinds**. Four filters each close one of them
(`sendsAsRuled`, `prizesAsRuled`, `swaysAsRolled`, `commitmentsAsRuled`), and
the band-aid closed fleets for `interrupt_order`. Still reachable as a
flourish:

- an `interrupt_order` on a rival's programme;
- `extend_order` or `accelerate_order` on anyone's order;
- `break_treaty`;
- `issue_ultimatum`, `post_bounty`;
- `publish_dossier`, `blackmail`.

### The design: what reaches another power must be ruled

Ruling every op family on every act would make the arbiter under-name, and a
dropped fortification is a worse failure than a flourish. So the rule is drawn
where the damage is: **ops that reach another power**, and nothing else.

| reach | ops |
|---|---|
| `their_orders` | `interrupt_order`, `extend_order`, `accelerate_order` on another power's order |
| `their_ships` | `suborn_crews` |
| `their_paper` | `break_treaty`, `repudiate_obligation`, `repudiate_loan`, `call_obligation` |
| `coercion` | `issue_ultimatum`, `back_ultimatum`, `post_bounty`, `publish_dossier`, `blackmail` |

Giving another power money or a thing is not on the list: it costs only the
giver, and the giver asked for it.

The overt part names its reach (`reaches: Reach[]`, default empty), as it
names its `yields`. `opsAsRuled` drops any reaching op the ruling did not name,
with the note the other filters give. It joins `holdToRuling`, so a correction
is held to it too. A power's own business — building, moving, works, its own
orders, its court — passes unruled, as it does now.

**The critical bonus becomes a closed menu, priced in code.** Resolution names
one in `bonus`, and the engine applies it:

| bonus | what it is |
|---|---|
| `cost_avoided` | a quarter of what the declaration spent comes back |
| `tempo` | one of the declaration's own new orders drops a duration bucket |
| `goodwill` | `SWAY_BY_BAND.partial` with the power most involved |
| `windfall` | one more unit of a ruled `yields` |

The prompt's *"one concrete bonus"* becomes *"name one from this list"*. The
narrative may describe the bonus however it likes; the engine decides what it
does.

### Risks and measurement

An under-named reach drops a legitimate op. The note says so, and the player
re-declares. Measure the reaching ops dropped per declaration over a
playtest; if it passes one in twenty, loosen the defaults. The four existing
filters stay, because each stamps as well as filters.

No journal version: the filter runs before staging.

---

## 5. Narrate what landed (D4)

### What happened

Resolution writes the story and the ops in one call, and the reducer's verdict
comes afterwards. **11 of the playtest's 22 resolved declarations** ended
with a story that said more than landed: 3 with rejected ops, 2 with ops a
ruling filter dropped, 7 trimmed by the engine.

The band-aid writes a correction's note onto the batch. Anything that does not
read that note still believes the first story: the turn's reactions, the
player's feed and the log.

### The design: a reconcile pass, only when they differ

After staging, the engine knows whether the story and the result agree.
Something diverged if:

- the final batch carried a rejection;
- `holdToRuling` dropped an op;
- a reducer note trimmed, clamped or refused something;
- a correction landed.

**Only then**, one call on the flavour tier rewrites the narrative from:

- the draft;
- the ops that landed;
- the notes.

The guard `flavourKeepsTheFacts` already applies to the Rim's lines, and it
applies here: no number the landed ops and notes do not contain.

| | |
|---|---|
| fires on | about half of declarations (11 of 22 measured) |
| costs | the event-flavour call's size: about 2s and $0.002 each, so about 2–3s added to one action in two and a few cents a campaign |
| writes | the outcome's narrative, the staged batch's narrative (which the reactions read), and the `log_narrative` it rides on |
| replaces | `amendLastNarrative` and the `Correction:` notes |

Always narrating after the reducer is the cleaner shape, and it costs a second
reasoning-tier call on every action. Reconciling only on divergence is the
price-proportionate version. The same pass applies to an accord whose ops were
trimmed or partly refused.

**The epilogue is a separate slip.** It told *"the Board never once had to
overrule its own officers"* despite a refusal, because the dossier carries no
refusals. Add `refusals` and `defiances` to each slide's facts.

No journal version: narratives are not state.

---

## 6. A prize's worth is set in code (B7)

### What happened

*"Freighters skim Neth's gas giant"* was ruled to yield helium-3. Resolution
wrote 15 tons at 8 each, which sold for 120; the same skim five turns later
was 12 at 12, and sold for 130. `yields` fixes the **kind** before the roll.
The **amount** and the **worth** are still the model's, and the catalogue
deliberately carries no numbers (*"never a number: the board decides that"*).
Nothing on the board decided.

### The design

- **Worth from the world.** A prize's total worth is
  `PRIZE_TURNS × the income of the world it came from`, by band: half on a
  partial, whole on a success, half again on a critical. Neth at strategic
  value 3 pays about 21 a turn, so at `PRIZE_TURNS` 3 a successful skim is
  worth about 63, against the 120 the model chose.
- **Who wants it stays judgement.** Resolution names the powers that would
  pay (`wantedBy`). The engine sets each at the worth, and the holder at none
  for stuff it took to sell. `quantity` stays the model's, as flavour, and
  `valuePerUnit` is the worth divided by it.
- **A seam rests.** A world yields the same kind once every
  `PRIZE_REST_TURNS`. The playtest skimmed Neth on turns 3 and 8.
- **Applied in `prizesAsRuled`**, which already stamps the kind. Only the
  declared path can create a prize from a check (`OP_PATHS`), so one site
  covers every case. No journal version.

`PRIZE_TURNS` and `PRIZE_REST_TURNS` are set by a played campaign rather than
the harness: the bots create no prizes. Start at 3 and 4.

---

## 7. Decision: a charter's income needs a source (B5)

A declared charter ruled `income` pays its own power up to
`MAX_COMMITMENT_INCOME` (25) a turn, to a ceiling of 50 for Meridian, from
nowhere, for one action each. It is within the caps by design. It is the one
standing income a ruling, rather than a mechanism, creates.

- **(a) Accept it as priced.** Two actions for 50 a turn.
- **(b) Charter it on a world.** A declared `income` commitment names the world
  it is chartered on, and pays a quarter of that world's income, read in
  `ledgerFor`. Lose the world and the charter pays nothing. This is the
  asset rule, *"a thing that pays must sit somewhere it can be taken"*, applied
  to the last income that did not.
- **(c) Retire declared income.** A charter is a `record`, and money comes from
  fixtures and lanes.

**Recommendation: (b).** It keeps the act a player reaches for and gives its
money a hostage. It needs `Commitment.atSystemId` and a journal version: a
change to the ledger replays differently.

## 8. Decision: what an accord's warmth costs (C9)

Since intent-ops §3 a declaration's regard is rolled (`sway`) and a reaction's
is priced (`regard`). An accord still narrates `adjust_disposition`, capped at
25 a pair a batch and kept out of a treaty's own goodwill. Channels are
unmetered, so warmth costs a conversation:

- a flattery-only channel: +2 and +1;
- a toll confirmation: +4 and +2;
- the drawings sale: +8 and +8.

- **(a) Leave it.** The cap bounds it.
- **(b) Price it.** An accord writes `regard` from the closed list. A deal
  kept is `promise_kept` (+5) and `deference` (+3), once per pair per accord.
  A conversation that agreed nothing moves nothing.
- **(c) Only paper warms.** Treaty and commitment goodwill, and nothing else.

**Recommendation: (b).** It is the vocabulary the other two paths already
speak, and it ends the conversation-only pump. It changes `OP_PATHS` for
`adjust_disposition`, so older accords must replay under a journal version.

## 9. Not proposed: hull identity (B2's limit)

The B2 band-aid stops a move out of any world the batch just landed on,
including hulls that were standing there already, because a stack carries no
hull identity. Giving hulls an identity would let a fleet carry a movement
budget, and it would touch every stack accessor, the save format and the
exchange. The band-aid's over-reach costs a turn on a rare second move; that
is not worth the rewrite.

---

## Order of work

| step | sections | journal version | moves the harness |
|---|---|---|---|
| 1 | 2–3, accords from the record | no | no (bots make no accords through extraction) |
| 2 | 1, lines read acts | no | **yes**: Drajk's marque and peace, by decision |
| 3 | 4, ops as ruled | no | no |
| 4 | 6, prize worth | no | no |
| 5 | 5, reconcile pass | no | no |
| 6 | 7 and 8, if taken | yes, one flag each | no |

**Accords first**, because both playtests found their worst diplomacy bugs
there, and the change is contained to `closeChannel`, the extraction contract
and two schemas. **Lines second**, because it moves the board and needs the
decision on Drajk. The rest are small and independent.

**Each step ends with:**

- the suite;
- the three typechecks;
- byte-identical replay of every save;
- the four harness boards;
- a playtest of the step's own surface, read off the trace: for step 1,
  accords landed against closed; for step 3, reaching ops dropped; for step 5,
  reconciles fired.
