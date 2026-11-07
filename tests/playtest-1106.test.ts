import { describe, expect, it } from 'vitest';
import { checkGround } from '../src/domain/refusals.js';
import { applyOps } from '../src/domain/reducer.js';
import { createSeedState } from '../src/seed/scenario.js';

/** Playtest 2026-11-06 (Meridian): a factory refused for work under way elsewhere. */

describe('work under way as a reason a fixture is already so', () => {
  const seed = createSeedState('meridian');
  // Var Hollow had joined Meridian in the campaign that found it.
  seed.systems.find((x) => x.id === 'sek-5')!.controllerFactionId = 'meridian';
  const { state } = applyOps(
    seed,
    [{ op: 'found_fixture', factionId: 'meridian', systemId: 'sek-5', kind: 'power_plant', label: 'Power plant at Var Hollow' }],
    'model',
    'meridian',
  );
  const order = state.pendingOrders.find((o) => o.onComplete?.kind === 'found_fixture')!;
  const ground = (ref: string) => ({ kind: 'already_so', ref, reason: '' }) as never;

  it('does not reach a world the order is not at', () => {
    expect(order.targetId).toBe('sek-5');
    expect(checkGround(state, 'meridian', ground(order.id), 'Build a factory at Torrek Anchorage.')).toMatch(/not at Torrek Anchorage/);
  });

  it('does not make a different fixture already so', () => {
    expect(checkGround(state, 'meridian', ground(order.id), 'Build a factory at Var Hollow.')).toMatch(/raises a power plant, not a factory/);
  });

  it('still stands for the same work at the same world', () => {
    expect(checkGround(state, 'meridian', ground(order.id), 'Build a power plant at Var Hollow.')).toBeNull();
  });
});

describe('a build is founded as the ruling named it', () => {
  it('writes the fixture when resolution wrote a charter in its place, and drops the charter', async () => {
    const { holdToRuling, ruledFixture } = await import('../src/domain/refusals.js');
    const state = createSeedState('meridian');
    const founds = [ruledFixture(state, 'meridian', { kind: 'factory', systemId: 'tor-1' })];
    const out = holdToRuling(
      [{ op: 'establish_commitment', kind: 'factory_charter', factionIds: ['meridian'], text: 'A factory', incomePerTurn: 12 }],
      { covert: [], groundwork: [], stat: 'industry', outcome: 'critical_success', establishes: undefined, yields: [], sentOnly: false, founds },
    );
    expect(out.ops).toEqual([{ op: 'found_fixture', factionId: 'meridian', systemId: 'tor-1', kind: 'factory', label: 'Factory at Torrek Anchorage' }]);
  });

  it('drops a fixture nobody ruled', async () => {
    const { foundsAsRuled } = await import('../src/domain/refusals.js');
    const out = foundsAsRuled([{ op: 'found_fixture', factionId: 'meridian', systemId: 'tor-1', kind: 'factory' }], []);
    expect(out.ops).toEqual([]);
    expect(out.dropped).toBe(1);
  });

  it('is checked against the board before the roll', async () => {
    const { foundingRefusal, foundsInWords } = await import('../src/domain/refusals.js');
    const state = createSeedState('meridian');
    expect(foundsInWords(state, 'Build a factory at Torrek Anchorage.')).toEqual([{ kind: 'factory', systemId: 'tor-1' }]);
    expect(foundsInWords(state, 'Repair the factory at Torrek Anchorage.')).toEqual([]);
    expect(foundingRefusal(state, 'meridian', { kind: 'factory', systemId: 'tor-1' })).toBeNull();
    // Torrek Anchorage is an industrial moon: a hospital works resolve.
    expect(foundingRefusal(state, 'meridian', { kind: 'hospital', systemId: 'tor-1' })).toMatch(/cannot stand there/);
    expect(foundingRefusal(state, 'meridian', { kind: 'factory', systemId: 'tor-2' })).toMatch(/not yours/);
  });
});
