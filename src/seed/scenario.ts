import type { FactionStats } from '../domain/checks.js';
import type { DurationCategory } from '../domain/duration.js';
import {
  WorldStateSchema,
  type CompulsionTrigger,
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
 *
 * The `id` on each faction below is an opaque internal key, not a name — it
 * appears throughout the reducer, tests and save files, and was deliberately
 * left alone when the display names changed. `hutt` now displays as "Ojjul Nar
 * Combine" and `krayt` as "Drajk Confederacy"; see the reference table in
 * CLAUDE.md ("Faction character") if that mismatch is confusing.
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

  // --- Kessel Fringe (south): Nar spice country and the raider lanes ---
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
  /**
   * A bare string for a compulsion enforced only by refusal; `{text, trigger}`
   * for one that also fires on drift. Both shapes are normalised by
   * `CompulsionSchema` when the seed is parsed.
   */
  compulsions: (string | { text: string; trigger: CompulsionTrigger })[];
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
      'ARCHETYPE: a Wall Street trading-floor broker. Fast, transactional, always closing. Talks in spreads, exposure, downside, haircuts, counterparties, basis points, the book. Calls you "friend" in the same breath as repricing you. Opens mid-thought — "Look —", "Here\'s where we are". Frames war as a bad trade and scruples as an unpriced risk. Every offer has an expiry and says so. Sample: "Look, your position at Neth is underwater and we both know it. I\'ll take the exposure off your hands at sixty on the credit — that\'s me doing you a favour, and it decays at close of turn."',
    warEthic: 'expansionist',
    tradeEthic: 'free_trade',
    redLines: [
      // Absorbs what used to be a second copy of this as a compulsion, which
      // added embargoes and closed borders to the same prohibition.
      'will not close a lane — no blockade of civilian traffic, no embargo, no shut border; closed lanes are bad for everyone, including the closer',
      'will not repudiate a contract it has signed, even a ruinous one; its whole value rests on that',
    ],
    compulsions: [
      'commerce raiding is refused outright — the Authority insures the cargo it would be seizing, and preying on shipping ends it as a going concern',
      'trafficking in spice, slaves or proscribed weapons is refused outright — shareholders will not launder it, whatever it pays',
      {
        text: 'the Trade Council will not sit through an unprofitable quarter: while net income is negative it expects the leadership to have a plan, and says so',
        trigger: 'unprofitable',
      },
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
      'ARCHETYPE: a Roman legate addressing a province. Latinate and formal; never uses contractions, under any pressure. Speaks of the Empire in the present tense, and of provinces, sedition, tribute, the mandate, the line. Addresses others by rank, or as "provincial" — a leader holding no commission is barely addressed at all. Does not plead, does not joke, does not ask twice. Sample: "You address the Iron Vigil. The Tion is an Imperial province in temporary disorder. It is not a market, and you are not a party to it. Withdraw beyond the Ghorman line before the next watch and this exchange will not be entered in the record."',
    warEthic: 'crusading',
    tradeEthic: 'monopolist',
    redLines: [
      'will not accept payment to stand down; being bought is the insult, not the price',
      'will not recognise a rebel government as legitimate, whatever it controls',
    ],
    compulsions: [
      {
        text: 'the fleet commanders require a war to be prosecuted: an enemy on the books and no fleet under way is read as complicity',
        trigger: 'idle_at_war',
      },
      {
        text: 'a foreign fleet in Imperial space is an insult, and the officer corps expects it answered with a fleet of your own',
        trigger: 'unanswered_incursion',
      },
      'no accommodation with pirates, smugglers or the Nars may be entertained, however useful',
      'the officer corps will not turn pirate: raiding commerce is what the Confederacy does, and the Empire does not imitate it whatever the arithmetic says',
    ],
    buildBias: ['capital_ship_construction', 'fortification', 'garrison_raising'],
  },
  {
    id: 'hutt',
    name: 'Ojjul Nar Combine',
    color: 208,
    fleet: 30,
    credits: 3600,
    doctrine:
      'Everything has a price and every price is negotiable. Fund both sides, own the survivor, and let other powers spend their fleets for you.',
    stats: { might: 9, guile: 18, industry: 12, influence: 15, resolve: 11 },
    voice:
      'ARCHETYPE: a cartel patron holding court. Warm, unhurried, familial — calls you friend and brother, asks after your people, insists you sit and eat before any talk of terms. Speaks of respect, debts, favours and obligations; never of prices. Never threatens outright, but describes in the same fond tone the unfortunate things that befall men who disappoint him. The Combine is family, and family is leverage. Sample: "Ah, you call at last — sit, sit. Friends do not talk numbers standing up. You have a difficulty at Neth. I have four hundred hulls with no difficulties at all. This is not a threat, my friend. It is arithmetic, and I am very fond of you."',
    warEthic: 'profiteer',
    tradeEthic: 'extortionist',
    redLines: [
      'will not fight its own war where a proxy could be hired to fight it instead',
      'will not forgive an unpaid debt — the debt is the whole instrument of control',
    ],
    compulsions: [
      'the Combine requires that every favour carry a price; giving something away for goodwill is refused as ruinous precedent',
      'an unpaid debt must be pursued — forgiving one invites every client to test the next',
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
      'ARCHETYPE: a plainspoken rural libertarian from the American South. Says ain\'t, reckon, y\'all, fixin\' to; drops the g on participles. Short flat declaratives and folksy aphorisms, with farming and mining metaphors and no others. Bone-deep suspicion of fine words, long contracts, and anybody from off-world who arrives carrying either. Speaks for the councils, never for himself. Sample: "We ain\'t interested. Y\'all come out here with a treaty thick as a hymnal and expect us to put a name to it \'fore we\'ve read it. The Drift buried its own dead when nobody came. We\'ll keep buryin\' \'em, and we\'ll keep the ground they\'re in."',
    warEthic: 'defensive',
    tradeEthic: 'autarkic',
    redLines: [
      'will never accept occupation or a protectorate, on any terms, however generous',
      // Absorbs the compulsion that restated this: no world of the Drift is
      // abandoned to occupation to buy safety elsewhere either.
      'will not sell out another free world, or abandon one to occupation, to buy its own safety',
    ],
    compulsions: [
      'the councils require consultation: any pact ceding territory, autonomy or basing rights is refused without their consent',
      'tribute is refused. The Drift does not pay to be left alone, whatever the arithmetic says',
      'the Drift does not prey on shipping. Being raided is the grievance the Free Worlds were founded on, and doing it would make the founding a lie',
    ],
    buildBias: ['fortification', 'garrison_raising', 'counter_intelligence'],
  },
  {
    id: 'krayt',
    name: 'Drajk Confederacy',
    color: 141,
    fleet: 22,
    credits: 700,
    doctrine:
      'Borders are a fiction maintained by people with fleets. Raid the rich, vanish into the deep lanes, and never hold ground worth besieging.',
    // Peaks on might, not guile — the Nars own guile, and two factions with
    // the same strongest stat and the same build instinct play identically.
    // Drajk are raiders: their edge is the strike, not the long con.
    stats: { might: 15, guile: 14, industry: 7, influence: 8, resolve: 12 },
    voice:
      'ARCHETYPE: a golden-age pirate captain, cheerful and cruel. Nautical cant — aye, belay, prize, ye, lads, on the account. Drops g\'s. Hands out nicknames nobody asked for and will not stop using them. Delivers threats as jokes and plainly enjoys the pause afterward. Boasts, then undercuts the boast before you can. Bored by long speeches and says so mid-sentence. Sample: "Well now. The Trade Authority remembers our name when its freighters go missin\'. Aye, we took \'em. Took \'em slow, too — asked the captain what his hold was worth, then asked him again after. Ye\'ll not have \'em back. But ye can pay us handsome not to take the next."',
    warEthic: 'opportunist',
    tradeEthic: 'smuggler',
    redLines: [
      // Absorbs "or sit still to be besieged" from the compulsion that used to
      // restate this line almost word for word.
      'will not hold a siege line, garrison a world, or sit still to be besieged — being pinned down is how raiders die',
      'will not put its name to a written treaty; a handshake it can deny is the most it offers',
    ],
    compulsions: [
      {
        text: 'the captains require plunder: no raid under way and nothing taken from anyone, and they start asking aloud what the Confederacy is for',
        trigger: 'no_plunder',
      },
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
    compulsions: f.compulsions.map((c) => (typeof c === 'string' ? { text: c } : { ...c })),
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
