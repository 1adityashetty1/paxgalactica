import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import {
  campaignOutcome,
  fallbackEpilogue,
  serializeOutcome,
  EpilogueViewSchema,
} from '../src/engine/epilogue.js';
import { emptyJournal, replay } from '../src/engine/journal.js';
import type { WorldState } from '../src/domain/state.js';

/**
 * A campaign had no ending: it ran until the player stopped, so every session
 * trailed off rather than finishing. The limit gives it a shape and the
 * epilogue gives it a last page.
 */

const seed = () => createSeedState('hutt');

describe('the turn limit', () => {
  it('is recorded on the seed entry, so it survives a save and a replay', () => {
    const c = Campaign.start('hutt', 'limited', new MemoryCampaignStore(), 25);
    expect(c.maxTurns).toBe(25);

    const reloaded = Campaign.fromSaveFile('limited', c.toSaveFile(), new MemoryCampaignStore());
    expect(reloaded.maxTurns).toBe(25);
  });

  /**
   * A journal written before endings existed must load as endless rather than
   * acquiring a deadline it was never played under.
   */
  it('is absent from a legacy journal, which stays endless', () => {
    const c = Campaign.start('hutt', 'legacy', new MemoryCampaignStore());
    expect(c.maxTurns).toBeNull();
    expect(c.isOver).toBe(false);
    // And a bare journal still replays.
    expect(replay(emptyJournal('hutt')).state.turn).toBe(0);
  });

  it('is over only once the committed turn reaches it', () => {
    const c = Campaign.start('hutt', 'short', new MemoryCampaignStore(), 10);
    expect(c.isOver).toBe(false);
    for (let i = 0; i < 9; i++) c.tick();
    expect(c.isOver).toBe(false);
    c.tick();
    expect(c.isOver).toBe(true);
  });
});

describe('the dossier is computed, not narrated', () => {
  /** A board where one power has plainly gained and another has plainly lost. */
  const shifted = (): WorldState => {
    let s = seed();
    const meridianWorld = s.systems.find((x) => x.controllerFactionId === 'meridian')!;
    s = applyOps(s, [
      { op: 'transfer_control', systemId: meridianWorld.id, toFactionId: 'vigil' },
    ], 'engine').state;
    return s;
  };

  it('reports what actually changed hands, by name', () => {
    const start = seed();
    const end = shifted();
    const taken = start.systems.find(
      (x) => x.controllerFactionId === 'meridian' &&
        end.systems.find((y) => y.id === x.id)!.controllerFactionId === 'vigil',
    )!;

    const outcome = campaignOutcome(end, start, 30);
    const vigil = outcome.factions.find((f) => f.factionId === 'vigil')!;
    const meridian = outcome.factions.find((f) => f.factionId === 'meridian')!;

    expect(vigil.gained).toContain(taken.name);
    expect(meridian.lost).toContain(taken.name);
    expect(vigil.systemsDelta).toBe(1);
    expect(meridian.systemsDelta).toBe(-1);
  });

  /**
   * The verdict is settled in code precisely so the narration cannot overturn
   * it — a power that lost half its territory must not be able to read as
   * triumphant because its voice is confident.
   */
  it('settles each arc from the board', () => {
    const outcome = campaignOutcome(shifted(), seed(), 30);
    expect(outcome.factions.find((f) => f.factionId === 'vigil')!.arc).toBe('ascendant');
    expect(outcome.factions.find((f) => f.factionId === 'meridian')!.arc).toBe('diminished');
  });

  it('calls a power with nothing left broken', () => {
    let s = seed();
    for (const sys of s.systems.filter((x) => x.controllerFactionId === 'krayt')) {
      s = applyOps(s, [
        { op: 'transfer_control', systemId: sys.id, toFactionId: null },
      ], 'engine').state;
    }
    const outcome = campaignOutcome(s, seed(), 30);
    expect(outcome.factions.find((f) => f.factionId === 'krayt')!.arc).toBe('broken');
  });

  it('names the foremost power deterministically', () => {
    const a = campaignOutcome(seed(), seed(), 30);
    const b = campaignOutcome(seed(), seed(), 30);
    expect(a.foremost).toBe(b.foremost);
  });

  it('hands the narrator the arc as settled, so it cannot be re-argued', () => {
    const text = serializeOutcome(campaignOutcome(shifted(), seed(), 30));
    expect(text).toMatch(/settled; do not overturn/);
    expect(text).toMatch(/THE PLAYER/);
  });
});

/**
 * The last thing a campaign does must never be an error message. A call can
 * die for reasons that have nothing to do with the player.
 */
describe('the ending cannot fail', () => {
  it('produces a slide for every faction with no model at all', () => {
    const outcome = campaignOutcome(seed(), seed(), 30);
    const plain = fallbackEpilogue(outcome);
    expect(plain.slides).toHaveLength(outcome.factions.length);
    for (const f of outcome.factions) {
      const slide = plain.slides.find((s) => s.factionId === f.factionId);
      expect(slide, f.factionId).toBeDefined();
      expect(slide!.text.length).toBeGreaterThan(20);
    }
    expect(plain.closing).toMatch(/Outer Rim/);
  });

  it('validates against the wire schema', () => {
    const outcome = campaignOutcome(seed(), seed(), 30);
    const plain = fallbackEpilogue(outcome);
    const parsed = EpilogueViewSchema.safeParse({
      turn: outcome.turn,
      maxTurns: outcome.maxTurns,
      playerFactionId: outcome.playerFactionId,
      unaligned: outcome.unaligned,
      foremost: outcome.foremost,
      factions: outcome.factions,
      slides: plain.slides,
      closing: plain.closing,
      fallback: true,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });

  it('describes a broken power as broken rather than politely', () => {
    let s = seed();
    for (const sys of s.systems.filter((x) => x.controllerFactionId === 'krayt')) {
      s = applyOps(s, [{ op: 'transfer_control', systemId: sys.id, toFactionId: null }], 'engine').state;
    }
    const plain = fallbackEpilogue(campaignOutcome(s, seed(), 30));
    expect(plain.slides.find((x) => x.factionId === 'krayt')!.text).toMatch(/held nothing/);
  });
});

describe('a finished campaign', () => {
  it('caches its ending in the save file rather than regenerating it', () => {
    const c = Campaign.start('hutt', 'ended', new MemoryCampaignStore(), 10);
    const outcome = campaignOutcome(seed(), seed(), 10);
    const plain = fallbackEpilogue(outcome);
    c.epilogue = {
      turn: 10, maxTurns: 10, playerFactionId: 'hutt',
      unaligned: outcome.unaligned, foremost: outcome.foremost,
      factions: outcome.factions, slides: plain.slides, closing: plain.closing, fallback: true,
    };

    const reloaded = Campaign.fromSaveFile('ended', c.toSaveFile(), new MemoryCampaignStore());
    expect(reloaded.epilogue?.closing).toBe(plain.closing);
  });

  it('still replays exactly — the ending is not world state', () => {
    const c = Campaign.start('hutt', 'replays', new MemoryCampaignStore(), 10);
    c.tick();
    c.epilogue = null;
    expect(c.verifyReplay().ok).toBe(true);
  });
});
