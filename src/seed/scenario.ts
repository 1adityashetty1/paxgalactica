import type { FactionStats } from '../domain/checks.js';
import type { DurationCategory } from '../domain/duration.js';
import {
  WorldStateSchema,
  type Faction,
  type StarSystem,
  type TradeEthic,
  type WarEthic,
  type WorldState,
} from '../domain/state.js';

/**
 * The Outer Rim seed: 25 systems across four sectors, five powers, no calendar.
 *
 * Coordinates are laid out on a ~110x36 plane chosen so the galaxy view fits a
 * normal terminal without the sectors overlapping, and so each sector has at
 * least one obvious chokepoint into its neighbours.
 */

export const SECTORS = [
  'Arkanis Drift',
  'Sluis Verge',
  'Tion Marches',
  'Kessel Fringe',
] as const;

interface SeedSystem {
  id: string;
  name: string;
  sector: string;
  x: number;
  y: number;
  controller: string | null;
  garrison: number;
  value: number;
}

const SEED_SYSTEMS: SeedSystem[] = [
  // --- Arkanis Drift (west): the Free Worlds heartland, poor and stubborn ---
  { id: 'ark-1', name: 'Arkanis Prime', sector: 'Arkanis Drift', x: 8, y: 6, controller: 'freeworlds', garrison: 14, value: 7 },
  { id: 'ark-2', name: 'Sennex', sector: 'Arkanis Drift', x: 18, y: 3, controller: null, garrison: 4, value: 4 },
  { id: 'ark-3', name: 'Dolomar', sector: 'Arkanis Drift', x: 10, y: 14, controller: 'freeworlds', garrison: 9, value: 5 },
  { id: 'ark-4', name: 'Vashka', sector: 'Arkanis Drift', x: 22, y: 11, controller: 'freeworlds', garrison: 11, value: 6 },
  { id: 'ark-5', name: 'Tulgarn', sector: 'Arkanis Drift', x: 6, y: 21, controller: 'krayt', garrison: 7, value: 3 },
  { id: 'ark-6', name: 'Pell Reach', sector: 'Arkanis Drift', x: 20, y: 20, controller: 'freeworlds', garrison: 6, value: 4 },

  // --- Sluis Verge (north centre): Meridian's trade spine ---
  { id: 'slu-1', name: 'Sluis Gate', sector: 'Sluis Verge', x: 34, y: 7, controller: 'meridian', garrison: 16, value: 9 },
  { id: 'slu-2', name: 'Corvid', sector: 'Sluis Verge', x: 45, y: 3, controller: 'meridian', garrison: 10, value: 6 },
  { id: 'slu-3', name: 'Ithaal', sector: 'Sluis Verge', x: 40, y: 13, controller: null, garrison: 5, value: 5 },
  { id: 'slu-4', name: 'Brannix', sector: 'Sluis Verge', x: 53, y: 8, controller: 'meridian', garrison: 13, value: 6 },
  { id: 'slu-5', name: 'Var Hollow', sector: 'Sluis Verge', x: 50, y: 17, controller: null, garrison: 3, value: 4 },
  { id: 'slu-6', name: 'Neth', sector: 'Sluis Verge', x: 31, y: 16, controller: null, garrison: 4, value: 3 },

  // --- Tion Marches (east): the Iron Vigil, an Empire that never heard it lost ---
  { id: 'tio-1', name: 'Tion Anchorage', sector: 'Tion Marches', x: 66, y: 6, controller: 'meridian', garrison: 9, value: 7 },
  { id: 'tio-2', name: 'Kalzir', sector: 'Tion Marches', x: 78, y: 3, controller: 'vigil', garrison: 15, value: 6 },
  { id: 'tio-3', name: 'Ord Vantic', sector: 'Tion Marches', x: 72, y: 14, controller: 'vigil', garrison: 18, value: 9 },
  { id: 'tio-4', name: 'Ghorman Deep', sector: 'Tion Marches', x: 89, y: 9, controller: 'vigil', garrison: 12, value: 7 },
  { id: 'tio-5', name: 'Sarsuma', sector: 'Tion Marches', x: 98, y: 16, controller: 'vigil', garrison: 8, value: 5 },
  { id: 'tio-6', name: 'Threx', sector: 'Tion Marches', x: 83, y: 19, controller: 'krayt', garrison: 6, value: 4 },

  // --- Kessel Fringe (south): Hutt spice country and the raider lanes ---
  { id: 'kes-1', name: 'Kessel Approach', sector: 'Kessel Fringe', x: 25, y: 28, controller: 'hutt', garrison: 11, value: 8 },
  { id: 'kes-2', name: 'Nar Shalka', sector: 'Kessel Fringe', x: 37, y: 32, controller: 'hutt', garrison: 14, value: 9 },
  { id: 'kes-3', name: 'Riqel', sector: 'Kessel Fringe', x: 49, y: 26, controller: 'hutt', garrison: 8, value: 6 },
  { id: 'kes-4', name: 'Byss Marker', sector: 'Kessel Fringe', x: 61, y: 32, controller: null, garrison: 2, value: 3 },
  { id: 'kes-5', name: 'Oridin', sector: 'Kessel Fringe', x: 73, y: 27, controller: 'hutt', garrison: 7, value: 5 },
  { id: 'kes-6', name: 'Vergesse', sector: 'Kessel Fringe', x: 87, y: 31, controller: 'krayt', garrison: 9, value: 7 },
  { id: 'kes-7', name: 'Hollow Star', sector: 'Kessel Fringe', x: 13, y: 32, controller: 'krayt', garrison: 5, value: 3 },
];

/** Undirected hyperlanes. Declared once; the graph builder symmetrises them. */
const LANES: [string, string][] = [
  // Arkanis Drift
  ['ark-1', 'ark-2'], ['ark-1', 'ark-3'], ['ark-2', 'ark-4'], ['ark-3', 'ark-4'],
  ['ark-3', 'ark-5'], ['ark-4', 'ark-6'], ['ark-5', 'ark-6'],
  // Sluis Verge
  ['slu-1', 'slu-2'], ['slu-1', 'slu-3'], ['slu-1', 'slu-6'], ['slu-2', 'slu-4'],
  ['slu-3', 'slu-4'], ['slu-3', 'slu-5'], ['slu-4', 'slu-5'], ['slu-3', 'slu-6'],
  // Tion Marches
  ['tio-1', 'tio-2'], ['tio-1', 'tio-3'], ['tio-2', 'tio-4'], ['tio-3', 'tio-4'],
  ['tio-3', 'tio-6'], ['tio-4', 'tio-5'], ['tio-5', 'tio-6'],
  // Kessel Fringe
  ['kes-7', 'kes-1'], ['kes-1', 'kes-2'], ['kes-2', 'kes-3'], ['kes-2', 'kes-4'],
  ['kes-3', 'kes-4'], ['kes-4', 'kes-5'], ['kes-5', 'kes-6'],
  // Inter-sector chokepoints
  ['ark-2', 'slu-1'], ['ark-4', 'slu-6'],
  ['ark-5', 'kes-7'], ['ark-6', 'kes-1'],
  ['slu-4', 'tio-1'], ['slu-2', 'tio-1'],
  ['slu-5', 'kes-3'], ['slu-6', 'kes-2'],
  ['tio-3', 'kes-5'], ['tio-6', 'kes-6'],
];

interface SeedFaction {
  id: string;
  name: string;
  color: number;
  fleet: number;
  credits: number;
  doctrine: string;
  stats: FactionStats;
  voice: string;
  warEthic: WarEthic;
  tradeEthic: TradeEthic;
  redLines: string[];
  compulsions: string[];
  buildBias: DurationCategory[];
}

/**
 * Five powers who should never be mistaken for one another.
 *
 * Each differs on four axes at once — how it speaks, what it will fight for,
 * how it makes money, and what it reaches for when it builds — because a
 * faction that differs only in its doctrine paragraph ends up sounding like
 * every other faction the moment a conversation gets specific.
 *
 * Stats are deliberately lopsided. A power that is good at everything makes
 * every check the same check.
 */
const SEED_FACTIONS: SeedFaction[] = [
  {
    id: 'meridian',
    name: 'Meridian Trade Authority',
    color: 45,
    fleet: 42,
    credits: 2400,
    doctrine:
      'Commerce is sovereignty. Keep the lanes open, buy what cannot be bought cheaply, and never fight a war a tariff could have won.',
    stats: { might: 10, guile: 13, industry: 16, influence: 17, resolve: 9 },
    voice:
      'Speaks like a contract clause: precise, faintly bored, quantifying everything. Prefers euphemism for unpleasantness — war is "disruption", conquest is "consolidation", a bribe is "a facilitation fee". Never raises its voice and never says anything it could not defend in arbitration. Offers numbers, deadlines and instruments, not sentiments.',
    warEthic: 'defensive',
    tradeEthic: 'free_trade',
    redLines: [
      'will not blockade civilian traffic — closed lanes are bad for everyone, including the closer',
      'will not repudiate a contract it has signed, even a ruinous one; its whole value rests on that',
    ],
    compulsions: [
      'the Trade Council requires open lanes: prolonged blockades, embargoes or closed borders will be voted down',
      'commerce raiding is refused outright — the Authority insures the cargo it would be seizing, and preying on shipping ends it as a going concern',
      'trafficking in spice, slaves or proscribed weapons is refused outright — shareholders will not launder it, whatever it pays',
      'an unprofitable quarter demands a plan; sitting on the treasury while income falls invites a vote of no confidence',
    ],
    buildBias: ['construction_infrastructure', 'treaty_ratification', 'retooling'],
  },
  {
    id: 'vigil',
    name: 'Iron Vigil Remnant',
    color: 160,
    fleet: 55,
    credits: 900,
    doctrine:
      'The Empire did not fall; it withdrew. Hold the Tion until order is restored, answer insolence with force, and treat negotiation as a delay.',
    stats: { might: 18, guile: 11, industry: 13, influence: 6, resolve: 17 },
    voice:
      'Clipped military formality. Speaks of "the Empire" in the present tense. Addresses others by rank, or not at all — a leader without a commission is barely addressed. Uses the passive voice for atrocities: worlds "were pacified". Openly contemptuous of merchants, pirates and anyone who negotiates rather than obeys. Does not use contractions.',
    warEthic: 'crusading',
    tradeEthic: 'autarkic',
    redLines: [
      'will not accept payment to stand down; being bought is the insult, not the price',
      'will not recognise a rebel government as legitimate, whatever it controls',
    ],
    compulsions: [
      'the fleet commanders require action against rebel-held Imperial ground; passivity while insurgents hold it is read as complicity',
      'insults to the Empire must be answered within a turn or two, or the officer corps answers them without you',
      'no accommodation with pirates, smugglers or the Hutts may be entertained, however useful',
      'the officer corps will not turn pirate: raiding commerce is what the Confederacy does, and the Empire does not imitate it whatever the arithmetic says',
    ],
    buildBias: ['capital_ship_construction', 'fortification', 'garrison_raising'],
  },
  {
    id: 'hutt',
    name: 'Ojjul Hutt Combine',
    color: 208,
    fleet: 30,
    credits: 3600,
    doctrine:
      'Everything has a price and every price is negotiable. Fund both sides, own the survivor, and let other powers spend their fleets for you.',
    stats: { might: 9, guile: 18, industry: 12, influence: 15, resolve: 11 },
    voice:
      'Expansive and unhurried, savouring the conversation. Compliments first, terms second, threats last and always wrapped in courtesy. Uses your name often, warmly, like a man reminding you he knows it. Speaks of debts, favours and obligations rather than prices. Never refuses outright — simply names a figure you cannot meet and waits.',
    warEthic: 'mercenary',
    tradeEthic: 'extortionist',
    redLines: [
      'will not fight its own war where a proxy could be hired to fight it instead',
      'will not forgive an unpaid debt — the debt is the whole instrument of control',
    ],
    compulsions: [
      'the Combine requires that every favour carry a price; giving something away for goodwill is refused as ruinous precedent',
      'an unpaid debt must be pursued — forgiving one invites every client to test the next',
      'the Combine will not commit its own hulls where a hired one would do',
    ],
    buildBias: ['espionage', 'political_maneuver', 'blockade'],
  },
  {
    id: 'freeworlds',
    name: 'Arkanis Free Worlds',
    color: 76,
    fleet: 26,
    credits: 1100,
    doctrine:
      'We were left to die out here and did not. Defend the Drift, take no master, and make occupation cost more than it is worth.',
    stats: { might: 11, guile: 12, industry: 10, influence: 10, resolve: 19 },
    voice:
      'Plain and blunt, stripped of ornament. Short sentences. Says "we" where other powers say "I", because no one here speaks alone. Deeply suspicious of fine words and says so to your face. Will name a hard truth rather than soften it and will not apologise for the naming. Uses farming and mining metaphors, never courtly ones.',
    warEthic: 'defensive',
    tradeEthic: 'autarkic',
    redLines: [
      'will never accept occupation or a protectorate, on any terms, however generous',
      'will not sell out another free world to buy its own safety',
    ],
    compulsions: [
      'the councils require consultation: any pact ceding territory, autonomy or basing rights is refused without their consent',
      'no world of the Drift may be abandoned to occupation to buy safety elsewhere',
      'tribute is refused. The Drift does not pay to be left alone, whatever the arithmetic says',
      'the Drift does not prey on shipping. Being raided is the grievance the Free Worlds were founded on, and doing it would make the founding a lie',
    ],
    buildBias: ['fortification', 'garrison_raising', 'counter_intelligence'],
  },
  {
    id: 'krayt',
    name: 'Krayt Confederacy',
    color: 141,
    fleet: 22,
    credits: 700,
    doctrine:
      'Borders are a fiction maintained by people with fleets. Raid the rich, vanish into the deep lanes, and never hold ground worth besieging.',
    // Peaks on might, not guile — the Hutts own guile, and two factions with
    // the same strongest stat and the same build instinct play identically.
    // Krayt are raiders: their edge is the strike, not the long con.
    stats: { might: 15, guile: 14, industry: 7, influence: 8, resolve: 12 },
    voice:
      'Terse and mocking, often in fragments. Calls everyone by a nickname they did not choose and will not stop when asked. Treats laws, borders and titles as a joke everyone else is too slow to get. Visibly bored by long speeches and says so mid-sentence. Boasts, then undercuts the boast before you can.',
    warEthic: 'opportunist',
    tradeEthic: 'smuggler',
    redLines: [
      'will not hold a siege line or garrison a world — being pinned down is how raiders die',
      'will not put its name to a written treaty; a handshake it can deny is the most it offers',
    ],
    compulsions: [
      'the captains require plunder: a stretch of quiet with no raid, no prize and no payout and they take ships elsewhere',
      'no captain will hold a siege line, garrison a world, or sit still to be besieged',
      'nothing gets signed. Written commitments are refused as a matter of principle and self-preservation',
    ],
    buildBias: ['commerce_raiding', 'refit', 'espionage'],
  },
];

/** Starting opinions. Asymmetric on purpose: contempt is rarely mutual. */
const DISPOSITIONS: Record<string, Record<string, number>> = {
  meridian: { vigil: -35, hutt: 15, freeworlds: 10, krayt: -55 },
  vigil: { meridian: -20, hutt: -45, freeworlds: -60, krayt: -70 },
  hutt: { meridian: 25, vigil: -40, freeworlds: -5, krayt: 20 },
  freeworlds: { meridian: 5, vigil: -75, hutt: -15, krayt: -30 },
  krayt: { meridian: -40, vigil: -50, hutt: 30, freeworlds: -10 },
};

/**
 * A controller's opening squadron, scaled to what the world is worth holding.
 *
 * Fleets are no longer a global number — a faction's navy is the sum of these,
 * so the seed has to distribute it rather than declare it.
 */
function startingShips(s: SeedSystem): number {
  return Math.max(2, Math.round(s.value * 1.4));
}

function buildSystems(): StarSystem[] {
  const edges = new Map<string, Set<string>>();
  for (const s of SEED_SYSTEMS) edges.set(s.id, new Set());
  for (const [a, b] of LANES) {
    edges.get(a)?.add(b);
    edges.get(b)?.add(a);
  }
  return SEED_SYSTEMS.map((s) => ({
    id: s.id,
    name: s.name,
    sector: s.sector,
    coords: { x: s.x, y: s.y },
    controllerFactionId: s.controller,
    garrison: s.garrison,
    // The seeded garrison IS the ceiling: each world's own design decides how
    // heavily it can arm itself, and a captured one regrows toward that.
    garrisonMax: s.garrison,
    strategicValue: s.value,
    hyperlaneEdges: [...(edges.get(s.id) ?? [])].sort(),
    // A controller starts with a token squadron in orbit, scaled to how much
    // the world is worth holding. Nobody starts contested.
    ships: s.controller ? { [s.controller]: startingShips(s) } : {},
  }));
}

function buildFactions(): Faction[] {
  return SEED_FACTIONS.map((f) => ({
    id: f.id,
    name: f.name,
    displayColor: f.color,
    disposition: { ...(DISPOSITIONS[f.id] ?? {}) },
    credits: f.credits,
    doctrine: f.doctrine,
    stats: { ...f.stats },
    voice: f.voice,
    warEthic: f.warEthic,
    tradeEthic: f.tradeEthic,
    redLines: [...f.redLines],
    compulsions: [...f.compulsions],
    dissent: 0,
    buildBias: [...f.buildBias],
  }));
}

export function playableFactions(): { id: string; name: string; color: number; doctrine: string }[] {
  return SEED_FACTIONS.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    doctrine: f.doctrine,
  }));
}

/** Build turn-0 state for a chosen faction. Validated before it escapes. */
export function createSeedState(playerFactionId: string): WorldState {
  if (!SEED_FACTIONS.some((f) => f.id === playerFactionId)) {
    throw new Error(
      `Unknown faction "${playerFactionId}". Choose one of: ${SEED_FACTIONS.map((f) => f.id).join(', ')}.`,
    );
  }

  const state: WorldState = {
    factions: buildFactions(),
    systems: buildSystems(),
    pendingOrders: [],
    treaties: [],
    commitments: [],
    agents: [],
    playerFactionId,
    turn: 0,
    eventLog: [
      {
        turn: 0,
        kind: 'system',
        factionId: null,
        text: 'The Outer Rim wakes to no authority worth the name. Four sectors, five powers, and lanes nobody polices.',
      },
    ],
  };

  return WorldStateSchema.parse(state);
}
