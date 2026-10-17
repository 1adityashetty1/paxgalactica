import { describe, expect, it } from 'vitest';
import { applyOps } from '../src/domain/reducer.js';
import { AssetSchema } from '../src/domain/diplomacy.js';
import { EXECUTION_REPUTATION_COST, EXECUTION_RESENTMENT, HEAT_EXECUTION } from '../src/domain/command.js';
import type { OpInput } from '../src/domain/ops.js';
import type { WorldState } from '../src/domain/state.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * A person has one record, and their fate is a choice
 * (`docs/design-2026-10-16-ruling-schema.md` §4).
 *
 * A playtest (2026-10-16) moved a kidnapped notable by writing `consume_asset`
 * on him — which questioned him out of play — and `create_asset` of a new
 * generic prisoner with his name. Both halves are closed here, and a person's
 * fate is one named op: interrogate, release, execute, relocate.
 */

function withOfficerHeld(heldBy: string, atSystemId: string | null = null) {
  const s = createSeedState('drajk');
  const them = s.commanders.find((c) => c.factionId === 'freeworlds')!;
  them.status = 'captured';
  them.atSystemId = null;
  s.assets.push(
    AssetSchema.parse({
      id: 'ast-p', kind: 'officer', text: them.name, heldBy,
      quantity: 1, unit: 'person', commanderId: them.id, agentId: null,
      divisible: false, valuePerUnit: { freeworlds: 450 }, speculative: false,
      valueRange: {}, uses: null, atSystemId, portable: true,
      yield: null, acquiredTurn: 0,
    }),
  );
  return { s, them };
}

const regard = (s: WorldState, who: string, of: string) =>
  s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;
const fate = (f: string, extra: Record<string, unknown> = {}) =>
  ({ op: 'decide_fate', assetId: 'ast-p', fate: f, ...extra }) as OpInput;

describe('one record per person', () => {
  it('will not spend a person with consume_asset, and says what to use instead', () => {
    const { s } = withOfficerHeld('drajk');
    const out = applyOps(s, [{ op: 'consume_asset', assetId: 'ast-p' } as OpInput], 'model', 'drajk');
    expect(out.rejections[0]?.message).toMatch(/decide_fate/);
    expect(out.state.assets.some((a) => a.id === 'ast-p')).toBe(true);
  });

  it('still lets an older journal question a prisoner by spending them', () => {
    const { s } = withOfficerHeld('drajk');
    const out = applyOps(s, [{ op: 'consume_asset', assetId: 'ast-p' } as OpInput], 'model', 'drajk', true, {
      oneRecordPerPerson: false,
    });
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.some((a) => a.kind === 'dossier' && a.text.includes('gave up'))).toBe(true);
  });

  it('still spends an anonymous haul of crews in lots', () => {
    const s = createSeedState('drajk');
    const home = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    const made = applyOps(s, [{
      op: 'create_asset', kind: 'prisoners', heldBy: 'drajk', quantity: 20, unit: 'crew',
      text: 'Crews off a Vigil picket', atSystemId: home.id, valuePerUnit: { vigil: 10 },
    } as OpInput], 'model', 'drajk').state;
    const id = made.assets.find((a) => a.kind === 'prisoners' && a.heldBy === 'drajk')!.id;
    const out = applyOps(made, [{ op: 'consume_asset', assetId: id, quantity: 5 } as OpInput], 'model', 'drajk');
    expect(out.rejections).toEqual([]);
  });

  it('will not mint a person the campaign already has, and names who it matched', () => {
    const { s, them } = withOfficerHeld('drajk');
    const home = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    const family = them.name.split(' ').at(-1)!;
    const out = applyOps(s, [{
      op: 'create_asset', kind: 'hostage', heldBy: 'drajk', quantity: 1, unit: 'person',
      text: `Jorun ${family}, held at the yards`, atSystemId: home.id,
    } as OpInput], 'model', 'drajk');
    expect(out.rejections[0]?.message).toContain(them.name);
  });

  it('still mints somebody new, and a haul that only mentions a name', () => {
    const s = createSeedState('drajk');
    const home = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    const someone = applyOps(s, [{
      op: 'create_asset', kind: 'defector', heldBy: 'drajk', quantity: 1, unit: 'person',
      text: 'Ostra Quellwind, a Vigil signals clerk who walked out with the codes', atSystemId: home.id,
    } as OpInput], 'model', 'drajk');
    expect(someone.rejections).toEqual([]);
  });
});

describe('a person’s fate is a choice', () => {
  it('interrogates: a file, and their power remembers it', () => {
    const { s } = withOfficerHeld('drajk');
    const out = applyOps(s, [fate('interrogate')], 'model', 'drajk');
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.some((a) => a.kind === 'dossier')).toBe(true);
    expect(regard(out.state, 'freeworlds', 'drajk')).toBeLessThan(regard(s, 'freeworlds', 'drajk'));
  });

  it('releases: home, and goodwill for it', () => {
    const { s, them } = withOfficerHeld('drajk');
    const out = applyOps(s, [fate('release')], 'model', 'drajk');
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.some((a) => a.id === 'ast-p')).toBe(false);
    expect(out.state.commanders.find((c) => c.id === them.id)!.status).toBe('listed');
    expect(regard(out.state, 'freeworlds', 'drajk')).toBeGreaterThan(regard(s, 'freeworlds', 'drajk'));
  });

  it('executes: the officer is lost, priced like a caught assassination', () => {
    const { s, them } = withOfficerHeld('drajk');
    const out = applyOps(s, [fate('execute')], 'model', 'drajk');
    expect(out.rejections).toEqual([]);
    expect(out.state.commanders.find((c) => c.id === them.id)!.status).toBe('lost');
    expect(regard(out.state, 'freeworlds', 'drajk')).toBe(Math.max(-100, regard(s, 'freeworlds', 'drajk') - EXECUTION_RESENTMENT));
    expect(regard(out.state, 'meridian', 'drajk')).toBe(regard(s, 'meridian', 'drajk') - EXECUTION_REPUTATION_COST);
    const heat = (w: WorldState) => w.factions.find((f) => f.id === 'drajk')!.heat ?? 0;
    expect(heat(out.state)).toBe(heat(s) + HEAT_EXECUTION);
  });

  it('relocates between the holder’s own worlds, and only through its own space', () => {
    const s0 = createSeedState('drajk');
    const mine = s0.systems.filter((x) => x.controllerFactionId === 'drajk');
    const adjacent = mine.find((a) => mine.some((b) => b.id !== a.id && a.hyperlaneEdges.includes(b.id)));
    expect(adjacent).toBeDefined();
    const to = mine.find((b) => b.id !== adjacent!.id && adjacent!.hyperlaneEdges.includes(b.id))!;
    const { s } = withOfficerHeld('drajk', adjacent!.id);
    const out = applyOps(s, [fate('relocate', { toSystemId: to.id })], 'model', 'drajk');
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.find((a) => a.id === 'ast-p')!.atSystemId).toBe(to.id);

    const foreign = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    const refused = applyOps(s, [fate('relocate', { toSystemId: foreign.id })], 'model', 'drajk');
    expect(refused.rejections).toHaveLength(1);
  });

  it('will not decide the fate of somebody else’s prisoner, or of a thing', () => {
    const { s } = withOfficerHeld('vigil');
    expect(applyOps(s, [fate('execute')], 'model', 'drajk').rejections).toHaveLength(1);
    const thing = s.assets.find((a) => a.kind !== 'officer' && !['prisoners', 'hostage', 'defector', 'operative'].includes(a.kind))!;
    const out = applyOps(s, [{ op: 'decide_fate', assetId: thing.id, fate: 'release' } as OpInput], 'model', thing.heldBy);
    expect(out.rejections[0]?.message).toMatch(/not a person/);
  });
});
