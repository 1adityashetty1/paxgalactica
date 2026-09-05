/**
 * Glyphs for the order of battle: one per hull class, and a tracked gun.
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

/**
 * A line hull: a capital ship. Long tapering wedge, castle aft, drives astern.
 *
 * This glyph replaced the dart, which now belongs to the escort. The dart is a
 * small nimble thing and always read as one — fine while every ship in the game
 * was the same ship, wrong the moment `line` meant the heavy.
 *
 * The first replacement was a **wet-navy battleship**: flat deck line, turrets
 * amidships, guns on the beam. It was legible and it was the wrong genre. Space
 * capitals — a Venator, a Retribution — share a silhouette that has nothing to
 * do with a surface ship: **a long wedge tapering to the prow, with the mass
 * and the superstructure concentrated aft, and drives at the stern.** There is
 * no waterline to sit turrets on.
 *
 * So the read here is front-to-back rather than top-to-bottom: fine bow, deep
 * body, the main battery seated over the after third, twin drive bells behind
 * it. A dorsal strake forward of the turret was tried and dropped — with the
 * castle gone it read as a stray mark rather than as structure.
 *
 * Also the generic warship glyph. A stack from a save written before classes
 * existed normalises to line hulls, so a caller that just wants "ships" is
 * right to get this one.
 */
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
      {/* Hull: long wedge, chamfered prow, raked stern. Deep, so it carries
          the turret without the turret overhanging it. */}
      <path d="M23.6 13.6 L13.5 10.2 L5.4 9.4 L3.4 10.4 L3.4 16.6 L5.4 17.5 L13.5 16.4 Z" />
      {/* Main battery, seated straight on the hull: the garrison's turret and
          gun, scaled.
          
          Two things went before it. A bridge tower drawn from y=2.9 to 5, above
          a castle starting at 5.2 — a 0.2 gap, so it visibly FLOATED. Then the
          turret on top of that castle, which was attached but stacked: a
          superstructure carrying a superstructure, for no reason except that
          the castle was drawn first. The turret IS the superstructure, so it
          sits on the hull and the castle is gone.
          
          Borrowed from the garrison but NOT copied: the tank's turret and gun
          are rounded rectangles, and a radius reads as sheet metal bent in a
          press. Nothing else in the space set is rounded, so these are cut as
          straight-edged polygons — a raked trapezoid stepping up to a raised
          block, and a barrel that tapers rather than ending in a cap. Same
          shape language as the guns; same language as the ships. */}
      <path d="M5.4 10.4 L6.1 7.6 L7.8 7.6 L8.3 5.5 L10.5 5.5 L10.9 7.6 L12.2 10.4 Z" />
      <path d="M11.6 7.5 L18.3 8.2 L18.3 9 L11.6 9.3 Z" />
      {/* Drive bells, flared outward astern. */}
      <path d="M0.8 10.7 L3.4 11.4 L3.4 13.3 L0.8 13.4 Z" />
      <path d="M0.8 16 L3.4 13.9 L3.4 15.8 L0.8 16.5 Z" />
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

/**
 * The rest of the hull classes.
 *
 * Drawn against the same bar as the two above — *can a player tell these apart
 * at 18px without reading the label* — and chosen by rendering each at 18,
 * magnifying the rasterisation, and looking. Two candidates were thrown away
 * for exactly the reasons the originals were:
 *
 * - A **fletched needle** for the torpedo boat read as a **fish skeleton**: the
 *   tail flare dominated the hull, and at row size it was a dash with a blob.
 * - A **hull with the tube slung over it** read as **two stacked bars**, which
 *   is not a vessel.
 * - A **wet-navy battleship** for the line hull — flat deck, turrets amidships —
 *   was perfectly legible and the wrong genre. See `ShipIcon`.
 * - A **single chevron** for the escort read as a UI "next" arrow rather than a
 *   ship, and the doubled chevron that replaced it was legible but still a
 *   *mark* among vessels. The dart moved down from `line` instead, and the line
 *   hull became the battleship it should always have been.
 *
 * What separates them is the outline *family*, never the detail: a symmetric
 * dart, a faceted capital wedge, an asymmetric wedge, and a raked box with bays
 * cut through it.
 *
 * **Nothing in the space set is rounded.** A corner radius reads as sheet metal
 * bent in a press, which is right for the garrison's tank and wrong for a hull
 * cut in a yard — so every ship edge is a straight-edged polygon, and the only
 * radii left in this file are the garrison's turret and gun.
 *
 * A later pass **refaceted** three of them. The dart is all swept diagonals and
 * the others were axis-aligned rectangles, so the set read as two different
 * hands. Castles, bays and drives are now raked trapezoids rather than boxes,
 * which is what the extra size buys — at 28px and up the facets read as
 * structure, and at 18px the silhouette is unchanged. The torpedo boat is deliberately the only glyph in the set that
 * is not bilaterally symmetric, which is what makes it separable at a glance.
 */

/**
 * An escort: pointed hull, swept wings, engine block astern.
 *
 * This is the original warship glyph, and it belongs here rather than on the
 * line hull — it always read as something small and quick, which is what an
 * escort is. It replaced a doubled chevron that was legible but **abstract**:
 * every other glyph in this set is a vessel, and a mark among ships reads as an
 * interface affordance rather than a class.
 *
 * The swept wings are the load-bearing line: without them the silhouette reads
 * as a cross.
 */
export function EscortIcon({ size = 18, title }: IconProps) {
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
      <path d="M23.2 12 L15 9.6 L5.5 9.8 L4 10.8 L4 13.2 L5.5 14.2 L15 14.4 Z" />
      <path d="M13.5 10 L7 3.4 L3.2 4.2 L9 10.2 Z" />
      <path d="M13.5 14 L7 20.6 L3.2 19.8 L9 13.8 Z" />
      {/* Drive block, square-cornered like the rest of the space set. It
          carried a 0.6 radius from when this glyph was the only ship in the
          game and had nothing to be consistent with. */}
      <rect x="1.6" y="10.6" width="2.6" height="2.8" />
    </svg>
  );
}

/**
 * A torpedo boat: a long thin hull under one dorsal fin.
 *
 * Asymmetric on purpose. Every other glyph here is mirrored about its axis, so
 * a single fin is the fastest thing to pick out of a row — and a shark's fin is
 * the right connotation for a cheap hull built to kill things far above its
 * weight.
 */
export function TorpedoBoatIcon({ size = 18, title }: IconProps) {
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
      {/* Hull: needle, chamfered stern, and a CLEAN UNDERSIDE. Nothing below
          the centreline — a ventral strake was tried and it turned the glyph
          into a red copy of the escort, which is the one thing this shape is
          supposed to avoid. */}
      <path d="M23.6 13.6 L11 11.8 L4.2 11.6 L3.2 12.4 L3.2 15.2 L4.2 15.9 L11 15.6 Z" />
      {/* The fin, swept back with a stepped leading edge. */}
      <path d="M10.4 11.5 L7.4 5.6 L6.2 3.2 L3.4 3.2 L3.4 11.5 Z" />
      {/* A slot cut behind the fin root, so the mass reads as built rather
          than as one solid triangle. */}
      <path d="M4.6 10.6 L7.4 10.6 L6.6 8.6 L4.6 8.6 Z" />
      {/* Drive flare. */}
      <path d="M1.2 12.6 L3.2 12.2 L3.2 15.4 L1.2 15 Z" />
    </svg>
  );
}

/**
 * A lifter: a blunt box with two bays cut clean through it.
 *
 * The holes are punched with `evenodd` rather than painted in the panel colour,
 * the same trick the garrison's road wheels use, so the glyph survives being
 * drawn on any background — which matters here because two filled rectangles on
 * a slab would read as a solid brick the moment the background changed.
 */
export function LifterIcon({ size = 18, title }: IconProps) {
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
      {/* A row of ports down the spine, punched the same way the garrison's road
          wheels are. These replaced two big raked bays, which read as odd
          skewed windows rather than as a ship — a row of small round ports
          reads as an airliner at a glance, and at 18px it resolves into a
          dotted line, which is exactly what it should look like. */}
      <path
        fillRule="evenodd"
        d="M3.4 6.6 L17.2 6.2 L22.8 12 L17.2 17.8 L3.4 17.4 L2.2 12 Z
           M4.5 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z
           M7.1 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z
           M9.7 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z
           M12.3 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z
           M14.9 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z
           M17.5 12 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z"
      />
      {/* Drive block, astern. */}
      <path d="M0.6 10.4 L2.3 10.9 L2.3 13.1 L0.6 13.6 Z" />
    </svg>
  );
}

/** Pick the glyph for a hull class. One place, so a new class cannot be missed. */
export function HullIcon({
  hull,
  size = 18,
  title,
}: IconProps & { hull: 'line' | 'escort' | 'torpedo_boat' | 'lifter' }) {
  switch (hull) {
    case 'escort':
      return <EscortIcon size={size} title={title} />;
    case 'torpedo_boat':
      return <TorpedoBoatIcon size={size} title={title} />;
    case 'lifter':
      return <LifterIcon size={size} title={title} />;
    case 'line':
      return <ShipIcon size={size} title={title} />;
  }
}
