import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who rules on a faction's own principles.
 *
 * For its whole existence the answer was "the resolution call", and a playtest
 * as the Arkanis Free Worlds — a power defined almost entirely by refusal —
 * showed what that was worth: three unambiguous compulsion breaches (paying
 * one-off tribute, submitting to ongoing tribute, raiding another power's
 * shipping) all resolved as ordinary skill checks costing nothing at all, and a
 * red line was never once returned as a `refusal`. The verbatim scenario of
 * Arkanis's first red line — "open the gates, invite the Vigil in" — was priced
 * as a `resolve` check at DC 19 and would have SUCCEEDED on a 20.
 *
 * The reason is structural rather than a matter of prompt wording: resolution
 * is handed a settled outcome and asked to make it real, so it is the pass with
 * the least incentive to say the order should never have been carried out, and
 * nothing checked it. The ruling now belongs to the arbiter, which is a
 * separate call, is not shown the roll, and already rules on `establishes`.
 *
 * These tests pin the two halves of that: a red line stops the action BEFORE
 * the roll (so there is no resolution call left to argue it back into
 * existence), and a compulsion is charged whatever resolution says about it.
 */

const calls: { kind: string; system: string; user: string }[] = [];
let scripted: Record<string, unknown> = {};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; system: string; user: string }) => {
    calls.push({ kind: call.kind, system: call.system, user: call.user });
    const value = scripted[call.kind];
    if (value === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { resolveAction } = await import('../src/model/calls.js');
const { submitAction } = await import('../src/engine/turn.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { createSeedState } = await import('../src/seed/scenario.js');
const { COMPULSION_BREACH_DISSENT, REFUSAL_DISSENT } = await import('../src/domain/state.js');
const { classifyPrinciple } = await import('../src/domain/compulsions.js');

/** Arkanis's first red line, quoted exactly as the faction sheet carries it. */
const NO_OCCUPATION =
  'will never accept occupation or a protectorate, on any terms, however generous';

const appraisal = (extra: Record<string, unknown> = {}) => ({
  admissible: true,
  reason: '',
  stat: 'influence',
  difficulty: 13,
  rationale: 'the Vigil would come gladly',
  ...extra,
});

const redLineBreach = {
  kind: 'red_line',
  principle: NO_OCCUPATION,
  by: 'the assembly of the Drift',
  reason: 'The Drift was founded to take no master. The gates stay shut.',
};

const compulsionBreach = {
  kind: 'compulsion',
  principle:
    'tribute is refused. The Drift does not pay to be left alone, whatever the arithmetic says',
  by: 'the assembly of the Drift',
  reason: 'You are buying peace with the one coin we swore never to spend.',
};

const OPEN_THE_GATES = 'Open the gates and invite the Vigil in to garrison Arkanis Prime.';

beforeEach(() => {
  calls.length = 0;
  scripted = {};
});

describe('a red line is ruled on before the dice', () => {
  it('ends the action without a resolution call at all', async () => {
    scripted = { appraisal: appraisal({ breach: redLineBreach }) };

    const out = await resolveAction(createSeedState('freeworlds'), OPEN_THE_GATES);

    // The whole point. There is no second call, so there is nothing left that
    // could narrate the gates opening anyway.
    expect(calls.map((c) => c.kind)).toEqual(['appraisal']);
    expect(out.output.refusal).toEqual({
      by: redLineBreach.by,
      reason: redLineBreach.reason,
      violated: NO_OCCUPATION,
    });
    expect(out.output.ops).toEqual([]);
    // No roll was taken: a red line is not a difficult action, it is not an
    // action at all.
    expect(out.check).toBeNull();
    expect(out.roll).toBe(0);
  });

  it('costs the faction REFUSAL_DISSENT and stages nothing else', async () => {
    scripted = { appraisal: appraisal({ breach: redLineBreach }) };
    const campaign = Campaign.start('freeworlds', 'test-red-line');

    const outcome = await submitAction(campaign, OPEN_THE_GATES);

    expect(outcome.refusal?.violated).toBe(NO_OCCUPATION);
    const arkanis = campaign.state.factions.find((f) => f.id === 'freeworlds')!;
    expect(arkanis.dissent).toBe(REFUSAL_DISSENT);
    // A refusal stages the record of the refusal and the dissent it cost, and
    // nothing that would move the world the way the order asked.
    const ops = outcome.ops as { op: string }[];
    expect(ops.map((o) => o.op).sort()).toEqual(['adjust_dissent', 'log_narrative']);
  });

  it('is not reachable by rephrasing, because the ruling is on the appraisal', async () => {
    scripted = { appraisal: appraisal({ breach: redLineBreach }) };
    const worded = 'Withdraw our defences from the capital as a gesture of good faith.';

    const out = await resolveAction(createSeedState('freeworlds'), worded);

    expect(calls).toHaveLength(1);
    expect(out.output.refusal?.violated).toBe(NO_OCCUPATION);
  });
});

describe('a compulsion is a price, and the price is charged', () => {
  it('resolves normally and defies even when resolution says nothing about it', async () => {
    scripted = {
      appraisal: appraisal({ breach: compulsionBreach }),
      resolution: {
        narrative: 'The tribute is agreed and the raids stop.',
        ops: [],
      },
    };

    const out = await resolveAction(createSeedState('freeworlds'), 'Agree to pay the Combine 30 a turn.');

    expect(calls.map((c) => c.kind)).toEqual(['appraisal', 'resolution']);
    // Rolled and resolved: unlike a red line, the order goes through.
    expect(out.check).not.toBeNull();
    expect(out.output.defiance).toEqual({
      by: compulsionBreach.by,
      reason: compulsionBreach.reason,
      violated: compulsionBreach.principle,
    });
  });

  it('keeps resolution’s wording but the arbiter’s line', async () => {
    scripted = {
      appraisal: appraisal({ breach: compulsionBreach }),
      resolution: {
        narrative: 'It is agreed, and the hall empties in silence.',
        ops: [],
        defiance: {
          by: 'the shipwrights',
          reason: 'They put down their tools when the terms were read out.',
          violated: 'something else entirely',
        },
      },
    };

    const out = await resolveAction(createSeedState('freeworlds'), 'Agree to pay tribute.');

    expect(out.output.defiance?.by).toBe('the shipwrights');
    expect(out.output.defiance?.violated).toBe(compulsionBreach.principle);
  });

  it('falls back to the arbiter when resolution names the faction, not a body', async () => {
    // Seen live: resolution filled `by` with "vigil", which the browser then
    // rendered as "vigil object, and the order goes out anyway".
    scripted = {
      appraisal: appraisal({ breach: compulsionBreach }),
      resolution: {
        narrative: 'It is agreed.',
        ops: [],
        defiance: { by: 'freeworlds', reason: 'Carried out under protest.', violated: '' },
      },
    };

    const out = await resolveAction(createSeedState('freeworlds'), 'Agree to pay tribute.');

    expect(out.output.defiance?.by).toBe(compulsionBreach.by);
  });

  it('is not upgraded into a refusal by the resolution call', async () => {
    // A price and a block are different things, and only the arbiter decides
    // which one applies. Resolution volunteering a refusal on top of a
    // compulsion ruling would quietly make every compulsion absolute.
    scripted = {
      appraisal: appraisal({ breach: compulsionBreach }),
      resolution: {
        narrative: 'The assembly will not hear of it.',
        ops: [{ op: 'log_narrative', text: 'the terms are read out' }],
        refusal: { by: 'the assembly', reason: 'No.', violated: 'tribute is refused' },
      },
    };

    const out = await resolveAction(createSeedState('freeworlds'), 'Agree to pay tribute.');

    expect(out.output.refusal).toBeUndefined();
    expect(out.output.defiance).toBeTruthy();
    expect(out.output.ops).toHaveLength(1);
  });

  it('charges COMPULSION_BREACH_DISSENT through the engine, and the ops still land', async () => {
    scripted = {
      appraisal: appraisal({ breach: compulsionBreach }),
      resolution: {
        narrative: 'The tribute is agreed.',
        ops: [{ op: 'adjust_disposition', factionId: 'freeworlds', towardFactionId: 'hutt', delta: 5 }],
      },
    };
    const campaign = Campaign.start('freeworlds', 'test-compulsion');

    const outcome = await submitAction(campaign, 'Agree to pay the Combine 30 a turn.');

    expect(outcome.defiance?.violated).toBe(compulsionBreach.principle);
    const arkanis = campaign.state.factions.find((f) => f.id === 'freeworlds')!;
    expect(arkanis.dissent).toBe(COMPULSION_BREACH_DISSENT);
    // The order was carried out. That is the whole difference from a red line.
    const ops = outcome.ops as { op: string }[];
    expect(ops.some((o) => o.op === 'adjust_disposition')).toBe(true);
  });
});

describe('the ordinary case is untouched', () => {
  it('rules no breach, and nothing is charged', async () => {
    scripted = {
      appraisal: appraisal(),
      resolution: { narrative: 'The courier goes out.', ops: [] },
    };
    const campaign = Campaign.start('freeworlds', 'test-clean');

    const outcome = await submitAction(campaign, 'Send a courier to Sennex.');

    expect(outcome.refusal).toBeNull();
    expect(outcome.defiance).toBeNull();
    expect(campaign.state.factions.find((f) => f.id === 'freeworlds')!.dissent).toBe(0);
  });

  it('still lets resolution refuse as a backstop when the arbiter saw nothing', async () => {
    scripted = {
      appraisal: appraisal(),
      resolution: {
        narrative: 'The fleet commanders will not do it.',
        ops: [],
        refusal: { by: 'the fleet commanders', reason: 'No.', violated: NO_OCCUPATION },
      },
    };

    const out = await resolveAction(createSeedState('freeworlds'), OPEN_THE_GATES);

    expect(out.output.refusal?.by).toBe('the fleet commanders');
  });
});

describe('the sheet decides which kind a line is, not the arbiter’s label', () => {
  // Found live, as the Iron Vigil. Asked to retain Nar smuggler captains as
  // informants, the arbiter quoted the right line, called it "a red line, not a
  // compulsion" when the seed carries it in `compulsions`, and returned the
  // whole thing as `admissible: false` — the one exit that charges nothing at
  // all. A 25-dissent compulsion became a free no-op.
  const NO_NARS =
    'no accommodation with pirates, smugglers or the Nars may be entertained, however useful';
  const HIRE_THE_NARS = 'Quietly retain the Combine’s smuggler captains as our eyes on the spine.';

  it('demotes a mislabelled red line to the compulsion it actually is', async () => {
    scripted = {
      appraisal: appraisal({
        breach: {
          kind: 'red_line',
          principle: NO_NARS,
          by: 'the officer corps',
          reason: 'This is a red line, not a compulsion.',
        },
      }),
      resolution: { narrative: 'The captains are retained.', ops: [] },
    };
    const campaign = Campaign.start('vigil', 'test-mislabelled');

    const outcome = await submitAction(campaign, HIRE_THE_NARS);

    // The order stands and is charged, rather than being blocked outright.
    expect(outcome.refusal).toBeNull();
    expect(outcome.defiance?.violated).toBe(NO_NARS);
    expect(campaign.state.factions.find((f) => f.id === 'vigil')!.dissent).toBe(
      COMPULSION_BREACH_DISSENT,
    );
  });

  it('promotes a mislabelled compulsion to the red line it actually is', async () => {
    // The same guard in the direction that matters more: under-charging a red
    // line lets an absolute act through for 25.
    scripted = {
      appraisal: appraisal({
        breach: {
          kind: 'compulsion',
          principle: 'will not accept payment to stand down',
          by: 'the officer corps',
          reason: 'Being bought is the insult, not the price.',
        },
      }),
    };
    const campaign = Campaign.start('vigil', 'test-promoted');

    const outcome = await submitAction(campaign, 'Take the Combine’s money and withdraw.');

    expect(calls.map((c) => c.kind)).toEqual(['appraisal']);
    expect(outcome.refusal?.violated).toBe(
      'will not accept payment to stand down; being bought is the insult, not the price',
    );
    expect(campaign.state.factions.find((f) => f.id === 'vigil')!.dissent).toBe(REFUSAL_DISSENT);
  });

  it('rewrites an inadmissible ruling that is really a breach', async () => {
    // `admissible: false` costs nothing, which makes it the cheapest bypass in
    // the game for a principle. The prompt says "out of character is not
    // inadmissible"; this is what says it in code.
    scripted = {
      appraisal: appraisal({
        admissible: false,
        reason: `Your doctrine forbids this: "${NO_NARS}". The officer corps will not permit it.`,
      }),
      resolution: { narrative: 'It is done, quietly.', ops: [] },
    };
    const campaign = Campaign.start('vigil', 'test-smuggled');

    const outcome = await submitAction(campaign, HIRE_THE_NARS);

    expect(outcome.notes).not.toContain(
      'The arbiter ruled this cannot be attempted as things stand.',
    );
    expect(outcome.defiance?.violated).toBe(NO_NARS);
    expect(campaign.state.factions.find((f) => f.id === 'vigil')!.dissent).toBe(
      COMPULSION_BREACH_DISSENT,
    );
  });

  it('leaves an ordinary inadmissible ruling alone', async () => {
    scripted = {
      appraisal: appraisal({
        admissible: false,
        reason: 'You do not hold that world and have no fleet within six jumps of it.',
      }),
    };
    const campaign = Campaign.start('vigil', 'test-plain-inadmissible');

    const outcome = await submitAction(campaign, 'Cede Kalzir to the Free Worlds.');

    expect(outcome.notes).toContain('The arbiter ruled this cannot be attempted as things stand.');
    expect(campaign.state.factions.find((f) => f.id === 'vigil')!.dissent).toBe(0);
  });

  it('charges nothing for a principle the faction does not hold', async () => {
    // An invented line is not a breach: there is nothing there to have broken,
    // and a model that can name its own rule can charge any price it likes.
    scripted = {
      appraisal: appraisal({
        breach: {
          kind: 'red_line',
          principle: 'the Vigil does not act before the second hour of the watch',
          by: 'the officer corps',
          reason: 'It is not yet the second hour.',
        },
      }),
      resolution: { narrative: 'The order goes out.', ops: [] },
    };
    const campaign = Campaign.start('vigil', 'test-invented');

    const outcome = await submitAction(campaign, 'Send a courier to Kalzir.');

    expect(outcome.refusal).toBeNull();
    expect(outcome.defiance).toBeNull();
    expect(campaign.state.factions.find((f) => f.id === 'vigil')!.dissent).toBe(0);
  });
});

describe('the matcher is loose about quoting and strict about identity', () => {
  it('matches a truncated or re-punctuated quote', () => {
    const vigil = createSeedState('vigil').factions.find((f) => f.id === 'vigil')!;
    for (const quote of [
      'will not accept payment to stand down',
      'Will not accept payment to stand down — being bought is the insult, not the price.',
      'will not recognise a rebel government as legitimate',
    ]) {
      expect(classifyPrinciple(vigil, quote)?.kind).toBe('red_line');
    }
  });

  it('never matches another power’s line', () => {
    // The five sheets have almost nothing in common, which is what lets the
    // matcher be forgiving about wording without ever charging the wrong power
    // for the wrong principle.
    const state = createSeedState('vigil');
    for (const f of state.factions) {
      for (const other of state.factions) {
        if (other.id === f.id) continue;
        for (const line of [...other.redLines, ...other.compulsions.map((c) => c.text)]) {
          expect(classifyPrinciple(f, line)).toBeNull();
        }
      }
    }
  });

  it('resolves every line on every sheet to its own list', () => {
    const state = createSeedState('vigil');
    for (const f of state.factions) {
      for (const line of f.redLines) {
        expect(classifyPrinciple(f, line)).toEqual({ kind: 'red_line', principle: line });
      }
      for (const c of f.compulsions) {
        expect(classifyPrinciple(f, c.text)).toEqual({ kind: 'compulsion', principle: c.text });
      }
    }
  });
});

describe('the arbiter can see what it is being asked to rule on', () => {
  it('is shown the acting faction’s red lines and compulsions', async () => {
    // It was not, for the whole life of the appraisal call: `serializeState`
    // carries doctrine and ethics but neither list. A referee cannot enforce a
    // rule it has never been given, and this is the pin that says so.
    scripted = {
      appraisal: appraisal(),
      resolution: { narrative: 'Done.', ops: [] },
    };

    await resolveAction(createSeedState('freeworlds'), 'Send a courier to Sennex.');

    const arbiter = calls.find((c) => c.kind === 'appraisal')!;
    expect(arbiter.user).toContain('You will NOT, whatever the incentive');
    expect(arbiter.user).toContain(NO_OCCUPATION);
    expect(arbiter.user).toContain('Your own institutions DEMAND of you');
    // And is shown ONLY that. `voice` is a page of dialect notes for writing
    // dialogue — for Arkanis, thousands of tokens of it — and putting the whole
    // character sheet into a bounded classification call would have doubled the
    // price of every action in the game.
    const arkanis = createSeedState('freeworlds').factions.find((f) => f.id === 'freeworlds')!;
    expect(arbiter.user).not.toContain(arkanis.voice);
  });
});
