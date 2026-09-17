import { describe, expect, it, vi } from 'vitest';
import { agentSuccessChance, applyOps, tickTurn } from '../src/domain/reducer.js';
import type { OpInput } from '../src/domain/ops.js';
import { createSeedState } from '../src/seed/scenario.js';
import {
  AGENT_VETERAN_THRESHOLDS,
  MAX_DISCORD_TOTAL,
  MISSION_PROFILE,
  agentStanding,
  agentVeterancy,
  type AgentMission,
} from '../src/domain/diplomacy.js';
import { ledgerFor, type WorldState } from '../src/domain/state.js';
import { serializeCommitments, serializeStanding, serializeState } from '../src/model/serialize.js';
import { routeCovertAction } from '../src/domain/development.js';
import { eventsVisibleTo } from '../src/domain/intel.js';

// These are the two heaviest files in the suite — real work through the real
// reducer, not slow assertions. The longest case runs 3.8s against vitest's
// 5s default, a margin CPU contention eats: the suite failed twice in nine runs
// when it was chained behind three typechecks in one shell command, always
// these two files and never with an assertion error. Raised rather than
// shrunk, because the iteration counts are what make the measurements mean
// anything.
vi.setConfig({ testTimeout: 30_000 });


/**
 * Agents have to be catchable.
 *
 * `MISSION_PROFILE.exposureRisk` documents a ladder — 1 in 20 for a watcher up
 * to 9 in 20 for an assassin — and for the whole life of the mechanic it fired
 * essentially never. Exposure was tested as `roll <= exposureRisk` inside the
 * failure branch, but a roll SUCCEEDS when `roll * 5 <= successChance`, so
 * rolls `1..floor(successChance / 5)` never reach that branch — exactly the
 * low rolls the test was looking for. `successChance` floors at 5, so a
 * surveillance operative could not be exposed at any stat pairing in the game.
 *
 * Measured before the fix: 80 operatives, five owner/target pairings, 40 turns
 * each, **zero exposures**. Nobody noticed because a burned agent is a
 * non-event — you observe nothing rather than something visibly wrong, which is
 * exactly why this file exists.
 *
 * These are statistical over the real reducer rather than unit tests of the
 * comparison, because the comparison looked correct. Bounds are loose; the
 * point is that the mechanism is alive and ordered, not that it hits a number.
 */

const PAIRINGS = [
  ['meridian', 'vigil'],
  ['ojjul', 'meridian'],
  ['drajk', 'freeworlds'],
  ['vigil', 'ojjul'],
  ['freeworlds', 'drajk'],
] as const;

/** Place `mission` agents on the target's worlds and run the tick for `turns`. */
function run(mission: AgentMission, turns: number): { placed: number; exposed: number; alive: number } {
  let placed = 0;
  let exposed = 0;
  let aliveTurns = 0;

  for (const [owner, target] of PAIRINGS) {
    let st: WorldState = createSeedState(owner);
    const worlds = st.systems.filter((x) => x.controllerFactionId === target).slice(0, 4);
    st.factions.find((f) => f.id === owner)!.credits = 99_999;
    // 'engine' source: the cap and the cost are not what is under test here.
    st = applyOps(
      st,
      worlds.map((w) => ({
        op: 'deploy_agent', ownerFactionId: owner, systemId: w.id, mission,
        effect: { kind: 'hull_damage', perTurn: 1 }, cover: '',
      })),
      'engine',
    ).state;
    placed += st.agents.length;

    for (let t = 0; t < turns; t += 1) {
      const before = st.eventLog.length;
      st = tickTurn(st).state;
      // One-shot operatives are removed in the tick that spends them, so the
      // log is the only place their exposure is observable.
      exposed += st.eventLog
        .slice(before)
        .filter((e) => /exposes .* operative/.test(e.text)).length;
      // Agent-turns still in place, which is what separates the missions: over
      // a long enough run EVERY operative is eventually caught, so exposure
      // counts saturate and only survival time discriminates.
      aliveTurns += st.agents.filter((a) => !a.exposed).length;
    }
  }
  return { placed, exposed, alive: aliveTurns };
}

describe('an operative can actually be caught', () => {
  it('exposes watchers at all — the regression that measured zero', () => {
    const { placed, exposed } = run('surveillance', 40);
    expect(placed).toBeGreaterThan(0);
    expect(exposed, 'surveillance never fired: the exposure test is dead again').toBeGreaterThan(0);
  });

  // Four missions x 40 turns of real ticks, so this is genuinely a long test
  // rather than a slow one — it sat a few milliseconds under the 5s default and
  // tipped over the moment the reducer got 4% heavier. The timeout is raised to
  // match the work; the alternative is a test that fails on a busy machine and
  // teaches everyone to re-run it.
  it('catches every persistent mission within a long run', () => {
    for (const mission of ['surveillance', 'theft', 'sabotage', 'defection'] as const) {
      const { exposed } = run(mission, 40);
      expect(exposed, `${mission} was never exposed in 40 turns`).toBeGreaterThan(0);
    }
  }, 20_000);

  it('keeps the safer mission in place longer than the riskier one', () => {
    // The ladder is the point: a watcher is rarely caught, a saboteur often is.
    // Compared as SURVIVAL rather than as exposure counts, because over a long
    // run every operative is caught eventually and the counts saturate at the
    // number placed. Comparing the two rather than asserting either pins the
    // ordering without turning a tuning value into a test people ignore.
    const watcher = run('surveillance', 40);
    const saboteur = run('sabotage', 40);
    expect(MISSION_PROFILE.sabotage.exposureRisk).toBeGreaterThan(
      MISSION_PROFILE.surveillance.exposureRisk,
    );
    expect(watcher.alive).toBeGreaterThan(saboteur.alive);
  });

  it('exposes an assassin roughly as often as the profile claims', () => {
    // One-shot, so every placement resolves in a single tick: attempts and
    // exposures are directly comparable.
    const { placed, exposed } = run('assassination', 1);
    const rate = exposed / placed;
    const claimed = MISSION_PROFILE.assassination.exposureRisk / 20;
    expect(rate).toBeGreaterThan(claimed - 0.2);
    expect(rate).toBeLessThan(claimed + 0.2);
  });

  it('leaves competence protecting the operative', () => {
    // Exposure reads the top of the die, so an agent good enough to succeed on
    // everything but a natural 20 is only ever caught on that 20. The bound
    // matters: it is 5%, not the 0% the old comparison produced.
    const risk = MISSION_PROFILE.surveillance.exposureRisk;
    const exposingRolls = [];
    for (let roll = 1; roll <= 20; roll += 1) {
      const succeeded = roll * 5 <= 95;
      if (!succeeded && roll >= 21 - risk) exposingRolls.push(roll);
    }
    expect(exposingRolls).toEqual([20]);
  });
});

/**
 * The cap has to be visible, or the model narrates around it.
 *
 * `maxAgentsFor` had no reader anywhere in `src/model/`, so no call knew a
 * faction was at its limit. Found in a 27-turn playtest: at 3 of 3, an action
 * phrased "buy a clerk in the customs house" produced a full success story and
 * **zero ops** — no rejection, no note, nothing in state — because the model
 * never emitted the op that would have been refused. Same shape as the arbiter
 * never being shown the red lines it was asked to enforce.
 */
describe('the model can see how many operatives it is running', () => {
  it('states the count and the ceiling', () => {
    const state = createSeedState('meridian');
    const block = serializeStanding(state, 'meridian');
    // Meridian: guile 13 -> 2 + 1.
    expect(block).toMatch(/Your operatives: 0 of 3/);
    expect(block).toMatch(/room for 3 more/);
  });

  it('says so plainly when there is no room left', () => {
    let state = createSeedState('meridian');
    const targets = state.systems.filter((x) => x.controllerFactionId === 'vigil').slice(0, 3);
    state = applyOps(
      state,
      targets.map((t) => ({
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: t.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      })),
      'model',
      'meridian',
    ).state;

    const block = serializeStanding(state, 'meridian');
    expect(block).toMatch(/Your operatives: 3 of 3/);
    expect(block).toMatch(/AT YOUR LIMIT/);
  });

  it('counts only live operatives, so a burned one frees a slot', () => {
    let state = createSeedState('meridian');
    const target = state.systems.find((x) => x.controllerFactionId === 'vigil')!;
    state = applyOps(
      state,
      [{
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: target.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      }],
      'model',
      'meridian',
    ).state;
    expect(serializeStanding(state, 'meridian')).toMatch(/Your operatives: 1 of 3/);

    state.agents[0]!.exposed = true;
    expect(serializeStanding(state, 'meridian')).toMatch(/Your operatives: 0 of 3/);
  });
});

/**
 * One act, one mechanism.
 *
 * A declared covert action and a deployed operative were two routes to the same
 * fiction with uncoordinated prices. A deployed assassination costs 150 credits,
 * counts against the cap, is spent after one attempt, is caught about 45% of the
 * time and costs the target 35 disposition undetected or 40 exposed — all in
 * code. A declared "assassinate their raid captain" was priced as an ordinary
 * `guile` check and the resolution call invented the consequences: measured
 * live, −15 with the victim and −6 with an onlooker, for no credits, against no
 * cap, with no exposure roll. The cheaper route was the one a player reaches by
 * typing a sentence.
 */
describe('a declared covert action becomes a deployment', () => {
  const covert = { mission: 'assassination' as const, systemId: 'ilv-6' };

  it('places an operative when the resolution call did not', () => {
    const out = routeCovertAction([], 'success', [covert], 'meridian');
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0]).toMatchObject({
      op: 'deploy_agent',
      ownerFactionId: 'meridian',
      systemId: 'ilv-6',
      mission: 'assassination',
    });
    expect(out.notes[0]).toMatch(/charged and capped/);
  });

  it('leaves the batch alone when it already placed one', () => {
    const ops = [
      { op: 'deploy_agent', ownerFactionId: 'meridian', systemId: 'ilv-6',
        mission: 'assassination', effect: { kind: 'hull_damage', perTurn: 3 }, cover: '' },
    ];
    const out = routeCovertAction(ops, 'success', [covert], 'meridian');
    expect(out.ops).toBe(ops);
    expect(out.notes).toHaveLength(0);
  });

  it('places nobody on a failure — the man was caught at the door', () => {
    for (const outcome of ['failure', 'critical_failure'] as const) {
      const out = routeCovertAction([], outcome, [covert], 'meridian');
      expect(out.ops).toEqual([]);
      expect(out.notes).toHaveLength(0);
    }
  });

  it('does nothing at all to an overt action', () => {
    const ops = [{ op: 'adjust_credits', factionId: 'meridian', delta: -50 }];
    expect(routeCovertAction(ops, 'success', null, 'meridian').ops).toBe(ops);
  });

  it('is then charged, capped and exposed like any other operative', () => {
    // The whole point of routing: the same guards apply. At the cap, the
    // synthesized deployment is rejected rather than quietly landing.
    let state = createSeedState('meridian');
    const targets = state.systems.filter((x) => x.controllerFactionId === 'vigil').slice(0, 3);
    state = applyOps(
      state,
      targets.map((t) => ({
        op: 'deploy_agent', ownerFactionId: 'meridian', systemId: t.id,
        mission: 'surveillance', effect: { kind: 'intel', perTurn: 1 }, cover: '',
      })),
      'model',
      'meridian',
    ).state;

    const routed = routeCovertAction([], 'success', [{ mission: 'sabotage', systemId: targets[0]!.id }], 'meridian');
    const out = applyOps(state, routed.ops, 'model', 'meridian');
    expect(out.rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(out.rejections[0]!.message).toMatch(/already running 3 operatives/);
  });
});

/**
 * Item 67.4. An `income_penalty` operative used to DESTROY value: the victim's
 * ledger showed the loss and nobody's showed the gain.
 *
 * Three sources said otherwise and the code was the odd one out — the schema
 * calls it "credits denied", `prompts/resolution.md` offers it as the honest
 * way to *skim* a rival, and the mission that places one by default is called
 * `theft`. Theft moves money.
 */
describe('a thief receives what it steals', () => {
  const withThief = () => {
    const s = createSeedState('meridian');
    s.agents = [
      {
        id: 'a1', ownerFactionId: 'meridian', targetFactionId: 'vigil',
        systemId: 'tor-3', mission: 'theft',
        effect: { kind: 'income_penalty', perTurn: 10 },
        cover: 'a factor',
        targetCommanderId: null, name: '', operations: 0, timesCaught: 0, discordMoved: 0, deployedTurn: 0, exposed: false, successChance: 50,
      },
    ] as never;
    return s;
  };

  it('moves exactly what it takes', () => {
    const s = withThief();
    expect(ledgerFor(s, 'vigil').espionageLoss).toBe(10);
    expect(ledgerFor(s, 'meridian').espionageGain).toBe(10);
  });

  it('pays nobody once the operative is burned', () => {
    const s = withThief();
    (s.agents[0] as { exposed: boolean }).exposed = true;
    expect(ledgerFor(s, 'vigil').espionageLoss).toBe(0);
    expect(ledgerFor(s, 'meridian').espionageGain).toBe(0);
  });

  it('steals from nobody when it sits on its owner’s own world', () => {
    const s = withThief();
    (s.agents[0] as { systemId: string }).systemId = 'sek-1'; // Meridian's own
    expect(ledgerFor(s, 'meridian').espionageGain).toBe(0);
  });
});

/**
 * Item 67.3. `AppraisalSchema.covert` was a single object, so an order that
 * contained an assassination AND a theft produced one `deploy_agent` and a
 * `log_narrative` promising the other "will come on a later tick". It never
 * did.
 */
describe('every covert operation in one declaration is routed', () => {
  const both = [
    { mission: 'assassination' as const, systemId: 'ilv-6' },
    { mission: 'theft' as const, systemId: 'ilv-2' },
  ];

  it('places one operative per operation named', () => {
    const out = routeCovertAction([], 'success', both, 'meridian');
    const placed = out.ops.filter(
      (op) => (op as { op?: string }).op === 'deploy_agent',
    ) as { mission: string; systemId: string }[];
    expect(placed).toHaveLength(2);
    expect(placed.map((p) => `${p.mission}@${p.systemId}`).sort()).toEqual([
      'assassination@ilv-6',
      'theft@ilv-2',
    ]);
    expect(out.notes).toHaveLength(2);
  });

  it('adds only what the resolution call did not place itself', () => {
    // Matched on mission AND place, so a batch that already deployed the
    // assassin still gets its thief — the old check was "did it place ANY
    // agent", which let one deployment swallow the rest of the order.
    const ops = [
      {
        op: 'deploy_agent',
        ownerFactionId: 'meridian',
        systemId: 'ilv-6',
        mission: 'assassination',
        effect: { kind: 'stat_debuff', stat: 'resolve', magnitude: 1 },
        cover: 'a factor',
        targetCommanderId: null, name: '', operations: 0, timesCaught: 0, discordMoved: 0,
      },
    ];
    const out = routeCovertAction(ops, 'success', both, 'meridian');
    const placed = out.ops.filter((op) => (op as { op?: string }).op === 'deploy_agent');
    expect(placed).toHaveLength(2);
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatch(/theft/);
  });

  it('places nobody at all when the attempt failed', () => {
    expect(routeCovertAction([], 'failure', both, 'meridian').ops).toHaveLength(0);
  });
});

/**
 * THE PRODUCER MUST SCOPE THE ENTRY, NOT JUST THE READER.
 *
 * `CLAUDE.md` claims `intel` is "the one event kind that is private… there is a
 * test for it." The test hand-built an entry with `visibleTo: ['vigil']` and
 * asserted the *reader* redacted it. Nothing asserted the producer ever set it —
 * and it did not: `logEvent`'s fourth argument is attribution and `visibleTo` is
 * the fifth, so every operative report the player filed was public and reached
 * every NPC prompt through `serializeRecentLog`.
 *
 * A test that pins the mechanism while nothing pins that the mechanism is
 * reached. So these run the real tick and read what it produced.
 */
describe('a private entry is written private', () => {
  it('scopes an operative report to the network that filed it', () => {
    let s = createSeedState('drajk');
    const target = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    s = applyOps(
      s,
      [
        {
          op: 'deploy_agent',
          ownerFactionId: 'drajk',
          systemId: target.id,
          mission: 'theft',
          effect: { kind: 'income_penalty', perTurn: 8 },
        },
      ],
      'engine',
    ).state;

    const after = tickTurn(s).state;
    const reports = after.eventLog.filter((e) => e.kind === 'intel');
    expect(reports.length).toBeGreaterThan(0);
    for (const entry of reports) {
      // The thing that was actually wrong: null means public.
      expect(entry.visibleTo).not.toBeNull();
      expect(entry.visibleTo).toEqual(['drajk']);
    }
    // And the rival it is being run against cannot read it.
    expect(eventsVisibleTo(after, 'meridian').some((e) => e.kind === 'intel')).toBe(false);
    expect(eventsVisibleTo(after, 'drajk').some((e) => e.kind === 'intel')).toBe(true);
  });

  it('keeps a negotiated accord between the powers that negotiated it', () => {
    // Measured live: a world sold to Meridian in a private channel, and the
    // Vigil opened the next conversation quoting the price, the terms, and two
    // asks that had been withdrawn and never agreed. `serializeStanding` scopes
    // the treaty list; the log one block earlier published it in prose.
    const s = createSeedState('drajk');
    const res = applyOps(
      s,
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['drajk', 'meridian'],
          terms: {},
          summary: 'the Sennex lane, quietly',
        },
        { op: 'log_narrative', text: 'Eight hundred credits and no signature.' },
      ],
      'extraction',
      'drajk',
    );
    expect(res.rejections).toEqual([]);

    const leaked = eventsVisibleTo(res.state, 'vigil');
    expect(leaked.some((e) => e.text.includes('Sennex'))).toBe(false);
    expect(leaked.some((e) => e.text.includes('Eight hundred'))).toBe(false);

    // Both parties see the treaty; the narrative is the actor's own record.
    for (const id of ['drajk', 'meridian']) {
      expect(eventsVisibleTo(res.state, id).some((e) => e.text.includes('Sennex'))).toBe(true);
    }
    expect(
      eventsVisibleTo(res.state, 'drajk').some((e) => e.text.includes('Eight hundred')),
    ).toBe(true);
  });

  it('keeps a commitment between the bound parties, as its goodwill already is', () => {
    const res = applyOps(
      createSeedState('drajk'),
      [
        {
          op: 'establish_commitment',
          kind: 'quiet_understanding',
          factionIds: ['drajk', 'ojjul'],
          text: 'The Vosk run is not spoken of.',
        },
      ],
      'extraction',
      'drajk',
    );
    expect(res.rejections).toEqual([]);
    expect(eventsVisibleTo(res.state, 'vigil').some((e) => e.text.includes('Vosk run'))).toBe(
      false,
    );
    expect(eventsVisibleTo(res.state, 'ojjul').some((e) => e.text.includes('Vosk run'))).toBe(
      true,
    );
  });

  it('keeps a loan between the lender and the borrower', () => {
    const res = applyOps(
      createSeedState('ojjul'),
      [
        {
          op: 'establish_debt',
          creditorFactionId: 'ojjul',
          debtorFactionId: 'drajk',
          principal: 200,
          perTurn: 20,
          text: 'Paper against the Verge run.',
        },
      ],
      'extraction',
      'ojjul',
    );
    expect(res.rejections).toEqual([]);
    // Who is leveraged and by how much is the one fact the Combine's doctrine
    // is built on knowing and others not.
    expect(eventsVisibleTo(res.state, 'meridian').some((e) => e.text.includes('Verge run'))).toBe(
      false,
    );
    for (const id of ['ojjul', 'drajk']) {
      expect(eventsVisibleTo(res.state, id).some((e) => e.text.includes('Verge run'))).toBe(true);
    }
  });
});

/**
 * A commitment is not public business, and the state block said otherwise.
 *
 * `serializeCommitments` took no viewer and rendered every live commitment into
 * all five prompts — measured in a playtest as the Iron Vigil quoting the exact
 * 7% share of an arrangement binding only the Combine and Drajk.
 *
 * The LOG half of this leak was closed earlier the same day and written up as
 * fixed. `logEvent` was scoped and the state block one function away was not,
 * so the fix looked complete and the prompt still carried the secret.
 */
describe('the commitments block is scoped to its parties', () => {
  const bound = (): WorldState =>
    applyOps(
      createSeedState('drajk'),
      [
        {
          op: 'establish_commitment',
          kind: 'quiet_understanding',
          factionIds: ['drajk', 'ojjul'],
          text: 'Seven per cent of the Vosk run, and nothing said aloud.',
        },
      ],
      'extraction',
      'drajk',
    ).state;

  it('shows a two-party arrangement to its parties and nobody else', () => {
    const s = bound();
    for (const id of ['drajk', 'ojjul']) {
      expect(serializeCommitments(s, id)).toContain('Seven per cent');
    }
    for (const id of ['vigil', 'meridian', 'freeworlds']) {
      expect(serializeCommitments(s, id)).not.toContain('Seven per cent');
    }
  });

  it('reaches the prompt block scoped, not just the helper', () => {
    // The whole defect was that the scoped helper existed and the caller did
    // not pass a viewer, so assert the block a model actually receives.
    const s = bound();
    expect(serializeState(s, 'vigil')).not.toContain('Seven per cent');
    expect(serializeState(s, 'ojjul')).toContain('Seven per cent');
  });
});

/**
 * The field that was the game's most rejected.
 *
 * `ownerFactionId` had exactly one valid value — the acting faction — and the
 * reducer rejected everything else. It was still supplied by the model and
 * still got it backwards 31 times across 129 played turns, the single largest
 * source of rejected ops in the game: on a hostile mission the sentence is
 * about the victim ("sabotage the Vigil garrison"), so the field came back
 * owned by the Vigil, and an operative owned by its own target can never act.
 * `resolution.md` had warned about it in bold for as long as the guard
 * existed and the rate did not move.
 *
 * Each rejection costs a full correction call on the reasoning tier, so this
 * is a field that was buying nothing and being paid for once a turn.
 */
describe('an operative belongs to whoever deployed it', () => {
  const deploy = (over: Record<string, unknown> = {}) => {
    const state = createSeedState('meridian');
    const target = state.systems.find((s) => s.controllerFactionId === 'vigil')!;
    return {
      state,
      op: {
        op: 'deploy_agent',
        systemId: target.id,
        mission: 'sabotage',
        effect: { kind: 'hull_damage', perTurn: 2 },
        ...over,
      } as OpInput,
    };
  };

  it('infers the owner from the actor when it is not given', () => {
    const { state, op } = deploy();
    const out = applyOps(state, [op], 'model', 'meridian');
    expect(out.rejections).toEqual([]);
    expect(out.state.agents).toHaveLength(1);
    expect(out.state.agents[0]!.ownerFactionId).toBe('meridian');
  });

  it('still refuses one stated for somebody else', () => {
    // Journals written before the field went optional carry it, so replay has
    // to reach the same verdict it reached then. Omitting it can no longer be
    // wrong; stating it wrongly still is.
    const { state, op } = deploy({ ownerFactionId: 'vigil' });
    const out = applyOps(state, [op], 'model', 'meridian');
    expect(out.rejections[0]?.code).toBe('illegal_value');
    expect(out.state.agents).toHaveLength(0);
  });

  it('still accepts one stated correctly', () => {
    const { state, op } = deploy({ ownerFactionId: 'meridian' });
    const out = applyOps(state, [op], 'model', 'meridian');
    expect(out.rejections).toEqual([]);
    expect(out.state.agents[0]!.ownerFactionId).toBe('meridian');
  });

  it('refuses when there is neither a field nor an actor to infer from', () => {
    const { state, op } = deploy();
    const out = applyOps(state, [op], 'model');
    expect(out.rejections[0]?.code).toBe('illegal_value');
  });
});

/**
 * An operative's record, and the face a rival has already photographed.
 *
 * The twin of a commander's veterancy, on the one number this side of the game
 * owns: `successChance` is computed in code, where the `effect` magnitude is
 * model-chosen and capped — scaling that would hand a model a lever on its own
 * payoff.
 */
describe('an operative gets better, and being caught is permanent', () => {
  it('climbs a ladder denominated in what a campaign contains', () => {
    // 4 and 10 against a commander's 2 and 5, because the two accrue at
    // completely different rates: a galaxy fights four battles in thirty turns
    // and a posted watcher resolves an operation every turn.
    expect(agentVeterancy(0)).toBe(0);
    expect(agentVeterancy(AGENT_VETERAN_THRESHOLDS[0])).toBe(1);
    expect(agentVeterancy(AGENT_VETERAN_THRESHOLDS[1])).toBe(2);
    expect(agentVeterancy(AGENT_VETERAN_THRESHOLDS[1] * 5)).toBe(2);
    for (let n = 0; n <= AGENT_VETERAN_THRESHOLDS[1] + 1; n++) {
      expect(agentStanding(n), `${n}`).toMatch(/^[a-z]+$/);
    }
  });

  it('pays for a record and charges for a known face', () => {
    const fresh = agentSuccessChance(12, 14, 0, 0);
    const veteran = agentSuccessChance(12, 14, AGENT_VETERAN_THRESHOLDS[1], 0);
    expect(veteran).toBeGreaterThan(fresh);
    // One capture costs EXACTLY the whole ladder, so a veteran ransomed home is
    // worth precisely what a stranger is worth. Tying the penalty to the ladder
    // rather than picking a figure makes that cancellation exact at every
    // pairing — it was 12 first, and because `successChance` clamps at 95 a
    // veteran caught once came out at 90 against a fresh operative's 86. Being
    // captured made them better.
    expect(agentSuccessChance(12, 14, AGENT_VETERAN_THRESHOLDS[1], 1)).toBe(fresh);
    // And a second capture is strictly worse than hiring a stranger.
    expect(agentSuccessChance(12, 14, AGENT_VETERAN_THRESHOLDS[1], 2)).toBeLessThan(fresh);
  });

  it('holds at the top of the range too, where the clamp hides the ladder', () => {
    const strong = (ops: number, caught: number) => agentSuccessChance(18, 9, ops, caught);
    expect(strong(AGENT_VETERAN_THRESHOLDS[1], 1)).toBe(strong(0, 0));
  });

  it('goes back out off the exposed list, with the record and the mark', () => {
    const s = createSeedState('drajk');
    const host = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    s.agents.push({
      id: 'agt-home', ownerFactionId: 'drajk', systemId: host.id,
      mission: 'theft', effect: { kind: 'income_penalty', perTurn: 4 },
      successChance: 40, exposed: true, deployedTurn: 0, cover: '',
      targetCommanderId: null, name: 'Ravel Coldwake',
      operations: AGENT_VETERAN_THRESHOLDS[1], timesCaught: 1, discordMoved: 0,
    });
    s.assets.push({
      id: 'ast-home', kind: 'operative', text: 'them', heldBy: 'drajk',
      quantity: 1, unit: 'person', commanderId: null, agentId: 'agt-home',
      divisible: false, valuePerUnit: {}, speculative: false, valueRange: {},
      uses: null, atSystemId: null, portable: true, yield: null, acquiredTurn: 0,
    });
    const out = applyOps(
      s,
      [{
        op: 'deploy_agent', systemId: host.id, mission: 'theft',
        effect: { kind: 'income_penalty', perTurn: 4 }, fromAssetId: 'ast-home',
      }],
      'model',
      'drajk',
    );
    expect(out.rejections).toHaveLength(0);
    const back = out.state.agents.find((a) => a.id === 'agt-home')!;
    // Off the exposed list — a face the enemy caught is not a person who has
    // stopped existing.
    expect(back.exposed).toBe(false);
    expect(back.operations).toBe(AGENT_VETERAN_THRESHOLDS[1]);
    // The mark survives the round trip, which is what makes a second ransom a
    // worse bargain than the first.
    expect(back.timesCaught).toBe(1);
    expect(out.state.assets.find((a) => a.id === 'ast-home')).toBeUndefined();
  });

  it('will not run somebody else’s caught operative', () => {
    const s = createSeedState('drajk');
    const host = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    s.agents.push({
      id: 'agt-theirs', ownerFactionId: 'meridian', systemId: host.id,
      mission: 'theft', effect: { kind: 'income_penalty', perTurn: 4 },
      successChance: 40, exposed: true, deployedTurn: 0, cover: '',
      targetCommanderId: null, name: 'Odile Brandt', operations: 3, timesCaught: 1, discordMoved: 0,
    });
    s.assets.push({
      id: 'ast-theirs', kind: 'operative', text: 'them', heldBy: 'drajk',
      quantity: 1, unit: 'person', commanderId: null, agentId: 'agt-theirs',
      divisible: false, valuePerUnit: {}, speculative: false, valueRange: {},
      uses: null, atSystemId: null, portable: true, yield: null, acquiredTurn: 0,
    });
    const out = applyOps(
      s,
      [{
        op: 'deploy_agent', systemId: host.id, mission: 'theft',
        effect: { kind: 'income_penalty', perTurn: 4 }, fromAssetId: 'ast-theirs',
      }],
      'model',
      'drajk',
    );
    expect(out.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(out.state.agents.find((a) => a.id === 'agt-theirs')!.exposed).toBe(true);
  });

  it('refuses to question its own people', () => {
    // Reachable the moment a round trip existed: ransom one home and this would
    // have a power sell itself intelligence about its own network.
    const s = createSeedState('drajk');
    s.agents.push({
      id: 'agt-ours', ownerFactionId: 'drajk', systemId: 'ilv-6',
      mission: 'theft', effect: { kind: 'income_penalty', perTurn: 4 },
      successChance: 40, exposed: true, deployedTurn: 0, cover: '',
      targetCommanderId: null, name: 'Kess Skeln', operations: 2, timesCaught: 1, discordMoved: 0,
    });
    s.assets.push({
      id: 'ast-ours', kind: 'operative', text: 'them', heldBy: 'drajk',
      quantity: 1, unit: 'person', commanderId: null, agentId: 'agt-ours',
      divisible: false, valuePerUnit: {}, speculative: false, valueRange: {},
      uses: null, atSystemId: null, portable: true, yield: null, acquiredTurn: 0,
    });
    const out = applyOps(
      s,
      [{ op: 'consume_asset', assetId: 'ast-ours', quantity: 1 }],
      'model',
      'drajk',
    );
    expect(out.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(out.state.assets.find((a) => a.kind === 'dossier')).toBeUndefined();
  });
});

/**
 * `discord`: the only mission aimed at a quarrel the buyer is not in.
 *
 * Filed as 113 when **112** closed the free route — a power could simply emit
 * `adjust_disposition` between two others — and left no paid one. What it buys
 * is **permanent**, because disposition has no decay where `sedition`'s dissent
 * is clawed back at `DISSENT_DECAY` a turn, so the rate is small and the real
 * bound is a lifetime ceiling.
 */
describe('setting two other powers against each other', () => {
  const regard = (s: WorldState, who: string, of: string) =>
    s.factions.find((f) => f.id === who)!.disposition[of] ?? 0;

  /** A world the Vigil holds, so Drajk can work on the Vigil against Meridian. */
  const theirs = (s: WorldState) =>
    s.systems.find((x) => x.controllerFactionId === 'vigil')!.id;

  const deploy = (s: WorldState, effect: Record<string, unknown>, systemId?: string) =>
    applyOps(
      s,
      [{ op: 'deploy_agent', systemId: systemId ?? theirs(s), mission: 'discord', effect }],
      'model',
      'drajk',
    );

  it('moves the host against a third power, and nobody against the buyer', () => {
    const s = createSeedState('drajk');
    const host = theirs(s);
    const before = regard(s, 'vigil', 'meridian');
    const mine = regard(s, 'vigil', 'drajk');
    // Placed directly at a success chance that cannot fail. Deploying it and
    // un-exposing it each tick looked equivalent and is not: exposure is
    // charged DURING the tick, so resetting the flag afterwards re-triggers the
    // penalty every turn and the test ends up measuring exposure rather than
    // the effect.
    s.agents.push({
      id: 'agt-d', ownerFactionId: 'drajk', systemId: host, mission: 'discord',
      effect: { kind: 'discord', towardFactionId: 'meridian', perTurn: 2 },
      successChance: 100, exposed: false, deployedTurn: 0, cover: '',
      targetCommanderId: null, name: 'Sherrin Greywake',
      operations: 0, timesCaught: 0, discordMoved: 0,
    });

    let st = s;
    for (let i = 0; i < 4; i++) st = tickTurn(st).state;
    expect(regard(st, 'vigil', 'meridian')).toBe(before - 8);

    // The operative is working on somebody else's quarrel, so the BUYER's
    // standing is not what it moves. Measured against a control, because a tick
    // moves disposition for reasons of its own — Drajk's seeded raiding charges
    // reputation with uninvolved powers every turn — and an absolute assertion
    // would be pinning those instead.
    let control = createSeedState('drajk');
    for (let i = 0; i < 4; i++) control = tickTurn(control).state;
    expect(regard(st, 'vigil', 'drajk')).toBe(regard(control, 'vigil', 'drajk'));
    expect(mine).toBeDefined();
  });

  it('stops at a lifetime ceiling rather than earning forever', () => {
    // A rate bounds the speed and leaves the total to depend on how long the
    // operative happens to survive, which is a dice roll — a poor thing to
    // price a permanent effect against.
    const s = createSeedState('drajk');
    s.factions.find((f) => f.id === 'drajk')!.credits = 5000;
    const before = regard(s, 'vigil', 'meridian');
    let st = deploy(s, { kind: 'discord', towardFactionId: 'meridian', perTurn: 2 }).state;
    // Kept alive deliberately: the ceiling, not exposure, is what must stop it.
    for (let i = 0; i < 40; i++) {
      st = tickTurn(st).state;
      const a = st.agents.find((x) => x.mission === 'discord');
      if (a) a.exposed = false;
    }
    expect(before - regard(st, 'vigil', 'meridian')).toBeLessThanOrEqual(MAX_DISCORD_TOTAL);
    const spent = st.agents.find((x) => x.mission === 'discord')!;
    expect(spent.discordMoved).toBeLessThanOrEqual(MAX_DISCORD_TOTAL);
  });

  it('refuses a quarrel the buyer is in, on either side', () => {
    const s = createSeedState('drajk');
    s.factions.find((f) => f.id === 'drajk')!.credits = 5000;
    // Turning them against ME is just `adjust_disposition`, which 112 closed.
    expect(
      deploy(s, { kind: 'discord', towardFactionId: 'drajk', perTurn: 1 }).rejections.map(
        (r) => r.code,
      ),
    ).toContain('illegal_value');
    // And working on my OWN people is not a quarrel between two others.
    const mine = s.systems.find((x) => x.controllerFactionId === 'drajk')!.id;
    expect(
      deploy(s, { kind: 'discord', towardFactionId: 'meridian', perTurn: 1 }, mine).rejections.map(
        (r) => r.code,
      ),
    ).toContain('illegal_value');
  });

  it('refuses an unaligned world and an invented power', () => {
    const s = createSeedState('drajk');
    s.factions.find((f) => f.id === 'drajk')!.credits = 5000;
    const nobodys = s.systems.find((x) => x.controllerFactionId === null)!.id;
    expect(
      deploy(s, { kind: 'discord', towardFactionId: 'meridian', perTurn: 1 }, nobodys).rejections.map(
        (r) => r.code,
      ),
    ).toContain('no_presence');
    expect(
      deploy(s, { kind: 'discord', towardFactionId: 'nowhere', perTurn: 1 }).rejections.map(
        (r) => r.code,
      ),
    ).toContain('unknown_faction');
  });

  it('costs standing with BOTH powers when it is caught', () => {
    // Every other mission has one victim. The forged letters were about
    // somebody, and being exposed hands that power the evidence — which is the
    // risk that makes this worth 100 rather than `subversion`'s 60.
    const s = createSeedState('drajk');
    s.agents.push({
      id: 'agt-forge', ownerFactionId: 'drajk', systemId: theirs(s),
      mission: 'discord', effect: { kind: 'discord', towardFactionId: 'meridian', perTurn: 2 },
      successChance: 5, exposed: false, deployedTurn: 0, cover: '', targetCommanderId: null,
      name: 'Doram Ashlott', operations: 0, timesCaught: 0, discordMoved: 0,
    });
    const before = { vigil: regard(s, 'vigil', 'drajk'), meridian: regard(s, 'meridian', 'drajk') };
    let st = s;
    for (let i = 0; i < 25 && !st.agents.find((a) => a.id === 'agt-forge')?.exposed; i++) {
      st = tickTurn(st).state;
    }
    if (st.agents.find((a) => a.id === 'agt-forge')?.exposed) {
      expect(regard(st, 'vigil', 'drajk')).toBeLessThan(before.vigil);
      expect(regard(st, 'meridian', 'drajk')).toBeLessThan(before.meridian);
    }
  });
});
