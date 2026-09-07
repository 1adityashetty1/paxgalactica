import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { addShipsAt, ledgerFor, setShipsAt, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * A treaty conflates three things: what was AGREED (the conversation), what was
 * RECORDED (the object), and what is IN FORCE (`active`, past `effectiveTurn`,
 * not void). Phantom and contradictory effects come from those diverging with
 * nothing to reconcile them.
 */

const seed = () => createSeedState('ojjul');

const tribute = (perTurn: number, extra: Record<string, unknown> = {}): OpInput =>
  ({
    op: 'form_treaty',
    treatyType: 'tribute',
    parties: ['drajk', 'freeworlds'],
    terms: { incomePerTurn: { drajk: perTurn, freeworlds: -perTurn } },
    summary: `tribute at ${perTurn}`,
    ...extra,
  }) as OpInput;

const sign = (s: WorldState, op: OpInput) => applyOps(s, [op], 'extraction', 'drajk', true);
const live = (s: WorldState) => s.treaties.filter((t) => t.status === 'active');

describe('a renegotiated treaty replaces the old one instead of stacking', () => {
  /**
   * Measured live: both parties said "supersedes" out loud, both treaties
   * stayed active, and Arkane believed it paid 40 and paid 65.
   */
  it('supersedes a prior tribute between the same pair', () => {
    let s = sign(seed(), tribute(40)).state;
    expect(live(s)).toHaveLength(1);
    const paidOnce = ledgerFor(s, 'drajk').treatyFlow;

    s = sign(s, tribute(55)).state;
    expect(live(s)).toHaveLength(1);
    expect(s.treaties.filter((t) => t.status === 'superseded')).toHaveLength(1);

    // The new rate, not the sum of both.
    expect(ledgerFor(s, 'drajk').treatyFlow).toBe(55);
    expect(ledgerFor(s, 'drajk').treatyFlow).not.toBe(paidOnce + 55);
  });

  it('supersedes a duplicate pact that carries no terms at all', () => {
    const pact = (summary: string): OpInput =>
      ({
        op: 'form_treaty', treatyType: 'non_aggression',
        parties: ['drajk', 'freeworlds'], terms: {}, summary,
      }) as OpInput;
    let s = sign(seed(), pact('first')).state;
    s = sign(s, pact('second')).state;
    expect(live(s)).toHaveLength(1);
    expect(live(s)[0]!.summary).toBe('second');
  });

  /**
   * The tempting rule is "one live treaty per (pair, type)" and it is wrong:
   * two accords granting DIFFERENT lanes are two deals. Pinned since item 26.
   */
  it('leaves a treaty alone whose terms do not collide', () => {
    const share = (systemId: string): OpInput =>
      ({
        op: 'form_treaty', treatyType: 'trade_accord',
        parties: ['drajk', 'freeworlds'],
        terms: { incomeShares: [{ systemId, factionId: 'drajk', share: 0.05 }] },
        summary: `lane ${systemId}`,
      }) as OpInput;
    let s = sign(seed(), share('ark-1')).state;
    s = sign(s, share('ark-3')).state;
    expect(live(s)).toHaveLength(2);
  });

  it('leaves a different type between the same pair alone', () => {
    let s = sign(seed(), tribute(40)).state;
    s = sign(s, {
      op: 'form_treaty', treatyType: 'non_aggression',
      parties: ['drajk', 'freeworlds'], terms: {}, summary: 'and a pact',
    } as OpInput).state;
    expect(live(s)).toHaveLength(2);
  });

  it('leaves an unrelated pair alone', () => {
    let s = sign(seed(), tribute(40)).state;
    s = applyOps(s, [{
      op: 'form_treaty', treatyType: 'tribute',
      parties: ['drajk', 'meridian'],
      terms: { incomePerTurn: { drajk: 30, meridian: -30 } }, summary: 'other pair',
    }], 'extraction', 'drajk', true).state;
    expect(live(s)).toHaveLength(2);
  });

  /**
   * A pending treaty must not retire the live one it will replace, or the
   * parties have nothing in force while a council deliberates.
   */
  it('supersedes only when the replacement actually comes into force', () => {
    let s = sign(seed(), tribute(40)).state;
    s = sign(s, tribute(55, { ratifyTurns: 2 })).state;

    // Still the old rate while the new one is pending.
    expect(live(s)).toHaveLength(1);
    expect(ledgerFor(s, 'drajk').treatyFlow).toBe(40);

    s = tickTurn(s).state;
    s = tickTurn(s).state;
    expect(live(s)).toHaveLength(1);
    expect(ledgerFor(s, 'drajk').treatyFlow).toBe(55);
  });
});

describe('a treaty that is already void cannot be signed', () => {
  /**
   * `voidConditionMet` had one caller, in `tickTurn` — so such a treaty was
   * recorded active, announced, shown, and killed on the next tick, having paid
   * nothing while both parties believed in it.
   */
  const withCondition = (): OpInput =>
    ({
      op: 'form_treaty', treatyType: 'tribute',
      parties: ['drajk', 'meridian'],
      terms: {
        incomePerTurn: { drajk: 15, meridian: -15 },
        voidsOn: [{ kind: 'attacks', by: 'drajk', target: 'meridian' }],
      },
      summary: 'a toll voided by war',
    }) as OpInput;

  it('is refused when the condition already holds at signature', () => {
    const s = seed();
    // Already at war: the void condition is true before the ink is dry.
    s.factions.find((f) => f.id === 'drajk')!.disposition.meridian = -90;

    const out = applyOps(s, [withCondition()], 'extraction', 'drajk', true);
    expect(out.rejections.map((r) => r.code)).toContain('already_void');
    expect(out.state.treaties).toHaveLength(0);
    expect(out.rejections[0]!.message).toMatch(/voids the moment it is signed/);
  });

  it('signs normally when the condition does not hold', () => {
    const s = seed();
    s.factions.find((f) => f.id === 'drajk')!.disposition.meridian = 10;
    const out = applyOps(s, [withCondition()], 'extraction', 'drajk', true);
    expect(out.rejections).toHaveLength(0);
    expect(live(out.state)).toHaveLength(1);
  });
});

/**
 * A refused accord kills the ops and keeps the conversation, and transcripts
 * are replayed into the persona — so the other power went on believing it had
 * granted a concession the world had no record of. Measured live: an NPC
 * forgave 100 of a debt inside a refused accord and spent the rest of the
 * campaign treating it as done (*"my pen already struck the first hundred"*)
 * while the balance ran down on instalments alone.
 */
describe('a refused accord says so in its own transcript', () => {
  it('renders the record line without attributing it to either party', () => {
    const campaign = Campaign.start('drajk', 'refused', new MemoryCampaignStore());
    campaign.recordTranscript('freeworlds', [
      { speaker: 'player', text: 'Forgive the first hundred and we have a deal.' },
      { speaker: 'faction', text: 'Done. My pen strikes it tonight.' },
      { speaker: 'record', text: '[This accord was REFUSED by the captains and never took effect.]' },
    ]);

    const [replayed] = campaign.priorTranscripts('freeworlds');
    expect(replayed).toContain('Them: Forgive the first hundred');
    expect(replayed).toContain('You: Done.');
    // The engine's note is not a line either of them spoke.
    expect(replayed).toContain('[This accord was REFUSED');
    expect(replayed).not.toContain('You: [This accord');
    expect(replayed).not.toContain('Them: [This accord');
  });

  it('survives a save and a reload, because the persona reads it next turn', () => {
    const campaign = Campaign.start('drajk', 'refused-save', new MemoryCampaignStore());
    campaign.recordTranscript('freeworlds', [
      { speaker: 'faction', text: 'Done.' },
      { speaker: 'record', text: '[This accord was REFUSED by the captains.]' },
    ]);
    const back = Campaign.fromSaveFile('refused-save', campaign.toSaveFile(), new MemoryCampaignStore());
    expect(back.priorTranscripts('freeworlds')[0]).toContain('[This accord was REFUSED');
  });
});

/**
 * A treaty flow is a transfer, so it has to conserve.
 *
 * Nothing required the entries to sum to zero, so a negotiated "joint venture
 * that pays both houses" landed as `{drajk: 30, meridian: 20}` — both positive,
 * from nowhere. A playtest closed four of them and conjured 480 credits a turn
 * galaxy-wide at a cost of zero action points, and no NPC ever objected because
 * in fiction the arrangement is Pareto-improving.
 *
 * Both parties profiting is a legitimate deal; it is `establish_commitment`,
 * which is non-directional on purpose and bounded twice. This field exists
 * *because* a commitment cannot be directional.
 */
describe('a treaty flow cannot pay out more than it takes in', () => {
  const sign = (incomePerTurn: Record<string, number>) =>
    applyOps(
      seed(),
      [
        {
          op: 'form_treaty', treatyType: 'trade_accord',
          parties: ['ojjul', 'drajk'],
          terms: { incomePerTurn },
          summary: 'joint venture',
        },
      ],
      'extraction',
      'ojjul',
    );

  it('drops a flow that pays everyone and takes from nobody', () => {
    const res = sign({ ojjul: 30, drajk: 20 });
    expect(res.rejections).toHaveLength(0);
    const treaty = res.state.treaties.at(-1)!;
    // The accord itself survives — only the money that came from nowhere goes.
    expect(treaty.terms.incomePerTurn).toEqual({});
    expect(res.notes.join(' ')).toMatch(/establish_commitment/);
  });

  it('keeps a real transfer exactly as written', () => {
    const res = sign({ ojjul: -45, drajk: 45 });
    expect(res.state.treaties.at(-1)!.terms.incomePerTurn).toEqual({
      ojjul: -45,
      drajk: 45,
    });
    expect(res.notes.join(' ')).not.toMatch(/cannot pay out more/);
  });

  it('trims receipts to what is actually being paid', () => {
    const res = sign({ ojjul: 50, drajk: -20 });
    const flow = res.state.treaties.at(-1)!.terms.incomePerTurn;
    expect(flow['drajk']).toBe(-20);
    expect(flow['ojjul']).toBe(20);
    expect(res.notes.join(' ')).toMatch(/cannot pay out more than it takes in/);
  });

  it('conserves after the per-entry ceiling has already trimmed', () => {
    // Both trims run, and the conservation one sees the bounded figures.
    const res = sign({ ojjul: 500, drajk: -500 });
    const flow = res.state.treaties.at(-1)!.terms.incomePerTurn;
    const sum = Object.values(flow).reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(0);
  });

  it('leaves the galaxy unable to print money through diplomacy', () => {
    // The playtest's four accords, all at once.
    let state = seed();
    for (const other of ['drajk', 'vigil', 'freeworlds', 'meridian']) {
      state = applyOps(
        state,
        [
          {
            op: 'form_treaty', treatyType: 'trade_accord',
            parties: ['ojjul', other],
            terms: { incomePerTurn: { ojjul: 60, [other]: 60 } },
            summary: 'joint venture',
          },
        ],
        'extraction',
        'ojjul',
      ).state;
    }
    const sumOf = (flow: Record<string, number>): number =>
      Object.values(flow).reduce((a, b) => a + b, 0);
    const injected = state.treaties
      .filter((t) => t.status === 'active')
      .reduce((n, t) => n + sumOf(t.terms.incomePerTurn), 0);
    expect(injected).toBeLessThanOrEqual(0);
  });
});

/**
 * Item 59, and the correction that came with it.
 *
 * I reported that a `basing_rights` partner could storm the grantor's world and
 * keep the treaty. **That was an artefact of a malformed fixture** — the probe
 * set `treatyType`, which is the field on the *op*, where a `Treaty` carries
 * `type`. With no valid treaty `guest()` never matched and the invader was an
 * ordinary attacker.
 *
 * With a real grant the mechanism works: a guest is filtered out of the
 * attackers entirely and simply puts in. A partner who wants to attack has to
 * repudiate the treaty first, which is exactly the explicit, priced act it
 * should be.
 */
describe('a fleet under basing rights puts in rather than invades', () => {
  const fresh = (): WorldState => createSeedState('meridian');
  const sys = (w: WorldState, id: string) => w.systems.find((x) => x.id === id)!;
  const arrive = (type: 'basing_rights' | 'trade_accord') => {
    const s = fresh();
    s.treaties.push({
      id: 't-base', type, parties: ['meridian', 'vigil'],
      summary: 'basing', status: 'active', signedTurn: 0, expiresTurn: null,
      terms: {
        voidsOn: [], territory: [], shipsPledged: {}, incomePerTurn: {},
        payment: {}, incomeShares: [], mutualDefenseTrigger: '',
      },
    } as never);
    const t = sys(s, 'tor-2');
    setShipsAt(t, 'vigil', 0);
    t.garrison = 4;
    t.garrisonMax = 4;
    const o = sys(s, 'sek-1');
    setShipsAt(o, 'meridian', 0);
    addShipsAt(o, 'meridian', 40, 'battleship');
    addShipsAt(o, 'meridian', 6, 'lifter');
    const out = applyOps(s, [{
      op: 'issue_order', factionId: 'meridian', type: 'fleet_movement',
      originId: 'sek-1', targetId: 'tor-2', force: { battleship: 40, lifter: 6 },
    }], 'model', 'meridian');
    let r = tickTurn(out.state);
    for (let i = 0; i < 8 && r.state.pendingOrders.length > 0; i++) r = tickTurn(r.state);
    return r.state;
  };

  it('cannot take the world it was invited into', () => {
    const after = arrive('basing_rights');
    expect(sys(after, 'tor-2').controllerFactionId).toBe('vigil');
    expect(after.treaties.find((t) => t.id === 't-base')?.status).toBe('active');
  });

  it('and a trade accord grants no such shelter', () => {
    // Deliberately narrow: a `trade_accord` concerns lanes, not orbits, so the
    // same fleet arriving under one is an invasion.
    expect(sys(arrive('trade_accord'), 'tor-2').controllerFactionId).toBe('meridian');
  });
});
