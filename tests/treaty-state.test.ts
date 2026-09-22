import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { addShipsAt, ledgerFor, setShipsAt, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';
import { TREATY_GOODWILL } from '../src/domain/diplomacy.js';
import { COMMITMENT_BREAKING_COST } from '../src/domain/arbitration.js';

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

/**
 * A CESSION AND ITS PRICE ARE TWO HALVES OF ONE TRANSACTION.
 *
 * `cedeTerritory` has two call sites — signature, and ratification in
 * `tickTurn`. `settleTreatyPayment` had one. So any deal an NPC gated on
 * ratification handed the land over for nothing, which is exactly the failure
 * `cedeTerritory`'s own doc comment names: *"pricing only one of them is what
 * made a world cost 240 credits."*
 *
 * Measured in a live campaign: Threx sold to Meridian for 800 with
 * `ratifyTurns: 1`. The log recorded `drajk cedes Threx to meridian`. The 800
 * never moved.
 */
describe('a ratified cession is paid for', () => {
  const purse = (s: WorldState, id: string) => s.factions.find((f) => f.id === id)!.credits;
  const heldBy = (s: WorldState, sysId: string) =>
    s.systems.find((x) => x.id === sysId)!.controllerFactionId;

  const sale = (extra: Record<string, unknown>): OpInput => {
    const world = createSeedState('ojjul').systems.find(
      (x) => x.controllerFactionId === 'drajk',
    )!;
    return {
      op: 'form_treaty',
      treatyType: 'cession',
      parties: ['drajk', 'meridian'],
      terms: {
        territory: [world.id],
        payment: { drajk: 800, meridian: -800 },
      },
      summary: 'Drajk sells a world to Meridian for 800',
      ...extra,
    } as OpInput;
  };

  const world = createSeedState('ojjul').systems.find(
    (x) => x.controllerFactionId === 'drajk',
  )!.id;

  it('moves the money on the turn it moves the world', () => {
    const start = seed();
    const before = { drajk: purse(start, 'drajk'), meridian: purse(start, 'meridian') };

    let s = sign(start, sale({ ratifyTurns: 1 })).state;
    // Nothing yet: a pending treaty cedes nothing and pays nothing.
    expect(heldBy(s, world)).toBe('drajk');
    expect(purse(s, 'drajk')).toBe(before.drajk);

    s = tickTurn(s).state;
    expect(heldBy(s, world)).toBe('meridian');
    // The half that was missing. Income moves in the same tick, so assert the
    // delta covers the payment rather than pinning an exact treasury.
    expect(purse(s, 'drajk') - before.drajk).toBeGreaterThanOrEqual(800);
    expect(purse(s, 'meridian') - before.meridian).toBeLessThan(800);
  });

  it('charges exactly once, whichever path the treaty takes', () => {
    // The mirror hazard, and one this repo has already been bitten by:
    // `settleTreatyPayment` was once wired at both sites for one treaty and ran
    // twice, debiting the payer and then debiting whatever was left. The
    // signature path is gated on `!pending` and the ratification path only
    // promotes `pending` treaties, so exactly one fires.
    const start = seed();
    const before = purse(start, 'meridian');

    const immediate = sign(start, sale({})).state;
    const paidAtSignature = before - purse(immediate, 'meridian');
    expect(paidAtSignature).toBe(800);

    // Ticking afterwards must not charge a second time.
    const later = tickTurn(immediate).state;
    expect(before - purse(later, 'meridian')).toBeLessThanOrEqual(paidAtSignature);
  });
});

/**
 * A CESSION IS ITS OWN INSTRUMENT.
 *
 * A land transfer had no treaty type, so extraction borrowed one — and the
 * borrowed label was load-bearing in two places it had no business being. A
 * playtest moved three worlds, one of them the map's greatest junction, inside
 * a `basing_rights` treaty: the type that grants the right to ENTER without it
 * being an attack, which is the opposite of a handover. The counterparty's own
 * words in that transcript were *"Oridin, no … garrison standing, no world
 * changes hands"*, and two of the three systems were never asked for.
 *
 * Consent is the half code cannot verify. These are the halves it can.
 */
describe('a cession has to look like one', () => {
  const mine = () => createSeedState('drajk').systems.find((x) => x.controllerFactionId === 'drajk')!;
  const theirs = () =>
    createSeedState('drajk').systems.find((x) => x.controllerFactionId === 'meridian')!;

  const cede = (extra: Record<string, unknown>): OpInput =>
    ({
      op: 'form_treaty',
      treatyType: 'cession',
      parties: ['drajk', 'meridian'],
      terms: { territory: [mine().id] },
      summary: 'a world handed over',
      ...extra,
    }) as OpInput;

  it('refuses to move a border under a treaty about something else', () => {
    for (const type of ['basing_rights', 'trade_accord', 'non_aggression'] as const) {
      const res = sign(seed(), cede({ treatyType: type }));
      expect(res.rejections[0]?.code, type).toBe('illegal_value');
      expect(res.state.systems.find((x) => x.id === mine().id)!.controllerFactionId).toBe('drajk');
    }
  });

  it('refuses to expire, because land does not come back on its own', () => {
    // `cedeTerritory` is a one-time event and nothing returns the world when a
    // treaty lapses, so an expiring cession promises a return that never comes.
    // The playtest's three-world handover carried `expiresTurn: 20`.
    const res = sign(seed(), cede({ durationTurns: 20 }));
    expect(res.rejections[0]?.code).toBe('illegal_value');
  });

  it('will not write the other party’s world to the actor for nothing', () => {
    const res = sign(seed(), cede({ terms: { territory: [theirs().id] } }));
    expect(res.rejections[0]?.code).toBe('illegal_value');
    expect(res.state.systems.find((x) => x.id === theirs().id)!.controllerFactionId).toBe(
      'meridian',
    );
  });

  it('allows a purchase, because a price is what makes it a bargain', () => {
    const res = sign(
      seed(),
      cede({
        terms: { territory: [theirs().id], payment: { drajk: -400, meridian: 400 } },
      }),
    );
    expect(res.rejections).toEqual([]);
    expect(res.state.systems.find((x) => x.id === theirs().id)!.controllerFactionId).toBe('drajk');
  });

  it('always allows giving your own away', () => {
    const res = sign(seed(), cede({}));
    expect(res.rejections).toEqual([]);
    expect(res.state.systems.find((x) => x.id === mine().id)!.controllerFactionId).toBe('meridian');
  });
});

/**
 * The three things a treaty could not say, none of which is about marriage.
 *
 * A marriage is the case that exposed them and wants all three at once, which
 * is why it kept being filed as a `Commitment` — where it is private, and was
 * free to walk away from. Every one of these is reached for by arrangements
 * with no romance in them: a sole charter, an exclusive supply deal, a hostage
 * exchange, a single-creditor undertaking.
 */
describe('a treaty can be exclusive', () => {
  const marriage = (parties: string[], extra: Record<string, unknown> = {}): OpInput =>
    ({
      op: 'form_treaty',
      treatyType: 'contract',
      parties,
      terms: {},
      exclusive: true,
      summary: `bound: ${parties.join(' and ')}`,
      ...extra,
    }) as OpInput;

  const swear = (s: WorldState, op: OpInput, actor = 'drajk') =>
    applyOps(s, [op], 'extraction', actor, true);

  it('refuses a second exclusive arrangement with a different power', () => {
    // The gap: supersession is PAIR-LEVEL, so "I am already bound to somebody
    // else" was unsayable in the treaty system however the deal was worded.
    const once = swear(seed(), marriage(['drajk', 'ojjul'])).state;
    expect(live(once)).toHaveLength(1);

    const twice = swear(once, marriage(['drajk', 'meridian']));
    expect(twice.rejections.map((r) => r.code)).toEqual(['treaty_conflict']);
    // The blocking treaty is quoted, not merely refused — the same standard
    // `conflictingCommitment` is held to.
    expect(twice.rejections[0]!.message).toMatch(/already bound/i);
    expect(twice.rejections[0]!.message).toMatch(once.treaties[0]!.id);
    expect(live(twice.state)).toHaveLength(1);
  });

  it('blocks in both directions — a new exclusive deal over a live one, and the reverse', () => {
    // A power already bound exclusively cannot take a NON-exclusive arrangement
    // of the same type either: the exclusivity is a property of the standing
    // deal, not of the incoming one.
    const bound = swear(seed(), marriage(['drajk', 'ojjul'])).state;
    const casual = swear(
      bound,
      marriage(['drajk', 'meridian'], { exclusive: false }),
    );
    expect(casual.rejections.map((r) => r.code)).toEqual(['treaty_conflict']);

    // And an ordinary deal already live does not stop an exclusive one being
    // sworn elsewhere: nothing was promised about exclusivity.
    const ordinary = swear(seed(), marriage(['drajk', 'ojjul'], { exclusive: false })).state;
    expect(swear(ordinary, marriage(['meridian', 'vigil'])).rejections).toHaveLength(0);
  });

  it('still lets the same two powers renegotiate their own arrangement', () => {
    // The ordering the item named, and getting it backwards breaks one feature
    // or the other: refuse the same pair and a power cannot renegotiate its own
    // marriage; permit a different partner and exclusivity does nothing.
    const once = swear(seed(), marriage(['drajk', 'ojjul'])).state;
    const again = swear(once, marriage(['drajk', 'ojjul'], { summary: 'terms revised' }));
    expect(again.rejections).toHaveLength(0);
    // Superseded, not stacked.
    expect(live(again.state)).toHaveLength(1);
    expect(live(again.state)[0]!.summary).toBe('terms revised');
  });

  it('frees the partner once the exclusive treaty is broken', () => {
    const once = swear(seed(), marriage(['drajk', 'ojjul'])).state;
    const freed = applyOps(
      once,
      [{ op: 'break_treaty', treatyId: once.treaties[0]!.id, reason: 'repudiated' }],
      'model',
      'drajk',
    ).state;
    expect(swear(freed, marriage(['drajk', 'meridian'])).rejections).toHaveLength(0);
  });

  it('does not reach across types', () => {
    // Keyed on the closed `type`, which cannot drift the way a free-form
    // commitment slug can — at the price of coarseness within a type.
    const bound = swear(seed(), marriage(['drajk', 'ojjul'])).state;
    const other = swear(
      bound,
      marriage(['drajk', 'meridian'], { treatyType: 'non_aggression' }),
    );
    expect(other.rejections).toHaveLength(0);
  });

  it('defaults to false, so every treaty written before this loads unchanged', () => {
    const plain = applyOps(
      seed(),
      [{ op: 'form_treaty', treatyType: 'trade_accord', parties: ['drajk', 'ojjul'], terms: {}, summary: 'lanes' }],
      'extraction',
      'drajk',
      true,
    ).state;
    expect(plain.treaties[0]!.exclusive).toBe(false);
  });
});

describe('signing a treaty is worth standing', () => {
  const pact = (parties: string[]): OpInput =>
    ({
      op: 'form_treaty',
      treatyType: 'non_aggression',
      parties,
      terms: {},
      summary: 'peace',
    }) as OpInput;

  const view = (s: WorldState, who: string, of: string) =>
    s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;

  it('pays both parties, pairwise', () => {
    // Nothing in the treaty path moved disposition upward for the whole life of
    // the treaty system. `COMMITMENT_GOODWILL` did and was commitment-only, so
    // an arrangement that wanted to be worth something in standing had to be
    // filed privately — backwards, since the treaty is the public instrument.
    const before = seed();
    const after = applyOps(before, [pact(['drajk', 'ojjul'])], 'extraction', 'drajk', true).state;
    expect(view(after, 'drajk', 'ojjul')).toBe(view(before, 'drajk', 'ojjul') + TREATY_GOODWILL);
    expect(view(after, 'ojjul', 'drajk')).toBe(view(before, 'ojjul', 'drajk') + TREATY_GOODWILL);
  });

  it('pays nobody else, because the sign of an onlooker’s view is not determinable', () => {
    const before = seed();
    const after = applyOps(before, [pact(['drajk', 'ojjul'])], 'extraction', 'drajk', true).state;
    for (const witness of ['meridian', 'vigil', 'freeworlds']) {
      expect(view(after, witness, 'drajk'), witness).toBe(view(before, witness, 'drajk'));
      expect(view(after, witness, 'ojjul'), witness).toBe(view(before, witness, 'ojjul'));
    }
  });

  it('waits for ratification, and pays when the treaty comes into force', () => {
    // The same rule `supersedePriorTreaties` and `cedeTerritory` follow at both
    // sites: a deal a council still has to read has not yet done anything.
    const before = seed();
    const pending = applyOps(
      before,
      [{ ...(pact(['drajk', 'ojjul']) as Record<string, unknown>), ratifyTurns: 1 }] as OpInput[],
      'extraction',
      'drajk',
      true,
    ).state;
    expect(view(pending, 'drajk', 'ojjul')).toBe(view(before, 'drajk', 'ojjul'));

    // Against a control tick, not against the pre-tick value: the same tick
    // applies `TOLL_RESENTMENT`, and folding an unrelated −1 into this
    // expectation would leave it pinning two rules and explaining neither.
    const control = view(tickTurn(before).state, 'drajk', 'ojjul');
    const ratified = tickTurn(pending).state;
    expect(ratified.treaties[0]!.status).toBe('active');
    expect(view(ratified, 'drajk', 'ojjul')).toBe(control + TREATY_GOODWILL);
  });

  it('pays once for one bond — a renewal is not a fresh act of binding', () => {
    // Found by playing the war-ending case, which is exactly where a player has
    // every reason to keep redrafting terms. Each signature paid +8 and
    // `supersedePriorTreaties` retired the previous one at no cost whatever, so
    // signing the identical ceasefire eight times walked a pair from −50 to
    // +14: peace by redrafting the same document, at a price of nothing.
    const before = seed();
    let s = before;
    for (let i = 0; i < 6; i++) {
      s = applyOps(s, [pact(['drajk', 'ojjul'])], 'extraction', 'drajk', true).state;
    }
    expect(s.treaties.filter((t) => t.status === 'active')).toHaveLength(1);
    expect(view(s, 'drajk', 'ojjul')).toBe(view(before, 'drajk', 'ojjul') + TREATY_GOODWILL);
  });

  it('pays again for a genuinely different bond', () => {
    // A defence pact and a trade accord are two arrangements, not one redrafted
    // — which bounds what a pair can ever draw from this at one payment per
    // type, against a negotiation apiece to earn it.
    const before = seed();
    const first = applyOps(before, [pact(['drajk', 'ojjul'])], 'extraction', 'drajk', true).state;
    const second = applyOps(
      first,
      [{ ...(pact(['drajk', 'ojjul']) as Record<string, unknown>), treatyType: 'trade_accord' }] as OpInput[],
      'extraction',
      'drajk',
      true,
    ).state;
    expect(view(second, 'drajk', 'ojjul')).toBe(
      view(before, 'drajk', 'ojjul') + 2 * TREATY_GOODWILL,
    );
  });

  it('is not taken back when the treaty is broken, because breaking already costs', () => {
    // The asymmetry against `COMMITMENT_GOODWILL`, whose refund on dissolve
    // netted to zero. `break_treaty` costs 25 with the party and a permanent
    // reputation hit with every onlooker; taking the goodwill back on top would
    // charge twice for one decision.
    const before = seed();
    const signed = applyOps(before, [pact(['drajk', 'ojjul'])], 'extraction', 'drajk', true).state;
    const broken = applyOps(
      signed,
      [{ op: 'break_treaty', treatyId: signed.treaties[0]!.id, reason: 'no longer convenient' }],
      'model',
      'drajk',
    ).state;
    // The victim is worse off than before the treaty existed — the pact-breaking
    // charge outweighs the goodwill — and the goodwill itself was not reversed
    // on top of it.
    const net = view(broken, 'ojjul', 'drajk') - view(before, 'ojjul', 'drajk');
    expect(net).toBeLessThan(0);
    expect(net).toBe(TREATY_GOODWILL - 25);
  });
});

describe('walking away from a commitment costs more than it paid', () => {
  const swear = (s: WorldState, ids: string[]) =>
    applyOps(
      s,
      [
        {
          op: 'establish_commitment',
          kind: 'dynastic_marriage',
          factionIds: ids,
          text: 'A dynastic marriage.',
          exclusive: true,
        },
      ],
      'extraction',
      ids[0],
      true,
    );

  const view = (s: WorldState, who: string, of: string) =>
    s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;

  it('leaves the injured party worse off than if it had never been sworn', () => {
    // The live hole: `+COMMITMENT_GOODWILL` on establish and `-` on dissolve net
    // to ZERO, and disposition has no decay — so this was the only reversible
    // disposition movement in the game, and a power could swear a marriage and
    // repudiate it the next turn for nothing. Two parties is the commonest shape
    // a commitment has.
    const before = seed();
    const sworn = swear(before, ['drajk', 'ojjul']).state;
    const gone = applyOps(
      sworn,
      [{ op: 'dissolve_commitment', commitmentId: sworn.commitments[0]!.id, reason: 'repudiated' }],
      'model',
      'drajk',
    ).state;

    const net = view(gone, 'ojjul', 'drajk') - view(before, 'ojjul', 'drajk');
    expect(net).toBe(-COMMITMENT_BREAKING_COST);
    expect(net).toBeLessThan(0);
  });

  it('keeps onlookers out of a two-party understanding, and lets them in at three', () => {
    // The distinction that survives: a commitment is not public business, so a
    // private arrangement between two is nobody else's to have a view about —
    // but one sworn to four powers is, and three of them just watched it torn
    // up.
    const two = swear(seed(), ['drajk', 'ojjul']).state;
    const beforeTwo = view(two, 'vigil', 'drajk');
    const goneTwo = applyOps(
      two,
      [{ op: 'dissolve_commitment', commitmentId: two.commitments[0]!.id, reason: 'over' }],
      'model',
      'drajk',
    ).state;
    expect(view(goneTwo, 'vigil', 'drajk')).toBe(beforeTwo);

    const many = swear(seed(), ['drajk', 'ojjul', 'meridian', 'vigil']).state;
    const beforeMany = view(many, 'freeworlds', 'drajk');
    const goneMany = applyOps(
      many,
      [{ op: 'dissolve_commitment', commitmentId: many.commitments[0]!.id, reason: 'over' }],
      'model',
      'drajk',
    ).state;
    expect(view(goneMany, 'freeworlds', 'drajk')).toBeLessThan(beforeMany);
  });
});
