import { describe, expect, it } from 'vitest';
import { runBalance } from '../src/balance.js';

/**
 * Balance, asserted rather than eyeballed.
 *
 * These are not "the numbers are exactly right" tests — they are the
 * properties that, when they broke, made the game stop being a game. Each one
 * corresponds to something the harness actually caught:
 *
 *   - the extortionist running away with a treasury nobody could touch
 *   - the smuggler's raiding earning literally nothing across thirty turns
 *   - every power grinding to a net of zero with an enormous fleet
 *   - trade being a rounding error next to territory
 *
 * Bounds are deliberately loose. A tight assertion on a balance number is a
 * test that fails every time someone tunes anything, which trains people to
 * ignore it.
 */

const RUN = runBalance(30);
const last = RUN[RUN.length - 1]!;
const IDS = ['meridian', 'vigil', 'hutt', 'freeworlds', 'krayt'] as const;
const net = (id: string) => last.perFaction[id]!.net;
const sum = (id: string, key: 'tolls' | 'raided') =>
  RUN.reduce((n, h) => n + h.perFaction[id]![key], 0);

describe('a thirty-turn campaign, five doctrine bots', () => {
  it('is deterministic, so a balance change is a readable diff', () => {
    const a = runBalance(12);
    const b = runBalance(12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('leaves nobody in a death spiral', () => {
    // Insolvent-and-shrinking is a losing position a player can recover from;
    // a power with no systems has been eliminated by bots that barely play.
    for (const id of IDS) {
      expect(last.perFaction[id]!.systems, id).toBeGreaterThan(0);
      expect(last.perFaction[id]!.fleet, id).toBeGreaterThan(0);
    }
  });

  it('does not let one power run away with the whole map', () => {
    const systems = IDS.map((id) => last.perFaction[id]!.systems);
    // 25 systems, five powers. Anyone holding more than half has won by
    // turn 30 against opponents who are not even trying.
    expect(Math.max(...systems)).toBeLessThan(13);
  });

  it('keeps every power able to afford something', () => {
    // A faction that cannot buy a hull in three turns has no moves left.
    for (const id of IDS) {
      expect(net(id), `${id} net`).toBeGreaterThan(-40);
    }
  });

  it('makes trade a real share of the economy, not a rounding error', () => {
    const territory = IDS.reduce((n, id) => n + last.perFaction[id]!.territory, 0);
    const routes = IDS.reduce((n, id) => n + last.perFaction[id]!.routes, 0);
    const share = routes / (territory + routes);
    // The whole point of the lane network: enough that losing lanes hurts,
    // not so much that one blockade ends a campaign.
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });
});

describe('each doctrine pays off when it is actually played', () => {
  it('funds the extortionist from tolls on other powers’ cargo', () => {
    expect(sum('hutt', 'tolls')).toBeGreaterThan(200);
  });

  it('funds the smuggler from raiding', () => {
    // This was zero for an entire thirty-turn run, because raiding required
    // holding the system you raided — so the poorest power could only prey on
    // those it had already beaten. Raiding from one jump out is what fixed it.
    expect(sum('krayt', 'raided')).toBeGreaterThan(200);
  });

  it('keeps autarkists off the network and free traders on it', () => {
    const laneShare = (id: string) => {
      const f = last.perFaction[id]!;
      return f.routes / Math.max(1, f.routes + f.territory);
    };
    expect(laneShare('vigil')).toBeLessThan(laneShare('meridian'));
    expect(laneShare('freeworlds')).toBeLessThan(laneShare('meridian'));
  });

  it('leaves trade worth interdicting: value sits unclaimed on neutral space', () => {
    // The three unaligned junctions are the map's standing invitation. If
    // this ever reaches zero, the neutral worlds have stopped being a prize.
    expect(last.uncollected).toBeGreaterThan(0);
  });
});
