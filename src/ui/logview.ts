import type { CampaignView } from '../api/contract.js';
import type { EventLogEntry } from '../domain/state.js';

/**
 * The event log is the largest thing in a campaign and the two cheapest wins
 * are both here: don't send it all, and don't draw it all.
 *
 * Measured on the real `classes_playtest` save — 443 entries in 12 turns, ~37 a
 * turn, 89KB of a 146KB state, so **61% of the world is history**. `pushState()`
 * has eight call sites and fires several times a turn.
 *
 * Pure and beside `layout.ts` and `portrait.ts` for the same reason those are:
 * there is no DOM in the suite, so logic that lives inside a component is logic
 * nothing checks.
 */

/**
 * Put a pushed tail back onto the history the client already holds.
 *
 * The cursor is an index because the visible log is **append-only and
 * order-stable**: `visibleTo` is fixed per entry, so entry `i` is always the
 * same entry and a splice at `eventLogFrom` is exact. No sequence number and no
 * schema change.
 *
 * A client holding fewer entries than the tail starts at would be spliced into
 * a history missing its middle, so that case keeps the shorter authoritative
 * log and lets the next full read repair it. A log with a hole in it is worse
 * than a short one, because nothing downstream can tell.
 */
export function spliceLog(prev: CampaignView | null, next: CampaignView): CampaignView {
  const from = next.eventLogFrom;
  if (from === 0) return next;
  const held = prev?.state.eventLog ?? [];
  if (held.length < from) return next;
  return {
    ...next,
    state: { ...next.state, eventLog: [...held.slice(0, from), ...next.state.eventLog] },
  };
}

/**
 * How much a log entry matters to the player, read off what is already there.
 *
 * - `attention` — something that happened to the player or their worlds and
 *   changes their position: a battle, a world gained or lost, a war or peace,
 *   an operative caught, a raid, a refusal, a debt gone bad.
 * - `notable` — the same kind of event between other powers.
 * - `routine` — everything else: yards laid down, programmes begun, rulings.
 *
 * A restructuring of the log and nothing more: no new state and no new
 * entries, only which existing lines are shown first. Classified by kind and
 * by the words the engine itself writes, which it writes the same way every
 * time — so a test pins the phrases against lines the engine produced.
 */
export type LogWeight = 'attention' | 'notable' | 'routine';

/** The engine's own phrases for a turn that changed something. */
const CONSEQUENTIAL = new RegExp(
  [
    // Battles and ground, and a fleet sent at somebody.
    '\\bagainst\\b', 'Fleets engage', 'Torpedoes run', '\\bstorms?\\b', 'takes possession', 'driven off', 'breaks off', 'thrown back',
    'falls to', 'joins .+ of its own accord', '\\brises against\\b', 'is restless', 'answers to nobody', 'cedes?\\b', 'ceded',
    // War and peace.
    'war between', '\\btruce\\b', '\\bceasefire\\b', 'goes to war', 'calls .+ to war', 'ultimatum', '\\bconcedes?\\b',
    'breaks (?:the|its|a)\\b', 'repudiat', 'Treaty lapsed', '\\bvoid',
    // Covert work and its discovery.
    '\\bexposes?\\b', '\\bcaught\\b', 'stand empty', 'turned out', 'Sabotage on', 'publishes proof', '\\bassassinat', '\\bkidnap', 'is held at', 'stirred',
    // Money that went wrong, and prices put on a power.
    '\\braid', '\\bdefault', 'delinquent', 'arrears', 'puts a price', '\\bbounty\\b',
    // Its own people.
    '\\bdissent\\b', '\\brefus', '\\bmutiny',
  ].join('|'),
  'i',
);

/** Lines the engine writes to keep the record, whatever they mention. */
const ROUTINE = /^\[(?:declared|check)\]|^Turn \d+: \d+ credits from|commissions \d+ tons|holds its position/;

export interface LogReader {
  playerFactionId: string;
  /** The player's name, and the names of the worlds they hold or once held. */
  names: readonly string[];
}

/** Who is reading, from the world as served. */
export function logReader(state: {
  playerFactionId: string;
  factions: readonly { id: string; name: string }[];
  systems: readonly { name: string; controllerFactionId: string | null; homeFactionId?: string | null }[];
}): LogReader {
  const me = state.playerFactionId;
  const name = state.factions.find((f) => f.id === me)?.name ?? me;
  const worlds = state.systems.filter((s) => s.controllerFactionId === me || s.homeFactionId === me).map((s) => s.name);
  return { playerFactionId: me, names: [name, ...worlds] };
}

/** One entry's weight — see `LogWeight`. */
export function weighEntry(entry: EventLogEntry, reader: LogReader): LogWeight {
  if (entry.kind === 'rejection' || entry.kind === 'clamp' || entry.kind === 'arbiter' || entry.kind === 'cheat') return 'routine';
  if (ROUTINE.test(entry.text)) return 'routine';
  const mine =
    entry.factionId === reader.playerFactionId ||
    /^Your\b|\byour\b/.test(entry.text) ||
    reader.names.some((n) => entry.text.includes(n));
  // What the Rim does to you, and your operatives' reports, are yours by scope.
  if (entry.kind === 'rim') return mine ? 'attention' : 'notable';
  if (!CONSEQUENTIAL.test(entry.text)) return 'routine';
  return mine ? 'attention' : 'notable';
}

/** The log, turned into what the Log tab draws. */
export interface LogDigest {
  /** Entries that need the player, newest first, from the last `recentTurns`. */
  attention: EventLogEntry[];
  /** Every entry passing the filters, newest turn first, each turn's entries newest first. */
  turns: { turn: number; entries: { entry: EventLogEntry; weight: LogWeight; index: number }[] }[];
  /** Entries older than the window, not drawn. */
  hidden: number;
}

/**
 * Group the log by turn and pull out what needs attention.
 *
 * `importantOnly` leaves routine lines out of the turns; the kind filter
 * works as it did. Windowed like `logWindow`: the newest `limit` entries that
 * pass the filters, sliced before anything is reversed.
 */
export function digestLog(
  entries: readonly EventLogEntry[],
  reader: LogReader,
  opts: { kinds: ReadonlySet<string>; importantOnly: boolean; limit: number; recentTurns?: number; attentionCap?: number },
): LogDigest {
  const weighed = entries.map((entry, index) => ({ entry, index, weight: weighEntry(entry, reader) }));
  const latest = entries.length > 0 ? entries[entries.length - 1]!.turn : 0;
  const since = latest - (opts.recentTurns ?? 2);
  const attention = weighed
    .filter((w) => w.weight === 'attention' && w.entry.turn >= since)
    .slice(-(opts.attentionCap ?? 12))
    .reverse()
    .map((w) => w.entry);
  const passing = weighed.filter(
    (w) => (opts.kinds.size === 0 || opts.kinds.has(w.entry.kind)) && (!opts.importantOnly || w.weight !== 'routine'),
  );
  const start = Math.max(0, passing.length - Math.max(0, opts.limit));
  const turns: LogDigest['turns'] = [];
  for (const w of passing.slice(start).reverse()) {
    const last = turns[turns.length - 1];
    if (last && last.turn === w.entry.turn) last.entries.push(w);
    else turns.push({ turn: w.entry.turn, entries: [w] });
  }
  return { attention, turns, hidden: start };
}
