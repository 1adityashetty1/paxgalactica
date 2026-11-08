import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { envoysRefused } from '../src/model/calls.js';
import { capabilitiesOf } from '../src/domain/capabilities.js';

/** The counsellor urged an envoy to a world another power holds, which no order can send. */
describe('the counsellor sends envoys only where an envoy can go', () => {
  const s = createSeedState('meridian');

  it("refuses an envoy to a rival's world, with the reducer's reason", () => {
    const refused = envoysRefused(s, 'meridian', 'Send an envoy to Vantic and win its people over before the Vigil notices.');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/Vantic answers to another power/);
  });

  it('refuses one to an independent world out of reach', () => {
    expect(envoysRefused(s, 'meridian', 'An envoy to Vosk Marker would buy us a friend.')).toHaveLength(1);
  });

  it('lets one go to an independent world in reach, or to a world of your own', () => {
    expect(envoysRefused(s, 'meridian', 'Send an envoy to Var Hollow; it wants peace.')).toEqual([]);
    expect(envoysRefused(s, 'meridian', 'An envoy at Torrek Anchorage would steady it.')).toEqual([]);
  });

  it('does not read a rival world named elsewhere in the sentence as the destination', () => {
    expect(envoysRefused(s, 'meridian', 'While the Vigil holds Vantic, send an envoy to Var Hollow.')).toEqual([]);
    expect(envoysRefused(s, 'meridian', 'Move the line to Vantic. Then court Neth.')).toEqual([]);
  });

  it('tells the counsellor the rule among what its power can do', () => {
    expect(capabilitiesOf(s, 'meridian').join('\n')).toMatch(/A world another power holds cannot be courted/);
  });
});
