import { describe, expect, it } from 'vitest';
import { NO_SIZES, clampPane, dragged, paneStyle, readPanes } from '../src/ui/panes.js';

const view = { width: 1400, height: 900 };

describe('dragging a pane', () => {
  it('widens the side column when its handle is dragged left, and the map grows when dragged down', () => {
    expect(dragged('side', 380, { x: -100, y: 0 }, view)).toBe(480);
    expect(dragged('stage', 400, { x: 0, y: 50 }, view)).toBe(450);
    expect(dragged('briefing', 200, { x: 0, y: -40 }, view)).toBe(160);
  });

  it('holds every pane inside what the window can spare', () => {
    expect(clampPane('side', 50, view)).toBe(260);
    expect(clampPane('side', 5000, view)).toBe(980);
    expect(clampPane('stage', 5000, view)).toBe(680);
    expect(clampPane('briefing', 10, view)).toBe(60);
  });
});

describe('remembered sizes', () => {
  it('sets only the panes the player has dragged', () => {
    expect(paneStyle(NO_SIZES)).toEqual({});
    expect(paneStyle({ side: 420, stage: null, briefing: 150 })).toEqual({ '--side-width': '420px', '--briefing-height': '150px' });
  });

  it('reads back what was stored, and anything else as the default', () => {
    expect(readPanes(JSON.stringify({ side: 420, stage: 'tall', briefing: -3 }))).toEqual({ side: 420, stage: null, briefing: null });
    expect(readPanes('not json')).toEqual(NO_SIZES);
    expect(readPanes(null)).toEqual(NO_SIZES);
  });
});
