/**
 * A minimal ustar reader/writer.
 *
 * Why hand-rolled rather than the `tar` package: this project has no runtime
 * dependencies outside the Agent SDK and Zod, and the slice of tar a save file
 * needs is genuinely small — a few regular files, no symlinks, no sparse
 * entries, no long-name extensions. That is about 120 lines, versus a
 * dependency (and its transitive tree) sitting in the trust path of a file the
 * user is invited to hand back to the game later.
 *
 * The format: each entry is a 512-byte header followed by its contents padded
 * up to a 512-byte boundary. The archive ends with two zero blocks.
 *
 * Nothing here knows anything about Pax Galactica — see `archive.ts` for that.
 */

const BLOCK = 512;

/** Refuses to allocate more than this while reading, so a hostile archive cannot exhaust memory. */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export interface TarEntry {
  path: string;
  bytes: Uint8Array;
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/** Octal, NUL-terminated, right-aligned with leading zeros — the ustar convention. */
function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(path: string, size: number, mtime: number): Buffer {
  if (Buffer.byteLength(path, 'utf8') > 100) {
    // Long paths need a PAX or GNU extension. We control every name we write,
    // so failing loudly beats silently truncating a filename.
    throw new Error(`Archive path too long for ustar (max 100 bytes): ${path}`);
  }
  const buf = Buffer.alloc(BLOCK);
  buf.write(path, 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 8, 'ascii'); // mode
  buf.write(octal(0, 8), 108, 8, 'ascii'); // uid
  buf.write(octal(0, 8), 116, 8, 'ascii'); // gid
  buf.write(octal(size, 12), 124, 12, 'ascii');
  buf.write(octal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii'); // checksum field is spaces while summing
  buf.write('0', 156, 1, 'ascii'); // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (const byte of buf) sum += byte;
  // Six octal digits, then NUL, then a space. Yes, really.
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return buf;
}

/** Build a tar archive from entries, in the order given. */
export function writeTar(entries: TarEntry[], mtime = Date.now()): Uint8Array {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.bytes);
    parts.push(header(entry.path, body.length, mtime), body);
    const remainder = body.length % BLOCK;
    if (remainder !== 0) parts.push(Buffer.alloc(BLOCK - remainder));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  return new Uint8Array(Buffer.concat(parts));
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

function parseOctal(buf: Buffer, offset: number, length: number): number {
  // Fields may be terminated by NUL or space, and padded with either.
  const text = buf.toString('ascii', offset, offset + length).replace(/\0.*$/, '').trim();
  if (text === '') return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isFinite(value) || value < 0) throw new Error('Corrupt tar: bad numeric field.');
  return value;
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) if (buf[i] !== 0) return false;
  return true;
}

/**
 * Read a tar archive into memory.
 *
 * Entries are returned, never written to disk, so directory traversal is not
 * reachable from here — but `..` is still rejected, because a caller that later
 * decides to extract should not have to rediscover that hazard.
 */
export function readTar(data: Uint8Array): TarEntry[] {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length % BLOCK !== 0 || buf.length < BLOCK * 2) {
    throw new Error('Corrupt tar: length is not a whole number of 512-byte blocks.');
  }

  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= buf.length) {
    if (isZeroBlock(buf, offset)) break; // end of archive
    const magic = buf.toString('ascii', 257, 263).replace(/\0/g, '');
    if (offset === 0 && magic !== 'ustar') throw new Error('Not a tar archive.');

    const path = buf.toString('utf8', offset, offset + 100).replace(/\0.*$/, '');
    const size = parseOctal(buf, offset + 124, 12);
    const typeflag = buf.toString('ascii', offset + 156, offset + 157);

    if (size > MAX_ENTRY_BYTES) throw new Error(`Archive entry "${path}" is implausibly large.`);
    if (path.split('/').includes('..')) throw new Error(`Unsafe path in archive: ${path}`);

    const start = offset + BLOCK;
    if (start + size > buf.length) throw new Error(`Corrupt tar: entry "${path}" runs past the end.`);

    // '0' and '\0' both mean a regular file; skip directories and anything else.
    if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      entries.push({ path, bytes: new Uint8Array(buf.subarray(start, start + size)) });
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}
