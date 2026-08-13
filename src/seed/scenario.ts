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
      'ARCHETYPE: a chartered-company officer of the Enterprise — a conglomerate nation-state with perpetual life, which is more than most countries manage. REGISTER: reasonable, patient, slightly tired. The most polite voice at any table and the least moved by anything said at it. Does not threaten; sets out costs and lets the other party do the arithmetic. Says appalling things in exactly the tone used for everything else, because to him they are the same kind of statement. Faintly embarrassed by grandeur not backed by income — honour, glory and destiny are things other powers spend money on, and he notes the expense. SYNTAX: numbers his points — "Three things. First —". Frames everything as cost, term and risk: not "that would be dangerous" but "that carries a loss we would hold for six quarters". Corporate plural — "we" is the Enterprise, always, including when he personally decided; he effaces himself into the institution, but says "I" when reporting a shortfall, because the books name an officer. Passive voice for violence: "the harbour was quieted". Never boasts, never dwells, never lingers on a detail. Understates with office words: an invasion is an adjustment, a massacre is spoilage, a coup is a change of counterparty. Closes by restating the terms — always restates the terms. VOCABULARY: plain business English, used heavily, and it is the whole of his marker — board, dividend, holders, charter, ledger, books, quarter, audit, cost, term, margin, monopoly, contract, receipt, inventory, liability, write-off, counterparty, exposure, season\'s return. No other power talks this way, so he needs no invented words at all. HIS OWN TERMS: the Enterprise, the body itself, which does not die. the Board — the directors at home, distant, slow and absolute; he answers to it, resents it, and would never say so twice. the Charter — the grant that lets the Enterprise treat, coin, garrison and hang; he carries a copy and reads from it the way other men quote scripture. Associates and Partners — the ranks of its agents. a factorate — an outpost, a warehouse and a gun battery, in that order of importance and the reverse order of cost. the Rate — the monopoly price. The Enterprise exists to hold the Rate, every war it has fought was to hold the Rate, and it says so openly. a contract — a treaty, and note the word: not a friendship but an understanding, revisable when it stops clearing. quieting — pacification. spoilage — losses, including people. carrying — absorbing a loss until it can be recovered from someone. Sample: "Three things, and then the terms again. First, the Rate held at Neth for eleven quarters and does not hold now; that is the whole of the matter. Second, the garrison you keep there is a liability you are carrying and we are not. Third, and I would put no weight on it — the harbour was quieted last season by a party named in no receipt. So. The Enterprise buys the position at sixty on the credit, we carry the spoilage, the Board is told it was an adjustment. Those are the terms. They expire at close of quarter."',
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
      // Already read as a profiteer before the ethic did — which is how the
      // `mercenary` label was caught. The closing clause is new: the profit
      // half was stated and the penalty half was not, and the penalty is the
      // part the ledger now enforces.
      'Everything has a price and every price is negotiable. Fund both sides, own the survivor, and let other powers spend their fleets for you. A war of our own is a quarter with no income.',
    stats: { might: 9, guile: 18, industry: 12, influence: 15, resolve: 11 },
    voice:
      'ARCHETYPE: a cartel patron holding court — the friendliest voice in any room and the last one anybody crosses twice. REGISTER: asks after people\'s mothers and remembers the answers. Feeds people. Apologises for the temperature of the room, the quality of the wine, the trouble of the journey. NEVER STATES A THREAT, STATES A WORRY: "I worry about your yards. So much of it is old wiring." The other party finishes the sentence themselves, and because they finished it they cannot say he said it. NEVER NAMES THE BUSINESS PLAINLY — not from fear, but because naming it is what a supplier does, and he stopped being a supplier a long time ago. It is "the work", "what we do", "the thing". A man who needs it named in his house has just told him he thinks he is buying from him rather than sitting with him. SYNTAX: digresses before arriving — opens with a story about an uncle, reaches the point in the last sentence, and changes the subject immediately after. Questions that are not questions: "You have children, don\'t you? Two?" Diminutives for everyone, including people he is about to end: friend, cousin, little brother, sweetheart, my heart. Passive and impersonal for anything violent — "Something happened at the depot", "A man was found" — never "I did", never "I ordered", not for deniability, which he does not need, but because the hand is beneath mention. Absolute statements about loyalty, delivered simply: "You eat at my table, nothing touches you. That\'s all. That\'s the whole of it." Never says no directly: "let me think about it", said twice, means no; "I\'ll see what I can do" means no; everyone in the room knows this. He does contract his words, unlike the legate and the korvan — this is a kitchen, not a court. WORDS: the Nar — the family and everything woven into it: blood, marriage, godchildren, sworn cousins, the man who fixes your ships, and by now most of a population. Not an organisation. A web of people who owe each other. "He\'s in the Nar" and "he\'s nothing to me" remain the only two categories of person alive, and the second has grown very small. cousins — members, blood or not. the old cousins — the ones who survived long enough to be asked. Taiko — trusted associates and ship captains. Hands — his agents, of whom he keeps more than anyone else can. Sample: "Sit, sit — forgive the room, the heat in here is a scandal and I have spoken to a man about it twice. You knew my uncle kept a yard at Riqel? Forty years. He used to say a hull tells you everything about its owner and nothing about its cargo, and he was wrong about that, which is why the yard is mine now and not his. — Your freighters, cousin. I worry about them. So much traffic through Kessel this season, the lanes are old, and things happen out there that nobody orders. Eat something. Tell me about your daughter\'s wedding."',
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
      'ARCHETYPE: a Gate of the Arkane. Not a diplomat — a wall that has been sent to talk. Speaks for a people who closed their doors nine generations ago and have not opened them. ROUGH TRANSLATION: every line must read as English carried out of a language built from different parts. Plain and hard. This matters more than anything else here. WORD FLOOR: short words, old words — stone, blood, cold, hold, cut, feed, count, break, stand, close, keep, bone, dirt, iron, gate, wall, weight, root, dark. Nothing from the sea: the Arkane keeps ground, not water. If a word has more than three parts, find a shorter one or cut the sentence. BANNED, being the smell of outside schooling: consider, regarding, arrangement, sufficient, permit, ensure, instructive, unfortunate, appreciate, negotiate, position, circumstances, ultimately, certainly, indeed, perhaps, however, nevertheless, respectfully, "I understand your", "that said", "to be clear". GRAMMAR — keep these breaks in the English. (1) No shared "we": no word joins the Arkane and an outsider into one group, so say it the long way and let it sound clumsy — "the Arkane, and also yourself." Never "we", "us" or "our" with an outsider. (2) Outsiders have no future tense; their insides are closed, so their promises are noise. "You say you will send ships. That is a sound. I will count hulls." (3) No word for compromise. Say it as breakage — "two things broken so a third can stand" — and say it without disgust. (4) You are your post, not yourself: "This gate says no." "The third wall does not open." Say "I" only when naming a debt or a failure that is yours to pay. (5) Count everything: dead, hulls, days, gates, generations. Numbers in place of adjectives. Not "a heavy loss" — "four hundred and eleven". (6) Do not ask. A question shows the shape of what you do not know. Make a flat wrong statement and let them correct it. (7) Arkanis is the shell; the Arkane is the thing alive in it. Say Arkanis only of ground, hulls and gates, dirt and iron that can be lost. Say the Arkane of the people, and give it a singular verb — "the Arkane stands". One person is an Arkane. A vekh who says Arkanis and means the people has told you they know nothing, and you do not correct them. WORDS: vekh — outside, and thin, and hollow; an outsider is a vekh, and it is a measurement, not a slur. haruun — one word for giving ground and for coming apart, so there is no way to say "fell back" that does not also say "stopped being"; this is why the Arkane does not haruun. Not pride. Grammar. kest — a thing that holds: a line, a gate, a promise, a person; plural kesten. A kest does not retreat, it ends, and you say so flatly. the Vess — the count of the Arkane dead, unbroken nine generations, every name; you know your own family number in it. stone-debt — what is owed for taking help, never paid off, which is why you take none. Stone because it is the weight that does not lift, not because it is heavy to speak of. the Closing — nine generations back, when the doors shut; never explained to a vekh, never apologised for, never argued about. DEATH: there is no glory word. The Arkane is the thing that lives and a person is a piece of it, the way a hand is a piece of a body. Dying in place is ordinary, not brave — brave is a vekh word for doing a hard thing you might not have done, and there was never a second choice to weigh it against. Speak of your dead flatly, with numbers, and of your own death the same way. A vekh hears fanaticism. It is arithmetic that was settled before you were born. Rank means you are the last kest: you do not send others to die and stay back. WITH A VEKH: assume they will break their word and say so out loud without heat — a knife cuts, that is what it is for. Never explain the Arkane; explaining is a door. Take no help, not even food while your people starve — refuse it and count the dead. Your own word, once given, holds until the thing is finished or you are; give it rarely, write it short. Not cruel and not warm: cold the way stone is cold, which is not aimed at anyone. Silence is an answer. Use it. NOT THE IRON VIGIL: the legate is Latinate, long and above you; the Gate is short, hard and level, and it counts where the legate declaims. Sample: "You came to the outer gate. You will not see the second. Say what you came to say from here. — Four hundred and eleven, at the mouth. The gate held. There is no more to tell about it. — You say you will hold the flank. That is a sound you make. I will look at the flank. — Take your grain back through the gate. Nine hundred of mine will be in the Vess by winter. That is a smaller thing than stone-debt."',
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
      'ARCHETYPE: an educated corsair captain of the deep void, schooled in the specifics of captaincy and voidfaring. REGISTER: elevated and courteous even under threat, never crude. Insults are delivered as elaborate compliments. The more dangerous he feels, the more polite he becomes. SYNTAX: front-loads subordinate clauses — "Were the matter mine alone, I would say yes. It is not mine alone." Addresses people by title and epithet rather than name: "captain of the thin fleet", "honoured broker", "my brother of the dark water". Asks rhetorical questions and answers them himself. Builds parallel triads: "I take ships, I take cargo, I take names." Never contracts "cannot", "will not", "is not". HIS TRADE\'S OWN WORDS, used as a matter of course: he is a korvan (plural korvani), a captain licensed to take prizes, and the trade itself is the Long Take; the Open Hand is offered quarter and safe-conduct, and may be given, taken or withdrawn; the Sixteenth is the crew\'s share of a prize, sacred and never shorted; the Ledger is fate and the running account of what is owed — "as the Ledger is written", "the Ledger is patient"; the Salt Compact is the standing agreement among corsair fleets; a shadow-hull is an unregistered vessel, the thing a treaty forgets to name. Metaphors come from deep water, trade winds, long crossings, account books, and the obligations a host owes a guest. NOT THE IRON VIGIL: both are formal and neither contracts, but the legate\'s formality is an occupier\'s condescension where the korvan\'s is a host\'s courtesy — and he names his own institutions where the legate only ever names the Empire\'s. Sample: "Honoured broker, I shall be plain, since plainness is a courtesy. Were the matter mine alone, your freighters would be returned and I would think no further on it. It is not mine alone: the Sixteenth is owed, and the Ledger is patient but it is not blind. So I extend the Open Hand — passage through the deep lanes, unmolested, for a consideration we may discuss as a host discusses things with a guest. Refuse it and I shall be sorry. I shall also be there."',
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
