# Operations: what an operative does when a player imagines it

Draft for review, 2026-10-16. Follows `docs/playtest-2026-10-16-operative-freedom.md`.

## The problem

The player has no piece on the board. Operatives are meant to be their hands in the world, the way a character is in a tabletop
game. The playtest measured how much of what a player imagines reaches the state: of 25 creative operative acts, **none landed as
imagined**. Sixteen were refused, four were flattened into a generic per-turn number, two left the story and the state
contradicting each other, and three failed their roll.

The cause is structural rather than a prompt slip. A covert act can only become one of nine **missions**, and a mission is a
*standing job with a per-turn effect*: watch, skim, debuff, damage, turn crews. Most of what a player imagines is a **one-time act
with a specific object**: steal *these* drawings, kidnap *this* governor, forge *this* letter, smuggle *that* hostage out. The
vocabulary had nowhere to put any of these. So the arbiter refused them, inventing a rule each time, or forced them into the
nearest mission.

## The shape of the answer

Keep the nine missions for what they are good at, standing jobs, and add a second kind of covert act: an **operation**. An
operation is one attempt, by one named operative, at one world, described in the player's own words.

It is resolved the way every general action already is, and that split is the point:

| step | who decides | what |
|---|---|---|
| 1. admissibility | the arbiter | is it possible *in the fiction*, given what is true now? Never "is there a mission for it" |
| 2. pricing | the arbiter | stat (always `guile`), DC, the **class** the act most resembles, and **which outcome verbs** it is attempting, with their targets |
| 3. the roll | code | `rollD20`, against `successChance` with the class fit applied |
| 4. the outcome | code | the band decides which verbs land and at what size; every magnitude comes from a table |
| 5. the story | resolution | narrates the settled outcome; it emits no effect ops of its own for an operation |

**The model names the intent; code owns the size.** The arbiter picks verbs and targets (ids it can see on the board). It never
picks a number. That is the rule `ASSET_ARCHETYPES`, `classifyPrinciple` and `boundPayloadsToOutcome` already follow, so it is the
house style rather than a new idea.

## Outcome verbs

A closed list, each built on a mechanic that already exists. This is what makes an imagined act *land* rather than become prose.

| verb | does | built on | class |
|---|---|---|---|
| `take_asset` | a named portable asset at the operative's world changes hands to the actor | `transfer_asset`, by force | ghost |
| `copy_paper` | the actor gets a dossier copied from a record a rival holds there (a ledger, a chart); the original stays | `create_asset` of a dossier | ghost |
| `move_held` | an asset the actor holds moves between worlds: a hostage smuggled out, loot carried home | new and small: `atSystemId` on a held asset | ghost |
| `forge_proof` | the actor files a **fabricated** secret about a rival, to publish or blackmail with | `SecretSchema` + `forged: true` | agitator |
| `frame` | a victim's grievance over a recent act moves from the actor onto a named third power | a bounded `moveRegard` pair | agitator |
| `rumour` | a world's regard for a named power moves once, now (`incite`, but one-shot) | `regard.ts` | agitator |
| `win_over` | a named notable or official at the world warms to the actor and owes it a weak favour | `ObligationSchema`, origin `operation` | sparrow |
| `turn_operative` | a rival operative caught or exposed at the world becomes a double: still theirs on their books, reporting to you | `Agent.doubledBy` (new), read by `ordersVisibleTo` | sparrow |
| `spring` | a captive held at the world goes home (your own) or is taken by you (anyone's) | the people-asset paths that exist | wetworker |
| `take_person` | a notable or officer standing at the world is seized and held at a world the actor holds | `takeHostage`; a captured officer is already an `officer` asset | wetworker |
| `strike` | a one-time blow at the world: hulls, a fixture, or the garrison | `hull_damage`, `fixture_damage`, garrison | wetworker |
| `next_fight` | the target's forces **at this world** fight worse in the next battle there | a one-battle modifier read by `resolveBattle` | wetworker |

These cover every attempt in the playtest except selling a fake to an NPC, which needs the buyer's consent and so belongs to a
channel. A few more could be added later (`plant_order`, to stand down a rival programme at the world as if its own officers had
ordered it). The table is closed, so each addition is deliberate.

**Every verb has a class**, following the rule `MISSION_CLASS` states, so the class modifier works on operations exactly as it
does on missions. **Class is never a gate.** A wetworker may try to copy a ledger, at the penalty.

## Sizes, bands and price

- **Band decides delivery.** Critical success delivers every verb and a small bonus (a second copy, an untraceable frame). Success
  delivers the verbs. Partial delivers the first verb only, or a smaller size where a verb has one. Failure delivers nothing and
  rolls exposure. Critical failure is caught, and the act is traced to the actor: `frame` and `forge_proof` backfire as proof
  *against* the actor.
- **Magnitudes are a table**, keyed by verb (`OPERATION_SIZE`): a frame moves at most 15 regard; a rumour 10; a strike up to a
  sabotage turn's worth ×3; and so on. They are set beside the mission numbers they echo, so an operation cannot be a cheaper path
  to a mission's effect. That is the rule that prices a declared assassination like a deployed one.
- **Price** is per verb (`OPERATION_COST`), paid when the act is declared, like `AGENT_COST`. Exposure is per verb too: a theft is
  quiet, a kidnapping loud. **The model may not add a fee.** The playtest found invented charges of 60–70 on top of the real price.
- **One operation at most two verbs**, and an operative on an operation is busy that turn: no mission ticks for them.

## Long operations

A con, a long seduction for a single object, or a ring built over turns: the arbiter may rule an operation `long` (2 or 3 turns).
The operative is committed for that time and rolls exposure each turn; the outcome lands at the end, with one size step larger.
This is the existing `Agent` record with a new mission value of `operation` plus the verbs and targets. Not a new table, and
journaled like any agent tick.

## What the arbiter is told, and not told

- It rules on the **fiction and the board**: the operative is there or can get there (travel is code's: three jumps a turn, and
  an act at a far world simply waits for arrival), the target exists, the object is portable. It does not rule on vocabulary.
- **It cannot invent a rule.** A refusal must quote a fact from the state block. "There is no mechanic for this" is not an
  allowed reason. When no verb fits, it says so in a dedicated field (`unexpressed`) and the act is refused **without** spending
  the action point. Those reasons are logged, so the next verb to add comes from play rather than from guesswork.
- Rosters stay closed **in code** (done 2026-10-16: `seat_estate`, `recruit_commander` and `recruit_agent` take only from their
  own Lists). Taking, freeing and holding people is ordinary covert work.

## Fixes the playtest asked for that this does not cover

These need doing regardless:
- **Theft has to steal.** Check a mission's effect against the mission. `theft` was written with `intel` three times out of three.
- **Recruiting is not rolled.** It costs a resolution call and a d20 for an act that cannot fail, and the narration invents
  windfalls. Route `recruit …` straight to the op, as `:cheats` is routed.
- **A burned operative clears their mission**, and the one burned by publication becomes a prisoner like the others.
- **The arbiter's state reading**: two operatives named Vessine confused it. A **given + family** name collision inside one power
  should be avoided at draw time too, not only family names.

## Order of work

1. The verb table, sizes and prices; `operation` on `deploy_agent`; the band rules in code. Tests for each verb on its own.
2. The arbiter's `operation` field and its prompt; resolution narrating only.
3. The UI: an operation shows on the Agents tab as one line with its verbs and odds before you commit.
4. `long` operations.
5. A second freedom playtest, with the same brief, to compare against 0 of 25.

## Open questions

1. **Two verbs per operation, or one?** Two lets "steal the drawings and frame Drajk for it" be a single act. One is simpler to
   price.
2. **Should `forge_proof` be indistinguishable from real proof** until it backfires? That is the interesting version. It is also
   the first place the state would hold a deliberate falsehood, which the asset design avoided on purpose (*"a worth nobody has
   settled"* rather than a claimed and a true value).
3. **Double agents**: a turned operative reporting to two powers is the richest verb and the most new code. In for the first
   build, or later?
4. **Should NPCs run operations too**, or only the nine missions? The bots would need a rule per verb, and the reaction prompt a
   paragraph. Missions only, to start, is the cheaper answer.
