import { useCallback, useState } from 'react';
import { STAT_MEANINGS, STAT_NAMES } from '../../src/domain/checks.js';
import { neighboursOf, shortestPath } from '../../src/domain/graph.js';
import type { WorldState } from '../../src/domain/state.js';
import { ansi256ToHex } from './color.js';
import { BriefingPanel } from './components/BriefingPanel.js';
import { ChannelPanel } from './components/ChannelPanel.js';
import { FactionPicker } from './components/FactionPicker.js';
import { GalaxyMap } from './components/GalaxyMap.js';
import { SidePanel } from './components/SidePanel.js';
import { useGame, useStickToBottom } from './useGame.js';

/**
 * Worked examples, written against the player's ACTUAL position.
 *
 * A blank prompt that accepts any English sentence is the hardest kind of
 * interface to start using: the player has no idea what the game can hear.
 * Generic examples only half-solve it, because the first thing anyone does is
 * substitute their own system names and get one wrong. These name real worlds
 * the player really holds and real neighbours they could really reach, so they
 * can be typed verbatim on turn one.
 *
 * Chosen to cover the verbs nobody guesses — that a neutral world has a
 * garrison, that you can strangle trade without a battle, that you can talk a
 * crew into changing sides, and that the arbiter will rule on things with no
 * mechanic at all.
 */
function exampleActions(state: WorldState | null): string[] {
  if (!state) return [];
  const me = state.playerFactionId;
  const mine = state.systems.filter((s) => s.controllerFactionId === me);
  const withShips = [...mine].sort((a, b) => (b.ships[me] ?? 0) - (a.ships[me] ?? 0));
  const base = withShips[0] ?? mine[0];
  if (!base) return [];

  const nameOf = (id: string) => state.systems.find((s) => s.id === id)?.name ?? id;
  const factionName = (id: string) =>
    state.factions.find((f) => f.id === id)?.name ?? id;

  // A neighbour we do not hold: somewhere an order could actually go.
  const neighbours = mine.flatMap((s) => neighboursOf(state, s.id));
  const outward = [...new Set(neighbours)]
    .map((id) => state.systems.find((s) => s.id === id)!)
    .filter((s) => s && s.controllerFactionId !== me);

  // Nearest unaligned world, not merely an adjacent one. Krayt borders no
  // neutral at all, and lawless junctions are the whole of its economy — the
  // example it most needs is the one it would otherwise never be shown.
  const neutral = outward.find((s) => s.controllerFactionId === null) ?? nearestNeutral(state, mine);
  const rival = outward.find((s) => s.controllerFactionId !== null);
  const someoneElse =
    state.factions.find((f) => f.id !== me && f.id === rival?.controllerFactionId) ??
    state.factions.find((f) => f.id !== me)!;

  const force = Math.max(4, Math.floor((base.ships[me] ?? 8) / 2));
  const lines: string[] = [];
  // "the Free Worlds's crews" is a mouthful nobody would type.
  const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

  if (neutral) {
    lines.push(
      `  Send ${force} ships from ${base.name} to take ${neutral.name}.`,
      `      — neutral worlds have garrisons and fight back; say how many ships you send`,
    );
  }
  if (rival) {
    lines.push(
      `  Move ${force} ships to ${rival.name} and raid the shipping on that lane.`,
      `      — commerce raiding needs a squadron within one jump, not a won battle`,
      `  Offer ${possessive(factionName(rival.controllerFactionId!))} crews at ${rival.name} a better berth.`,
      `      — suborning fights nobody; you pay for it in standing, not hulls`,
    );
  }
  lines.push(
    `  Put the yards at ${base.name} to work on a squadron of corvettes.`,
    `      — hulls cost 60 credits each and 4 a turn after that`,
    `  Offer ${someoneElse.name} a dynastic marriage to seal an alliance.`,
    `      — no op covers this; the arbiter rules on it, and you may only hold one`,
  );
  return lines;
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
 * Help text, including what the five stats actually govern.
 *
 * Without this the stat bars are decoration: a player cannot aim an action at
 * their strengths if nothing says that `guile` covers bribery and `industry`
 * covers anything that must be built.
 */
function helpLines(state: WorldState | null): string[] {
  return [
    'COMMANDS',
    '  (free text)      declare an action — it lands when you end the turn',
    '  :endturn         land everything declared, hear the powers respond, advance time',
    '  :discard         clear what you have declared this turn',
    '  /talk <faction>  open a diplomatic channel',
    '  /endtalk         close it — only then is anything you agreed made real',
    '  :export          download this campaign as a .tar.gz you can resume anywhere',
    '  :help            this',
    '',
    ...(state
      ? [
          'TRY THESE — plain English, no syntax, and these name your actual worlds',
          ...exampleActions(state),
          '',
          '  Anything you can say, you can attempt. An arbiter decides whether it',
          '  can be tried at all and how hard it is, before any dice are rolled.',
          '',
        ]
      : []),
    'HOW ACTIONS RESOLVE',
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
          <GalaxyMap state={view.state} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="feed" ref={feedRef}>
            {game.messages.map((m) => (
              <p
                key={m.id}
                className={`msg ${m.tone}`}
                style={m.color !== undefined ? { color: ansi256ToHex(m.color) } : undefined}
              >
                {m.text}
              </p>
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
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                busy
                  ? 'Working…'
                  : activeChannel
                    ? 'Close the channel to declare actions'
                    : 'Declare an action, or :help'
              }
              disabled={!!busy || !!activeChannel}
              autoFocus
            />
            <button type="submit" disabled={!!busy || !!activeChannel || !input.trim()}>
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
