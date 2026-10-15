import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { ledgerFor, type WorldState } from '../src/domain/state.js';
import {
  COMMANDER_ARCHETYPES,
  COMMANDER_COST,
  activeCommanders,
  commanderFor,
  listedOfficers,
} from '../src/domain/command.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Officers come off the Lists — one of each school always waiting — and go into
 * post only by appointment. Journal version 20.
 */
const home = (s: WorldState, f: string) => s.systems.find((x) => x.controllerFactionId === f)!.id;
const appoint = (s: WorldState, f: string, extra: Record<string, unknown>) =>
  applyOps(s, [{ op: 'recruit_commander', factionId: f, systemId: home(s, f), ...extra } as OpInput], 'model', f);

describe('the officers’ Lists', () => {
  it('open with one officer of each school waiting for every power, commanding nothing and drawing no pay', () => {
    const s = createSeedState('meridian');
    for (const f of s.factions) {
      const listed = listedOfficers(s.commanders, f.id);
      expect(listed.map((c) => c.archetype).sort()).toEqual(COMMANDER_ARCHETYPES.map((a) => a.kind).sort());
      expect(listed.every((c) => c.atSystemId === null)).toBe(true);
      expect(activeCommanders(s.commanders, f.id).some((c) => c.status === 'listed')).toBe(false);
      expect(listed).not.toContainEqual(commanderFor(s.commanders, f.id));
    }
    const bare = createSeedState('meridian', { officerLists: false });
    expect(ledgerFor(s, 'meridian').commanderUpkeep).toBe(ledgerFor(bare, 'meridian').commanderUpkeep);
  });

  it('send their first of a school, at the price of a commission, and put another forward', () => {
    const s = createSeedState('meridian');
    const first = listedOfficers(s.commanders, 'meridian').find((c) => c.archetype === 'gunnery')!;
    const credits = s.factions.find((f) => f.id === 'meridian')!.credits;
    const r = appoint(s, 'meridian', { school: 'gunnery' });
    expect(r.rejections).toEqual([]);
    const now = r.state.commanders.find((c) => c.id === first.id)!;
    expect(now.status).toBe('active');
    expect(now.atSystemId).toBe(home(s, 'meridian'));
    expect(r.state.factions.find((f) => f.id === 'meridian')!.credits).toBe(credits - COMMANDER_COST);
    expect(listedOfficers(r.state.commanders, 'meridian').some((c) => c.archetype === 'gunnery')).toBe(true);
  });

  it('appoint by name, and only your own', () => {
    const s = createSeedState('meridian');
    const mine = listedOfficers(s.commanders, 'meridian').find((c) => c.archetype === 'convoy')!;
    expect(appoint(s, 'meridian', { officer: mine.name }).rejections).toEqual([]);
    const theirs = listedOfficers(s.commanders, 'vigil')[0]!;
    expect(appoint(s, 'meridian', { officer: theirs.name }).rejections[0]?.code).toBe('illegal_value');
    expect(appoint(s, 'meridian', {}).rejections[0]?.code).toBe('illegal_value');
  });

  it('take back an officer handed home, record and all, and put them in post again for nothing', () => {
    let s = createSeedState('meridian');
    const officer = commanderFor(s.commanders, 'vigil')!;
    officer.battles = 4;
    officer.status = 'captured';
    officer.atSystemId = null;
    s.assets.push({
      id: 'ast-officer', kind: 'officer', text: officer.name, heldBy: 'meridian',
      quantity: 1, unit: 'person', commanderId: officer.id, agentId: null,
      divisible: false, valuePerUnit: {}, speculative: false, valueRange: {},
      uses: null, atSystemId: home(s, 'meridian'), portable: true, yield: null, acquiredTurn: 0,
    } as WorldState['assets'][number]);
    s = applyOps(s, [{ op: 'transfer_asset', assetId: 'ast-officer', toFactionId: 'vigil', reason: '' }], 'model', 'meridian').state;
    const back = s.commanders.find((c) => c.id === officer.id)!;
    expect(back.status).toBe('listed');
    expect(back.battles).toBe(4);
    expect(s.assets.some((a) => a.id === 'ast-officer')).toBe(false);
    const credits = s.factions.find((f) => f.id === 'vigil')!.credits;
    const r = appoint(s, 'vigil', { officer: back.name });
    expect(r.rejections).toEqual([]);
    expect(r.state.factions.find((f) => f.id === 'vigil')!.credits).toBe(credits);
    expect(r.state.commanders.find((c) => c.id === officer.id)!.status).toBe('active');
  });

  it('put nobody in post by themselves: a power whose officer falls fights without one', () => {
    const s = createSeedState('meridian');
    for (const c of activeCommanders(s.commanders, 'drajk')) c.status = 'lost';
    const after = tickTurn(tickTurn(s).state).state;
    expect(activeCommanders(after.commanders, 'drajk')).toHaveLength(0);
  });
});
