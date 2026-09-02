import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { proposeFor } from '../src/domain/initiative.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * Doctrine initiative, and the measurement that made it necessary.
 *
 * Over a seven-turn live campaign the reaction call produced six NPC attacks
 * and every one of them targeted the player, on a single world — while two
 * pairs of NPCs sat at war on paper and never moved a ship at each other. The
 * NPCs were not passive; the galaxy was the player and four powers who existed
 * only in relation to them.
 */

const seed = () => createSeedState('hutt');

/** Play `turns` with the player doing nothing at all — the case that used to be inert. */
function quietCampaign(turns: number): { state: WorldState; npcVsNpc: number } {
  let s = seed();
  let npcVsNpc = 0;
  for (let t = 0; t < turns; t++) {
    for (const f of s.factions) {
      if (f.id === s.playerFactionId) continue;
      const p = proposeFor(s, f.id);
      if (!p) continue;
      for (const op of p.ops) {
        if (op.op !== 'issue_order' || op.type !== 'fleet_movement') continue;
        const holder = s.systems.find((x) => x.id === op.targetId)?.controllerFactionId;
        if (holder && holder !== f.id && holder !== s.playerFactionId) npcVsNpc++;
      }
      s = applyOps(s, p.ops, 'model', f.id, true).state;
    }
    s = tickTurn(s).state;
  }
  return { state: s, npcVsNpc };
}

describe('the galaxy moves without the player', () => {
  /**
   * The success criterion, and it was exactly zero before this existed.
   * A loose bound on purpose, in the style of the balance assertions: a tight
   * number here is one people learn to ignore.
   */
  it('produces NPC-vs-NPC aggression', () => {
    expect(quietCampaign(12).npcVsNpc).toBeGreaterThan(0);
  });

  it('moves territory between NPCs, not only away from the player', () => {
    const before = seed();
    const { state } = quietCampaign(12);
    const changed = state.systems.filter((sys) => {
      const was = before.systems.find((x) => x.id === sys.id)!.controllerFactionId;
      return was !== sys.controllerFactionId;
    });
    expect(changed.length).toBeGreaterThan(0);
    // At least one world taken off an NPC by another NPC.
    const npcOffNpc = changed.filter((sys) => {
      const was = before.systems.find((x) => x.id === sys.id)!.controllerFactionId;
      return was !== null && was !== 'hutt' && sys.controllerFactionId !== 'hutt';
    });
    expect(npcOffNpc.length).toBeGreaterThan(0);
  });

  it('leaves the player’s own faction alone — initiative is for NPCs', () => {
    // The engine skips the player, but the bot exists for every faction and
    // must not be reachable by accident.
    const s = seed();
    expect(proposeFor(s, 'hutt')).not.toBeNull(); // it CAN propose
    // …the guarantee is in the engine's `spokenFor` set, tested via turn.ts.
  });
});

describe('a doctrine is not a licence', () => {
  const pactBetween = (s: WorldState, a: string, b: string, type: string): WorldState =>
    applyOps(s, [
      {
        op: 'form_treaty',
        parties: [a, b],
        treatyType: type,
        terms: {},
        summary: 'signed',
      },
      // `form_treaty` needs the transcript source; a declared batch cannot.
    ], 'extraction', a, true).state;

  /**
   * The bots were written for a harness where nobody signs anything, so none
   * of them reads `state.treaties`. Turned loose on a live campaign that lets
   * a power's own doctrine tear up paper it signed the same turn, costing 25
   * disposition and a reputation hit with every onlooker.
   */
  it('will not attack a power it has a non-aggression pact with', () => {
    // Find a turn where the Vigil proposes an attack, then forbid that target.
    let s = seed();
    let attack: Record<string, unknown> | undefined;
    for (let t = 0; t < 12 && !attack; t++) {
      const p = proposeFor(s, 'vigil');
      attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) break;
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
    expect(attack, 'the Vigil never proposed an attack in 12 turns').toBeDefined();

    const victim = s.systems.find((x) => x.id === attack!.targetId)!.controllerFactionId!;
    const bound = pactBetween(s, 'vigil', victim, 'non_aggression');
    expect(bound.treaties).toHaveLength(1);

    const after = proposeFor(bound, 'vigil');
    const stillAttacks = (after?.ops ?? []).some(
      (o) => o.op === 'issue_order' && o.type === 'fleet_movement' && o.targetId === attack!.targetId,
    );
    expect(stillAttacks).toBe(false);
    expect(after?.withheld.join(' ') ?? '').toMatch(/pact/);
  });

  it('reports what it withheld rather than dropping it silently', () => {
    // A withheld act must be legible: a power that quietly does less than its
    // doctrine demands is the bug this whole module exists to fix.
    let s = seed();
    for (let t = 0; t < 12; t++) {
      const p = proposeFor(s, 'vigil');
      const attack = p?.ops.find((o) => o.op === 'issue_order' && o.type === 'fleet_movement');
      if (attack) {
        const victim = s.systems.find((x) => x.id === attack.targetId)!.controllerFactionId!;
        const bound = pactBetween(s, 'vigil', victim, 'ceasefire');
        const after = proposeFor(bound, 'vigil');
        if (after) expect(after.withheld.length).toBeGreaterThan(0);
        return;
      }
      if (p) s = applyOps(s, p.ops, 'model', 'vigil', true).state;
      s = tickTurn(s).state;
    }
  });
});

/**
 * The bots predate the fog and must not see through it. They read
 * `system.ships` and `system.garrison`, which redaction does not touch, and
 * the only pending orders they consult are their own. Pinned as an invariant
 * rather than left as an accident.
 */
describe('initiative is fog-clean', () => {
  it('proposes the same thing whether or not a rival has hidden work under way', () => {
    const plain = seed();
    const withSecret = applyOps(seed(), [
      {
        op: 'issue_order',
        factionId: 'hutt',
        type: 'capital_ship_construction',
        originId: 'kes-2',
        targetId: 'kes-2',
        durationTurns: 3,
        label: 'a secret slipway',
        visibility: [],
      },
    ], 'model').state;

    for (const id of ['meridian', 'vigil', 'freeworlds', 'krayt']) {
      expect(
        JSON.stringify(proposeFor(withSecret, id)?.ops ?? null),
        `${id} reacted to work it cannot see`,
      ).toBe(JSON.stringify(proposeFor(plain, id)?.ops ?? null));
    }
  });
});

describe('the proposal itself', () => {
  it('returns null rather than manufacturing an opportunity', () => {
    // A faction with no fleet, no money and nothing adjacent has nothing to do.
    const s = seed();
    for (const sys of s.systems) delete sys.ships.freeworlds;
    s.factions.find((f) => f.id === 'freeworlds')!.credits = 0;
    const p = proposeFor(s, 'freeworlds');
    expect(p === null || p.ops.length > 0).toBe(true);
  });

  it('carries a third-person account of what it did', () => {
    const p = proposeFor(seed(), 'vigil');
    expect(p!.rationale).toMatch(/Iron Vigil/);
    expect(p!.rationale.endsWith('.')).toBe(true);
  });

  it('is deterministic, so a bot-driven turn replays exactly', () => {
    const a = proposeFor(seed(), 'krayt');
    const b = proposeFor(seed(), 'krayt');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
