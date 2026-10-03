import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { tickTurn, DISSENT_DECAY } from '../src/domain/reducer.js';
import {
  SPAN_BASE,
  SPAN_DISSENT_PER_WORLD,
  spanOfControl,
  type WorldState,
} from '../src/domain/state.js';
import { statModifier } from '../src/domain/checks.js';

/**
 * A span of control (journal version 12): worlds held past `SPAN_BASE` plus the
 * influence modifier — never less than the homeland — cost a point of dissent
 * each a turn. Read off influence BEFORE dissent, so unrest cannot shrink the
 * span that is causing it.
 */

const calm = { randomEvents: false };

/** Hand `factionId` every unaligned world, which costs no occupation and starts no war. */
function grab(s: WorldState, factionId: string, n: number): WorldState {
  for (const sys of s.systems.filter((x) => x.controllerFactionId === null).slice(0, n)) {
    sys.controllerFactionId = factionId;
  }
  return s;
}

const dissentOf = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.dissent;

describe('a span of control', () => {
  it('opens with every power inside it, at its homeland or better', () => {
    const s = createSeedState('meridian');
    for (const f of s.factions) {
      const span = spanOfControl(s, f.id);
      expect(span.over, f.id).toBe(0);
      expect(span.held, f.id).toBe(4);
      expect(span.span, f.id).toBeGreaterThanOrEqual(4);
    }
    // Meridian's influence buys it room the Vigil's does not.
    expect(spanOfControl(s, 'meridian').span).toBeGreaterThan(spanOfControl(s, 'vigil').span);
    expect(spanOfControl(s, 'vigil').span).toBe(4);
  });

  it('charges a point of dissent a turn for every world past it', () => {
    const s = grab(createSeedState('meridian'), 'vigil', 3);
    const span = spanOfControl(s, 'vigil');
    expect(span.over).toBe(3);
    const after = tickTurn(s, calm).state;
    // Against the same tick with nothing taken, so the Vigil's compulsion drift
    // falls out of the comparison.
    expect(dissentOf(after, 'vigil') - dissentOf(tickTurn(createSeedState('meridian'), calm).state, 'vigil')).toBe(
      3 * SPAN_DISSENT_PER_WORLD,
    );
  });

  // The Vigil opens at war with nothing under way, so its compulsions drift
  // every tick; each test reads the span's share against a control tick.
  const control = () => dissentOf(tickTurn(createSeedState('meridian'), calm).state, 'vigil');

  it('costs nothing at the limit, and a world over it nets out against the decay', () => {
    expect(SPAN_DISSENT_PER_WORLD).toBeLessThan(DISSENT_DECAY);
    const at = createSeedState('meridian');
    expect(spanOfControl(at, 'vigil').over).toBe(0);
    expect(dissentOf(tickTurn(at, calm).state, 'vigil')).toBe(control());
  });

  it('reads influence before dissent, so unrest cannot shrink it', () => {
    const s = createSeedState('meridian');
    const before = spanOfControl(s, 'meridian').span;
    s.factions.find((f) => f.id === 'meridian')!.dissent = 100;
    expect(spanOfControl(s, 'meridian').span).toBe(before);
  });

  it('is sized off influence above the homeland', () => {
    const s = createSeedState('meridian');
    s.factions.find((f) => f.id === 'meridian')!.stats.influence = 20;
    expect(spanOfControl(s, 'meridian').span).toBeGreaterThanOrEqual(SPAN_BASE + statModifier(20));
  });

  it('replays a journal from before it as ground that cost nothing to hold', () => {
    const s = grab(createSeedState('meridian'), 'vigil', 3);
    const after = tickTurn(s, { ...calm, spanOfControl: false }).state;
    expect(dissentOf(after, 'vigil')).toBe(control());
  });
});
