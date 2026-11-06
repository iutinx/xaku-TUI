import { describe, expect, it } from 'vitest';
import { clampScrollLine, followScroll } from '../../src/ui/useScrollback.js';

describe('clampScrollLine', () => {
  it('clamps to [0, max]', () => {
    expect(clampScrollLine(-5, 10)).toBe(0);
    expect(clampScrollLine(4, 10)).toBe(4);
    expect(clampScrollLine(40, 10)).toBe(10);
    expect(clampScrollLine(3, 0)).toBe(0);
  });
});

describe('followScroll', () => {
  it('stays pinned to the tail when not scrolled (auto-follow)', () => {
    expect(followScroll(50, 58, 0, 100)).toBe(0);
  });

  it('preserves the same rows while scrolled up as content grows', () => {
    expect(followScroll(50, 58, 10, 100)).toBe(18);
  });

  it('clamps to the limit while content grows', () => {
    expect(followScroll(50, 58, 10, 14)).toBe(14);
  });

  it('pulls the position back in range when content shrinks', () => {
    expect(followScroll(58, 50, 30, 20)).toBe(20);
  });

  it('leaves the position unchanged when content did not change', () => {
    expect(followScroll(50, 50, 7, 100)).toBe(7);
  });
});
