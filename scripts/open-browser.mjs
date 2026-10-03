import { spawn } from 'node:child_process';

/**
 * Open a URL in the default browser, on the three platforms a player is likely
 * to be on (docs/architecture.md A.8, A.9). Falls back to printing the URL,
 * which is always correct and never hangs.
 */
export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => process.stdout.write(`\nOpen ${url} in your browser.\n`));
    child.unref();
  } catch {
    process.stdout.write(`\nOpen ${url} in your browser.\n`);
  }
}
