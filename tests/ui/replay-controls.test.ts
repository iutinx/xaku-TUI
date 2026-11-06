import { describe, expect, it } from 'vitest';
import {
  REPLAY_BASE_INTERVAL_MS,
  REPLAY_SPEEDS,
  formatReplaySpeed,
  nextSpeed,
  replayIntervalMs,
} from '../../src/ui/replay-controls.js';

describe('replay speed controls', () => {
  it('exposes the 1x/2x/4x/8x cycle', () => {
    expect([...REPLAY_SPEEDS]).toEqual([1, 2, 4, 8]);
  });

  it('steps up with wraparound', () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(2, 1)).toBe(4);
    expect(nextSpeed(4, 1)).toBe(8);
    expect(nextSpeed(8, 1)).toBe(1);
  });

  it('steps down with wraparound', () => {
    expect(nextSpeed(1, -1)).toBe(8);
    expect(nextSpeed(8, -1)).toBe(4);
    expect(nextSpeed(4, -1)).toBe(2);
    expect(nextSpeed(2, -1)).toBe(1);
  });

  it('resets unknown speeds to 1x', () => {
    expect(nextSpeed(0, 1)).toBe(1);
    expect(nextSpeed(3, -1)).toBe(1);
  });

  it('divides the base interval by the speed', () => {
    expect(replayIntervalMs(1)).toBe(REPLAY_BASE_INTERVAL_MS);
    expect(replayIntervalMs(2)).toBe(500);
    expect(replayIntervalMs(4)).toBe(250);
    expect(replayIntervalMs(8)).toBe(125);
  });

  it('guards against sub-1x or zero speeds', () => {
    expect(replayIntervalMs(0)).toBe(REPLAY_BASE_INTERVAL_MS);
  });

  it('formats the header indicator with play/pause state', () => {
    expect(formatReplaySpeed(2, true)).toBe('2x ▶');
    expect(formatReplaySpeed(2, false)).toBe('2x ⏸');
  });
});
