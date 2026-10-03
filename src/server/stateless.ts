import { Buffer } from 'node:buffer';
import { RequestEnvelopeSchema, type ServerEvent } from '../api/contract.js';
import type { CampaignStore } from '../engine/store.js';
import { ApiFailure, toApiFailure } from './errors.js';
import { dispatch, type RouteResult } from './router.js';
import { GameSession, SessionSnapshotSchema, type SessionSnapshot } from './session.js';

/**
 * One request, with no memory of any other.
 *
 * The server used to hold one `GameSession` for the life of the process. That
 * cannot survive Cloud Run, where instances are disposable and consecutive
 * requests land wherever they land. So the browser carries the session — a
 * `SessionSnapshot` — and each request is: rebuild a session from it, run the
 * route exactly as before through `dispatch`, and hand back the next snapshot.
 *
 * Nothing about the game changes. `GameSession` and `dispatch` are the same
 * code the localhost server always ran; this is only where they get their
 * state from. Cheating is not a concern — the browser can edit what it sends,
 * and for a single-player game played for fun that is fine.
 */

export interface StatelessOutcome {
  result: RouteResult;
  session: SessionSnapshot | null;
}

export interface StatelessOptions {
  store: CampaignStore;
  emit?: (event: ServerEvent) => void;
  /**
   * A campaign to hand to the first booting page, by save name. Set when the
   * server was started by `pnpm resume <file>`, and returns null once taken.
   */
  takeAutoload?: () => string | null;
  /**
   * Whether model calls can be made, so a session refuses to begin play on a
   * provider that cannot answer. Defaults to ready, for tests.
   */
  providerReady?: () => { ready: boolean; detail: string };
}

export async function handleStateless(
  method: string,
  path: string,
  envelope: unknown,
  options: StatelessOptions,
): Promise<StatelessOutcome> {
  const session = new GameSession(options.store, options.emit ?? (() => {}), options.providerReady);

  let request;
  try {
    request = RequestEnvelopeSchema.parse(envelope);
    const autoload = request.boot ? options.takeAutoload?.() ?? null : null;
    if (autoload !== null) {
      await session.resume(autoload);
    } else if (request.session !== null) {
      restoreFrom(session, request.session);
    }
  } catch (err) {
    const failure = toApiFailure(err);
    return { result: { status: failure.status, body: failure.toBody() }, session: null };
  }

  const result = await dispatch(session, method, path, request.body);
  // A random event's flavour line is written after the turn returns, and it
  // belongs in the session the browser keeps. Waiting here costs the player
  // nothing: the result has already been streamed by the time this runs.
  await session.dressing;

  return { result: withDownloadAsData(result), session: session.snapshot() };
}

function restoreFrom(session: GameSession, raw: unknown): void {
  const parsed = SessionSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiFailure(
      'no_campaign',
      'The campaign this browser was holding could not be read. Start a new one or load a save file.',
    );
  }
  try {
    session.restore(parsed.data);
  } catch (err) {
    throw new ApiFailure(
      'no_campaign',
      `The campaign this browser was holding could not be rebuilt: ${
        err instanceof Error ? err.message : String(err)
      }. Start a new one or load a save file.`,
    );
  }
}

/**
 * A save file goes back as data inside the stream rather than as a download,
 * so the browser writes it to disk itself and an error arrives like any other.
 */
function withDownloadAsData(result: RouteResult): RouteResult {
  if (!result.download) return result;
  return {
    status: result.status,
    body: {
      filename: result.download.filename,
      archiveBase64: Buffer.from(result.download.bytes).toString('base64'),
    },
  };
}
