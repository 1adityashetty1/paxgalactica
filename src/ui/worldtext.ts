import type { WorldType } from '../domain/state.js';

/**
 * A line about what a world is like, keyed on what it is and who settled it.
 *
 * The System panel could say `Arid` and `Ground counts toward: might` and
 * nothing joined the two — a player read a type, read a stat, and had to take
 * on faith that one produced the other. This is the sentence that makes the
 * modifier legible: dry ground breeds hard soldiers, a world that never sleeps
 * cannot be policed, a place that is difficult to live in is difficult to
 * break.
 *
 * **Keyed on (type, founder), not on the world.** `homeFactionId` never changes
 * — it is who held the world at turn 0 and therefore whose institutions built
 * whatever is standing on it — so the text stays true after a conquest, which
 * is exactly when it is most worth reading. A world does not stop being an
 * Imperial fuel depot because Drajk took it; that is the whole of what the
 * occupation cost is charging for.
 *
 * **Authored, not generated**, the same call `ASSET_ARCHETYPES` and
 * `COMMANDER_ARCHETYPES` make. Generation is right where the only thing being
 * varied is identity — a commander's name — and wrong here, where the line has
 * to say something true about a specific power's relationship to a specific
 * kind of ground. Twenty-two pairs is a table somebody can read and fix.
 *
 * Variants exist only where one pair covers several worlds: the seed has three
 * unaligned ice worlds, and three identical paragraphs in a panel read as a
 * bug. Picked by a hash of the system id, so the same world always says the
 * same thing and a replay cannot disagree with the campaign.
 */

type Key = `${WorldType}|${string}`;

const FLAVOUR: Partial<Record<Key, string[]>> = {
  /* --- arid: might. Hard ground, and the people it makes. ------------- */
  'arid|freeworlds': [
    'Dust and iron, nine generations deep. The Arkane bury their dead in the dry and count them, and the counting is most of what the Drift means by an army.',
  ],
  'arid|ojjul': [
    'Scrub and salt flats the Combine never troubled to green. What it grows instead is people who have carried a rifle since they could hold one, and the Nar hire them out at a markup.',
  ],
  'arid|vigil': [
    'Imperial ground run to red rock and parade squares. The Vigil drills here because the climate does half the work of it.',
  ],
  'arid|unaligned': [
    'Nobody’s dust. The militia was raised by whoever owned the last working well, and it has never lost a fight on its own ground.',
  ],

  /* --- earthlike: influence. Where the populations and politics are. --- */
  'earthlike|meridian': [
    'Temperate, well-lawyered, and full of people with opinions about tariffs. The Authority’s board sits here, which is why its word carries further than its fleet.',
  ],
  'earthlike|ojjul': [
    'Warm, close, and related to everybody. The Combine does not govern the Approach so much as stay for dinner, and the dinners are where the Rim is actually settled.',
  ],
  'earthlike|freeworlds': [
    'Green, crowded and argumentative. Every Watch of the Arkane came out of a Delvane council chamber, and every one of them had to win it twice.',
  ],
  'earthlike|vigil': [
    'The most habitable world the Vigil still holds and the one it least understands. Its people are citizens on paper, and the Legates find the paper sufficient.',
  ],

  /* --- earthnight: guile. A world that never sleeps. ------------------- */
  'earthnight|meridian': [
    'The Authority’s night market, which is also its clearing house. Half the Rim’s cargo is re-papered here between one shift and the next.',
  ],
  'earthnight|ojjul': [
    'Ten million lights and not one of them official. The Nar keep no ledger on Shalka a stranger could read, which is the point of Shalka.',
  ],
  'earthnight|freeworlds': [
    'The Drift’s own, lit end to end and awake at every hour. Arkane independence sprouted from whispers in gamehouses that dot its surface.',
  ],
  'earthnight|vigil': [
    'Imperial by daylight and something else after it. The Legates usurped the local crime lords, and found new uses their talents.',
  ],

  /* --- industrialmoon / gasgiant: industry. Extraction and production. - */
  'industrialmoon|meridian': [
    'A worked moon under a ring of yards, running three shifts and owing money on all of them. The Authority builds here and bills by the ton.',
    'Ore, smelters, and a dock long enough to take a capital hull. Nothing on it is old and nothing on it is idle.',
  ],
  'industrialmoon|drajk': [
    'A stripped moon the Confederacy took over rather than built. The yards still work; nobody has repainted anything, and nobody intends to.',
  ],
  'gasgiant|vigil': [
    'Imperial fuel, and the last of it. The Deep keeps the Vigil’s capital ships under way, and the Legates know exactly how many seasons it has left.',
  ],
  'gasgiant|drajk': [
    'A great dead giant the Confederacy taps and does not settle. Everything Drajk burns comes off it, and everyone who works it expects to leave.',
  ],
  'gasgiant|unaligned': [
    'Skimmers in the high cloud and no flag over them. Whoever is parked in the orbit that quarter takes the cut.',
  ],

  /* --- ice / oceanic: resolve. Hard to live on, hard to break. --------- */
  'ice|drajk': [
    'Frozen through and honeycombed with holds. Drajk crews waylay here because nothing follows them in and nothing profitable comes out.',
  ],
  'ice|unaligned': [
    'Ice, and a settlement that has outlasted three flags by never flying one.',
    'A cold anchorage with a town under it. It has been asked to submit twice in living memory and the answer did not change.',
    'Nine metres of ice over everything that matters. Whatever you bring, it has already been colder.',
  ],
  'oceanic|freeworlds': [
    'Deep water and floating townships, fed by what it can catch. The Arkane cannot be starved off Vashka, and they will drown those who try.',
  ],
  'oceanic|ojjul': [
    'Warm ocean and shallow banks the Combine has farmed for six generations. It feeds itself, so it has never needed to be reasonable.',
  ],
  'oceanic|drajk': [
    'Storm ocean and hulls moored in the lee of it. Vergesse is the closest thing the Confederacy has to a home, and it is not close.',
  ],
};

/** Said of a world nobody has written a line for yet. Keyed on type alone. */
const BY_TYPE: Record<WorldType, string> = {
  arid: 'Dry ground and thin air. Places like this raise soldiers because there is little else to raise.',
  earthlike: 'Temperate and settled. Where there are people in numbers there are factions, and where there are factions there is leverage.',
  earthnight: 'Lit end to end and awake at every hour. A world that never sleeps is a world that cannot be watched.',
  oceanic: 'Deep water, and a population that feeds itself off it. Hard to starve, and therefore hard to move.',
  ice: 'Frozen and inhabited anyway, which tells you most of what you need to know about the people.',
  industrialmoon: 'A worked moon, ringed with yards. Everything here exists to make something else.',
  gasgiant: 'A giant with skimmers in its cloud tops. Fuel and volatiles, and nowhere to stand.',
};

/**
 * A stable index into a variant list.
 *
 * Deliberately not `rollD20` — that is seeded on the TURN, and a world's
 * character must not change because time passed. The id alone is the seed, so
 * the line is a property of the place.
 */
function pick(systemId: string, count: number): number {
  if (count <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < systemId.length; i++) {
    h ^= systemId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % count;
}

/** One line about a world, given what it is and who built on it. */
export function worldFlavour(
  systemId: string,
  worldType: WorldType,
  homeFactionId: string | null,
): string {
  const key: Key = `${worldType}|${homeFactionId ?? 'unaligned'}`;
  const lines = FLAVOUR[key];
  if (lines && lines.length > 0) return lines[pick(systemId, lines.length)]!;
  return BY_TYPE[worldType];
}

/** Exported so a test can hold the table to the seed rather than to itself. */
export const FLAVOUR_KEYS = Object.keys(FLAVOUR) as Key[];
