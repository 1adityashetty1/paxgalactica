import {
  ActionOutcomeSchema,
  AdvisorOutcomeSchema,
  ApiErrorSchema,
  CheatResultSchema,
  DiscardResultSchema,
  CampaignViewSchema,
  ExportResultSchema,
  FactionListSchema,
  ImportOutcomeSchema,
  ROUTES,
  STREAM_CONTENT_TYPE,
  SettingsViewSchema,
  StreamLineSchema,
  TurnOutcomeSchema,
  type ActionOutcomeResponse,
  type AdvisorOutcomeResponse,
  type CampaignView,
  type RequestEnvelope,
  type ServerEvent,
  type SettingsUpdate,
  type SettingsView,
  type TurnOutcomeResponse,
} from '../../src/api/contract.js';
import type { Cheat } from '../../src/domain/cheats.js';
import type { RimEventKind } from '../../src/domain/events.js';

/**
 * Typed client for the game server.
 *
 * Responses are parsed with the same Zod schemas the server validates against,
 * so a contract drift shows up here as a loud error instead of an undefined
 * field three components deep.
 *
 * **The browser holds the campaign.** The server keeps nothing between
 * requests — that is what lets it run on Cloud Run — so every call sends the
 * session this module is holding and adopts the one that comes back. The
 * session is opaque here: it is stored, sent and replaced, never read. It is
 * also kept in IndexedDB, so a reload picks up where the player was.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A call is already running. Expected, not exceptional. */
  get isBusy(): boolean {
    return this.code === 'conflict';
  }

  /** No campaign loaded — the signal to show the picker. */
  get isNoCampaign(): boolean {
    return this.code === 'no_campaign';
  }

  get isAuth(): boolean {
    return this.code === 'not_authenticated';
  }

  /** The spend cap the player set has been reached. */
  get isSpendCap(): boolean {
    return this.code === 'spend_cap';
  }
}

/* ---------------- events streamed alongside a call ---------------- */

const listeners = new Set<(event: ServerEvent) => void>();

/** Progress, reactions and state pushes, as each call streams them. */
export function onServerEvent(listener: (event: ServerEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const connectionListeners = new Set<(connected: boolean) => void>();

/** Whether the last call reached the server at all. */
export function onConnection(listener: (connected: boolean) => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

const setConnected = (connected: boolean): void => {
  for (const l of connectionListeners) l(connected);
};

/* ---------------- the session this browser holds ---------------- */

let session: unknown = null;

/**
 * IndexedDB rather than localStorage: a session at turn 100 is several hundred
 * KB of JSON, and localStorage is a few MB of strings shared by everything on
 * the origin. Every failure here is swallowed — persistence is a convenience,
 * and a private window that refuses storage must still play.
 */
const DB_NAME = 'paxgalactica';
const DB_STORE = 'session';
const DB_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persist(value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      if (value === null) tx.objectStore(DB_STORE).delete(DB_KEY);
      else tx.objectStore(DB_STORE).put(value, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No storage: the campaign lives as long as the tab does.
  }
}

async function restorePersisted(): Promise<void> {
  try {
    const db = await openDb();
    session = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    session = null;
  }
}

function adopt(next: unknown): void {
  session = next;
  void persist(next);
}

/* ---------------- transport ---------------- */

/**
 * Gzip the request. A session is mostly JSON and shrinks five- to tenfold;
 * `CompressionStream` is built into every current browser, so this needs no
 * dependency. Falls back to plain JSON where it is missing.
 */
async function encode(envelope: RequestEnvelope): Promise<{ body: BodyInit; gzip: boolean }> {
  const json = JSON.stringify(envelope);
  if (typeof CompressionStream === 'undefined') return { body: json, gzip: false };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return { body: await new Response(stream).blob(), gzip: true };
}

/**
 * Calls run one at a time. Each sends the session the previous one returned,
 * so two in flight together would both start from the same campaign and the
 * second would silently undo the first.
 */
let queue: Promise<void> = Promise.resolve();

interface CallOptions {
  /** First read after the page loads — see `RequestEnvelopeSchema.boot`. */
  boot?: boolean;
}

/**
 * Post an intent and read the streamed answer.
 *
 * Resolves on the `result` line, which is when the player should see the
 * outcome; the queue moves on only once the `session` line after it has been
 * adopted, since that is the campaign the next call has to start from.
 */
function call<T>(
  path: string,
  schema: { parse: (v: unknown) => T },
  body: unknown = {},
  options: CallOptions = {},
): Promise<T> {
  let settle!: { resolve: (v: T) => void; reject: (e: unknown) => void };
  const result = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const run = queue.then(async () => {
    let settled = false;
    const resolve = (v: T): void => {
      settled = true;
      settle.resolve(v);
    };
    const reject = (e: unknown): void => {
      settled = true;
      settle.reject(e);
    };

    try {
      const { body: payload, gzip } = await encode({ session, body, boot: options.boot });
      let res: Response;
      try {
        res = await fetch(path, {
          method: 'POST',
          body: payload,
          headers: {
            'Content-Type': 'application/json',
            ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
          },
        });
        setConnected(true);
      } catch {
        setConnected(false);
        throw new ApiError('internal', 'Cannot reach the game server. Is it still running?', 0);
      }

      if (!(res.headers.get('Content-Type') ?? '').includes(STREAM_CONTENT_TYPE)) {
        throw await errorFrom(res);
      }

      await readLines(res, (raw) => {
        const parsed = StreamLineSchema.safeParse(raw);
        if (!parsed.success) return;
        const line = parsed.data;
        if (line.type === 'result') {
          if (line.status >= 400) {
            const err = toApiError(line.body, line.status);
            // The server could not rebuild the campaign this browser holds, so
            // stop sending it. The picker comes up and offers a fresh start.
            if (err.isNoCampaign) adopt(null);
            reject(err);
          } else {
            try {
              resolve(schema.parse(line.body));
            } catch (err) {
              reject(err);
            }
          }
        } else if (line.type === 'session') {
          // A null session means the request never got as far as a campaign —
          // a malformed body, say. Keep what is held rather than lose it.
          if (line.session !== null) adopt(line.session);
        } else {
          for (const l of listeners) l(line);
        }
      });

      if (!settled) {
        throw new ApiError('internal', 'The server closed the connection before answering.', 0);
      }
    } catch (err) {
      if (!settled) reject(err);
    }
  });

  queue = run.catch(() => {});
  return result;
}

/** Feed each JSON line of a streamed body to `onLine` as it arrives. */
async function readLines(res: Response, onLine: (value: unknown) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += value;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const text = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (text) onLine(JSON.parse(text));
    }
    if (done) break;
  }
  if (buffered.trim()) onLine(JSON.parse(buffered));
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as unknown;
  return toApiError(body, res.status);
}

function toApiError(body: unknown, status: number): ApiError {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success
    ? new ApiError(parsed.data.error.code, parsed.data.error.message, status)
    : new ApiError('internal', `HTTP ${status}`, status);
}

/* ---------------- the API ---------------- */

/**
 * A plain JSON request, for the routes that need no campaign: what can be
 * played, and the settings screen, which comes before there is any.
 */
async function plain<T>(path: string, schema: { parse: (v: unknown) => T }, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(
      path,
      body === undefined
        ? undefined
        : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    );
  } catch {
    throw new ApiError('internal', 'Cannot reach the game server. Is it still running?', 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return schema.parse(await res.json());
}

export const api = {
  factions: () => plain(ROUTES.factions, FactionListSchema),

  settings: (): Promise<SettingsView> => plain(ROUTES.settings, SettingsViewSchema),

  updateSettings: (update: SettingsUpdate): Promise<SettingsView> =>
    plain(ROUTES.settings, SettingsViewSchema, update),

  /**
   * The first read after the page loads: pick up the campaign this browser was
   * holding, or one the server was started with.
   */
  async boot(): Promise<CampaignView> {
    await restorePersisted();
    return call(ROUTES.campaign, CampaignViewSchema, {}, { boot: true });
  },

  campaign: () => call(ROUTES.campaign, CampaignViewSchema),

  newCampaign: (
    factionId: string,
    name = 'campaign',
    maxTurns?: number,
    sandboxEvent?: RimEventKind,
  ): Promise<CampaignView> =>
    call(ROUTES.newCampaign, CampaignViewSchema, { factionId, name, maxTurns, sandboxEvent }),

  resume: (name: string): Promise<CampaignView> =>
    call(ROUTES.resume, CampaignViewSchema, { name }),

  action: (text: string): Promise<ActionOutcomeResponse> =>
    call(ROUTES.action, ActionOutcomeSchema, { text }),

  advisor: (): Promise<AdvisorOutcomeResponse> => call(ROUTES.advisor, AdvisorOutcomeSchema),

  endTurn: (): Promise<TurnOutcomeResponse> => call(ROUTES.endturn, TurnOutcomeSchema),

  cheat: (cheat: Cheat) => call(ROUTES.cheat, CheatResultSchema, cheat),

  discardStaged: (index?: number) =>
    call(ROUTES.discardStaged, DiscardResultSchema, index === undefined ? {} : { index }),

  talk: (factionId: string, text: string) =>
    call(
      ROUTES.talk(factionId),
      { parse: (v: unknown) => v as { reply: string; costUsd: number } },
      { text },
    ),

  endTalk: (factionId: string): Promise<ActionOutcomeResponse> =>
    call(ROUTES.endtalk(factionId), ActionOutcomeSchema),

  /**
   * Write the campaign to disk as a save file.
   *
   * The same `.tar.gz` archive `pnpm resume` reads, now also carrying the turn
   * in progress — staged declarations and an open channel — so a game saved
   * mid-turn opens mid-turn.
   */
  async exportCampaign(): Promise<{ filename: string; size: number }> {
    const { filename, archiveBase64 } = await call(ROUTES.exportCampaign, ExportResultSchema);
    const bytes = Uint8Array.from(atob(archiveBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/gzip' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Revoking immediately can cancel the download in some browsers; one tick
    // is enough for the click to have been handed off.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { filename, size: blob.size };
  },

  /** Open a save file from disk. Replayed on the server before it is adopted. */
  async importCampaign(file: File, name?: string) {
    const archiveBase64 = await toBase64(file);
    return call(ROUTES.importCampaign, ImportOutcomeSchema, { archiveBase64, name });
  },
};

/** FileReader gives a data: URL; the payload is everything after the comma. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      if (comma === -1) reject(new Error('Unexpected file encoding.'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
