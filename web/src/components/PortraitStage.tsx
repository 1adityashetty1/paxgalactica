import { useState } from 'react';
import { ansi256ToHex } from '../color.js';
import type { WorldState } from '../../../src/domain/state.js';

/**
 * The face across the table, shown where the map is while a channel is open.
 *
 * Diplomacy already had its own surface, its own colour and its own stated
 * boundary; what it did not have was anyone to talk *to*. Replacing the map
 * rather than sitting beside it is the point: the map is what you look at when
 * you are moving fleets, and a conversation is not that. Swapping the whole
 * stage makes the mode change unmissable, which matters because a channel
 * disables the command line and End Turn — behaviour a player otherwise
 * discovers by finding their input dead.
 *
 * Files are named by internal `factionId` — `hutt.jpeg`, not
 * `ojjul_nar.jpeg` — because ids are the keys used everywhere in the code and
 * they diverged from the display names long ago. See the id/name table in
 * CLAUDE.md.
 */
export function PortraitStage({
  state,
  factionId,
}: {
  state: WorldState;
  factionId: string;
}) {
  const [failed, setFailed] = useState(false);
  const faction = state.factions.find((f) => f.id === factionId);
  const color = ansi256ToHex(faction?.displayColor ?? 250);
  const disposition = faction?.disposition[state.playerFactionId] ?? 0;

  return (
    <div className="portrait-stage" style={{ borderColor: color }}>
      {failed ? (
        // A missing image must not leave a blank slab where the map was: the
        // player still needs to know who is on the other end of the channel.
        <div className="portrait-missing" style={{ color }}>
          {faction?.name ?? factionId}
        </div>
      ) : (
        <img
          className="portrait-img"
          src={`/portraits/${factionId}.jpeg`}
          alt={faction?.name ?? factionId}
          onError={() => setFailed(true)}
        />
      )}

      {/* Over the image rather than beside it, so the stage stays one thing.
          The name and the standing are the two facts you want in front of you
          while choosing what to say. */}
      <div className="portrait-plate">
        <span className="portrait-name" style={{ color }}>
          {faction?.name ?? factionId}
        </span>
        <span className="portrait-meta">
          in channel · disposition toward you {disposition > 0 ? '+' : ''}
          {disposition}
        </span>
      </div>
    </div>
  );
}
