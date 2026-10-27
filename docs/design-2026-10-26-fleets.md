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
- **Anonymous moves form detachments.** A move that names no fleet sends a
  numbered detachment. On arrival it merges into the senior fleet already
  there; if there is none it stands as a fleet of its own. So the bots' constant
  massing does not multiply fleets without end.
- **Old journals are untouched.** A world with no `fleets` list, which is every
  seed before version 31, is read and written exactly as before.

## Ops

- **`move.fleet` / `issue_order.fleet`.** This names a fleet by id, number or
  name. The fleet sails whole from wherever it stands. `force` is not needed,
  and is ignored if given.
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

## An officer travelling alone sails a courier

A lone officer's passage was a special case in the tick: they arrived wherever
they were sent, and nothing on the way could touch them. They now sail a
**courier**, a hull class of one ton and 0.01 weight, first in the loss order.
`move_officer` issues an ordinary `fleet_movement` of `{ courier: 1 }`, tagged as
a fleet named *courier of <officer>* under that officer's command, so the
arrival is resolved by the same battle code as any fleet. Over a world their
power holds, an officer whose courier is shot away comes down with the garrison;
anywhere else they fall with it.

A courier is transport, not navy: it is never built, never billed, draws no
upkeep and is not counted in fleet tonnage (`navyTons`), and it is stood down
the moment it lands (`disembarkCouriers`), so no fleet of couriers is ever left
on the board. The harness board is unchanged (5/5/6/5/4 at 30 turns): the bots
never send an officer alone.
