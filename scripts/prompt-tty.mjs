import { createInterface } from 'node:readline';
import { createReadStream, createWriteStream, openSync } from 'node:fs';

/**
 * Read a line from the terminal, preferring a freshly opened /dev/tty.
 *
 * Why not process.stdin: a child spawned with `stdio: 'inherit'` can leave the
 * parent's stdin consumed or at EOF when it exits, so a readline on it resolves
 * instantly with an empty string and the prompt appears to be skipped.
 *
 * Why openSync: /dev/tty fails with ENXIO wherever there is no controlling
 * terminal (CI, a sandbox, a piped run). createReadStream reports that
 * asynchronously as an 'error' event, which a try/catch around it does NOT
 * catch — it surfaces as an unhandled error and kills the process. openSync
 * throws synchronously, so the fallback actually works.
 */
function openTty() {
  try {
    return {
      input: createReadStream('', { fd: openSync('/dev/tty', 'r') }),
      output: createWriteStream('', { fd: openSync('/dev/tty', 'w') }),
      isTty: true,
    };
  } catch {
    return { input: process.stdin, output: process.stdout, isTty: false };
  }
}

export async function promptFromTty(question) {
  const { input, output, isTty } = openTty();

  // No /dev/tty and no interactive stdin means nobody can answer. Returning
  // empty lets the caller print its usage message, instead of awaiting a
  // promise that never settles and exiting 13 with no output at all.
  if (!isTty && !process.stdin.isTTY) return '';

  // Late writes are expected during teardown: readline echoes a trailing
  // newline after the answer resolves. Without these handlers that write lands
  // on a destroyed stream and surfaces as an unhandled ERR_STREAM_DESTROYED,
  // crashing the process *after* the work has already succeeded.
  input.on('error', () => {});
  output.on('error', () => {});

  const rl = createInterface({ input, output, terminal: true });

  try {
    return await new Promise((resolve) => {
      rl.question(question, resolve);
    });
  } finally {
    rl.close();
    if (isTty) {
      input.destroy?.();
      output.end?.();
    }
  }
}

/**
 * Read a value that may arrive across several lines, finishing on a blank line.
 *
 * A single readline question is wrong for pasted secrets. setup-token wraps its
 * token across two terminal lines, and pasting that submits at the first
 * newline: the answer is silently truncated and the remainder spills into
 * whatever prompt comes next. Collecting until a blank line reassembles it.
 */
export async function promptMultiline(question) {
  const { input, output, isTty } = openTty();
  if (!isTty && !process.stdin.isTTY) return '';

  input.on('error', () => {});
  output.on('error', () => {});

  const rl = createInterface({ input, output, terminal: true });

  try {
    return await new Promise((resolve) => {
      const lines = [];
      output.write(question);
      rl.on('line', (line) => {
        if (line.trim() === '') {
          // A blank line ends the entry — but ignore leading blanks so a stray
          // newline before the paste does not submit nothing.
          if (lines.length === 0) return;
          rl.close();
          return;
        }
        lines.push(line.trim());
      });
      rl.on('close', () => resolve(lines.join('')));
    });
  } finally {
    rl.close();
    if (isTty) {
      input.destroy?.();
      // end(), not destroy(): it flushes readline's final write instead of
      // racing it.
      output.end?.();
    }
  }
}
