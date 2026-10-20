import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { ConcessionSchema } from '../src/domain/diplomacy.js';
import { concessionWorth, withinBudget } from '../src/domain/leverage.js';
import { opsAsRuled } from '../src/domain/refusals.js';
import { cappedProse } from '../src/domain/ops.js';
import { Campaign } from '../src/engine/campaign.js';
import { battleHistory } from '../src/engine/journal.js';
import { campaignOutcome, serializeOutcome } from '../src/engine/epilogue.js';
import { draftWithCorrection } from '../src/engine/turn.js';

/**
 * The band-aid fixes from the 2026-10-19 playtest, in which the player did
 * what the counsellor urged every turn (`docs/audit-2026-10-19.md`). Each test
 * reproduces what the playtest hit.
 */

describe('B1: a buyer names the world it is buying', () => {
  it('is not charged for that world, so its payment survives the budget', () => {
    const s = createSeedState('meridian');
    const payment = ConcessionSchema.parse({ by: 'vigil', kind: 'purchase', text: 'Five hundred for Torrek.', credits: 500, systems: ['tor-1'] });
    expect(concessionWorth(s, payment)).toBe(500);
    expect(withinBudget(s, [payment], 'vigil', 'meridian').kept).toHaveLength(1);
    // A world the conceder holds is still what it gives.
    const cession = ConcessionSchema.parse({ by: 'meridian', kind: 'cede', text: 'Torrek passes.', systems: ['tor-1'] });
    expect(concessionWorth(s, cession)).toBeGreaterThan(0);
  });
});

describe('B2: a bounty is the actor’s own money in escrow', () => {
  it('is kept whatever reaches the ruling named', () => {
    const bounty = { op: 'post_bounty', factionId: 'meridian', targetFactionId: 'vigil', amount: 400 };
    expect(opsAsRuled([bounty], [], []).ops).toEqual([bounty]);
  });
});

describe('B3: a refused rewrite', () => {
  it('leaves the draft with what did not land said after it', () => {
    const notes = ["An act reaches into another power's business only as it was ruled to: left out suborn_crews. Declare it as its own act.", 'Brannix raises its walls.'];
    expect(draftWithCorrection('The crews come over.', notes, [])).toBe(`The crews come over.\n\nNot as told: ${notes[0]}`);
    expect(draftWithCorrection('As told.', ['Brannix raises its walls.'], [])).toBe('As told.');
  });
});

describe('B6: a declared move names what sails', () => {
  const move = { op: 'move', factionId: 'meridian', originId: 'sek-2', targetId: 'tor-1' };

  it('is refused without a force from version 29, and allowed before it', () => {
    const s = createSeedState('meridian');
    expect(applyOps(s, [move], 'model', 'meridian', true, {}, 'declared').rejections.map((r) => r.code)).toEqual(['illegal_value']);
    expect(applyOps(s, [move], 'model', 'meridian', true, { declaredMovesNameForce: false }, 'declared').rejections).toEqual([]);
    expect(applyOps(s, [{ ...move, force: { battleship: 4 } }], 'model', 'meridian', true, {}, 'declared').rejections).toEqual([]);
  });

  it('holds only the player: a bot still sends the whole port', () => {
    const s = createSeedState('meridian');
    expect(applyOps(s, [move], 'model', 'meridian', true, {}, 'bot').rejections).toEqual([]);
  });
});

describe('D3: the epilogue knows the battles that moved no border', () => {
  it('counts each power’s battles and losses off the journal', () => {
    const campaign = Campaign.start('meridian', 'battles');
    // The Vigil sends Vantic's squadron at Torrek Anchorage without lift: a
    // fight in the orbit that cannot take the world.
    campaign.commit(
      [{ op: 'issue_order', factionId: 'vigil', type: 'fleet_movement', originId: 'tor-3', targetId: 'tor-1', force: { battleship: 7, escort: 7 } }],
      'engine',
      'the Vigil comes for Torrek',
    );
    campaign.tick();
    const battles = battleHistory(campaign.journal);
    expect(campaign.state.systems.find((x) => x.id === 'tor-1')!.controllerFactionId).toBe('meridian');
    expect(battles.meridian!.fought['Torrek Anchorage']).toBe(1);
    expect(battles.meridian!.shipsLost + battles.vigil!.shipsLost).toBeGreaterThan(0);

    const text = serializeOutcome(campaignOutcome(campaign.state, createSeedState('meridian'), 10, [], {}, battles));
    const meridian = text.slice(text.indexOf('(`meridian`)'), text.indexOf('(`vigil`)'));
    expect(meridian).toMatch(/battles fought\*\*: Torrek Anchorage/);
    expect(text.slice(text.indexOf('(`ojjul`)'))).toMatch(/fought no battle/);
  });
});

describe('A1: prose over its cap', () => {
  it('is cut at a clause, never mid-word', () => {
    const long = `${'The Vigil holds Vantic at nine, '.repeat(17)}and the Board will ask you by quarter's end`;
    const out = cappedProse(560).parse(long);
    expect(out.length).toBeLessThanOrEqual(560);
    expect(out).toMatch(/nine…$/);
  });
});
