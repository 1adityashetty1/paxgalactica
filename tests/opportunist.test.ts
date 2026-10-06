import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { lawlessGround } from '../src/domain/initiative.js';
import { neighboursOf } from '../src/domain/graph.js';
import { addShipsAt, type WorldState } from '../src/domain/state.js';

/**
 * The Confederacy takes unclaimed ground only where nobody strong is guarding
 * it — `OPPORTUNIST_HOLD_MARGIN`. It used to judge a strike by what stood on
 * the target alone, take a world a rival's main fleet sat one jump from, and
 * lose it four turns later with the hulls that took it.
 */
const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;
/** Whether the Confederacy counts a world among the lawless ground it would go for. */
const wants = (s: WorldState, target: string) => lawlessGround(s, 'drajk').some((x) => x.id === target);

/** Var Hollow with nobody's ships on it or next to it. */
function unguarded(): WorldState {
  const s = createSeedState('freeworlds');
  for (const id of ['sek-5', ...neighboursOf(s, 'sek-5')]) {
    for (const f of Object.keys(sys(s, id).ships)) if (f !== 'drajk') delete sys(s, id).ships[f];
  }
  return s;
}

describe('an opportunist', () => {
  it('takes unclaimed ground nobody strong is guarding', () => {
    expect(wants(unguarded(), 'sek-5')).toBe(true);
  });

  it('leaves it alone when a rival fleet sits a jump away', () => {
    const s = unguarded();
    addShipsAt(sys(s, neighboursOf(s, 'sek-5')[0]!), 'meridian', 40, 'battleship');
    expect(wants(s, 'sek-5')).toBe(false);
  });
});
