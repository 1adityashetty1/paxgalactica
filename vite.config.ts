import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_PORT } from './src/api/contract.js';

/**
 * Browser client build.
 *
 * The client imports `src/api/contract.ts` directly rather than duplicating
 * types, so there is exactly one definition of every message. That file uses
 * NodeNext-style `.js` specifiers pointing at `.ts` sources, which Vite
 * resolves natively — no path aliases and no build step between the two.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    // The server serves this directory when it exists.
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Dev runs Vite and the game server side by side; /api goes to the latter.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: false,
        // Every game route answers with a stream of progress lines, which
        // must pass through as they are written, not when the response ends.
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('application/x-ndjson')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
});
