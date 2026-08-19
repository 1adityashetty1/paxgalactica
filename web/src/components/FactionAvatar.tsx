import { useState } from 'react';
import { ansi256ToHex } from '../color.js';
import type { Faction } from '../../../src/domain/state.js';

/**
 * A faction's face, small, ringed in its colour.
 *
 * The five powers were distinguished in the panel by a colour chip and a name,
 * and their portraits were only ever seen at the moment of negotiation — so the
 * face you met in a channel was a stranger. Showing it here is what makes the
 * channel portrait a recognition rather than an introduction.
 *
 * The crop is a fixed focal point rather than a per-faction table, which works
 * because the set was generated to one framing brief: every subject is centred
 * horizontally with the face about a quarter down. The arithmetic below picks
 * roughly the middle third of the image and lands that point in the middle of
 * the box — see the constants for the derivation.
 *
 * Falls back to the plain colour chip if the file is missing, because a faction
 * row must never render as a hole.
 */

/**
 * Show ~1/3 of the image width, so the head fills the box rather than the whole
 * scene shrinking into it. 1100px wide art / ~367px of visible region = 3.
 */
const ZOOM = 300;
/** Centres that region: 0.5 - (1100/367)/2 in percent of the box. */
const LEFT = -100;
/** Drops the focal point to the face, which sits about a quarter down. */
const TOP = 5;

export function FactionAvatar({ faction, size = 26 }: { faction: Faction; size?: number }) {
  const [failed, setFailed] = useState(false);
  const colour = ansi256ToHex(faction.displayColor);

  if (failed) {
    return <span className="swatch" style={{ background: colour }} />;
  }

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, borderColor: colour }}
      title={faction.name}
    >
      <img
        src={`/portraits/${faction.id}.jpeg`}
        alt=""
        style={{ width: `${ZOOM}%`, left: `${LEFT}%`, top: `${TOP}%` }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
