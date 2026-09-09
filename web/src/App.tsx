import { useCallback, useState } from 'react';
import { STAT_MEANINGS, STAT_NAMES } from '../../src/domain/checks.js';
import { neighboursOf, shortestPath } from '../../src/domain/graph.js';
import { hullsAt, type WorldState } from '../../src/domain/state.js';
import { ansi256ToHex } from './color.js';
import { BriefingPanel } from './components/BriefingPanel.js';
import { ChannelPanel } from './components/ChannelPanel.js';
import { FactionPicker } from './components/FactionPicker.js';
import { GalaxyMap } from './components/GalaxyMap.js';
import { OutcomeArt } from './components/OutcomeArt.js';
import { EpilogueStage } from './components/EpilogueStage.js';
import { PortraitStage } from './components/PortraitStage.js';
import { SidePanel } from './components/SidePanel.js';
import { useGame, useStickToBottom } from './useGame.js';

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
 * long and taught rules the help text is a better place for. A list where
 * every entry has a footnote is a list nobody finishes.
 */
function exampleActions(state: WorldState | null): string[] {
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

  // Four lines, one per verb worth knowing, and no gloss under any of them.
  // The notes that used to hang off each of these said things the help text
  // now says once in its own section — and a list where every entry carries a
  // footnote is a list nobody finishes reading. What these are for is the
  // shape of a sentence the game can hear, against worlds that really exist.
  return [
    ...(neutral ? [`  Send ${force} ships from ${base.name} to take ${neutral.name}.`] : []),
    ...(rival ? [`  Move ${force} ships to ${rival.name} and raid the shipping on that lane.`] : []),
    `  Put the yards at ${base.name} to work on a squadron of corvettes.`,
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

/**
 * Help text: the commands, the shape of a declaration, and what the game can
 * actually hear.
 *
 * Without this the stat bars are decoration — a player cannot aim an action at
 * their strengths if nothing says that `guile` covers bribery and `industry`
 * covers anything that must be built. And without the WHAT YOU CAN REACH FOR
 * section, most of what has been built since is invisible: a player who does
 * not know a thing can be lent, tolled, insured or held hostage will never
 * type the sentence that reaches it, and the arbiter only rules on what
 * somebody thought to attempt.
 */
function helpLines(state: WorldState | null): string[] {
  return [
    'COMMANDS',
    '  (free text)      declare an action — it lands when you end the turn',
    '  /advisor         ask your own counsellor what they are worried about',
    '                   — costs one of your two actions, like anything else',
    '  /talk <faction>  open a diplomatic channel',
    '  /endtalk         close it — only then is anything you agreed made real',
    '  :endturn         land everything declared, hear the powers respond, advance time',
    '  :discard         clear what you have declared this turn',
    '  :export          download this campaign as a .tar.gz you can resume anywhere',
    '  :help            this',
    '',
    ...(state
      ? [
          'TRY THESE — plain English, no syntax, and these name your actual worlds',
          ...exampleActions(state),
          '',
        ]
      : []),
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
    '',
    'YOUR STATS',
    ...STAT_NAMES.map((s) => `  ${s.padEnd(10)} ${STAT_MEANINGS[s]}`),
    '',
    '  Aim actions at what you are good at. A power with high guile buys a',
    '  border rather than storming it; one with high might does the reverse.',
    '',
    'YOUR OWN PEOPLE CAN REFUSE',
    '  Your power has red lines it will not cross and compulsions it demands of',
    '  you. An order across a red line is refused outright — nothing happens,',
    '  and it still costs you the action. Defying a compulsion goes ahead and',
    '  costs standing at home. Enough of either and your institutions stop',
    '  following you, which comes off every stat you roll.',
    '',
    'FLEETS AND WORLDS',
    '  Four hull classes, and the mix decides battles: escorts screen, lifters',
    '  are the only way to put troops on a world, torpedo boats fire once before',
    '  the fleets close, battleships win the exchange. A fleet of pure warships',
    '  can sterilise an orbit and take nothing. Ships cost 15 credits a ton and',
    '  1 a ton every turn after; a navy you cannot pay for lays itself up.',
    '  Parking ships over a world you do not own splits its income, closes its',
    '  lanes and lets you talk to its crews — presence is not ownership, and it',
    '  is not nothing either.',
    '',
    'MONEY',
    '  Territory pays, and so does the lane network. You may charge any power',
    '  for crossing your space, and lifting that toll is a real concession to',
    '  offer. Blockades sever lanes; commerce raiding takes the cargo, and both',
    '  need a fleet already there.',
    '',
    'WHAT YOU CAN REACH FOR',
    '  Most of what follows has no command. You type the sentence and the',
    '  arbiter decides — that is the point of it.',
    '  · things — prisoners, a dossier, a relic, ore, a mine that pays you every',
    '    turn. Worth different amounts to different powers, which is what makes',
    '    them worth trading. Won by attempting something, never by claiming it.',
    '  · debts and loans — money owed and paid down, or a squadron hired out',
    '    under someone else\'s flag and expected back.',
    '  · arrangements — a marriage, a charter, a share of what a lane earns, and',
    '    "if this happens, you pay me that". A treaty binds the other power, so',
    '    it can only be agreed in a channel and never declared.',
    '  · operatives — watchers, thieves, saboteurs, assassins. Everything you',
    '    cannot see is a rumour until somebody of yours is standing in it.',
    '',
    'TIME',
    '  Nothing takes longer than 5 turns. Fleet movement costs one turn per',
    '  hyperlane jump and is never estimated. Everything else is estimated once,',
    '  when the order is issued, and never re-rolled.',
  ];
}

export function App() {
  const game = useGame();
  const [input, setInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A channel the player has opened in the UI but not yet spoken into. The
  // server opens it for real on the first message.
  const [draftChannel, setDraftChannel] = useState<string | null>(null);
  const feedRef = useStickToBottom(game.messages.length);

  const { view, busy, say } = game;
  const channel = view?.openChannel ?? null;

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    if (text.startsWith(':') || text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      const arg = rest.join(' ');
      const cmd = (head ?? '').replace(/^[:/]/, '').toLowerCase();

      switch (cmd) {
        case 'help':
          // `view` is non-null by the time a command can be typed, but the
          // examples are grounded in real systems so degrade rather than throw.
          helpLines(view?.state ?? null).forEach((h) => say(h, 'system'));
          return;
        case 'advisor':
        case 'advise':
        case 'counsel':
          await game.advisor();
          return;
        case 'endturn':
          await game.endTurn();
          return;
        case 'discard':
          await game.discard();
          return;
        case 'export':
        case 'save':
          await game.exportCampaign();
          return;
        case 'talk': {
          const target = view?.state.factions.find(
            (f) =>
              f.id !== view.state.playerFactionId &&
              (f.id === arg.toLowerCase() || f.name.toLowerCase().includes(arg.toLowerCase())),
          );
          if (!arg || !target) {
            say(
              `Who? ${view?.state.factions
                .filter((f) => f.id !== view.state.playerFactionId)
                .map((f) => f.id)
                .join(', ')}`,
              'error',
            );
            return;
          }
          setDraftChannel(target.id);
          return;
        }
        case 'endtalk':
          if (!channel) {
            setDraftChannel(null);
            say('No channel is open.', 'error');
            return;
          }
          await game.endTalk(channel);
          setDraftChannel(null);
          return;
        default:
          say(`Unknown command "${head}". :help for the list.`, 'error');
          return;
      }
    }

    await game.act(text);
  }, [input, busy, channel, game, say, view]);

  if (game.fatal) {
    return (
      <div className="fatal">
        <h1>Cannot start</h1>
        <pre>{game.fatal}</pre>
        <p>
          If this mentions signing in, run <code>pnpm login</code> then <code>pnpm auth</code> and
          restart the server.
        </p>
      </div>
    );
  }

  if (game.needsCampaign || !view) {
    return game.needsCampaign ? (
      <FactionPicker
        onStart={game.start}
        onResume={game.resume}
        onImport={game.importCampaign}
      />
    ) : (
      <div className="loading">Connecting to the server…</div>
    );
  }

  const player = view.state.factions.find((f) => f.id === view.state.playerFactionId);
  const activeChannel = view.openChannel ?? draftChannel;

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">PAX GALACTICA</span>
        <span className="turn">Turn {view.state.turn}</span>
        <span style={{ color: player ? ansi256ToHex(player.displayColor) : undefined }}>
          {player?.name}
        </span>
        <span className="spacer" />
        {view.staged.length > 0 && <span className="pill">{view.staged.length} declared</span>}
        <button
          type="button"
          className="ghost-btn"
          title="Download this campaign as a .tar.gz — resume it with: pnpm resume <file>"
          onClick={() => void game.exportCampaign()}
        >
          Export
        </button>
        <span className={game.connected ? 'dot on' : 'dot off'} title={game.connected ? 'live' : 'reconnecting'} />
      </header>

      <main className="grid">
        <div className="left">
          {/* While a channel is open the stage belongs to whoever is on the
              other end of it.
              `activeChannel`, which is the same signal `ChannelPanel` uses, and
              not `view.openChannel`: the server only sets that once a message
              has actually been sent, while the channel surface opens the moment
              the player clicks `talk`. Gating on the server's flag left the map
              up through the whole first exchange — the portrait arrived one
              message late, or never, if the player thought better of it. */}
          {/* The ending outranks both: there are no fleets left to move and
              nobody left to talk to, so it takes the stage outright. */}
          {view.epilogue ? (
            <EpilogueStage epilogue={view.epilogue} />
          ) : activeChannel ? (
            <PortraitStage state={view.state} factionId={activeChannel} />
          ) : (
            <GalaxyMap state={view.state} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          <div className="feed" ref={feedRef}>
            {game.messages.map((m) => (
              <div key={m.id}>
                {/* A beat, not a mode: the three typed non-outcomes get a
                    picture in the feed above the line that explains them,
                    while the map stays where it is. A missing file renders
                    nothing and the line alone carries it. */}
                {m.art && <OutcomeArt kind={m.art.kind} alt={m.art.alt} />}
                <p
                  className={`msg ${m.tone}`}
                  style={m.color !== undefined ? { color: ansi256ToHex(m.color) } : undefined}
                >
                  {m.text}
                </p>
              </div>
            ))}
            {busy && <p className="msg busy">{busy}…</p>}
          </div>
          <form
            className="commandline"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <span className="prompt">turn {view.state.turn} ▸</span>
            {/* The allowance has to be on screen next to the input, or running
                out reads as the app breaking rather than as a rule. Dots, not a
                number: two of anything is faster to read as a shape. */}
            <span
              className={`ap${view.actionPoints.left === 0 ? ' ap-spent' : ''}`}
              title={`${view.actionPoints.left} of ${view.actionPoints.perTurn} actions left this turn`}
            >
              {Array.from({ length: view.actionPoints.perTurn }, (_, i) => (
                <span key={i} className={i < view.actionPoints.left ? 'ap-dot' : 'ap-dot used'} />
              ))}
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                busy
                  ? 'Working…'
                  : activeChannel
                    ? 'Close the channel to declare actions'
                    : view.actionPoints.left === 0
                      ? 'No actions left — end the turn'
                      : 'Declare an action, /advisor for counsel, or :help'
              }
              disabled={!!busy || !!activeChannel}
              autoFocus
            />
            <button
              type="submit"
              disabled={
                !!busy || !!activeChannel || !input.trim() || view.actionPoints.left === 0
              }
            >
              Send
            </button>
            <button
              type="button"
              className="endturn"
              onClick={() => void game.endTurn()}
              disabled={!!busy || !!activeChannel}
              title={activeChannel ? 'Close the channel first' : 'Land everything declared'}
            >
              End turn
            </button>
          </form>
        </div>

        <div className="right">
          {activeChannel && (
            <ChannelPanel
              view={view}
              factionId={activeChannel}
              busy={busy}
              onSend={(text) => void game.talk(activeChannel, text)}
              onClose={() => {
                if (view.openChannel === activeChannel) void game.endTalk(activeChannel);
                setDraftChannel(null);
              }}
            />
          )}
          <BriefingPanel
            briefing={view.briefing}
            staged={view.staged}
            state={view.state}
            onDiscard={(i) => void game.discard(i)}
          />
          <SidePanel
            state={view.state}
            selectedId={selectedId}
            briefing={view.briefing}
            onSelect={setSelectedId}
            onTalk={setDraftChannel}
            activeChannel={activeChannel}
          />
        </div>
      </main>
    </div>
  );
}
