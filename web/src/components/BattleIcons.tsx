/**
 * Two glyphs for the order of battle: a warship and a tracked gun.
 *
 * Inline SVG rather than image files, for three reasons that all matter here:
 * they inherit the faction's colour through `currentColor`, they stay crisp at
 * any size on any display, and they add nothing to load — a battle card is
 * drawn inside a briefing that is already on screen.
 *
 * ## These took four passes, and the failures are the useful part
 *
 * The bar is not "a nice drawing"; it is that a player glancing at a row can
 * tell hulls from ground defences *without reading the label*. At 13–18px only
 * the overall silhouette survives, so every attempt that relied on interior
 * detail failed:
 *
 * - A wedge hull with two engine pods read as a **flat lozenge with two
 *   detached bars**.
 * - A barrel on a round carriage read as a **lollipop**, and the ring-wheel
 *   version read as a **magnifying glass** — the barrel looked like a handle.
 * - A bare triangle read as a **play button**, and vertical fins on a hull read
 *   as a **four-pointed star**.
 *
 * What works is a silhouette whose *outline* is already the object: swept wings
 * make a dart rather than a cross, and tracks with road wheels punched through
 * them say "tracked vehicle" at any size, which nothing else did. The wheels
 * are holes cut with `evenodd` rather than shapes painted in the background
 * colour, so the glyph survives being drawn on any panel.
 */

interface IconProps {
  /** Square edge in px. 18 is the row size; smaller stops being legible. */
  size?: number;
  title?: string;
}

/** A warship: pointed hull, swept wings, engine block astern. */
export function ShipIcon({ size = 18, title }: IconProps) {
  return (
    <svg
      className="ob-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {/* Hull, prow right. */}
      <path d="M23.2 12 L15 9.6 L5.5 9.8 L4 10.8 L4 13.2 L5.5 14.2 L15 14.4 Z" />
      {/* Wings swept back from midships — this is the line that stops the
          silhouette reading as a cross. */}
      <path d="M13.5 10 L7 3.4 L3.2 4.2 L9 10.2 Z" />
      <path d="M13.5 14 L7 20.6 L3.2 19.8 L9 13.8 Z" />
      <rect x="1.6" y="10.6" width="2.6" height="2.8" rx="0.6" />
    </svg>
  );
}

/**
 * A garrison: a tracked gun. Dug-in ground defence, not hulls.
 *
 * A tank rather than the towed field gun first tried, because tracks and a
 * turret survive being 16px across and a barrel-and-wheel does not.
 */
export function GarrisonIcon({ size = 18, title }: IconProps) {
  return (
    <svg
      className="ob-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {/* Track run with four road wheels punched through it. */}
      <path
        fillRule="evenodd"
        d="M4 15.6 H20 A2.6 2.6 0 0 1 20 20.8 H4 A2.6 2.6 0 0 1 4 15.6 Z
           M3.5 18.2 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z
           M7.9 18.2 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z
           M12.3 18.2 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z
           M16.7 18.2 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z"
      />
      {/* Glacis and hull. */}
      <path d="M3.2 15.4 L21 15.4 L19.4 11 L5 11 Z" />
      {/* Turret and main gun. */}
      <rect x="8" y="7.2" width="8.4" height="4" rx="1.2" />
      <rect x="15.8" y="8.4" width="7.8" height="1.8" rx="0.5" />
    </svg>
  );
}
