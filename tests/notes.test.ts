import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import {
  NOTE_CREDIT,
  NOTE_CREDIT_RENT,
  NOTE_ESCORT_HULLS,
  NOTE_INCOME_SHARE,
  NOTE_TERM_TURNS,
  NOTE_VALUE,
  isNote,
  isTreatyLive,
} from '../src/domain/diplomacy.js';
import type { WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Promissory notes (journal version 12): every power holds one favour signed
 * in advance. Given away, the holder calls it in with no need to ask, the
 * arrangement it names comes into force for `NOTE_TERM_TURNS`, and the note
 * goes home to its issuer.
 */

const noteOf = (s: WorldState, issuer: string) => s.assets.find((a) => isNote(a) && a.issuedBy === issuer)!;

/** The issuer hands its note over, which needs nobody — giving your own away never does. */
function give(s: WorldState, issuer: string, to: string): WorldState {
  const out = applyOps(
    s,
    [{ op: 'transfer_asset', assetId: noteOf(s, issuer).id, toFactionId: to } as OpInput],
    'model',
    issuer,
  );
  expect(out.rejections).toEqual([]);
  return out.state;
}

const play = (s: WorldState, issuer: string, actor: string) =>
  applyOps(s, [{ op: 'play_note', assetId: noteOf(s, issuer).id } as OpInput], 'model', actor);

describe('the opening board', () => {
  it('gives every power its own note, on paper, worth nothing to it', () => {
    const s = createSeedState('meridian');
    const notes = s.assets.filter(isNote);
    expect(notes.map((n) => n.heldBy).sort()).toEqual(['drajk', 'freeworlds', 'meridian', 'ojjul', 'vigil']);
    for (const n of notes) {
      expect(n.issuedBy).toBe(n.heldBy);
      expect(n.atSystemId).toBeNull();
      expect(n.valuePerUnit[n.issuedBy]).toBe(0);
      for (const f of s.factions.filter((x) => x.id !== n.issuedBy)) expect(n.valuePerUnit[f.id]).toBe(NOTE_VALUE);
    }
    expect(new Set(notes.map((n) => n.note)).size).toBe(5);
  });

  it('is not there for a journal from before notes', () => {
    expect(createSeedState('meridian', { notes: false }).assets.filter(isNote)).toEqual([]);
  });
});

describe('calling a note in', () => {
  it('sanctuary: basing rights for the term, and the note goes home', () => {
    const s = give(createSeedState('meridian'), 'freeworlds', 'meridian');
    const out = play(s, 'freeworlds', 'meridian');
    expect(out.rejections).toEqual([]);
    const t = out.state.treaties.at(-1)!;
    expect(t).toMatchObject({ type: 'basing_rights', expiresTurn: s.turn + NOTE_TERM_TURNS, status: 'active' });
    expect(t.parties.sort()).toEqual(['freeworlds', 'meridian']);
    expect(noteOf(out.state, 'freeworlds').heldBy).toBe('freeworlds');
  });

  it('most-favoured terms: an accord, and a quarter of the issuer\'s richest world', () => {
    const s = give(createSeedState('meridian'), 'meridian', 'ojjul');
    const out = play(s, 'meridian', 'ojjul');
    expect(out.rejections).toEqual([]);
    const t = out.state.treaties.at(-1)!;
    expect(t.type).toBe('trade_accord');
    const richest = s.systems
      .filter((x) => x.controllerFactionId === 'meridian')
      .sort((a, b) => b.strategicValue - a.strategicValue || a.id.localeCompare(b.id))[0]!;
    expect(t.terms.incomeShares).toEqual([{ systemId: richest.id, factionId: 'ojjul', share: NOTE_INCOME_SHARE }]);
  });

  it('escort of the line: a defence pact the issuer pledges hulls to', () => {
    const s = give(createSeedState('meridian'), 'vigil', 'meridian');
    const out = play(s, 'vigil', 'meridian');
    expect(out.rejections).toEqual([]);
    const t = out.state.treaties.at(-1)!;
    expect(t.type).toBe('mutual_defense');
    expect(t.terms.shipsPledged).toEqual({ vigil: NOTE_ESCORT_HULLS });
  });

  it('line of credit: an advance out of the issuer\'s own treasury, lent at rent', () => {
    const s = give(createSeedState('meridian'), 'ojjul', 'meridian');
    const credits = (st: WorldState, id: string) => st.factions.find((f) => f.id === id)!.credits;
    const out = play(s, 'ojjul', 'meridian');
    expect(out.rejections).toEqual([]);
    expect(credits(out.state, 'meridian')).toBe(credits(s, 'meridian') + NOTE_CREDIT);
    expect(credits(out.state, 'ojjul')).toBe(credits(s, 'ojjul') - NOTE_CREDIT);
    expect(out.state.loans.at(-1)).toMatchObject({
      lenderFactionId: 'ojjul',
      borrowerFactionId: 'meridian',
      lent: { kind: 'credits', amount: NOTE_CREDIT },
      rentPerTurn: NOTE_CREDIT_RENT,
      dueTurn: s.turn + NOTE_TERM_TURNS,
    });
  });

  it('safe passage: an accord that keeps the raider off the holder\'s cargo', () => {
    const s = give(createSeedState('meridian'), 'drajk', 'freeworlds');
    const out = play(s, 'drajk', 'freeworlds');
    expect(out.rejections).toEqual([]);
    expect(out.state.treaties.at(-1)!.type).toBe('trade_accord');
  });

  it('runs its term and no longer', () => {
    const s = give(createSeedState('meridian'), 'freeworlds', 'meridian');
    const t = play(s, 'freeworlds', 'meridian').state.treaties.at(-1)!;
    expect(isTreatyLive(t, s.turn + NOTE_TERM_TURNS - 1)).toBe(true);
    expect(isTreatyLive(t, s.turn + NOTE_TERM_TURNS)).toBe(false);
  });
});

describe('what a note will not do', () => {
  it('is not called in by its own issuer', () => {
    expect(play(createSeedState('meridian'), 'meridian', 'meridian').rejections[0]?.message).toMatch(/own promise/);
  });

  it('is played by its holder and nobody else', () => {
    const s = give(createSeedState('meridian'), 'freeworlds', 'meridian');
    expect(play(s, 'freeworlds', 'ojjul').rejections[0]?.message).toMatch(/to play/);
  });

  it('is not honoured in war', () => {
    // The Vigil and the Confederacy open at war.
    const s = give(createSeedState('meridian'), 'drajk', 'vigil');
    expect(play(s, 'drajk', 'vigil').rejections[0]?.message).toMatch(/at war/);
  });

  it('gives nothing that is already in force, rather than replacing it', () => {
    let s = give(createSeedState('meridian'), 'freeworlds', 'meridian');
    s = play(s, 'freeworlds', 'meridian').state;
    s = give(s, 'freeworlds', 'meridian');
    expect(play(s, 'freeworlds', 'meridian').rejections[0]?.message).toMatch(/already have/);
  });

  it('is played, not spent, and never minted', () => {
    const s = createSeedState('meridian');
    const spend = applyOps(s, [{ op: 'consume_asset', assetId: noteOf(s, 'meridian').id } as OpInput], 'model', 'meridian');
    expect(spend.rejections[0]?.message).toMatch(/played/);
    const mint = applyOps(
      s,
      [{ op: 'create_asset', kind: 'promissory_note', text: 'a favour', heldBy: 'meridian', quantity: 1, unit: 'note' } as OpInput],
      'model',
      'meridian',
    );
    expect(mint.rejections[0]?.message).toMatch(/issued by the power/);
  });
});
