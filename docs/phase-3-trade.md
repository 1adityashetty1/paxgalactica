# Phase 3 — Trade as a real economy

## The problem

`tradeEthic` has exactly one mechanical effect in the whole codebase: a
multiplier in `ledgerFor`. Everything else about a faction's commercial
character is prose in a prompt.

Three specific failures follow:

1. **`extortionist` is ×1.0.** The Ojjul Nar Combine — one of the two powers
   built around trade — has a defining trait worth precisely nothing, while
   Meridian's `free_trade` is the best multiplier in the game at ×1.3.
2. **Drajk's `smuggler` ×1.1 is a rounding error.** A faction whose entire
   identity is running contraband has no way to *do* smuggling. It is the
   poorest power on the map (sv 14 against Meridian's 30) with no asymmetric
   tool to close the gap.
3. **Treaty types are cosmetic.** Only `incomeShares` and `incomePerTurn` are
   read by any code. `mutual_defense`, `basing_rights` and `shipsPledged` have
   zero mechanical references — `TREATY_TYPE_MEANING` promises "an attack on
   one obliges the other to answer" and nothing implements it. `warsFor` reads
   `treaty.type`, but only to render a panel and fill a prompt: a non-aggression
   pact does not stop an attack.

Underneath all three is one root cause: **income is a property of systems, and
nothing else**. There is no economic object that can be threatened, redirected,
taxed or stolen, so there is nothing for a commercial doctrine to be a doctrine
*about*.

## The map already wants this

Betweenness over all 300 connected pairs, counting how many shortest paths
cross each system:

| system | sv | holder | on N paths |
|---|---|---|---|
| ilv-2 Shalka | 9 | **ojjul** | **74** |
| tor-1 Torrek Anchorage | 7 | **meridian** | 65 |
| ilv-5 Oridin | 5 | ojjul | 55 |
| sek-1 Sekkar Gate | 9 | meridian | 54 |
| sek-6 Neth | 3 | **unaligned** | 52 |
| ilv-4 Vosk Marker | 3 | **unaligned** | 52 |
| sek-2 Corvid | 6 | meridian | 47 |
| ark-2 Sennex | 4 | **unaligned** | 44 |

The seed already put the extortionist on the single greatest chokepoint and the
free traders on the second. It already left three high-traffic junctions
unaligned. It already gave Drajk the two inter-sector back doors
(ark-5↔ilv-7, tor-6↔ilv-6) while the main crossings run through Nar and
Meridian space. There are only **10 inter-sector lanes** in the entire galaxy.

None of this is currently read by anything. The overhaul is mostly a matter of
letting the economy see the graph the map is already drawn on.

---

## The core model: trade flows on hyperlanes

A **route** is the shortest hyperlane path between two **hubs** (systems with
`strategicValue >= 7` — eight of them: sek-1, tor-3, ilv-2, sek-4, ilv-1,
ark-1, tor-1, tor-4). Twenty-eight routes, recomputed from the graph, never
stored.

Each route carries a **volume** from its endpoints, decayed by length, so local
trade is worth more per jump than trade dragged across the galaxy:

```
volume = (svA + svB) × ROUTE_VALUE_PER_SV / (1 + jumps × DISTANCE_DECAY)
```

Volume splits two ways:

- **Endpoints, 50%** — the two hub controllers, as producer and consumer.
- **Transit, 50%** — the controllers of the intermediate systems, in proportion
  to how many hops each holds.

Unaligned segments pay nobody, exactly as `systemIncome` already treats
unaligned worlds — unless someone has ships parked there, which is also already
the existing rule. The two rules stay consistent rather than becoming a special
case.

### This must be a rebalance, not an addition

Total collected income today is ≈1450 credits a turn across five powers. Adding
routes on top would inflate the economy and make `SHIP_COST` meaningless.

**Drop `INCOME_PER_STRATEGIC_POINT` from 12 to 7** and let routes carry the
difference. Roughly 40% of the galaxy's income becomes route-borne — enough
that losing a lane hurts, not so much that one blockade ends a campaign.

This is the riskiest change in the phase, and it is exactly what the replay
harness is for: run a recorded journal before and after and diff the worlds.

---

## What each doctrine then means

| ethic | mechanic | holder |
|---|---|---|
| `free_trade` | Bonus scales with **network openness** — the fraction of *all* routes in the galaxy that are live. Meridian profits from everyone's peace, not just its own, so it has a mechanical reason to broker other people's ceasefires. | Meridian |
| `extortionist` | **Toll.** Takes an extra cut of the transit value of every route crossing its systems, charged against the other beneficiaries. On ilv-2 that is a cut of 74 paths' worth of traffic. | Nar |
| `smuggler` | **Blockade-runner.** Its own routes ignore blockades entirely, and it raids at double effect. The one power that profits from a closed galaxy. | Drajk |
| `autarkic` | Reduced route income, but base income is **immune to blockade and raiding**. Cannot be economically strangled — only conquered. | Vigil, Arkane |
| `monopolist` | Double share on routes where it holds **both** endpoints; reduced share on routes it shares. Rewards a contiguous empire. Currently unused by the seed; implemented so the axis is complete. | — |

Each of these is arithmetic in `ledgerFor` or `routeIncome`, never guidance in
a prompt.

---

## Two new verbs

### `blockade` — the pressure valve

The duration category **already exists and does nothing**. Make it real: an
order against a system, with a committed `force`. While it runs, every route
through that system is severed and nobody collects it.

Exceptions that carry meaning:

- Smugglers' own routes still run.
- `trade_accord` parties are exempt from each other's blockades.
- Autarkic powers' base income is untouched.

Blockading civilian traffic is Meridian's **declared red line**. It becomes a
real sacrifice for the first time, and the refusal mechanic that enforces it
already exists.

### `commerce_raiding` — what Drajk is for

A new duration category (floor 1, typical 2–3). An order against a system with
a committed force. Each turn it runs, the raider diverts a share of that
system's transit value from whoever was collecting it.

- Smugglers raid at **double** effect; anyone *can* raid, Drajk is *good* at it.
- The raiding force is physically present, so it can be attacked like any
  other fleet. Raiding is not free.
- It costs disposition with every victim, every turn, and is visible in their
  logs. This is an act of war conducted without a battle.
- Efficiency comes from a guile check resolved **in code** at issue time, on
  the same discipline as every other check.

This is what makes the poorest faction on the map playable: Drajk cannot win a
fleet engagement against Meridian, but it can bleed it.

---

## Treaties that do something

| type | effect to implement |
|---|---|
| `non_aggression` | Attacking a party auto-breaks it: the existing −25, **plus** a galaxy-visible betrayal costing the breaker −10 with every other power. Treachery gets a price. |
| `mutual_defense` | `shipsPledged` becomes live: the ally's ships within N jumps are committed to the defence in `resolveBattle`, and the ally's disposition toward the attacker collapses. |
| `trade_accord` | Routes between the parties are immune to each other's blockades and raids, and shared endpoints get a volume bonus. The trade treaty finally about trade. |
| `tribute` | Keeps `incomePerTurn`, and puts the tributary under protection — attacking it triggers the protector's mutual-defence path. |
| `basing_rights` | Movement may **originate from** an ally's system, and transiting one does not start a battle. Real strategic reach. |
| `ceasefire` | `non_aggression` with the expiry it already has. |

`terms.territory` and `terms.shipsPledged` stop being dead fields.

---

## Stages

Each stage ships working, tested, and playable on its own.

| stage | what lands | new files |
|---|---|---|
| **A. The network** | `tradeRoutes()`, `routeIncome()`, hub selection, the 12→7 rebalance, routes in `ledgerFor` | `src/domain/trade.ts` |
| **B. The doctrines** | All five ethics made mechanical | — |
| **C. The verbs** | `blockade` given effect; `commerce_raiding` added, with category floor and rubric anchor | — |
| **D. The treaties** | Every type given an effect; `shipsPledged`/`territory` made live | — |
| **E. Surfacing** | Trade panel, route weight on the map, briefing lines, prompt and `CLAUDE.md` updates | `web/src/components/TradePanel.tsx` |

Stage E is **not** optional polish. A player who cannot see the routes cannot
plan around them, and an economy nobody can see is an economy that reads as
random numbers.

## Risks, and what they cost

- **The rebalance.** The one change that can quietly ruin the game's pacing.
  Mitigated by replaying recorded journals before and after and diffing the
  resulting worlds — that harness already exists and is asserted in the suite.
- **Complexity the player cannot hold.** Twenty-eight routes is too many to
  track by hand, which is why the briefing must say *"the Shalka toll
  earned you 40 this turn"* rather than leaving it to be inferred.
- **Determinism.** All-pairs BFS over 25 nodes, with neighbours already visited
  in sorted order. Cheap and already replay-safe.
- **Model cost: zero.** Every mechanic here is reducer arithmetic. No new model
  calls, no change to the ~$0.12 a turn.

## What this does not change

The central rule holds throughout. The model may *propose* a blockade or a
raid; it never computes what one earns. Route income, tolls, raid yields and
treaty effects are all arithmetic in `src/domain`, where a prompt cannot argue
with them.
