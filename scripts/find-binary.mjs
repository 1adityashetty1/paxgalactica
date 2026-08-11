import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

/**
 * Locate the Claude Code binary the Agent SDK ships as a platform-specific
 * optional dependency.
 *
 * The two-step resolution matters. Under pnpm's strict node_modules layout the
 * platform package is a dependency of `@anthropic-ai/claude-agent-sdk`, not of
 * this project, so it is NOT resolvable from the project root — only from the
 * SDK's own location. Resolving it directly silently fails.
 */
export function findClaudeBinary() {
  const require = createRequire(import.meta.url);
  const suffix = process.platform === 'win32' ? '.exe' : '';

  let sdkRequire;
  try {
    sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
  } catch {
    return null;
  }

  const candidates = [
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${suffix}`,
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
