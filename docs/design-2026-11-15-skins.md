# Skins: making the base game reskinnable

A plan, not a build. Measured on `claude/explicit-state-machines`, 2026-11-15.

## Decisions (2026-11-15)

1. **A skin reskins the same map.** The graph is the game's: nodes, lanes,
   value, terrain role, garrisons, the five powers' stats, ethics and doctrine,
   and the opening board's numbers. A skin supplies words, voices, layout and
   art for that graph and nothing else, so **a skin never changes a number**,
   and balance carries over by construction.
2. **Ordinals are the core's ids.** Powers and systems are `f0`–`f4` and
   `s00`–`s24` in the core, so salts and BFS tie-breaks never see a skin's
   words, and name draws never hash one. A skin names its own ids, which are translated at the
   boundary, and two skins play out identically (*"Compartments"*).
3. **Five factions, fixed.**
4. **A skin is a main-menu setting.** Chosen on the title screen and recorded on
   the new campaign's journal seed entry; a resumed campaign uses the skin its
   journal names, whatever the menu says. One skin for now, Pax Galactica.
5. **Headless means the engine is correct without any UI attached**, by
   rigorous schema checks and state machine checks. The UI, the prompts and the
   skin are consumers of that engine, and nothing in its correctness depends on
   them.

6. **A model writes the skin's words** (2026-11-15). Its narration and its ops
   stay in-world, and a leak becomes detectable: under a non-default skin, any
   core word reaching a model or a player is a defect a test can catch. That
   buys verification at the price of a strict compartment wall, set out in
   *"Compartments"* below.

7. **Unit, random-event and asset ids are the skin's too** (2026-11-15). The
   rule that took powers and systems to ordinals applies to every id family
   with a setting in its name, and the same rule covers terrains, order
   categories, op names, battle phases, fleet kinds and `basing_rights`, so the
   wall has no exceptions. See *"Every id family"* below.

8. **The operative salt is the log's length, the last entry's turn and its
   faction id** (2026-11-15), where it was the last word in the log. The
   faction id is the core's, so the salt is skin-free. See *"Nothing in the
   core hashes a skin's string"*.

9. **Core ids are disjoint from every skin's words, by construction**
   (2026-11-15). This includes the seven that were plain Pax Galactica words
   (`courier`, `assault`, `unrest`, `shortage`, `crackdown`, `turned_contact`,
   `show_of_force`). Renaming those seven alone does not achieve it: the
   draft role names `line`, `screen`, `strike`, `lift`, `trade`, `field`,
   `find` and `withdrawal` all occur in Pax Galactica's own text, `line` 58
   times in the prompts. So core ids take a **marked form** that no skin word
   can have. See *"Marked ids"*.

## Audit against the code (2026-11-15)

Every claim below was re-checked against the code, and the sections that follow
are corrected in place.

**Held:**
- The family counts: 7 hull classes, 7 terrains, 30 asset kinds, 15 order
  categories, 14 Rim events.
- The art counts: 12 pixel scenes (2 outcome, 10 Rim) and 5 portraits.
- The combat salt (`reducer.ts:14230`).
- `lastLogWord` as the only game-logic read of log text.
- The `courier` collision between hull classes and order categories.
- Every regex citation.
- `LEADER_TITLES` duplicating `Faction.title`.
- `lineActs` matching by exact text.
- All six name stocks at 20 given names and 60 families.

**Wrong or missing, now fixed below:**

1. **Phase 3 is not small.**
   - The suite names a faction id about 7,000 times, a system id about 1,400
     times and a hull id about 720 times, across 165 files.
   - Source names faction ids 61 times and system ids 117 times.
   - Moving the core to ordinals needs a codemod first, landed as a no-op:
     tests name ids through a default-skin table (`F.meridian`,
     `S['ark-1']`, `U.battleship`).
2. **Factions must be numbered in today's sorted order too**, like systems:
   `f0` drajk, `f1` freeworlds, `f2` meridian, `f3` ojjul, `f4` vigil.
   - The domain has 96 `localeCompare` calls, and most break ties on a
     faction, system or asset id.
   - An order-preserving numbering keeps every one of those ties.
   - The plan's example mapping `f1` to `vigil` was wrong.
3. **`inLossOrder`'s tie-break never fires.** Every class has a distinct
   `lossOrder`, from −1 to 5. Only the remainder pass (`hulls.ts:452`) can
   tie, though the frozen-rank rule still covers both.
4. **Some ids are built from words**, and those words leak into core ids:
   - **Notable ids** are `nob-<family name>` (`seats.ts:331`), so a skin's
     word sits inside a core id. They need neutral ids (`nob-<n>`).
   - **Estate ids** are `<faction>:<slug>`, with English slugs (`standards`,
     `security`), and `estateOwner` parses the faction back out of the id
     (`estates.ts:74`).
   - **Commander and listed-operative ids** embed the faction id
     (`cmd-<faction>-…`, `agt-<faction>-list-…`). That is harmless once
     faction ids are ordinals, but the outbound wall must translate or hide
     them.
5. **A sector is a display name used as a mechanics key.** `system.sector`
   holds `'Arkane Drift'`, and the bots group worlds by it
   (`initiative.ts:1254`, `1300`). It needs a core sector id.
6. **Officer schools are written by the model and are naval words.**
   `recruit_commander.school` takes `lineofbattle`, `gunnery`, `convoy` or
   `assault`. The plan had called them setting-neutral.
7. **Note kinds are a family too**: `escort`, `most_favoured`,
   `line_of_credit`, `sanctuary` and `safe_passage`. `escort` collides with
   the hull class.
8. **`worldType` is not a field a model writes**, since no op takes it.
   Terrain only crosses the outbound wall.
9. **The id fields are far more than six.**
   - Faction ids sit in `to`, `whom`, `fromFactionId`, `towardFactionId`,
     `parties`, `breaks` and `terms.against`, among others.
   - System ids sit in `originId`, `targetId`, `atSystemId` and
     `terms.defends`.
   - Hull ids are the **keys** of stacks inside `force`, loans and payloads.
   - So translation is schema-driven: every id-valued field and every
     id-keyed record in the Zod schemas is tagged with its family, and both
     the inbound wall and the journal alias table walk the schema. The alias
     table translates object keys as well as values.
10. **The journal is not skin-free, and cannot be.**
    - Some fields take a **name**, which the reducer resolves against state:
      officers, `agent`, `notable`, a rider's third power (`factionIdFor`),
      and refusal grounds.
    - Model prose is journaled too: `log_narrative`, asset and commitment
      texts, doctrine text.
    - So a journal replays under the skin its seed entry names, and the claim
      that "one journal replays under any skin" is withdrawn.
    - What is skin-free is every **id** field, and with it the dice. That is
      what the identical-boards test measures, since the bots write ids and
      never names.
11. **Prose tables live inside core modules**, and all of them move to the
    lexicon:
    - `HULL_SPEC.label` and `RIM_EVENT_TITLE`;
    - `STAT_MEANINGS` ("fleets, guns", "shipyards");
    - `WAR_ETHIC_MEANING`, `TRADE_ETHIC_MEANING` and `TREATY_TYPE_MEANING`;
    - `AGENT_MISSION_MEANING` and `AGENT_CLASS_MEANING`;
    - `NOTE_TITLE` and `NOTE_MEANING`;
    - `ACT_WORDS`;
    - the texts in `COMMANDER_ARCHETYPES` and `ASSET_ARCHETYPES`;
    - `GENERATED_PERSON_WORDS`;
    - `bands.ts`, whose `HEAT_BANDS` says "the Rim". It was added this week
      and already leaks.
12. **The name stocks need a second rule.** Family names must be distinct
    across all six stocks, since `freeFamily` walks past taken names by
    string. Equal sizes alone do not make two skins draw alike.
13. **Phase 5 needs no journal version.** The seed is identical and bot ops
    are journaled, so only phase 3 changes replay.
14. **Seven of the eight state machines are setting-free, not eight.** Who
    plays a power keys its bots on faction ids.
15. **The art counts.** The "8 SVG unit icons" are six unit classes plus the
    garrison and the commander, and a courier is drawn as its officer.

## The finding

The mechanics are already almost entirely role-keyed: the reducer reasons about
a line hull, a screen, a lift arm, a terrain's stat, a fixture's two attributes,
a want, a band of regard. Seven of the eight state machines read in one place
(CLAUDE.md, *"The state machines, each read in one place"*) name no setting; the
eighth, who plays a power, keys its bots on faction ids. The
setting lives in five places, and two hidden couplings make it harder to lift
out than it looks.

| where the setting lives | size | kind of work |
|---|---|---|
| the **seed** (`src/seed/scenario.ts`): the map, the five sheets, the opening board | one file, ~30 setting strings plus all the data | move to data |
| **ids that are also mechanics keys** and that a model writes: hull classes, world types, fixture and asset kinds, order categories, a few op names, Rim event kinds | 7 + 7 + 30 + 15 + 3 + 14 | a label layer, and aliases where a model writes them |
| **player-facing strings in code** that name setting things | ~650 literals (word heuristic, an upper bound): reducer 207, help text 54, serialize 30, epilogue 27, SidePanel 26, calls 25, assets 23, help 22, diplomacy 22 … | route through a lexicon |
| **the twelve prompts**, ~35k words | 129 proper nouns in worked examples; ~690 space-vocabulary words; resolution alone 49 hull names and 7 world types | placeholders and per-skin examples |
| **art** | 7 world sprites, 2 ship glyphs + 8 SVG icons (six unit classes, garrison, commander), 12 pixel scenes, 1 painted scene, 5 portraits, the map's dark-space theme | an art pack per skin, each piece approved |

The two hidden couplings:

1. **Ids are part of the dice and the map.** `buildAdjacency` breaks BFS ties on
   sorted system ids, the combat salt is `combat:<system>:<turn>:<sorted
   combatant ids>`, operative and name draws hash ids. CLAUDE.md records both
   lessons (*"The prefixes are not free"*, *"What the rename does move is the
   dice"*). So a skin that only renames ids still moves the board.
2. **English verb lists parse the player's and the model's words.** The engine
   reads intent off text with word lists that are written in this setting's
   language: scuttling (`scuttle|scrap|decommission|sink our own`), sailing and
   landing, a world taken (`colours go up|banners come down`), levying,
   ceding, envoys, the copying of paper, and the role nouns and leader titles
   the pronoun guard looks for. A skin whose players write *"disband the
   levies"* or *"march on the keep"* would fall through them.

**Every mechanical role has a low-fantasy equivalent** (appendix A), so the
system is reskinnable in principle. What it takes is mostly plumbing, plus one
journal-versioned change to the dice.

## What a skin is

> Superseded in part by the decisions above: the map, the sheets' mechanics and
> the opening board's numbers are the core's, so a skin's **scenario** layer
> shrinks to words for those slots. The split is in *"Core and skin"* below; the
> three layers here are kept as the first draft.

Three layers. The mechanics, meaning the reducer, the numbers and the roles,
are not part of a skin.

- **Lexicon**: words for roles. Each entry has a singular and plural, an
  adjective where English needs one, and the verbs the parsers listen for.
  - **Unit roles**: line, screen, strike, lift, trade, sigint, courier.
  - **Terrain**: the seven terrains.
  - **Places**: world, system, sector, lane, jump, hub, orbit, garrison, yards, the Rim.
  - **Units of account**: credits and tons.
  - **Labels for setting-worded ids**: order categories, fixture and asset kinds, Rim events, treaty types, missions, officer schools, operative classes.
  - **Battle phases**: strike, orbital, ground.
- **Scenario**: data.
  - The map: systems, coordinates, lanes, terrain, value, garrisons.
  - The five sheets: name, title, voice, doctrine, ethics, stats, red lines with their `lineActs`, compulsions with triggers and `barsPeaceWith`, estates, name stock, fleet-naming style, colour.
  - The opening board: dispositions, debts, assets, fixtures, notes, commodities, luck, fleets, officers.
  - The scenario constants now in code: `CARGO_TOLL_OPENING`, `SEED_SCHOOL`, the toll targets, and which doctrine bot each faction runs.
- **Art pack**: a sprite per terrain, a glyph and an icon per unit role, a scene per Rim event and per outcome, a portrait per faction, and the theme tokens.

A campaign names its skin on the journal's seed entry, beside `maxTurns` and
`sandboxEvent`, so replay rebuilds it in the same words.

## Inventory: prompts

| prompt | proper nouns | hull names | space words | what is setting-bound |
|---|---|---|---|---|
| `resolution.md` | 18 | 49 | 339 | hull prices and jobs, world types and the stat each gives, landing and lift rules, yard berths, tolls, orbit |
| `appraisal.md` | 48 | 8 | 121 | worked rulings naming factions and worlds ("open the gates and invite the Vigil to garrison Arkane Prime", the Sennex lane, the Vantic marriage, Var Hollow) |
| `extraction.md` | 26 | 2 | 59 | JSON examples with real faction ids and system ids (`heldBy: "ojjul"`, the Vantic keel-yards, Sekkar Gate) |
| `diplomacy-persona.md` | 18 | 1 | 36 | concession examples (`"Oridin passes to the Confederacy"`, crews walking out of Shalka, the Sennex toll) |
| `epilogue.md` | 10 | 0 | 25 | per-faction tone lines ("the Combine counts; the Vigil endures"), "never write drajk" |
| `advisor.md` | 9 | 4 | 27 | example counsel ("Vantic is thin", "hold Torrek") |
| `reaction.md` | 0 | 0 | 46 | vocabulary only: orbit, fleets, lanes, the Rim |
| `duration-rubric.md` | 0 | 1 | 19 | anchors: courier run, capital-ship programme, shipyard |
| `reconcile.md`, `correction.md`, `event-flavour.md`, `flavor.md` | 0 | 0 | 3–8 | vocabulary only |

The one existing seam is the `<!-- ASSET_ARCHETYPES -->` marker
(`withArchetypes` in `calls.ts`), which substitutes a code-built table into a
prompt at call time. Every other prompt is a static file.

## Inventory: ids a model writes

A model writes these in its ops. In a fantasy skin it would write
`hull: "battleship"` while narrating war galleys, and the word would leak into
the story.

| id family | setting-worded members | where |
|---|---|---|
| hull class | all seven (`battleship`, `escort`, `torpedo_boat`, `lifter`, `freighter`, `listener`, `courier`) | `HULL_CLASSES` (`hulls.ts`). Reach: battleship has 194 refs in src and 363 in tests. `HULL_SPEC.label` already exists |
| world type | all seven (`arid`, `earthnight`, `industrialmoon`, `gasgiant`, `earthlike`, `ice`, `oceanic`) | `WORLD_TYPES`, `WORLD_TYPE_STAT` |
| order category | `capital_ship_construction`, `refit`, `retooling`, `industrial_conversion`, `construction_infrastructure`, `commerce_raiding`, `fleet_movement` | `DURATION_CATEGORIES` |
| fixture / asset kind | `stock_exchange`, `power_plant`, `research_lab`, `defence_contractor`, `special_forces_command`, `charts`, `blueprints`, `ciphers`, `salvage` … (30 kinds) | `ASSET_ARCHETYPES`. `PAPER_KINDS` and `PEOPLE_KINDS` key on them |
| op name | `build_ships`, `scuttle_ships`, `suborn_crews` | `ModelOpSchema` |
| Rim event | `ion_storm`, `derelict`, `free_captains`, `rich_seam` … (14) | `RIM_EVENT_TITLE`. The mechanics are generic: a closed lane, a find, mercenaries, a windfall |
| treaty type | `basing_rights` (the rest are generic) | `TREATY_TYPES` |

| officer school | `lineofbattle`, `gunnery`, `convoy` (`assault` is neutral) | `COMMANDER_ARCHETYPES`; written in `recruit_commander.school` |
| note kind | `escort` (collides with the hull class); `most_favoured`, `line_of_credit`, `sanctuary`, `safe_passage` | `NOTE_KINDS` |

Missions, operative classes, wants, bands, relation kinds and outcome kinds
are already setting-neutral. Terrain is listed here as setting-worded, but no
op takes it, so it only crosses the outbound wall.

## Inventory: faction-keyed tables in code

Each is a table keyed by faction id that belongs in the scenario.

| table | where | note |
|---|---|---|
| the five doctrine bots | `BOTS` in `initiative.ts` | **a bot is a faction's id.** Its habits are coded per faction: `guardFronts` and torpedo boats for Drajk, listeners below `BOT_SIGINT_GUILE`. A skin needs bots chosen by doctrine, with the habits as doctrine traits |
| name stocks and titles per school | `NAME_STOCK` in `command.ts` | plus `FALLBACK = NAME_STOCK['drajk']` |
| fleet naming | `fleets.ts` (10 keyed entries) | "Battle Squadron", "Pack" |
| estates | `ESTATE_SHEETS` in `estates.ts` | names, stats |
| portrait focal points | `src/ui/portrait.ts` | per image |
| leader titles | `LEADER_TITLES` in `pronouns.ts` | a hardcoded copy of `Faction.title`, so a second source of truth already |
| world descriptions | `src/ui/worldtext.ts` | lines keyed on (terrain, founder) |

## Inventory: English that parses text

| list | where | listens for |
|---|---|---|
| scuttling | `refusals.ts:349` | scuttle, scrap, decommission, sink our own |
| copying paper | `refusals.ts:353` | copy, photograph, transcribe |
| building | `refusals.ts:268–274` | build, raise, found, erect; plus fixture kinds as words |
| levying | `calls.ts:751–753` | levy, recruit, muster; troops, militia; not walls or barracks |
| ceding | `calls.ts:1627` | cede, hand, sell, surrender |
| moving | `calls.ts:1656` | land, sail, attack, storm, invade, station |
| envoys | `calls.ts:1675` | envoy, emissary |
| a world taken | `turn.ts:688` | colours go up, banners come down, taken, stormed |
| pronoun guard | `pronouns.ts` | `ROLE_NOUNS` (governor, admiral, captain…), `LEADER_TITLES` |
| plurals | `describeStack`, `count` | appends "s" |

## Inventory: the state machines

| machine | setting-bound? |
|---|---|
| relation between powers, bands, outcome kind, screen mode, channel, where a person is | no |
| how an order ended | the reasons are neutral; the order categories it names are not (above) |
| who plays a power | yes: `BOTS` is keyed by faction id |
| a battle's phases (`strike`, `orbital`, `ground`) | labels only; the shape is generic (appendix A) |
| a world's standing and wants | no |
| fleets (`line`, `listener`, `freighter`, `courier`) | ids only; naming is per faction |
| the Rim pulse | the mechanics are generic; the kinds, titles, flavour prompt and art are not |

## Core and skin

Under the decisions, everything mechanical is the core's and keyed by ordinal.
A skin fills named slots.

| | core (ordinal-keyed, one copy) | skin (words for the slots) |
|---|---|---|
| map | 25 systems: lanes, strategic value, terrain role, garrison, controller, home power, sector membership | system and sector names and ids, map layout (coordinates may move; edges may not) |
| powers | 5: stats, war and trade ethic, doctrine bot, colour slot, opening credits, toll targets, `luck` | name, id, title, voice, doctrine paragraph, portrait |
| lines | each red line and compulsion as a **slot**: the acts it forbids (`lineActs`), its trigger, the powers it bars peace with (by ordinal) | the line's text |
| people | name-stock **sizes**, officer schools, estates' stats, operative classes | given and family names, officer titles per school, estate names, fleet-naming style |
| opening board | dispositions, debts, assets (kind and value), fixtures, notes, commodities, fleets | asset text, note names, commodity name |
| roles | hull classes, terrains, fixture and asset kinds, order categories, Rim events, phases | the lexicon: labels, plurals, verbs the parsers listen for |
| prompts | the rules, written against role tokens | the lexicon, and the names that fill the worked examples |
| art | the manifest's keys | the pieces |

Two couplings the split exposes, each a change to the core:

- **`lineActs` matches a line by its exact text** (`state.ts:332`). Reworded by
  a skin, every tagged line would go untagged. It must key on the line's slot,
  under a journal version.
- **Name draws depend on the stock's length and on its names being distinct.**
  Identical play under two skins needs:
  - identically sized stocks: today 20 given names and 60 families in each
    of the six (five powers and the independents' `rim` stock);
  - family names distinct across all six, since `freeFamily` walks past taken
    names by string.

  The skin schema checks both.
- **Ids built from words.** Notable ids are `nob-<family>`, and estate ids are
  `<faction>:<English slug>`, read back by `estateOwner`. Both become neutral,
  under the same journal version as the ordinals.
- **A sector is keyed by its display name** (`system.sector`), which the bots
  group by. It becomes a core sector id with a skin name.

## The headless spine

"The engine is correct without any UI" is made checkable in three parts. The
first two already exist in part, from the state-machine work and the gate.

1. **Every input is a schema.** The world state, journal, ops, skin and session
   snapshot are each a Zod schema, parsed at every boundary: load, request,
   model reply, replay. The skin is new. Its schema checks completeness: every
   role labelled with a plural, every slot filled, stocks at the fixed sizes,
   every art key present. It also checks the graph: a skin names exactly the 25
   systems and 5 powers by ordinal, and adds and removes none.
2. **Every state machine has a reading, an invariant and a transition rule.**
   - **A reading**: one function from fields to state, which most machines now have.
   - **An invariant on any one world**, as `personViolations` is for people.
   - **A legal-transition check between two consecutive worlds.** For example:
     - a treaty never returns to `active` from `broken`, `expired`, `voided` or `superseded`;
     - an order that ended is never back;
     - a lost officer stays lost;
     - a settled debt stays settled;
     - a truce never outlives its `untilTurn`;
     - an operative is never on the books and on the Lists at once.

   The machines to cover are: relation, person, order, treaty, truce, debt,
   loan, obligation, ultimatum, bounty, commitment, fixture, world standing and
   seat.
3. **The checks run wherever the engine runs.** They run over every step of
   every replay in the bug-hunt gate (people already do), over every turn of the
   balance harness, and in the suite under a **null skin**. The null skin names
   every slot with a sentinel word, and the suite asserts that no Pax Galactica
   word reaches the served view, the event log or a prompt.

The engine passing all three with no browser and no model attached is what
"headless" certifies. The harness already plays it with neither.

## Compartments

Decision 6 makes the skin a translation layer at two walls, and the design
stands or falls on nothing crossing a wall untranslated.

| compartment | holds | never holds |
|---|---|---|
| **core**: state, journal, reducer, bots, checks | core ids only: ordinal ids for powers and systems, internal ids for every role family | a skin word in an id field |
| **skin**: lexicon, slot words, art | words, each mapped to exactly one core id per family | a rule or a number |
| **model boundary in**: a model reply, before Zod | skin words → core ids, per field | nothing passes it untranslated |
| **model boundary out**: prompts, state blocks, rejections fed back for correction, notes | core ids → skin words | a core id of a setting-worded family |
| **player boundary**: the served view and the client | core ids in the payload, rendered through the skin's lexicon in the client; player text parsed with the skin's verb lists | — |

**The core's ids for powers and systems become ordinals** (`f0`–`f4`,
`s00`–`s24`), which is decision 2 taken all the way. The core then holds no
Pax Galactica word at all; the default skin maps `f4` to `vigil` exactly as a
fantasy skin maps it to a duchy. Three consequences:

- **Every id field in the journal is skin-free.** The journal as a whole is
  not: some fields take a name the reducer resolves against state, and model
  prose is journaled. So a journal replays under the skin its seed entry
  names. What two skins share is the dice, since every salt and tie reads
  ids alone.
- **Powers and systems are numbered in today's sorted order**: `f0` drajk
  through `f4` vigil, and the systems likewise. Every one of the domain's 96
  `localeCompare` ties then breaks exactly as now, and BFS ties with them.
- **Salts read the new ids, so the dice for new campaigns reseed once**, the
  way the faction rename's combat salt did. That is measured, recorded, and
  pinned to a journal version. Old journals keep their Pax Galactica ids and
  replay as they were played.

### Every id family

Every family a model writes gets setting-free core ids, and the skin supplies
the ids and words the model and the player see. Powers and systems become
ordinals. The other families become **role names**, which describe the
mechanic rather than the setting. Role names rather than ordinals because
the suite names a hull class over 800 times, and `stack.lift` stays readable
where `stack.u3` would not.

Superseded in form by *"Marked ids"* (decision 9): each core id below takes its
family prefix (`u_line`, `ev_lane_closure`, `t_might` …). The roles are as
listed.

| family | today | core id | the default skin's id |
|---|---|---|---|
| unit class | `battleship`, `escort`, `torpedo_boat`, `lifter`, `freighter`, `listener`, `courier` | `line`, `screen`, `strike`, `lift`, `trade`, `sigint`, `courier` | today's ids |
| random event | `ion_storm`, `derelict`, `unrest`, `border_incident`, `shortage`, `mutiny`, `rich_seam`, `volunteers`, `free_captains`, `envoys_of_peace`, `crackdown`, `bounty_posted`, `turned_contact`, `show_of_force` | named for what each does: `lane_closure`, `find`, `unrest`, `incident`, `shortage`, `desertion`, `windfall`, `levy`, `mercenaries`, `overture`, `crackdown`, `bounty`, `turned_contact`, `show_of_force` | today's ids |
| asset kind | 30, e.g. `blueprints`, `ciphers`, `salvage`, `stock_exchange`, `power_plant` | people and paper as they are where they are setting-free (`prisoners`, `hostage`, `dossier`, `writ`, `surety`); fixtures by their stat pair (`fixture_might`, `fixture_guile_influence`); the rest by role (`plans`, `codes`, `wreckage`) | today's ids |
| terrain | `arid`, `earthnight`, `industrialmoon`, `gasgiant`, `earthlike`, `ice`, `oceanic` | by stat and variant: `might`, `guile`, `industry_a`, `industry_b`, `influence`, `resolve_a`, `resolve_b` | today's ids |
| order category, op, phase, fleet kind, treaty | `capital_ship_construction`, `build_ships`, `orbital`, `listener`, `basing_rights` … | by role: `line_programme`, `build_units`, `field`, `sigint`, `passage` … | today's ids |
| officer school | `lineofbattle`, `gunnery`, `convoy`, `assault` | by the help they give: `steady`, `strike`, `withdrawal`, `assault` | today's ids |
| note kind | `escort`, `most_favoured`, `line_of_credit`, `sanctuary`, `safe_passage` | by what each calls into force: `defence`, `trade_terms`, `credit`, `basing`, `passage` | today's ids |
| sector, notable, estate | `'Arkane Drift'` (a display name), `nob-galba`, `vigil:blue_bloods` | `r0`–`r3`, `nob-<n>`, `f4:e0` | names in the skin |

The names in the core-id column are a first draft, settled when phase 3 is
built. What is decided is the rule: no family's core ids carry a setting.

Three things this needs:

- **Old journals parse through a frozen alias table**, from today's ids to the
  core ids, pinned to the journal version that makes the switch. It applies in
  the journal reader alone. Nothing outside it ever sees an old id.
- **The state's keys change with the ids.** For example, a ship stack is
  `{ line: 3 }`, not `{ battleship: 3 }`. A session snapshot from an older
  build is already replayed rather than trusted (`BUILD_ID`), so nothing has to
  migrate in place.
- **The client, the cheat menu, fleetlab and the art manifest** read core ids
  and render through the skin, which is phase 2's routing. Their tables are
  keyed on core ids.

### Nothing in the core hashes a skin's string

Renaming an id must not move a die or reorder a tie. Two couplings break that
today:

- **Two tie-breaks compare hull ids as strings.** The remainder pass in
  `hulls.ts:452` breaks a fractional-ship tie on the class name. `inLossOrder`
  (`hulls.ts:356`) does the same, though it never fires, since every class has
  a distinct `lossOrder`.
  Each family gets a **frozen rank**: today's alphabetical order of today's
  ids, written down once. Ties break on that rank, so old journals replay
  identically and a renamed id moves nothing. The rule generalises: no
  `localeCompare` or `.sort()` on an id of any family. A test greps for it, as
  `tests/acts.test.ts` greps for bare breach constants.
- **The operative salt reads the last word of the event log**
  (`lastLogWord`, `reducer.ts:750`; journal version 37). Under skins the log is
  written in the skin's words, so the same campaign rolls differently in two
  skins. It is the only game-logic read of log text, since `intel.ts:523`
  filters by visibility and not by words.
  - **Decided (8):** the salt becomes
    `<kind>:<operative id>:<log length>:<last entry's turn>:<last entry's faction id>`.
    The faction id is the core id, and an entry naming no faction gives an
    empty field.
  - That keeps the rule's intent, *whatever the turn has done by the time the
    operative acts*, without reading a word.
  - Pinned to a journal version. Journals from 37 up to it keep the last word,
    and older ones keep the bare id.

Dice and ties under a skin then read only core ids, frozen ranks and numbers.
The exit test for phase 3 says so: the four harness boards are identical under
the default skin and the null skin, with every id in every family renamed.

**Translation is per field, never global, and driven by the schema.** Ids
already collide across families: `courier` is both a hull class and an order
category, and `escort` both a hull class and a note kind. So every id-valued
field and every id-keyed record in the Zod schemas carries its family, and the
inbound wall and the journal alias table walk the schema rather than a hand
list. There are dozens of such fields: faction ids in `to`, `whom`,
`parties`, `breaks`, `terms.against`; system ids in `originId`, `targetId`,
`terms.defends`; hull ids as the keys of every stack. **Name-reference fields**
are not translated: officers, `agent`, `notable`, a rider's third power. The
reducer resolves them against the campaign's own state, which is in the
campaign's skin.

**Validation, all of it in code:**

1. **The skin schema is a bijection per family.**
   - Every core id has one canonical word and optional synonyms.
   - No two ids in a family share a word or a synonym.
   - Every word has a plural.
   - The canonical words round-trip: `toCore(toSkin(id)) === id` for every id
     in every family.
2. **The inbound boundary is strict.** An unknown word is a schema rejection,
   fed back to the model with the family's allowed skin words. It is never
   guessed, and never passed through on the chance it is a core id. Each
   translation is counted on the trace (`normalized: ['skin']`) so drift is
   visible.
3. **The outbound boundary is checked.** Every prompt sent, every rejection
   message and every note shown is scanned under the null skin for core ids
   of setting-worded families and for Pax Galactica words. A hit fails the
   suite. Reducer notes and rejection messages are written through the
   lexicon, which the reducer reads from a scope set by the journal's skin
   (the way `withNameStock` scopes the name stock), so replay writes the same
   words.
4. **Every id field holds a core id.** After every scripted turn under the null
   skin, every schema-tagged id field and id-keyed record in the journal and
   the world must parse as a core id of its family. Name-reference fields and
   prose are exempt by design.
5. **Player text is parsed with the skin's verb lists**, and the null skin's
   sentinel verbs prove each parser reads the lexicon rather than a hardcoded
   list.

## Leak prevention

Moving words out of the core is not enough on its own. Something has to fail
when one comes back. There are three defences, and each catches what the
others cannot.

### 1. Types and schemas: a wrong id cannot be stored

Every id family is a Zod enum or pattern over core ids. That covers powers,
systems, sectors, units, terrains, schools, note kinds, events, kinds,
categories and phases.

- A display name or a skin word in an id field fails to parse, at load, at
  replay and at the model wall. That covers the sector: `system.sector`
  becomes `SectorIdSchema` (`r0`–`r3`), so `'Arkane Drift'` cannot be stored.
- A naval id such as `gunnery`, `escort` or `battleship` is accepted in
  exactly one place: the journal alias table, which only the journal reader
  calls.
- A table keyed by a family is a `Record<CoreId, …>` in the skin, so a
  missing entry fails the typecheck, and a loaded skin is checked again by
  its schema.
- **The sector needs no journal pin.** No op names a sector, and the bots
  compare sectors only for equality (`initiative.ts:1254`, `1300`). So
  replacing names with ids changes no grouping, and old journals replay
  identically.

### 2. Static: core code cannot contain a word

A test reads the source and fails on any string literal in a core module
unless it is one of:

- a core id;
- an object key;
- a rejection code;
- the template inside the lexicon's `say` tagged template.

The core modules are `src/domain`, `src/engine` and the non-rendering half of
`src/model`. This is what stops the prose tables. `STAT_MEANINGS`,
`RIM_EVENT_TITLE`, `TREATY_TYPE_MEANING`, `HULL_SPEC.label` and the
`HEAT_BANDS` text cannot be written in a core module at all, and must live in
the skin keyed by core id.

- **It is the only defence that covers code no test runs.** The runtime scan
  below sees only paths that execute.
- **It has to cover the client too.** The client imports game-logic modules
  directly: `state.ts` 12 times, `hulls.ts` 6, `diplomacy.ts` 4, plus
  `events.ts`, `command.ts`, `worldtext.ts` and `outcomeart.ts`. A prose
  table in any of them reaches the screen without passing through the server
  at all, so the served-view scan would never see it. `HEAT_BANDS` is that
  route today: the Factions tooltip reads it straight from `bands.ts`. So
  the check covers `web/src` and `src/ui` as well, where every word must come
  from the lexicon the client is handed.
- **It needs a parser.** TypeScript 7's JS package exposes no
  `createSourceFile`, so the check needs a parser dependency or a
  token-level scan of string literals and JSX text.
- The journal alias table is allowlisted, since its whole job is to hold the
  old naval ids.

### 3. Runtime: the null skin, driven over every path that has a text

Everything a player or a model can see is produced under the null skin and
scanned for any word from the Pax Galactica skin: every name, every label,
every verb, every line of slot text. That covers prompts, rejections, notes,
the served view, the event log, help pages and the client's pure text
producers in `src/ui`. A hit fails. What drives the scan:

- the balance harness, over 100 turns;
- every Rim event, through the sandbox mode that fires one kind every turn;
- every help page;
- scripted model turns with a fake model, one per op family;
- every rejection code, from the reducer tests.

This catches wiring mistakes the static check cannot see, such as a lexicon
entry looked up under the wrong key.

### Marked ids (decision 9)

**The problem.** Seven core ids were Pax Galactica words. Under the default
skin, a leaked core id would be indistinguishable from the skin's own word, so
no scan of real play could flag it. Renaming just those seven is not enough.
Any plain English role name collides with some skin's prose: `line`, `screen`,
`strike`, `lift`, `trade`, `field`, `find` and `withdrawal` all appear in Pax
Galactica's text today.

**The rule:** disjointness holds by form, not by a word list.

- **Every id a skin re-words is marked:** a family prefix, an underscore, then
  the role:
  - units: `u_line`, `u_screen`, `u_strike`, `u_lift`, `u_trade`, `u_sigint`,
    `u_dispatch`;
  - Rim events: `ev_uprising`, `ev_scarcity`, `ev_purge`, `ev_double_agent`,
    `ev_massing` …;
  - and likewise `t_` terrains, `k_` asset kinds, `sch_` schools, `nk_` note
    kinds, `oc_` order categories, `ph_` phases, `fk_` fleet kinds and `tt_`
    treaty types.
- **Powers, systems and sectors are ordinals**: `f0`–`f4`, `s00`–`s24`,
  `r0`–`r3`. Notables and estates are `nob_<n>` and `f4_e0`.
- **No skin word may contain an underscore or match an ordinal pattern.** The
  skin schema checks this, so no skin, present or future, can collide with a
  core id. Nothing has to be compared word against word.

**What it buys:** a leak is one regular expression,
`\b(u|t|ev|k|sch|nk|oc|ph|fk|tt)_[a-z0-9_]+\b` or an ordinal, with no false
positives on prose. So:

- the null-skin suite scans for it;
- **real traces under the default skin can be scanned in production**,
  `pnpm trace` reporting any hit;
- a production scan can never mistake the skin's own word for a leak.

**What it costs:** readability. `stack.u_line` reads worse than `stack.line`,
and this supersedes the earlier choice of bare role names. The codemod in
phase 3 rewrites those references anyway.

**Protocol field names are neutral too.** The model writes these field names,
and they carry the space setting into its context under every skin: `hull`,
`fleet`, `systemId`, `atSystemId`, `toSystemId`, `land`, `holdLanding` and
`shipsPledged`.

- They become one protocol shared by all skins: `unit`, `group`, `placeId`,
  `atPlaceId`, `toPlaceId`, `seize`, `holdGround`, `unitsPledged`.
- The old names are kept as journal aliases.
- Op names already change in phase 4. None of them takes a marked prefix,
  since an op name is protocol rather than a word a skin translates.

## The plan

Seven phases. Each lands with the default skin byte-identical to today: the
same saves replay, the four harness boards hold, and prompts are sent unchanged.
Phase 3 is the exception. It takes one journal version, so old saves replay as
they were played.

1. **The headless spine.**
   - The transition checks for the machines listed above, beside
     `personViolations`, run in the gate and the harness.
   - The skin schema, with the Pax Galactica skin built from today's values.
   - **Built (2026-11-15).** `src/domain/transitions.ts` (`worldViolations`,
     `transitionViolations`, `watchMachines`), run by the bug-hunt gate over
     every step of every save and by `tests/transitions.test.ts` over 60 bot
     turns. `src/skin/schema.ts` (`SkinSchema`, `skinViolations`) and
     `src/skin/paxgalactica.ts`. The four boards and fleetlab are
     byte-identical to main.
   - A refinement to decision 9: a skin **id** may carry an underscore, since
     today's are `torpedo_boat` and `ion_storm`, but may not match the marked
     prefix or an ordinal. A skin **word** carries neither.
2. **Lexicon.**
   - `src/skin/`, and the player-facing generators routed through it:
     `describeStack` and its plurals first, then help, the briefing, battle
     notes, Rim titles, capabilities, serialize, the epilogue and worldtext,
     then the ~200 reducer notes.
   - The static check (*"Leak prevention"* 2) over core modules, `src/ui` and
     `web/src`, with the prose tables moved into the skin.
   - Exit:
     - the static check passes;
     - the null-skin scan (*"Leak prevention"* 3) passes over every driven
       path.
   - **In progress (2026-11-16).** Built:
     - `src/skin/lexicon.ts`: the lexicon in a scope (`withLexicon`), helpers,
       and `say`, a tagged template whose `{world}`-style tokens it fills.
     - `src/skin/words.ts`: the default words, a leaf, holding the moved
       tables: hull labels, Rim titles, note titles, terrain names, the
       archetypes' texts and seventeen sentence tables (`meanings`).
     - `src/skin/null.ts`: the null lexicon, which checks as a skin.
     - `tests/skin-leaks.test.ts`: the static check, built on rolldown's
       parser and ratcheted per file.
   - Two refinements to the plan:
     - The static check looks for the default skin's setting words in any
       prose literal, rather than requiring every sentence to be inside `say`.
       Requiring `say` catches nothing the word scan does not.
     - Ids and field names (`torpedo_boat`, `unknown_system`, `systemId`) are
       counted on a second ratchet. Phases 3 and 4 rename them, and phase 2
       only stops new ones arriving. 1,115 are recorded today.
   - **Hull classes, terrains and Rim events are setting in every form**,
     ids included (2026-11-16):
     - no ordinary-word exemption reaches their words;
     - their ids (`torpedo_boat`, `earthnight`, `ion_storm`) are scan words
       wherever they appear, in prose, in an id, in a field name or in output.
   - An id shown by spacing its underscores (`kind.replace(/_/g, ' ')`) is
     counted as a leak, since it writes the id where the lexicon has a word.
     57 such sites were routed through `assetKindWord`, `orderWord`,
     `treatyWord` and `unitWord`; 24 remain.
   - Prose: 98 hits remain in 19 files, from 994 at the start. That counts
     the setting ids and the spaced-id sites, which are new to the scan. What
     remains:
     - model-facing schema and prompt text, which is phase 4 and 6 work;
     - the scenario's names, which is phase 5 work;
     - the module-level tables in the help pages and world lines.
   - The runtime null-lexicon scan (`tests/skin-runtime.test.ts`) drives, with
     no model and no browser:
     - 60 bot turns, every log line and briefing;
     - every Rim event through its sandbox;
     - every help page;
     - the epilogue;
     - all ten kinds of model call, against a mocked client that records the
       system prompt, user message and JSON schema each would send.

     The scenario's names and sheets are masked out first, being phase 5's.
     Each source is held to its recorded words: 377 across 45 sources, 281 of
     them in prompts and 41 in schemas. The engine's log lines are clean, and
     the briefing carries only Rim event ids.
3. **Ordinals.**
   - First, as a no-op: a codemod so the suite names ids through a
     default-skin table (`F.meridian`, `S['ark-1']`, `U.battleship`). That is
     about 9,000 references across 165 files.
   - Core ids for powers and systems become ordinals under a journal version,
     in today's sorted order, and older journals keep their ids.
   - Sectors get core ids. Notable and estate ids become neutral.
   - `lineActs` and `barsPeaceWith` key on slot and ordinal.
   - Every other family moves to marked core ids (`u_line`, `ev_uprising` …;
     decision 9), read through the frozen alias table for older journals.
   - Frozen ranks for every tie-break.
   - The operative salt made skin-free (decision 8). It reseeds every
     operative's dice, so it shares the ordinals' journal version, and the
     boards are measured once for both.
   - A test that no core code sorts or compares an id string.
   - Exit:
     - the dice reseed once, and the four boards are re-measured and recorded;
     - after that, the harness under the null skin gives the same four boards
       as under the default skin.
4. **The compartment walls**, as above:
   - Per-field translation at the inbound boundary.
   - The outbound renderer for prompts, rejections and notes.
   - The verb lists moved into the lexicon.
   - `LEADER_TITLES` read from `Faction.title`.
   - Neutral core names for `build_ships`, `scuttle_ships` and
     `suborn_crews`, with the old names kept as journal aliases.
   - Marked core ids for every re-worded family, and neutral protocol field
     names, each with journal aliases (decision 9).
   - The skin schema refuses an underscore or an ordinal pattern in any skin
     word.
   - The leak expression runs in the suite and in `pnpm trace`.
   - Exit: validations 1–5 pass under the null skin.
5. **The core and skin split.**
   - The seed's mechanical data becomes the ordinal-keyed core.
   - Its words become `skins/paxgalactica/`.
   - `BOTS` becomes doctrine presets chosen by the core's power slots, with the
     per-power habits (the front guard, torpedo boats, listeners) as doctrine
     traits.
6. **Prompts.**
   - The archetype marker generalised into a renderer, with tokens filled from
     the lexicon.
   - Worked examples rewritten against tokens that each skin fills with its
     own names.
   - `prompt-drift.test.ts` asserts no token is left unresolved and no other
     skin's word appears.
7. **The menu, and art.**
   - A skin picker on the title screen (one entry), remembered in local
     storage. The chosen skin goes onto the new campaign's seed entry.
   - The art manifest keyed by role: world sprites, unit glyphs and icons,
     scenes, portraits, and theme tokens.

Phases 2, 3 and 6 are most of the hours. Phase 3's code change is small, but
its codemod is not. It is also the one phase that touches replay, and the one
that makes a second skin safe.

## Appendix A: every role has a low-fantasy equivalent

| role | Rim | what the mechanics need it to be | low fantasy |
|---|---|---|---|
| line | battleship | wins the exchange; dear; dies last | knights, heavy foot |
| screen | escort | cheap; dies first; turns a strike aside ton for ton | pikes, shieldwall |
| strike | torpedo boat | fires before the lines close; past the screen at the heaviest; cannot hold the field | archers, crossbows |
| lift | lifter | carries troops; the only way to take ground; converts to garrison in extremis | siege companies, sappers |
| trade | freighter | earns where nobody owns the ground; cannot fight | caravans |
| sigint | listener | sees what is under way where it stands, hears raids two jumps out; can be cut down | scouts, outriders, ravens |
| courier | courier | an officer's passage; holds nothing | a herald's escort |
| place | world, system, lane, jump, hub, orbit | a node, an edge, a turn per edge, a high-value node, presence without control | province, road, a day's march, market town, encamped before |
| terrain | arid, earthnight, industrialmoon, gasgiant, earthlike, ice, oceanic | seven terrains over five stats | steppe, free city, mines, forges, heartland, tundra, marsh |
| fixtures | factory, university, stock exchange … | a stat pair on the ground | forge, scriptorium, guildhall, barracks, temple … |
| Rim events | ion storm, derelict, free captains, rich seam, mutiny | a closed lane, a find, mercenaries, a windfall, desertion | blizzard, ruins, sellswords, a silver vein, desertion |
| battle phases | strike, orbital, ground | a first volley, the field, the assault | volleys, the field, the walls |
