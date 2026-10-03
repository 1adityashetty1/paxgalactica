import { describe, expect, it } from 'vitest';
import { fixtureLines, peaceLines, shipClassLines, spanLines } from '../src/ui/helptext.js';
import { CREDITS_PER_TON, HULL_CLASSES, HULL_SPEC } from '../src/domain/hulls.js';
import { FIXTURE_COST, FIXTURE_UPKEEP, MAX_FIXTURE_BONUS } from '../src/domain/diplomacy.js';
import { ASSET_ARCHETYPES } from '../src/domain/assets.js';
import { WORLD_TYPE_STAT, fixtureSlotRefusal, type WorldType } from '../src/domain/state.js';
import { worldTypeLabel } from '../src/ui/worldtext.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * The help text's numbers are the game's numbers. The section these replaced
 * said "four hull classes" for as long as there were six; prose about a table
 * goes stale without anyone noticing, so these lines are generated and this
 * holds them to the tables they are generated from.
 */
describe('the help text', () => {
  const ships = shipClassLines().join('\n');

  it('lists every ship class at the price the yards charge', () => {
    for (const hull of HULL_CLASSES) {
      const { label, tonnage } = HULL_SPEC[hull];
      expect(ships).toMatch(new RegExp(`${label}\\s+${tonnage}t\\s+${tonnage * CREDITS_PER_TON}cr`));
    }
  });

  it('keeps every line as narrow as the prose around it, so the table does not wrap', () => {
    for (const line of [
      ...shipClassLines(),
      ...fixtureLines(createSeedState('meridian')),
      ...spanLines(),
      ...peaceLines(),
    ]) {
      expect(line.length, line).toBeLessThanOrEqual(76);
    }
  });

  it('says which classes cannot fight', () => {
    // Lifters, freighters and listeners carry a nominal weight so a battle has
    // something to destroy; none of them is a warship.
    expect(ships).toMatch(/Lifters, freighters and listeners cannot fight/);
  });

  const fixtures = fixtureLines(createSeedState('vigil')).join('\n');

  it('names every kind of ground under the stat it raises', () => {
    for (const type of Object.keys(WORLD_TYPE_STAT) as WorldType[]) {
      const line = fixtures.split('\n').find((l) => l.trim().startsWith(WORLD_TYPE_STAT[type]));
      expect(line, type).toContain(worldTypeLabel(type));
    }
  });

  it('quotes the price, the ceiling and the rising bill', () => {
    expect(fixtures).toContain(`${FIXTURE_COST} credits`);
    expect(fixtures).toContain(`at most +${MAX_FIXTURE_BONUS}`);
    expect(fixtures).toContain(
      `your first costs ${FIXTURE_UPKEEP} a turn, your second ${2 * FIXTURE_UPKEEP}, your third ${3 * FIXTURE_UPKEEP}`,
    );
  });

  it("suggests a fixture the player could actually build, for every power", () => {
    for (const id of ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk']) {
      const s = createSeedState(id);
      const tryLine = fixtureLines(s).find((l) => l.trim().startsWith('Try:'))!;
      const match = /Build an? (.+) at (.+)\.$/.exec(tryLine)!;
      const site = s.systems.find((x) => x.name === match[2])!;
      expect(site.controllerFactionId, id).toBe(id);
      const kind = ASSET_ARCHETYPES.find((a) => a.kind === match[1]!.replace(/ /g, '_'))!;
      expect(fixtureSlotRefusal(s, site, kind.kind), id).toBeNull();
      expect(kind.modifies, id).toContain(WORLD_TYPE_STAT[site.worldType]);
    }
  });
});
