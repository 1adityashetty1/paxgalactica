import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROUTES,
  ServerEventSchema,
  type CampaignView,
} from '../../src/api/contract.js';
import { api, ApiError } from './api.js';

export interface Message {
  id: number;
  text: string;
  tone: 'you' | 'narrative' | 'faction' | 'system' | 'error' | 'check' | 'brief' | 'refusal';
  color?: number;
}

let nextMessageId = 1;

/**
 * All client state in one place: the campaign view, the message log, and the
 * busy flag driven by server-sent events.
 *
 * The server is authoritative. Every mutation posts an intent and then takes
 * whatever view comes back — the client never computes game state, because the
 * reducer is the only thing allowed to.
 */
export function useGame() {
  const [view, setView] = useState<CampaignView | null>(null);
  const [needsCampaign, setNeedsCampaign] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const say = useCallback((text: string, tone: Message['tone'], color?: number) => {
    setMessages((prev) => [...prev, { id: nextMessageId++, text, tone, color }].slice(-500));
  }, []);

  /* ---------------- initial load ---------------- */

  useEffect(() => {
    let cancelled = false;
    void api
      .campaign()
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.isNoCampaign) setNeedsCampaign(true);
        else if (err instanceof ApiError && err.isAuth) setFatal(err.message);
        else setFatal(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- server-sent events ---------------- */

  useEffect(() => {
    const source = new EventSource(ROUTES.events);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (raw) => {
      const parsed = ServerEventSchema.safeParse(JSON.parse(raw.data as string));
      if (!parsed.success) return;
      const event = parsed.data;

      if (event.type === 'progress') {
        // The label is written to be shown verbatim: "Resolving",
        // "Ojjul Hutt Combine considers".
        setBusy(event.busy ? event.label : null);
      } else if (event.type === 'state') {
        setView(event.view);
        setNeedsCampaign(false);
      } else if (event.type === 'error') {
        say(event.message, 'error');
      }
    };

    return () => source.close();
  }, [say]);

  /* ---------------- intents ---------------- */

  const guard = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (err) {
        if (err instanceof ApiError && err.isBusy) {
          // Expected: something else is running. Not worth alarming anyone.
          say('Still working on the previous request…', 'system');
          return;
        }
        say(err instanceof Error ? err.message : String(err), 'error');
      }
    },
    [say],
  );

  const start = useCallback(
    (factionId: string) =>
      guard(async () => {
        const v = await api.newCampaign(factionId);
        setView(v);
        setNeedsCampaign(false);
        setMessages([]);
        say(`You command the ${v.state.factions.find((f) => f.id === factionId)?.name}.`, 'system');
      }),
    [guard, say],
  );

  const resume = useCallback(
    (name: string) =>
      guard(async () => {
        const v = await api.resume(name);
        setView(v);
        setNeedsCampaign(false);
        say(`Resumed "${name}" at turn ${v.state.turn}.`, 'system');
      }),
    [guard, say],
  );

  const act = useCallback(
    (text: string) =>
      guard(async () => {
        say(`> ${text}`, 'you');
        const outcome = await api.action(text);
        if (outcome.refusal) {
          // Your own faction said no. Distinct from a failed roll, and from a
          // rejected op — nothing was attempted at all.
          say(
            `${outcome.refusal.by} refuse the order: ${outcome.refusal.reason}`,
            'refusal',
          );
          if (outcome.refusal.violated) say(`Breached: ${outcome.refusal.violated}`, 'system');
          say(outcome.narrative, 'narrative');
          for (const note of outcome.notes) say(note, 'system');
          return;
        }
        if (outcome.check) {
          const c = outcome.check;
          const sign = c.modifier >= 0 ? '+' : '';
          say(
            `${c.stat} · d20 ${c.roll}${sign}${c.modifier} = ${c.total} vs DC ${c.difficulty} → ${c.outcome.replace('_', ' ')}`,
            'check',
          );
        }
        say(outcome.narrative, 'narrative');
        for (const note of outcome.notes) say(note, 'system');
        for (const r of outcome.rejections) say(`rejected [${r.code}] ${r.message}`, 'error');
        say(`declared — lands on end of turn`, 'system');
      }),
    [guard, say],
  );

  const endTurn = useCallback(
    () =>
      guard(async () => {
        const outcome = await api.endTurn();
        say(`── Turn ${outcome.briefing.turn} ──`, 'system');
        say(
          outcome.applied > 0
            ? `Applied ${outcome.applied} declared action${outcome.applied === 1 ? '' : 's'}.`
            : 'You declared nothing this turn.',
          'system',
        );
        for (const r of outcome.reactions) say(`${r.factionName}: ${r.narrative}`, 'faction', r.color);
        for (const r of outcome.rejections) say(`rejected [${r.code}] ${r.message}`, 'error');
      }),
    [guard, say],
  );

  const discard = useCallback(
    (index?: number) =>
      guard(async () => {
        const { discarded } = await api.discardStaged(index);
        say(discarded > 0 ? `Discarded ${discarded} declared action(s).` : 'Nothing to discard.', 'system');
      }),
    [guard, say],
  );

  const talk = useCallback(
    (factionId: string, text: string) =>
      guard(async () => {
        const name = view?.state.factions.find((f) => f.id === factionId)?.name ?? factionId;
        const color = view?.state.factions.find((f) => f.id === factionId)?.displayColor;
        say(`You → ${name}: ${text}`, 'you');
        const { reply } = await api.talk(factionId, text);
        say(`${name}: ${reply}`, 'faction', color);
      }),
    [guard, say, view],
  );

  const endTalk = useCallback(
    (factionId: string) =>
      guard(async () => {
        const outcome = await api.endTalk(factionId);
        say(outcome.narrative, 'narrative');
        for (const r of outcome.rejections) say(`rejected [${r.code}] ${r.message}`, 'error');
        say(
          outcome.staged > 0
            ? 'Agreement declared — lands on end of turn.'
            : 'Nothing was agreed.',
          'system',
        );
      }),
    [guard, say],
  );

  /**
   * Download the campaign as a .tar.gz.
   *
   * Not behind `guard`: an export reads the committed journal and cannot
   * interleave with a model call, and a backup is exactly the thing you want
   * while a turn is grinding away.
   */
  const exportCampaign = useCallback(async () => {
    try {
      const { filename, size } = await api.exportCampaign();
      const staged = view?.staged.length ?? 0;
      say(`Saved ${filename} (${(size / 1024).toFixed(1)} kB).`, 'system');
      say('Resume it anywhere with: pnpm resume <file>', 'system');
      if (staged > 0) {
        // Staged actions are not in the journal, so an archive cannot carry
        // them. Say so — silently dropping declarations is how a player loses
        // a turn's work and blames the save format.
        say(
          `Note: ${staged} declared action${staged === 1 ? '' : 's'} not yet landed and ${
            staged === 1 ? 'is' : 'are'
          } not in the archive. End the turn first to include ${staged === 1 ? 'it' : 'them'}.`,
          'error',
        );
      }
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [say, view]);

  const importCampaign = useCallback(
    (file: File) =>
      guard(async () => {
        const outcome = await api.importCampaign(file);
        setNeedsCampaign(false);
        say(
          `Loaded "${outcome.name}" — turn ${outcome.turn}, ${outcome.journalEntries} journal entries, exported ${outcome.exportedAt.slice(0, 16).replace('T', ' ')}.`,
          'system',
        );
      }),
    [guard, say],
  );

  return {
    view,
    needsCampaign,
    exportCampaign,
    importCampaign,
    busy,
    messages,
    fatal,
    connected,
    say,
    start,
    resume,
    act,
    endTurn,
    discard,
    talk,
    endTalk,
  };
}

/** Scroll a feed element to the bottom whenever it grows. */
export function useStickToBottom(dep: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
