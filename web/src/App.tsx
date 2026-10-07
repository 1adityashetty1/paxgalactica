import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Waiting } from './components/Waiting.js';
import { CheatPanel } from './components/CheatPanel.js';
import { ansi256ToHex } from './color.js';
import { BriefingPanel } from './components/BriefingPanel.js';
import { ChannelPanel } from './components/ChannelPanel.js';
import { FactionPicker } from './components/FactionPicker.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { GalaxyMap } from './components/GalaxyMap.js';
import { OutcomeArt } from './components/OutcomeArt.js';
import { RimEventCard } from './components/RimEventCard.js';
import { RIM_EVENT_TITLE } from '../../src/domain/events.js';
import { helpPage } from '../../src/ui/help.js';
import { EpilogueStage } from './components/EpilogueStage.js';
import { PortraitStage } from './components/PortraitStage.js';
import { SidePanel } from './components/SidePanel.js';
import { useGame, useStickToBottom } from './useGame.js';

export function App() {
  const game = useGame();
  /** Whether model calls can be paid for; null until asked. Asked when there is no campaign. */
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!game.needsCampaign || providerReady !== null) return;
    void api
      .settings()
      .then((s) => setProviderReady(s.ready))
      // Unreadable settings are not a reason to block the picker; a start that
      // cannot be paid for is refused by the server and opens the screen anyway.
      .catch(() => setProviderReady(true));
  }, [game.needsCampaign, providerReady]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // A panel that writes an order for the player (the System tab's fixtures)
  // puts it on the command line to be read and sent, never sends it itself:
  // declaring is the player's act, and costs an action.
  const draft = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A channel the player has opened in the UI but not yet spoken into. The
  // server opens it for real on the first message.
  const [draftChannel, setDraftChannel] = useState<string | null>(null);
  const [cheatsOpen, setCheatsOpen] = useState(false);
  const feedRef = useStickToBottom(game.messages.length);

  const { view, busy, say } = game;
  const channel = view?.openChannel ?? null;

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    if (text.startsWith(':') || text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      const typed = (head ?? '').replace(/^[:/]/, '').toLowerCase();
      // `:help-war` is `:help war`, the form the pages are named in.
      const cmd = typed.startsWith('help-') ? 'help' : typed;
      const arg = typed.startsWith('help-') ? [typed.slice(5), ...rest].join(' ') : rest.join(' ');

      switch (cmd) {
        case 'help': {
          // `view` is non-null by the time a command can be typed, but the
          // examples are grounded in real systems so degrade rather than throw.
          const page = helpPage(view?.state ?? null, arg);
          if (!page.found) say(`No help page called "${arg}". The pages are listed below.`, 'error');
          page.lines.forEach((h) => say(h, 'system'));
          return;
        }
        case 'advisor':
        case 'advise':
        case 'counsel':
          await game.advisor();
          return;
        case 'endturn':
          await game.endTurn();
          return;
        case 'cheat':
        case 'cheats':
          setCheatsOpen((open) => !open);
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
          If this is about paying for model calls, open{' '}
          <button type="button" className="link" onClick={game.openSettings}>
            Settings
          </button>{' '}
          — or, for a Claude subscription, run <code>pnpm login</code> then <code>pnpm auth</code>.
        </p>
      </div>
    );
  }

  // Who pays comes before what to play. On a cold start the provider is asked
  // first, so a player with no key lands on the screen that takes one rather
  // than on a faction list whose every choice would be refused.
  if (game.settingsOpen || (game.needsCampaign && providerReady === false)) {
    return (
      <SettingsPanel
        firstRun={game.needsCampaign || !view}
        onDone={(s) => {
          setProviderReady(s.ready);
          game.closeSettings();
        }}
      />
    );
  }

  if (game.needsCampaign || !view) {
    return game.needsCampaign ? (
      <FactionPicker
        onStart={game.start}
        onResume={game.resume}
        onImport={game.importCampaign}
        // Only when a campaign is still loaded — on a cold start there is
        // nothing behind this screen to go back to.
        onBack={view ? () => game.rejoinCampaign() : undefined}
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
        {view.sandboxEvent && (
          <span className="pill" title="Only this random event fires, every turn. Not a real campaign.">
            sandbox: {RIM_EVENT_TITLE[view.sandboxEvent].toLowerCase()}
          </span>
        )}
        <span style={{ color: player ? ansi256ToHex(player.displayColor) : undefined }}>
          {player?.name}
        </span>
        <span className="spacer" />
        {view.staged.length > 0 && <span className="pill">{view.staged.length} declared</span>}
        {/* The running total. Under a pasted key this is the player's money. */}
        <span
          className={`spend${view.spend.capUsd !== null && view.spend.usd >= view.spend.capUsd ? ' over' : ''}`}
          title="Spent on model calls since the server started"
        >
          ${view.spend.usd.toFixed(2)}
          {view.spend.capUsd !== null && ` / $${view.spend.capUsd.toFixed(2)}`}
        </span>
        <button type="button" className="ghost-btn" onClick={game.openSettings} title="Provider, API key and spend cap">
          Settings
        </button>
        <button
          type="button"
          className="ghost-btn"
          title="Save this campaign to disk — load it from the title screen, or: pnpm resume <file>"
          onClick={() => void game.exportCampaign()}
        >
          Save
        </button>
        <span className={game.connected ? 'dot on' : 'dot off'} title={game.connected ? 'server reachable' : 'cannot reach the server'} />
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
            <EpilogueStage epilogue={view.epilogue} onLeave={game.leaveCampaign} />
          ) : activeChannel ? (
            <PortraitStage state={view.state} factionId={activeChannel} />
          ) : (
            <GalaxyMap
              state={view.state}
              selectedId={selectedId}
              onSelect={setSelectedId}
              holding={view.effective.holding}
            />
          )}
          <div className="feed" ref={feedRef}>
            {game.messages.map((m) => (
              <div key={m.id}>
                {/* A beat, not a mode: the three typed non-outcomes get a
                    picture in the feed above the line that explains them,
                    while the map stays where it is. A missing file renders
                    nothing and the line alone carries it. */}
                {m.art && <OutcomeArt kind={m.art.kind} alt={m.art.alt} />}
                {m.event ? (
                  // The flavour line is written onto the message as it
                  // arrives — see the state handler in `useGame`.
                  <RimEventCard event={m.event} />
                ) : (
                  <p
                    className={`msg ${m.tone}`}
                    style={m.color !== undefined ? { color: ansi256ToHex(m.color) } : undefined}
                  >
                    {m.text}
                  </p>
                )}
              </div>
            ))}
            {busy && (
              <p className="msg busy" role="status" aria-live="polite">
                <Waiting label={busy} />
              </p>
            )}
          </div>
          {cheatsOpen && view && (
            <CheatPanel
              state={view.state}
              busy={busy !== null}
              onCheat={(c) => void game.cheat(c)}
              onClose={() => setCheatsOpen(false)}
            />
          )}
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
              ref={inputRef}
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
            effective={view.effective}
            onSelect={setSelectedId}
            onTalk={setDraftChannel}
            onDraft={draft}
            activeChannel={activeChannel}
          />
        </div>
      </main>
    </div>
  );
}
