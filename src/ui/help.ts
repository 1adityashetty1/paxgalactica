import { STAT_MEANINGS, STAT_NAMES } from '../domain/checks.js';
import { neighboursOf, shortestPath } from '../domain/graph.js';
import { hullsAt, type WorldState } from '../domain/state.js';
import {
  allyLines,
  assetLines,
  channelLines,
  eventListLines,
  fixtureLines,
  goodsLines,
  heatLines,
  intelLines,
  leverageLines,
  officerLines,
  operativeLines,
  peaceLines,
  raiderLines,
  rimLines,
  shipClassLines,
  spanLines,
  treatyLines,
  worldLines,
  wrap,
} from './helptext.js';

/**
 * The help, as an index and a page per part of the game.
 *
 * It was one page, and the game outgrew it: a single `:help` printed some two
 * hundred lines into the feed — commands, dice, ships, worlds, fixtures, trade,
 * treaties, operatives, officers and the Rim — so the one section a player was
 * looking for was a scroll away from wherever they landed. `:help` is now the
 * commands, worked examples against the player's own worlds, the rules in four
 * lines, and the list of pages; `:help war` (or `:help-war`) is one page.
 *
 * Pure and DOM-free, beside the section builders in `helptext.ts`, so the
 * routing and the pages are tested rather than living inside a component.
 */

export interface HelpTopic {
  /** What the player types after `:help`. */
  key: string;
  /** Other words that reach the same page. */
  aliases: readonly string[];
  /** One line on the index. */
  about: string;
  lines: (state: WorldState | null) => string[];
}

/** A blank line between sections. */
function sections(...parts: string[][]): string[] {
  return parts.flatMap((p, i) => (i === 0 ? p : ['', ...p]));
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    key: 'actions',
    aliases: ['rules', 'stats', 'dice', 'dissent', 'turns'],
    about: 'how an action is judged and rolled; your stats; refusals',
    lines: () =>
      sections(
        [
          'HOW ACTIONS RESOLVE',
          '  Two actions a turn. Anything you can say, you can attempt: an arbiter',
          '  rules on whether it can be tried at all and how hard it is, before any',
          '  dice are rolled. Being told "that is a conversation" costs you nothing.',
          '',
          '  Every action is tested against one of your five stats. A d20 is rolled',
          '  before the model is asked anything, your stat modifier is added, and the',
          '  total is compared to a difficulty. Beat it by 5+ for a critical success;',
          '  miss by 1–4 and it half-works; miss badly and it fails outright.',
          '  Stats run 1–20. A 10 is unremarkable, 18 is a defining strength.',
        ],
        [
          'YOUR STATS',
          ...STAT_NAMES.flatMap((s) =>
            wrap(STAT_MEANINGS[s], ' '.repeat(13)).map((l, i) => (i === 0 ? `  ${s.padEnd(10)} ${l.trimStart()}` : l)),
          ),
          '',
          '  Aim actions at what you are good at. A power with high guile buys a',
          '  border rather than storming it; one with high might does the reverse.',
        ],
        [
          'YOUR OWN PEOPLE CAN REFUSE',
          '  Your power has red lines it will not cross and compulsions it demands of',
          '  you. An order across a red line is refused outright — nothing happens,',
          '  and it still costs you the action. Defying a compulsion goes ahead and',
          '  costs standing at home. Enough of either and your institutions stop',
          '  following you, which comes off every stat you roll.',
        ],
        [
          'TIME',
          '  Nothing takes longer than 5 turns. Fleet movement costs one turn per',
          '  hyperlane jump and is never estimated. Everything else is estimated once,',
          '  when the order is issued, and never re-rolled.',
        ],
        [
          'THE END',
          '  A campaign runs the number of turns chosen on the title screen. When the',
          '  last is played the Rim is summed up, power by power, and the campaign',
          '  stays open to read and save, but not to play.',
        ],
      ),
  },
  {
    key: 'war',
    aliases: ['fleets', 'fleet', 'ships', 'battle', 'battles', 'combat', 'officers', 'military'],
    about: 'ship classes, battles, standing orders, officers',
    lines: () =>
      sections(
        shipClassLines(),
        [
          'BATTLES',
          '  The mix decides battles. A fleet of pure warships can sterilise an orbit',
          '  and take nothing, and a navy you cannot pay for lays itself up.',
          '  Parking ships over a world you do not own splits its income, closes its',
          '  lanes and lets you talk to its crews — presence is not ownership, and it',
          '  is not nothing either.',
          '  A losing defence breaks off at two to one. You can order your whole',
          '  navy to hold whatever it costs, or to withdraw the moment it is',
          '  outmatched and keep the fleet. One order covers every fleet at once,',
          '  not a single world or squadron. A crusading power cannot be ordered',
          '  to run.',
        ],
        officerLines(),
        [
          '  See also: :help diplomacy, for allies and the peace a losing power',
          '  sues for; :help worlds, for holding what you take.',
        ],
      ),
  },
  {
    key: 'worlds',
    aliases: ['world', 'standing', 'territory', 'courting', 'envoy', 'envoys'],
    about: 'standing, courting, holding down, risings, span of control',
    lines: () =>
      sections(worldLines(), ['SPAN OF CONTROL', ...spanLines()]),
  },
  {
    key: 'trade',
    aliases: ['money', 'economy', 'income', 'lanes', 'tolls', 'raiding', 'raids', 'bounty', 'bounties'],
    about: 'income, lanes, tolls, blockades, raiding, bounties, goods',
    lines: () =>
      sections(
        [
          'MONEY',
          '  Territory pays, and so does the lane network. You may charge any power',
          '  for crossing your space, and lifting that toll is a real concession to',
          '  offer. Blockades sever lanes; commerce raiding takes the cargo, and both',
          '  need a fleet already there.',
        ],
        raiderLines(),
        goodsLines(),
      ),
  },
  {
    key: 'diplomacy',
    aliases: ['talk', 'treaty', 'treaties', 'allies', 'coalition', 'coalitions', 'peace', 'leverage', 'ultimatum'],
    about: 'channels, treaties, allies, truces, favours, ultimatums',
    lines: () =>
      sections(
        channelLines(),
        treatyLines(),
        allyLines(),
        peaceLines(),
        leverageLines(),
        [
          'ARRANGEMENTS',
          '  Not everything agreed is a treaty: a marriage, a charter, a share of',
          '  what a lane earns, "if this happens, you pay me that". The arbiter',
          '  records it as agreed and holds both sides to it, and walking away',
          '  from one costs standing with the power you made it with.',
        ],
      ),
  },
  {
    key: 'espionage',
    aliases: ['spies', 'spy', 'operatives', 'operative', 'agents', 'intel', 'covert', 'heat', 'secrets'],
    about: 'operatives and their missions, intel, secrets, heat',
    lines: () => sections(operativeLines(), intelLines(), heatLines()),
  },
  {
    key: 'fixtures',
    aliases: ['fixture', 'buildings', 'building', 'construction'],
    about: 'buildings that raise your stats, and where each can stand',
    lines: (state) => fixtureLines(state),
  },
  {
    key: 'assets',
    aliases: ['asset', 'things', 'prisoners', 'dossiers', 'debts', 'debt', 'loans', 'loan', 'notes'],
    about: 'things, prisoners, dossiers, promissory notes, debts and loans',
    lines: () => sections(assetLines(), ['  See also: :help diplomacy, for how they change hands.']),
  },
  {
    key: 'events',
    aliases: ['event', 'rim', 'random', 'luck'],
    about: 'what the Rim does on its own',
    lines: () => [...rimLines(), ...eventListLines()],
  },
];

/** The page a word asks for: its key, an alias, or the start of a key. */
export function helpTopic(query: string): HelpTopic | null {
  const q = query.trim().toLowerCase().replace(/^[:/]?help-?/, '').trim();
  if (!q) return null;
  return (
    HELP_TOPICS.find((t) => t.key === q || t.aliases.includes(q)) ??
    HELP_TOPICS.find((t) => t.key.startsWith(q)) ??
    null
  );
}

/** The commands. A line of its own for each, so the index reads as a table. */
const COMMANDS = [
  'COMMANDS',
  '  (free text)      declare an action — it lands when you end the turn',
  '  /advisor         ask your own counsellor what they are worried about',
  '                   — costs one of your two actions, like anything else',
  '  /talk <faction>  open a diplomatic channel',
  '  /endtalk         close it — only then is anything you agreed made real',
  '  :endturn         land what you declared, hear the powers answer, advance',
  '  :discard         clear what you have declared this turn',
  '  :save            save this campaign — load it from the title screen later',
  '  :help <topic>    one page of the help, below — :help-<topic> works too',
  '  :help all        every page at once',
  '  :cheats          the cheat menu, for testing: free, instant, costs no',
  '                   action, skips the arbiter, and no power is ever told',
  '  Settings         (top bar) pay with your subscription or an Anthropic or',
  '                   OpenRouter key, choose models, and set a spend cap',
];

/** The index: what `:help` alone prints. */
export function helpIndex(state: WorldState | null): string[] {
  return [
    ...COMMANDS,
    '',
    ...(state
      ? [
          'TRY THESE — plain English, no syntax, and these name your actual worlds',
          ...exampleActions(state),
          '',
        ]
      : []),
    'IN SHORT',
    '  Two actions a turn, then :endturn. Say anything: an arbiter rules',
    '  whether it can be tried and how hard, and a d20 against one of your',
    '  stats decides it. Most of what the game can do has no command — you',
    '  type the sentence, and the pages below say what there is to reach for.',
    '',
    'PAGES — :help <topic>',
    ...HELP_TOPICS.map((t) => `  ${t.key.padEnd(11)}${t.about}`),
  ];
}

/**
 * What `:help <query>` prints: the index for nothing, every page for `all`, a
 * page when the query finds one, and otherwise the index with a note saying
 * so — never nothing, since an empty answer to a typo reads as broken.
 */
export function helpPage(state: WorldState | null, query = ''): { lines: string[]; found: boolean } {
  const q = query.trim().toLowerCase();
  if (!q) return { lines: helpIndex(state), found: true };
  if (q === 'all') {
    return {
      lines: sections(helpIndex(state), ...HELP_TOPICS.map((t) => t.lines(state))),
      found: true,
    };
  }
  const topic = helpTopic(q);
  if (!topic) return { lines: helpIndex(state), found: false };
  return { lines: topic.lines(state), found: true };
}

/**
 * Four worked examples, written against the player's ACTUAL position.
 *
 * A blank prompt that accepts any English sentence is the hardest kind of
 * interface to start using: the player has no idea what the game can hear.
 * Generic examples only half-solve it, because the first thing anyone does is
 * substitute their own system names and get one wrong. These name real worlds
 * the player really holds and real neighbours they could really reach, so they
 * can be typed verbatim on turn one.
 *
 * Their job is the SHAPE of a sentence the game can hear, and nothing else.
 * They used to carry a gloss under each — that a neutral world fights back,
 * that raiding needs a squadron a jump out — which made the block twice as
 * long and taught rules the help pages are a better place for. A list where
 * every entry has a footnote is a list nobody finishes.
 */
export function exampleActions(state: WorldState | null): string[] {
  if (!state) return [];
  const me = state.playerFactionId;
  const mine = state.systems.filter((s) => s.controllerFactionId === me);
  const base = [...mine].sort((a, b) => hullsAt(b, me) - hullsAt(a, me))[0] ?? mine[0];
  if (!base) return [];

  const neighbours = [...new Set(mine.flatMap((s) => neighboursOf(state, s.id)))]
    .map((id) => state.systems.find((s) => s.id === id)!)
    .filter((s) => s && s.controllerFactionId !== me);
  const neutral =
    neighbours.find((s) => s.controllerFactionId === null) ?? nearestNeutral(state, mine);
  const rival = neighbours.find((s) => s.controllerFactionId !== null);
  const other =
    state.factions.find((f) => f.id === rival?.controllerFactionId) ??
    state.factions.find((f) => f.id !== me)!;
  const force = Math.max(4, Math.floor((hullsAt(base, me) || 8) / 2));

  return [
    ...(neutral ? [`  Send ${force} ships from ${base.name} to take ${neutral.name}.`] : []),
    // A power that lives by raiding is shown the quiet way to do it.
    ...(rival
      ? [
          state.factions.find((f) => f.id === me)?.tradeEthic === 'smuggler'
            ? `  Raid the shipping at ${rival.name} quietly, flying no colours.`
            : `  Move ${force} ships to ${rival.name} and raid the shipping on that lane.`,
        ]
      : []),
    `  Put the yards at ${base.name} to work on a squadron of escorts.`,
    `  Offer ${other.name} a dynastic marriage to seal an alliance.`,
  ];
}

/** Closest unaligned world to anything the player holds, by hyperlane. */
function nearestNeutral(state: WorldState, mine: WorldState['systems']) {
  const neutrals = state.systems.filter((s) => s.controllerFactionId === null);
  let best: { system: (typeof neutrals)[number]; jumps: number } | null = null;
  for (const candidate of neutrals) {
    for (const home of mine) {
      const path = shortestPath(state.systems, home.id, candidate.id);
      if (!path) continue;
      const jumps = path.length - 1;
      if (!best || jumps < best.jumps) best = { system: candidate, jumps };
    }
  }
  return best?.system;
}
