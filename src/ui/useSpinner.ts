import { useEffect, useState } from 'react';
import { symbols } from './theme.js';

export const SPINNER_INTERVAL_MS = 80;

/**
 * Cycles through `symbols.spinner` frames while `active` is true.
 * The interval only runs when active, so idle panels cost nothing.
 */
export function useSpinnerFrame(active: boolean): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(
      () => setFrame((f) => (f + 1) % symbols.spinner.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [active]);

  return frame;
}
