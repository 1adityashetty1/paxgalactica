import { describe, expect, it } from 'vitest';
import { MAX_ASSET_STAT } from '../src/domain/diplomacy.js';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import { boundPayloadsToOutcome } from '../src/domain/development.js';
import {
  assetWorthRangeTo,
  assetWorthTo,
  wantedBy,
  type Asset,
} from '../src/domain/diplomacy.js';
import { ASSET_ARCHETYPES, archetypeFor, serializeArchetypes } from '../src/domain/assets.js';
import { serializeAssets, serializeTheirAssets } from '../src/model/serialize.js';
import { groundInConcessions } from '../src/engine/turn.js';
import { hullsAt, setStackAt, type WorldState } from '../src/domain/state.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * The asset system, exercised hard.
 *
 * This is the change that lets a player trade anything, which makes it the
 * change with the widest blast radius and the least chance of a suite catching
 * a regression by accident. So: every archetype instantiated, every field that
 * can be forced checked against a call that disagrees, every guard probed from
 * both sides, and the two conservation properties — value under a split, and
 * value under a transfer — asserted rather than assumed.
 */
describe('assets', () => {
  /**
   * The seed ships four assets — one per power except the Combine, which holds
   * paper instead. They are stripped here on purpose: every test in this file
   * is about the mechanic in isolation, and several count or index
   * `state.assets` whole, which is only meaningful against a board this file
   * put there itself. The seeded four are pinned in their own test at the
   * bottom, so removing them here does not remove the coverage.
   */
  const seed = () => {
    const s = createSeedState('ojjul');
    s.assets = [];
    return s;
  };
  const world = (s: WorldState, f = 'ojjul') =>
    s.systems.find((x) => x.controllerFactionId === f)!;
  const mint = (over: Record<string, unknown> = {}): OpInput =>
    ({
      op: 'create_asset', kind: 'prisoners', heldBy: 'ojjul', quantity: 40, unit: 'crew',
      text: 'Vigil crews taken off Vantic.', valuePerUnit: { vigil: 12 }, ...over,
    }) as OpInput;
  const held = (s: WorldState, f = 'ojjul') => s.assets.filter((a) => a.heldBy === f);

  /* ---------------------------------------------------------------- */
  /* The catalogue                                                     */
  /* ---------------------------------------------------------------- */

  describe('the catalogue', () => {
    it('has a coherent shape for every archetype', () => {
      expect(ASSET_ARCHETYPES.length).toBeGreaterThanOrEqual(12);
      const kinds = ASSET_ARCHETYPES.map((a) => a.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const a of ASSET_ARCHETYPES) {
        // The slug is matched on, so it has to survive the schema that
        // validates a minted asset — an inconsistent one would silently
        // disable the lookup rather than fail.
        expect(a.kind).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(a.unit.length).toBeGreaterThan(0);
        // An instrument that can be played zero times is a contradiction, and
        // an instrument that also divides is two ways of counting one thing.
        if (a.uses !== null) {
          expect(a.uses).toBeGreaterThan(0);
          expect(a.divisible).toBe(false);
        }
        // A fixture IS its world, so it cannot come in tradeable lots.
        if (a.fixture) expect(a.divisible).toBe(false);
        expect(a.from.length).toBeGreaterThan(0);
        expect(a.wanted.length).toBeGreaterThan(0);
      }
    });

    it('covers people, paper, stuff and works', () => {
      // The grouping is the useful part of the list: it is chosen to cover the
      // ways a thing can enter play rather than to enumerate the fiction.
      expect(archetypeFor('prisoners')?.divisible).toBe(true);
      expect(archetypeFor('dossier')?.divisible).toBe(false);
      expect(archetypeFor('writ')?.uses).toBe(1);
      expect(archetypeFor('ore')?.speculative).toBe(true);
      expect(archetypeFor('foundry')?.fixture).toBe(true);
      // A works declares the attribute it is worth to whoever holds the ground.
      expect(archetypeFor('foundry')?.modifies).toEqual(['industry']);
      expect(archetypeFor('college')?.modifies).toEqual(['guile']);
      // A works may name two, and then it splits one budget between them.
      expect(archetypeFor('black_market')?.modifies).toEqual(['influence', 'guile']);
      expect(archetypeFor('nothing_like_this')).toBeUndefined();
    });

    it('renders every archetype into the prompt table', () => {
      // Substituted at call time rather than pasted into the .md, so the table
      // and the prompt cannot drift. This is the drift check for that.
      const table = serializeArchetypes();
      for (const a of ASSET_ARCHETYPES) {
        expect(table).toContain(`\`${a.kind}\``);
        expect(table).toContain(a.from);
      }
      expect(table).toContain('worth is a BAND');
      expect(table).toContain('played once, then spent');
    });

    it('fills in and corrects a call that disagrees with the shape', () => {
      // `divisible` and `uses` are FORCED, because a prisoner haul that will
      // not divide cannot be ransomed in lots and an instrument with no uses is
      // exercisable forever — the bug this shipped for.
      const wrong = applyOps(
        seed(),
        [mint({ kind: 'writ', quantity: 1, unit: 'writ', divisible: true, uses: null })],
        'model',
        'ojjul',
      );
      expect(wrong.rejections).toEqual([]);
      expect(wrong.state.assets[0]!.divisible).toBe(false);
      expect(wrong.state.assets[0]!.uses).toBe(1);
      expect(wrong.notes.some((n) => n.includes('is one thing'))).toBe(true);

      // And an unknown slug keeps whatever the call said: the vocabulary is
      // open, and a survey that brings back something nobody enumerated is the
      // whole point of an arbiter.
      const invented = applyOps(
        seed(),
        [mint({ kind: 'war_orphans', unit: 'child', divisible: true })],
        'model',
        'ojjul',
      );
      expect(invented.rejections).toEqual([]);
      expect(invented.state.assets[0]!.divisible).toBe(true);
      expect(invented.state.assets[0]!.uses).toBeNull();
    });

    it('makes a fixture out of a works archetype without being told', () => {
      const s = seed();
      const out = applyOps(
        s,
        [mint({ kind: 'foundry', quantity: 1, unit: 'works', valuePerUnit: {}, atSystemId: world(s).id })],
        'model',
        'ojjul',
      );
      expect(out.rejections).toEqual([]);
      expect(out.state.assets[0]!.portable).toBe(false);
      // And it is worth what its kind means, without being told.
      expect(out.state.assets[0]!.yield).toEqual({
        kind: 'stat',
        stats: [{ stat: 'industry', points: 2 }],
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Speculative value                                                 */
  /* ---------------------------------------------------------------- */

  describe('a worth nobody has settled', () => {
    const ore = (over: Record<string, unknown> = {}): OpInput =>
      mint({
        kind: 'ore', quantity: 100, unit: 'ton', text: 'A seam under the Halland cut.',
        speculative: true, valuePerUnit: {}, valueRange: { meridian: { min: 2, max: 6 } },
        ...over,
      });

    it('keeps exactly one opinion about what a thing is worth', () => {
      const s = applyOps(seed(), [ore()], 'model', 'ojjul').state;
      const a = s.assets[0]!;
      expect(a.speculative).toBe(true);
      // The flat field is CLEARED rather than left beside the band. Two
      // populated fields is a second source of truth for a number two personas
      // are about to argue over.
      expect(a.valuePerUnit).toEqual({});
      expect(a.valueRange).toEqual({ meridian: { min: 2, max: 6 } });

      const settled = applyOps(seed(), [mint()], 'model', 'ojjul').state;
      expect(settled.assets[0]!.valueRange).toEqual({});
    });

    it('answers one number as the midpoint and the band on request', () => {
      const s = applyOps(seed(), [ore()], 'model', 'ojjul').state;
      const a = s.assets[0]!;
      expect(assetWorthTo(a, 'meridian')).toBe(400);
      expect(assetWorthRangeTo(a, 'meridian')).toEqual({ min: 200, max: 600 });
      expect(assetWorthTo(a, 'drajk')).toBe(0);
      expect(assetWorthRangeTo(a, 'drajk')).toEqual({ min: 0, max: 0 });
    });

    it('reads a settled asset as a band of zero width', () => {
      const s = applyOps(seed(), [mint()], 'model', 'ojjul').state;
      expect(assetWorthRangeTo(s.assets[0]!, 'vigil')).toEqual({ min: 480, max: 480 });
    });

    it('straightens a band written backwards rather than rejecting it', () => {
      const s = applyOps(
        seed(),
        [ore({ valueRange: { meridian: { min: 9, max: 3 } } })],
        'model',
        'ojjul',
      );
      expect(s.rejections).toEqual([]);
      expect(s.state.assets[0]!.valueRange.meridian).toEqual({ min: 3, max: 9 });
    });

    it('drops a price quoted for a power nobody has', () => {
      const s = applyOps(
        seed(),
        [ore({ valueRange: { meridian: { min: 2, max: 6 }, tarkin: { min: 90, max: 99 } } })],
        'model',
        'ojjul',
      );
      expect(Object.keys(s.state.assets[0]!.valueRange)).toEqual(['meridian']);
      const flat = applyOps(seed(), [mint({ valuePerUnit: { vigil: 12, nobody: 40 } })], 'model', 'ojjul');
      expect(Object.keys(flat.state.assets[0]!.valuePerUnit)).toEqual(['vigil']);
    });

    it('names who wants it, whichever way the value is stated', () => {
      const spec = applyOps(seed(), [ore()], 'model', 'ojjul').state.assets[0]!;
      const flat = applyOps(seed(), [mint()], 'model', 'ojjul').state.assets[0]!;
      expect(wantedBy(spec)).toEqual(['meridian']);
      expect(wantedBy(flat)).toEqual(['vigil']);
      expect(wantedBy(flat, 'vigil')).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Spending                                                          */
  /* ---------------------------------------------------------------- */

  describe('spending a thing', () => {
    it('draws down stuff by quantity and removes the row at zero', () => {
      let s = applyOps(seed(), [mint()], 'model', 'ojjul').state;
      const id = s.assets[0]!.id;
      s = applyOps(s, [{ op: 'consume_asset', assetId: id, quantity: 15 }], 'model', 'ojjul').state;
      expect(s.assets[0]!.quantity).toBe(25);
      s = applyOps(s, [{ op: 'consume_asset', assetId: id, quantity: 25 }], 'model', 'ojjul').state;
      // Nothing in the game could remove an asset before this: `state.assets`
      // was only ever appended to and re-pointed.
      expect(s.assets).toHaveLength(0);
    });

    it('draws down an instrument by plays, which is the bug it shipped for', () => {
      // A claimant's seal was exercised in prose and was still there the next
      // turn, exercisable again forever. Nothing in the record said *once*.
      let s = applyOps(
        seed(),
        [mint({ kind: 'surety', quantity: 1, unit: 'bond', text: "Halland's seal, in escrow.", valuePerUnit: { vigil: 400 } })],
        'model',
        'ojjul',
      ).state;
      expect(s.assets[0]!.uses).toBe(1);
      s = applyOps(
        s,
        [{ op: 'consume_asset', assetId: s.assets[0]!.id, reason: 'couriered to the Legate.' }],
        'model',
        'ojjul',
      ).state;
      expect(s.assets).toHaveLength(0);
    });

    it('spends a multi-play instrument one play at a time', () => {
      let s = applyOps(
        seed(),
        [mint({ kind: 'ciphers', quantity: 1, unit: 'key', text: 'Vigil signals keys.', valuePerUnit: { drajk: 200 } })],
        'model',
        'ojjul',
      ).state;
      expect(s.assets[0]!.uses).toBe(3);
      const id = s.assets[0]!.id;
      s = applyOps(s, [{ op: 'consume_asset', assetId: id }], 'model', 'ojjul').state;
      expect(s.assets[0]!.uses).toBe(2);
      // Quantity is untouched: one key set, played twice.
      expect(s.assets[0]!.quantity).toBe(1);
      s = applyOps(s, [{ op: 'consume_asset', assetId: id, quantity: 9 }], 'model', 'ojjul').state;
      expect(s.assets).toHaveLength(0);
    });

    it('is refused for a thing that is not yours', () => {
      const s = applyOps(seed(), [mint()], 'model', 'ojjul').state;
      const out = applyOps(
        s,
        [{ op: 'consume_asset', assetId: s.assets[0]!.id }],
        'model',
        'drajk',
      );
      expect(out.rejections[0]?.code).toBe('illegal_value');
      expect(out.state.assets).toHaveLength(1);
    });

    it('survives a failed attempt, because a cost is not a payoff', () => {
      // `boundPayloadsToOutcome` strips what the player WANTED on a failure and
      // keeps what the attempt COST. Powder burned on a demolition that did not
      // work is still burned.
      const ops = [mint(), { op: 'consume_asset', assetId: 'ast-0-0', quantity: 5 }];
      const failed = boundPayloadsToOutcome(ops, 'failure').ops;
      expect(failed).toHaveLength(1);
      expect((failed[0] as { op: string }).op).toBe('consume_asset');
    });

    it('lets a treaty written against holding it finally void by destruction', () => {
      // Before this an `asset_lost` condition could only fire because something
      // changed HANDS. A hostage could not be killed.
      let s = applyOps(
        seed(),
        [mint({ kind: 'hostage', quantity: 1, unit: 'person', text: 'The Vigil heir.' })],
        'model',
        'ojjul',
      ).state;
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

      const killed = applyOps(s, [{ op: 'consume_asset', assetId }], 'model', 'ojjul').state;
      expect(tickTurn(killed).state.treaties[0]!.status).toBe('voided');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Conservation                                                      */
  /* ---------------------------------------------------------------- */

  describe('conservation', () => {
    it('conserves worth across a split, for a settled value and a band', () => {
      for (const op of [
        mint(),
        mint({ kind: 'ore', quantity: 100, unit: 'ton', speculative: true, valuePerUnit: {}, valueRange: { meridian: { min: 2, max: 6 } } }),
      ]) {
        const s = applyOps(seed(), [op], 'model', 'ojjul').state;
        const a = s.assets[0]!;
        const who = a.speculative ? 'meridian' : 'vigil';
        const before = assetWorthRangeTo(a, who);
        const out = applyOps(
          s,
          [{ op: 'split_asset', assetId: a.id, quantity: Math.floor(a.quantity / 4) }],
          'model',
          'ojjul',
        );
        expect(out.rejections).toEqual([]);
        const after = out.state.assets.reduce(
          (acc, x) => {
            const band = assetWorthRangeTo(x, who);
            return { min: acc.min + band.min, max: acc.max + band.max };
          },
          { min: 0, max: 0 },
        );
        // Value is stated PER UNIT, so a split conserves by construction — the
        // arithmetic divides rather than a model being trusted to.
        expect(after).toEqual(before);
      }
    });

    it('carries the whole shape onto a split lot', () => {
      const s = applyOps(
        seed(),
        [mint({ kind: 'ore', quantity: 100, unit: 'ton', speculative: true, valuePerUnit: {}, valueRange: { meridian: { min: 2, max: 6 } } })],
        'model',
        'ojjul',
      ).state;
      const out = applyOps(
        s,
        [{ op: 'split_asset', assetId: s.assets[0]!.id, quantity: 40 }],
        'model',
        'ojjul',
      ).state;
      const [a, b] = out.assets;
      expect(a!.speculative).toBe(b!.speculative);
      expect(a!.valueRange).toEqual(b!.valueRange);
      expect(a!.kind).toBe(b!.kind);
      // And they are two records, not one written twice — the id collision that
      // shipped with assets made every one on a turn `ast-N-0`.
      expect(a!.id).not.toBe(b!.id);
    });

    it('moves worth rather than changing it, when a thing changes hands', () => {
      const s = applyOps(seed(), [mint()], 'model', 'ojjul').state;
      const a = s.assets[0]!;
      const worth = assetWorthTo(a, 'vigil');
      const out = applyOps(
        s,
        [{ op: 'transfer_asset', assetId: a.id, toFactionId: 'drajk' }],
        'model',
        'ojjul',
      ).state;
      // An asset has no intrinsic economic force: value is a claim, never money.
      // Nothing enters a ledger and nothing is minted by it moving.
      expect(assetWorthTo(out.assets[0]!, 'vigil')).toBe(worth);
      expect(out.factions.find((f) => f.id === 'drajk')!.credits).toBe(
        s.factions.find((f) => f.id === 'drajk')!.credits,
      );
      expect(out.factions.find((f) => f.id === 'ojjul')!.credits).toBe(
        s.factions.find((f) => f.id === 'ojjul')!.credits,
      );
    });

    it('gives every asset on a world to whoever takes it', () => {
      const s0 = seed();
      const home = world(s0);
      const s = applyOps(
        s0,
        [mint({ atSystemId: home.id }), mint({ kind: 'relic', quantity: 1, unit: 'relic', text: 'The Shalka crown.', atSystemId: home.id, valuePerUnit: {} })],
        'model',
        'ojjul',
      ).state;
      expect(s.assets).toHaveLength(2);
      const taken = applyOps(
        s,
        [{ op: 'transfer_control', systemId: home.id, toFactionId: 'vigil', reason: 'stormed' }],
        'engine',
      ).state;
      expect(taken.assets.every((a) => a.heldBy === 'vigil')).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /* The negotiation surface                                           */
  /* ---------------------------------------------------------------- */

  describe('the table', () => {
    it('shows a power what the other side holds that it wants, and nothing else', () => {
      const s = applyOps(
        seed(),
        [
          mint({ valuePerUnit: { vigil: 12 } }),
          mint({ kind: 'relic', quantity: 1, unit: 'relic', text: 'The Shalka crown.', valuePerUnit: {} }),
        ],
        'model',
        'ojjul',
      ).state;
      const toVigil = serializeTheirAssets(s, 'vigil', 'ojjul');
      expect(toVigil).toContain('Vigil crews taken off Vantic');
      // Listing a rival's whole warehouse would be an intelligence leak dressed
      // up as a shopping list.
      expect(toVigil).not.toContain('Shalka crown');
      expect(serializeTheirAssets(s, 'drajk', 'ojjul')).toContain('Nothing of theirs');
    });

    it('prices a speculative holding as a band on both sides of the table', () => {
      const s = applyOps(
        seed(),
        [mint({ kind: 'ore', quantity: 100, unit: 'ton', text: 'A seam under the Halland cut.', speculative: true, valuePerUnit: {}, valueRange: { meridian: { min: 2, max: 6 } } })],
        'model',
        'ojjul',
      ).state;
      expect(serializeTheirAssets(s, 'meridian', 'ojjul')).toContain('between 200 and 600');
      // And the holder is told the same thing, so neither side is bargaining
      // against a number the other cannot see.
      expect(serializeAssets(s, 'ojjul')).toContain('2–6 a ton, unsettled');
    });

    it('tells the holder how many plays an instrument has left', () => {
      const s = applyOps(
        seed(),
        [mint({ kind: 'writ', quantity: 1, unit: 'writ', text: 'A letter of marque.', valuePerUnit: { drajk: 90 } })],
        'model',
        'ojjul',
      ).state;
      expect(serializeAssets(s, 'ojjul')).toContain('played ONCE');
    });

    it('moves a thing out of the other power only when they named it', () => {
      const s = applyOps(seed(), [mint({ heldBy: 'ojjul' })], 'model', 'ojjul').state;
      const id = s.assets[0]!.id;
      const take = [{ op: 'transfer_asset', assetId: id, toFactionId: 'vigil' }];

      // The same rule a world follows: an asset is a RECORD, so "you can have
      // your people back" names no id and nothing downstream can pick which
      // haul was meant.
      const ungranted = groundInConcessions(s, take, [], 'ojjul');
      expect(ungranted.ops).toHaveLength(0);
      expect(ungranted.dropped[0]).toContain('never put it on the table');

      const granted = groundInConcessions(
        s,
        take,
        [{ by: 'ojjul', kind: 'return_prisoners', text: 'Your crews walk out.', systems: [], credits: 0, perTurn: 0, hulls: 0, assets: [id] }],
        'ojjul',
      );
      expect(granted.ops).toHaveLength(1);
    });

    it('lets a power give its own away with no record at all', () => {
      // Requiring one there would turn every one-sided concession into a dead
      // promise, which is the exact bug class this whole mechanism exists to end.
      const s = applyOps(seed(), [mint({ heldBy: 'ojjul' })], 'model', 'ojjul').state;
      const give = [{ op: 'transfer_asset', assetId: s.assets[0]!.id, toFactionId: 'vigil' }];
      expect(groundInConcessions(s, give, [], 'vigil').ops).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Guards, probed from both sides                                    */
  /* ---------------------------------------------------------------- */

  describe('guards', () => {
    it('refuses to mint into another power on the declared path, in either direction', () => {
      expect(applyOps(seed(), [mint({ heldBy: 'vigil' })], 'model', 'ojjul').rejections[0]?.code).toBe(
        'illegal_value',
      );
      expect(applyOps(seed(), [mint()], 'model', 'ojjul').rejections).toEqual([]);
    });

    it('halves a payoff on a partial and strips it on a failure', () => {
      expect(boundPayloadsToOutcome([mint()], 'failure').ops).toHaveLength(0);
      expect((boundPayloadsToOutcome([mint()], 'partial').ops[0] as { quantity: number }).quantity).toBe(20);
      expect(boundPayloadsToOutcome([mint()], 'critical_success').ops).toHaveLength(1);
    });

    it('refuses a fixture with nowhere to stand and a producer with no world', () => {
      expect(
        applyOps(seed(), [mint({ kind: 'shrine', quantity: 1, unit: 'works', portable: false })], 'model', 'ojjul')
          .rejections[0]?.code,
      ).toBe('illegal_value');
      expect(
        applyOps(
          seed(),
          [mint({ kind: 'still', quantity: 1, unit: 'works', yield: { kind: 'credits', perTurn: 8 } })],
          'model',
          'ojjul',
        ).rejections[0]?.code,
      ).toBe('illegal_value');
    });

    it('refuses to build a producing thing on ground nobody has reached', () => {
      const s = seed();
      const theirs = s.systems.find((x) => x.controllerFactionId === 'vigil')!;
      expect(hullsAt(theirs, 'ojjul')).toBe(0);
      const out = applyOps(
        s,
        [mint({ kind: 'exchange', quantity: 1, unit: 'works', valuePerUnit: {}, atSystemId: theirs.id })],
        'model',
        'ojjul',
      );
      expect(out.rejections[0]?.code).toBe('no_presence');

      // Ships over it are enough, the same line interdiction and suborning draw.
      setStackAt(theirs, 'ojjul', { battleship: 1 });
      expect(
        applyOps(
          s,
          [mint({ kind: 'exchange', quantity: 1, unit: 'works', valuePerUnit: {}, atSystemId: theirs.id })],
          'model',
          'ojjul',
        ).rejections,
      ).toEqual([]);
    });

    it('never mints an id twice, however many are made at once', () => {
      const s = applyOps(
        seed(),
        [mint(), mint({ kind: 'ore', unit: 'ton' }), mint({ kind: 'salvage', unit: 'ton' })],
        'model',
        'ojjul',
      ).state;
      const ids = s.assets.map((a) => a.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('keeps every asset valid under its own schema after a full turn', () => {
      const s0 = seed();
      const home = world(s0);
      let s = applyOps(
        s0,
        [
          mint({ atSystemId: home.id }),
          mint({ kind: 'mine', quantity: 1, unit: 'works', valuePerUnit: {}, atSystemId: home.id,
            yield: { kind: 'asset', perTurn: 20, assetKind: 'ore', unit: 'ton', text: 'Ore off the cut.', valuePerUnit: { meridian: 4 } } }),
        ],
        'model',
        'ojjul',
      ).state;
      s = tickTurn(s).state;
      s = tickTurn(s).state;
      // Everything the tick produced has to be a well-formed asset, or a save
      // written after it will not load.
      for (const a of s.assets) expectWellFormed(a);
      expect(s.assets.some((a) => a.kind === 'ore' && a.quantity === 40)).toBe(true);
    });
  });
  describe('a works can be run for two things at once', () => {
    // "Up to two" is the whole shape: a works is worth MAX_ASSET_STAT in total
    // and may spend it on one attribute or split it between two. At a budget of
    // 2 that is 2+0 or 1+1, which is why the cap on the split is two — a half
    // point does not exist on a 1–20 scale.
    const place = (kind: string) => {
      const s = seed();
      const out = applyOps(
        s,
        [mint({ kind, quantity: 1, unit: 'works', valuePerUnit: {}, atSystemId: world(s).id })],
        'model',
        'ojjul',
      );
      expect(out.rejections).toEqual([]);
      return out.state.assets[0]!.yield as { kind: 'stat'; stats: { stat: string; points: number }[] };
    };

    it('splits one budget evenly when a kind names two attributes', () => {
      const plain = place('exchange');
      expect(plain.stats).toEqual([{ stat: 'influence', points: MAX_ASSET_STAT }]);

      const split = place('black_market');
      expect(split.stats).toEqual([
        { stat: 'influence', points: 1 },
        { stat: 'guile', points: 1 },
      ]);
      // The same total either way — the split is a trade, not a bonus.
      const sum = (y: typeof split) => y.stats.reduce((n, t) => n + t.points, 0);
      expect(sum(split)).toBe(sum(plain));
    });

    it('trims a works that tries to be worth more by spreading', () => {
      const s = seed();
      const out = applyOps(
        s,
        [mint({
          kind: 'grand_works', quantity: 1, unit: 'works', valuePerUnit: {},
          atSystemId: world(s).id, portable: false,
          yield: { kind: 'stat', stats: [{ stat: 'might', points: 2 }, { stat: 'guile', points: 2 }] },
        })],
        'model',
        'ojjul',
      );
      const y = out.state.assets[0]!.yield as { stats: { stat: string; points: number }[] };
      expect(y.stats.reduce((n, t) => n + t.points, 0)).toBe(MAX_ASSET_STAT);
      expect(out.notes.join(' ')).toMatch(/a works is worth 2 however it is split/);
    });

    it('merges a stat named twice rather than paying it twice', () => {
      const s = seed();
      const out = applyOps(
        s,
        [mint({
          kind: 'doubled_works', quantity: 1, unit: 'works', valuePerUnit: {},
          atSystemId: world(s).id, portable: false,
          yield: { kind: 'stat', stats: [{ stat: 'guile', points: 1 }, { stat: 'guile', points: 1 }] },
        })],
        'model',
        'ojjul',
      );
      const y = out.state.assets[0]!.yield as { stats: { stat: string; points: number }[] };
      expect(y.stats).toEqual([{ stat: 'guile', points: 2 }]);
    });
  });
});

/**
 * The four the seed ships, pinned.
 *
 * Every other test in this file strips them, so without this nothing would
 * check that the opening board is well-formed — and a seeded asset is the one
 * kind that never passes through `create_asset`, so the reducer's own
 * corrections are not there to catch a malformed one.
 */


describe('the opening board gives every power something to bargain with', () => {
  const opening = () => createSeedState('drajk');

  it('holds one each, and nothing for the Combine', () => {
    const s = opening();
    const holders = s.assets.map((a) => a.heldBy).sort();
    expect(holders).toEqual(['drajk', 'freeworlds', 'meridian', 'vigil']);
    // Its shelf is the paper: three debts, and `assign_debt` sells one.
    expect(s.assets.some((a) => a.heldBy === 'ojjul')).toBe(false);
    expect(s.debts.filter((d) => d.creditorFactionId === 'ojjul')).toHaveLength(3);
  });

  it('is well-formed, which nothing else would catch', () => {
    for (const a of opening().assets) expectWellFormed(a);
  });

  it('pays nobody, because these exist to be traded and not to earn', () => {
    // A seeded yield would be four new income streams on a board whose balance
    // is already measured. `ledgerFor` reads `assetYield`, so this is the line
    // between "something to trade" and "a change to the economy".
    for (const a of opening().assets) expect(a.yield).toBeNull();
  });

  it('can be taken, because each one stands on a world', () => {
    const s = opening();
    for (const a of s.assets) {
      expect(a.atSystemId).not.toBeNull();
      // And on a world its own holder controls, or it would already be lost.
      const at = s.systems.find((x) => x.id === a.atSystemId)!;
      expect(at.controllerFactionId).toBe(a.heldBy);
    }
  });

  it('is worth several times more to somebody else than to its holder', () => {
    // The whole of gains-from-trade, and the reason `valuePerUnit` is keyed by
    // faction at all. A shelf of things worth the same to everyone is a shelf
    // nobody has a reason to bargain over.
    for (const a of opening().assets) {
      if (a.speculative) {
        const bands = Object.entries(a.valueRange);
        expect(bands.length).toBeGreaterThan(0);
        // Nobody values it who is not a rival: a band for its own holder would
        // be the holder pricing its own shelf.
        expect(bands.map(([id]) => id)).not.toContain(a.heldBy);
        continue;
      }
      const mine = a.valuePerUnit[a.heldBy] ?? 0;
      const best = Math.max(...Object.values(a.valuePerUnit));
      expect(best).toBeGreaterThanOrEqual(mine * 3);
    }
  });

  it('is worth roughly the same to each best buyer, so nobody opens ahead', () => {
    const worth = opening().assets.map((a) =>
      a.speculative
        ? Math.max(...Object.values(a.valueRange).map((b) => ((b.min + b.max) / 2) * a.quantity))
        : Math.max(...Object.values(a.valuePerUnit)) * a.quantity,
    );
    // About two battleships each. Loose on purpose — the property is that no
    // opening position is decided by what it happens to be holding, not that
    // the four are equal to the credit.
    for (const w of worth) {
      expect(w).toBeGreaterThan(400);
      expect(w).toBeLessThan(560);
    }
  });
});

/** Every invariant an asset carries, in one place. */
function expectWellFormed(a: Asset): void {
  expect(a.id).toMatch(/^ast-\d+-\d+$/);
  expect(a.kind).toMatch(/^[a-z][a-z0-9_]*$/);
  expect(a.quantity).toBeGreaterThan(0);
  expect(a.text.length).toBeGreaterThan(0);
  // Exactly one opinion about worth.
  if (a.speculative) expect(a.valuePerUnit).toEqual({});
  else expect(a.valueRange).toEqual({});
  // A fixture or a producer has to stand somewhere it can be taken.
  if (!a.portable) expect(a.atSystemId).not.toBeNull();
  if (a.yield !== null) expect(a.atSystemId).not.toBeNull();
  if (a.uses !== null) expect(a.uses).toBeGreaterThan(0);
}
