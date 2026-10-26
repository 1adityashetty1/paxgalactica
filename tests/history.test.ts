import { describe, expect, it } from 'vitest';
import { HISTORY_CAP, remember, step } from '../src/ui/history.js';

describe('the command line history', () => {
  it('keeps what was sent, once when sent twice running, and no more than the cap', () => {
    expect(remember(['a'], 'a')).toEqual(['a']);
    expect(remember(['a'], '  b ')).toEqual(['a', 'b']);
    expect(remember(['a'], '   ')).toEqual(['a']);
    const long = Array.from({ length: HISTORY_CAP }, (_, i) => String(i));
    expect(remember(long, 'new')).toHaveLength(HISTORY_CAP);
    expect(remember(long, 'new').at(-1)).toBe('new');
  });

  it('recalls back to the first line and down to the line being written', () => {
    const h = ['a', 'b', 'c'];
    expect(step(h, null, 'up')).toBe(2);
    expect(step(h, 2, 'up')).toBe(1);
    expect(step(h, 0, 'up')).toBe(0);
    expect(step(h, 1, 'down')).toBe(2);
    expect(step(h, 2, 'down')).toBeNull();
    expect(step(h, null, 'down')).toBeNull();
    expect(step([], null, 'up')).toBeNull();
  });
});
