import { useEffect, useRef, useState } from 'react';

/** Messages rendered at once when anchored at the bottom (previous hardcoded window). */
export const MAX_VISIBLE_MESSAGES = 12;

/**
 * Half-screenful page step derived from live terminal height.
 * 4 rows of chrome (top bar, stats bar, input line + margin), ~3 rows per message.
 */
export function computePageSize(termRows: number): number {
  return Math.max(1, Math.floor((termRows - 4) / 3));
}

/** Largest offset that still shows a full window (or 0 when everything fits). */
export function maxOffset(total: number, visibleCount = MAX_VISIBLE_MESSAGES): number {
  return Math.max(0, total - visibleCount);
}

export function clampOffset(offset: number, total: number): number {
  return Math.max(0, Math.min(offset, maxOffset(total)));
}

/**
 * Window of message indices to render for a bottom-anchored scroll offset.
 * offset 0 => last MAX_VISIBLE_MESSAGES messages; larger offset moves the
 * window toward older messages.
 */
export function computeMessageWindow(
  total: number,
  offset: number,
  visibleCount = MAX_VISIBLE_MESSAGES,
): { start: number; end: number } {
  const end = Math.max(0, total - clampOffset(offset, total));
  const start = Math.max(0, end - visibleCount);
  return { start, end };
}

export interface Scrollback {
  offset: number;
  isScrolled: boolean;
  pageSize: number;
  up: () => void;
  down: () => void;
  pageUp: () => void;
  pageDown: () => void;
  end: () => void;
}

export function useScrollback(total: number, termRows: number): Scrollback {
  const [offset, setOffset] = useState(0);
  const pageSize = computePageSize(termRows);
  const prevTotalRef = useRef(total);

  useEffect(() => {
    const delta = total - prevTotalRef.current;
    prevTotalRef.current = total;
    // While scrolled up, keep viewing the same messages as history grows:
    // each new message increases the distance from the bottom.
    setOffset((o) => clampOffset(o > 0 && delta > 0 ? o + delta : o, total));
  }, [total]);

  const move = (delta: number) => setOffset((o) => clampOffset(o + delta, total));

  return {
    offset,
    isScrolled: offset > 0,
    pageSize,
    up: () => move(1),
    down: () => move(-1),
    pageUp: () => move(pageSize),
    pageDown: () => move(-pageSize),
    end: () => setOffset(0),
  };
}
