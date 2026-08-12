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
| `pnpm typecheck` / `typecheck:web` | the two tsconfigs — **Vite does not typecheck** |

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
three questions: may this be attempted at all, what does it test, and **does it
establish something lasting**.

`admissible: false` ends the action immediately: no roll, no ops, no
resolution call. It is reserved for actions that contradict something already
true, need something that is not there, or are impossible in the fiction —
*not* for "unlikely" (that is difficulty) and not for "out of character" (that
is a refusal, decided later by the faction itself).

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
  `mercenary`. Decides whether force is on the table at all.
- **`tradeEthic`** — `free_trade` · `monopolist` · `extortionist` · `autarkic` ·
  `smuggler`. Also sets the income multiplier, so commerce beliefs have a
  mechanical price.
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
| `monopolist` | premium on lanes it owns both ends of |

The seed already had the geography for this and nothing read it: kes-2 sits on
74 of the galaxy's 300 shortest paths and the extortionists hold it; three more
high-traffic junctions are unaligned.

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

`basing_rights` fixed something worse than an inert field: **there was no way
to station ships in friendly space at all.** Any movement into a partner's
system resolved as an attack on them.

## Faction lines are enforced, not suggested

Red lines stop a faction acting out of character. **Compulsions** stop it
failing to act in character — an Iron Vigil leader who sits passive while rebels
hold Imperial ground is not being cautious, and the fleet commanders say so.

The resolution call may return a `refusal` instead of ops. When it does,
`submitAction` stages **nothing**: an order the fleet will not carry out is not
a smaller version of that order, it is no order at all. This is distinct from a
failed check (attempted, went badly) and from a rejected op (malformed).
`dissent` tracks how far a leader has strayed. It rises `REFUSAL_DISSENT` (8)
per refusal, decays 2 a turn, and subtracts one point from **every** stat per
25 — so one refusal fades in four turns and a pattern of them does not.

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
| `set_doctrine` | 1–240 chars |
| `issue_order` | see Duration below; optional `onComplete` payload, paid at issue |
| `cancel_order` | returns the unspent part of a works payload |
| `interrupt_order` | rejected when the order is not interruptible |
| `extend_order` | rejected for movement |
| `accelerate_order` | spends credits, drops one Fibonacci bucket, min 1; rejected for movement |
| `establish_commitment` | optional `incomePerTurn`, trimmed to `MAX_COMMITMENT_INCOME` |
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
`not_interruptible`, `illegal_value`, `doctrine_refusal`.

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

A fifth guard closes a hole the value-based pricing below opened: the payload
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
   whole settled turn rather than piecemeal to each action. Each faction's
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

On `/endtalk`, a **separate extraction call** reads the transcript and emits ops
for what was actually agreed. An NPC may promise anything in dialogue; only the
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
- **Panels** — Factions (stat bars, ethics, disposition, `talk`), System (ships
  and income *per faction*, lanes, orders), Orders (progress + ETA), Treaties
  (terms, turn limits, wars, agents with effect and success chance), Log
  (filterable — `rejection` and `clamp` entries are debugging gold, so they are
  filterable rather than hidden).
- **Briefing** — persistent, not printed once. Treasury, net income, what
  completed, what is under way with ETA, observable enemy work. Reconstructed
  from state on resume via `briefingFromState`.
- **Channel** — diplomacy gets its own surface, in the faction's colour, with
  the boundary stated on screen. While it is open the command line and End Turn
  are disabled, mirroring the server-side rule.
- **Progress** — model calls take 5–15s, so the server names what it is doing
  and the client shows that label verbatim. Without it the app looks broken
  while working perfectly.

`src/ui/` now holds only `layout.ts` and `ansi256.ts` (faction colours are ANSI
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
              arbitration, trade, reducer
              ← pure. No I/O, no network, no imports from engine/model/ui.
  api/        contract.ts — Zod schemas shared by server and browser
  engine/     campaign, store, journal, turn, briefing
  model/      client, router, prompts, serialize, calls, auth, binary
              ← server-only. Spawns the binary, holds the token.
  server/     index (node:http), router, session, events, static, errors
  seed/       the 25-system Outer Rim scenario
  ui/         layout.ts (pure map geometry) + ansi256.ts
web/          React + Vite client → dist/web
prompts/      versioned .md prompt files
tests/        domain, engine, server, contract, layout, parity — all headless
docs/         phase-2 prompt series and progress
```

`src/domain` has no network dependency and no I/O. The suite sets
`PAXGALACTICA_NO_NETWORK=1`, and the model client throws if a call is attempted
under it — a test that reaches the network fails loudly rather than billing
tokens.

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
