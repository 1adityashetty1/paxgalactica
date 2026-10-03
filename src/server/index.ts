import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, createGzip, gunzipSync } from 'node:zlib';
import { DEFAULT_PORT, ROUTES, STREAM_CONTENT_TYPE, type StreamLine } from '../api/contract.js';
import { FileCampaignStore, MemoryCampaignStore, type CampaignStore } from '../engine/store.js';
import { providerStatus, runServerPreflight } from '../preflight.js';
import { dispatch } from './router.js';
import { GameSession } from './session.js';
import { handleStateless } from './stateless.js';
import { serveStatic } from './static.js';

/**
 * The Pax Galactica server.
 *
 * **Stateless.** The browser holds the session and sends it with every
 * request (see `stateless.ts`), so any instance can serve any request and an
 * instance can vanish between two of them. That is what lets this run on Cloud
 * Run as well as on localhost, unchanged.
 *
 * Binds to 127.0.0.1 by default, because this process spends real money on
 * model calls and has no authentication. `PAXGALACTICA_HOST=0.0.0.0` opens it
 * up — the container image sets that — and doing so on a reachable network is
 * a decision to put the bill behind no lock at all.
 */

const HOST = process.env.PAXGALACTICA_HOST ?? '127.0.0.1';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', 'web');
/**
 * What a request may carry. A session grows with the campaign — the journal,
 * the transcripts and the committed world — and is a few hundred KB raw by
 * turn 100, a few tens gzipped. These are ceilings against abuse, not budgets:
 * Cloud Run itself refuses a request over 32 MB.
 */
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_DECODED_BYTES = 96 * 1024 * 1024;

/**
 * Where save files go. `file` keeps writing `saves/<name>.json` as the game
 * always has, so the saves list, `pnpm replay` and `pnpm resume` keep working
 * locally — it is a mirror of what the browser holds, never read back during
 * play. `memory` writes nowhere, for a container whose disk is RAM.
 */
const STORE: CampaignStore =
  process.env.PAXGALACTICA_STORE === 'memory' ? new MemoryCampaignStore() : new FileCampaignStore();

/* ---------------- preflight, before anything binds ---------------- */

// Never fatal: a key can be entered in the browser, so the server has to be up
// to show the screen it is entered on. What used to be the abort is the
// session's refusal to start a campaign on a provider that cannot answer.
// `PAXGALACTICA_SKIP_PREFLIGHT=1` skips even the report, for a container smoke
// test or a host whose credential arrives another way.
if (process.env.PAXGALACTICA_SKIP_PREFLIGHT !== '1') {
  const preflight = runServerPreflight();
  for (const warning of preflight.warnings) process.stderr.write(`note: ${warning}\n`);
  process.stdout.write(`Model calls: ${preflight.status.detail}${preflight.status.ready ? '' : ' (not ready)'}\n`);
}

/**
 * `pnpm resume <file>` installs a campaign and starts this server with its
 * name. The first page to boot is handed it, once; after that the browser
 * holds it like any other.
 */
let autoload = process.env.PAXGALACTICA_CAMPAIGN ?? null;
const takeAutoload = (): string | null => {
  // Loading it would be refused until model calls are set up, so it waits:
  // the settings screen comes first, and the next boot after it takes it.
  if (autoload !== null && !providerStatus().ready) return null;
  const name = autoload;
  autoload = null;
  return name;
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  let bytes = Buffer.concat(chunks);
  // The browser gzips its requests — the session is mostly JSON and shrinks
  // five- to tenfold. `maxOutputLength` keeps a small bomb from being a big
  // allocation.
  if ((req.headers['content-encoding'] ?? '').toLowerCase() === 'gzip') {
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_DECODED_BYTES });
    } catch {
      throw new Error('Request body was not valid gzip, or decompressed too large.');
    }
  }
  const raw = bytes.toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Request body was not valid JSON.');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Open a newline-delimited JSON stream, gzipped when the browser accepts it.
 *
 * Cloud Run compresses nothing for you, and a state push is ~280 KB of JSON at
 * turn 100 against ~37 KB gzipped. Each line is flushed as it is written, so
 * compression never holds a progress line back.
 */
function openStream(
  req: IncomingMessage,
  res: ServerResponse,
): { write: (line: StreamLine) => void; end: () => void } {
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    'Content-Type': `${STREAM_CONTENT_TYPE}; charset=utf-8`,
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  if (!gzip) {
    return {
      write: (line) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
      },
      end: () => res.end(),
    };
  }
  const z = createGzip();
  z.pipe(res);
  return {
    write: (line) => {
      if (z.writableEnded) return;
      z.write(`${JSON.stringify(line)}\n`);
      z.flush(zlibConstants.Z_SYNC_FLUSH);
    },
    end: () => z.end(),
  };
}

const server = createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
      });
    } else {
      res.end();
    }
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  // No CORS headers on purpose. Same-origin only: the client is served from
  // this process, and a permissive policy would let any page in the browser
  // drive a game that spends money.

  // The routes that need no session: what can be played, what is in `saves/`
  // on this machine, and the settings screen, which comes before any campaign.
  if (method === 'GET' && path === ROUTES.factions) {
    const result = await dispatch(new GameSession(STORE), method, path, {});
    return sendJson(res, result.status, result.body);
  }
  if (path === ROUTES.settings && (method === 'GET' || method === 'POST')) {
    let body: unknown = {};
    if (method === 'POST') {
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          error: { code: 'bad_request', message: err instanceof Error ? err.message : 'Bad body.' },
        });
      }
    }
    const result = await dispatch(new GameSession(STORE), method, path, body);
    return sendJson(res, result.status, result.body);
  }

  if (path.startsWith('/api/')) {
    if (method !== 'POST') {
      return sendJson(res, 405, {
        error: {
          code: 'bad_request',
          message: `${method} ${path}: every game route is a POST carrying the session.`,
        },
      });
    }
    let envelope: unknown;
    try {
      envelope = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, {
        error: { code: 'bad_request', message: err instanceof Error ? err.message : 'Bad body.' },
      });
    }

    const stream = openStream(req, res);
    try {
      const { result, session } = await handleStateless(method, path, envelope, {
        store: STORE,
        // Progress, reactions and state pushes go out on this response as they
        // happen. They used to travel over a separate SSE connection, which a
        // second instance would never see.
        emit: (event) => stream.write(event),
        takeAutoload,
        providerReady: () => providerStatus(),
      });
      stream.write({ type: 'result', status: result.status, body: result.body });
      stream.write({ type: 'session', session });
    } catch (err) {
      stream.write({
        type: 'result',
        status: 500,
        body: { error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } },
      });
    }
    stream.end();
    return;
  }

  if ((method === 'GET' || method === 'HEAD') && serveStatic(WEB_ROOT, path, res, method)) {
    return;
  }

  sendJson(res, 404, {
    error: {
      code: 'not_found',
      message: existsSync(WEB_ROOT)
        ? `No route for ${method} ${path}.`
        : 'The browser client has not been built yet. Run `pnpm build:web`. The API is available under /api.',
    },
  });
}

// `PORT` is what Cloud Run sets; the game's own variable wins when both are.
const port = Number(process.env.PAXGALACTICA_PORT ?? process.env.PORT ?? DEFAULT_PORT);

// A port already in use is a first-run failure for an installed copy, not a
// developer annoyance (docs/architecture.md A.9): say what to do instead of
// printing a stack.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(
      `\nPort ${port} is already in use — another copy of the game may be running.\nStop it, or start this one on another port: PAXGALACTICA_PORT=${port + 1}\n\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, HOST, () => {
  process.stdout.write(
    [
      '',
      `Pax Galactica server on http://${HOST}:${port}`,
      '',
      HOST === '127.0.0.1'
        ? 'Bound to loopback only. Ctrl-C to stop.'
        : `Bound to ${HOST}. There is no authentication.`,
      '',
    ].join('\n'),
  );
});

/* ---------------- graceful shutdown ---------------- */

// Nothing to save: the browser holds every campaign. Stop taking requests, let
// the ones in flight finish, and do not hang on a stuck connection.
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
