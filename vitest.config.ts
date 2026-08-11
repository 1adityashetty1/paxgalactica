import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The reducer suite must never touch the network. Any attempt to spawn a
    // model call in tests should fail loudly rather than silently bill tokens.
    env: { PAXGALACTICA_NO_NETWORK: '1' },
  },
});
