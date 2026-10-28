import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AdvisorReplySchema, looksLikeAList } from '../src/model/calls.js';
import { AdvisorOutcomeSchema, ROUTES } from '../src/api/contract.js';
import { createSeedState, playableFactions } from '../src/seed/scenario.js';
import { WorldStateSchema } from '../src/domain/state.js';
import { GameSession } from '../src/server/session.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { dispatch } from '../src/server/router.js';
import { ACTION_POINTS_PER_TURN } from '../src/engine/campaign.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const prompt = () => readFileSync(join(HERE, '..', 'prompts', 'advisor.md'), 'utf8');

/**
 * The advisor: a counsellor at the leader's shoulder, priced like an action.
 *
 * Two things carry the whole design and both are testable without a model
 * call — that it costs an action point, and that it cannot become a solver.
 * The third, that it sounds like its own power, is a prompt rule, so what is
 * pinned here is that the material a voice needs actually reaches the call.
 */
describe('the advisor', () => {
  const started = async () => {
    const session = new GameSession(new MemoryCampaignStore());
    await session.newCampaign('ojjul', 'advisor-test');
    return session;
  };

  describe('every power addresses its leader by its own title', () => {
    it('gives all five a distinct one', () => {
      const titles = playableFactions().map(({ id }) => {
        const state = createSeedState(id);
        return state.factions.find((f) => f.id === id)!.title;
      });
      // The title does more work than any amount of description: it tells the
      // player in three syllables which power they are running. Five powers
      // sharing one would undo that in a word.
      expect(new Set(titles).size).toBe(5);
      for (const t of titles) expect(t.length).toBeGreaterThan(0);
    });

    it('names them as specified, and on the faction rather than in a lookup', () => {
      const state = createSeedState('ojjul');
      const by = (id: string) => state.factions.find((f) => f.id === id)!.title;
      expect(by('freeworlds')).toBe('Highwarden');
      expect(by('meridian')).toBe('Chief Executive');
      expect(by('vigil')).toBe('Grand Admiral');
      expect(by('drajk')).toBe('Huntmaster');
      expect(by('ojjul')).toBe('First Elder');
    });

    it('loads a campaign saved before titles existed', () => {
      // Defaulted rather than required, so an old journal reads as the neutral
      // form instead of failing to parse — the same bargain every field added
      // to `WorldState` after the first campaign has had to make.
      const stripped = JSON.parse(JSON.stringify(createSeedState('ojjul')));
      for (const f of stripped.factions) delete f.title;
      const reparsed = WorldStateSchema.parse(stripped);
      expect(reparsed.factions.every((f) => f.title === 'Commander')).toBe(true);
    });
  });

  describe('it speaks in prose, and may say how', () => {
    /**
     * Counsel is spoken, so a list is refused by its shape. A sequence said in
     * prose is a direct answer to "how", which the counsellor is asked to give
     * from 2026-10-27 (it was refused before, and read as obtuse).
     */
    it('rejects a counsel laid out as a list', () => {
      const lists = [
        'Highwarden.\n- Take Sennex.\n- Then raise the garrison at Delvane.',
        'Highwarden:\n1. Move the fleet.\n2. Close the lane.\n3. Wait.',
        'Highwarden.\n* Sennex is undefended.\n* Vashka is thin.',
      ];
      for (const p of lists) {
        expect(looksLikeAList(p), p).toBe(true);
        expect(AdvisorReplySchema.safeParse({ counsel: p }).success, p).toBe(false);
      }
    });

    it('accepts a sequence said in prose', () => {
      const how = 'Send the 2nd Wardfleet to Sennex without landing; once it holds the orbit, land, and its garrison of three will not stand.';
      expect(AdvisorReplySchema.safeParse({ counsel: how }).success).toBe(true);
      expect(AdvisorReplySchema.safeParse({ counsel: 'First, take Sennex. Second, close the Ilvenn lane. Third, wait them out.' }).success).toBe(true);
    });



    it('accepts counsel that names pressures in prose', () => {
      const counsel = [
        'Highwarden, Vashka is held by eleven and the Vigil has forty within two jumps of it. ' +
          'That is the whole of my concern this season. The Combine has also stopped answering our couriers, ' +
          'which they do when they have decided something and have not yet said it.',
        'First Elder — Drajk owes us four hundred and eighty and has stopped paying, and the family notices.',
      ];
      for (const c of counsel) {
        expect(looksLikeAList(c), c).toBe(false);
        expect(AdvisorReplySchema.safeParse({ counsel: c }).success, c).toBe(true);
      }
    });



    it('does not read a single dash or a lone "first" as a list', () => {
      // One marker is a stray dash mid-sentence, not an enumeration. Firing on
      // it would reject ordinary speech and cost a retry every time.
      expect(looksLikeAList('Highwarden — Vashka is thin, and that is all.')).toBe(false);
      expect(looksLikeAList('First, the obvious thing: Vashka is thin.')).toBe(false);
    });

    it('has one field, the counsel itself', () => {
      expect(Object.keys(AdvisorReplySchema.shape)).toEqual(['counsel']);
    });

  });

  describe('it costs an action, which is the design', () => {
    it('spends one of the two', async () => {
      const session = await started();
      const before = session.view().actionPoints.left;
      expect(before).toBe(ACTION_POINTS_PER_TURN);
      // The call itself needs the network, which the suite forbids — what is
      // pinned here is that the route exists and is priced, not what it says.
      const res = await dispatch(session, 'POST', ROUTES.advisor, {});
      expect(res.status).toBeGreaterThanOrEqual(400);
      // And that a failed call does NOT charge: the point is spent after the
      // counsel arrives, not before it is asked for.
      expect(session.view().actionPoints.left).toBe(before);
    });

    it('is free to discover that the turn is spent', async () => {
      const session = await started();
      const campaign = (session as unknown as { campaign: { spendActionPoint(): void } }).campaign;
      for (let i = 0; i < ACTION_POINTS_PER_TURN; i++) campaign.spendActionPoint();

      const res = await dispatch(session, 'POST', ROUTES.advisor, {});
      expect(res.status).toBe(200);
      const body = AdvisorOutcomeSchema.parse(res.body);
      // No model call, no charge, and the counsellor says so in character
      // rather than the interface saying it.
      expect(body.outOfActions).toEqual({ perTurn: ACTION_POINTS_PER_TURN });
      expect(body.costUsd).toBe(0);
      expect(body.counsel).toContain('First Elder');
    });

    it('is blocked while a channel is open, exactly as an action is', async () => {
      const session = await started();
      (session as unknown as { openChannel: string | null }).openChannel = 'drajk';
      const res = await dispatch(session, 'POST', ROUTES.advisor, {});
      // The board the counsellor would read is not the board that will exist
      // once the accord lands.
      expect(res.status).toBe(409);
    });
  });

  describe('the prompt says the things the design rests on', () => {
    it('asks for a direct answer first, and forbids the fourth wall', () => {
      const text = prompt();
      expect(text).toMatch(/Help directly/);
      expect(text).toMatch(/the answer comes in your first\s+sentence/i);
      // A counsellor who mentions action points has stopped being inside the
      // fiction, which is the whole register the call is written for.
      expect(text).toMatch(/action points|fourth wall/i);
    });

    it('holds the counsel to a power’s own sheet', () => {
      // Five powers given the identical board should be worried about five
      // different things; that is what makes an advisor worth having rather
      // than a generic optimizer.
      expect(prompt()).toMatch(/red lines and its\s+compulsions/i);
      expect(prompt()).toMatch(/Check every act you recommend against them/);
      expect(prompt()).toMatch(/nearest thing that does not/);
    });
  });
});

describe('the advisor stays inside the fiction', () => {
  it('rejects the game’s own terms, and keeps ordinary speech', async () => {
    const { breaksTheFourthWall } = await import('../src/model/calls.js');
    expect(breaksTheFourthWall('She was taken on Vantic — that was turn five.')).toBe(true);
    expect(breaksTheFourthWall('You have one action point left.')).toBe(true);
    expect(breaksTheFourthWall('It is a DC 16 affair.')).toBe(true);
    expect(breaksTheFourthWall('She was taken on Vantic last month, and it will not be easy to get her back.')).toBe(false);
    expect(breaksTheFourthWall('The tide will turn on Vantic.')).toBe(false);
  });
});

describe('organising said in words', () => {
  it('is only organising when nothing else is in it', async () => {
    const { onlyOrganising } = await import('../src/domain/refusals.js');
    expect(onlyOrganising([{ op: 'log_narrative' }, { op: 'merge_fleets' }])).toBe(true);
    expect(onlyOrganising([{ op: 'split_fleet' }, { op: 'move' }])).toBe(false);
    expect(onlyOrganising([{ op: 'log_narrative' }])).toBe(false);
  });
});
