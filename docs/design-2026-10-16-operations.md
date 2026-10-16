# Operations: what an operative does when a player imagines it

Draft for review, revised 2026-10-16. Follows `docs/playtest-2026-10-16-operative-freedom.md`.

## The problem

The player has no piece on the board. Operatives are meant to be their hands in the world, the way a character is in a tabletop
game. The playtest measured how much of what a player imagines reaches the state: of 25 creative operative acts, **none landed as
imagined**. Sixteen were refused, four were flattened into a generic per-turn number, two left the story and the state
contradicting each other, and three failed their roll.

Two causes:

- **The vocabulary was short of outcomes.** Every mission was a standing job with a per-turn effect, while much of what a player
  imagines is one act with one object: *these* drawings, *this* governor.
- **The arbiter read the wrong words.** It matched what the player said about *how* ("forge", "bribe", "pose as") against a list of
  missions, found nothing, and refused, inventing a rule each time.

## Decided so far

1. **Missions come in two shapes.** Standing ones run every turn until the operative is recalled or caught. One-shot ones are a
   single attempt at a named thing or person, after which the operative is free again. `larceny` and `kidnapping` are built,
   `theft` is renamed `embezzlement`, and old journals read the old name.

   | shape | missions |
   |---|---|
   | **standing** | surveillance, embezzlement, subversion, sabotage, defection, discord, incitement, seduction |
   | **one-shot** | larceny, kidnapping, assassination |

2. **An operation is a mission carried out by a method.** The mission supplies the outcome. The method is how the player said it
   is done, and it changes only the price and the risks, never the outcome.

3. **Hooks come only from proof.** Surveillance digs up secrets, a seduction proves an affair, and larceny of an original dossier
   carries its secret with it. A copy carries none, and no method creates proof, so hooks cannot breed themselves.

## Reading a free-text act: outcome, then method, then target

This is the arbiter's whole job on a covert act, in this order.

**1. The outcome.** Ask what is different in the world if the act works. That alone picks the mission, **by the outcome and never
by the words describing how**:

| if it works… | mission |
|---|---|
| someone is dead | assassination |
| someone is held by you | kidnapping |
| a thing is yours, or a copy of it | larceny |
| credits flow to you each turn | embezzlement |
| you see their hidden work | surveillance |
| their stat or their institutions are worn down | subversion |
| two other powers are at odds | discord |
| a world turns on its holder | incitement |
| their crews serve you | defection |
| a notable warms to you, or an affair is proven | seduction |
| their hulls or a fixture are broken | sabotage |
| nothing yet, but the operative is better placed for a later act | **groundwork** (below): no mission |

**2. The duration** follows from the mission: one-shot or standing. The player does not choose it separately.

**3. The method** is everything in the sentence about *how*: poison, a forged letter, a bribe, posing as a courier, a laundry
hauler, a toast. A method word never chooses the mission. "Forge a letter that sets Drajk against the Vigil" is discord, because
the outcome is two powers at odds; the forging is only how it is done. The method is scored as a profile (below).

**4. The target** is the named person, thing, world or third power, and it fills the mission's target fields: `targetNotable`,
`targetCommanderId`, the stolen thing's `assetId`, discord's `towardFactionId`.

**5. More than one outcome** means one part per outcome, at most two per declaration, sharing the method. "Kill the governor and
blame Drajk" is assassination plus discord.

**6. An outcome no mission covers** goes in `unexpressed`. The act is refused **without spending the action point**, with a reason
that names the missing outcome, and the reason is logged. That log decides which mission is built next.

### Worked examples

| the player says | outcome → mission | method | target |
|---|---|---|---|
| "slip poison into the Governor's toast" | someone dead → assassination | poison, at a toast | the Governor |
| "forge the Huntmaster's letter selling out the Sixteenth" | two powers at odds → discord | a forged letter | Drajk against the Vigil |
| "pose as a courier and walk out with the IFF codes" | a thing taken → larceny | impersonation | the codes |
| "bribe the turnkey and walk the governor out" | a person held → kidnapping | bribery | the governor |
| "copy the Board's customs ledger, then stay and skim" | a copy → larceny; credits each turn → embezzlement | — | the ledger; Sekkar Gate |
| "kill the governor and pin it on Drajk" | someone dead → assassination; two powers at odds → discord | — | the governor; the Vigil against Drajk |
| "get Vessine hired into the Governor's kitchens at Kalzir" | better placed → **groundwork**, on ease, aimed at the Governor | taking a post on the staff | the Governor, at Kalzir |
| next turn: "Vessine drugs the Governor's wine and carries him out" | a person held → kidnapping, which **uses** the groundwork | drugging | the Governor |
| "smuggle our hostage off Vergesse to Shalka" | a held person moves → **unexpressed** | — | — |
| "fabricate proof Meridian runs a spy ring, and blackmail them" | you hold proof → **unexpressed**, by decision 3 | — | — |

## Methods are profiles, not entries

A list of methods would be a second closed vocabulary, which is the trap the nine missions were. So no method is written into code.
The arbiter scores the method the player described on four fixed axes, each −1, 0 or +1, from the player's side:

| axis | −1 | 0 | +1 |
|---|---|---|---|
| **preparation**: the price | dearer | as the mission costs | cheaper |
| **ease**: the success chance | harder | as rolled | easier |
| **noise**: the risk of being caught | louder | as the mission's | quieter |
| **if caught** | backfires | traced to you, as today | deniable |

- **Code owns what each step is worth**: ±25% on the price, ±10 on the success chance, ±1 in 20 on exposure. "Deniable" means
  exposure costs no regard. "Traced" is what exposure costs today. "Backfires" means the mission's effect turns against the actor:
  the regard it was building is lost by the actor instead, with the target and with every onlooker.
- **Code enforces a budget: the four scores must sum to zero or less.** Every advantage is paid for with a disadvantage, so no
  method can be described into being cheap, easy, quiet and safe at once. A profile over budget is clipped, one point at a time,
  from ease, then preparation, then noise, with a note.
- **The method is recorded** on the operative as the player's own words plus the profile, for the log, the Agents tab and the
  model's state block.

How familiar methods might score. These are illustrations, not code:

| method | preparation | ease | noise | if caught | sum |
|---|---|---|---|---|---|
| a forged letter | +1 | +1 | 0 | −1 | +1, over budget: ease is clipped to 0 |
| a bribe | −1 | +1 | 0 | 0 | 0 |
| posing as a courier | 0 | 0 | +1 | −1 | 0 |
| a hired local gang | +1 | −1 | −1 | +1 | 0 |
| poison at a toast | 0 | 0 | +1 | −1 | 0 |

The first row shows the budget doing its job: the arbiter asked for more than a forged letter is worth, and code takes it back.

## Groundwork: preparation that outlasts the action

A player often spends an action getting an operative into position before acting: undercover in the kitchens, on the night
watch's roster, owed a favour by the dockmaster. That preparation is worth something only to a **later** act, by the **same**
operative, in the **same** place. So it is recorded on the operative, not on the act:

```ts
// On Agent, alongside the mission.
groundwork?: {
  id: string;
  /** The player's own words: "a cook in the Governor's kitchens at Kalzir". */
  text: string;
  /** Where it holds. Leaving the world loses it. */
  systemId: string;
  /** The person, thing or power it is aimed at, when it is aimed at one. Null helps anything there. */
  target: string | null;
  /** The one axis it improves, by one step: the same four axes a method is scored on. */
  axis: 'preparation' | 'ease' | 'noise' | 'ifCaught';
  /** The turn it was laid, and the turn it goes stale. */
  madeTurn: number;
  staleTurn: number;
}[];
```

- **Laying it is an action of its own**, reached the way everything else is: its outcome row is "better placed for a later act".
  The arbiter scores which single axis it improves and what it is aimed at. It needs the operative on the world or able to
  reach it. **The action point is its whole price**: no fee and no exposure roll of its own (decided 2026-10-16). The risk is
  already where it belongs: the mission that uses it rolls exposure when it runs, and an operative sitting on a rival's world
  can be found before then — by a crackdown, or shown to a host that knows its owner well. The operative runs no standing
  mission while laying it.
- **It counts from the next turn** (decided 2026-10-16), so that preparation costs time as well as an action: a cover has to
  settle before it is any use. Laying it and acting on it in the same turn gains nothing.
- **A later mission uses it** when the same operative acts on the same world, and the target matches or the groundwork named none.
  Each matching piece adds +1 to its axis, **outside the method's budget**, since an action point already paid for it. A mission
  draws at most +2 from groundwork, and at most one piece per axis.
- **It is spent when used, and lost** when the operative leaves the world, is recalled or caught, or the groundwork goes stale
  (`GROUNDWORK_TURNS`, a few turns).
- **It is private.** The Agents tab shows it on the operative's card; a rival sees nothing. Being caught while it holds burns it.

Groundwork is general for the same reason methods are: it is a scored axis, not a named kind. "Undercover as a cook", "bribed the
night watch" and "learned the patrol schedule" are three pieces of groundwork that differ only in their words, their axis and
their target.

## Who decides what

| step | decided by |
|---|---|
| whether the act is possible on this board | the arbiter. A refusal must cite a fact in the state block; "there is no mechanic for this" is not a reason |
| the outcome(s) → mission(s), and the targets | the arbiter, by the outcome table |
| the method profile | the arbiter, four axes of −1/0/+1 |
| a piece of groundwork's axis and target | the arbiter; code applies it to a later matching mission |
| the budget, the price, the success chance, the exposure | code |
| the roll, and what the outcome does | code, through the mission as it already works |
| the story | resolution, which narrates the settled outcome and emits no effect ops of its own for an operation |

**Never a reason to refuse:** the operative's class (a class only runs its own missions better), travel (an operative sent far
travels, then acts), or the player not naming a mission.

## Validation

- **Tests check the mechanism, never a method.** The budget is enforced; every legal profile prices and resolves; an over-budget
  profile is clipped; the result is the same whatever the method is called; every outcome row maps to a mission that exists.
  Groundwork applies only to the same operative, world and target, from the next turn, is spent once, and is lost on leaving.
- **A held-out playtest.** The brief bans forgery, bribery and impersonation and asks for methods nobody has used yet. The
  mechanism is general if those land on sensible profiles and play differently. Compare against 0 of 25.

## Missions the playtest says are missing

Built only when the `unexpressed` log or a playtest asks for them:

- **extraction**: move a person or a thing you hold from one world to another.
- **jailbreak**: free a captive held on a world, yours to go home or anyone's to become yours.
- **turning an operative**: a caught rival operative made into a double agent, still on their books and reporting to you. The
  richest of the three, and the most new code.

## Still open from the playtest, independent of this

- Recruiting is rolled. It costs a resolution call and a d20 for an act that cannot fail, and the narration invents windfalls.
- A burned operative keeps a live mission, and one burned by publication becomes nobody's prisoner.
- Two operatives of one power can share a given name and confuse the arbiter.

## Order of work

1. The method profile on `deploy_agent` and `Agent`, the budget, and the four axes in code, with mechanism tests.
2. Groundwork on `Agent`: the op that lays it, its exposure roll, matching and spending it on a later mission, losing it.
3. The arbiter: the outcome table, `method`, `groundwork` and `unexpressed` on each covert part, and the refusal rule; resolution
   narrating only.
4. The Agents tab and the state block show the method and any groundwork; the help page explains the axes.
5. The held-out playtest.

## Open questions

1. **Step sizes.** Are ±25% price, ±10 success and ±1 exposure the right weights, or should "if caught" weigh double, since a
   backfire costs regard permanently?
2. **The budget.** Exactly zero, or allow +1 so that a well-chosen method is a small reward for imagination?
3. **Show the plan before the roll?** The player would see the mission, the method's profile and the odds, and could confirm or
   reword. That makes a misreading cheap to fix, but it adds a step to every covert declaration.
4. **NPC operations.** Should the bots and the reaction prompt use methods too, or stay on bare missions for now?
Decided: groundwork counts from the next turn, and the action point is its only price.
