import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn, type LegacyRules } from '../src/domain/reducer.js';
import { SECRET_EXPOSURE_COST, SECRET_RESENTMENT, type Agent } from '../src/domain/diplomacy.js';
import { secretsAbout } from '../src/domain/leverage.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Secrets (journal version 13): a watcher at work digs up proof of what its
 * host hides — typed from state, never invented — which the holder publishes
 * or spends for a strong hook.
 */

const agent = (over: Partial<Agent>): Agent => ({
  id: 'agt-x',
  ownerFactionId: 'meridian',
  systemId: 'tor-2',
  mission: 'surveillance',
  effect: { kind: 'intel', revealsOrders: true },
  inPlaceFrom: 0,
  successChance: 100,
  deployedTurn: 0,
  exposed: false,
  cover: '',
  name: 'A Watcher',
  operations: 0,
  timesCaught: 0,
  targetCommanderId: null,
  ...over,
});

/** Meridian watching the Vigil's Kalzir, while a Vigil operative works Arkane Prime. */
function board(): WorldState {
  const s = createSeedState('meridian');
  s.agents.push(agent({}));
  s.agents.push(
    agent({ id: 'agt-v', ownerFactionId: 'vigil', systemId: 'ark-1', mission: 'theft', effect: { kind: 'income_penalty', perTurn: 5 }, name: 'A Thief' }),
  );
  return s;
}

/** Tick until the watcher files something, or give up. */
function dig(s: WorldState, legacy: LegacyRules = {}): WorldState {
  for (let i = 0; i < 40; i++) {
    s = tickTurn(s, { randomEvents: false, ...legacy }).state;
    if (s.assets.some((a) => a.secret)) return s;
  }
  return s;
}

const proof = (s: WorldState) => s.assets.find((a) => a.secret)!;
const regard = (s: WorldState, from: string, toward: string) =>
  s.factions.find((f) => f.id === from)!.disposition[toward] ?? 0;

describe('a watcher digs', () => {
  it('finds a secret its host is really keeping, and files it as proof', () => {
    expect(secretsAbout(board(), 'vigil')).toEqual([{ kind: 'covert_operation', subject: 'vigil', ref: 'agt-v' }]);
    const s = dig(board());
    expect(proof(s)).toMatchObject({
      kind: 'dossier',
      heldBy: 'meridian',
      secret: { kind: 'covert_operation', subject: 'vigil', ref: 'agt-v' },
    });
  });

  it('files nothing in a journal from before secrets', () => {
    const s = dig(board(), { secrets: false });
    expect(s.assets.some((a) => a.secret)).toBe(false);
  });

  it('finds nothing on a power keeping no secrets', () => {
    const s = board();
    s.agents = s.agents.filter((a) => a.id !== 'agt-v');
    expect(secretsAbout(s, 'vigil')).toEqual([]);
  });
});

describe('using proof', () => {
  const use = (s: WorldState, op: string) =>
    applyOps(s, [{ op, assetId: proof(s).id } as OpInput], 'model', 'meridian');

  it('published, it costs the subject standing with everyone and burns the operative', () => {
    const s = dig(board());
    const out = use(s, 'publish_dossier');
    expect(out.rejections).toEqual([]);
    expect(out.state.agents.find((a) => a.id === 'agt-v')!.exposed).toBe(true);
    expect(regard(out.state, 'ojjul', 'vigil')).toBe(Math.max(-100, regard(s, 'ojjul', 'vigil') - SECRET_EXPOSURE_COST.covert_operation));
    expect(regard(out.state, 'vigil', 'meridian')).toBe(Math.max(-100, regard(s, 'vigil', 'meridian') - SECRET_RESENTMENT));
    expect(out.state.assets.some((a) => a.secret)).toBe(false);
  });

  it('kept quiet, it buys a strong hook', () => {
    const s = dig(board());
    const out = use(s, 'blackmail');
    expect(out.rejections).toEqual([]);
    expect(out.state.obligations.at(-1)).toMatchObject({
      debtorFactionId: 'vigil',
      holderFactionId: 'meridian',
      strength: 'strong',
      origin: 'blackmail',
    });
  });

  it('a hook bought with it lasts only as long as the secret does', () => {
    const s = dig(board());
    let t = use(s, 'blackmail').state;
    const hook = () => t.obligations.find((o) => o.origin === 'blackmail')!;
    expect(hook().secret).toMatchObject({ kind: 'covert_operation', ref: 'agt-v' });
    // The Vigil pulls its operative out, and with it the thing it was held by.
    t = applyOps(t, [{ op: 'recall_agent', agentId: 'agt-v' } as OpInput], 'model', 'vigil').state;
    const called = applyOps(
      t,
      [{ op: 'call_obligation', obligationId: hook().id, call: 'sign', treatyType: 'non_aggression' } as OpInput],
      'model',
      'meridian',
    );
    expect(called.rejections[0]?.message).toMatch(/nothing left to threaten/);
    t = tickTurn(t, { randomEvents: false }).state;
    expect(hook().status).toBe('lapsed');
  });

  it('is old news once what it proves is over', () => {
    const s = dig(board());
    s.agents.find((a) => a.id === 'agt-v')!.exposed = true;
    expect(use(s, 'publish_dossier').rejections[0]?.message).toMatch(/old news/);
  });

  it('a file bought across a table proves nothing it can be used for', () => {
    const s = board();
    s.assets.push({
      id: 'ast-9-9', kind: 'dossier', text: 'a file', heldBy: 'meridian', quantity: 1, unit: 'file',
      commanderId: null, agentId: null, divisible: false, valuePerUnit: {}, speculative: false,
      valueRange: {}, uses: null, atSystemId: null, portable: true, yield: null, acquiredTurn: 0,
    });
    const out = applyOps(s, [{ op: 'blackmail', assetId: 'ast-9-9' } as OpInput], 'model', 'meridian');
    expect(out.rejections[0]?.message).toMatch(/proves nothing/);
  });
});
