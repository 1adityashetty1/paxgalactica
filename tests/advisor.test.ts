import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AdvisorReplySchema, looksLikeAPlan } from '../src/model/calls.js';
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

  describe('it must not become a solver', () => {
    /**
     * The one rule a prompt cannot be trusted with. A solver announces itself
     * structurally — it enumerates — so the check is a shape check rather than
     * a second model asked whether the first was too prescriptive.
     */
    it('rejects a counsel shaped like a plan', () => {
      const plans = [
        'Highwarden.\n- Take Sennex.\n- Then raise the garrison at Delvane.',
        'Highwarden:\n1. Move the fleet.\n2. Close the lane.\n3. Wait.',
        'First, take Sennex. Second, close the Ilvenn lane. Third, wait them out.',
        'Highwarden.\n* Sennex is undefended.\n* Vashka is thin.',
      ];
      for (const p of plans) {
        expect(looksLikeAPlan(p), p).toBe(true);
        expect(AdvisorReplySchema.safeParse({ counsel: p }).success, p).toBe(false);
      }
    });

    it('accepts counsel that names pressures in prose', () => {
      const counsel = [
        'Highwarden, Vashka is held by eleven and the Vigil has forty within two jumps of it. ' +
          'That is the whole of my concern this season. The Combine has also stopped answering our couriers, ' +
          'which they do when they have decided something and have not yet said it.',
        'First Elder — Drajk owes us four hundred and eighty and has stopped paying, and the family notices.',
      ];
      for (const c of counsel) {
        expect(looksLikeAPlan(c), c).toBe(false);
        expect(AdvisorReplySchema.safeParse({ counsel: c }).success, c).toBe(true);
      }
    });

    it('rejects an enumeration spread over whole paragraphs', () => {
      // The shape that escaped in the playtest of 2026-09-09. Three headings in
      // one unbroken paragraph, several sentences under each: the line branch
      // saw no line beginning with a marker because there are no line breaks,
      // and the prose branch allowed exactly one full stop between markers.
      const counsel =
        'Three things, Chief Executive, and then I will stop. First — Shalka. We are holding ' +
        'it with four battleships that are not ours. That is an exposure sitting on contested ' +
        'ground. Second, the Combine ledger generally — two facilities running against us. ' +
        'None of it is unprofitable on its own. Third — the Drajk. We are at daggers drawn ' +
        'with them, and none of it costs us today.';
      expect(looksLikeAPlan(counsel)).toBe(true);
      expect(AdvisorReplySchema.safeParse({ counsel }).success).toBe(false);
    });

    it('does not read a single dash or a lone "first" as a plan', () => {
      // One marker is a stray dash mid-sentence, not an enumeration. Firing on
      // it would reject ordinary speech and cost a retry every time.
      expect(looksLikeAPlan('Highwarden — Vashka is thin, and that is all.')).toBe(false);
      expect(looksLikeAPlan('First, the obvious thing: Vashka is thin.')).toBe(false);
    });

    it('has no field to put a plan in', () => {
      // One field and no second one. A `pressures: []` beside the prose would
      // render as a checklist however it was worded, which is a queue of
      // instructions wearing a different label.
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
    it('forbids naming the move, and forbids the fourth wall', () => {
      const text = prompt();
      expect(text).toMatch(/do not tell them what to do/i);
      expect(text).toMatch(/pressures, not moves/i);
      // A counsellor who mentions action points has stopped being inside the
      // fiction, which is the whole register the call is written for.
      expect(text).toMatch(/action points|fourth wall/i);
    });

    it('holds the counsel to a power’s own sheet', () => {
      // Five powers given the identical board should be worried about five
      // different things; that is what makes an advisor worth having rather
      // than a generic optimizer.
      expect(prompt()).toMatch(/red lines and its\s+compulsions/i);
    });
  });
});
