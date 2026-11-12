import { describe, expect, it } from 'vitest';
import { commandControls, screenMode, type ScreenFlags } from '../src/ui/mode.js';

const playing: ScreenFlags = {
  fatal: false,
  settingsOpen: false,
  needsCampaign: false,
  providerReady: true,
  hasView: true,
  ended: false,
  channel: null,
  busy: null,
};

describe('what the screen is doing', () => {
  it('puts a fatal error, then who pays, then what to play first', () => {
    expect(screenMode({ ...playing, fatal: true, settingsOpen: true })).toBe('fatal');
    expect(screenMode({ ...playing, needsCampaign: true, providerReady: false })).toBe('settings');
    expect(screenMode({ ...playing, needsCampaign: true })).toBe('title');
    expect(screenMode({ ...playing, hasView: false })).toBe('loading');
  });

  it('puts the ending above a channel and a call in flight', () => {
    expect(screenMode({ ...playing, ended: true, channel: 'vigil', busy: 'Resolving' })).toBe('ended');
    expect(screenMode({ ...playing, channel: 'vigil', busy: 'Replying' })).toBe('busy');
    expect(screenMode({ ...playing, channel: 'vigil' })).toBe('channel');
    expect(screenMode(playing)).toBe('declaring');
  });

  it('closes the command line once the campaign has ended', () => {
    const c = commandControls('ended', { actionsLeft: 2, input: 'take Vantic', confirmEnd: false });
    expect(c).toMatchObject({ inputDisabled: true, sendDisabled: true, endDisabled: true });
    expect(c.placeholder).toMatch(/campaign has ended/);
  });

  it('lets a player declare and end the turn only while declaring', () => {
    expect(commandControls('declaring', { actionsLeft: 1, input: 'x', confirmEnd: false })).toMatchObject({
      inputDisabled: false,
      sendDisabled: false,
      endDisabled: false,
    });
    expect(commandControls('declaring', { actionsLeft: 0, input: 'x', confirmEnd: false }).sendDisabled).toBe(true);
    expect(commandControls('channel', { actionsLeft: 2, input: 'x', confirmEnd: false }).endTitle).toBe('Close the channel first');
    expect(commandControls('declaring', { actionsLeft: 1, input: '', confirmEnd: true }).endLabel).toBe('1 action unspent — end anyway?');
  });
});
