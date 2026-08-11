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
        // SSE must stream rather than buffer, or progress never arrives.
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
});
