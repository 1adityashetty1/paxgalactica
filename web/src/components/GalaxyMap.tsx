import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldState } from '../../../src/domain/state.js';
import { layoutGalaxy, sectorsOf } from '../../../src/ui/layout.js';
import { routeEarnings, routeLegs, severedBy, tradeRoutes } from '../../../src/domain/trade.js';
import { ansi256ToHex, NEUTRAL } from '../color.js';
import { CommanderMark } from './BattleIcons.js';
import { holdAt, regardFor, regardRecorded } from '../../../src/domain/regard.js';

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
  /** What each of the player's warships holds down — see `EffectiveStatsSchema.holding`. */
  holding?: number;
}

/** An independent world shows whom it leans toward once its regard for them reaches this. */
const LEANS_AT = 40;

const SCALE = 1000; // unit space → viewBox units, for readable stroke widths
const CUT = '#c0392b'; // a severed lane: money that has stopped moving

/** Hyperlanes are undirected, so a lane's key must be too. */
const laneKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export function GalaxyMap({ state, selectedId, onSelect, holding }: Props) {
  const [sector, setSector] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => layoutGalaxy(state, { sector }), [state, sector]);

  /**
   * Trade volume per hyperlane, summed over every route that uses it, plus the
   * lanes currently severed by a blockade or an ion storm. Derived from the same functions the
   * reducer pays out from, so the picture cannot disagree with the ledger.
   */
  const { tradeOnLane, severed } = useMemo(() => {
    const carried = new Map<string, number>();
    const cut = new Set<string>();
    for (const leg of tradeRoutes(state).flatMap(routeLegs)) {
      const blocked = leg.path.some((id) => severedBy(state, id).length > 0);
      for (let i = 0; i < leg.path.length - 1; i++) {
        const key = laneKey(leg.path[i]!, leg.path[i + 1]!);
        carried.set(key, (carried.get(key) ?? 0) + leg.volume);
        if (blocked) cut.add(key);
      }
    }
    return { tradeOnLane: carried, severed: cut };
  }, [state]);

  /**
   * Where the player's tolls are actually levied.
   *
   * `tollTargets` was readable in the Factions panel, so a player could see
   * THAT the Combine charged them and never which junction it cost them on —
   * the actionable half of the mechanic was the invisible half. These come off
   * `routeEarnings`, the same function the reducer pays out from, for the
   * reason the lane volumes above do.
   */
  const { tollPaidAt, tollTakenAt } = useMemo(() => {
    const e = routeEarnings(state);
    return {
      tollPaidAt: e.tollsPaidBySystem[state.playerFactionId] ?? {},
      tollTakenAt: e.tollsBySystem[state.playerFactionId] ?? {},
    };
  }, [state]);

  /**
   * Worlds of yours that are neither content nor held down — their garrisons
   * are deserting — and independent worlds leaning toward a power. See
   * `regard.ts`: the race for a world, and the risk of losing one, both belong
   * on the map rather than only in a panel.
   */
  const { restless, leans } = useMemo(() => {
    const restless = new Set<string>();
    const leans = new Map<string, string>();
    if (!regardRecorded(state)) return { restless, leans };
    for (const s of state.systems) {
      if (s.controllerFactionId === state.playerFactionId) {
        const h = holdAt(state, s, holding);
        if (h && h.shortfall > 0) restless.add(s.id);
      } else if (s.controllerFactionId === null) {
        const best = state.factions
          .map((f) => ({ id: f.id, r: regardFor(s, f.id) }))
          .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))[0];
        if (best && best.r >= LEANS_AT) leans.set(s.id, best.id);
      }
    }
    return { restless, leans };
  }, [state, holding]);

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

  const officersAt = useCallback(
    (systemId: string) =>
      (state.commanders ?? []).filter((c) => c.status === 'active' && c.atSystemId === systemId),
    [state.commanders],
  );
  const contested = useCallback(
    (systemId: string, controller: string | null): boolean =>
      state.pendingOrders.some(
        (o) => o.type === 'fleet_movement' && o.targetId === systemId && o.factionId !== controller,
      ),
    [state.pendingOrders],
  );

  // Attached by hand rather than through `onWheel`: React registers wheel
  // listeners as passive, so `preventDefault()` there is ignored — the page
  // scrolls under the zoom and the console logs an error on every tick.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

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
        ref={svgRef}
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
              {/* An officer under way rides the fleet, so the mark does too. */}
              {(() => {
                const aboard = (state.pendingOrders.find((o) => o.id === f.orderId)?.officers ?? [])
                  .map((id) => state.commanders.find((c) => c.id === id)?.name ?? id);
                return aboard.length > 0 ? (
                  <CommanderMark x={-12} y={-12} color={colorOf(f.factionId)} title={aboard.join(', ')} />
                ) : null;
              })()}
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
            const paid = tollPaidAt[s.id] ?? 0;
            const taken = tollTakenAt[s.id] ?? 0;
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
                {restless.has(s.id) && (
                  <circle r={r + 6} className="restless-ring">
                    <title>Restless: neither content with you nor held down. Its garrison is deserting.</title>
                  </circle>
                )}
                {leans.has(s.id) && (
                  <circle r={r + 5} className="leans-ring" stroke={colorOf(leans.get(s.id)!)}>
                    <title>{`Leans toward ${state.factions.find((f) => f.id === leans.get(s.id))?.name ?? leans.get(s.id)}.`}</title>
                  </circle>
                )}
                <circle
                  r={r}
                  fill={s.controllerFactionId ? color : 'transparent'}
                  fillOpacity={isPlayer ? 1 : 0.75}
                  stroke={color}
                  strokeWidth={isPlayer ? 3.5 : 2}
                />
                {/* A toll is a fact about a place. Paying and collecting are
                    the same mechanic pointed two ways, so they share a glyph
                    and differ only in colour — and the figure is in the title,
                    because the ring says "here" and the number says "how much".

                    A RING rather than a dot, and the arithmetic is why: the
                    viewBox is ~1220 units wide into roughly 490 css pixels, so
                    a marker is drawn at about 0.4x. A 4-unit dot lands under
                    two pixels — present in the DOM, invisible on the screen,
                    which is the failure mode the battle glyphs already taught.
                    A ring is read from its outline and survives the scale, the
                    way `contested-ring` does. */}
                {(paid > 0 || taken > 0) && (
                  <circle
                    r={r + 3.5}
                    className={paid > 0 ? 'toll-paid' : 'toll-taken'}
                  >
                    <title>
                      {paid > 0
                        ? `You pay ${Math.round(paid)} a turn in tolls here.`
                        : `You collect ${Math.round(taken)} a turn in tolls here.`}
                    </title>
                  </circle>
                )}
                {/* Officers standing here, one mark per power, stacked to the
                    upper left of the world so they never cover its name. The
                    star-in-circle is the same insignia the panels use, drawn
                    large because the map is scaled to about 0.4x. */}
                {[...new Set(officersAt(s.id).map((c) => c.factionId))].map((fid, i) => (
                  <CommanderMark
                    key={fid}
                    x={-(r + 9) - i * 14}
                    y={-(r + 6)}
                    color={colorOf(fid)}
                    title={officersAt(s.id)
                      .filter((c) => c.factionId === fid)
                      .map((c) => c.name)
                      .join(', ')}
                  />
                ))}
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
          {(tollPaidAt[hovered.system.id] ?? 0) > 0 && (
            <span className="toll-note bad">
              toll: you pay {Math.round(tollPaidAt[hovered.system.id]!)} a turn crossing here
            </span>
          )}
          {(tollTakenAt[hovered.system.id] ?? 0) > 0 && (
            <span className="toll-note good">
              toll: you collect {Math.round(tollTakenAt[hovered.system.id]!)} a turn here
            </span>
          )}
        </div>
      )}
    </div>
  );
}
