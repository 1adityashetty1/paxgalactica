import { useState } from 'react';
import { ansi256ToHex } from '../color.js';
import { portraitCrop } from '../../../src/ui/portrait.js';
import type { Faction } from '../../../src/domain/state.js';

/**
 * A faction's face, small, ringed in its colour.
 *
 * The five powers were distinguished in the panel by a colour chip and a name,
 * and their portraits were only ever seen at the moment of negotiation — so the
 * face you met in a channel was a stranger. Showing it here is what makes the
 * channel portrait a recognition rather than an introduction.
 *
 * The crop arithmetic lives in `src/ui/portrait.ts`, pure and tested: getting a
 * face centred and getting the image to cover the circle are different
 * requirements, and the first version satisfied neither for every faction.
 */

export function FactionAvatar({ faction, size = 26 }: { faction: Faction; size?: number }) {
  const [failed, setFailed] = useState(false);
  const colour = ansi256ToHex(faction.displayColor);

  if (failed) {
    // A faction row must never render as a hole.
    return <span className="swatch" style={{ background: colour }} />;
  }

  const crop = portraitCrop(faction.id);

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, borderColor: colour }}
      title={faction.name}
    >
      <img
        src={`/portraits/${faction.id}.jpeg`}
        alt=""
        style={{ width: `${crop.width}%`, left: `${crop.left}%`, top: `${crop.top}%` }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
