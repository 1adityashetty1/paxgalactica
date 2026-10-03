import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The reducer suite must never touch the network. Any attempt to spawn a
    // model call in tests should fail loudly rather than silently bill tokens.
    //
    // The provider settings are read from PAXGALACTICA_HOME, pointed at a
    // directory that does not exist, so the suite can never pick up a
    // developer's stored keys or provider choice — and the provider and spend
    // cap variables are blanked so a shell's exports cannot either.
    env: {
      PAXGALACTICA_NO_NETWORK: '1',
      PAXGALACTICA_HOME: join(tmpdir(), 'paxgalactica-suite-has-no-home'),
      PAXGALACTICA_PROVIDER: '',
      PAXGALACTICA_SPEND_CAP: '',
      PAXGALACTICA_SAVE_DIR: '',
    },
  },
});
