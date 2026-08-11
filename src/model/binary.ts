import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Locate the Claude Code binary the Agent SDK ships as a platform-specific
 * optional dependency. The SDK finds this itself when it spawns; we need the
 * path separately so the game can check login state and drive `auth login`.
 */
export function resolveClaudeBinary(): string | null {
  const require = createRequire(import.meta.url);
  const suffix = process.platform === 'win32' ? '.exe' : '';

  // Two-step resolution is required. Under pnpm's strict node_modules layout
  // the platform package is a dependency of the SDK, not of this project, so it
  // is only resolvable from the SDK's own location — resolving it from here
  // fails silently and makes the game look unauthenticated when it is not.
  let sdkRequire: NodeJS.Require;
  try {
    sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
  } catch {
    return null;
  }

  const candidates = [
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${suffix}`,
    // musl variants, for Alpine-style Linux hosts.
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl/claude${suffix}`,
  ];

  for (const candidate of candidates) {
    try {
      const path = sdkRequire.resolve(candidate);
      if (existsSync(path)) return path;
    } catch {
      // Not installed for this platform; try the next.
    }
  }
  return null;
}
