import { describe, expect, it } from 'vitest';
import { mergeShards, tournament, tournamentShard } from '../src/fleetlab.js';
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
const IDS = ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk'] as const;
const net = (id: string) => last.perFaction[id]!.net;
/** How much of a power's gross comes from the lane network rather than its worlds. */
const laneShare = (id: string) => {
  const f = last.perFaction[id]!;
  return f.routes / Math.max(1, f.routes + f.territory);
};

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
    expect(sum('ojjul', 'tolls')).toBeGreaterThan(200);
  });

  it('funds the smuggler from raiding', () => {
    // This was zero for an entire thirty-turn run, because raiding required
    // holding the system you raided — so the poorest power could only prey on
    // those it had already beaten. Raiding from one jump out is what fixed it.
    expect(sum('drajk', 'raided')).toBeGreaterThan(200);
  });

  it('keeps the autarkist off the network and the free trader on it', () => {
    // Arkane is the autarkist. This used to name the Iron Vigil too, which
    // stopped being true when the Vigil took over the `monopolist` doctrine —
    // an ethic that had been implemented, tested and owned by nobody while
    // `autarkic` was held twice.
    expect(laneShare('freeworlds')).toBeLessThan(laneShare('meridian'));
  });

  it('pays the monopolist for holding both ends of its own lane', () => {
    // The Vigil holds tor-3 <-> tor-4, one of three both-ends lanes on the map.
    // A doctrine nobody has is a doctrine that cannot be shown to work, so this
    // is the assertion that keeps `monopolist` honest.
    expect(last.perFaction['vigil']!.routes).toBeGreaterThan(0);
    expect(laneShare('vigil')).toBeGreaterThan(laneShare('freeworlds'));
  });

  it('leaves trade worth interdicting: value sits unclaimed on neutral space', () => {
    // The three unaligned junctions are the map's standing invitation. If
    // this ever reaches zero, the neutral worlds have stopped being a prize.
    expect(last.uncollected).toBeGreaterThan(0);
  });
});

/**
 * Sharding the tournament across cores must be EXACT, not approximate.
 *
 * A sweep is how `TORPEDO_STRIKE`, the lift axis and the loss order were all
 * settled, so a parallel run that merely agreed roughly would be worse than a
 * slow serial one. It is exact by construction — every battle is a pure
 * function of `(attacker, defender, garrison, turn, ethic)`, `trial` builds its
 * own arena, and the roll comes from `rollD20(turn, salt)` — and this is the
 * test that keeps it so.
 */
describe('the composition tournament shards exactly', () => {
  // Small grid: the property is order-independence, not scale.
  const opts = {
    budget: 900,
    defenceBudget: 600,
    steps: 2,
    lift: [0, 4] as const,
    garrisons: [4, 10],
    turns: [1, 3],
  };

  it('merges to the same answer however many ways it is split', () => {
    const serial = tournament(opts);
    for (const shards of [1, 3, 7]) {
      const merged = mergeShards(
        opts,
        Array.from({ length: shards }, (_, i) => tournamentShard(opts, i, shards)),
      );
      expect(merged.battles, `${shards} shards`).toBe(serial.battles);
      expect(merged.attackers.map((c) => [c.label, c.wins, c.trials])).toEqual(
        serial.attackers.map((c) => [c.label, c.wins, c.trials]),
      );
      expect(merged.defenders.map((c) => [c.label, c.wins, c.trials])).toEqual(
        serial.defenders.map((c) => [c.label, c.wins, c.trials]),
      );
    }
  });

  it('runs every battle exactly once across the shards', () => {
    // The failure a stride-sharded loop invites: an attacker covered twice, or
    // not at all, when the shard count does not divide the axis.
    const total = [0, 1, 2, 3, 4].reduce(
      (n, i) => n + tournamentShard(opts, i, 5).battles,
      0,
    );
    expect(total).toBe(tournament(opts).battles);
  });
});
