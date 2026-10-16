# Playtest 2026-10-16: how much freedom do operatives give a player?

Campaign `freedom`, the Ojjul Nar Combine (guile 18, the best on the board), 10 turns, played to its end (turn 10 is read-only:
*"This campaign ended at turn 10"*). Driven by `pt.mjs` against the server on port 4181. Every turn spent at least one action on
an operative act that is **not** one of the nine missions, worded the way a player at a table would word it. The other action set
things up or ran a plain mission as a control.

**The short answer: very little of what a player imagines reaches the state.** Of 25 creative attempts, **none landed as
imagined**. Four were flattened into a stat debuff or a discord effect, sixteen were ruled inadmissible, three failed their roll,
and two produced a narrative that contradicts the state. The one imaginative outcome that actually happened, a kidnapping, came
from the reducer on its own (a subversion operative's roll took a hostage). The arbiter had refused the same act twice when it was
asked for directly.

## Every attempt

T = turn. "AP" = an action point was spent. The rulings come from `/api/action`; the state comes from `/api/campaign` after End Turn.

| # | T | Declared (abridged; exact text below) | Arbiter / check | Routed to | What landed in state | Class |
|---|---|---|---|---|---|---|
| 1 | 1 | Dovic: break into the Vigil drafting archive at Vantic and steal the Imperial line-of-battle drawings | admissible, guile DC 19, partial | `theft`, but effect `intel {revealsOrders:false}` | Agent placed (60 cr). Vigil→us −8. **No asset moved**: `ast-0-1` stayed with the Vigil. The narrative says he "gets out with scraps" | FLATTENED |
| 2 | 1 | Dovic plants forged evidence (a Drajk tally-knife, a burned pay chit) so the Vigil blames Drajk for the break-in | guile DC 14, partial; the arbiter routed it as `sabotage` (`targetCommanderId: "Iron Vigil Remnant"`), which was rejected and corrected | `discord` toward Drajk, 1/turn (100 cr) | Dovic was **re-tasked**, so the theft ended. Caught next tick; Vigil→us −21 (−59 → −80). Nothing clears our own suspicion | FLATTENED |
| 3 | 2 | Pellith breaks Dovic out of the Vigil cells (bribes the turnkey, laundry hauler) | **inadmissible**: "would move them between rosters (from captive to operative)" | — | nothing (no AP) | REFUSED |
| 4 | 2 | (rephrased) steal back our captured operative like any held asset | **inadmissible**: "there is no stealth left to work with" | — | nothing | REFUSED |
| 5 | 2 | Pellith goes to Sekkar Gate and bribes Chancellor Teodor Vance, 200 cr | **inadmissible**: "to move this operative… requires a separate deployment order" | — | nothing | REFUSED |
| 6 | 2 | (rephrased "Deploy … Her mission there: bribe…") | **inadmissible**: "Bribery is not a sparrow's function… A sparrow cannot attempt this mission" | — | nothing | REFUSED |
| 7 | 2 | (rephrased "win over Vance face to face") | **inadmissible**: "Vessine Nar Pellith is waiting on your Lists and has not been recruited". **False**: she was recruited on turn 1 | — | nothing | REFUSED |
| 8 | 2 | "Our sparrow Pellith (already on our books)… court Vance… the Combine's man on the customs bench" | guile DC 16, **failure** | — | −70 cr ("dinners… spent for nothing"); Meridian→us −4 | failed roll |
| 9 | 3 | Rhuun kidnaps Governor Gnaeus Varro at Vantic and holds him at Oridin as a hostage to trade for Dovic | **inadmissible**, though the ruling itself says "If the order is to seize him and hold him prisoner for leverage, that is admissible covert work" | — | nothing | REFUSED |
| 10 | 3 | (rephrased: "hold him prisoner as a hostage… we do not seat him") | **inadmissible**: "seizing him as a hostage moves him from Iron Vigil's roster to your custody… the rosters do not cross" | — | nothing | REFUSED |
| 11 | 3 | Rhuun goes to Vantic and steals the Vigil fleet's IFF codes | **inadmissible**: "Operatives do not move between systems as part of their own action" | — | nothing | REFUSED |
| 12 | 3 | (rephrased "Deploy Rhuun… Her job there: steal the IFF codes") | **inadmissible**: "requires an operative movement order first… Order her deployment as a covert mission (`infiltration` or `surveillance`…)". There is no `infiltration` mission | — | nothing | REFUSED |
| 13 | 4 | Rhuun on **sabotage**: corrupts the flagship's IFF codes so gun crews hesitate next fight | guile DC 18, partial | `sabotage`, effect `stat_debuff might 1` | Agent placed (80 cr) **plus a −60 `adjust_credits` "covert sabotage mission costs"**. The Vigil lost 1 might for 5 turns, galaxy-wide, until she was caught (T9) | FLATTENED |
| 14 | 4 | Pellith keeps seducing Vance and also copies the Board's customs ledger from his study, couriered home | guile DC 16, partial | **two** `deploy_agent` on the same operative: `seduction` (80 cr) then `theft`/`intel` (60 cr) | The seduction was **silently overwritten** by the theft, though the narrative says "Pellith stays close to Vance". 140 cr. No dossier. Next tick the Vigil "publishes proof that Ojjul Nar Combine has an operative working theft at Sekkar Gate"; she is burned; heat 11 → 26 | BROKEN |
| 15 | 5 | Tellumen spreads one specific rumour on Brannix: the Vigil will seize every Meridian freighter in the Marches | guile DC 14, **failure** | — | nothing ("fee bought nothing") | failed roll |
| 16 | 6 | Tellumen forges a letter in the Drajk Huntmaster's hand selling out the Sixteenth, and leaks it to their mess halls | **inadmissible**: "Forgery is not listed among the mission types… manufacturing false evidence… is not a mission the game's mechanic supports" | — | nothing | REFUSED |
| 17 | 6 | (same, prefixed "on subversion:") | guile DC 14, partial | `subversion`, `stat_debuff resolve 1` | Drajk −1 resolve; Drajk→us −5. **On T8 the reducer's `takeHostage` fired off this agent's roll**: we now hold `ast-8-0` "A figure of consequence from Drajk Confederacy's house on Vergesse, lifted out by an operative" (worth 245 to Drajk) | FLATTENED (with an emergent kidnapping) |
| 18 | 6 | Rhuun abducts Iron Marshal Flavia Corvinus and holds her at Oridin as a captured officer | **inadmissible**: "An officer is never moved between rosters… not made an asset of the Combine". But a captured officer **is** an `officer` asset, by design | — | nothing | REFUSED |
| 19 | 7 | Zevric hunts the Vigil saboteur wrecking our black market and turns her into a double agent | **inadmissible**: names the wrong operative ("Sabina Macer", who was at Tulgarn) and says "a ghost's toolkit… does not include hunting down" | — | nothing | REFUSED |
| 20 | 7 | Zevric runs a counter-intel sweep of Shalka and keeps the saboteur in a Combine cell to turn later | **inadmissible**: calls the operative "an exposed officer", then the roster rule | — | nothing | REFUSED |
| 21 | 7 | Zevric rigs Meridian's spice futures at Brannix (buys long, plants a blight report, sells into the panic) | **inadmissible**: "An operative cannot be deployed from one system to work in another" | — | nothing | REFUSED |
| 22 | 7 | (rephrased "Send Zevric to Brannix on a theft mission: he rigs the futures…") | guile DC 14, **failure** | — | **−60 cr** charged on the failure (the plain control #C3 at the same DC charged nothing) | failed roll |
| 23 | 8 | Tellumen smuggles the Drajk hostage off Vergesse to a Combine cell on Shalka | guile DC 14, **success** | an attempted `deploy_agent defection` was rejected and corrected | The narrative: "walks the hostage out… the trail is three jumps cold and running toward Shalka". The correction note: "The hostage was never actually secured…". **State unchanged**: `ast-8-0` is still at `ilv-6`. An AP was spent | BROKEN |
| 24 | 8 | Tellumen impersonates the Huntmaster's courier with forged orders for the Sixteenth to leave Threx | **inadmissible**: "they have no reason to obey a courier they cannot verify". That is a ruling on how likely it is, not on whether it is possible | — | nothing | REFUSED |
| 25 | 9 | Zevric goes to Sekkar Gate and runs a long con: a fake Vigil quartermaster sells Meridian a forged fleet chart for 400 | **inadmissible**: "cannot travel… without a covert insertion mission… submit a covert `subversion` or `theft` mission to insert Zevric" | — | nothing (the follow-up turn never came: the campaign ended) | REFUSED |

Controls, plain missions and recruitment:

| # | T | Declared | Ruling | Result | Class |
|---|---|---|---|---|---|
| C1 | 2 | "Deploy our sparrow Pellith… on a seduction mission against Chancellor Teodor Vance" | guile DC 16, partial | `seduction` + `targetNotable` placed; "Sekkar Gate warms to you" each turn | LANDED |
| C2 | 3 | "Deploy our wetworker Rhuun… on surveillance, to establish presence" (the arbiter's own suggestion from #12) | **inadmissible**: "Surveillance is the province of ghosts… Rephrase the mission or choose a different operative" | nothing | REFUSED |
| C3 | 7 | "Deploy our ghost Zevric… to Brannix on a theft mission against Meridian" | guile DC 14, failure | nothing, and no charge | failed roll |
| C4 | 8 | "Deploy our ghost Zevric… to Oridin on surveillance, watching Drajk raiders on our own world" | **inadmissible**: "Oridin is your own territory where you have full visibility". Wrong: the raid at Oridin has shown as "Unknown raiders" since turn 1, and a watcher is exactly what reveals covert work on your own ground | nothing | REFUSED |
| C5 | 9 | "Send our ghost Zevric to Sekkar Gate on a theft mission against Meridian" | guile DC 16, success | `theft`, but effect `intel` again. "reports nothing moving at Sekkar Gate". Not one credit stolen | FLATTENED |
| R1–R5 | 1,2,3,5,6 | Recruit the ghost, sparrow, wetworker, agitator and a second ghost | each rolled a guile check (DC 5) | all landed, but see finding 9 | LANDED |

## Counts

Creative acts (25): **LANDED 0 · FLATTENED 4 · REFUSED 16 · NARRATIVE-ONLY 0 · BROKEN 2**, and 3 admissible attempts that failed
their roll. Of the 22 attempts that were not refused, 2 contradicted the state. None of the imaginative content survived intact:
the drawings, the frame, the bribe, the kidnap, the jailbreak, the ledger, the market rig, the impersonation and the con.

Plain missions (5): 1 landed, 1 flattened (a theft that steals nothing), 2 refused, 1 failed. Recruitment: 5 of 5.

Operatives fielded: 5. **Captured: 4.** Dovic (T2), Rhuun (T9) and Tellumen (T9) were caught; Pellith was burned by publication.
Only Zevric ended the campaign free. The covert campaign took the Vigil's regard for the Combine from −55 to **−100**, and the
Vigil is at war with the Combine in the epilogue, which a profiteer pays for every turn.

## Patterns

**1. Naming a mission is the password; describing an act is the trap.** The same intent lands when it opens with "Deploy X … on
subversion" or "on sabotage" (#13, #17, C1), and it is refused when it describes the act (#16 against #17 is the same forged
letter, a turn apart). The arbiter rewards players who already speak the op vocabulary. That is the opposite of a TTRPG.

**2. The arbiter invents restrictions that the code does not have, and contradicts itself from turn to turn.** Each one is quoted above:
- **Travel and act in one declaration.** Accepted on T1 (#1: Shalka → Vantic and steal), T2 (C1) and T9 (C5), and refused on T2,
  T3, T7 and T9 as "requires a separate deployment order" (#5), "operatives do not move between systems" (#11), "cannot be deployed
  from one system to work in another" (#21) and "requires a covert insertion mission" (#25).
- **Class as a hard gate.** "A sparrow cannot attempt this mission" (#6) and a wetworker cannot surveil (C2). In the code, class is
  ±10% success and ±1 exposure (`CLASS_SUCCESS_SHIFT`, `classFit`). Neither `prompts/appraisal.md` nor the class meaning text says a
  class *may not* run a mission.
- **"Forgery is not a mission"** (#16). Yet `AGENT_CLASS_MEANING.agitator` reads *"stirs the many from a distance: a rumour, **a
  forged letter**, a crowd"*, and #2's forged evidence was accepted on T1.
- **"The current operative cannot be repurposed mid-mission"** (#30, quoted in finding 6). The reducer re-tasks by name, and did so in
  #2 and #14.
- **A mission that does not exist.** `infiltration` (#12).

**3. The roster rule in `appraisal.md` §2 over-fires on every act that takes a person.** It was written to stop *seating* a spy or
giving a notable a squadron. Here it blocked a jailbreak (#3), two kidnaps of a notable (#9, #10), a kidnap of an officer (#18) and
holding an enemy operative (#20). The game has a home for all of these. Captured officers and operatives are `officer` and
`operative` assets. Hostages exist, and `takeHostage` (reducer.ts:8362) fires off a subversion roll, which is how we got one on T8.
The vocabulary can express a kidnapping. The arbiter will not let a player ask for one.

**4. When something does land, the idea is replaced by a generic number.**
- Framing Drajk became discord at 1 a turn, which did nothing to the Vigil's suspicion of *us*.
- Corrupted IFF codes became −1 might across the whole Vigil. That is persistent and galaxy-wide, not "the next fight at Vantic".
- A forged letter became −1 resolve.
- All three thefts (#1, #14, C5) were written with `effect: intel` rather than the `income_penalty` that `DEFAULT_COVERT_EFFECT.theft`
  gives. So **no theft in this campaign stole money**, and no theft of a named thing moved an asset.

**5. The vocabulary cannot express these at all:**
- moving a held asset, such as a hostage, between worlds (#23);
- taking a *named* existing asset from a rival (#1);
- springing a captive;
- turning an enemy operative;
- a counter-intelligence act by an operative (`counter_intelligence` is an order category, not a mission);
- issuing orders in another power's name;
- selling a fake to an NPC, which would need the NPC's consent through a channel;
- any act whose payoff is "next battle" or "this one world" rather than a standing per-turn effect.

## Bugs and exploits

1. **The End Turn `notes` leak every rival operative's recruitment and posting**: name, mission, destination and arrival turn.
   `state.agents` is fogged correctly; the notes array returned by `/api/endturn` is not. Examples:
   *"Priya Abernathy leaves Sekkar Gate for Vantic on surveillance, for 40 credits — 3 jumps, at work from turn 1."* (Meridian, T1);
   *"Flavia Paullus leaves Vantic for Shalka on sabotage, for 80 credits — 3 jumps, at work from turn 7."* (the Vigil saboteur that
   then wrecked our black market, 2 → 0 working). *"Tolen Harrowfield leaves Arkane Prime for Threx on incitement"*. This is every
   NPC's covert layer, every turn.
2. **Theft is written as a watcher.** The resolution pass emitted `theft` with `effect: {kind: "intel"}` three times out of three.
   On #1 it wrote `revealsOrders: false`, yet the briefing reports that effect as *"reveals hidden orders"*. The mission and its
   effect are not checked against each other.
3. **Two `deploy_agent` ops on one operative in one batch** (#14). Both are charged (80 + 60). The second silently overwrites the
   first, so the seduction ended. The narrative says both continue. The re-task also seems to have carried her into the Vigil's
   published proof the next turn.
4. **Mission fees charged twice.** #13 staged the 80-credit `AGENT_COST` *and* `adjust_credits −60` "covert sabotage mission costs".
   #8 (−70) and #22 (−60) charged invented fees on failures, while the identical plain failure C3 charged nothing. So whether a
   failed attempt costs money depends on how it was worded.
5. **A successful roll narrated as done, with no state change** (#23): *"walks the hostage out… running toward Shalka"*, and in the
   same response *"Correction: The hostage was never actually secured"*. An AP was spent. No op relocates an asset.
6. **The arbiter misreads state.** It confused the two operatives named Vessine and said a recruited operative was still on the Lists
   (#7). It named the wrong saboteur and called an operative "an officer" (#19, #20). And #30, a seventh refusal not in the table
   above (Rhuun, in place, lifting the blueprints), was refused with *"a wetworker's mission is sabotage… The current operative
   cannot be repurposed mid-mission"*.
7. **A self-contradicting ruling** (#9): it states the hostage reading is admissible, then rules the act inadmissible.
8. **A watcher on your own world is refused** (C4) on the grounds that you see everything there. Covert categories are rumours even
   in your own space, which is the reason a watcher at home is worth having.
9. **Recruitment narration invents windfalls.** Examples: *"he's already heard two things worth remembering about Meridian's
   shipping schedule"* (R1); *"the Riqel garrison quartermaster… hands over a running inventory of every Drajk and Vigil courier"*
   (R5); and a clerk who "owes her a favor" (R4, whose `spawn_event` was dropped by the recruitment-alone rule, so the prose stands
   with nothing behind it). Recruitment also rolls a d20 at DC 5 and pays a full resolution call ($0.12–0.30) for an act the
   design calls free.
10. **The hostage capture's operative report is lost.** On T8 the intel line for Tellumen read only *"costing Drajk Confederacy 1
    resolve"*. The `watchNotes` entry "has somebody of consequence… and holds them" appears to be overwritten by the stat_debuff
    note, so the capture was visible only through a narrative log line. On T9 the same report says she is "in place" on the tick
    in which a crackdown takes her.
11. Smaller ones:
    - Intel lines print `[null · Shalka]` for an operative awaiting orders.
    - Burned operatives stay in `state.agents` with a live mission and effect.
    - The mission list in `prompts/appraisal.md` §3b omits `discord`.
    - Pellith, burned by publication, became nobody's asset, so she can never be ransomed, unlike the three who were caught.

## What worked

- Plain missions land cleanly, with honest pricing: travel by jumps, the fee, `successChance`, per-turn reports. Seduction warmed
  Sekkar Gate every turn.
- When a flattening happened, the mapping was sensible: framing became discord, a code corruption became a might debuff, a forged
  letter became a resolve debuff.
- The fog in `state.agents` holds.
- Exposure has teeth. Caught operatives became assets, a rival published proof of one, and heat built up.
- The dark-raid tracing filed two real dossiers on Drajk without our asking.
- The reducer's `takeHostage` is the most TTRPG-like thing in the campaign. The arbiter simply never lets a player request it.

## Cost

Session spend at the end, from `CampaignView.spend`: **$3.37** for 9 played turns. That covers 36 action declarations, 5 recruits and
9 End Turns. A refused declaration costs ≈ $0.03, a resolved one $0.12–0.30, and End Turns were free (no reactions fired all
campaign). Sixteen of the twenty-five creative attempts were refused at the arbiter, which is cheap, but no AP is refunded for the
turns lost to them: turn 3 had one recruit land and nothing else.

## Exact texts, for the record

- #1 "Send Dovic Nar Kasko to Vantic to break into the Iron Vigil's drafting archive and steal the Imperial line-of-battle drawings they hold there, and bring them back to Shalka."
- #2 "Dovic Nar Kasko, still inside Vantic, plants forged evidence in the Vigil's investigation of the archive break-in: a Drajk corsair's tally-knife and a half-burned Confederacy pay chit left in the drafting archive's vent shaft, so the Vigil's Intelligentsia concludes the Drajk Confederacy did it, not us."
- #9 "Send our wetworker Rhuun from Oridin to Vantic to kidnap Governor Gnaeus Varro of the Vigil's Intelligentsia: drug him at a reception, crate him in a spice hauler and bring him back to Oridin alive, to be held as a hostage we can trade for our captured man Dovic."
- #13 "Deploy our wetworker Rhuun from Oridin to Vantic on sabotage: she slips into the Vigil flagship's signals room and corrupts the fleet's IFF recognition codes, so that the next time the Vigil squadron at Vantic fights, its own gun crews hesitate and its torpedo boats lose their lock."
- #14 "Pellith, already in Chancellor Teodor Vance's confidence at Sekkar Gate, keeps her seduction going but also, one night while he sleeps, copies the Meridian Board's private customs ledger from his study and has the copy couriered home to Shalka — a file we can hold over Meridian."
- #16 / #17 "Deploy our agitator Tellumen from Shalka to Vergesse [on subversion:] to forge a letter in the Drajk Huntmaster's hand offering the Iron Vigil a secret separate peace that sells out the Sixteenth estate's captains — then leak it into the Sixteenth's dockside mess halls…"
- #23 "Our agitator Tellumen smuggles the Drajk hostage she lifted on Vergesse off-world, hidden in a spice hauler's false bulkhead, and brings them home to a Combine cell on Shalka, where Drajk cannot simply take them back."
- #25 "Deploy our ghost Zevric from Riqel to Sekkar Gate to run a long con on Meridian: posing as a disgraced Iron Vigil quartermaster, he sells Meridian's security directorate a forged chart of the Vigil's fleet dispositions for 400 credits, then vanishes…"
