import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DiplomacyReplySchema } from '../src/model/calls.js';
import { ModelOpSchema, ModelTurnOutputSchema } from '../src/domain/ops.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { GameSession } from '../src/server/session.js';
import { loadPrompt } from '../src/model/prompts.js';

/**
 * Diplomacy's central promise is that conversation changes nothing until the
 * extraction pass runs. These tests pin that boundary at every layer it exists:
 * the schema, the engine, and the server.
 */

describe('the chat schema cannot express an op', () => {
  it('has a reply and nothing else', () => {
    // This is the load-bearing part. The boundary is not a prompt instruction a
    // model could be talked out of — the JSON schema handed to the model has no
    // `ops` field at all, so ops are unrepresentable in a diplomacy reply.
    const shape = Object.keys(DiplomacyReplySchema.shape);
    expect(shape).toEqual(['reply']);
  });

  it('strips anything resembling ops from a reply', () => {
    const parsed = DiplomacyReplySchema.parse({
      reply: 'We accept.',
      ops: [{ op: 'adjust_credits', factionId: 'hutt', delta: 9999 }],
    });
    expect(parsed).toEqual({ reply: 'We accept.' });
    expect('ops' in parsed).toBe(false);
  });

  it('produces a JSON schema with no ops property', () => {
    // What the model is actually shown.
    const json = JSON.stringify(
      z.toJSONSchema(DiplomacyReplySchema, { target: 'draft-7', io: 'input' }),
    );
    expect(json).not.toContain('ops');
    expect(json).toContain('reply');
  });

  it('rejects an empty reply', () => {
    expect(DiplomacyReplySchema.safeParse({ reply: '' }).success).toBe(false);
  });
});

describe('extraction is the only pass that can mutate', () => {
  it('uses the ops-bearing envelope, unlike chat', () => {
    expect(Object.keys(ModelTurnOutputSchema.shape).sort()).toEqual(['narrative', 'ops']);
  });

  it('still cannot transfer control of a system', () => {
    // A faction may "cede" a world in conversation; it still takes a fleet.
    const parsed = ModelTurnOutputSchema.safeParse({
      narrative: 'They ceded Ithaal.',
      ops: [{ op: 'transfer_control', systemId: 'slu-3', toFactionId: 'freeworlds' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('transcripts are memory, not world state', () => {
  it('records a conversation without touching the journal', () => {
    const campaign = Campaign.start('freeworlds', 'dip', new MemoryCampaignStore());
    const before = campaign.journal.entries.length;

    campaign.recordTranscript('hutt', [
      { speaker: 'player', text: 'We want the spice lanes.' },
      { speaker: 'faction', text: 'Everyone does.' },
    ]);

    expect(campaign.journal.entries).toHaveLength(before);
    expect(campaign.verifyReplay().ok).toBe(true);
    expect(campaign.state.eventLog.filter((e) => e.kind === 'diplomacy')).toHaveLength(0);
  });

  it('accumulates separate conversations so factions remember', () => {
    const campaign = Campaign.start('freeworlds', 'dip2', new MemoryCampaignStore());
    campaign.recordTranscript('vigil', [{ speaker: 'player', text: 'First approach.' }]);
    campaign.recordTranscript('vigil', [{ speaker: 'player', text: 'Second approach.' }]);

    const prior = campaign.priorTranscripts('vigil');
    expect(prior).toHaveLength(2);
    expect(prior[0]).toMatch(/First approach/);
    expect(prior[1]).toMatch(/Second approach/);
  });

  it('keeps each faction’s memory separate', () => {
    const campaign = Campaign.start('freeworlds', 'dip3', new MemoryCampaignStore());
    campaign.recordTranscript('hutt', [{ speaker: 'player', text: 'A secret for the Hutts.' }]);
    expect(campaign.priorTranscripts('vigil')).toHaveLength(0);
    expect(campaign.priorTranscripts('hutt')).toHaveLength(1);
  });

  it('labels the speakers from the faction’s point of view', () => {
    // The persona reads these, so "You" must mean the faction, not the player.
    const campaign = Campaign.start('freeworlds', 'dip4', new MemoryCampaignStore());
    campaign.recordTranscript('krayt', [
      { speaker: 'player', text: 'Stand down.' },
      { speaker: 'faction', text: 'Make me.' },
    ]);
    const text = campaign.priorTranscripts('krayt')[0]!;
    expect(text).toMatch(/Them: Stand down/);
    expect(text).toMatch(/You: Make me/);
  });

  it('survives a save and reload', async () => {
    const store = new MemoryCampaignStore();
    const campaign = Campaign.start('meridian', 'dip5', store);
    campaign.recordTranscript('krayt', [{ speaker: 'player', text: 'Name your price.' }]);
    await campaign.save();

    const reloaded = await Campaign.load('dip5', store);
    expect(reloaded!.priorTranscripts('krayt')[0]).toMatch(/Name your price/);
  });
});

describe('the persona prompt carries the boundary', () => {
  it('tells the faction its words bind nothing', () => {
    const persona = loadPrompt('diplomacy-persona');
    expect(persona).toMatch(/changes nothing|no ops|not binding/i);
    expect(persona).toMatch(/red line/i);
  });

  it('makes voice a constraint rather than decoration', () => {
    expect(loadPrompt('diplomacy-persona')).toMatch(/How you speak/);
  });

  it('keeps extraction conservative about what counts as agreed', () => {
    const extraction = loadPrompt('extraction');
    // A rejected, unanswered or conditional offer must produce nothing —
    // otherwise every pleasant conversation silently becomes a treaty.
    expect(extraction).toMatch(/rejected offer produces nothing/i);
    expect(extraction).toMatch(/unanswered offer produces nothing/i);
    expect(extraction).toMatch(/conditional promise produces nothing/i);
    // Deception still binds: betrayal is a later move, not a void.
    expect(extraction).toMatch(/[Dd]eception counts as agreed/);
  });

  it('denies extraction the transfer_control op', () => {
    // The prompt writes it as `transfer_control`, backticks and all.
    expect(loadPrompt('extraction')).toMatch(/transfer_control`?\s+is unavailable/i);
  });
});

describe('prompts do not drift from the schema', () => {
  // Prompts are the least-tested surface in the project: nothing else catches a
  // prompt promising the model a value the reducer will reject. These are cheap
  // and they caught extraction.md and reaction.md still advertising the old
  // 21-turn duration scale, long after it was capped at 5.
  const PROMPTS = ['resolution', 'reaction', 'extraction', 'duration-rubric'] as const;

  it('never advertises a duration outside the legal scale', () => {
    for (const name of PROMPTS) {
      const text = loadPrompt(name);
      for (const illegal of ['8, 13, 21', '13, 21', ', 21 turns']) {
        expect(text.includes(illegal), `${name}.md still offers "${illegal}"`).toBe(false);
      }
    }
  });

  it('states the five-turn ceiling wherever durations are described', () => {
    for (const name of ['resolution', 'reaction', 'extraction'] as const) {
      expect(loadPrompt(name), `${name}.md`).toMatch(/1, 2, 3,? or 5/);
    }
  });

  it('tells every ops-emitting prompt to set a movement force', () => {
    // Without this NPCs commit their entire navy at an origin on every move.
    for (const name of ['resolution', 'reaction', 'extraction'] as const) {
      expect(loadPrompt(name), `${name}.md`).toMatch(/`?force`?/);
    }
  });

  it('offers only ops the model is actually allowed to emit', () => {
    const legal = new Set(ModelOpSchema.options.map((o) => o.shape.op.value));
    for (const name of PROMPTS) {
      const text = loadPrompt(name);
      // Scoped to the ops table specifically — other tables in these prompts
      // list missions and treaty types, which are not ops.
      const heading = text.indexOf('## Ops you may emit');
      if (heading === -1) continue;
      const next = text.indexOf('\n## ', heading + 1);
      const table = text.slice(heading, next === -1 ? undefined : next);

      for (const m of table.matchAll(/^\| `(\w+)`/gm)) {
        const op = m[1]!;
        if (op === 'transfer_control') continue; // named only to forbid it
        expect(legal.has(op), `${name}.md offers unknown op "${op}"`).toBe(true);
      }
    }
  });

  it('documents every op the model may actually emit', () => {
    // The reverse drift: an op added to the schema but never told to the model
    // is an op that will never be used.
    const table = loadPrompt('resolution');
    const undocumented = ModelOpSchema.options
      .map((o) => o.shape.op.value)
      .filter((op) => !table.includes(`\`${op}\``));
    expect(undocumented, 'ops missing from resolution.md').toEqual([]);
  });
});

describe('session-level channel lifecycle', () => {
  const started = async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('freeworlds', 'chan');
    return session;
  };

  it('reports no open channel on a fresh campaign', async () => {
    const session = await started();
    expect(session.view().openChannel).toBeNull();
    expect(session.view().channelHistory).toEqual([]);
  });

  it('exposes channel history as a copy, not a live handle', async () => {
    const session = await started();
    const first = session.view().channelHistory;
    first.push({ speaker: 'player', text: 'injected' });
    // Mutating what the API handed you must not reach session state.
    expect(session.view().channelHistory).toEqual([]);
  });

  it('an empty transcript extracts to nothing without a model call', async () => {
    // closeChannel short-circuits on an empty history, which matters because
    // PAXGALACTICA_NO_NETWORK=1 would make any real call throw.
    const campaign = Campaign.start('freeworlds', 'empty', new MemoryCampaignStore());
    const { closeChannel } = await import('../src/engine/turn.js');
    const outcome = await closeChannel(campaign, 'hutt', []);
    expect(outcome.staged).toBe(0);
    expect(outcome.costUsd).toBe(0);
    expect(campaign.stagedCount).toBe(0);
    // The (empty) conversation is still recorded as having happened.
    expect(campaign.priorTranscripts('hutt')).toHaveLength(1);
  });
});
