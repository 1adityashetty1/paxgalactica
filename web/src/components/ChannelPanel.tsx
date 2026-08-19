import { useEffect, useRef, useState } from 'react';
import type { CampaignView } from '../../../src/api/contract.js';
import { getFaction } from '../../../src/domain/state.js';
import { ansi256ToHex } from '../color.js';
import { MAX_CHANNEL_MESSAGES } from '../../../src/api/contract.js';

/**
 * A diplomatic channel as an actual conversation.
 *
 * The terminal put dialogue in the same scrolling feed as everything else,
 * which made a negotiation hard to follow and made the boundary invisible. Here
 * the channel is its own surface, and the banner states plainly that nothing
 * said in it changes the world until it closes.
 */
export function ChannelPanel({
  view,
  factionId,
  busy,
  onSend,
  onClose,
}: {
  view: CampaignView;
  /** May be open server-side, or merely intended — the first message opens it. */
  factionId: string;
  busy: string | null;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const faction = getFaction(view.state, factionId);
  // Only the server-confirmed channel has history worth showing.
  const history = view.openChannel === factionId ? view.channelHistory : [];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, busy]);

  if (!faction) return null;
  const color = ansi256ToHex(faction.displayColor);

  // The server refuses an 11th message. Counting the same way it does, from the
  // history already in the view, keeps the two from drifting without adding a
  // field to the contract — and means the player sees the wall coming instead
  // of discovering it by being turned away mid-sentence.
  const sent = history.filter((m) => m.speaker === 'player').length;
  const left = Math.max(0, MAX_CHANNEL_MESSAGES - sent);
  const full = left === 0;

  return (
    <section className="channel" style={{ borderColor: color }}>
      <header style={{ borderColor: color }}>
        <span className="swatch" style={{ background: color }} />
        <strong style={{ color }}>{faction.name}</strong>
        <span className="spacer" />
        <button className="endtalk" onClick={onClose} disabled={!!busy}>
          Close &amp; extract
        </button>
      </header>

      <p className="channel-warning">
        Nothing said here changes the galaxy. When you close the channel, a
        separate pass reads the transcript and enacts only what was actually
        agreed.
      </p>

      <div className="channel-log" ref={scroller}>
        {history.length === 0 && (
          <p className="empty">Open with something concrete. Vague warmth buys nothing.</p>
        )}
        {history.map((m, i) => (
          <div key={i} className={m.speaker === 'player' ? 'turn-you' : 'turn-them'}>
            <span className="who" style={m.speaker === 'faction' ? { color } : undefined}>
              {m.speaker === 'player' ? 'You' : faction.name}
            </span>
            <p>{m.text}</p>
          </div>
        ))}
        {busy && <p className="channel-busy">{busy}…</p>}
      </div>

      {/* Only once it is close enough to matter: a counter on every channel
          would make a three-exchange negotiation feel rationed, which is the
          opposite of what this cap is for. */}
      {left <= 3 && (
        <p className="channel-limit">
          {full
            ? 'This channel is full. Close it to enact whatever was agreed — you can open a fresh one afterwards.'
            : `${left} message${left === 1 ? '' : 's'} left in this channel.`}
        </p>
      )}

      <form
        className="channel-input"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text || busy || full) return;
          setDraft('');
          onSend(text);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            full
              ? 'This conversation is finished — close it to enact what was agreed'
              : busy
                ? 'Waiting…'
                : `Say something to ${faction.name}`
          }
          disabled={!!busy || full}
          autoFocus
        />
        <button type="submit" disabled={!!busy || full || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
