import type { ServerResponse } from 'node:http';
import type { ServerEvent } from '../api/contract.js';

/**
 * Server-sent events, so the browser can watch a turn happen.
 *
 * SSE rather than WebSocket: the traffic is entirely one-way (the client posts
 * intents over ordinary HTTP), it is plain text over the existing connection,
 * it reconnects on its own, and it needs no dependency. A WebSocket would buy
 * bidirectionality this design does not use.
 */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();

  subscribe(res: ServerResponse): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // The dev server proxies this; without the hint some proxies buffer the
      // stream and the client sees nothing until the response ends.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);

    // A comment line every 25s keeps intermediaries from reaping an idle
    // stream. Model calls routinely leave it silent for 15 seconds.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 25_000);
    keepAlive.unref?.();

    const cleanup = (): void => {
      clearInterval(keepAlive);
      this.clients.delete(res);
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
    return cleanup;
  }

  broadcast(event: ServerEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      if (res.writableEnded) {
        this.clients.delete(res);
        continue;
      }
      try {
        res.write(payload);
      } catch {
        // A dropped client must never take down a turn in progress.
        this.clients.delete(res);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // Shutting down; nothing useful to do about a failed close.
      }
    }
    this.clients.clear();
  }
}
