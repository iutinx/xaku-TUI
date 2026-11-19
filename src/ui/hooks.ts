import { useEffect, useRef, useState } from 'react';

export function useTypewriter(target: string, charsPerTick = 3, tickMs = 20): string {
  const [display, setDisplay] = useState('');
  const displayRef = useRef('');

  useEffect(() => {
    if (target === '') {
      if (displayRef.current !== '') {
        displayRef.current = '';
        setDisplay('');
      }
      return;
    }
    if (target.length < displayRef.current.length) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    if (target.length === displayRef.current.length) return;

    const timer = setInterval(() => {
      const cur = displayRef.current.length;
      if (cur >= target.length) {
        clearInterval(timer);
        return;
      }
      const next = target.slice(0, Math.min(target.length, cur + charsPerTick));
      displayRef.current = next;
      setDisplay(next);
    }, tickMs);

    return () => clearInterval(timer);
  }, [target, charsPerTick, tickMs]);

  return display;
}

export function useBlink(periodMs = 530, active = true): boolean {
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!active) {
      setOn(true);
      return;
    }
    const t = setInterval(() => setOn((v) => !v), periodMs);
    return () => clearInterval(t);
  }, [periodMs, active]);

  return on;
}
