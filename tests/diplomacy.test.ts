import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DiplomacyReplySchema, looksLikeStubReply } from '../src/model/calls.js';
import { ModelOpSchema, ModelTurnOutputSchema, ReactionSchema } from '../src/domain/ops.js';
import { ReactionViewSchema } from '../src/api/contract.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { GameSession } from '../src/server/session.js';
import { loadPrompt } from '../src/model/prompts.js';
import { createSeedState } from '../src/seed/scenario.js';
import { groundInConcessions } from '../src/engine/turn.js';
import {
  assetWorthTo,
  atThisTable,
  mergeConcessions,
  type Concession,
} from '../src/domain/diplomacy.js';
import { boundPayloadsToOutcome } from '../src/domain/development.js';
import { applyOps, COERCION_RESENTMENT, tickTurn } from '../src/domain/reducer.js';
import {
  hullsAt,
  setShipsAt,
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
  it('cannot express an op', () => {
    // This is the load-bearing part, and it is not a prompt instruction a model
    // could be talked out of: the JSON schema handed to the model has no `ops`
    // field, so ops are unrepresentable in a diplomacy reply.
    //
    // The reply carries `concessions` and `retractions` beside the prose now,
    // and those are NOT ops — a concession is a statement of position by the
    // power it would bind, and it still takes the `/endtalk` extraction pass to
    // become anything. So the assertion is the boundary itself rather than the
    // field count, which was only ever a proxy for it.
    const shape = Object.keys(DiplomacyReplySchema.shape);
    expect(shape).not.toContain('ops');
    expect(shape.sort()).toEqual(['concessions', 'reply', 'retractions']);
  });

  it('strips anything resembling ops from a reply', () => {
    const parsed = DiplomacyReplySchema.parse({
      reply: 'We accept.',
      ops: [{ op: 'adjust_credits', factionId: 'ojjul', delta: 9999 }],
    });
    expect(parsed).toEqual({ reply: 'We accept.', concessions: [], retractions: [] });
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
      ops: [{ op: 'transfer_control', systemId: 'sek-3', toFactionId: 'freeworlds' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('transcripts are memory, not world state', () => {
  it('records a conversation without touching the journal', () => {
    const campaign = Campaign.start('freeworlds', 'dip', new MemoryCampaignStore());
    const before = campaign.journal.entries.length;

    campaign.recordTranscript('ojjul', [
      { speaker: 'player', text: 'We want the narcotics lanes.' },
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
    campaign.recordTranscript('ojjul', [{ speaker: 'player', text: 'A secret for the Nars.' }]);
    expect(campaign.priorTranscripts('vigil')).toHaveLength(0);
    expect(campaign.priorTranscripts('ojjul')).toHaveLength(1);
  });

  it('labels the speakers from the faction’s point of view', () => {
    // The persona reads these, so "You" must mean the faction, not the player.
    const campaign = Campaign.start('freeworlds', 'dip4', new MemoryCampaignStore());
    campaign.recordTranscript('drajk', [
      { speaker: 'player', text: 'Stand down.' },
      { speaker: 'faction', text: 'Make me.' },
    ]);
    const text = campaign.priorTranscripts('drajk')[0]!;
    expect(text).toMatch(/Them: Stand down/);
    expect(text).toMatch(/You: Make me/);
  });

  it('survives a save and reload', async () => {
    const store = new MemoryCampaignStore();
    const campaign = Campaign.start('meridian', 'dip5', store);
    campaign.recordTranscript('drajk', [{ speaker: 'player', text: 'Name your price.' }]);
    await campaign.save();

    const reloaded = await Campaign.load('dip5', store);
    expect(reloaded!.priorTranscripts('drajk')[0]).toMatch(/Name your price/);
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
    // `extraction` is deliberately absent, for the same reason it is absent
    // from the force check below: an accord may no longer issue an order of ANY
    // type, so it never describes a duration and has no ceiling to state.
    for (const name of ['resolution', 'reaction'] as const) {
      expect(loadPrompt(name), `${name}.md`).toMatch(/1, 2, 3,? or 5/);
    }
  });

  it('does not offer an accord any order at all', () => {
    // The guard was one exception — every `issue_order` except a movement —
    // which made diplomacy an unmetered action channel for 13 of the 14 types.
    const text = loadPrompt('extraction');
    expect(text).toMatch(/No orders of any kind/);
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
    const outcome = await closeChannel(campaign, 'ojjul', []);
    expect(outcome.staged).toBe(0);
    expect(outcome.costUsd).toBe(0);
    expect(campaign.stagedCount).toBe(0);
    // The (empty) conversation is still recorded as having happened.
    expect(campaign.priorTranscripts('ojjul')).toHaveLength(1);
  });
});

describe('war is a property of the relationship, not one opinion', () => {
  const fresh = () => createSeedState('drajk');

  it('lists an aggressor even when only the victim hates them', () => {
    // The mechanical disposition costs — raiding, suborning, tolls,
    // pact-breaking — all move the INJURED party's view of the aggressor and
    // never the aggressor's view of them. Reading only "who hates me" meant
    // the victim of a raid did not count their raider as an enemy: a playtest
    // left Arkane at -62 toward Drajk while Drajk sat at -10 toward Arkane.
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['drajk'] = -62;
    state.factions.find((f) => f.id === 'drajk')!.disposition['freeworlds'] = -10;

    expect(warsFor(state, 'freeworlds')).toContain('drajk');
    expect(warsFor(state, 'drajk')).toContain('freeworlds');
  });

  it('stays quiet when neither side has soured past the threshold', () => {
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['drajk'] = -59;
    state.factions.find((f) => f.id === 'drajk')!.disposition['freeworlds'] = -59;
    expect(warsFor(state, 'freeworlds')).not.toContain('drajk');
    expect(warsFor(state, 'drajk')).not.toContain('freeworlds');
  });

  it('is still suppressed by a live pact, in both directions', () => {
    // Mutuality must not defeat the treaty check — a pact is exactly the thing
    // that says "we are not at war regardless of how we feel".
    const state = fresh();
    state.factions.find((f) => f.id === 'freeworlds')!.disposition['drajk'] = -90;
    state.treaties.push({
      id: 't1', type: 'non_aggression', parties: ['freeworlds', 'drajk'],
      terms: { territory: [], shipsPledged: {}, incomePerTurn: {}, payment: {}, incomeShares: [], mutualDefenseTrigger: '', voidsOn: [] },
      signedTurn: 0, expiresTurn: null, effectiveTurn: null, status: 'active', summary: 'na',
    });
    expect(warsFor(state, 'freeworlds')).not.toContain('drajk');
    expect(warsFor(state, 'drajk')).not.toContain('freeworlds');
  });
});

describe('agents cannot be given an effect that can never fire', () => {
  it('rejects crew_defection where guile can never beat resolve', () => {
    // Drajk guile 14 vs Arkane resolve 19 -> subornLimit 0. An agent placed
    // anyway is live, unexposed, rolls every turn, and can never turn a hull.
    const state = createSeedState('drajk');
    expect(subornLimit(state, 'drajk', 'freeworlds')).toBe(0);

    const res = applyOps(
      state,
      [
        {
          op: 'deploy_agent', ownerFactionId: 'drajk', systemId: 'ark-6',
          mission: 'theft', effect: { kind: 'crew_defection', perTurn: 1 },
          cover: 'labour broker',
        },
      ],
      'model',
      'drajk',
    );
    expect(res.rejections.map((r) => r.code)).toContain('illegal_value');
    expect(res.rejections[0]!.message).toMatch(/resolve is beyond its guile/);
    expect(res.state.agents).toHaveLength(0);
  });

  it('allows crew_defection where the contest is winnable', () => {
    // The Nars at guile 18 can suborn Meridian (resolve 9) comfortably.
    const state = createSeedState('ojjul');
    expect(subornLimit(state, 'ojjul', 'meridian')).toBeGreaterThan(0);
    const res = applyOps(
      state,
      [
        {
          op: 'deploy_agent', ownerFactionId: 'ojjul', systemId: 'sek-1',
          mission: 'theft', effect: { kind: 'crew_defection', perTurn: 1 },
          cover: 'dock factor',
        },
      ],
      'model',
      'ojjul',
    );
    expect(res.rejections).toHaveLength(0);
    expect(res.state.agents).toHaveLength(1);
  });

  it('leaves other effect kinds alone against a resolute target', () => {
    // Only crew_defection depends on subornLimit; sabotage against Arkane is
    // perfectly legitimate and must not be caught by the new guard.
    const res = applyOps(
      createSeedState('drajk'),
      [
        {
          op: 'deploy_agent', ownerFactionId: 'drajk', systemId: 'ark-6',
          mission: 'sabotage', effect: { kind: 'hull_damage', perTurn: 2 },
          cover: 'dock hand',
        },
      ],
      'model',
      'drajk',
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
          op: 'deploy_agent', ownerFactionId: 'vigil', systemId: 'tor-2',
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
          op: 'deploy_agent', ownerFactionId: 'meridian', systemId: 'tor-2',
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
          op: 'deploy_agent', ownerFactionId: 'vigil', systemId: 'tor-2',
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
      'Your message reached me above the Ilvenn line, and my answer is the one ' +
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
    parties: ['freeworlds', 'ojjul'],
    terms: { incomePerTurn: { freeworlds: -20, ojjul: 20 } },
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
    expect(treatiesFor(out.state, 'ojjul').map((t) => t.id)).not.toContain(treaty.id);
    expect(ledgerFor(out.state, 'ojjul').treatyFlow).toBe(0);
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
    expect(ledgerFor(second.state, 'ojjul').treatyFlow).toBe(20);
    expect(second.notes.join(' ')).toMatch(/Ratified/);
  });

  it('is live at once when nothing has to ratify it', () => {
    const out = applyOps(createSeedState('freeworlds'), [pact()], 'extraction', 'freeworlds');
    expect(out.state.treaties.at(-1)!.status).toBe('active');
    expect(ledgerFor(out.state, 'ojjul').treatyFlow).toBe(20);
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
    treatyType: 'cession' as const,
    parties,
    terms: { territory: [systemId] },
    summary: 'a negotiated withdrawal',
  });

  const sys = (s: WorldState, id: string) => s.systems.find((x) => x.id === id)!;

  it('transfers control, keeps the garrison, and withdraws the ceder’s ships', () => {
    const state = createSeedState('freeworlds');
    const before = sys(state, 'ark-6');
    const garrison = before.garrison;
    const ships = hullsAt(before, 'freeworlds');
    expect(ships).toBeGreaterThan(0);

    const out = applyOps(state, [cede('ark-6', ['freeworlds', 'ojjul'])], 'extraction', 'freeworlds');
    expect(out.rejections).toHaveLength(0);

    const after = sys(out.state, 'ark-6');
    expect(after.controllerFactionId).toBe('ojjul');
    // Nobody fought, so the garrison is handed over intact — the difference
    // between capitulation and conquest.
    expect(after.garrison).toBe(garrison);
    // And the ceder's fleet leaves rather than being captured or destroyed.
    expect(hullsAt(after, 'freeworlds')).toBe(0);
    const elsewhere = out.state.systems
      .filter((x) => x.id !== 'ark-6')
      .reduce((n, x) => n + (hullsAt(x, 'freeworlds')), 0);
    const originally = state.systems
      .filter((x) => x.id !== 'ark-6')
      .reduce((n, x) => n + (hullsAt(x, 'freeworlds')), 0);
    expect(elsewhere).toBe(originally + ships);
    expect(out.notes.join(' ')).toMatch(/withdraw to/);
  });

  it('cedes nothing it does not hold', () => {
    // tor-3 is the Vigil's, and the Vigil is not a party.
    const out = applyOps(
      createSeedState('freeworlds'),
      [cede('tor-3', ['freeworlds', 'ojjul'])],
      'extraction',
      'freeworlds',
    );
    expect(out.rejections).toHaveLength(0);
    expect(sys(out.state, 'tor-3').controllerFactionId).toBe('vigil');
  });

  it('waits for ratification when the treaty is pending', () => {
    const state = createSeedState('freeworlds');
    const out = applyOps(
      state,
      [{ ...cede('ark-6', ['freeworlds', 'ojjul']), ratifyTurns: 1 }],
      'extraction',
      'freeworlds',
    );
    // Still Free Worlds: the councils have not sat yet.
    expect(sys(out.state, 'ark-6').controllerFactionId).toBe('freeworlds');
    const ticked = tickTurn(out.state);
    expect(sys(ticked.state, 'ark-6').controllerFactionId).toBe('ojjul');
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
    parties: ['freeworlds', 'ojjul'],
    terms: { incomePerTurn: { freeworlds: 10, ojjul: -10 }, voidsOn: [condition] },
    summary: 'conditional accord',
  });

  const statusOf = (s: WorldState) => s.treaties.at(-1)!.status;

  it('fires when the constrained party signs with the named power', () => {
    const state = createSeedState('freeworlds');
    const signed = applyOps(
      state,
      [withCondition({ kind: 'treaty_with', by: 'ojjul', target: 'vigil' })],
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
          parties: ['ojjul', 'vigil'],
          terms: {},
          summary: 'the very thing that was forbidden',
        },
      ],
      'extraction',
      'ojjul',
    ).state;
    const ticked = tickTurn(betrayed);
    expect(ticked.state.treaties[ticked.state.treaties.length - 2]!.status).toBe('voided');
    expect(ticked.notes.join(' ')).toMatch(/Treaty voided/);
  });

  it('fires on insolvency, so a broke payer cannot quietly stop paying', () => {
    const state = createSeedState('freeworlds');
    const signed = applyOps(
      state,
      [withCondition({ kind: 'insolvent', by: 'ojjul' })],
      'extraction',
      'freeworlds',
    ).state;
    expect(statusOf(signed)).toBe('active');

    // Drive the Combine to a loss it cannot cover.
    for (const sys of signed.systems) {
      if (sys.controllerFactionId === 'ojjul') setShipsAt(sys, 'ojjul', 400);
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
          parties: ['freeworlds', 'ojjul'],
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
    setShipsAt(state.systems.find((x) => x.id === 'ark-1')!, 'vigil', 40);
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
    setShipsAt(invited.systems.find((x) => x.id === 'ark-1')!, 'vigil', 40);
    const before = dispositionToward(invited, 'freeworlds', 'vigil');

    const out = applyOps(invited, [accord], 'extraction', 'freeworlds');
    expect(dispositionToward(out.state, 'freeworlds', 'vigil')).toBe(before);
  });
});

/**
 * `openChannel` is set in exactly one place, reachable only from a player POST,
 * so for the whole life of the project **only one of the five powers could ever
 * start a conversation**. The game has a complete consent mechanism — persona,
 * transcript, extraction, treaty formation — and four of the powers it exists to
 * bind could not invoke it.
 *
 * An approach is an invitation, not a channel. It rides on the reaction, which
 * is already the NPC speaking at the one moment the player cannot act.
 */
describe('a faction can ask to talk', () => {
  it('is optional, so an ordinary reaction still parses', () => {
    const parsed = ReactionSchema.parse({
      factionId: 'ojjul',
      narrative: 'The Combine watches, and says nothing.',
      ops: [],
    });
    expect(parsed.approach).toBeUndefined();
  });

  it('carries an opening and a subject when a power wants something', () => {
    const parsed = ReactionSchema.parse({
      factionId: 'ojjul',
      narrative: 'The Combine counts the ships at Ilvenn.',
      ops: [],
      approach: {
        opening: 'Cousin — your hulls are very close to my lanes. Sit with me before this gets expensive.',
        about: 'transit through Ilvenn',
      },
    });
    expect(parsed.approach?.about).toBe('transit through Ilvenn');
  });

  it('survives the contract on the way to the browser, and defaults to null', () => {
    const view = ReactionViewSchema.parse({
      factionId: 'ojjul',
      factionName: 'Ojjul Nar Combine',
      color: 214,
      narrative: 'x',
    });
    expect(view.approach).toBeNull();
  });

  it('does not open a channel by itself — the player still has to', async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('freeworlds', 'approach');
    // Nothing an NPC says can put the player in a channel: that would disable
    // the command line and End Turn on a turn they did not choose to spend.
    expect(session.view().openChannel).toBeNull();
  });
});

/**
 * CONSENT IS A RECORDED POSITION, NOT AN INFERENCE.
 *
 * `extractAgreements` both read the transcript and asserted what was in it, and
 * nothing compared the two. A playtest moved three worlds — one the map's
 * greatest junction — off a conversation whose counterparty said *"Oridin, no —
 * garrison standing, no world changes hands"*, and two of the three were never
 * asked for at all.
 *
 * Adding another interpreter cannot close that: a checker shown the transcript
 * plus a plausible reading is handed the conclusion and asked to agree with it.
 * So the counterparty writes down what it concedes as it concedes it, and
 * `groundInConcessions` is the enforcement half — a matcher, not a judge.
 */
describe('an accord may only enact what was actually conceded', () => {
  const state = () => createSeedState('drajk');
  const theirWorld = () =>
    createSeedState('drajk').systems.find((x) => x.controllerFactionId === 'ojjul')!.id;
  const myWorld = () =>
    createSeedState('drajk').systems.find((x) => x.controllerFactionId === 'drajk')!.id;

  const cede = (systems: string[]) => ({
    op: 'form_treaty',
    treatyType: 'cession',
    parties: ['drajk', 'ojjul'],
    terms: { territory: systems },
    summary: 'worlds change hands',
  });

  const conceded = (over: Partial<Concession> = {}): Concession => ({
    by: 'ojjul',
    kind: 'cede_worlds',
    text: 'It passes to the Confederacy.',
    systems: [],
    credits: 0,
    perTurn: 0,
    hulls: 0,
    ...over,
  });

  it('drops a world the other power never put on the table', () => {
    const out = groundInConcessions(state(), [cede([theirWorld()])], [], 'ojjul');
    expect(out.ops).toHaveLength(0);
    expect(out.dropped[0]).toContain(theirWorld());
  });

  it('keeps the world it did', () => {
    const out = groundInConcessions(
      state(),
      [cede([theirWorld()])],
      [conceded({ systems: [theirWorld()] })],
      'ojjul',
    );
    expect(out.ops).toHaveLength(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('drops the world that was not named even when another was', () => {
    // The measured shape: one world discussed, three transferred.
    const extra = createSeedState('drajk').systems.filter(
      (x) => x.controllerFactionId === 'ojjul',
    );
    const out = groundInConcessions(
      state(),
      [cede([extra[0]!.id, extra[1]!.id])],
      [conceded({ systems: [extra[0]!.id] })],
      'ojjul',
    );
    expect(out.ops).toHaveLength(0);
    expect(out.dropped[0]).toContain(extra[1]!.id);
  });

  it('never grounds what the ACTOR gives away', () => {
    // Nobody needs protecting from a power binding itself, and requiring a
    // record here would turn every one-sided concession into a dead promise —
    // the exact bug class this exists to end.
    const out = groundInConcessions(state(), [cede([myWorld()])], [], 'ojjul');
    expect(out.ops).toHaveLength(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('drops money the other power never offered, and keeps what it did', () => {
    const pay = (n: number) => ({
      op: 'form_treaty',
      treatyType: 'tribute',
      parties: ['drajk', 'ojjul'],
      terms: { payment: { ojjul: -n, drajk: n } },
      summary: 'a settlement',
    });
    expect(groundInConcessions(state(), [pay(800)], [], 'ojjul').ops).toHaveLength(0);
    expect(
      groundInConcessions(state(), [pay(800)], [conceded({ credits: 800 })], 'ojjul').ops,
    ).toHaveLength(1);
    // Offered less than was written down.
    expect(
      groundInConcessions(state(), [pay(800)], [conceded({ credits: 100 })], 'ojjul').ops,
    ).toHaveLength(0);
  });

  it('will not put a power in debt it never agreed to owe', () => {
    const debt = {
      op: 'establish_debt',
      creditorFactionId: 'drajk',
      debtorFactionId: 'ojjul',
      principal: 500,
      perTurn: 50,
      text: 'paper',
    };
    expect(groundInConcessions(state(), [debt], [], 'ojjul').ops).toHaveLength(0);
    // Coarse on purpose for the free-form terms: having conceded ANYTHING is
    // enough, because the arrangement vocabulary is deliberately open and the
    // damage there is bounded.
    expect(groundInConcessions(state(), [debt], [conceded()], 'ojjul').ops).toHaveLength(1);
  });

  it('ignores a concession written on someone else’s behalf', () => {
    const out = groundInConcessions(
      state(),
      [cede([theirWorld()])],
      [conceded({ by: 'meridian', systems: [theirWorld()] })],
      'ojjul',
    );
    expect(out.ops).toHaveLength(0);
  });
});

/**
 * THE CONCESSION LEDGER IS A POSITION, NOT A HISTORY OF POSITIONS.
 *
 * It appended, so it accumulated: a playtest ended with one 10/turn hire
 * recorded four times under four slugs, one recorded backwards, and terms both
 * parties had struck still live — because the retraction's `kind` matched none
 * of the three entries it meant to remove. Extraction deduped it correctly and
 * nothing broke that time, but extraction is documented as a MATCHER against
 * this list.
 */
describe('the concession ledger', () => {
  const c = (over: Partial<Concession> = {}): Concession => ({
    by: 'ojjul', kind: 'hire_hulls', text: 'Twelve hulls at ten a turn.',
    systems: [], credits: 0, perTurn: 10, hulls: 12, ...over,
  });

  it('supersedes a restated term instead of recording it twice', () => {
    const out = mergeConcessions([c()], [c({ perTurn: 14 })], []);
    expect(out).toHaveLength(1);
    expect(out[0]!.perTurn).toBe(14);
  });

  it('keeps two genuinely different terms from the same power', () => {
    const out = mergeConcessions([c()], [c({ kind: 'lane_toll_lifted', perTurn: 0 })], []);
    expect(out).toHaveLength(2);
  });

  it('removes what a retraction strikes', () => {
    const out = mergeConcessions([c()], [], [{ by: 'ojjul', kind: 'hire_hulls', why: 'A clerk.' }]);
    expect(out).toHaveLength(0);
  });

  it('strikes a term whose slug the persona typed differently', () => {
    // The measured case: a retraction of `kest_vantic` against three live
    // entries including `mutual_defense_kest`. An exact-key removal misses, and
    // a struck term surviving is how it ends up binding somebody.
    const held = [
      c({ kind: 'mutual_defense_kest' }),
      c({ kind: 'reciprocal_kest_vantic' }),
      c({ kind: 'hire_hulls' }),
    ];
    const out = mergeConcessions(held, [], [{ by: 'ojjul', kind: 'kest_vantic', why: 'Never on the table.' }]);
    expect(out.map((x) => x.kind)).toEqual(['hire_hulls']);
  });

  it('never lets a retraction reach another power’s concessions', () => {
    const held = [c({ by: 'meridian', kind: 'kest_pact' })];
    const out = mergeConcessions(held, [], [{ by: 'ojjul', kind: 'kest_pact', why: 'Not mine to strike.' }]);
    expect(out).toHaveLength(1);
  });

  it('applies a retraction before the concessions in the same message', () => {
    // Strike and re-offer in one breath: the amended term survives.
    const out = mergeConcessions(
      [c({ perTurn: 10 })],
      [c({ perTurn: 6 })],
      [{ by: 'ojjul', kind: 'hire_hulls', why: 'My clerk wrote the old rate.' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.perTurn).toBe(6);
  });
});

/**
 * Both powers in the room, and nobody else.
 *
 * This filtered to the speaker alone, so the player's concessions were stripped
 * before anything could appraise them — the per-message red-line pass had
 * nothing to look at, and `channelBlockers` was `[]` across four channels and
 * three deliberate, self-announced crossings. The mechanism did not fail; it
 * never ran.
 */
describe('whose concessions a reply may carry', () => {
  const e = (by: string) => ({ by, kind: 'k', text: 't' });

  it('keeps the speaker’s own', () => {
    expect(atThisTable([e('ojjul')], 'ojjul', 'drajk').map((x) => x.by)).toEqual(['ojjul']);
  });

  it('keeps its reading of what the player offered', () => {
    // Without this the red-line appraisal has nothing to appraise.
    expect(atThisTable([e('drajk')], 'ojjul', 'drajk').map((x) => x.by)).toEqual(['drajk']);
  });

  it('drops a power that is not in the room', () => {
    expect(atThisTable([e('vigil')], 'ojjul', 'drajk')).toEqual([]);
  });
});

/**
 * ASSETS — things that are neither credits nor ships.
 *
 * A creative playtest reached for prisoners, a fostered heir, a seal in escrow,
 * a hundred tons of rare material, a chart that was false, and intelligence
 * held exclusively. The world had nowhere to put any of them: an accord would
 * record "fifty crews at forty a head" and the game could not count one crew.
 */
describe('assets', () => {
  const seedState = () => createSeedState('ojjul');
  const make = (over: Record<string, unknown> = {}) => ({
    op: 'create_asset', kind: 'prisoners', heldBy: 'ojjul',
    text: 'Vigil crews taken off Vantic.', quantity: 40, unit: 'crew',
    valuePerUnit: { vigil: 12 }, ...over,
  });
  const held = (s: WorldState, id = 'ojjul') => s.assets.filter((a) => a.heldBy === id);

  it('is created by an action, and only for the actor', () => {
    const ok = applyOps(seedState(), [make()], 'model', 'ojjul');
    expect(ok.rejections).toEqual([]);
    expect(held(ok.state)[0]!.quantity).toBe(40);

    // You cannot survey ore into somebody else's warehouse.
    const other = applyOps(seedState(), [make({ heldBy: 'vigil' })], 'model', 'ojjul');
    expect(other.rejections[0]?.code).toBe('illegal_value');
  });

  it('cannot be conjured in a conversation', () => {
    // An accord trades what exists; it does not bring things into being.
    const out = applyOps(seedState(), [make()], 'extraction', 'ojjul');
    expect(out.rejections[0]?.code).toBe('declared_only');
    expect(out.state.assets).toHaveLength(0);
  });

  it('makes one exception, and it is paper', () => {
    // A dossier is the paper, not the knowledge. Nothing is conjured: the
    // seller already had what is in it, for free, and could have said it in the
    // channel — what the deal makes is the record. See `DOSSIER_KIND`.
    const dossier = (over: Record<string, unknown> = {}) =>
      make({
        kind: 'dossier', unit: 'dossier', quantity: 1,
        text: "The Combine's file on the Vantic keel-yards, sealed.",
        valuePerUnit: { drajk: 260 }, ...over,
      });
    const out = applyOps(seedState(), [dossier()], 'extraction', 'ojjul');
    expect(out.rejections).toEqual([]);
    const file = out.state.assets[0]!;
    // Atomic and placeless, both FORCED — that is what keeps it simple: no half
    // a file, so no question about how value divides, so no decay and no
    // lineage. And a record of a conversation is not standing on a world to be
    // seized with it.
    expect(file.divisible).toBe(false);
    expect(file.atSystemId).toBeNull();
    expect(file.yield).toBeNull();
    expect(assetWorthTo(file, 'drajk')).toBe(260);

    const forced = applyOps(
      seedState(),
      [dossier({ divisible: true, atSystemId: 'ilv-2', yield: { kind: 'credits', perTurn: 20 } })],
      'extraction',
      'ojjul',
    );
    expect(forced.rejections).toEqual([]);
    expect(forced.state.assets[0]!.divisible).toBe(false);
    expect(forced.state.assets[0]!.atSystemId).toBeNull();
    expect(forced.state.assets[0]!.yield).toBeNull();

    // The other power may be the one holding it: across a table it said so in
    // its own voice, which is the whole reason extraction exists.
    const theirs = applyOps(seedState(), [dossier({ heldBy: 'drajk' })], 'extraction', 'ojjul');
    expect(theirs.rejections).toEqual([]);
    expect(theirs.state.assets[0]!.heldBy).toBe('drajk');

    // And it is still the only exception: ore is a thing to go and get.
    const ore = applyOps(seedState(), [make({ kind: 'ore' })], 'extraction', 'ojjul');
    expect(ore.rejections[0]?.code).toBe('declared_only');

    // On the DECLARED path nothing changes: you still cannot put a file into
    // somebody else's hands by saying so.
    const declared = applyOps(seedState(), [dossier({ heldBy: 'drajk' })], 'model', 'ojjul');
    expect(declared.rejections[0]?.code).toBe('illegal_value');
  });

  it('is worth different things to different powers, and that is the point', () => {
    const s = applyOps(seedState(), [make()], 'model', 'ojjul').state;
    const a = s.assets[0]!;
    // Prisoners are worth a great deal to whoever lost them and nothing to
    // anybody else. Asymmetric valuation is the whole of gains-from-trade.
    expect(assetWorthTo(a, 'vigil')).toBe(480);
    expect(assetWorthTo(a, 'meridian')).toBe(0);
  });

  it('splits without inventing or destroying worth', () => {
    const s = applyOps(seedState(), [make()], 'model', 'ojjul').state;
    const before = assetWorthTo(s.assets[0]!, 'vigil');
    const out = applyOps(s, [{ op: 'split_asset', assetId: s.assets[0]!.id, quantity: 15 }], 'model', 'ojjul');
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.map((a) => a.quantity).sort((x, y) => x - y)).toEqual([15, 25]);
    // Value is per UNIT, so the two lots are worth exactly what the one was.
    const after = out.state.assets.reduce((n, a) => n + assetWorthTo(a, 'vigil'), 0);
    expect(after).toBe(before);
  });

  it('refuses to halve a thing that is one thing', () => {
    const s = applyOps(
      seedState(),
      [make({ kind: 'heirloom', text: 'The Ojjul seal.', quantity: 1, unit: 'seal', divisible: false })],
      'model',
      'ojjul',
    ).state;
    const out = applyOps(s, [{ op: 'split_asset', assetId: s.assets[0]!.id, quantity: 1 }], 'model', 'ojjul');
    expect(out.rejections[0]?.code).toBe('illegal_value');
  });

  it('can be given away freely and never taken by declaration', () => {
    const s = applyOps(seedState(), [make()], 'model', 'ojjul').state;
    const id = s.assets[0]!.id;

    const gift = applyOps(s, [{ op: 'transfer_asset', assetId: id, toFactionId: 'drajk' }], 'model', 'ojjul');
    expect(gift.rejections).toEqual([]);
    expect(gift.state.assets[0]!.heldBy).toBe('drajk');

    // Taking somebody else's needs them at the table.
    const grab = applyOps(gift.state, [{ op: 'transfer_asset', assetId: id, toFactionId: 'ojjul' }], 'model', 'ojjul');
    expect(grab.rejections[0]?.code).toBe('needs_consent');
    const agreed = applyOps(gift.state, [{ op: 'transfer_asset', assetId: id, toFactionId: 'ojjul' }], 'extraction', 'ojjul');
    expect(agreed.rejections).toEqual([]);
  });

  it('changes hands with the world it sits on', () => {
    const world = seedState().systems.find((x) => x.controllerFactionId === 'ojjul')!;
    const s = applyOps(seedState(), [make({ atSystemId: world.id })], 'model', 'ojjul').state;
    const out = applyOps(
      s,
      [{ op: 'transfer_control', systemId: world.id, toFactionId: 'vigil', reason: 'stormed' }],
      'engine',
    );
    // Hold the world, hold the prisoners — which is the difference between a
    // hostage and a note saying somebody has a hostage.
    expect(out.state.assets[0]!.heldBy).toBe('vigil');
  });

  it('is stripped from a failed attempt and halved on a partial', () => {
    expect(boundPayloadsToOutcome([make()], 'failure').ops).toHaveLength(0);
    const part = boundPayloadsToOutcome([make()], 'partial');
    expect((part.ops[0] as { quantity: number }).quantity).toBe(20);
    expect(boundPayloadsToOutcome([make()], 'success').ops).toHaveLength(1);
  });

  it('voids a treaty written against holding it', () => {
    // What makes a hostage a hostage.
    let s = applyOps(seedState(), [make({ kind: 'hostage', quantity: 1, unit: 'heir', divisible: false })], 'model', 'ojjul').state;
    const assetId = s.assets[0]!.id;
    s = applyOps(
      s,
      [{
        op: 'form_treaty', treatyType: 'non_aggression', parties: ['ojjul', 'vigil'],
        summary: 'peace while the heir is held',
        terms: { voidsOn: [{ kind: 'asset_lost', by: 'ojjul', target: assetId }] },
      }],
      'extraction',
      'ojjul',
    ).state;
    expect(tickTurn(s).state.treaties[0]!.status).toBe('active');

    const released = applyOps(s, [{ op: 'transfer_asset', assetId, toFactionId: 'vigil' }], 'model', 'ojjul').state;
    expect(tickTurn(released).state.treaties[0]!.status).toBe('voided');
  });
});

/**
 * Fixtures and yields — the extension that lets an asset be a *place* rather
 * than only a thing in a hold.
 *
 * The class started as cargo: prisoners, ore, an heirloom. Everything it could
 * describe was something you carried. But the objects a campaign reaches for
 * are as often improvements — a mine, an exchange, a theatre — and those differ
 * on exactly two axes: they cannot leave the world, and they *do* something
 * every turn.
 */
describe('assets that stand on a world', () => {
  const seedState = () => createSeedState('ojjul');
  const home = (s: WorldState) => s.systems.find((x) => x.controllerFactionId === 'ojjul')!;
  const mine = (over: Record<string, unknown> = {}) => ({
    op: 'create_asset', kind: 'mine', heldBy: 'ojjul',
    text: 'The Halland cut.', quantity: 1, unit: 'works', divisible: false,
    valuePerUnit: {}, ...over,
  });

  it('a fixture cannot be handed over, and changes hands with the ground', () => {
    const s0 = seedState();
    const world = home(s0);
    const s = applyOps(s0, [mine({ atSystemId: world.id, portable: false })], 'model', 'ojjul').state;
    const id = s.assets[0]!.id;

    // Not on its own, in either direction — this is the whole content of
    // `portable`, and the message has to name the instrument that does work.
    const gift = applyOps(s, [{ op: 'transfer_asset', assetId: id, toFactionId: 'drajk' }], 'model', 'ojjul');
    expect(gift.rejections[0]?.code).toBe('illegal_value');
    const sold = applyOps(s, [{ op: 'transfer_asset', assetId: id, toFactionId: 'drajk' }], 'extraction', 'ojjul');
    expect(sold.rejections[0]?.code).toBe('illegal_value');

    // And with the ground, for free, because that path already moves
    // everything standing on a world.
    const taken = applyOps(
      s,
      [{ op: 'transfer_control', systemId: world.id, toFactionId: 'vigil', reason: 'stormed' }],
      'engine',
    );
    expect(taken.state.assets[0]!.heldBy).toBe('vigil');
  });

  it('refuses a fixture or a producer with nowhere to stand', () => {
    const fixture = applyOps(seedState(), [mine({ portable: false })], 'model', 'ojjul');
    expect(fixture.rejections[0]?.code).toBe('illegal_value');

    // A yield with no world would be an income stream nobody can raid,
    // blockade or conquer — the one shape this economy has always refused.
    const floating = applyOps(
      seedState(),
      [mine({ yield: { kind: 'credits', perTurn: 10 } })],
      'model',
      'ojjul',
    );
    expect(floating.rejections[0]?.code).toBe('illegal_value');
  });

  it('cannot be built on a world you have never reached', () => {
    const s = seedState();
    const theirs = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
    expect(hullsAt(theirs, 'ojjul')).toBe(0);
    const out = applyOps(
      s,
      [mine({ atSystemId: theirs.id, portable: false, yield: { kind: 'credits', perTurn: 10 } })],
      'model',
      'ojjul',
    );
    expect(out.rejections[0]?.code).toBe('no_presence');
  });

  it('pays into the ledger, and stops paying when the ground is lost', () => {
    const s0 = seedState();
    const world = home(s0);
    const before = ledgerFor(s0, 'ojjul').net;
    const s = applyOps(
      s0,
      [mine({ kind: 'exchange', text: 'The Shalka exchange.', atSystemId: world.id, portable: false, yield: { kind: 'credits', perTurn: 14 } })],
      'model',
      'ojjul',
    ).state;
    expect(ledgerFor(s, 'ojjul').assetYield).toBe(14);
    expect(ledgerFor(s, 'ojjul').net).toBe(before + 14);

    // Taking the ground takes the exchange with it, so the figure moves to
    // whoever holds the world — which is what makes it a target rather than an
    // annuity.
    const lost = applyOps(
      s,
      [{ op: 'transfer_control', systemId: world.id, toFactionId: 'vigil', reason: 'stormed' }],
      'engine',
    ).state;
    expect(ledgerFor(lost, 'ojjul').assetYield).toBe(0);
    expect(ledgerFor(lost, 'vigil').assetYield).toBe(14);
  });

  it('trims what it pays, and clamps what it does to institutions', () => {
    const s0 = seedState();
    const world = home(s0);
    const rich = applyOps(
      s0,
      [mine({ atSystemId: world.id, portable: false, yield: { kind: 'credits', perTurn: 300 } })],
      'model',
      'ojjul',
    );
    expect(rich.rejections).toEqual([]);
    expect(ledgerFor(rich.state, 'ojjul').assetYield).toBe(25);

    // A theatre may double the natural repair rate and may not outrun it. One
    // refusal costs 8 and a compulsion breach 15, so nothing built out of
    // assets buys a leader out of governing badly.
    const theatre = applyOps(
      s0,
      [mine({ kind: 'theatre', text: 'The Shalka amphitheatre.', atSystemId: world.id, portable: false, yield: { kind: 'dissent', perTurn: -9 } })],
      'model',
      'ojjul',
    ).state;
    expect(theatre.assets[0]!.yield).toEqual({ kind: 'dissent', perTurn: -2 });
  });

  it('settles a population on the tick, on top of the natural decay', () => {
    const s0 = seedState();
    const world = home(s0);
    let s = applyOps(
      s0,
      [mine({ kind: 'theatre', text: 'The Shalka amphitheatre.', atSystemId: world.id, portable: false, yield: { kind: 'dissent', perTurn: -2 } })],
      'model',
      'ojjul',
    ).state;
    s = applyOps(s, [{ op: 'adjust_dissent', factionId: 'ojjul', delta: 40 }], 'model', 'ojjul').state;
    const before = s.factions.find((f) => f.id === 'ojjul')!.dissent;
    const after = tickTurn(s).state.factions.find((f) => f.id === 'ojjul')!.dissent;
    // DISSENT_DECAY (2) and the theatre (2). Mutated rather than read where it
    // is used, because dissent accumulates on its own clock.
    expect(after).toBe(before - 4);
  });

  it('produces into one growing stockpile rather than a row a turn', () => {
    const s0 = seedState();
    const world = home(s0);
    let s = applyOps(
      s0,
      [mine({
        atSystemId: world.id, portable: false,
        yield: { kind: 'asset', perTurn: 20, assetKind: 'ore', unit: 'ton', text: 'Ore off the Halland cut.', valuePerUnit: { meridian: 4 } },
      })],
      'model',
      'ojjul',
    ).state;
    s = tickTurn(s).state;
    s = tickTurn(s).state;
    s = tickTurn(s).state;

    const ore = s.assets.filter((a) => a.kind === 'ore');
    expect(ore).toHaveLength(1);
    expect(ore[0]!.quantity).toBe(60);
    // What a mine makes can be shipped even though the mine cannot.
    expect(ore[0]!.portable).toBe(true);
    expect(ore[0]!.yield).toBeNull();
    expect(assetWorthTo(ore[0]!, 'meridian')).toBe(240);
  });

  it('stands idle when nobody is there to work it', () => {
    const s0 = seedState();
    // A portable producer left behind on ground its owner does not hold: the
    // case that would otherwise pay forever to a power with nothing there.
    const theirs = s0.systems.find((x) => x.controllerFactionId === 'vigil')!;
    setShipsAt(theirs, 'ojjul', 2);
    let s = applyOps(
      s0,
      [mine({
        kind: 'surveyors', text: 'Survey robots on the Vantic slopes.', atSystemId: theirs.id,
        yield: { kind: 'asset', perTurn: 5, assetKind: 'ore', unit: 'ton', text: 'Ore off the Vantic slopes.', valuePerUnit: {} },
      })],
      'model',
      'ojjul',
    ).state;
    expect(tickTurn(s).state.assets.filter((a) => a.kind === 'ore')).toHaveLength(1);

    setShipsAt(s.systems.find((x) => x.id === theirs.id)!, 'ojjul', 0);
    const idle = tickTurn(s);
    expect(idle.state.assets.filter((a) => a.kind === 'ore')).toHaveLength(0);
    expect(idle.notes.some((n) => n.includes('stands idle'))).toBe(true);
  });

  it('does not come apart into two of itself', () => {
    const s0 = seedState();
    const world = home(s0);
    const s = applyOps(
      s0,
      [mine({ quantity: 4, unit: 'shaft', divisible: true, atSystemId: world.id, portable: false, yield: { kind: 'credits', perTurn: 10 } })],
      'model',
      'ojjul',
    ).state;
    // Splitting a producer would double what it produces for nothing. A going
    // concern is one thing whatever its `quantity` says.
    const out = applyOps(s, [{ op: 'split_asset', assetId: s.assets[0]!.id, quantity: 2 }], 'model', 'ojjul');
    expect(out.rejections[0]?.code).toBe('illegal_value');
  });

  it('cannot be pledged as collateral, because it cannot be handed over', () => {
    const s0 = seedState();
    const world = home(s0);
    const s = applyOps(s0, [mine({ atSystemId: world.id, portable: false })], 'model', 'ojjul').state;
    const out = applyOps(
      s,
      [{
        op: 'establish_commitment', kind: 'underwriting', factionIds: ['ojjul', 'drajk'],
        text: 'The Combine stands behind the Halland works.',
        contingencies: [{
          trigger: { kind: 'world_lost', by: 'drajk', target: world.id },
          from: 'ojjul', to: 'drajk', credits: 0, assetId: s.assets[0]!.id,
          text: 'the cut is surrendered',
        }],
      }],
      'extraction',
      'ojjul',
    );
    expect(out.rejections).toEqual([]);
    expect(out.state.commitments[0]!.contingencies).toEqual([]);
    expect(out.notes.some((n) => n.includes('cannot be pledged'))).toBe(true);
  });
});
