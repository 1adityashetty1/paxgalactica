import { describe, expect, it, vi } from 'vitest';

/**
 * Three guards on the arbiter, each held in code because the prompt alone did
 * not hold them across two playtests (2026-10-16):
 *
 * - a refusal citing a rule nobody wrote — class as a gate, "no mechanic",
 *   "cannot be reassigned" — is put back to the arbiter once;
 * - covert work is sent, not rolled: the declaration has no d20 of its own, so
 *   the operative's chance on the tick is the only roll;
 * - a covert send carries only the sending, so resolution cannot charge fees
 *   for free groundwork, charge a deployment twice or reach into a rival's
 *   programme.
 */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift();
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    return { value: next, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { submitAction } = await import('../src/engine/turn.js');
const { Campaign } = await import('../src/engine/campaign.js');
const { inventedRefusal, covertSendOnly } = await import('../src/domain/refusals.js');

function withOperative() {
  const campaign = Campaign.start('ojjul', 'arbiter-guards');
  const home = campaign.state.systems.find((s) => s.controllerFactionId === 'ojjul')!;
  campaign.stage([{ op: 'recruit_agent', systemId: home.id }], 'recruit', '', 'model', 'ojjul');
  const target = campaign.state.systems.find(
    (s) => s.controllerFactionId === 'meridian',
  )!;
  return { campaign, home, target };
}

function reset(script: Record<string, unknown[]>) {
  calls.length = 0;
  queue = script;
}

describe('a refusal citing a rule nobody wrote', () => {
  it('is recognised by the shape of its reason', () => {
    expect(inventedRefusal("Embezzlement is not a sparrow's mission.")).toBe('class');
    expect(inventedRefusal('Only a wetworker can carry out a kidnapping.')).toBe('class');
    expect(inventedRefusal('There is no mechanic for relocating a prisoner.')).toBe('no_mechanic');
    expect(inventedRefusal('The engine has no way to represent that.')).toBe('no_mechanic');
    expect(inventedRefusal('That operative cannot be reassigned mid-mission.')).toBe('reassign');
    // Facts about the board stay refusals.
    expect(inventedRefusal('Your sparrow at Kalzir was caught last turn.')).toBeNull();
    expect(inventedRefusal('Nobody sits the seat at Brannix.')).toBeNull();
    expect(inventedRefusal('')).toBeNull();
  });

  it('goes back to the arbiter once, and the second ruling is the one that stands', async () => {
    const { campaign, target } = withOperative();
    reset({
      appraisal: [
        { admissible: false, reason: "Embezzlement is not a sparrow's mission." },
        {
          admissible: true,
          reason: '',
          covert: [{ mission: 'embezzlement', systemId: target.id }],
        },
      ],
      resolution: [{ narrative: 'Vessine goes to work.', ops: [] }],
    });
    const outcome = await submitAction(campaign, 'Have Vessine skim the Brannix customs house.');
    expect(calls.filter((c) => c.kind === 'appraisal')).toHaveLength(2);
    expect(calls[1]!.user).toContain('Class is never a gate');
    expect(outcome.inadmissible).toBeFalsy();
    expect(outcome.ops.some((o) => (o as { op: string }).op === 'deploy_agent')).toBe(true);
  });

  it('turns a "no mechanic" refusal that survives the retry into the missing outcome, at no action', async () => {
    const { campaign } = withOperative();
    const before = campaign.actionPointsLeft;
    reset({
      appraisal: [
        { admissible: false, reason: 'There is no mechanic for moving a prisoner.' },
        { admissible: false, reason: 'There is no mechanic for moving a prisoner.' },
      ],
    });
    const outcome = await submitAction(campaign, 'Smuggle our hostage off Vergesse to Shalka.');
    expect(outcome.inadmissible).toMatch(/^No mission does that yet:/);
    expect(campaign.actionPointsLeft).toBe(before);
  });

  it('leaves a refusal that cites the board alone', async () => {
    const { campaign } = withOperative();
    reset({ appraisal: [{ admissible: false, reason: 'Nobody sits the seat at Brannix.' }] });
    const outcome = await submitAction(campaign, 'Kidnap the governor of Brannix.');
    expect(calls.filter((c) => c.kind === 'appraisal')).toHaveLength(1);
    expect(outcome.inadmissible).toBe('Nobody sits the seat at Brannix.');
  });
});

describe('covert work is sent, not rolled', () => {
  it('rolls nothing, needs no price, and stages a send that stands like a roll', async () => {
    const { campaign, target } = withOperative();
    reset({
      appraisal: [
        { admissible: true, reason: '', covert: [{ mission: 'surveillance', systemId: target.id }] },
      ],
      resolution: [{ narrative: 'Vessine takes a room over the docks.', ops: [] }],
    });
    const outcome = await submitAction(campaign, 'Have Vessine watch the docks.');
    expect(outcome.check).toBeNull();
    const resolution = calls.find((c) => c.kind === 'resolution')!;
    expect(resolution.user).toContain('sent, not rolled');
    expect(resolution.user).not.toContain('rolled **d20');
    expect(campaign.stagedBindings()).toContain('sent');
    expect(campaign.state.eventLog.some((e) => e.text.startsWith('[check]'))).toBe(false);
  });

  it('carries only the sending: no invented fee, no second charge, no reach into a rival', async () => {
    const { campaign, target } = withOperative();
    const credits = () => campaign.state.factions.find((f) => f.id === 'ojjul')!.credits;
    reset({
      appraisal: [
        {
          admissible: true,
          reason: '',
          groundwork: [{ systemId: target.id, text: 'a cook in the kitchens', axis: 'ease' }],
        },
      ],
      resolution: [
        {
          narrative: 'Vessine is taken on in the kitchens.',
          ops: [
            { op: 'adjust_credits', factionId: 'ojjul', delta: -40, reason: 'bribes for the post' },
            { op: 'adjust_disposition', factionId: 'meridian', towardFactionId: 'ojjul', delta: -5 },
          ],
        },
      ],
    });
    const before = credits();
    const outcome = await submitAction(campaign, 'Get Vessine hired into the kitchens.');
    expect(credits()).toBe(before);
    expect(outcome.notes.join(' ')).toMatch(/left out adjust_credits, adjust_disposition/);
    expect(outcome.ops.some((o) => (o as { op: string }).op === 'lay_groundwork')).toBe(true);
  });

  it('keeps exactly the sending ops', () => {
    const { ops, dropped } = covertSendOnly([
      { op: 'deploy_agent' },
      { op: 'extend_order' },
      { op: 'log_narrative' },
      { op: 'adjust_credits' },
    ]);
    expect(ops.map((o) => (o as { op: string }).op)).toEqual(['deploy_agent', 'log_narrative']);
    expect(dropped).toEqual(['extend_order', 'adjust_credits']);
  });
});

describe('sends are the ruling’s', () => {
  it('drops a send resolution adds to an act the arbiter did not rule covert', async () => {
    const { campaign, target } = withOperative();
    reset({
      appraisal: [{ admissible: true, reason: '', stat: 'guile', difficulty: 12 }],
      resolution: [
        {
          narrative: 'Word goes round the docks.',
          ops: [
            {
              op: 'deploy_agent',
              systemId: target.id,
              mission: 'assassination',
              effect: { kind: 'hull_damage', perTurn: 1 },
              cover: 'a rigger',
            },
          ],
        },
      ],
    });
    const outcome = await submitAction(campaign, 'Spread word among the dockers that Meridian is cutting pay.');
    expect(outcome.notes.join(' ')).toMatch(/sent only when the act is ruled covert/);
    expect(outcome.ops.some((o) => (o as { op: string }).op === 'deploy_agent')).toBe(false);
    expect(campaign.state.agents.every((a) => a.mission === null)).toBe(true);
  });

  it('puts an overt ruling back once when the act names one of your operatives', async () => {
    const { campaign, target } = withOperative();
    const name = campaign.state.agents.find((a) => a.ownerFactionId === 'ojjul')!.name;
    const family = name.split(' ').slice(1).join(' ');
    reset({
      appraisal: [
        { admissible: true, reason: '', stat: 'guile', difficulty: 14 },
        { admissible: true, reason: '', covert: [{ mission: 'surveillance', systemId: target.id }] },
      ],
      resolution: [{ narrative: 'They take a room over the docks.', ops: [] }],
    });
    const outcome = await submitAction(campaign, `Have ${family} watch the docks.`);
    const appraisals = calls.filter((c) => c.kind === 'appraisal');
    expect(appraisals).toHaveLength(2);
    expect(appraisals[1]!.user).toContain('This act names one of your operatives');
    expect(outcome.check).toBeNull();
    expect(outcome.ops.some((o) => (o as { op: string }).op === 'deploy_agent')).toBe(true);
  });
});

describe('a ruling made of parts', () => {
  it('rolls the open part and sends the covert one, in one declaration', async () => {
    const { campaign, home, target } = withOperative();
    reset({
      appraisal: [
        {
          kind: 'act',
          parts: [
            { kind: 'overt', what: 'the fleet stands off Brannix', stat: 'might', difficulty: 8 },
            { kind: 'covert', mission: 'surveillance', systemId: target.id },
          ],
        },
      ],
      resolution: [
        {
          narrative: 'The squadron takes station, and under its cover a watcher goes ashore.',
          ops: [{ op: 'log_narrative', text: 'The squadron takes station.' }],
        },
      ],
    });
    const outcome = await submitAction(campaign, `Sail from ${home.name} to stand off the coast while a watcher goes ashore.`);
    expect(outcome.check).not.toBeNull();
    expect(outcome.ops.some((o) => (o as { op: string }).op === 'deploy_agent')).toBe(true);
    expect(calls.find((c) => c.kind === 'resolution')!.user).toContain('The covert half of this act is not part of that roll');
  });

  it('carries the rider the ruling allowed into the send', async () => {
    const { campaign, target } = withOperative();
    reset({
      appraisal: [
        {
          kind: 'act',
          parts: [{ kind: 'covert', mission: 'larceny', systemId: target.id, rider: { mission: 'discord', towardFactionId: 'drajk' } }],
        },
      ],
      resolution: [{ narrative: 'They go in for the ledger.', ops: [] }],
    });
    const outcome = await submitAction(campaign, 'Take the customs ledger and leave it looking like Drajk work.');
    const send = outcome.ops.find((o) => (o as { op: string }).op === 'deploy_agent') as { rider?: { mission: string } };
    expect(send?.rider?.mission).toBe('discord');
  });

  it('notes an unexpressed part beside the parts that go ahead', async () => {
    const { campaign, target } = withOperative();
    reset({
      appraisal: [
        {
          kind: 'act',
          parts: [
            { kind: 'covert', mission: 'surveillance', systemId: target.id },
            { kind: 'unexpressed', outcome: 'spirit a prisoner out through Vigil space' },
          ],
        },
      ],
      resolution: [{ narrative: 'A watcher goes ashore.', ops: [] }],
    });
    const outcome = await submitAction(campaign, 'Watch the docks, and spirit the prisoner out through Vigil space.');
    expect(outcome.notes.join(' ')).toMatch(/Not done in this order: spirit a prisoner/);
    expect(outcome.inadmissible).toBeFalsy();
  });
});

describe('a refusal on a ground the board does not bear out', () => {
  it('is put back once, and a second false ground is the missing outcome at no action', async () => {
    const { campaign, home } = withOperative();
    const before = campaign.actionPointsLeft;
    const falseGround = {
      kind: 'inadmissible',
      ground: { kind: 'not_present', systemId: home.id },
      reason: 'You have nobody there.',
    };
    reset({ appraisal: [falseGround, falseGround] });
    const outcome = await submitAction(campaign, `Raise a monument at ${home.name}.`);
    const appraisals = calls.filter((c) => c.kind === 'appraisal');
    expect(appraisals).toHaveLength(2);
    expect(appraisals[1]!.user).toContain('Your refusal stands on something that is not so');
    expect(outcome.inadmissible).toMatch(/^No mission does that yet:/);
    expect(campaign.actionPointsLeft).toBe(before);
  });

  it('stands when the ground is true', async () => {
    const { campaign } = withOperative();
    reset({
      appraisal: [
        {
          kind: 'inadmissible',
          ground: { kind: 'no_such_entity', name: 'Quentin Zarbo', entity: 'person' },
          reason: 'Nobody of that name is held anywhere.',
        },
      ],
    });
    const outcome = await submitAction(campaign, 'Spring Quentin Zarbo from the Vigil cells.');
    expect(calls.filter((c) => c.kind === 'appraisal')).toHaveLength(1);
    expect(outcome.inadmissible).toBe('Nobody of that name is held anywhere.');
  });
});
