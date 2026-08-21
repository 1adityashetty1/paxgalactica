import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DiplomacyReplySchema, looksLikeStubReply } from '../src/model/calls.js';
import { ModelOpSchema, ModelTurnOutputSchema } from '../src/domain/ops.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { GameSession } from '../src/server/session.js';
import { loadPrompt } from '../src/model/prompts.js';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, COERCION_RESENTMENT, tickTurn } from '../src/domain/reducer.js';
import {
  ledgerFor,
  subornLimit,
  treatiesFor,
  warsFor,
  type WorldState,
} from '../src/domain/state.js';

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
    campaign.recordTranscript('hutt', [{ speaker: 'player', text: 'A secret for the Nars.' }]);
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

  it('tells every prompt that CAN move a fleet to set a force', () => {
    // Without this NPCs commit their entire navy at an origin on every move.
    // `extraction` is deliberately absent: it may no longer emit
    // `fleet_movement` at all — the reducer rejects it as `declared_only` —
    // because a fleet movement needs nobody's consent and must cost an action.
    for (const name of ['resolution', 'reaction'] as const) {
      expect(loadPrompt(name), `${name}.md`).toMatch(/`?force`?/);
    }
  });

  it('offers only ops the model is actually allowed to emit', () => {
    const legal = new Set<string>(ModelOpSchema.options.map((o) => o.shape.op.value));
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

describe('war is a property of the relationship, not one opinion', () => {
  const fresh = () => createSeedState('krayt');

  it('lists an aggressor even when only the victim hates them', () => {
    // The mechanical disposition costs — raiding, suborning, tolls,
    // pact-breaking — all move the INJURED party's view of the aggressor and
    // never the aggressor's view of them. Reading only "who hates me" meant
    // the victim of a raid did not count their raider as an enemy: a playtest
    // left Arkanis at -62 toward Drajk while Drajk sat at -10 toward Arkanis.
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['krayt'] = -62;
    state.factions.find((f) => f.id === 'krayt')!.disposition['freeworlds'] = -10;

    expect(warsFor(state, 'freeworlds')).toContain('krayt');
    expect(warsFor(state, 'krayt')).toContain('freeworlds');
  });

  it('stays quiet when neither side has soured past the threshold', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['krayt'] = -59;
    state.factions.find((f) => f.id === 'krayt')!.disposition['freeworlds'] = -59;
    expect(warsFor(state, 'freeworlds')).not.toContain('krayt');
    expect(warsFor(state, 'krayt')).not.toContain('freeworlds');
  });

  it('is still suppressed by a live pact, in both directions', () => {
    // Mutuality must not defeat the treaty check — a pact is exactly the thing
    // that says "we are not at war regardless of how we feel".
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['krayt'] = -90;
    state.treaties.push({
      id: 't1', type: 'non_aggression', parties: ['freeworlds', 'krayt'],
      terms: { territory: [], shipsPledged: {}, incomePerTurn: {}, incomeShares: [], mutualDefenseTrigger: '', voidsOn: [] },
      signedTurn: 0, expiresTurn: null, effectiveTurn: null, status: 'active', summary: 'na',
    });
    expect(warsFor(state, 'freeworlds')).not.toContain('krayt');
    expect(warsFor(state, 'krayt')).not.toContain('freeworlds');
  });
});

describe('agents cannot be given an effect that can never fire', () => {
  it('rejects crew_defection where guile can never beat resolve', () => {
    // Drajk guile 14 vs Arkanis resolve 19 -> subornLimit 0. An agent placed
    // anyway is live, unexposed, rolls every turn, and can never turn a hull.
    const state = createSeedState('krayt');
    expect(subornLimit(state, 'krayt', 'freeworlds')).toBe(0);

    const res = applyOps(
      state,
      [
        {
          op: 'deploy_agent', ownerFactionId: 'krayt', systemId: 'ark-6',
          mission: 'theft', effect: { kind: 'crew_defection', perTurn: 1 },
          cover: 'labour broker',
        },
      ],
      'model',
      'krayt',
    );
    expect(res.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(res.rejections[0]!.message).toMatch(/resolve is beyond its guile/);
    expect(res.state.agents).toHaveLength(0);
  });

  it('allows crew_defection where the contest is winnable', () => {
    // The Nars at guile 18 can suborn Meridian (resolve 9) comfortably.
    const state = createSeedState('hutt');
    expect(subornLimit(state, 'hutt', 'meridian')).toBeGreaterThan(0);
    const res = applyOps(
      state,
      [
        {
          op: 'deploy_agent', ownerFactionId: 'hutt', systemId: 'slu-1',
          mission: 'theft', effect: { kind: 'crew_defection', perTurn: 1 },
          cover: 'dock factor',
        },
      ],
      'model',
      'hutt',
    );
    expect(res.rejections).toHaveLength(0);
    expect(res.state.agents).toHaveLength(1);
  });

  it('leaves other effect kinds alone against a resolute target', () => {
    // Only crew_defection depends on subornLimit; sabotage against Arkanis is
    // perfectly legitimate and must not be caught by the new guard.
    const res = applyOps(
      createSeedState('krayt'),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'krayt', systemId: 'ark-6',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 },
          cover: 'dock hand',
        },
      ],
      'model',
      'krayt',
    );
    expect(res.rejections).toHaveLength(0);
    expect(res.state.agents).toHaveLength(1);
  });
});

describe('an operative belongs to whoever deployed it', () => {
  it('rejects an agent owned by the faction it targets', () => {
    // Reproduced three times live: on a hostile mission the resolution call
    // anchored ownerFactionId to the faction being harmed. The tick loop skips
    // any agent whose owner is its own target, so the operative was silently
    // inert forever with no rejection and nothing visible in the UI.
    const res = applyOps(
      createSeedState('meridian'),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'vigil', systemId: 'tio-2',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 3 },
          cover: 'requisitions officer',
        },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(res.rejections[0]!.message).toMatch(/cannot deploy an agent owned by/);
    expect(res.state.agents).toHaveLength(0);
  });

  it('accepts one the acting faction actually owns', () => {
    const res = applyOps(
      createSeedState('meridian'),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'meridian', systemId: 'tio-2',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 3 },
          cover: 'dock hand',
        },
      ],
      'model',
      'meridian',
    );
    expect(res.rejections).toHaveLength(0);
    expect(res.state.agents[0]!.ownerFactionId).toBe('meridian');
  });

  it('leaves engine ops and legacy journals alone', () => {
    const res = applyOps(
      createSeedState('meridian'),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'vigil', systemId: 'tio-2',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 3 },
        },
      ],
      'model',
    );
    expect(res.rejections).toHaveLength(0);
  });
});

describe('extraction knows about treaties at all', () => {
  const extraction = () => loadPrompt('extraction');

  it('documents form_treaty, which it previously never mentioned', () => {
    // The root cause of a playtest finding: a negotiated deal covering trade
    // immunity, basing rights AND mutual defence was extracted as a single
    // `trade_accord`, so two of the three clauses were inert. The prompt's
    // "What to emit" list did not mention `form_treaty` anywhere, leaving the
    // model to guess both the op and its type.
    expect(extraction()).toMatch(/`form_treaty`/);
  });

  it('names every treaty type the reducer treats differently', () => {
    const text = extraction();
    for (const type of [
      'non_aggression', 'ceasefire', 'mutual_defense',
      'trade_accord', 'basing_rights', 'tribute',
    ]) {
      expect(text, `extraction.md should explain ${type}`).toMatch(
        new RegExp(`\`${type}\``),
      );
    }
  });

  it('tells the model a multi-clause deal needs multiple treaties', () => {
    expect(extraction()).toMatch(/more than one of these needs more than one treaty/i);
  });

  it('warns that terms on the wrong type are inert', () => {
    // `shipsPledged` only dispatches under mutual_defense; mutualDefenseTrigger
    // on a trade_accord is narrative text.
    expect(extraction()).toMatch(/shipsPledged/);
    expect(extraction()).toMatch(/inert/i);
  });
});

describe('the correction pass does not re-run the whole action', () => {
  const correction = () => loadPrompt('correction');

  it('exists as its own prompt rather than reusing resolution', () => {
    // The correction call used to run under the full resolution system prompt,
    // whose entire job is "narrate this action and emit its ops". That
    // contradicted the user message's "only fix these rejects", and the system
    // prompt won: one playtest correction re-derived the whole batch and
    // double-billed a 3-hull defection as 6 hulls across two systems.
    expect(correction().length).toBeGreaterThan(0);
    expect(correction().replace(/\s+/g, ' ')).toMatch(
      /do not re-emit anything that already succeeded/i,
    );
  });

  it('tells the model an empty correction is acceptable', () => {
    // Otherwise the model reaches for *something*, which is how a forbidden op
    // becomes a creative workaround.
    // Prompt text is hard-wrapped, so collapse whitespace before matching.
    expect(correction().replace(/\s+/g, ' ')).toMatch(
      /empty list is a perfectly good answer/i,
    );
  });

  it('tells it to drop structurally forbidden ops rather than route around them', () => {
    expect(correction().replace(/\s+/g, ' ')).toMatch(/routing around it is worse/i);
  });

  it('is no longer built from the resolution prompt', () => {
    // Guards the actual regression: if someone re-points corrections at the
    // resolution prompt, the duplication comes straight back.
    const turnSource = readFileSync(
      new URL('../src/engine/turn.ts', import.meta.url),
      'utf8',
    );
    expect(turnSource).toMatch(/loadPrompt\('correction'\)/);
    expect(turnSource).not.toMatch(/resolutionSystemPrompt/);
  });
});

describe('the persona speaks rather than narrating itself', () => {
  it('bans third-person meta-narration outright', () => {
    // Observed once live: a reply that closed a treaty came back as
    // "I role-played the Ojjul Nar Combine's side of this negotiation..."
    // instead of the Combine's actual words. The anti-assistant section
    // covered hedging and politeness but not describing-instead-of-speaking.
    const persona = loadPrompt('diplomacy-persona').replace(/\s+/g, ' ');
    expect(persona).toMatch(/never describe what you are doing instead of doing it/i);
    expect(persona).toMatch(/first person/i);
  });

  it('warns that it happens most when closing a deal', () => {
    const persona = loadPrompt('diplomacy-persona').replace(/\s+/g, ' ');
    expect(persona).toMatch(/closes.{0,40}deal|seal it in character/i);
  });
});

describe('slow diplomacy can accumulate', () => {
  const appraisal = () => loadPrompt('appraisal').replace(/\s+/g, ' ');

  it('tells the arbiter that partial headway is worth recording', () => {
    // A playtest spent three turns and real credits courting neutral worlds;
    // every world-targeted partial left `commitments: []` and the system
    // byte-identical, so turn four started from nothing. Combat damage
    // persists and agents persist — diplomacy was the one pressure track
    // with no ratchet.
    expect(appraisal()).toMatch(/ground gained also counts/i);
    expect(appraisal()).toMatch(/`accession_talks`/);
  });

  it('asks for the specific world and how far it got', () => {
    expect(appraisal()).toMatch(/name \*\*which world or party\*\*/i);
  });

  it('makes banked progress lower the next difficulty', () => {
    // The ratchet itself: without this, recording progress would be flavour.
    expect(appraisal()).toMatch(/ground already gained makes the next step easier/i);
    expect(appraisal()).toMatch(/drop by roughly 2 or 3 per round/i);
  });

  it('keeps courtship non-exclusive so rivals can contest the same world', () => {
    expect(appraisal()).toMatch(/normally \*\*false\*\*/i);
  });

  it('still refuses to record headway that did not happen', () => {
    expect(appraisal()).toMatch(/do not record headway that did not happen/i);
  });
});

/**
 * A reply that describes itself instead of being itself.
 *
 * Seen live on two different factions: "Gate-officer's reply, in character,
 * delivered above." and "Legate's reply delivered in-channel as above." Under
 * `outputFormat: json_schema` the model writes the prose as ordinary assistant
 * text and fills the one required field with a pointer to it. `min(1)` passes,
 * so the player is shown a stage direction — and because the stub is appended
 * to the transcript the extraction pass reads, whatever was agreed in that
 * exchange has a hole where its terms should be and cannot be enacted.
 *
 * The guard has to be narrow in one specific way: a very short reply is
 * legitimate for at least two of the five powers ("No.", "Agreed."), so length
 * alone can never be the test.
 */
describe('a diplomacy reply must be speech, not a note about speech', () => {
  it('rejects the stubs seen in live play', () => {
    for (const stub of [
      "Gate-officer's reply, in character, delivered above.",
      "Legate's reply delivered in-channel as above.",
      'Response provided above.',
      'The faction\'s reply is as follows.',
    ]) {
      expect(looksLikeStubReply(stub), stub).toBe(true);
      expect(DiplomacyReplySchema.safeParse({ reply: stub }).success, stub).toBe(false);
    }
  });

  it('leaves a genuinely short in-character reply alone', () => {
    for (const real of [
      'No.',
      'Agreed. Twelve hulls, to the second mark, off my station by the next burn.',
      'That is defensible. I could put it in a dispatch tomorrow. Yes.',
      'Sit. This will take an hour whichever way it goes.',
    ]) {
      expect(looksLikeStubReply(real), real).toBe(false);
      expect(DiplomacyReplySchema.safeParse({ reply: real }).success, real).toBe(true);
    }
  });

  it('does not fire on long prose that happens to use the words', () => {
    // A real reply can discuss a message or an answer without being a stub.
    const long =
      'Your message reached me above the Kessel line, and my answer is the one ' +
      'I gave your predecessor: the survey party arrives on the ninth. I have ' +
      'read the charts you provided and they do not change the arithmetic, ' +
      'though I will say they are better kept than most. Bring me something ' +
      'that alters the cost and I will hear it seriously, as I have said.';
    expect(looksLikeStubReply(long)).toBe(false);
  });
});

/**
 * A deal an NPC gates on ratification used to evaporate.
 *
 * Extraction is told, correctly, that a conditional promise produces nothing
 * yet — so it emitted a `treaty_ratification` order and no treaty. That order
 * carries no payload by design, so it ticked, completed, logged, and changed
 * nothing: a fully negotiated marriage, supply line and transit compact gone on
 * completion. A treaty recorded now and inert until its effective turn is one
 * object instead of two that can desync.
 */
describe('a treaty can be agreed now and take force later', () => {
  const pact = (ratifyTurns?: number) => ({
    op: 'form_treaty',
    treatyType: 'tribute' as const,
    parties: ['freeworlds', 'hutt'],
    terms: { incomePerTurn: { freeworlds: -20, hutt: 20 } },
    summary: 'subject to the councils',
    ...(ratifyTurns === undefined ? {} : { ratifyTurns }),
  });

  it('records it as pending and applies none of its terms', () => {
    const out = applyOps(createSeedState('freeworlds'), [pact(2)], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    const treaty = out.state.treaties.at(-1)!;
    expect(treaty.status).toBe('pending');
    expect(treaty.effectiveTurn).toBe(out.state.turn + 2);
    // Inert: `isTreatyLive` gates on active, so no reader sees it.
    expect(treatiesFor(out.state, 'hutt').map((t) => t.id)).not.toContain(treaty.id);
    expect(ledgerFor(out.state, 'hutt').treatyFlow).toBe(0);
  });

  it('comes into force on its turn, and its terms start applying', () => {
    let state = applyOps(
      createSeedState('freeworlds'),
      [pact(2)],
      'extraction',
      'freeworlds',
    ).state;
    const id = state.treaties.at(-1)!.id;

    state = tickTurn(state).state;
    expect(state.treaties.find((t) => t.id === id)!.status).toBe('pending');

    const second = tickTurn(state);
    expect(second.state.treaties.find((t) => t.id === id)!.status).toBe('active');
    expect(ledgerFor(second.state, 'hutt').treatyFlow).toBe(20);
    expect(second.notes.join(' ')).toMatch(/Ratified/);
  });

  it('is live at once when nothing has to ratify it', () => {
    const out = applyOps(createSeedState('freeworlds'), [pact()], 'extraction', 'freeworlds');
    expect(out.state.treaties.at(-1)!.status).toBe('active');
    expect(ledgerFor(out.state, 'hutt').treatyFlow).toBe(20);
  });
});

/**
 * `Treaty.terms.territory` existed for the whole life of the project and
 * nothing read it: a playtest signed an accord naming four systems, two of them
 * not even held by the player, and no controller changed.
 *
 * It does not breach the rule that control changes only on a `fleet_movement`
 * arrival. That rule stops a model talking itself into owning a distant system;
 * a cession comes from a transcript, which is the one place the other party's
 * consent exists — and `form_treaty` is already extraction-only, so a declared
 * action still cannot move a border.
 */
describe('a ceded system changes hands', () => {
  const cede = (systemId: string, parties: [string, string]) => ({
    op: 'form_treaty',
    treatyType: 'ceasefire' as const,
    parties,
    terms: { territory: [systemId] },
    summary: 'a negotiated withdrawal',
  });

  const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

  it('transfers control, keeps the garrison, and withdraws the ceder’s ships', () => {
    const state = createSeedState('freeworlds');
    const before = sys(state, 'ark-6');
    const garrison = before.garrison;
    const ships = before.ships['freeworlds'] ?? 0;
    expect(ships).toBeGreaterThan(0);

    const out = applyOps(state, [cede('ark-6', ['freeworlds', 'hutt'])], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);

    const after = sys(out.state, 'ark-6');
    expect(after.controllerFactionId).toBe('hutt');
    // Nobody fought, so the garrison is handed over intact — the difference
    // between capitulation and conquest.
    expect(after.garrison).toBe(garrison);
    // And the ceder's fleet leaves rather than being captured or destroyed.
    expect(after.ships['freeworlds'] ?? 0).toBe(0);
    const elsewhere = out.state.systems
      .filter((x) => x.id !== 'ark-6')
      .reduce((n, x) => n + (x.ships['freeworlds'] ?? 0), 0);
    const originally = state.systems
      .filter((x) => x.id !== 'ark-6')
      .reduce((n, x) => n + (x.ships['freeworlds'] ?? 0), 0);
    expect(elsewhere).toBe(originally + ships);
    expect(out.notes.join(' ')).toMatch(/withdraw to/);
  });

  it('cedes nothing it does not hold', () => {
    // tio-3 is the Vigil's, and the Vigil is not a party.
    const out = applyOps(
      createSeedState('freeworlds'),
      [cede('tio-3', ['freeworlds', 'hutt'])],
      'extraction',
      'freeworlds',
    );
    expect(out.rejections).toHaveLength(0);
    expect(sys(out.state, 'tio-3').controllerFactionId).toBe('vigil');
  });

  it('waits for ratification when the treaty is pending', () => {
    const state = createSeedState('freeworlds');
    const out = applyOps(
      state,
      [{ ...cede('ark-6', ['freeworlds', 'hutt']), ratifyTurns: 1 }],
      'extraction',
      'freeworlds',
    );
    // Still Free Worlds: the councils have not sat yet.
    expect(sys(out.state, 'ark-6').controllerFactionId).toBe('freeworlds');
    const ticked = tickTurn(out.state);
    expect(sys(ticked.state, 'ark-6').controllerFactionId).toBe('hutt');
  });
});

/**
 * "This ends if you sign with the Vigil" is a thing powers say constantly, and
 * it used to be pure narration. The playtest detail that makes it a bug rather
 * than a gap: both forbidden treaties were signed on one timestamp, the NPC
 * noticed in prose the next turn, and it broke only the half that cost it. The
 * trade accord paying the player survived four more turns.
 */
describe('a void condition ends a treaty when it comes true', () => {
  const withCondition = (condition: unknown) => ({
    op: 'form_treaty',
    treatyType: 'trade_accord' as const,
    parties: ['freeworlds', 'hutt'],
    terms: { incomePerTurn: { freeworlds: 10, hutt: -10 }, voidsOn: [condition] },
    summary: 'conditional accord',
  });

  const statusOf = (s: WorldState) => s.treaties.at(-1)!.status;

  it('fires when the constrained party signs with the named power', () => {
    const state = createSeedState('freeworlds');
    const signed = applyOps(
      state,
      [withCondition({ kind: 'treaty_with', by: 'hutt', target: 'vigil' })],
      'extraction',
      'freeworlds',
    ).state;
    expect(statusOf(signed)).toBe('active');
    // Still fine after a quiet turn.
    expect(statusOf(tickTurn(signed).state)).toBe('active');

    const betrayed = applyOps(
      signed,
      [
        {
          op: 'form_treaty',
          treatyType: 'non_aggression',
          parties: ['hutt', 'vigil'],
          terms: {},
          summary: 'the very thing that was forbidden',
        },
      ],
      'extraction',
      'hutt',
    ).state;
    const ticked = tickTurn(betrayed);
    expect(ticked.state.treaties[ticked.state.treaties.length - 2]!.status).toBe('voided');
    expect(ticked.notes.join(' ')).toMatch(/Treaty voided/);
  });

  it('fires on insolvency, so a broke payer cannot quietly stop paying', () => {
    const state = createSeedState('freeworlds');
    const signed = applyOps(
      state,
      [withCondition({ kind: 'insolvent', by: 'hutt' })],
      'extraction',
      'freeworlds',
    ).state;
    expect(statusOf(signed)).toBe('active');

    // Drive the Combine to a loss it cannot cover.
    for (const sys of signed.systems) {
      if (sys.controllerFactionId === 'hutt') sys.ships['hutt'] = 400;
    }
    const ticked = tickTurn(signed);
    const treaty = ticked.state.treaties.find((t) => t.summary === 'conditional accord')!;
    expect(treaty.status).toBe('voided');
    expect(ticked.notes.join(' ')).toMatch(/running at a loss/);
  });

  it('leaves an unconditional treaty alone', () => {
    const state = createSeedState('freeworlds');
    const signed = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'trade_accord',
          parties: ['freeworlds', 'hutt'],
          terms: {},
          summary: 'no strings',
        },
      ],
      'extraction',
      'freeworlds',
    ).state;
    expect(statusOf(tickTurn(signed).state)).toBe('active');
  });
});

/**
 * A lopsided-Vigil playtest put the identical ultimatum to all four powers with
 * 1,020 hulls against 24–39. Three conceded, and the two that conceded most
 * ended the turn BETTER disposed toward the Vigil — because the only thing
 * moving disposition after a negotiation was extraction rewarding a
 * constructive conversation. Nothing modelled resentment at being coerced, so
 * bullying a neighbour into tribute was rewarded for being done politely.
 */
describe('signing under a fleet costs the power holding the fleet', () => {
  const accord = {
    op: 'form_treaty',
    treatyType: 'tribute' as const,
    parties: ['freeworlds', 'vigil'],
    terms: { incomePerTurn: { freeworlds: -20, vigil: 20 } },
    summary: 'terms',
  };

  const dispositionToward = (s: WorldState, who: string, toward: string) =>
    s.factions.find((f) => f.id === who)!.disposition[toward] ?? 0;

  it('charges the coercer when its ships sit on the other party’s worlds', () => {
    const state = createSeedState('freeworlds');
    state.systems.find((x) => x.id === 'ark-1')!.ships['vigil'] = 40;
    const before = dispositionToward(state, 'freeworlds', 'vigil');

    const out = applyOps(state, [accord], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);
    expect(dispositionToward(out.state, 'freeworlds', 'vigil')).toBe(
      before - COERCION_RESENTMENT,
    );
    expect(out.notes.join(' ')).toMatch(/ships over 1 of its worlds/);
  });

  it('charges nothing for an ordinary negotiation', () => {
    const state = createSeedState('freeworlds');
    const before = dispositionToward(state, 'freeworlds', 'vigil');
    const out = applyOps(state, [accord], 'extraction', 'freeworlds');
    expect(dispositionToward(out.state, 'freeworlds', 'vigil')).toBe(before);
  });

  it('does not charge a guest who was invited in', () => {
    const state = createSeedState('freeworlds');
    // Basing rights first: those ships are there by agreement, and `isGuestOf`
    // already knows the difference between a guest and an occupier.
    const invited = applyOps(
      state,
      [
        {
          op: 'form_treaty',
          treatyType: 'basing_rights',
          parties: ['freeworlds', 'vigil'],
          terms: {},
          summary: 'come and go',
        },
      ],
      'extraction',
      'freeworlds',
    ).state;
    invited.systems.find((x) => x.id === 'ark-1')!.ships['vigil'] = 40;
    const before = dispositionToward(invited, 'freeworlds', 'vigil');

    const out = applyOps(invited, [accord], 'extraction', 'freeworlds');
    expect(dispositionToward(out.state, 'freeworlds', 'vigil')).toBe(before);
  });
});
