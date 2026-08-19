import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, ROUTES } from '../api/contract.js';
import { PreflightError, runServerPreflight } from '../preflight.js';
import { EventHub } from './events.js';
import { dispatch } from './router.js';
import { GameSession } from './session.js';
import { serveStatic } from './static.js';

/**
 * The Pax Galactica localhost server.
 *
 * Binds to 127.0.0.1 ONLY. This process can spend real money on model calls
 * and has no authentication, because it is a single-player game on your own
 * machine — which is exactly why it must never be reachable from the network.
 */

const HOST = '127.0.0.1';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', 'web');
const MAX_BODY_BYTES = 64 * 1024;
/** Uploads are the one route that carries bulk: a base64 campaign archive. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/* ---------------- preflight, before anything binds ---------------- */

try {
  const { warnings } = runServerPreflight();
  for (const warning of warnings) process.stderr.write(`note: ${warning}\n`);
} catch (err) {
  if (err instanceof PreflightError) {
    process.stderr.write(`\n${err.message}\n\n`);
    process.exit(1);
  }
  throw err;
}

const hub = new EventHub();
const session = new GameSession(undefined, (event) => hub.broadcast(event));

async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
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

function sendDownload(
  res: ServerResponse,
  { filename, bytes }: { filename: string; bytes: Uint8Array },
): void {
  res.writeHead(200, {
    'Content-Type': 'application/gzip',
    // Quoted because the filename carries a timestamp with dashes and dots;
    // the browser uses this verbatim as the saved name.
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': bytes.byteLength,
  });
  res.end(Buffer.from(bytes));
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
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const path = url.pathname;

  // No CORS headers on purpose. Same-origin only: the client is served from
  // this process, and a permissive policy would let any page in the browser
  // drive a game that spends money.

  if (path === ROUTES.events) {
    if (method !== 'GET') return sendJson(res, 405, { error: { code: 'bad_request', message: 'GET only.' } });
    hub.subscribe(res);
    hub.broadcast({ type: 'hello', turn: session.hasCampaign() ? session.view().state.turn : 0 });
    return;
  }

  if (path.startsWith('/api/')) {
    let body: unknown = {};
    if (method !== 'GET') {
      try {
        body = await readBody(
          req,
          path === ROUTES.importCampaign ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES,
        );
      } catch (err) {
        return sendJson(res, 400, {
          error: { code: 'bad_request', message: err instanceof Error ? err.message : 'Bad body.' },
        });
      }
    }
    const result = await dispatch(session, method, path, body);
    if (result.download) return sendDownload(res, result.download);
    return sendJson(res, result.status, result.body);
  }

  if (
    (method === 'GET' || method === 'HEAD') &&
    serveStatic(WEB_ROOT, path, res, method)
  ) {
    return;
  }

  sendJson(res, 404, {
    error: {
      code: 'not_found',
      message: existsSync(WEB_ROOT)
        ? `No route for ${method} ${path}.`
        : 'The browser client has not been built yet (Phase 2 Prompt 3). The API is available under /api.',
    },
  });
}

/**
 * Open a campaign at boot, so `pnpm resume <archive>` lands the player in the
 * game rather than on the title screen next to the save it just installed.
 */
const autoload = process.env.PAXGALACTICA_CAMPAIGN;
if (autoload) {
  try {
    const view = await session.resume(autoload);
    process.stdout.write(`Loaded campaign "${autoload}" at turn ${view.state.turn}.\n`);
  } catch (err) {
    process.stderr.write(
      `Could not load campaign "${autoload}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

const port = Number(process.env.PAXGALACTICA_PORT ?? DEFAULT_PORT);

server.listen(port, HOST, () => {
  process.stdout.write(
    [
      '',
      `Pax Galactica server on http://${HOST}:${port}`,
      `  API      http://${HOST}:${port}/api/campaign`,
      `  events   http://${HOST}:${port}${ROUTES.events}`,
      '',
      'Bound to loopback only. Ctrl-C to stop.',
      '',
    ].join('\n'),
  );
});

/* ---------------- graceful shutdown ---------------- */

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n${signal} — saving…\n`);
  try {
    const { saved, stagedLost } = await session.shutdown();
    if (saved) process.stdout.write('Campaign saved.\n');
    if (stagedLost > 0) {
      // Staged actions live outside the journal by design, so they cannot be
      // persisted. Say so rather than losing them silently.
      process.stdout.write(
        `Warning: ${stagedLost} declared action(s) had not landed and were lost. End the turn to keep them.\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`Save failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  hub.closeAll();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
