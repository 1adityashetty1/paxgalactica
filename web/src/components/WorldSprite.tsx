import { useMemo } from 'react';
import { WORLD_SIZE, worldRuns } from '../../../src/ui/worlds.js';
import type { WorldType } from '../../../src/domain/state.js';

const LABEL: Record<WorldType, string> = {
  earthlike: 'Terrestrial',
  earthnight: 'Terrestrial, settled',
  oceanic: 'Oceanic',
  arid: 'Arid',
  ice: 'Ice',
  industrialmoon: 'Ringed moon',
  gasgiant: 'Gas giant',
};

export function worldTypeLabel(type: WorldType): string {
  return LABEL[type] ?? 'Unsurveyed';
}

/**
 * A world's face, drawn as SVG rects.
 *
 * Rects rather than a canvas, because a canvas needs a ref, an effect and a
 * device-pixel-ratio dance to stay crisp, and this is 300 rects — the geometry
 * comes out of `src/ui/worlds.ts` already merged into horizontal runs, so the
 * component does no work worth testing and the module does all of it.
 *
 * `shapeRendering: crispEdges` is the whole reason it reads as pixel art at any
 * size: without it the browser antialiases every rect edge and a 32px sprite
 * blown up to 96 becomes a smudge.
 */
export function WorldSprite({ type, size = 96 }: { type: WorldType; size?: number }) {
  const runs = useMemo(() => worldRuns(type), [type]);
  return (
    <svg
      className="world-sprite"
      width={size}
      height={size}
      viewBox={`0 0 ${WORLD_SIZE} ${WORLD_SIZE}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={worldTypeLabel(type)}
    >
      {runs.map((r) => (
        <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.colour} />
      ))}
    </svg>
  );
}
