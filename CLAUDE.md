# Pax Galactica

An LLM-driven grand strategy campaign in a lawless outer rim, played in a
browser on localhost. The model narrates and decides; a pure reducer is the only
thing that changes the world.

```bash
./start         # clone-to-playing: Node check, install, sign-in, launch
```

or by hand:

```bash
pnpm install
pnpm login      # once — Claude Pro/Max subscription sign-in
pnpm auth       # confirm it worked (makes one real call)
pnpm play:web   # build, serve on 127.0.0.1:4173, open the browser
```

`./start` is POSIX `sh` rather than Node for one reason: the first check a new
clone needs is "is your Node new enough", and that cannot be written in Node.
Everything after it hands off to pnpm. A second toolchain (a Python venv, say)
would mean installing Python *and* Node *and* pnpm before running a Node app —
strictly more setup to solve a problem Node already solves.

| script | what it does |
|---|---|
| `pnpm play:web` | check auth, build both halves, serve, open the browser |
| `pnpm serve` | server only, no browser — useful with `pnpm dev:web` |
| `pnpm dev:web` | Vite dev server with HMR, proxying `/api` to 4173 |
| `pnpm test` | the suite, with no network |
| `pnpm replay <name>` | rebuild a saved campaign from its journal, no model calls |
| `pnpm resume <file>` | verify an exported `.tar.gz`, install it, and serve it |
| `pnpm balance [turns]` | 5 doctrine bots vs the real reducer, no model calls |
| `pnpm doctor` | full setup check — runtime, deps, binary, auth, port |
| `pnpm typecheck` / `typecheck:web` / `typecheck:tests` | the three tsconfigs — **Vite does not typecheck** |

> An earlier phase shipped an Ink terminal UI. It was retired: it could not run
> headless, so it could never be tested or driven by an agent. Everything below
> the UI layer is unchanged from that design.

---

## The central rule

**The model never rewrites state.** Every model call returns a narrative plus a
list of typed ops. Ops are Zod-validated and applied by `applyOps`, a pure
function. Anything invalid is rejected with a structured error, recorded in the
event log, and fed back to the model for one correction pass — never silently
dropped.

```
player action ──▶ resolution call ──▶ ops ──▶ applyOps ──▶ new state
                                              │
                                              └─ rejections ──▶ correction call
```

---

## Authentication

The game runs on **Claude Pro/Max subscription auth** via the Claude Agent SDK,
which bundles its own Claude Code binary.

`pnpm login` runs **`claude setup-token`**, then stores the subscription token
it prints at `~/.paxgalactica/oauth-token` (mode 0600, outside the repo so it
cannot be committed). Every model call injects it as `CLAUDE_CODE_OAUTH_TOKEN`.

> **Why not `claude auth login`?** It stores its credential in the macOS
> keychain, and on some setups that write silently does nothing: the account
> profile lands in `~/.claude.json` but no credential is saved, so the binary
> reports "not logged in" forever with no visible error and nothing in the
> keychain. The token path is deterministic and keychain-independent.
>
> `CLAUDE_CODE_OAUTH_TOKEN` is **subscription** auth. Do not confuse it with
> `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, which bill an API account.

### API keys are stripped, not refused

`buildAuthEnv()` in `src/model/auth.ts` deletes `ANTHROPIC_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` from the environment handed to the binary, and injects
the stored token. A key exported from a shell profile therefore cannot shadow
the subscription or cause surprise billing — so the game only *notes* it rather
than refusing to start. It used to be a fatal error, which made every fresh
terminal a puzzle for no safety benefit.

### Finding the bundled binary

`resolveClaudeBinary()` in `src/model/binary.ts` resolves in **two steps**:
first `@anthropic-ai/claude-agent-sdk`, then the platform package *from the
SDK's own location*. Under pnpm's strict `node_modules` layout the platform
package is a dependency of the SDK, not of this project, so resolving it
directly from the project root fails — and fails silently, which looks exactly
like being unauthenticated. `scripts/find-binary.mjs` mirrors this for the
standalone scripts.

### Startup guards (`src/preflight.ts`), in order

1. **API key present** — a printed note, not an abort. See above.
2. **No usable subscription auth** — abort, pointing at `pnpm login`. Probed via
   `claude auth status --json` **using `buildAuthEnv()`**, i.e. exactly the
   environment the game will use. Probing with the ambient environment instead
   is how this once reported "ready" on the strength of an API key that the
   game then refused, looping the player between the auth check and launching.
   `loggedIn: true` is not sufficient — `authMethod: "api_key"` is rejected. If
   the probe itself fails the server starts anyway: the real model call will
   produce a truer error than a guess would.

There is no TTY check. Nothing in this project draws to a terminal.

Checking at startup matters. Without it the first sign of trouble is a failed
model call on your first action, which reads like a broken game rather than an
unfinished setup step.

---

## World state

One JSON document, `WorldStateSchema` in `src/domain/state.ts`, Zod-validated on
load and save.

| Field | Shape |
|---|---|
| `factions[]` | `id`, `name`, `displayColor` (ANSI 256), `disposition` (factionId → −100..100), `credits`, `doctrine`, `stats`, `voice`, `warEthic`, `tradeEthic`, `redLines[]`, `compulsions[]`, `dissent`, `buildBias[]` — **no `fleetStrength`; it is derived from ships** |
| `systems[]` | `id`, `name`, `sector`, `coords {x,y}`, `controllerFactionId` (nullable = unaligned), `garrison`, `garrisonMax`, `strategicValue` 0–10, `hyperlaneEdges[]`, `ships` (factionId → count) |
| `pendingOrders[]` | `id`, `factionId`, `type`, `originId`, `targetId`, `durationTurns`, `progress`, `interruptible`, `onInterrupt`, `visibility[]`, `label`, `durationRationale`, `path[]`, `onComplete?`, `investedCredits` |
| `playerFactionId` | string |
| `turn` | integer — an abstract unit. There is no calendar, deliberately. |
| `eventLog[]` | `turn`, `kind`, `factionId`, `text` |

Hyperlanes are **undirected**. `buildAdjacency` unions both endpoints, so an
edge declared on one side only still works.

`onInterrupt` semantics:

- `cancel` — the work is lost entirely.
- `partial` — the work stops but banks what it achieved. A fleet halts where it
  is along its path; estimated work refunds the unspent portion.
- `persist` — the interruption is weathered and the order continues.

---

---

## Ability checks

The player can attempt anything, so the game needs one general way to price
"how likely is this to work". Five stats in `src/domain/checks.ts`, 1–20 on the
D&D curve with the classic modifier:

| stat | covers |
|---|---|
| `might` | fleets, guns, invasions, blockades |
| `guile` | spies, bribes, smuggling, forgery, assassination |
| `industry` | anything that must be built or supplied |
| `influence` | diplomacy, treaties, propaganda, client worlds |
| `resolve` | sieges endured, unrest suppressed, programmes not abandoned |

**The model does not decide whether an action succeeds** — but for a long time
it did, and the reason is worth keeping written down. The roll and the pricing
were one call: the prompt showed the d20 and *then* asked for a difficulty. A
DC chosen with the roll in hand is a verdict, not a difficulty. Any action
could be made to succeed by pricing it at 10 and fail by pricing it at 19, and
nothing in the code prevented it.

Resolution is therefore **three steps, in this order**:

1. **Arbitration** (`appraiseAction`, `prompts/appraisal.md`) — rules on
   admissibility and returns `{ stat, difficulty }`. It is **not told the
   roll**, which is the whole point of separating it.
2. **The roll**, in code: `rollD20`, then `resolveCheck` against
   **`effectiveStats`** — so dissent and hostile `stat_debuff`s actually reach
   the dice. They previously did not: resolution read the base stats, and a
   faction at 100 dissent rolled exactly as well as one whose institutions
   were behind it.
3. **Resolution** — handed the settled outcome and told to narrate it and emit
   ops that match. `OUTCOME_GUIDANCE` in `calls.ts` is the contract between the
   arithmetic and the story: a "failure" that quietly emits the ops the player
   wanted is not a failure.

Same discipline as duration: code owns the number, the prompt owns the
interpretation.

The roll is `rollD20(turn, salt)` — a hash of turn plus a per-action salt,
never `Math.random()`, so replay reproduces every roll exactly.

FNV-1a alone was not enough. Its multiplier is odd, so the low bits stay a
near-deterministic function of the input's low bits — and `% 20` reads exactly
those (20 = 4 × 5). An adversarial playtester found the consequence: padding an
action with **spaces**, which never touches the low five bits, reached only
{1, 5, 9, 13, 17} — five of twenty faces. Any odd-coded character searched all
twenty, so this was never a bias in ordinary play, but it made the die's
uniformity depend on the shape of the input rather than on the hash. A murmur3
finalizer now avalanches the result before anything takes it modulo: every
padding family reaches all 20 faces, and chi-square over 200k rolls is 13.6 on
19 df (uniform; >30.1 would fail at p=0.05). Outcomes
band into critical success / success / partial / failure / critical failure,
with natural 1s and 20s dominating; the partial band exists because most
interesting strategy outcomes are "yes, but".

Every check is written to the event log, so a campaign's luck is auditable.

## The arbiter: actions with no mechanic

The player can attempt anything, so they routinely attempt things the op
vocabulary cannot express — a dynastic marriage, an exclusive charter, a
hostage exchange. Step 1 above is a referee as well as a pricer. It answers
four questions: may this be attempted at all, what does it test, **does it
establish something lasting**, and **does it break one of the acting power's own
principles** (`breach` — see "Who rules on a breach" below).

`admissible: false` ends the action immediately: no roll, no ops, no
resolution call. It is reserved for actions that contradict something already
true, need something that is not there, or are impossible in the fiction —
*not* for "unlikely" (that is difficulty) and not for "out of character", which
is a `breach` ruling on the same call and answered differently: a red line
blocks, a compulsion is priced.

### Commitments are world state, not the arbiter's memory

`src/domain/arbitration.ts`. A commitment is a durable arrangement with no
other home: `{ kind, factionIds, text, exclusive, incomePerTurn }`, stored on
`WorldState`.

The arbiter **rules** that a dynastic marriage is exclusive. The reducer
**enforces** it: `establish_commitment` is rejected with `commitment_conflict`
when a bound faction already holds a live commitment of that `kind`. This is
the load-bearing split. The alternative — describe the history and trust the
model to stay consistent — would allow a marriage with the Nars on turn 3 and,
having forgotten, a second with Meridian on turn 4.

Verified live, with exactly that sequence:

```
turn 3  admissible: true   influence DC 13
        establishes: dynastic_marriage, exclusive
turn 4  admissible: false  "You are already bound by the exclusive dynastic
        marriage to the Ojjul Nar Combine (com-0-0). That marriage must be
        dissolved before you can enter another."
```

`kind` is a lower_snake_case slug because exclusivity is matched on that
string; an inconsistent slug would silently disable the mechanism, so the
schema rejects anything else.

### An arrangement can be worth money

Commitments were economically inert for their entire existence. The readers were
`conflictingCommitment` (exclusivity), `commitmentsOf` (the UI panel) and
`serializeCommitments` (the arbiter's prompt) — **`ledgerFor` never read them**,
so a `mining_operation` commitment appeared on screen, lowered future related
DCs via the accession ratchet, and paid nothing forever.

`incomePerTurn` is now read by `ledgerFor` as `commitmentFlow`: positive for a
charter or a smuggling operation, negative for tribute paid. Two bounds, because
a commitment is the easiest place in the game for a model to invent revenue:

- `MAX_COMMITMENT_INCOME` (25) per arrangement, **trimmed** rather than
  rejected — the arrangement is still real at a smaller number.
- A per-faction ceiling from `maxCommitmentIncomeFor`, derived from `influence`
  the way `maxAgentsFor` derives from guile: Meridian 50, the Nars 40, the Iron
  Vigil at the floor of 10. A trading authority runs charters; a military
  remnant does not. Costs are deliberately uncapped — nothing needs protecting
  from a faction agreeing to pay.

It is read where it is used rather than paid out each tick, for the same reason
agent effects are: a per-turn mutation would compound instead of recurring.

**And an arrangement with no money in it is still worth something.** A
commitment carrying no `incomePerTurn` was entirely inert, and a playtest closed
five accords that each produced exactly one — `open_hand_pact`,
`imperial_recognition`, `debt_service_share`, `intelligence_notice`,
`intel_sharing_drajk`. A war subsidy, a tenth of all prizes and a standing
intelligence duty all became decoration, because any obligation without a
mechanical home silently becomes flavour.

The answer is not to stop recording them — the record is the useful part, and
the arbiter reads it — but to make the record bite. `COMMITMENT_GOODWILL` moves
disposition **between the bound parties, pairwise**, when one is established, and
takes it back when one is dissolved, which is what makes a commitment cost
something to have made. Only between the parties: unlike a treaty, a commitment
is not public business, so onlookers have no view. A one-party commitment — a
standing policy, a charter over your own space — binds nobody else and moves
nothing.

## Faction character

Internal `factionId` values are historical and were never renamed alongside
the display names — they are opaque keys used throughout the code, tests and
save files, so changing them is a much bigger and riskier pass than changing
what a player sees. Reference, since `id` and `name` no longer share a root:

| `factionId` | display name |
|---|---|
| `meridian` | Meridian Trade Authority |
| `vigil` | Iron Vigil Remnant |
| `hutt` | Ojjul Nar Combine |
| `freeworlds` | Arkanis Free Worlds |
| `krayt` | Drajk Confederacy |

Five powers that should never be mistaken for one another. Each differs on four
axes at once, because a faction that differs only in its doctrine paragraph
sounds like every other faction the moment a conversation gets specific:

- **`voice`** — register, dialect, verbal habits. Fed verbatim into the
  diplomacy persona; the prompt's stated test is that a reply which could be
  pasted into another faction's mouth has failed.
- **`warEthic`** — `expansionist` · `defensive` · `opportunist` · `crusading` ·
  `profiteer`. Load-bearing, and one per faction. See "War ethics" below.
- **`tradeEthic`** — `free_trade` · `monopolist` · `extortionist` · `autarkic` ·
  `smuggler`. Load-bearing, and now **one per faction**: Meridian, the Iron
  Vigil, the Nars, Arkanis, Drajk in that order.
- **`redLines[]`** — absolute refusals no incentive moves.
- **`buildBias[]`** — what it reaches for first, so pressure does not make every
  power build the same shipyard.

Stats are deliberately lopsided, and a test asserts no two factions share a
peak-stat/build-bias pairing — a power that is good at everything makes every
check the same check.

## Economy — income is per system, not per faction

`systemIncome()` in `state.ts` divides one world's take. Three cases, resolved
in order:

- **Wholly owned** — the controller holds it and no rival has ships present.
  The controller takes everything.
- **Contested** — a rival has ships in the system. The take splits by armed
  presence, with the holder keeping a **2× administrator's edge**, because
  occupying a world you do not administer yields less than administering it.
  Parking ships in a rival's system is therefore an economic act, not only a
  military one.
- **Guests do not contest.** A fleet present under `basing_rights` or
  `mutual_defense` takes nothing from presence — `isGuestOf` in `state.ts`.
  Income was previously blind to diplomacy, so an ally you had invited skimmed
  your worlds exactly as an invader would, which made the treaty harmful to
  sign. Worse: `mutual_defense` *dispatches* an ally's hulls into your system,
  so honouring a pact and losing ships for you ended with your rescuer taxing
  the world it had just saved.

  A guest is paid **by its treaty or not at all** — `incomeShares` comes off
  the top and is flagged `byTreaty`. One negotiated mechanism rather than two,
  and the arrangement is visible instead of emergent. The list is deliberately
  narrow: a `trade_accord` concerns lanes and a `non_aggression` pact is only a
  promise not to attack, so neither grants a right to sit in someone's orbit.
- **Neutral** — nobody controls it, so while nobody is there it pays
  **nobody**. A faction that parks ships over an unaligned world does collect,
  without owning it and without fighting its garrison: occupying is cheaper
  than conquering and buys no possession. Income also reaches a faction through
  a treaty naming them.

Treaty `incomeShares` come off the top before any of that, capped so a system
can never pay out more than it is worth.

### Ships are bought, and a navy you cannot pay for shrinks

`SHIP_COST` is **60 credits a hull**; `UPKEEP_PER_FLEET_POINT` is **4 a turn**,
so a ship costs its purchase price again every fifteen turns. Against net
incomes of 87–300, that buys one to five ships a turn from revenue — expansion
is a programme, not a sentence in an order.

Billing happens in `billConstruction`, a post-pass over each `applyOps` batch
that compares hull counts before and after. Two consequences follow from
billing the **net** rather than each op:

- Repositioning is free. `adjust_ships -5` here and `+5` there costs nothing,
  in either order, and issuing a `fleet_movement` is not read as scrapping the
  ships that left.
- Overreach is **not a rejection**. The yards deliver what was paid for and the
  surplus is trimmed off, deterministically, largest concentration first. A
  partly-affordable order is partly fulfilled, which reads the way a partial
  check reads.

Losses are never refunded, so hulls cannot be cycled through the yards for
cash.

Unpaid upkeep used to do nothing at all — `credits` floored at zero and a fleet
of a thousand was sustainable on an empty treasury forever, which made upkeep no
constraint whatsoever. A faction that cannot pay now lays ships up, enough to
close the gap but capped at `MAX_ATTRITION_FRACTION` (15%) of the fleet per
turn, so insolvency is a visible decline over several turns rather than a navy
vanishing in one tick. An overbuilt power converges on the fleet its income can
actually carry.

**All of this is arithmetic in the reducer, never guidance in a prompt.** "Build
a thousand ships" is exactly the instruction a model can be argued into
emitting; `prompts/resolution.md` explains the prices, but nothing depends on
the model honouring them.

Each system carries `ships: Record<factionId, number>` — presence, distinct
from `garrison` (dug-in defence) and from a faction's global `fleetStrength`.

`ledgerFor()` then rolls a faction's shares up, applies its trade-ethic
multiplier, and subtracts fleet upkeep, flat treaty transfers (`treatyFlow`) and
credits skimmed by hostile agents (`espionageLoss`). Applied to every faction
during `tickTurn`, floored at zero.

## Trade — a network, not a multiplier

`src/domain/trade.ts`. Income has two halves: **territory** (what your worlds
pay) and **routes** (what the lane network pays).

A **route** is the shortest hyperlane path between two hubs (`strategicValue >=
7`). Routes are recomputed from the graph every time they are read, never
stored, so there is no second source of truth. Value splits 40% to the two hub
holders and 60% across the systems the lane crosses — an unaligned hop pays
whoever has ships parked on it, exactly as an unaligned world does.

`tradeEthic` used to be one multiplier, and `extortionist` sat at ×1.0, so the
Nars' defining trait did nothing whatsoever. The multiplier is now only a
thumb on the scale (and runs the *other* way — an autarkist wrings more out of
its own worlds precisely because it has renounced the network). The doctrine
lives here instead:

| ethic | mechanic |
|---|---|
| `free_trade` | scales with **galaxy-wide openness** — profits from everyone's peace, not just its own |
| `extortionist` | a **toll** on every foreign cargo crossing its space |
| `autarkic` | keeps only `AUTARKIC_ROUTE_FRACTION` of route income, and cannot be strangled |
| `smuggler` | ignores blockades, raids at double effect, counts double at lawless junctions |
| `monopolist` | `MONOPOLY_BONUS` premium on lanes it owns **both ends** of, paid on top of the conserved split |

The seed already had the geography for this and nothing read it: kes-2 sits on
74 of the galaxy's 300 shortest paths and the extortionists hold it; three more
high-traffic junctions are unaligned.

### One ethic each, which took a while

`monopolist` was implemented, tested and **owned by nobody**, while `autarkic`
was held twice — five ethics, five factions, one duplicated and one dead. That
is an authoring slip, not a design.

The Iron Vigil has it now, and the geography decides that rather than taste:
only three lanes on the map have both ends under one power, and the Vigil holds
one of them (`tio-3 <-> tio-4`, one jump, volume 44). The *other* autarkist,
Arkanis, holds a single hub and would earn nothing from the doctrine, so the
duplicate could only be broken on the Vigil's side. It fits the fiction better
than expected: *"Hold the Tion until order is restored"* **is** the monopolist
precondition, and fortification and garrison-raising are the toolkit for
holding both ends of a corridor.

**Two things had to change to make it work**, and both were only visible
because the ethic finally had an owner:

1. **The premium broke value conservation.** It multiplied the endpoint share
   inside `routeEarnings`, so the network paid out more than the lanes were
   worth — caught immediately by the test that guards exactly that, which had
   never fired because no faction was a monopolist. It is now reported as
   `monopolyPremium` and added by `ledgerFor`, which is where the free trader's
   openness bonus already lives. The split stays a conserved division of what
   the network is worth; the premium rides alongside it.
2. **`MONOPOLY_BONUS` fell from 1.5 to 1.25.** Swept over 30 played turns, the
   response is a *cliff*: at 1.4+ the Vigil's route income funds a fleet that
   takes `tio-1` off Meridian — costing Meridian a hub and its own both-ends
   lane — and Meridian ends at −82. At 1.3 and below Meridian keeps tio-1 and
   finishes at **+31**, better than the −1 it managed before any of this. From
   1.3 down to 1.15 the board is identical, because the premium applies to one
   lane and the discrete question (does Meridian keep tio-1) swamps it. 1.25 is
   chosen over the 1.3 that also passes for margin: a tuning value sitting on a
   cliff edge is one unrelated change away from tipping back.

### Interdiction: attacking an economy without a battle

Two order types, both requiring **a fleet already at the target** — you cannot
blockade by proclamation, and because the ships are physically there they can
be destroyed, which ends the order.

- **`blockade`** severs every lane through a system. It closes for the
  blockader's own trade too, so blockading a lane you profit from is
  self-harm.
- **`commerce_raiding`** diverts transiting trade to the raider.

Blockades resolve **per beneficiary, not per lane**. Deciding it once for the
whole route meant a smuggler only kept its trade when every other party could
also run the blockade — so "smugglers run blockades", the Confederacy's entire
economic identity, almost never fired.

Raiding is available to anyone, because a cornered power turning pirate is a
real strategic story. It stays a Drajk mechanic through three asymmetries
rather than a ban: half yield for non-smugglers, `PIRACY_REPUTATION_COST` with
uninvolved powers who do not expect it of you, and red lines in the other four
factions' own lore. Drajk's doctrine says *"raid the rich"*; the mechanics now
say the same thing.

## Treaty types have mechanical force

Every type was cosmetic except `incomeShares` and `incomePerTurn`.
`TREATY_TYPE_MEANING` promised that mutual defence obliged an ally to answer,
and nothing implemented it.

| type | what the reducer does |
|---|---|
| `non_aggression` · `ceasefire` | attacking the other party **auto-breaks** it: −25 with them, `PACT_BREAKING_REPUTATION_COST` with every onlooker |
| `mutual_defense` | the above, plus `shipsPledged` are really dispatched — those hulls leave the ally's worlds and fight |
| `trade_accord` | parties are immune to each other's blockades and raiding |
| `basing_rights` | the other party's fleets may enter without it being an attack |
| `tribute` | `incomePerTurn` moves every turn |
| `territory` (a term, not a type) | the named systems **change hands** when the treaty takes force |
| `voidsOn` (a term, not a type) | typed conditions that **end** the treaty when they come true |

**A treaty can carry conditions that end it.** Powers negotiate these
constantly, because natural language makes them free — *"any tribute or standing
order you give the Vigil voids this, full stop"* — and nothing enforced them.
The playtest detail that makes it a bug rather than a gap: both forbidden
treaties were signed on one timestamp, the NPC noticed in prose the next turn,
and it broke **only the `mutual_defense` half**. The `trade_accord` that paid the
player survived four more turns. The half of the void that cost the player broke;
the half that paid them did not.

A **closed set** of three kinds rather than a condition language, the same
principle as `OrderEffect`: `treaty_with` (the constrained party signs with a
named power), `attacks` (goes to war with them), and `insolvent` (is running at
a loss and can no longer fund its side). Evaluated in `tickTurn` before expiry
and before income, so a voided treaty does not pay out once more on its way off
the board, and the status is `voided` rather than `broken` — nobody repudiated
it, the condition simply came true, so it carries no pact-breaking reputation
cost.

**Signing under a fleet costs the power holding the fleet.** A lopsided-Vigil
playtest put the identical ultimatum to all four powers with 1,020 hulls against
24–39; three conceded, and **the two that conceded most ended the turn better
disposed toward the Vigil** — because the only thing moving disposition after a
negotiation was extraction rewarding a constructive conversation. Nothing
modelled resentment at being coerced, so bullying a neighbour into tribute was
rewarded in standing for having been done politely.

`COERCION_RESENTMENT` is charged in the reducer at signature, per treaty, to
whichever party has hostile ships sitting on the other's worlds —
`underDuressFrom`, the same presence test interdiction and suborning draw, and
deliberately mechanical rather than a reading of the transcript, because "were
they threatened" is exactly the judgement a model gets talked out of. A guest
under `basing_rights` or `mutual_defense` does not count: those ships were
invited, and `isGuestOf` already knows the difference.

It is small on purpose, for the reason `DISSENT_DECAY` exists and its opposite
does not: **disposition has no decay at all**, so this never fades. A power that
habitually extorts its neighbours accumulates a permanent debt of ill will — the
intended reading — which is exactly why one signature should be a grievance
rather than a catastrophe.

`insolvent` reads the **ledger**, not the treasury: a faction can be sitting on
savings while running at a loss, and it is the loss that means the obligation has
stopped being funded. It closes the case where a payer's treasury floors at zero,
so it "pays" nothing while the treaty goes on claiming it does.

**A treaty can be agreed now and take force later.** `form_treaty` accepts
`ratifyTurns`, which records it `pending` with an `effectiveTurn` and applies
none of its terms until `tickTurn` promotes it. It exists because extraction is
told — correctly — that a conditional promise produces nothing yet, so a deal an
NPC gated on ratification used to emit a `treaty_ratification` order and no
treaty at all. That category carries no payload by design, so the order ticked,
completed, logged, and changed nothing: a fully negotiated marriage, supply line
and transit compact evaporated on completion. One object rather than an order
plus a promise means there is no second source of truth to desync, and
`isTreatyLive` already gated on `status === 'active'`, so `pending` is inert
everywhere without a single reader changing.

**`terms.territory` cedes worlds, and did nothing at all before.** A playtest
signed an accord naming four systems — two of them not even held by the player —
and no controller changed. A cession does not breach the rule that control
changes *only* when a `fleet_movement` arrives: that rule exists to stop a model
talking itself into owning a distant system, and `form_treaty` is already
extraction-only, so a cession can only arrive from a transcript, which is the one
place the other party's consent exists. A declared action still cannot move a
border.

What is standing there follows the rule the game already uses for the violent
case, minus the blood:

- **The garrison transfers intact** — nobody fought. That is the whole
  difference between capitulation and conquest, where the garrison is destroyed
  and the conqueror keeps a fraction, and it is what makes a ceded world worth
  more than a stormed one.
- **The ceder's ships withdraw to their nearest holding with no losses**, by the
  same `fleetBases` route a defender takes when it breaks off — which is also
  instant, and costs 10–35% for the privilege. Leaving under a signature costs
  nothing.
- **With nowhere to go they stay in orbit**, an uninvited presence contesting
  the income of a world they no longer own. The violent path destroys such
  ships; doing that here would make cession a trap rather than a bargain.

Only what a party actually holds moves, and a cession is a one-time event rather
than a term that applies while the treaty is live — land changes hands once, and
taking it back is a fresh act.

`basing_rights` fixed something worse than an inert field: **there was no way
to station ships in friendly space at all.** Any movement into a partner's
system resolved as an attack on them.

## Faction lines are enforced, not suggested

Red lines stop a faction acting out of character. **Compulsions** stop it
failing to act in character — an Iron Vigil leader who sits passive while rebels
hold Imperial ground is not being cautious, and the fleet commanders say so.

An action that breaks a line produces a `refusal` instead of ops. When it does,
`submitAction` stages **nothing**: an order the fleet will not carry out is not
a smaller version of that order, it is no order at all. This is distinct from a
failed check (attempted, went badly) and from a rejected op (malformed).
`dissent` tracks how far a leader has strayed. It rises `REFUSAL_DISSENT` (8)
per refusal, decays 2 a turn, and subtracts from **every** stat on a curve set
by one number: `MAX_DISSENT_PENALTY` (8) is the loss at 100 dissent, and
`DISSENT_PER_PENALTY_POINT` is derived from it (12.5). So one refusal fades in
four turns and costs nothing on its own; a pattern of them does not fade and
does cost.

The ceiling is 8 rather than 4 because stats run **1–20**. A fifth of the scale
read as a bad quarter; 40% of it, and −4 on every modifier, is the difference
between a power that functions and one that does not — which is what "your own
people have stopped following you" should mean. The formula lives in
`dissentPenalty` and nowhere else: a hardcoded copy in `serialize.ts` was
telling the model a different number than the one the game rolled against.

It was inert for its entire existence: `submitAction` computed the new total,
put it in a note telling the player dissent had risen, and never staged the op.
Nothing ever degraded. Three things now make it legible as well as real — the
op is actually staged, the browser renders **effective** stats (with the base
shown behind them, because a number that is not the number the game rolls
against is a lie), and `serializeState` tells the model its own institutions
have lost faith in it.

Verified live: a Meridian leader ordering a spice-and-slave run is refused by
the Trade Council; an Iron Vigil leader ordering universal passivity is refused
by the fleet commanders.

Dissent itself is faction-agnostic — every faction carries the field, all five
have red lines and compulsions in the seed, and `effectiveStats` reads the same
way for each.

### Who rules on a breach: the arbiter, not resolution

The classification lived in the resolution call for the whole life of the
mechanism, and a playtest as the Arkanis Free Worlds — the power defined almost
entirely by refusal — measured what that was worth. Three unambiguous
compulsion breaches (paying one-off tribute, agreeing to ongoing tribute,
raiding another power's shipping) resolved as **ordinary skill checks costing
nothing at all**, and a red line was never once returned as a `refusal`: *"open
the gates, invite the Vigil to occupy Arkanis Prime"* — the verbatim scenario of
that faction's first red line — was priced as a `resolve` check at DC 19 and
would have succeeded on a 20.

The reason is structural rather than a matter of wording. Resolution is handed a
settled outcome and asked to make it real, so it is the pass with the least
incentive to rule that the order should never have gone out, and nothing checked
it — the exact failure mode this file names everywhere else. `AppraisalSchema`
therefore carries a `breach`, and the arbiter decides it: a separate call, not
shown the roll, already ruling on `establishes`.

| ruling | what happens |
|---|---|
| `red_line` | `resolveAction` returns a `refusal` **before the roll**, and the resolution call never runs at all |
| `compulsion` | the roll and resolution proceed, the ops land, and the engine charges `COMPULSION_BREACH_DISSENT` |
| none | ordinary resolution |

A red line stopping the action *before* there is a second call is the whole
point: there is nothing downstream left to argue the order back into existence,
and no phrasing reaches past a ruling made on the appraisal. On a compulsion the
arbiter's ruling also overrides resolution's own account of it — a `defiance` is
set whether or not resolution mentioned one, its `violated` is always the
arbiter's quoted line, and a `refusal` volunteered on top of a compulsion ruling
is dropped, because turning a price into a block is the one distinction the
mechanism rests on. Resolution may still refuse unprompted; that is a backstop
now, not the mechanism.

`serializeState` carries doctrine and ethics but neither list, so for its whole
existence **the arbiter had never been shown the lines it is now asked to
enforce**. It gets `serializePrinciples` — doctrine, ethics, red lines,
compulsions — and deliberately not `serializeCharacter`, whose `voice` field
runs to thousands of tokens of dialect notes for Arkanis alone. Handing a
bounded classification call the whole character sheet would have roughly doubled
the price of every action in the game.

**A negotiated deal is held to the same lines as a declared order.** The arbiter
gated `resolveAction` and nothing gated extraction, so a red line could be
walked past by framing the act as a deal — measured live, the Combine emitted
`forgive_debt` against its own first red line for no dissent at all, while the
same intent declared normally was refused three times. That was sharper than a
plain missing check, because `establish_debt` and `forgive_debt` are
extraction-only *by design*: the two ops most tied to that faction's identity
were the ones with nothing watching them. `closeChannel` now appraises what was
agreed before staging it — one Haiku call, and **only when the transcript
actually produced ops**, since a conversation that agreed nothing must not cost
a call to discover that. A red line refuses the *whole* accord (a deal that
needs you to cross it is no deal); a compulsion lets it stand and charges. The
check is scoped to the acting faction by construction, because the arbiter
appraises from `playerFactionId` — the other party's concessions are theirs to
make and cannot trip your line.

A red-line ruling is also **cheaper** than what it replaces: it skips the Sonnet
resolution call entirely, so the most flagrant actions in the game now cost
about `$0.022` instead of `$0.073` — measured live.

**The sheet decides which kind a line is, not the arbiter's label.** Verified in
two playtests: Arkanis blocked the protectorate it had been talked into before
and did *not* flag raising its own garrison, but the Vigil produced a new hole in
the same shape as the old one. Asked to retain Nar smuggler captains as
informants, the arbiter quoted the right line, called it *"a red line, not a
compulsion"* when the seed carries it in `compulsions`, and returned the whole
thing as `admissible: false` — the one exit that charges nothing at all. A
25-dissent breach became a free no-op.

**A real line is not necessarily the right line.** `classifyPrinciple` proves a
quoted line exists on the sheet; nothing proved it was *about the act*, and
relevance is precisely the judgement being delegated. Measured live: an
assassination was charged `COMPULSION_BREACH_DISSENT` quoting *"commerce raiding
is refused outright"* — a real line, with nothing to say about killing a factor —
and the same declaration made twice in one turn produced a breach once and
nothing the other time, while the DC stayed at 18 both ways. It is specifically
the breach reading that wobbles, not the pricing.

`verifyBreachRelevance` is a second, tiny call on the flavour tier, and it runs
**only when a breach was named**, so an ordinary action costs nothing extra. It
is a separate call rather than another field on the appraisal for the reason the
arbiter is separate from resolution: asking the pass that found the breach
whether the breach is real gets back the answer it already gave. This one is
shown the act and the line and nothing else — no character sheet, no state — so
it has nothing to reason from except whether the two match. On `relevant: false`
the breach is dropped and nothing is charged.

`classifyPrinciple` in `src/domain/compulsions.ts` closes it by splitting the
work the same way everything else here does. The model is good at the part that
needs judgement — *which line does this action touch* — and unreliable at the
part that is a lookup, so it names the line and code does the lookup:

- `kind` is derived from the list the line is actually on; the model's label is
  discarded, in both directions.
- An `admissible: false` whose `reason` quotes a real line is rewritten into the
  breach it actually is.
- A principle matching **nothing** on the sheet is not a breach at all. An
  invented rule buys no price.

Matching is forgiving about truncation, punctuation and light paraphrase because
the arbiter quotes imperfectly, and it is safe to be forgiving because the five
sheets have almost nothing in common — a test asserts no line on any sheet
matches any other faction's.

### Compulsions also fire on drift, for everyone

Refusal has a shape problem: it needs an action to refuse. That works for a
compulsion phrased as a prohibition and not at all for one phrased as a demand,
so a player who simply never acted was never noticed — and four lines in the
seed promised consequences for exactly that, with nothing behind them:

> *"a stretch of quiet with no raid, no prize and no payout and they take ships
> elsewhere"* · *"insults must be answered within a turn or two, or the officer
> corps answers them without you"* · *"an unprofitable quarter … invites a vote
> of no confidence"*

Nothing measured time, income or idleness. A compulsion may now carry a
**trigger** (`src/domain/compulsions.ts`), a pure predicate on world state
checked once per faction per turn in `tickTurn`:

| trigger | fires when |
|---|---|
| `unprofitable` | net income is zero or negative |
| `idle_at_war` | at war with someone and no fleet under way |
| `unanswered_incursion` | a rival's ships sit on a world you hold and nothing was sent |
| `no_plunder` | no raid under way and nothing taken from anyone's lanes |

Three properties follow from making these predicates rather than counters:

- **A "stretch" needs nothing to count it.** The predicate is simply true again
  next turn, so neglect accumulates by repetition and stops the moment the
  faction complies — the behaviour the flavour text always described.
- **It replays exactly.** No history, no clock, no dice.
- **It applies to every faction.** This is the first mechanism in the game that
  holds an *NPC* to its own character. Refusals only ever reached the player,
  because `ReactionSchema` has no `refusal` field, which left four of five
  powers free to act completely against type at no cost.

`COMPULSION_DRIFT_DISSENT` (3) is set against `DISSENT_DECAY` (2), so one
ignored compulsion nets +1 a turn and two net +4. Measured over 30 turns in
which nobody acts at all: the Iron Vigil and Drajk reach 32 dissent (−2 to every
stat), and the three powers whose compulsions are all prohibitions never drift
at all. It is deliberately well below `REFUSAL_DISSENT` (8) — ordering your
faction to betray itself is worse than merely failing to be it.

A compulsion with no trigger is **not** inert; it is still enforced the original
way, by refusal. `CompulsionSchema` accepts a bare string and normalises it, so
every save and journal written before triggers existed still loads.

> The one thing TypeScript will not catch here: `faction.compulsions` is now
> objects, and interpolating one into a template literal is legal and yields
> `[object Object]`. That is precisely what `serializeCharacter` did for a
> moment, which would have fed the model a character sheet with every
> compulsion blanked. There is a test pinning it.

### Changing doctrine costs dissent, because it is real

`set_doctrine` used to write a string and nothing else. `warEthic` and
`tradeEthic` — the axes that actually do something — had no op at all and were
immutable for a whole campaign, so a doctrine change either got refused by a
model's judgement with nothing behind it, or silently "succeeded": narrative,
event log and UI all confirming a change that had not happened.

Doctrine is now genuinely changeable and dissent is the price, charged in code
per axis actually moved: `DOCTRINE_TEXT_DISSENT` (6) for a new statement of
posture, `DOCTRINE_ETHIC_DISSENT` (20) for each ethic. Both guards are
reducer-side: a faction may change only **its own** doctrine (`actor`-checked,
the same hazard `deploy_agent` validates against — without it a Meridian action
could rewrite the Iron Vigil's doctrine, which is what its diplomacy persona is
built from), and one at or above `DOCTRINE_CHANGE_DISSENT_CEILING` (75) cannot be
reorganised at all.

### Debt: a balance that depletes, and a debtor who can fail to pay

`src/domain/debt.ts`. The Ojjul Nar Combine's sheet is built on debt — *"will
not forgive an unpaid debt — the debt is the whole instrument of control"*, *"an
unpaid debt must be pursued"* — and neither line had anything behind it. The
obvious home looked like a `Commitment` with an `incomePerTurn`, and that was
tried in the prompts first. **It does not work, in three separate ways**, and
each is a thing the module had to supply:

1. **A commitment's `incomePerTurn` is not directional.** It is one scalar every
   bound faction reads the same way, unlike a treaty's, which is a record keyed
   by faction. Measured: a debt written as one two-party commitment at 25 paid
   the creditor 25 **and the debtor 20**. Both sides earned; nobody paid.
2. **A commitment has no principal.** It is a perpetual flow, so "owe 400"
   became "pay 25 a turn forever" — nothing counted down, nothing settled, and
   repaying in full was indistinguishable from paying tribute.
3. **A commitment has no default**, being only `active` or `dissolved`, while
   both of the Combine's lines turn on the word *unpaid*.

A `Debt` carries `principal`, a `balance` that falls by exactly what moves, a
`perTurn` instalment, `missedPayments`, and a status of `current` ·
`delinquent` · `settled` · `forgiven`.

**Serviced as a transfer in `tickTurn`, not as a rate in `ledgerFor`**, and that
is the load-bearing decision. A rate cannot know whether the debtor could
afford it: `credits` floors at zero, so a broke debtor would "pay" money it
never had and the creditor would receive it — the commitment bug in its purest
form. The transfer moves exactly what is there, the balance falls by exactly
what moved, and a shortfall becomes a default instead of being conjured.
`Ledger.debtService` reports the scheduled figure and is deliberately **not**
summed into `net`, so nothing is charged twice; the briefing shows it on its own
line.

| op | source | why |
|---|---|---|
| `establish_debt` | **extraction only** | nobody becomes a debtor because another power declared it |
| `assign_debt` | **extraction only** | the creditor holding the paper has to agree to part with it |
| `settle_debt` | ordinary | prepaying what you owe needs nobody's permission, and the reducer moves the money so it cannot be wished away |
| `forgive_debt` | ordinary | a creditor needs nobody's permission to stop collecting — and it is the exact act the Combine's red line forbids |

**A debt can now change hands and be paid down**, which it could not before.
Extraction had `establish_debt` and `forgive_debt` and nothing between, so
agreeing to *assign* paper could only be written as a fresh debt — which minted
a second copy and retired nothing. A playtest bought the same Drajk paper twice
and left **three debts standing, with Drajk owing 1400 against an original
600**: an obligation manufactured purely by trading it. `assign_debt` moves the
creditor and keeps the balance, the instalment and the history.

`settle_debt` is the other half. Paying a debt off early had no op at all, so
430 credits paid against a 400 balance produced a narrative saying "that column
shut" and a debt still live the next turn. It is an ordinary op rather than
extraction-only precisely because the reducer moves real money: the debtor pays
exactly what comes off the balance, trimmed to what the treasury actually holds,
so the worst it can do is a part-payment. Paying against arrears also clears a
`delinquent` status, because the per-turn service check decides afresh next
tick.

Forgiveness pays `DEBT_FORGIVENESS_GOODWILL` (20) with the debtor, so refusing
to use it is a real sacrifice rather than a free principle. A default costs
`DEBT_DEFAULT_DISPOSITION_COST` (6) every turn it continues, which is how a
creditor's patience runs out on its own. A debtor cannot forgive its own debt;
the reducer checks the actor, the same hazard `deploy_agent` and `set_doctrine`
are guarded against.

**`debt_unpursued` is the fifth compulsion trigger**, and the first one the
mechanism was built *for* rather than retrofitted to. *"An unpaid debt must be
pursued"* is a demand, which is exactly what a refusal cannot reach — a creditor
who never chases a debtor takes no action to be refused. Pursuit is read as
pressure actually applied: a fleet under way at one of their worlds, or an
operative in their space. Diplomacy deliberately does not count; the line is
about a client who has already learned that owing you costs nothing.

The seed gives the Combine two debts so both halves are live from turn 0 — Drajk
already in default, Meridian paying on schedule — which also gives the arbiter
real state to rule against instead of a fiction. **Not Arkanis, deliberately:**
*stone-debt* is their word for what is owed for taking help, and the Closing is
a refusal to take any. A power that counts its dead rather than accept grain
does not carry a Nar loan.

Balance is unmoved (nets 24/90/232/71/32 before and after) because the transfer
sits outside `net`, and the Combine's inflow is bounded by the principal rather
than being another perpetual stream.

### A treaty needs consent, so it is not a declared action

`form_treaty` was in `ModelOpSchema` and the reducer checked that the two ids
existed and differed and nothing else. Measured live: *"sign a mutual defence
pact with the Iron Vigil"* was ruled admissible and priced as an `influence`
check at **DC 17** — against a power at −45 disposition — and a good roll would
have bound the Vigil to it, `shipsPledged` really dispatching, income really
flowing, without the Vigil ever being asked. The diplomacy architecture exists
precisely so that an NPC has to agree; the general-action path walked around it.

Three changes, in the usual division of labour:

- **The op left the model's vocabulary.** `ExtractionOpSchema` is
  `ModelOpSchema` plus `form_treaty`, and only the `/endtalk` extraction pass
  uses it — the one pass in the game that has read a transcript, which is the
  only place consent exists. `break_treaty` stays ordinary: repudiation is
  genuinely unilateral.
- **The reducer says the same thing**, rejecting `form_treaty` from a `model`
  source with `needs_consent` and a message naming the channel to open, so a
  hand-written batch cannot route around the schema.
- **The arbiter redirects instead of pricing.** `AppraisalSchema.negotiation`
  names who must agree and what is wanted; `resolveAction` returns it before the
  roll, staging nothing and charging nothing. Being told "that is a
  conversation" is not a failure and must not be priced like one.

Ordered **after** the breach ruling: an action your own people will not carry
out is refused whether or not it also needed someone else's signature, so a
redirect can never launder a red line. A test pins that.

### And the mirror: a fleet movement is not negotiable

`declared_only` is `needs_consent` pointing the other way. Extraction could emit
`issue_order` with `type: fleet_movement`, and a playtest used it to annex a
world — battle fought, garrison broken, control changed — with the player's
action points reading **2/2 afterwards**. Diplomacy is unmetered on the stated
grounds that a channel already blocks the command line and End Turn, and that
argument holds only while a channel cannot *do* what a declared action does.

A fleet movement is the one order that needs nobody else's agreement: it is your
own fleet, and it is also the one order that fights a battle and changes who
holds a world. So it belongs on the declared path, where the action economy
prices it at one of two per turn. The reducer rejects it from an `extraction`
source and `prompts/extraction.md` no longer offers it — a conversation that
ends "and my squadron will take station there" produces a `log_narrative`, and
the player sails on their own turn.

Everything else an accord can legitimately start — a ratification, a
construction programme — is unilateral work the action economy already prices at
issue time, and is untouched.

`OpSource` gained `'extraction'`, which `Campaign.stage` and `commitTurn` carry
for the same reason they carry the actor — a treaty staged in a channel and
committed as `model` would be rejected at the moment the turn landed, and the
deal visible in the preview would quietly not exist afterwards.

**This is the first change that would have made an old journal replay
differently.** Diplomacy batches written before the split are recorded as
`model`, and today's rule would delete a treaty that really was negotiated —
verified against `saves/ojjul_profiteer.json`, which loses its `trade_accord`
and gains a rejection. `JOURNAL_VERSION` is 2, both versions load, and a v1
entry *containing a treaty* replays under `extraction`. Scoped to those entries
rather than reinterpreting every legacy batch, because a diplomacy extraction
never carried a `transfer_control`.

Proxy hiring and debt — the Combine's two unmodelled lines — are diplomacy
mechanics made of pieces that already exist, and `prompts/extraction.md` names
both: a hire is a `mutual_defense` treaty with `incomePerTurn` to the hired
power and `shipsPledged` naming the hulls; a debt is a commitment binding both
parties with `incomePerTurn` negative for the debtor, forgiven by
`dissolve_commitment`.

### What the breach ruling can and cannot be held to

Two guards were added after live probes, and the boundary between them is the
point:

- **Which list a line is on** is a lookup, so code does it (`classifyPrinciple`).
- **The most severe line named** is arithmetic, so code does it
  (`classifyPrinciples`) — a red line beats a compulsion whenever both are
  quoted. Under-charging a red line is a hole; over-charging a compulsion is a
  ruling the player can argue with.
- **Which way a line points** is judgement, so the arbiter states it and code
  only insists that it does. `breach.how` is required because the arbiter read
  the Combine's *"will not fight its own war where a proxy could be hired"* as
  forbidding **hiring a proxy** — the precise inversion, since hiring is the
  line being kept. `classifyPrinciple` confirmed the quoted line was real and
  duly blocked the one action that most expresses the faction's doctrine. A
  verified quote is not a verified reading.
- **Whether a breach is spotted at all** is judgement that nothing checks, and
  it is not stable. Probed three times, *"forgive the Free Worlds' debt"* was
  ruled a red line once, a compulsion once, and no breach at all once; *"write
  off what they owe us"* — the same act — reliably hit the red line. Code
  guarantees that a naming is classified correctly, not that the naming happens.

One cause of that instability was a **seed defect the arbiter was right to be
confused by**: the Combine stated forgiving a debt twice, as a red line and
again inside a compulsion, at two different severities. The verbatim dedup test
did not catch it because the strings differ. The compulsion is now purely about
pursuit, so each act is stated once, at one severity.

### Red lines are permanent; compulsions are a price

There was briefly a `retire` field on `set_doctrine` that abandoned a named red
line or compulsion for 25 dissent. It was the wrong shape, and the first live
model call proved it: asked explicitly to retire a red line, the resolution pass
rewrote the doctrine paragraph, announced the retirement in the narrative, and
emitted `retire: []`. The sheet and the story disagreed, and the enforcement
skipped the still-live line anyway. Guarding that would have taken an arbiter
field, prompt plumbing and a batch-composition rule to stop retire-then-breach
becoming a universal bypass for a flat 25.

The simpler answer is that **nothing is ever retired**, so there is no state to
desync. The two kinds of principle are now answered differently:

| | enforced by | cost | repeatable |
|---|---|---|---|
| **red line** — *"will not, whatever the incentive"* | `refusal`; **no ops at all** | `REFUSAL_DISSENT` (8) | the attempt, yes; the act, never |
| **compulsion** — *"your institutions DEMAND"* | `defiance`; **the ops land** | `COMPULSION_BREACH_DISSENT` (15) | yes, and that is the point |

A leader who means to turn their power against its own character does it by
insisting and absorbing the cost. Around eight defiances reach the 100 cap and
`MAX_DISSENT_PENALTY` — eight off every stat, fifty turns to clear — so the
mechanism is "you may, and by the eighth time nobody is following you" rather
than "you may not".

The price lands on the **attempt**, not the act: the institutions are furious
that the thing was proposed, and keeping the charge out of the outcome bands is
what stops it becoming another number the resolution call can reason its way
around. It was 25 until the first live playtest of the arbiter rework, where two
Arkanis breaches in one turn — one of them a natural 1 that achieved nothing —
cost 50 dissent and −4 on every stat before the second turn began. Charging on
the attempt is right; charging three times what a *blocked red line* costs was
not.

`defiance` is charged in code, not nominated by the model: the **arbiter** rules
that a compulsion was defied — see "Who rules on a breach" above — and the
reducer sets the price. Neither half is resolution's to decide. And
nothing further fires at the cap on purpose — the penalty there is already
crippling, and a terminal state on top of it would charge twice for one decision.

### Dissent moves one way, on your own faction only

`adjust_dissent` had the same unguarded shape, and raising the ceiling to 8 made
it the most cost-effective hostile act in the game: one op, no roll, no
presence, no credits, and every one of a rival's stats drops by 8 — strictly
better than the `stat_debuff` agent that exists to do exactly this for 40–150
credits, at risk of exposure, under a cap. Two paths to one outcome that cost
differently means only the cheaper one is ever used.

A model-sourced `adjust_dissent` now moves only the **actor's own** faction, and
only **upward**. Raising your own needs no guard — nothing needs protecting from
a faction choosing to be less governable — but lowering it is the exploit, since
the same call that earns a refusal could erase the penalty it just earned.
Standing is repaired by `DISSENT_DECAY` and nothing else, which is the pace the
number was tuned for. Turning a rival's institutions against it is an
operative's work.

Reactions commit with the reacting faction as `actor`, so an NPC can still move
its own dissent; only the cross-faction reach is closed.

## Treaties and agents

Both live in world state (`src/domain/diplomacy.ts`), because both have
mechanical force every tick. A treaty a model merely *remembers* is a treaty
that quietly stops existing.

**Treaties** have two parties, a type, an optional expiry, and terms the reducer
applies: `territory`, `shipsPledged`, `incomePerTurn`, `incomeShares`,
`mutualDefenseTrigger`. They lapse on schedule during `tickTurn`. Breaking one
costs the breaker 25 disposition with the other party.

**Agents** separate two things that are easy to conflate:

- the **effect** is what happens — `hull_damage` (mutates fleet strength),
  `income_penalty` (read in `ledgerFor`), `stat_debuff` (read in
  `effectiveStats`), `intel` (read in `ordersVisibleTo`, revealing hidden
  orders on the watched system).
- the **mission** is risk and persistence, via `MISSION_PROFILE`:

| mission | exposure on failure | persists | effect × |
|---|---|---|---|
| `surveillance` | 1 in 20 | yes | 1 |
| `theft` / `subversion` | 2 in 20 | yes | 1 |
| `sabotage` | 3 in 20 | yes | 1 |
| `assassination` | **9 in 20** | **no** | **4** |

`successChance` is computed in code from the owner's guile against the target's
resolve, never chosen by a model. Agents resolve each tick against the same
seeded d20 as everything else.

**Exposure is read off the top of the die** — `roll >= 21 - exposureRisk` — and
that is not a detail. It was written as `roll <= exposureRisk` inside the
failure branch, which looks right and fired essentially never: a roll succeeds
when `roll * 5 <= successChance`, so rolls `1..floor(successChance / 5)` never
reach the branch at all, and those are exactly the low rolls the risk test was
looking for. `successChance` floors at 5, so a *surveillance* operative could
not be exposed at any stat pairing in the game. Measured before the fix: 80
operatives, five owner/target pairings, 40 turns each — **zero exposures**.
Nobody noticed because a burned agent is a non-event; you observe nothing rather
than something visibly wrong. Reading the same risk off the high end keeps the
intent and makes the ladder real: mean survival 18.1 turns for a watcher, 6.8
for a saboteur, 47% caught per assassination against a claimed 45%. Competence
still protects — an operative good enough to succeed on all but a natural 20 is
only caught on that 20, which is 5% rather than nothing.

**Covert action declared in free text is routed into this mechanic**, rather
than resolved beside it. The same fiction had two routes with uncoordinated
prices: a *deployed* assassination costs 150 credits, counts against the cap, is
spent after one attempt, is caught ~45% of the time and costs the target 35
disposition undetected or 40 exposed — all in code — while a *declared*
"assassinate their raid captain" was priced as an ordinary `guile` check and the
resolution call invented the consequences. Measured live: −15 with the victim
and −6 with an onlooker, for no credits, against no cap, with no exposure roll.
The cheaper route was the one a player reaches by typing a sentence.

`AppraisalSchema.covert` names the mission and the system; `routeCovertAction`
appends the `deploy_agent` when the resolution call did not emit one itself, so
there is exactly one path — charged by `AGENT_COST`, held to `maxAgentsFor`,
resolved on the tick, exposed on the same ladder. **Only on an outcome that
placed something**: a failed attempt places nobody, the same rule
`boundPayloadsToOutcome` applies to a works payload.

**Assassination is a strike, not a posting.** The operative is spent after one
attempt either way; success deals four times the declared effect and costs the
target 35 disposition even undetected; failure exposes them nearly half the time
and costs 40. Everything else stays in place until recalled or burned.

Effects apply where they are *read* rather than mutating state each tick —
otherwise a debuff would compound every turn. Only `hull_damage` mutates,
because destroyed hulls stay destroyed.

## Suborning crews

A playtest produced a Nar corvette defecting to Drajk on a natural 20 — a good
outcome, and exactly what `OUTCOME_GUIDANCE` names as a critical-success bonus.
The problem was that the guard was incidental. `adjust_ships` let a model
decrement **any** faction's ships at **any** system: the same op shape moved
thirty hulls across the galaxy with no roll and no presence, and the pure
vandalism version (`-12`, no counterpart) cost nothing at all.

`transfer_control` is reducer-only precisely so a model cannot talk itself into
owning a distant system. Fleets had no equivalent protection, which is the
thing systems are won with.

Two rules now, both in the reducer:

- **Presence.** `canSubornAt` — ships in the system, ships **one jump out**, or
  an unexposed agent. The adjacency clause is the load-bearing one: requiring
  ships *in* the system meant you had to win the orbital battle first, so
  suborning was something you did to a power you had already beaten — the same
  inversion that made commerce raiding useless to the weak.
- **Magnitude from a stat contest.** `subornLimit` is the suborner's `guile`
  modifier minus the target's `resolve` modifier, plus one. Not a constant:

| suborner → | meridian | vigil | hutt | freeworlds | krayt |
|---|---|---|---|---|---|
| **meridian** | — | 0 | 2 | 0 | 1 |
| **vigil** | 2 | — | 1 | 0 | 0 |
| **hutt** | 6 | 2 | — | 1 | 4 |
| **freeworlds** | 3 | 0 | 2 | — | 1 |
| **krayt** | 4 | 0 | 3 | 0 | — |

Nobody can suborn the Iron Vigil (resolve 17) or the Free Worlds (19); the
Nars at guile 18 are the best at it; Meridian's resolve 9 is a real
vulnerability. All derived, no tuning constants.

Over-asking is **trimmed with a note**, not rejected, on the same principle as
`billConstruction`. Hulls that change sides are charged at `SHIP_COST` — bought,
not captured — so a defection network is not a free shipyard pointed at a rival.

**Suborning is not combat.** No battle is fought, the garrison is untouched,
and the world does not change hands; the price is paid in standing instead —
`SUBORN_DISPOSITION_COST` (6) per hull with the victim and
`SUBORN_REPUTATION_COST` (2) with every onlooker. Priced identically to the
agent route, because two paths to one outcome that cost differently means only
the cheaper one is ever used. It was previously the only hostile act in the
game that cost nothing at all.

The `defection` agent mission (`crew_defection` effect) is the standing version:
it turns crews every turn under the same limit, costs the victim 6 disposition
per hull, and reports finding "no takers" against a resolute power.

### applyOps now knows who is asking

`applyOps(state, ops, source, actor?)`. Some guards depend on *who*, not merely
on whether a model asked. The actor is recorded in the journal so replay stays
exact; it is optional, so journals written before the guard existed still
replay — reproducing what happened rather than retroactively rejecting it.

## War ethics have mechanical force

`warEthic` had **no mechanical reader anywhere** for the whole life of the
project — only the prompt serializer. That is why nobody noticed two factions
shared `defensive`, why `expansionist` sat unused, and why the Ojjul Nar
Combine carried a label that was precisely inverted. Exactly the `tradeEthic`
story before it: the axis was flavour, so its errors were invisible.

**`mercenary` is gone.** It meant *"fights for payment; war is a service sold"* —
the seller. The Combine's doctrine is *"let other powers spend their fleets for
you"*, its red line is *"will not fight its own war where a proxy could be
hired"*, and its might is **9**, the lowest in the game. It funds wars; it has
never had an army to sell. `profiteer` replaces it.

| ethic | faction | mechanic |
|---|---|---|
| `expansionist` | Meridian | `EXPANSIONIST_TERRITORY_BONUS` per world held, applied to **all** its territory income — expansion compounds. Conquest also consolidates: a captured world keeps half its garrison rather than a third |
| `defensive` | Arkanis | its garrison fights at `DEFENSIVE_GARRISON_BONUS` of its size, and costs the attacker accordingly. Only the real garrison can be destroyed — the bonus buys resistance, not extra troops |
| `opportunist` | Drajk | `OPPORTUNIST_MIGHT_BONUS` against a target **weakened** (garrison below half its ceiling) or **distracted** (its holder at war with someone else). Nothing in a fair fight |
| `crusading` | Iron Vigil | **does not break off**, attacking or defending. Wins engagements it should have fled and loses fleets it should have saved |
| `profiteer` | Ojjul Nar | `PROFITEER_INCOME_PER_WAR` from every war it is *not* in; at war itself it forfeits all of that **and** pays `PROFITEER_WAR_PENALTY` per war |

Two are deliberately double-edged. A doctrine that is purely an advantage is
not a doctrine, it is a bonus.

**Whose doctrine applies in a coalition** is a real question, because `bestMod`
takes the best modifier on each side and a doctrine is not a stat that can be
borrowed. It is read off the **largest contingent**, so a one-ship junior
partner cannot decide that nobody is allowed to retreat.

### The profiteer's two doctrines are in tension, and that is the point

`warProfitFor` flips sign the moment the Combine is in a war, which makes
*"will not fight its own war"* a line the ledger agrees with rather than one the
model has to be trusted to remember. It also collides productively with its
trade doctrine: `TOLL_RESENTMENT` means tolling everyone gradually turns them
against it. Measured over 30 harness turns, the Combine's own disposition toward
the Iron Vigil ends at −75 — a war — which turns +40 a turn into −40. It gets
rich by taxing everyone, and being resented by everyone is what eventually costs
it the peace it profits from.

> `expansionist` was assigned to Meridian rather than Arkanis on purpose. Both
> were `defensive`, and an income-based expansionism suits *"Commerce is
> sovereignty"*; Arkanis is the defensive faction par excellence — *"take no
> master"*, *"will never accept occupation"* — and giving it an expansion-pays
> mechanic would have contradicted its whole sheet.

## Combat

A faction has **no stored fleet strength**. Its navy is `sum(system.ships[f])`
plus anything in transit — see `fleetStrengthOf`. There was briefly a global
pool *and* per-system ships, which meant two navies that never met: one that
fought, one that collected income. There is now one.

A `fleet_movement` order carries a `force` drawn from the origin, so you send
part of your navy rather than all of it. In-transit ships still count toward the
total, and a cancelled or interrupted movement returns them.

### Two phases, on arrival

1. **Fleet battle** — committed force vs the defender's ships in the system.
   Might modifies the exchange and the seeded d20 swings it. A side outmatched
   2:1 **breaks off**, losing 10–35% (derived from the same roll) and falling
   back — the defender to another world it holds, the attacker one jump down its
   path. **A surviving defending fleet means no landing happens at all.**
2. **Ground assault** — only once the orbitals are clear. Garrisons are dug in
   and **cannot retreat**, so this resolves either way: the world falls, or the
   landing is thrown back.

Garrisons regrow by `GARRISON_REGROWTH` per turn toward `system.garrisonMax`,
costing neither hulls nor credits, because ground forces are raised locally.
That is what stops conquest being permanently cheap.

All of it is deterministic — one seeded d20 per battle — so campaigns replay
exactly.

### Battles are reported, not just narrated

`resolveBattle` computed the seeded roll, both might modifiers, the powers the
2:1 break-off test compares, the retreat loss percentage, proportional
per-contingent losses, the dug-in garrison value and the assault total — and
flattened all of it into one sentence. The player saw *"Fleets engage over
Kalzir: Meridian loses 24, defenders lose 20"* and could not tell which phase
decided it, what the roll was, or what was left standing. `TurnReport.arrivals`
carried that prose and **the browser never read it at all**.

That got worse when war ethics gained mechanical force, because four doctrines
now change battles and none of them were observable. `src/domain/battle.ts`
defines a `BattleReport`; `resolveBattle` returns `{ note, report }`, so the log
keeps its prose and the UI gets the arithmetic. `doctrinesFired` names only the
doctrines that **changed** something — a crusading power never asked to retreat
does not appear.

An **order of battle** heads the expanded card: who brought what, as
`<ship> x N` and `<tracked gun> x N` for the garrison, with the same pairs again
under Losses. The numbers were already there, spread through the phase breakdown
as before/after pairs; this is the same information as a *shape*, so you can see
whether a landing failed because the fleet was spent or because the garrison was
simply too deep, without subtracting in your head.

The glyphs are inline SVG in `web/src/components/BattleIcons.tsx`, inheriting the
faction colour through `currentColor`. They took four passes, and the failures
are the point: at 18px only the *outline* survives, so a wedge hull with engine
pods read as a flat lozenge with two detached bars, a barrel on a round carriage
read as a lollipop (and its ring-wheel version as a magnifying glass — the
barrel looked like a handle), a bare triangle read as a play button, and vertical
fins read as a four-pointed star. What works is a silhouette whose outline is
already the object: swept wings make a dart rather than a cross, and tracks with
road wheels say "tracked vehicle" at any size. The wheels are holes cut with
`evenodd`, not shapes painted in the panel colour, so the glyph survives being
drawn on any background.

The block is a single column, not two. The side panel is ~310px wide whatever the
window is doing, so side-by-side truncated names to "Drajk Co…" — and a container
that narrow cannot be rescued by a viewport media query, because the viewport is
not what is narrow.

Shaped as an **engagement made of rounds**, each stamped with its turn, rather
than a flat record of one exchange. Combat resolves in a single tick today and
whether it should stay that way is unsettled, so if it later spans turns the
rounds append and `status` stays `'ongoing'` — schema and renderer unchanged. A
richer resolver changes the producer, not this.

Nothing is stored on `WorldState`: a report is derived from a tick that already
happened and the journal can regenerate it, so persisting it would be a second
source of truth. The cost is that `briefingFromState` has no battles on a
resumed campaign, which is what a resumed player had before anyway.

> Two things this caught immediately, both invisible in prose. The attacker's
> "before" was being read from the target system, where a fleet still in transit
> reads as zero — so the first version reported a fleet of **0** attacking.
> Rounds now carry per-round deltas, and a test asserts the last round's numbers
> equal what the board actually holds.

## Op vocabulary

Defined in `src/domain/ops.ts`. Two schemas, deliberately:

- **`ModelOpSchema`** — what a model may emit.
- **`OpSchema`** — the full set, including ops only the reducer originates.

| op | notes |
|---|---|
| `transfer_control` | **reducer-only** — absent from `ModelOpSchema` entirely |
| `adjust_disposition` | clamped to −100..100; self-disposition rejected |
| `adjust_fleet` | floors at 0 |
| `adjust_credits` | floors at 0 |
| `set_doctrine` | 1–240 chars; may move `warEthic`/`tradeEthic` and retire lines, charged in dissent; actor's own faction only |
| `issue_order` | see Duration below; optional `onComplete` payload, paid at issue |
| `cancel_order` | returns the unspent part of a works payload |
| `interrupt_order` | rejected when the order is not interruptible |
| `extend_order` | rejected for movement |
| `accelerate_order` | spends credits, drops one Fibonacci bucket, min 1; rejected for movement |
| `form_treaty` | **extraction-only** — absent from `ModelOpSchema`; a treaty needs the other party's consent |
| `establish_commitment` | optional `incomePerTurn`, trimmed to `MAX_COMMITMENT_INCOME` |
| `establish_debt` | **extraction-only** — a principal that depletes; trimmed to `MAX_DEBT_PRINCIPAL` |
| `forgive_debt` | creditor only; writes off the balance and buys goodwill |
| `spawn_event` | |
| `log_narrative` | |

### Why `transfer_control` is reducer-only

Control of a system changes **only** when a `fleet_movement` order physically
arrives. This is enforced three times over: the op is not in the model's schema,
the reducer rejects it from a `'model'` source, and arrival resolution is the
sole caller. A model cannot talk itself into owning a system across the galaxy.

Rejection codes: `unknown_op`, `schema_invalid`, `reducer_only`,
`unknown_faction`, `unknown_system`, `unknown_order`, `unknown_commitment`,
`unknown_treaty`, `unknown_agent`, `commitment_conflict`, `no_presence`,
`unreachable_target`, `missing_duration`, `insufficient_credits`,
`not_interruptible`, `illegal_value`, `doctrine_refusal`, `needs_consent`,
`declared_only`, `unknown_debt`.

---

## Duration: two sources, strictly separate

### 1. Deterministic — fleet movement

Cost is **computed**, never estimated: one turn per jump on the shortest
hyperlane path (BFS, neighbours visited in sorted order so ties break
identically on replay).

If a model returns `durationTurns` for a `fleet_movement` order, it is
**discarded**, recomputed, and the discard is logged to `eventLog` and to the
returned notes.

### 2. Estimated — everything else

The model proposes a duration from **1, 2, 3, or 5** turns — Zod-enumerated, so
any other value is a schema rejection and a retry. Buckets coarsen as they
lengthen because estimate uncertainty grows with scope; there is no 4.

**Nothing takes longer than 5 turns.** A campaign runs for tens of turns, so a
21-turn programme was work whose result the player never lived to see — it read
as a dead end rather than a long game. The scale was rescaled rather than
truncated: 5 is now the ceiling that a shipyard or a capital-ship programme
occupies, not a shortened version of a longer scale.

The order's `type` **is** its duration category, so the two taxonomies cannot
drift apart. Categories: `courier`, `decree`, `political_maneuver`, `espionage`,
`counter_intelligence`, `blockade`, `treaty_ratification`, `garrison_raising`,
`fortification`, `refit`, `retooling`, `construction_infrastructure`,
`capital_ship_construction`, `industrial_conversion`.

**Anti-drift, in three parts:**

1. `prompts/duration-rubric.md` — anchored examples per bucket (1 = a courier
   run; 3 = raising a planetary garrison; 8 = building a shipyard; 21 =
   converting a sector's industrial base). Loaded into every prompt that
   estimates.
2. **Category floors enforced in code**, not in the prompt — `CATEGORY_FLOORS`
   in `src/domain/duration.ts`. Capital-ship construction cannot resolve as 1
   however the order is phrased. Clamping is **upward only**, and every clamp is
   logged (`kind: 'clamp'`) so the rubric can be tuned from real cases.
3. Estimates are set **once at issue time** and never re-rolled per turn.

A prompt can be argued out of its own rules; code cannot. That is why the floors
live in TypeScript.

### 3. What a finished order does — `onComplete`

For most of this project's life, **completing an order changed nothing at all.**
Non-movement completion ran a `logEvent` and a report entry and stopped. Twelve
of the fifteen duration categories had no reader anywhere outside
`duration.ts`: `garrison_raising` raised no garrison, `fortification` fortified
nothing, `industrial_conversion` converted nothing. A probe ran four kinds of
work to completion and found strategic value, income and garrison identical to a
world where no order was ever issued — the garrison movement it *did* see was
passive `GARRISON_REGROWTH`, which is why the tests compare a payload against
**the same order without one** rather than against the starting state.

The consequence was that economic development was the one strategy in the game
with no mechanical existence, and `durationTurns` meant nothing for those twelve
categories: an effect had to be emitted up front (making the duration theatre)
or never land at all.

An order now carries an optional `onComplete` payload — `src/domain/development.ts`
for the bounds and pricing, `OrderEffectSchema` in `state.ts` for the shape:

| kind | does | allowed on |
|---|---|---|
| `develop_system` | +1–2 `strategicValue`, and at 7 the world **becomes a trade hub** | `construction_infrastructure`, `industrial_conversion`, `retooling` |
| `raise_garrison` | garrison up now, to the world's ceiling | `garrison_raising`, `fortification` |
| `fortify` | `garrisonMax` up — capacity regrowth can never add | `fortification`, `construction_infrastructure` |
| `commission_ships` | hulls delivered at the target on completion | `capital_ship_construction`, `refit`, `retooling` |

The eight remaining categories carry **no** payload on purpose: `espionage`
lands as `deploy_agent`, `treaty_ratification` as `form_treaty`, and `blockade`
and `commerce_raiding` are read live off `pendingOrders` by `trade.ts` while they
run. A payload there would be a second mechanism competing with one that works.

#### Why this is not "the model rewrites state, on a delay"

A payload a model picks freely is a model choosing its own payoff. Four bounds,
all in code:

1. **The vocabulary is closed** — four kinds, all arithmetic on one system.
   Nothing here can transfer control or reach another faction.
2. **The category must permit the kind.** This is the link that did not exist:
   the order's type is already its duration category, so a development payload
   inherits a development category's floor and cannot land in one turn however
   the action is phrased. A `courier` run cannot develop a world.
3. **Magnitude is capped** per kind and over-asking is **trimmed with a note**,
   the same shape as `billConstruction`.
4. **It is paid for at issue time.** The treasury is debited when the order goes
   out, so a payoff cannot exceed what the faction could afford to commission,
   and an interrupted programme has real money sunk in it.

#### A fifth bound: the check that carried the payload

The four bounds above are all about *magnitude*, and none of them knows whether
the action worked — `applyOps` has never been told the check, so
`OUTCOME_GUIDANCE`'s "a failure emits the ops for what the attempt COST and NOT
the ops for the thing the player wanted" was a promise made in a prompt and
nowhere else. Seen live as Arkanis: a `fortification` action failed its
`industry` check, the narrative said the walls stood exactly as thick as that
morning, and the batch contained the cost **and** the three-turn order, labelled
"(stalled)". That one was harmless only because it carried no payload. Measured
with one: a `develop_system +1` at slu-2, emitted in a batch the player was told
was a failure, crosses `HUB_THRESHOLD` five turns later and takes Meridian's net
from 309 to **519, permanently**, with zero rejections.

This is the combat leak running the other way — there the model fabricated
losses on a failure, here it banks gains on one — and the fix is the same shape.
`boundPayloadsToOutcome` is applied in `stageWithCorrection`, which knows the
band, **to the correction batch as well as the first**, since a retry that
re-emitted the payload would otherwise be the hole:

| band | payload |
|---|---|
| `critical_success` · `success` | untouched |
| `partial` | halved, floored, minimum 1 — "a reduced result and a bill" never enforced the reduced half |
| `failure` · `critical_failure` | stripped, with a note |

The **order itself is never dropped**, only its payload: a failed attack must
still be issued, which is the whole of the combat fix. And stripping happens
before the reducer prices the payload, so a stripped payload is never charged
for — the price exists to bound the payoff, and with no payoff there is nothing
to bound. Charging for a commission never placed would invent a cost the player
was never quoted; what a failed attempt costs is whatever the resolution call
emits for it.

A sixth guard closes a hole the value-based pricing below opened: the payload
requires the faction to **hold the target or have ships over it**, the same
presence line interdiction and suborning draw. Because the price is the *actor's*
marginal income, a development on a rival's world costs the floor — the actor
gains nothing from it — while the rival keeps the improvement. Presence makes
that unreachable rather than merely unwise.

Recalling your own order (`cancel_order`) returns the materials not yet cut
into, pro-rata — the same principle that brings a recalled fleet's ships home. An
`onInterrupt: 'partial'` refunds the unspent portion; `'cancel'` means the work
was destroyed rather than stood down, so the money is sunk and the note says so.

#### Development is priced from what it is worth, not per point

The first pricing attempt was a flat 80 credits per point of `strategicValue`,
reasoned from territory income: a point pays `INCOME_PER_STRATEGIC_POINT` (7) a
turn, so 80 is an eleven-turn payback. **That was wrong by a factor of
twenty-five**, because `strategicValue` also sets route volume and at
`HUB_THRESHOLD` a world *becomes a hub*, opening a lane to every other hub at
once. Measured on the seed, one point is worth:

```
krayt  kes-7  3->4    +7/turn    an ordinary world, slightly better
hutt   kes-2  9->10  +13/turn    already a hub; more volume on its lanes
free   ark-4  6->7   +36/turn    becomes a hub, but a poorly connected one
merid  slu-2  6->7  +209/turn    becomes a hub in the middle of everything
```

A 30-turn reinvestment run at the flat price took Meridian's net from 283 to 952
for 1,120 credits of total spend — payback under two turns, and permanent.

`developmentCost` now computes the marginal income of the exact development
proposed, on the actual board, and charges `DEVELOPMENT_PAYBACK_TURNS` (12) of
it, floored at `MIN_DEVELOPMENT_COST`. Routes are pure and derived, so this is
ordinary arithmetic and replays exactly; it needs no per-case tuning constant,
the same way `subornLimit` and `successChance` need none. The same run now costs
7,968 credits over seven programmes, leaves the treasury behind a hoarding
control until about turn 25, and reaches its ceiling because `strategicValue`
caps at 10 per system — bounded, not exponential.

> **What the probe cannot model:** nobody attacks these bots. A power that spends
> twenty turns cash-poor to triple its income is taking a risk the harness has no
> way to price, the same caveat that makes it overstate the Nars' runaway.

Because pricing is nonlinear, affordability is walked down a point at a time
rather than divided — the second point of a development can cost many times the
first if it is the one that crosses into hub status.

---

## Turn loop

There are exactly **two kinds of action**: general actions, and diplomatic
chats. Both are *declared* while time is paused and both land on the **next
timestamp**. Time advances only on `:endturn`.

### Two actions a turn

`ACTION_POINTS_PER_TURN` is **2**, held on `Campaign` and reset by the same
thing that clears the staged batches. Without a limit there is no reason to ever
end a turn except to let orders tick, so a player could resolve a dozen actions
against a frozen board while every NPC waited politely.

Deliberately **not** in `WorldState`. It is a pacing rule about the player's
turn, not a fact about the galaxy: no faction has action points, nothing in the
reducer reads them, and putting them in state would push them through the
schema, every save file and every replay for no benefit. It is counted as
*declarations* rather than staged batches, because a correction pass stages a
second batch and a refusal stages one of its own — `stagedCount` would charge
two points for one order and a point for being told no.

Which outcomes spend one is the part that matters:

| outcome | spends |
|---|---|
| an ordinary action, however it rolls | yes |
| your institutions **refuse** it | **yes** — a free retry would let a player probe their own red lines all day |
| the arbiter rules it **inadmissible** | no — the world never let you attempt it |
| the arbiter **redirects** it to a channel | no — a redirect is not an act, and charging would make it feel like a penalty for asking |

The check runs before the arbitration call, so discovering you are out of turn
costs nothing. Diplomacy is unmetered: a channel already blocks the command line
and End Turn, which is its own pacing.

### Declaring (time paused)

1. Player types free text, or a `:`/`/` command.
2. **Resolution call** — rules + serialized state + action → `{narrative, ops}`.
3. Ops are **staged**, not applied. Rejections surface *now* (with one bounded
   correction call) so a malformed op can be fixed while there is still
   something to do about it.
4. NPCs stay silent. Nothing has happened yet.

### Landing (`:endturn`)

1. Every staged batch is applied to committed state, in declaration order, and
   journaled.
2. **Reaction call** — the 3–4 most affected factions respond **once**, to the
   whole settled turn rather than piecemeal to each action. Skipped entirely
   when nothing was staged (`committed.applied > 0`), so ending a turn to let
   orders tick costs **nothing at all** — which is what makes a long campaign
   affordable: a 27-turn playtest cost $6.77 because most of its turns were
   free. Each faction's
   prompt block contains only the orders **it can observe**, so long projects
   are worth hiding and worth raiding.
3. Income is paid to every faction, every pending order ticks, and whatever
   completes resolves. Orders started this turn therefore do not immediately
   progress.
4. **The briefing updates automatically** (`src/engine/briefing.ts`): treasury and
   net income, what completed, what is under way with a progress bar and ETA,
   what completes *next* turn, and any enemy project you can observe. The
   player should never have to go looking to discover that a shipyard is one
   turn from finishing — multi-turn work only lands as a decision if its state
   is in front of you when you decide. In the browser it is a persistent panel,
   not a line that scrolls away.

Arrivals are the only source of `transfer_control`. Resolution runs through
`resolveBattle`, which is deterministic — the only randomness is `rollD20(turn,
salt)`, so replay reproduces every engagement exactly.

### Battles are fought by coalitions, not duels

Landings are grouped **by target system**, so everything arriving at one world
in one turn fights a single battle rather than a queue of duels.

- **Sides.** Every faction landing this turn is an attacker and their forces
  add. The safe default on the other side: *anyone already present who is not
  attacking defends*, so an uncommitted third party's ships count for the
  defender rather than watching from orbit. A holder reinforcing its own world
  is not an invasion — those ships simply land.
- **Phase 1, the orbitals.** Coalition against defenders, with the best `might`
  modifier on each side. A side outmatched 2:1 breaks off and loses 10–35%
  getting clear — defenders scatter to their own nearest holdings, attackers
  fall back down each contingent's own path. Otherwise both sides trade losses,
  distributed proportionally across contingents. **A surviving defending fleet
  means no landing is attempted at all.**
- **Phase 2, the ground.** Only once the orbitals are clear. Garrisons are
  dug-in ground troops and **cannot retreat**, so this is fought to a decision.
- **Spoils.** The world goes to the largest *surviving* contingent, ties broken
  on faction id. Junior partners' ships stay in orbit, which leaves the world
  contested and splits its income.

**Unaligned is not undefended.** The seed gives neutral worlds garrisons of
2–5, and they fight a landing exactly as a faction's world would. An earlier
version skipped the ground phase whenever `controllerFactionId` was null, which
made every neutral in the galaxy a free pickup *and* handed the conqueror the
militia it had never fought. A world with nobody in orbit and nobody on the
ground is the only thing taken unopposed.

### Two states

| | |
|---|---|
| `campaign.committed` | the journal's truth; only `commitTurn`, `commit` and `tick` advance it |
| `campaign.state` | committed **plus staged** — what the UI draws and what prompts read |

The preview exists so that declaring two actions in one turn cannot spend the
same credits twice, and so the player sees the consequence of a declaration
immediately. Because `applyOps` is pure, replaying the staged batches against
committed state at commit time reproduces the preview exactly — asserted in
`tests/replay.test.ts`.

Staged actions are deliberately **not** in the journal, so they do not survive a
save; `:quit` says so rather than losing them quietly. `:staged` lists them and
`:discard` clears them.

---

## Diplomacy

`/talk <faction>` opens a persistent channel with its own message history and a
persona prompt built from that faction's doctrine, disposition and position.
Past transcripts are replayed into the persona, so factions remember.

**The hard boundary:** chat does not advance the turn and emits **no ops**. The
diplomacy schema has no `ops` field at all — the boundary is structural, not an
instruction a model could be talked out of.

**A faction can ask to talk.** `openChannel` is set in exactly one place,
reachable only from a player POST, so for most of this project's life **only one
of the five powers could ever start a conversation** — a complete consent
mechanism that four of the powers it exists to bind could not invoke.

A reaction may now carry an `approach`: an opening line and the subject. It is
an **invitation, not a channel**. It appears in the turn the player has just
ended, when they cannot act anyway, and they open the channel themselves if they
want it — because a channel disables the command line and End Turn, so opening
one unbidden would hijack a turn the player did not choose to spend. It rides on
the reaction rather than costing a call of its own: the NPC is already speaking
at exactly the right moment, and asking separately would pay twice for one
thought.

On `/endtalk`, a **separate extraction call** reads the transcript and emits ops
for what was actually agreed. It is the **only** pass that may emit
`form_treaty`: a treaty binds a power that is not the actor, and a transcript is
the only place that power's consent exists. A treaty asked for as an ordinary
declared action is redirected here rather than rolled for. An NPC may promise anything in dialogue; only the
extraction pass produces ops. Those ops are **staged like any other action**, so
a treaty lands on the same timestamp as everything else declared this turn
rather than jumping the queue. Transcripts live beside the journal, not inside
world state — they are conversation history, not world facts.

Extraction is deliberately conservative: a rejected offer, an unanswered offer,
and a conditional promise all produce nothing. Deception still counts as agreed
— betrayal is a later move, not a reason to void the deal.

---

## Prompts

Versioned `.md` files under `prompts/`, never inline strings, so a prompt change
is a reviewable diff that can be replayed against a recorded campaign.

| File | Used by |
|---|---|
| `resolution.md` | resolving player actions |
| `reaction.md` | NPC responses |
| `diplomacy-persona.md` | in-channel dialogue (emits no ops) |
| `extraction.md` | turning a transcript into ops |
| `duration-rubric.md` | appended to every prompt that estimates duration |
| `flavor.md` | Haiku-tier colour text |

### Prompt contract

Every state-changing call returns:

```jsonc
{ "narrative": "2-4 sentences", "ops": [ /* ModelOpSchema */ ] }
```

Reactions wrap this as `{ "reactions": [{ "factionId", "narrative", "ops" }] }`.

Two layers of defence against malformed output:

1. `outputFormat: { type: 'json_schema' }` — the schema (from
   `z.toJSONSchema(..., { io: 'input' })`) is handed to the model, so shape is
   enforced at generation time.
2. Zod re-validation with up to **2 retries**, feeding the exact validation
   error back into the prompt. Layer 1 guarantees shape; only layer 2 catches
   semantic problems — an unknown faction id, a duration off the scale — that no
   JSON schema can express.

---

## Model routing

`src/model/router.ts` is the only place tiering lives. One edit changes it.

| Call | Tier | Model |
|---|---|---|
| resolution, reaction, diplomacy, extraction | `reasoning` | `claude-sonnet-5` |
| breach relevance | `flavor` | `claude-haiku-4-5-20251001` |
| flavour text | `flavor` | `claude-haiku-4-5-20251001` |

Every call is single-shot JSON with `tools: []` and `settingSources: []`, so no
agentic loop runs and the developer's own `CLAUDE.md`/settings never leak into
campaign output.

### Why `maxTurns` is not 1

Under `outputFormat: json_schema` the SDK returns the result through an
**end-turn tool** — a `tool_use`/`tool_result` carrier — and that costs an
agentic round trip of its own. A budget of 1 leaves no room for the model to
write anything before the carrier, so calls die with *"Reached maximum number of
turns (1)"*; in practice this fired constantly during diplomacy, where replies
are longest. The tiers allow 6 (reasoning) and 4 (flavour). Nothing can run away,
because `tools: []` means no real tools exist.

Transient failures — turn-budget overruns, overload, a dropped stream — consume
the same retry budget as a schema violation. Only `NotLoggedInError` is fatal on
the first attempt, since retrying it cannot help.

---

## Campaign archives

A campaign can be exported from the browser as a single `.tar.gz` and resumed
from a terminal on any machine:

```bash
pnpm resume ~/Downloads/mycampaign-2026-08-09-14-02.tar.gz
```

That verifies the archive, installs it into `saves/`, and starts the server
with the campaign already loaded — the round trip is one command, not a save
file to hand-place.

| | |
|---|---|
| UI | an **Export** button in the topbar, plus `:export` |
| CLI | `pnpm resume <file>` · `--as <name>` · `--no-serve` · `--inspect` |
| HTTP | `GET /api/campaign/export` · `POST /api/campaign/import` |

**Contents** — `manifest.json` (name, turn, player, export time, format
version), `campaign.json` (the same save file the game already writes), and a
`README.txt` so the file explains itself without the game.

**The archive is transport, not a second source of truth.** Inside is the
journal, and the journal is the campaign. That is what makes an archive
*verifiable*: `unpackCampaign` replays it from turn 0 before anything is
written, so a corrupt file is refused rather than landing half-adopted. Every
failure is a sentence written for someone holding a file they hope is a save —
"that file is not gzip-compressed", not a stack trace.

Staged actions are **not** included, because they are not in the journal — the
same reason they do not survive a save. The UI says how many were left behind
rather than dropping them silently.

`src/engine/tar.ts` is a hand-rolled ustar reader/writer, about 120 lines. The
alternative was a dependency in the trust path of a file the user is invited to
hand back to the game, for a slice of the format that is genuinely small. It is
verified against system `tar`, and the reader rejects `..` in a path even
though it only ever returns entries in memory.

---

## Balancing: doctrine bots, not spreadsheets

`src/balance.ts` plays five bots — one per faction, each following its declared
doctrine as literally as the mechanics allow — against the real reducer with no
model calls. `pnpm balance 30` prints income, territory and standing over time.

Balancing against turn-0 ledgers was measuring the opening position rather than
the game. What matters is whether a doctrine *pays when played*, and the
harness caught four things staring at ledgers never would:

- **Raiding earned Drajk exactly 0 over thirty turns.** Raiding required ships
  *in* the target, so the poorest power could only prey on powers it had
  already beaten in orbit — the precise inversion of what commerce raiding is
  for. Raids now run from one jump out; blockades still have to sit on the
  system. That distinction is the fix.
- **Every bot ground down to a net of ~0 with a huge fleet**, because they
  bought hulls whenever they could afford to. That was the bots being stupid,
  but it hid the economy completely. They now buy toward a fleet their income
  carries.
- **The extortionist ran away** — 302/turn and an untouchable treasury —
  because tolling cost it nothing politically. `TOLL_RESENTMENT` now bleeds
  disposition with every power it taxes, so the Combine gets rich and everyone
  it squeezes gradually decides something should be done about it.
- **`ENDPOINT_SHARE` was the real lever, not `TOLL_RATE`.** Sweeping both over
  played 30-turn runs, the toll rate barely moved anything (it is ~20 credits
  of a 280 lane income); shifting value from transit hops to hub endpoints
  spread it over eight hubs held 2/2/2/1/1 instead of concentrating it on the
  Kessel spine.

`tests/balance.test.ts` asserts the properties rather than the numbers —
nobody eliminated, nobody holding half the map, trade between 20% and 50% of
income, and each doctrine's signature mechanic actually earning something.
Loose bounds on purpose: a tight assertion on a balance number is a test people
learn to ignore.

**What the harness cannot model:** the bots do not react to disposition. The
Nars finish hated by everyone and nobody invades them, so the harness
overstates their runaway — the counterplay their position invites is political,
and politics is what the model-driven game supplies.

---

## Deterministic replay

`src/engine/journal.ts` records every op batch and every tick. `replay()`
rebuilds state from turn 0 by re-running the reducer — **no model calls**.

`Campaign.verifyReplay()` compares live state against replayed state and is
asserted in the test suite. This is what makes prompt changes evaluable: run the
same journal before and after a prompt edit and compare the worlds produced.

Determinism depends on three things, all tested:

- Order ids derive from turn + sequence, never a clock or RNG.
- BFS visits neighbours in sorted order.
- Arrival combat is arithmetic, not chance.

---

## Architecture: server and browser

```
browser (web/)                    server (src/server/)            engine
─────────────────                 ────────────────────            ──────
React + Vite          ──POST──▶   dispatch(method,path,body)  ──▶  Campaign
  renders state       ◀──JSON──   GameSession                      applyOps
  posts intents                     │                              tickTurn
  never computes                    ├─ model calls (src/model/)
  game state          ◀───SSE───    └─ EventHub: progress, state
```

**The client renders and posts intents; it never computes game state.** The
reducer is the only thing allowed to, and it lives server-side.

### Why the split falls where it does

`src/model/` **must** stay on the server: it spawns the Claude Code binary and
injects a subscription OAuth token. That token never reaches the browser, is
never embedded in client JavaScript, and is never served as a file.

`src/domain/` is pure and shared. The browser imports it directly — the same
`applyOps`-adjacent helpers (`ledgerFor`, `systemIncome`, `effectiveStats`,
`treatiesFor`) that the server uses to compute state are used by the client to
*display* it, so the two can never disagree about what a number means.

### The contract

`src/api/contract.ts` is Zod-first and imported by both sides, so there is
exactly one definition of every message. A drift becomes a type error rather
than an undefined field three components deep. Domain schemas are imported,
never restated: if `WorldState` gains a field, it appears in the contract
automatically.

| route | purpose |
|---|---|
| `GET /api/campaign` | the whole `CampaignView`; **409 `no_campaign`** on a cold start |
| `POST /api/campaign/new` · `/resume` | start or load |
| `GET /api/factions` | playable powers + saved campaigns |
| `POST /api/action` | declare — resolves now, lands on `:endturn` |
| `POST /api/endturn` | commit, react, tick |
| `POST /api/staged/discard` | all, or one by `index` |
| `POST /api/talk/:id` · `/api/endtalk/:id` | dialogue, then extraction |
| `GET /api/events` | SSE: `hello`, `progress`, `state`, `error` |

### Server rules

- **Binds to 127.0.0.1 only.** This process spends real money and has no
  authentication, because it is single-player on your own machine — which is
  exactly why it must never be network-reachable.
- **No CORS headers**, deliberately. A permissive policy would let any page in
  the browser drive a game that costs money.
- **One campaign per process.** There is no tenancy model; `GameSession` is not
  safe to share between users.
- **A busy guard refuses rather than queues.** Staging assumes ordered
  declarations, so a second model call while one is in flight gets a **409
  `conflict`** — which the client treats as expected, disabling input rather
  than showing an error.
- **`dispatch(method, path, body)` is the testable seam** — no `req`/`res`, so
  the whole API is exercised without binding a port.
- Path traversal is blocked in three places: campaign names, faction ids in
  URLs, and static file paths.

### Browser client

`web/`, built by Vite to `dist/web`, which the server serves when present.

- **Map** — SVG, from `src/ui/layout.ts`. That module returns a unit-width
  space (`x` 0–1, `y` 0–`aspect`) so the geometry is testable without a DOM.
  Lanes inside one power's territory take its colour; borders stay grey. Zoom,
  pan, click-to-select, hover tooltips, sector filter, fleets drawn along their
  path with an ETA.
  `MIN_ASPECT`/`MAX_ASPECT` stop a nearly-collinear sector (the Kessel Fringe)
  collapsing to a hairline or a tall one becoming a column.
- **Fleets** — every hull by system, with a section for the rows that matter
  most: worlds where presence and ownership differ. Presence is not ownership
  here — a fleet parked in a neutral or rival system collects income, contests
  it, blockades lanes and can suborn crews without owning anything — and
  nothing else in the UI answered "where are my ships, and whose are sitting on
  mine". Hulls in a system their owner does not hold are marked `*`.
  (Class is `.fleet-panel`, not `.fleets` — the SVG map layer already owns that.)
- **Panels** — Factions (a portrait thumbnail ringed in the faction's colour,
  stat bars, ethics, disposition, `talk`), System (ships
  and income *per faction*, lanes, orders), Orders (progress + ETA), Treaties
  (terms, turn limits, wars, agents with effect and success chance), Log
  (filterable — `rejection` and `clamp` entries are debugging gold, so they are
  filterable rather than hidden).
- **Briefing** — persistent, not printed once. Treasury, net income, what
  completed, what is under way with ETA, observable enemy work. Reconstructed
  from state on resume via `briefingFromState`.
- **Channel** — diplomacy gets its own surface, in the faction's colour, with
  the boundary stated on screen. While it is open the command line and End Turn
  are disabled, mirroring the server-side rule. Opening one also **replaces the
  map with the other power's portrait** (`PortraitStage`): the map is what you
  read while moving fleets, and a conversation is not that, so swapping the
  whole stage makes the mode change unmissable — which matters precisely because
  a channel disables the command line, behaviour a player otherwise discovers by
  finding their input dead. Gated on the same `activeChannel` the panel uses,
  not on the server's `openChannel`, which is only set once a message has
  actually been sent; gating on the latter left the map up through the entire
  first exchange. Art lives in `web/public/portraits/<factionId>.jpeg` — named
  by **id**, not display name, since the two diverged long ago — and a missing
  file falls back to the faction's name rather than a blank slab.

  The same five images are cropped to 26px faces in the Factions panel
  (`FactionAvatar`), which is what makes the channel portrait a *recognition*
  rather than an introduction: before it, the five powers were told apart by a
  colour chip and a name, and their faces were only ever seen at the moment of
  negotiation. The crop began as one focal point for all five, on the reasoning
  that the set was generated to a single framing brief — close, but not true.
  The Vigil, the Combine and Drajk sit two or three percent right of centre, and
  the 3x zoom multiplies that into a head visibly against the right edge of the
  circle, while Meridian and Arkanis looked correct — which is exactly why the
  assumption survived the first look.

  The second version fixed that and broke something else: **centring a face and
  covering the circle are different requirements.** At 3x the art is only 1.67
  boxes tall, so a head a quarter down wanted a *positive* top offset, which
  pushed the picture below the top of the circle and left a bar of panel
  background across three of the five. The geometry now lives in
  `src/ui/portrait.ts` — pure, beside `layout.ts`, and tested: a five-entry
  table of measured focal points, a zoom large enough that those points are
  reachable, and offsets clamped so the image can never uncover the box whatever
  focal point is handed in.

  A third pass added a **per-faction zoom**, because the portraits are not shot
  at the same distance: the Iron Vigil's is a closer composition, his head
  spanning ~44% of the image height against 26–39% for the rest, so at a shared
  zoom his face loomed out of the circle. Scale is not something a focal point
  can correct. Only the factions that need an override carry one. Both faults were found by looking at the screen, not
  by the suite, which is what the tests now guard. A missing file falls back to
  the colour chip, because a faction row must never render as a hole.
- **Outcome art** — one image for each way a declaration produces no ordinary
  result. Five, all typed fields on `ActionOutcome`: `refusal` (your
  institutions will not carry the order out), `defiance` (they objected and did
  it anyway), `negotiation` (it is not yours to declare), `inadmissible` (the
  world does not permit it) and `outOfActions` (the turn's allowance is spent).
  The first three fire on **both** paths a declaration can take — a declared
  action and an accord closed with `/endtalk` — so one renderer covers both; the
  last two are declared-action only, since there is no admissibility ruling on
  an accord and diplomacy is unmetered. `OutcomeArt` reads a kind and a
  caller-supplied `alt`, and a missing file renders **nothing at all**, falling
  back to the text treatment that carried these outcomes before there was any
  art — which is why the two newest kinds could ship their wiring before their
  images exist.

  Deliberately **not** on the list: the five check bands. Every rolled action
  produces one, so imagery there becomes wallpaper and stops meaning anything.
  These five are the ways an action produces *nothing*, which is what is worth
  marking.

  They deliberately do **not** match the portrait set's painterly register, and
  all three carry text. A portrait exists to be recognised as a person you are
  negotiating with; these exist to communicate an idea — *this was vetoed*,
  *this cost you standing*, *this needs someone else in the room* — and reading
  in a second is worth more here than matching a house style.

  In the **feed**, not on the stage. A channel is a mode and earns the whole
  stage; an outcome is a beat, and taking the map away for it would overstate
  it. The image is carried on the message rather than pushed as an entry of its
  own, because the feed trims from the front at 500 and would otherwise be able
  to behead a scene and leave its caption. The `alt` text carries the breached
  line, so the picture is never the only record of what was crossed — and the
  client no longer *says* that line as well, since both refusal paths have
  always carried `Breached: …` in their notes and it was being printed twice.

  Building it found that the boundary was leaking the other way: `closeChannel`
  has always ruled on an accord — a red line refuses the whole thing, a
  compulsion lets it stand and charges — and `GameSession.endTalk` returned
  `refusal: null, defiance: null` literally, so a refused accord reached the
  browser as an ordinary narrative. The ruling was correct, priced and
  invisible. Both are now passed through, and the same renderer covers the
  declared-action path and the diplomacy path.

- **Progress** — model calls take 5–15s, so the server names what it is doing
  and the client shows that label verbatim. Without it the app looks broken
  while working perfectly.

`src/ui/` holds `layout.ts`, `portrait.ts` and `ansi256.ts` (faction colours are ANSI
256 indices; the browser needs hex).

## Cost

Measured live, on the current prompts and tiers:

| call | model | time | cost |
|---|---|---|---|
| arbitration | Haiku | ~7–13s | ~$0.017 |
| resolution | Sonnet | ~20–30s | ~$0.056 |
| **one declared action** | | **~33s** | **~$0.073** |
| end of turn (reactions + tick) | Sonnet | ~38s | ~$0.14 |

A two-action turn is about **100 seconds and $0.29**; a ten-turn campaign is
roughly **$3** and half an hour. Reactions are one call per *turn*, not per
action.

### How it got there, because the mistakes are instructive

It was **95s and $0.157 per action** before this pass, against ~$0.045 claimed
in this file — the earlier figure was simply wrong, and correcting it is what
prompted the work. Three things, in order of size:

1. **Extended thinking dominated everything.** Arbitration was emitting ~2,700
   output tokens of thinking to return two numbers and a clause, taking 37
   seconds. The SDK defaults to `effort: 'high'` with thinking on, which suits
   open-ended agentic work and not a bounded classification against a rubric.
   `TierConfig` now carries `effort` and `thinking`: the flavour tier disables
   thinking outright (37s → 11s, rulings unchanged — the dynastic-marriage
   exclusivity case still returns the same DC), and the reasoning tier runs at
   `medium`.
2. **`resolution.md` had grown to ~4.8k tokens and a fifth of it was stale.**
   The whole "the dice have already been rolled" section still told the model
   to choose the stat and difficulty itself — work that moved to arbitration —
   while the user message told it the outcome was already settled. Conflicting
   instructions, paid for on every internal round trip. Rewritten at 8.3k
   chars from 19.3k.
3. **`ResolutionOutputSchema` still had a dead `check` field**, so the model
   spent tokens filling something nothing read.

What was *not* the problem, having been measured: process startup (~3s), the
serialized state document (~1.8k tokens), and the model tier.

**The remaining floor** is the agentic loop: under `outputFormat: json_schema`
the SDK returns through an end-turn tool, so every call costs two turns and
re-sends its context. A trivial call still takes ~7s for that reason.

## Layout

```
src/
  domain/     state, ops, duration, development, graph, checks, diplomacy,
              arbitration, compulsions, debt, trade, reducer
              ← pure. No I/O, no network, no imports from engine/model/ui.
  api/        contract.ts — Zod schemas shared by server and browser
  engine/     campaign, store, journal, turn, briefing
  model/      client, router, prompts, serialize, calls, auth, binary
              ← server-only. Spawns the binary, holds the token.
  server/     index (node:http), router, session, events, static, errors
  seed/       the 25-system Outer Rim scenario
  ui/         layout.ts (pure map geometry), portrait.ts (avatar crops)
              + ansi256.ts
web/          React + Vite client → dist/web
prompts/      versioned .md prompt files
tests/        domain, engine, server, contract, layout, parity — all headless
docs/         phase-2 prompt series and progress
```

`src/domain` has no network dependency and no I/O. The suite sets
`PAXGALACTICA_NO_NETWORK=1`, and the model client throws if a call is attempted
under it — a test that reaches the network fails loudly rather than billing
tokens.

**The suite is typechecked, by `tsconfig.tests.json` and `pnpm typecheck:tests`.**
It cannot be folded into the main config, which emits to `dist` from
`rootDir: src`; so for most of this project's life `tests/` was in that config's
`exclude` list and was never typechecked at all. What that hid: a test importing
a constant from a module that does not export it gets `undefined` at runtime
rather than a compile error, so `for (let i = 0; i < MAX_CHANNEL_MESSAGES; i++)`
silently looped **zero** times and the test passed while asserting nothing. Four
more files imported the `Op` type from `state.ts`, where it has never lived, and
three agent fixtures set `placedTurn` and `label` — neither of which is a field
on `Agent` (they are `deployedTurn` and `cover`). All harmless by luck, none
detectable by running the suite.

`OpInput` exists for the same reason the JSON schema is generated with
`{ io: 'input' }`: `Op` is the *parsed* shape, so every field with a `.default()`
is required on it, which is right for reading an op out of state and wrong for
writing one down. Fixtures and hand-built batches want the input type.

## Conventions

- Zod schemas are the source of truth; TypeScript types are inferred from them.
- The reducer never throws. Bad input becomes a structured rejection.
- `applyOps` never mutates its input.
- New op? Add to `ops.ts`, handle in `reducer.ts`, cover both the success and
  the rejection path in `tests/reducer.test.ts`, and document it here.
- New duration category? Add to `DURATION_CATEGORIES`, give it a floor in
  `CATEGORY_FLOORS`, add an anchor to `duration-rubric.md`, and decide in
  `EFFECT_CATEGORIES` whether it can deliver an `onComplete` payload — a
  category that can carry none is a category whose completion does nothing.
- New order effect kind? Add it to `OrderEffectSchema`, give it a cap in
  `EFFECT_CAPS`, a price, the categories that may deliver it in
  `EFFECT_CATEGORIES`, and a branch in `applyOrderEffect`. Price it against what
  it is actually worth on the board, not per unit — see `developmentCost` for
  why a flat price was wrong by 25×.
