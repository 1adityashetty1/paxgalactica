/**
 * What the screen is doing, worked out once from the flags the client keeps,
 * and what the command line may do in each mode.
 *
 * The client kept about eight flags — a fatal error, the settings screen, a
 * campaign wanted, whether a provider is ready, a view, an ending, a channel
 * open or drafted, a call in flight — and each control read its own subset.
 * The command line, Send and End turn each restated "can I act", and none of
 * them counted the ending: after the epilogue all three stayed live and every
 * press came back as a server error. Pure and DOM-free, beside `layout.ts`, so
 * the suite can hold it.
 */

export type ScreenMode =
  | 'fatal'
  | 'settings'
  | 'title'
  | 'loading'
  | 'ended'
  | 'channel'
  | 'busy'
  | 'declaring';

export interface ScreenFlags {
  fatal: boolean;
  settingsOpen: boolean;
  needsCampaign: boolean;
  /** `null` while the provider has not been asked yet. */
  providerReady: boolean | null;
  hasView: boolean;
  /** The campaign has reached its last turn and its ending is up. */
  ended: boolean;
  /** The channel the player is in, open on the server or only drafted here. */
  channel: string | null;
  /** What the server is doing, while a call is in flight. */
  busy: string | null;
}

/** In priority order: a fatal error, then who pays, then what to play, then the campaign's own state. */
export function screenMode(f: ScreenFlags): ScreenMode {
  if (f.fatal) return 'fatal';
  // Who pays comes before what to play: on a cold start with no key the
  // player lands on the screen that takes one.
  if (f.settingsOpen || (f.needsCampaign && f.providerReady === false)) return 'settings';
  if (f.needsCampaign) return 'title';
  if (!f.hasView) return 'loading';
  // The ending outranks a channel: there is nobody left to talk to.
  if (f.ended) return 'ended';
  if (f.busy !== null) return 'busy';
  if (f.channel !== null) return 'channel';
  return 'declaring';
}

export interface CommandControls {
  inputDisabled: boolean;
  sendDisabled: boolean;
  endDisabled: boolean;
  placeholder: string;
  endTitle: string;
  endLabel: string;
}

/** What the command line, Send and End turn show and allow in a campaign mode. */
export function commandControls(
  mode: ScreenMode,
  { actionsLeft, input, confirmEnd }: { actionsLeft: number; input: string; confirmEnd: boolean },
): CommandControls {
  const declaring = mode === 'declaring';
  const placeholder =
    mode === 'ended'
      ? 'The campaign has ended — save it, or start another from the main menu'
      : mode === 'busy'
        ? 'Working…'
        : mode === 'channel'
          ? 'Close the channel to declare actions'
          : actionsLeft === 0
            ? 'No actions left — end the turn'
            : 'Declare an action, /advisor for counsel, or :help';
  const endTitle =
    mode === 'ended'
      ? 'The campaign has ended'
      : mode === 'channel'
        ? 'Close the channel first'
        : confirmEnd
          ? 'Press again to end the turn with actions unspent'
          : 'Land everything declared';
  return {
    inputDisabled: !declaring,
    sendDisabled: !declaring || input.trim() === '' || actionsLeft === 0,
    endDisabled: !declaring,
    placeholder,
    endTitle,
    endLabel: confirmEnd && declaring
      ? `${actionsLeft} action${actionsLeft === 1 ? '' : 's'} unspent — end anyway?`
      : 'End turn',
  };
}
