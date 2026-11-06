#!/usr/bin/env node
/**
 * Draw the Mac app's icon from the game's own sprites: the earthnight world the
 * System panel draws, and the escort silhouette the order of battle uses,
 * on a 64-pixel grid, full bleed for macOS to mask. Writes
 * `assets/app-icon.png` (1024 px) and `assets/app-icon.icns`.
 *
 *   pnpm build && node scripts/draw-app-icon.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { worldPixels } = await import(join(ROOT, 'dist/ui/worlds.js'));
const { ESCORT_GLYPH, rasterise } = await import(join(ROOT, 'dist/ui/glyphs.js'));

const G = 64; // the icon's pixel grid
const SCALE = 16; // 64 * 16 = 1024
const grid = Array.from({ length: G }, () => Array(G).fill(null));
const put = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < G && y < G && inBody(x, y)) grid[y][x] = c;
};
const hash = (x, y, s) => {
  let h = Math.imul(2166136261 ^ s, 16777619) ^ x;
  h = Math.imul(h, 16777619) ^ y;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

// The body fills the square. macOS 26 masks a full-bleed icon to its own
// rounded shape, and sets one drawn with Apple's older margin and corner (6
// grid pixels and 12 here) on a grey plate as a legacy icon. The art sits where
// it did inside that margin, so the mask takes only empty space.
const M = 0;
const R = 0;
const inBody = (x, y) => {
  if (x < M || y < M || x >= G - M || y >= G - M) return false;
  const cx = x < M + R ? M + R : x >= G - M - R ? G - M - R - 1 : x;
  const cy = y < M + R ? M + R : y >= G - M - R ? G - M - R - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
};

// Deep space, lighter toward the top, with a scatter of stars.
const top = [0x1b, 0x22, 0x4f];
const bottom = [0x07, 0x09, 0x1c];
const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
for (let y = 0; y < G; y++) {
  for (let x = 0; x < G; x++) {
    if (!inBody(x, y)) continue;
    const t = (y - M) / (G - 2 * M);
    put(x, y, hex(top.map((a, i) => a + (bottom[i] - a) * t)));
    const s = hash(x, y, 7);
    if (s > 0.985) put(x, y, s > 0.996 ? '#ffffff' : '#8f9bd6');
  }
}

// The world, low and to the right, as the System panel draws it.
const world = worldPixels('earthnight');
const WX = 24;
const WY = 23;
for (let y = 0; y < world.length; y++) {
  for (let x = 0; x < world[y].length; x++) {
    const c = world[y][x];
    if (c && inBody(WX + x, WY + y)) put(WX + x, WY + y, c);
  }
}

// The escort crossing in front of it, nosed right, with its drive burning.
const SHIP = 26;
const SX = 12;
const SY = 10;
const parts = [
  [rasterise([ESCORT_GLYPH.hull], SHIP), '#d9dfec'],
  [rasterise(ESCORT_GLYPH.wings, SHIP), '#aab3c8'],
  [rasterise([ESCORT_GLYPH.drive], SHIP), '#ffb347'],
];
// A dark rim first, so the hull reads against the world behind it.
const any = (x, y) => parts.some(([m]) => m[y]?.[x]);
for (let y = -1; y <= SHIP; y++) {
  for (let x = -1; x <= SHIP; x++) {
    if (any(x, y)) continue;
    if (any(x - 1, y) || any(x + 1, y) || any(x, y - 1) || any(x, y + 1)) put(SX + x, SY + y, '#0a0d1f');
  }
}
for (const [mask, colour] of parts) {
  for (let y = 0; y < SHIP; y++) for (let x = 0; x < SHIP; x++) if (mask[y][x]) put(SX + x, SY + y, colour);
}
// The hull's lower edge in shadow, and the exhaust trailing astern.
for (let x = 0; x < SHIP; x++) {
  for (let y = SHIP - 1; y >= 0; y--) {
    if (parts[0][0][y][x]) {
      put(SX + x, SY + y, '#8e97ad');
      break;
    }
  }
}
const driveRows = [];
for (let y = 0; y < SHIP; y++) if (parts[2][0][y].some(Boolean)) driveRows.push(y);
const exhaust = ['#ffd27a', '#ff9f43', '#e8662e', '#a03a2a'];
for (const y of driveRows.slice(1, -1)) {
  const firstX = parts[2][0][y].findIndex(Boolean);
  exhaust.forEach((c, i) => put(SX + firstX - 1 - i, SY + y, c));
}

/* --- PNG out ------------------------------------------------------------ */
function png(size) {
  const k = size / G;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = grid[Math.floor(y / k)][Math.floor(x / k)];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (c) {
        raw[o] = parseInt(c.slice(1, 3), 16);
        raw[o + 1] = parseInt(c.slice(3, 5), 16);
        raw[o + 2] = parseInt(c.slice(5, 7), 16);
        raw[o + 3] = 255;
      }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ASSETS = join(ROOT, 'assets');
mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(ASSETS, 'app-icon.png'), png(G * SCALE));

// Every size the iconset wants, each an exact multiple of the grid where it can
// be, so the pixels stay square.
const SET = join(ASSETS, 'app-icon.iconset');
rmSync(SET, { recursive: true, force: true });
mkdirSync(SET);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(SET, `icon_${s}x${s}.png`), png(s));
  writeFileSync(join(SET, `icon_${s}x${s}@2x.png`), png(s * 2));
}
execFileSync('iconutil', ['-c', 'icns', SET, '-o', join(ASSETS, 'app-icon.icns')]);
rmSync(SET, { recursive: true, force: true });
console.log(`Wrote ${join(ASSETS, 'app-icon.png')} and app-icon.icns`);
