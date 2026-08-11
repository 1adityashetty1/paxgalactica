import { useCallback, useMemo, useRef, useState } from 'react';
import type { WorldState } from '../../../src/domain/state.js';
import { layoutGalaxy, sectorsOf } from '../../../src/ui/layout.js';
import { blockadesOn, tradeRoutes } from '../../../src/domain/trade.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';

/**
 * The galaxy, as SVG.
 *
 * SVG rather than Canvas: 25 nodes and ~40 edges make performance irrelevant,
 * while real hit-testing, crisp scaling and CSS hover states all come free.
 *
 * All geometry comes from `src/ui/layout.ts`, which returns a unit-width space
 * (x 0–1, y 0–aspect). That keeps the maths testable without a DOM and means
 * the viewBox can be driven straight from the layout.
 */

interface Props {
  state: WorldState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SCALE = 1000; // unit space → viewBox units, for readable stroke widths
const CUT = '#c0392b'; // a severed lane: money that has stopped moving

/** Hyperlanes are undirected, so a lane's key must be too. */
const laneKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export function GalaxyMap({ state, selectedId, onSelect }: Props) {
  const [sector, setSector] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layout = useMemo(() => layoutGalaxy(state, { sector }), [state, sector]);

  /**
   * Trade volume per hyperlane, summed over every route that uses it, plus the
   * lanes currently severed by a blockade. Derived from the same functions the
   * reducer pays out from, so the picture cannot disagree with the ledger.
   */
  const { tradeOnLane, severed } = useMemo(() => {
    const carried = new Map<string, number>();
    const cut = new Set<string>();
    for (const route of tradeRoutes(state)) {
      const blocked = route.path.some((id) => blockadesOn(state, id).length > 0);
      for (let i = 0; i < route.path.length - 1; i++) {
        const key = laneKey(route.path[i]!, route.path[i + 1]!);
        carried.set(key, (carried.get(key) ?? 0) + route.volume);
        if (blocked) cut.add(key);
      }
    }
    return { tradeOnLane: carried, severed: cut };
  }, [state]);

  const W = SCALE;
  const H = SCALE * layout.aspect;

  // Asymmetric padding: labels sit to the RIGHT of their glyph, so the right
  // margin has to fit the longest name or the easternmost system gets clipped.
  const PAD_L = 30;
  const PAD_R = 190;
  const PAD_Y = 60;
  const fullW = W + PAD_L + PAD_R;
  const fullH = H + PAD_Y * 2;

  const view = useMemo(() => {
    const w = fullW / zoom;
    const h = fullH / zoom;
    const cx = -PAD_L + (fullW - w) / 2 + pan.x;
    const cy = -PAD_Y + (fullH - h) / 2 + pan.y;
    return `${cx} ${cy} ${w} ${h}`;
  }, [fullW, fullH, zoom, pan]);

  const colorOf = useCallback(
    (factionId: string | null): string => {
      if (!factionId) return NEUTRAL;
      const f = state.factions.find((x) => x.id === factionId);
      return f ? ansi256ToHex(f.displayColor) : NEUTRAL;
    },
    [state.factions],
  );

  const contested = useCallback(
    (systemId: string, controller: string | null): boolean =>
      state.pendingOrders.some(
        (o) => o.type === 'fleet_movement' && o.targetId === systemId && o.factionId !== controller,
      ),
    [state.pendingOrders],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Only pan with the background; dragging a system should not move the map.
    if ((e.target as Element).closest('.system')) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const unitsPerPx = fullW / zoom / rect.width;
    setPan({
      x: d.panX - (e.clientX - d.x) * unitsPerPx,
      y: d.panY - (e.clientY - d.y) * unitsPerPx,
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const hovered = hover ? layout.placed.find((p) => p.id === hover) : null;

  return (
    <div className="map-wrap">
      <div className="map-controls">
        <select
          value={sector ?? ''}
          onChange={(e) => {
            setSector(e.target.value || null);
            reset();
          }}
        >
          <option value="">Whole galaxy</option>
          {sectorsOf(state).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.3))} title="Zoom in">
          +
        </button>
        <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.3))} title="Zoom out">
          −
        </button>
        <button onClick={reset} title="Reset view" disabled={zoom === 1 && pan.x === 0 && pan.y === 0}>
          reset
        </button>
        {layout.omitted.length > 0 && (
          <span className="omitted">{layout.omitted.length} systems outside this sector</span>
        )}
      </div>

      <svg
        className={drag.current ? 'map dragging' : 'map'}
        viewBox={view}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g className="lanes">
          {layout.lanes.map((l) => {
            const shared = l.sharedControllerId !== null;
            // Trade volume riding this hyperlane, so the map shows where the
            // money moves and not just what connects to what. A lane can be a
            // backwater or the spine of the economy and look identical
            // otherwise, which is how a player misses that a junction matters.
            const carried = tradeOnLane.get(laneKey(l.a, l.b)) ?? 0;
            const cut = severed.has(laneKey(l.a, l.b));
            return (
              <line
                key={`${l.a}|${l.b}`}
                x1={l.ax * W} y1={l.ay * SCALE}
                x2={l.bx * W} y2={l.by * SCALE}
                stroke={cut ? CUT : shared ? colorOf(l.sharedControllerId) : NEUTRAL}
                strokeWidth={(shared ? 2.4 : 1.4) + Math.min(4, carried / 22)}
                strokeOpacity={cut ? 0.75 : shared ? 0.55 : 0.28}
                strokeDasharray={cut ? '6 5' : undefined}
              >
                {carried > 0 && (
                  <title>
                    {cut ? 'Interdicted. ' : ''}
                    {Math.round(carried)} credits of trade a turn ride this lane.
                  </title>
                )}
              </line>
            );
          })}
        </g>

        <g className="fleets">
          {layout.fleets.map((f) => (
            <g key={f.orderId} transform={`translate(${f.x * W} ${f.y * SCALE})`}>
              <title>
                {f.label} → {state.systems.find((s) => s.id === f.targetId)?.name} · arrives in{' '}
                {f.remaining} turn{f.remaining === 1 ? '' : 's'}
              </title>
              <circle r={9} fill={colorOf(f.factionId)} fillOpacity={0.18} />
              <path d="M -6 -5 L 7 0 L -6 5 Z" fill={colorOf(f.factionId)} />
              <text y={-13} className="fleet-eta" fill={colorOf(f.factionId)}>
                {f.remaining}
              </text>
            </g>
          ))}
        </g>

        <g className="systems">
          {layout.placed.map((p) => {
            const s = p.system;
            const color = colorOf(s.controllerFactionId);
            const isPlayer = s.controllerFactionId === state.playerFactionId;
            const selected = s.id === selectedId;
            const isContested = contested(s.id, s.controllerFactionId);
            const r = 6 + s.strategicValue * 0.55;
            return (
              <g
                key={s.id}
                className="system"
                transform={`translate(${p.x * W} ${p.y * SCALE})`}
                onClick={() => onSelect(s.id)}
                onPointerEnter={() => setHover(s.id)}
                onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
                role="button"
                tabIndex={0}
                aria-label={`${s.name}, ${s.sector}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(s.id);
                  }
                }}
              >
                {selected && <circle r={r + 8} className="sel-ring" />}
                {isContested && <circle r={r + 4} className="contested-ring" />}
                <circle
                  r={r}
                  fill={s.controllerFactionId ? color : 'transparent'}
                  fillOpacity={isPlayer ? 1 : 0.75}
                  stroke={color}
                  strokeWidth={isPlayer ? 3.5 : 2}
                />
                <text x={r + 7} y={4.5} className="label" fill={color}>
                  {s.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div className="map-tooltip">
          <strong style={{ color: colorOf(hovered.system.controllerFactionId) }}>
            {hovered.system.name}
          </strong>
          <span>
            {hovered.system.sector} · garrison {hovered.system.garrison} · value{' '}
            {hovered.system.strategicValue}/10
          </span>
          <span>
            {hovered.system.controllerFactionId
              ? state.factions.find((f) => f.id === hovered.system.controllerFactionId)?.name
              : 'unaligned'}
          </span>
        </div>
      )}
    </div>
  );
}
