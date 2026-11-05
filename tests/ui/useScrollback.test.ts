import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  computeMessageWindow,
  computePageSize,
  maxOffset,
  MAX_VISIBLE_MESSAGES,
} from '../../src/ui/useScrollback.js';

describe('computePageSize', () => {
  it('derives a half-screenful page from terminal height', () => {
    expect(computePageSize(24)).toBe(6);
    expect(computePageSize(40)).toBe(12);
  });

  it('never goes below 1', () => {
    expect(computePageSize(1)).toBe(1);
    expect(computePageSize(5)).toBe(1);
  });
});

describe('maxOffset / clampOffset', () => {
  it('caps offset so a full window is always shown', () => {
    expect(maxOffset(20)).toBe(20 - MAX_VISIBLE_MESSAGES);
    expect(maxOffset(5)).toBe(0);
  });

  it('clamps into [0, maxOffset]', () => {
    expect(clampOffset(-3, 20)).toBe(0);
    expect(clampOffset(100, 20)).toBe(8);
    expect(clampOffset(4, 20)).toBe(4);
    expect(clampOffset(10, 5)).toBe(0);
  });
});

describe('computeMessageWindow', () => {
  it('anchors to the last messages at offset 0', () => {
    expect(computeMessageWindow(20, 0)).toEqual({ start: 8, end: 20 });
  });

  it('shows everything when total fits in the window', () => {
    expect(computeMessageWindow(5, 0)).toEqual({ start: 0, end: 5 });
    expect(computeMessageWindow(5, 3)).toEqual({ start: 0, end: 5 });
  });

  it('moves toward older messages as offset grows', () => {
    expect(computeMessageWindow(20, 4)).toEqual({ start: 4, end: 16 });
    expect(computeMessageWindow(20, 8)).toEqual({ start: 0, end: 12 });
  });

  it('never goes past the top', () => {
    expect(computeMessageWindow(20, 50)).toEqual({ start: 0, end: 12 });
  });

  it('accepts a custom visible count', () => {
    expect(computeMessageWindow(30, 0, 10)).toEqual({ start: 20, end: 30 });
  });
});
