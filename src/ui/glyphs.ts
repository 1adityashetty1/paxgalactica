/**
 * Glyph geometry shared between the SVG battle icons and the pixel art.
 *
 * Pure and DOM-free, so the event art can draw a ship as the same silhouette
 * the order of battle uses — one definition, read by `BattleIcons.tsx` as SVG
 * paths and by `outcomeart.ts` as a rasterised stencil, rather than two copies
 * that agree by inspection.
 */

export type Polygon = readonly (readonly [number, number])[];

/**
 * The escort, in its icon's 24×24 box, nosed right: pointed hull, swept wings,
 * drive block astern. See `EscortIcon` for why it is drawn this way.
 */
export const ESCORT_GLYPH: { hull: Polygon; wings: readonly Polygon[]; drive: Polygon } = {
  hull: [[23.2, 12], [15, 9.6], [5.5, 9.8], [4, 10.8], [4, 13.2], [5.5, 14.2], [15, 14.4]],
  wings: [
    [[13.5, 10], [7, 3.4], [3.2, 4.2], [9, 10.2]],
    [[13.5, 14], [7, 20.6], [3.2, 19.8], [9, 13.8]],
  ],
  drive: [[1.6, 10.6], [4.2, 10.6], [4.2, 13.4], [1.6, 13.4]],
};

/**
 * The battleship, in its icon's 24×24 box, nosed right: a long tapering wedge,
 * the main battery seated on the after third, one drive astern. See `ShipIcon`
 * for how it came to be drawn this way.
 */
export const BATTLESHIP_GLYPH: { hull: Polygon; turret: Polygon; gun: Polygon; drive: Polygon } = {
  hull: [[23.6, 13.6], [13.5, 10.2], [5.4, 9.4], [3.4, 10.4], [3.4, 16.6], [5.4, 17.5], [13.5, 16.4]],
  turret: [[5.4, 10.4], [6.8, 6], [10.2, 6], [12.4, 10.4]],
  gun: [[10.9, 7.2], [18.6, 8.1], [18.6, 9.1], [10.9, 9.6]],
  drive: [[1, 12], [3.4, 11.3], [3.4, 15.7], [1, 15]],
};

/** An SVG path for a polygon. */
export function polygonPath(p: Polygon): string {
  return `M${p.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
}

function inside(p: Polygon, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Rasterise polygons from a `box`-unit square onto a `size`-pixel grid. A pixel
 * is filled when at least `cover` of a 4×4 sample of it lands inside — enough
 * that the escort's thin swept wings survive the reduction rather than breaking
 * into dots.
 */
export function rasterise(polys: readonly Polygon[], size: number, box = 24, cover = 0.3): boolean[][] {
  const unit = box / size;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = (col + (sx + 0.5) / 4) * unit;
          const y = (row + (sy + 0.5) / 4) * unit;
          if (polys.some((p) => inside(p, x, y))) n += 1;
        }
      }
      return n / 16 >= cover;
    }),
  );
}
