import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { describePlace, peopleOf, personViolations, whereaboutsOf } from '../src/domain/people.js';
import { runBalance } from '../src/balance.js';

/** Officers, operatives and notables live one lifecycle; `whereaboutsOf` reads it for all three. */
describe('where a person is', () => {
  it('places everyone on the opening board, and breaks no rule doing it', () => {
    const s = createSeedState('meridian');
    expect(personViolations(s)).toEqual([]);
    const places = peopleOf(s).map((p) => whereaboutsOf(s, p).at);
    expect(places).toContain('listed');
    expect(places).toContain('post');
    expect(places).not.toContain('gone');
  });

  it('follows an operative off the Lists, onto the books and out on a mission', () => {
    let s = createSeedState('meridian');
    const listed = s.listedAgents.find((a) => a.ownerFactionId === 'meridian')!;
    expect(whereaboutsOf(s, { kind: 'operative', id: listed.id })).toEqual({ at: 'listed' });
    s = applyOps(s, [{ op: 'recruit_agent', factionId: 'meridian', systemId: 'sek-4', agent: listed.name }], 'model', 'meridian').state;
    const recruit = s.agents.find((a) => a.ownerFactionId === 'meridian')!;
    expect(whereaboutsOf(s, { kind: 'operative', id: recruit.id })).toEqual({ at: 'post', systemId: 'sek-4' });
    expect(personViolations(s)).toEqual([]);
  });

  it('says where an officer is the way a player reads it', () => {
    const s = createSeedState('vigil');
    const officer = s.commanders.find((c) => c.factionId === 'vigil' && c.status === 'active')!;
    const place = whereaboutsOf(s, { kind: 'officer', id: officer.id });
    expect(place.at).toBe('post');
    expect(describePlace(s, place)).toMatch(/^at /);
  });

  it('catches a person in two places at once', () => {
    const s = createSeedState('meridian');
    const officer = s.commanders.find((c) => c.status === 'active')!;
    s.assets.push({ ...s.assets[0]!, id: 'ast-x', kind: 'officer', commanderId: officer.id, agentId: null, quantity: 1 });
    expect(personViolations(s)).toEqual([`officer ${officer.id} is active and held as an asset`]);
  });

  it('holds over sixty turns of the bots, battles, captures and ransoms included', () => {
    const broken: string[] = [];
    runBalance(60, (snap, state) => {
      for (const v of personViolations(state)) broken.push(`turn ${snap.turn}: ${v}`);
    });
    expect(broken).toEqual([]);
  }, 60_000);
});
