# Duration Rubric v2

Every non-movement action resolves to exactly one bucket: **1, 2, 3, or 5**
turns. No other value is legal, and **nothing takes longer than 5 turns**.

That ceiling is deliberate. A campaign runs for tens of turns, so work that
takes twenty is work whose result the player never sees — it reads as a dead
end rather than a long game. Everything here is scaled so that the largest
undertaking a power can attempt still lands within five turns. A shipyard is
not "quick" in the fiction; it is simply the top of the scale we use.

Buckets stay Fibonacci-shaped because estimate uncertainty grows with scope.
There is deliberately no 4.

Fleet movement is **never** estimated here. Its cost is computed from the
hyperlane graph by the reducer. If an action is a fleet move, do not return a
duration for it at all.

---

## 1 — A single decision, resources already in place

One order, carried out by people already standing where they need to be.

- A courier run between adjacent systems.
- A decree issued over a single system's holonet.
- Opening a bribe to one port official.
- Standing down a patrol; raising an existing squadron's alert level.
- Denouncing a rival, recognising a government, publishing a manifesto.

- A commerce raid on one system's shipping. The squadron is already on
  station; a raid is arrive, take what is moving, leave. Sustained raiding is
  several short orders, not one long one.

## 2 — One system, one short cycle of work

A first result comes back, or one small thing physically changes.

- Levying a planetary garrison from a population already there.
- Inserting an agent into an existing network.
- A snap customs crackdown on one world.
- Opening blockade attrition against a lightly held system.
- Refitting an existing squadron with new weapons.
- A bilateral understanding both sides already want, put in writing.

## 3 — Several worlds, or a capability that must be assembled

Coordination across systems, or something built up rather than ordered.

- Fortifying a system's orbital approaches.
- Retooling a factory world from civilian to military output.
- A sector-wide intelligence penetration of a rival's command structure.
- Building a supply depot, relay station, or shipyard slipway.
- Ratifying a treaty across several suspicious signatories.
- Engineering a change of government on a client world.

## 5 — The ceiling: the largest thing a power can undertake

Heavy industry, capital hulls, or a programme that reshapes a region. This is
as long as anything gets.

- Building a shipyard from nothing.
- Laying down capital ships — the hulls that make a battle line.
- Constructing a deep-space fortress.
- Converting a sector's industrial base.
- Welding formerly independent powers into a union.

---

## Calibration notes

**Estimate the work, not the enthusiasm.** Urgency in the phrasing of an order
does not shorten it. "Immediately", "at once", and "by any means necessary"
describe how badly a faction wants a thing, not how long it takes. A rushed
shipyard is still a shipyard.

**Estimate the whole action, not its first visible step.** If an order only
makes sense once several things are in place, the duration covers all of them.

**Scope drives the bucket, not importance.** A decisive action can be short. A
trivial action across forty worlds is long.

**When torn between two buckets, take the longer one.** Estimates are made once,
at issue time, and never re-rolled. An order that finishes early is a pleasant
surprise; one that never finishes is a broken campaign.

Floors for certain categories are enforced in code and will override a value
returned here. Clamping is a safety net for the rubric, not a substitute for it
— every clamp is logged so the rubric itself can be corrected.
