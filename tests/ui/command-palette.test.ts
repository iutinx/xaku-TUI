import { describe, expect, it } from 'vitest';
import { windowStart } from '../../src/ui/CommandPalette.js';

const VISIBLE = 6;

describe('windowStart', () => {
  it('starts at zero when everything fits', () => {
    expect(windowStart(3, 0, VISIBLE)).toBe(0);
    expect(windowStart(3, 2, VISIBLE)).toBe(0);
    expect(windowStart(VISIBLE, 5, VISIBLE)).toBe(0);
  });

  it('stays pinned while the cursor is in the top rows', () => {
    expect(windowStart(20, 0, VISIBLE)).toBe(0);
    expect(windowStart(20, 3, VISIBLE)).toBe(0);
    expect(windowStart(20, 4, VISIBLE)).toBe(0);
  });

  it('follows the cursor down through a long list', () => {
    // The whole point: every index must land inside [start, start + visible).
    for (let index = 0; index < 20; index++) {
      const start = windowStart(20, index, VISIBLE);
      expect(
        index >= start && index < start + VISIBLE,
        `index ${index} should be visible at window start ${start}`,
      ).toBe(true);
    }
  });

  it('shows the tail when the cursor wraps to the last row', () => {
    expect(windowStart(20, 19, VISIBLE)).toBe(14);
    expect(windowStart(20, 18, VISIBLE)).toBeLessThanOrEqual(14);
  });

  it('never starts past the list', () => {
    expect(windowStart(7, 6, VISIBLE)).toBeGreaterThanOrEqual(0);
    expect(windowStart(7, 6, VISIBLE)).toBeLessThanOrEqual(1);
  });

  it('clamps a total at or below the window size', () => {
    expect(windowStart(0, 0, VISIBLE)).toBe(0);
    expect(windowStart(1, 0, VISIBLE)).toBe(0);
  });
});
