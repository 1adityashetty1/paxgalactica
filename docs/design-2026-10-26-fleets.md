# Named fleets

**Status:** built on `claude/named-fleets`. Journal version 31.

## What it is

Every power's ships are organised into numbered, named fleets: *1st Fleet*,
*the Vigil's 3rd Battle Squadron*. A fleet is moved, reported and remembered by
its identity, as in *Stellaris*. Two decisions were taken with the user:

- **Fleets own the hulls.** A fleet is the record ships live in, and a world's
  ships are what the fleets there hold.
- **Every power has them.** That includes the bots, the NPC reactions, the
  battle reports and the prompts.

## Shape

- **`StarSystem.fleets: Fleet[]`.** A fleet holds `id`, `factionId`, `number`,
  `name` (null means the power's default name for that number) and `stack`.
  - **Where a fleet is, is which list it is in.** There is no location field to
    disagree with that.
  - **Under way, a fleet is a `FleetTag` on its movement order**
    (`PendingOrder.fleet`). The tag carries `id`, `number`, `name` and
    `detached`. The hulls are still `order.force`, as before.
- **`system.ships` stays, as an index.** It is rewritten from the fleets on
  every write, so it always equals the sum of the fleets at the world. The ~220
  read sites (income, battles, bots, prompts, UI) read it unchanged.
- **Writes go through the five accessors, as before.** In fleet mode each one
  writes the fleets and then the index:
  - **Adding** goes to the fleet in scope (see below), else to the senior fleet
    of that power at the world. If there is none, a new fleet is made.
  - **Removing** comes off the fleet in scope first, else off the fleets there
    in proportion per class (largest remainder, ties by number).
- **Identity is carried by scope.** `withFleet(tag, fn)` names the fleet that
  adds and removals within it belong to. It is used at:
  - a departure;
  - a one-jump move that lands at once;
  - landing the survivors of a battle, per contributing fleet;
  - a retreat, per order;
  - a recall or an interruption.
- **Numbers and ids are settled after every batch and tick** (`settleFleets`).
  A new fleet takes the lowest number its power is not using. Its id is
  `flt-<power>-<number>`. Empty fleets are dropped, and lists are sorted for
  replay.
- **Everything that sails is a fleet** (journal version 35, the user's ruling
  after bughunt 2026-10-29). A move that names no fleet forms its force into
  one, for free: every fleet wholly inside the force is merged into the senior
  of them, which lends its name, and the rest is split off the fleets it draws
  on. It keeps its identity where it lands. A force written beside a named
  fleet, and smaller than it, is split off it the same way.
- **The bots' massing still forms detachments.** A bot's move that names no
  fleet sends a numbered detachment, which on arrival merges into the senior
  fleet there, or stands alone where there is none. So the bots' constant
  massing does not multiply fleets without end. Before version 35 every
  anonymous move did this.
- **Old journals are untouched.** A world with no `fleets` list, which is every
  seed before version 31, is read and written exactly as before.

## Ops

- **`move.fleet` / `issue_order.fleet`.** This names a fleet by id, number or
  name. The fleet sails whole from wherever it stands. `force` is not needed;
  given and smaller, it is how much of the fleet is split off to sail.
- **Organising.** These are free, are not an act in the world, and are
  committed directly like the cheat menu (path `organise`). They may also be
  written by a declaration, reaction or bot:
  - `rename_fleet {fleet, name}`;
  - `split_fleet {fleet, force, name?}`;
  - `merge_fleets {into, from[]}`, which must be at the same world.

## Piped to

- **Prompts:** the state document lists fleets per world and under way, and
  `resolution.md` says to move a named fleet with `move.fleet`.
- **Battle reports:** the fleets on each side.
- **UI:**
  - the Fleets tab is organised by fleet, with rename, split, merge and move;
  - the System tab shows fleets;
  - the map labels voyages by fleet name.
- **Briefing and log:** movement labels carry the fleet's name.

## Not done here

- **Officers are not assigned to fleets.** They sail as before: named on the
  order, or with a whole port.
- **A defender driven off keeps its fleets' identities** at the refuge. Fleets
  that were merged into one contingent are split back in proportion. They are
  not tracked hull by hull.

## Every hull is in a fleet, and a single-vessel job is a fleet of its own

Every hull was already in some fleet, but a listener or a freighter was folded
into the senior warfleet wherever it was built or landed, so it never stood as a
unit of its own (12 of 12 over 40 bot turns). Now, as Stellaris does with its
science ships, each is a one-ship fleet: `Fleet.kind` is `listener` or
`freighter`, numbered on its own and named in its power's voice (the Combine's
"Ear of the Family 2" and "Spice Hauler 3"; see `KIND_STYLE`), and it rides in a warfleet only
once its power merges it in. A named fleet keeps whatever it carries; a bare
number names a warfleet.

## An officer with nothing to command keeps a courier

A lone officer sails a **courier**: a hull class of one ton and 0.01 weight,
first in the loss order. At rest it is kept, not stood down — an officer
standing at a world who commands no fleet there has a one-ship courier fleet
that they command (`settleCouriers`, after `settleCommand` in every batch and
tick). It goes when they take a command, sail or fall, and is raised again when
they stand down or land. It is never in the `ships` index, so it contests no
income and holds no orbit; under way it is the movement's `force`, met and
fought on arrival by the same battle code as any fleet. Over a world their
power holds, an officer whose courier is shot away comes down with the
garrison; anywhere else they fall with it. Moving a courier by name sends its
officer, and it is never split, merged or given to another commander.

A courier is the officer's passage, not the navy: it is never built, never
billed, draws no upkeep and is not counted in fleet tonnage (`navyTons`). The
harness board is unchanged (5/5/6/5/4 at 30 and 100 turns).
