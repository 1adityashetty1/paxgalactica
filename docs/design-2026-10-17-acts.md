# An acts layer: price each act once

The reducer decides what happens — a battle, an income split, a world joining —
and then charges for it: standing with the injured power, standing with
onlookers, heat, a line in the log, sometimes money. The deciding is spread
across 63 op cases and the tick, which is fine. **The charging is spread
the same way, and that is the problem.** Every site that causes an act prices
it inline, with its own numbers, its own idea of who counts as an onlooker, and
its own decision about heat and publicity. Nothing names the act, so two sites
that produce the same act cannot know they disagree.

This is the output side of the problem `docs/design-2026-10-17-intent-ops.md`
deals with on the input side:

- **input:** one op stands for several acts, and the reducer guesses which;
- **output:** one act is priced in several places, and the places drift apart.

## The case that found it: breaking your word

| how a power breaks its word | the victim's view of the breaker | every onlooker | heat |
|---|---|---|---|
| attacks a pact partner (auto-break on arrival) | −25 | −10 (−20 across a truce) | 8 (16 across a truce) |
| `break_treaty` | −25, **and the breaker's view of the victim drops 25 too** | **none** | 8 |
| `break_treaty` of a marriage | −25, one way only | none | 8 |
| a treaty broken by conceding an ultimatum that demanded it | −25 | none | none |
| `repudiate_obligation` | −25 | −10 | 8 |
| a loan defaulted, kept or lost | −25 | −10 | 8 |
| `dissolve_commitment`, two parties | −12, and the −5 goodwill refunded | none | **none** |
| `dissolve_commitment`, three or more | −12 | −10, **charged to the other parties as well, on top of their −12** | 8 |

Three of those cells read as accidents rather than decisions, and they compound:

- **Repudiating first and then attacking is the cheap betrayal.** The attack
  arrives against a pact already broken, so the onlooker price is never charged.
  This is open to the player and to every NPC. CLAUDE.md says breaking a treaty
  costs "a permanent reputation hit with every onlooker", and `break_treaty`
  charges none.
- **The breaker goes cold on its own victim.** `break_treaty` lowers regard both
  ways, so the power that broke the pact ends up liking the victim less. Every
  other site charges only the injured side.
- **The parties to a commitment pay twice.** When a commitment of three or more
  is torn up, the onlooker loop skips only the actor, so the other parties are
  charged both as injured and as onlookers.

Eight sites price this one act. The figure 25 is written as a bare number at
six of them.

## It is not one bug: the inventory

Across `src/domain/reducer.ts` (13,400 lines):

| what is charged | write sites | how |
|---|---|---|
| disposition | 60 | 34 write the field directly, each restating `moveRegard`'s clamp; 26 call `moveRegard` |
| credits | 42 | about 20 receipt sites, each with its own "pay what the payer has" logic; 3 call `moveConserved` |
| heat | 16 | `heatUp` at each site, or not, case by case |
| a log line | 184 | each `logEvent` picks its own audience |

The prices themselves live in eight modules: the reducer, `diplomacy.ts`,
`command.ts`, `estates.ts`, `events.ts`, `heat.ts`, `loan.ts` and `debt.ts`.

**Hostile acts have no common shape either.** A sample:

| act | the injured power | onlookers | heat |
|---|---|---|---|
| suborning crews | 6 a hull | 2 | none |
| a raid | 4 a turn | 2 a turn, from powers that don't expect it | 2 a turn |
| signing under a fleet | 6 | none | none |
| posting a bounty | 10, once | none | none |
| a coalition formed against you | 10 from each signatory | none | none |
| kidnapping a person | 30 | none | none, beyond sending the operative |
| executing one | 40 | 5 | 8 |
| selling one to a third power | 15 | 4 | none |
| interrogating one | 20 | none | none |
| publishing a rival's secret | the subject resents you 15 | the scandal (5–10) lands on the subject | the scandal's size, on the subject |
| an assassination that lands | 35, a bare number written twice | none | none, beyond sending the operative |

Some of these differences are deliberate: a raid is priced per turn because it
runs per turn. Others nobody chose. Kidnapping a person costs no heat and
executing them costs 8. Suborning is public enough to charge onlookers and
costs no heat. A two-party commitment walked away from costs no heat, and a
favour refused costs 8. **The point is not that every row should match. It is
that no one can see the rows side by side, so a difference is never a decision.**

**And CLAUDE.md is a record of this class of bug**, each found by a playtest and
fixed where it was found:

- suborning by op against suborning by operative;
- a declared assassination against a deployed one;
- `adjust_dissent` against a `stat_debuff` operative;
- narrated disposition against a discord operative;
- a world split by tons and a lane split by hulls;
- a hard-coded copy of the dissent formula in the serializer;
- save files restating the accepted journal versions.

Each is one outcome reachable by two routes at two prices, and "only the cheaper
one is ever used" is the sentence CLAUDE.md keeps writing. The newest instance
is in this branch: `suborn_crews` (journal version 23) copies the standing
charge of the legacy `adjust_ships` suborning path instead of sharing it.

## The design

**One module, `src/domain/acts.ts`, names every act the reducer charges for and
prices it once.** The reducer still decides that an act happened. It no longer
decides what the act costs.

```ts
type Act =
  | { kind: 'breach'; instrument: BreachKind; breaker: string; victims: string[] }
  | { kind: 'hostile'; act: HostileKind; by: string; against: string; scale?: number }
  | { kind: 'goodwill'; act: GoodwillKind; from: string; toward: string[] }
  | { kind: 'war'; by: string[]; against: string[] }; // regard set to the war threshold

commitAct(state, act, rules): string[] // the notes; regard, heat and the log written
```

**One table holds the numbers:** for each kind, the cost to the injured, to
onlookers, the heat, and who hears about it. Beside it, the rules that are now
restated at every site are written once:

- onlookers are everyone but the parties, so nobody is charged twice;
- nobody resents itself, and the injured side is charged and the actor is not,
  unless the table says otherwise;
- regard is clamped in one place;
- heat comes from the table, so an act either carries heat or visibly does not;
- the log audience comes from the act's publicity — public, the parties, or the
  actor alone — so a line cannot be wider than the act. This is the
  `orderAudience` fix generalised.

**The families, as acts:**

| family | kinds |
|---|---|
| breach | attack under a pact, attack across a truce, a treaty repudiated, a favour repudiated, a loan defaulted, a commitment walked away from (two parties, or three or more), a marriage broken |
| hostile | suborning, raiding, interdiction, coercion, a bounty, an ultimatum conceded, a coalition against, kidnapping, execution, trafficking, interrogation, a secret published, blackmail, an affair exposed, an operative's backfire, an assassination, a border incident, a toll |
| goodwill | a treaty signed, a commitment sworn and refunded, a debt or loan forgiven, a person sent home, envoys, a gift |
| war | an ultimatum's deadline, a call to arms |

**Money gets two primitives**, and every credit write goes through one:

- `transfer(state, from, to, amount, why)`: conserved, trimmed to what the payer
  holds, the shortfall returned so the caller can say it. Debt service, loan
  rent, bounty payouts, a commission's share, tribute, a contingency,
  `terms.payment` and a ransom all become calls to it.
- `mint(state, to, amount, source)`: for the few places money is meant to be
  created — income, a rich seam, a commodity sale, the cheat menu. Minting
  becomes something you can grep for, which is the property every money bug in
  CLAUDE.md lacked.

**Dissent gets one charge**, `chargeDissent(state, faction, kind)`, with a
table of its sources: a refusal (8), a compulsion breach (15), a doctrine
statement (6) or ethic (20), a world past the span of control (1), drift (3),
sedition. The engine's charges that are staged as `adjust_dissent` today
(intent-ops §0) become this call.

**What stays outside.** What the reducer *decides* is untouched: the battle,
income in `ledgerFor`, a world's own standing (`StarSystem.regard`, a different
quantity), the truce's slow healing (a rule over time, not an act), and the
narrated movements a model writes (intent-ops §3 turns those into acts later).

## Keeping it from eroding

A layer a new mechanic can walk around is a convention, and conventions decay.
`tests/naming.test.ts` already holds a denylist over source; this does the same.
A test reads `src/domain/*.ts` and fails on:

- a write to `.disposition[…]`,
- a `.credits +=` or `.credits -=`, or
- a `heatUp` call

outside `acts.ts`, `moveRegard`, the two money primitives and a short named
allowlist (the cheat menu, the income pass). A new mechanic that wants to charge
standing has to add a row to the table, and the row is where somebody sees what
the neighbouring rows charge.

## How to move without changing a number

Each family moves in two separate changes, and the separation is the safety:

1. **Move.** The sites call `commitAct` with the numbers they charge today,
   accidents included. The test of the move is that **every saved campaign
   replays byte-identically and the four harness boards do not change.** That
   needs no journal version, because nothing changed.
2. **Decide.** The table is edited where a difference was an accident, as its
   own change with a journal version. The table is selected by the rules a
   journal carries (`ACT_PRICES[version]`), rather than a flag at each site, so
   an old campaign keeps the prices it was played under.

Breaches go first: they are the smallest family, the accidents are already
known, and the move is eight sites.

## Decisions this needs from you

These are the table edits the breach family would make. Each is a choice, not a
correction.

1. **Does repudiating a treaty charge onlookers?** Recommended: yes,
   `PACT_BREAKING_REPUTATION_COST`, as CLAUDE.md already says it does. That
   closes the repudiate-then-attack route.
2. **Does the breaker's own regard for its victim fall?** Recommended: no, as at
   every other breach site.
3. **Are the parties to a broken commitment of three or more charged as
   onlookers too?** Recommended: no; they are the injured, once.
4. **Does walking away from a two-party commitment carry heat?** Today a favour
   refused carries 8 and this carries none. Recommended: yes, at
   `HEAT_PACT_BROKEN`, since CLAUDE.md lists "a sworn arrangement" among heat's
   sources.

The hostile family's differences (heat for kidnapping, heat for suborning) are
listed in the table above and are decided when that family moves.

## Order of work

1. `acts.ts`, the breach family moved (no numbers changed), and the erosion
   test with the other families on its allowlist.
2. The breach decisions above, journal-pinned.
3. Money: `transfer` and `mint`, moved, then any decisions.
4. Hostile acts, moved, then the heat and onlooker decisions.
5. Goodwill, dissent and war, moved. The allowlist shrinks to the cheat menu and
   income.
6. Intent-ops §3: narrated regard becomes `sway`, `regard` and `gift`, each an
   act in this table.
