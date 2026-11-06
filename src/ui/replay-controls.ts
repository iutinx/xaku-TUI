/** Playback speeds offered by `/replay` auto-play (`+`/`-` cycle through these). */
export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/** One event per second at 1x; `n`x divides the interval. */
export const REPLAY_BASE_INTERVAL_MS = 1000;

/**
 * Next speed after stepping `direction` (+1 = faster, -1 = slower),
 * wrapping around the cycle. Unknown/paused values reset to 1x.
 */
export function nextSpeed(current: number, direction: 1 | -1): number {
  const speeds: readonly number[] = REPLAY_SPEEDS;
  const idx = speeds.indexOf(current);
  if (idx === -1) return speeds[0];
  const next = idx + direction;
  return speeds[(next + speeds.length) % speeds.length];
}

export function replayIntervalMs(speed: number): number {
  return REPLAY_BASE_INTERVAL_MS / Math.max(1, speed);
}

export function formatReplaySpeed(speed: number, playing: boolean): string {
  return `${speed}x ${playing ? '▶' : '⏸'}`;
}
