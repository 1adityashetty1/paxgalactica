/**
 * ANSI 256 -> hex. Ink/chalk take hex reliably across terminals, while raw
 * 256-index support varies, so factions store an index and we convert here.
 */

const BASE16 = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
];

const CUBE = [0, 95, 135, 175, 215, 255];

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

export function ansi256ToHex(index: number): string {
  const i = Math.max(0, Math.min(255, Math.round(index)));
  if (i < 16) return BASE16[i]!;
  if (i < 232) {
    const n = i - 16;
    const r = CUBE[Math.floor(n / 36)]!;
    const g = CUBE[Math.floor((n % 36) / 6)]!;
    const b = CUBE[n % 6]!;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  const v = 8 + (i - 232) * 10;
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
}
