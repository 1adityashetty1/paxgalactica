import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { AGENT_LIST_SIZE, familyOf, givenNamesFor, listedAgentsOf, NAME_STOCK_FACTIONS } from '../src/domain/command.js';

import { ledgerFor, liveAgentsOf, maxAgentsFor, type WorldState } from '../src/domain/state.js';
import { worldAsSeenBy } from '../src/domain/intel.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Operatives come off a power's Lists — three always waiting — and only by
 * `recruit_agent`; a recalled one and one handed home go back on them, record
 * and all. Journal version 22.
 */
const home = (s: WorldState, f: string) => s.systems.find((x) => x.controllerFactionId === f)!.id;
const recruit = (s: WorldState, f: string, extra: Record<string, unknown> = {}) =>
  applyOps(s, [{ op: 'recruit_agent', systemId: home(s, f), ...extra } as OpInput], 'model', f);

describe('the operatives’ Lists', () => {
  it('open with three waiting for every power, standing nowhere and costing nothing', () => {
    const s = createSeedState('meridian');
    for (const f of s.factions) expect(listedAgentsOf(s.listedAgents, f.id)).toHaveLength(AGENT_LIST_SIZE);
    const bare = createSeedState('meridian', { agentLists: false });
    expect(bare.listedAgents).toEqual([]);
    expect(ledgerFor(s, 'meridian').net).toBe(ledgerFor(bare, 'meridian').net);
    expect(liveAgentsOf(s, 'meridian')).toHaveLength(liveAgentsOf(bare, 'meridian').length);
  });

  it('give up the one named, or the first, onto the books — and put another forward', () => {
    const s = createSeedState('meridian');
    const [first, second] = listedAgentsOf(s.listedAgents, 'meridian');
    const byName = recruit(s, 'meridian', { agent: second!.name });
    expect(byName.rejections).toEqual([]);
    expect(byName.state.agents.at(-1)!.name).toBe(second!.name);
    expect(listedAgentsOf(byName.state.listedAgents, 'meridian').map((a) => a.name)).not.toContain(second!.name);
    expect(listedAgentsOf(byName.state.listedAgents, 'meridian')).toHaveLength(AGENT_LIST_SIZE);
    expect(recruit(s, 'meridian').state.agents.at(-1)!.name).toBe(first!.name);
  });

  it('are the only way onto the books: nobody by a name not listed, nobody of a rival’s, nobody past the slots', () => {
    const s = createSeedState('meridian');
    expect(recruit(s, 'meridian', { agent: 'Nobody Atall' }).rejections[0]?.code).toBe('illegal_value');
    const theirs = listedAgentsOf(s.listedAgents, 'vigil')[0]!;
    expect(recruit(s, 'meridian', { agent: theirs.name }).rejections[0]?.code).toBe('illegal_value');
    let full = s;
    for (let i = liveAgentsOf(s, 'meridian').length; i < maxAgentsFor(s, 'meridian'); i++) full = recruit(full, 'meridian').state;
    expect(recruit(full, 'meridian').rejections[0]?.code).toBe('illegal_value');
  });

  it('take back a recalled operative with their record, and recruit them again as themselves', () => {
    let s = recruit(createSeedState('meridian'), 'meridian').state;
    const spy = s.agents.at(-1)!;
    spy.operations = 5;
    spy.timesCaught = 1;
    s = applyOps(s, [{ op: 'recall_agent', agentId: spy.id, reason: '' } as OpInput], 'model', 'meridian').state;
    expect(s.agents.some((a) => a.id === spy.id)).toBe(false);
    const listed = listedAgentsOf(s.listedAgents, 'meridian').find((a) => a.name === spy.name)!;
    expect(listed).toMatchObject({ served: true, operations: 5, timesCaught: 1 });
    const back = recruit(s, 'meridian', { agent: spy.name }).state.agents.at(-1)!;
    expect(back).toMatchObject({ name: spy.name, operations: 5, timesCaught: 1, mission: null });
    // A rival cannot recall them.
    const again = recruit(s, 'meridian', { agent: spy.name }).state;
    expect(applyOps(again, [{ op: 'recall_agent', agentId: again.agents.at(-1)!.id, reason: '' } as OpInput], 'model', 'vigil').rejections[0]?.code).toBe('illegal_value');
  });

  it('take home an operative handed back from captivity, and no recruit is drawn from a ransom', () => {
    const s = createSeedState('drajk');
    const host = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    s.agents.push({
      id: 'agt-home', ownerFactionId: 'drajk', systemId: host.id, mission: 'theft',
      effect: { kind: 'income_penalty', perTurn: 4 }, successChance: 40, exposed: true,
      deployedTurn: 0, inPlaceFrom: 0, cover: '', targetCommanderId: null, name: 'Ravel Coldwake',
      operations: 4, timesCaught: 1,
    });
    s.assets.push({
      id: 'ast-home', kind: 'operative', text: 'them', heldBy: 'vigil', quantity: 1, unit: 'person',
      commanderId: null, agentId: 'agt-home', divisible: false, valuePerUnit: {}, speculative: false,
      valueRange: {}, uses: null, atSystemId: host.id, portable: true, yield: null, acquiredTurn: 0,
    });
    expect(applyOps(s, [{ op: 'recall_agent', agentId: 'agt-home', reason: '' } as OpInput], 'model', 'drajk').rejections[0]?.code).toBe('illegal_value');
    const handed = applyOps(s, [{ op: 'transfer_asset', assetId: 'ast-home', toFactionId: 'drajk', reason: '' }], 'model', 'vigil').state;
    expect(handed.agents.some((a) => a.id === 'agt-home')).toBe(false);
    expect(handed.assets.some((a) => a.id === 'ast-home')).toBe(false);
    expect(listedAgentsOf(handed.listedAgents, 'drajk').find((a) => a.name === 'Ravel Coldwake')).toMatchObject({
      served: true, operations: 4, timesCaught: 1,
    });
    expect(recruit(handed, 'drajk', { fromAssetId: 'ast-home' }).rejections[0]?.code).toBe('illegal_value');
  });

  it('keep a rival’s Lists out of the served view, and restock after a tick', () => {
    const s = createSeedState('meridian');
    expect(worldAsSeenBy(s, 'meridian').listedAgents.every((a) => a.ownerFactionId === 'meridian')).toBe(true);
    s.listedAgents = s.listedAgents.filter((a) => a.ownerFactionId !== 'vigil');
    expect(listedAgentsOf(tickTurn(s).state.listedAgents, 'vigil')).toHaveLength(AGENT_LIST_SIZE);
  });
});

describe('the wider name stock', () => {
  it('reaches past the old thirty families, and only from journal version 22', () => {
    const wide = createSeedState('meridian');
    const narrow = createSeedState('meridian', { widerNames: false, agentLists: false });
    expect(wide.commanders.length).toBeGreaterThan(0);
    // Every power names many more people now; none of them is a joined pair
    // while the stock lasts, and every family is still one person's.
    const families = [...wide.commanders, ...wide.listedAgents, ...wide.notables].map((p) => familyOf(p.name));
    expect(families.every((f) => f !== null)).toBe(true);
    expect(new Set(families).size).toBe(families.length);
    expect(narrow.listedAgents).toEqual([]);
    for (const f of NAME_STOCK_FACTIONS) expect(givenNamesFor(f)).toHaveLength(20);
  });
});
