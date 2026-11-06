import { useEffect, useRef, useState } from 'react';

export interface Scrollback {
  scrollLine: number;
  isScrolled: boolean;
  up: (delta?: number) => void;
  down: (delta?: number) => void;
  pageUp: () => void;
  pageDown: () => void;
  end: () => void;
}

export function clampScrollLine(scrollLine: number, maxScrollLine: number): number {
  return Math.max(0, Math.min(scrollLine, maxScrollLine));
}

/**
 * Position after the content height changes from prevContent to nextContent.
 * At the tail (0) the view stays pinned to the bottom (auto-follow); when
 * scrolled up, the position grows with the content so the same rows remain
 * on screen. Shrinks (or new limits) clamp back into range.
 */
export function followScroll(
  prevContent: number,
  nextContent: number,
  scrollLine: number,
  maxScrollLine: number,
): number {
  const delta = nextContent - prevContent;
  if (delta <= 0 || scrollLine === 0) return clampScrollLine(scrollLine, maxScrollLine);
  return clampScrollLine(scrollLine + delta, maxScrollLine);
}

/**
 * Row-based scroll position, anchored to the bottom (0 = live tail).
 *
 * All arguments come from the measured chat viewport (ChatPanel onMeasured),
 * so scrolling is exact for whatever the terminal actually rendered — wrapped
 * lines, markdown blocks, and all.
 */
export function useScrollback(maxScrollLine: number, pageSize: number, contentHeight: number): Scrollback {
  const [scrollLine, setScrollLine] = useState(0);
  const prevContentRef = useRef(contentHeight);

  useEffect(() => {
    const prev = prevContentRef.current;
    prevContentRef.current = contentHeight;
    setScrollLine((o) => followScroll(prev, contentHeight, o, maxScrollLine));
  }, [contentHeight, maxScrollLine]);

  const move = (delta: number) =>
    setScrollLine((prev) => clampScrollLine(prev + delta, maxScrollLine));

  return {
    scrollLine,
    isScrolled: scrollLine > 0,
    up: (delta = 1) => move(delta),
    down: (delta = 1) => move(-delta),
    pageUp: () => move(pageSize),
    pageDown: () => move(-pageSize),
    end: () => setScrollLine(0),
  };
}
