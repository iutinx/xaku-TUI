import { useStdin } from 'ink';
import { useEffect, useRef } from 'react';

// X11 mouse button events + SGR encoding. Wheel is reported as button codes
// with bit 6 set (64 = up, 65 = down); clicks are codes 0/1/2 with trailing
// 'M' (press) or 'm' (release). 1002 (button-event tracking) is enabled on
// top of 1000 because several terminals only emit press events with it.
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
export const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

export type SgrMouseEvent =
  | { kind: 'wheel'; direction: 'up' | 'down' }
  | { kind: 'click'; button: number; x: number; y: number; release: boolean; motion: boolean };

export function parseSgrMouse(data: Buffer | string): SgrMouseEvent[] {
  const text = typeof data === 'string' ? data : data.toString();
  const events: SgrMouseEvent[] = [];
  for (const match of text.matchAll(SGR_MOUSE_RE)) {
    const code = parseInt(match[1], 10);
    const x = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);
    const release = match[4] === 'm';
    if (code & 64) {
      events.push({ kind: 'wheel', direction: (code & 1) === 0 ? 'up' : 'down' });
    } else {
      events.push({ kind: 'click', button: code & 3, x, y, release, motion: (code & 32) !== 0 });
    }
  }
  return events;
}

export function parseSgrWheel(data: Buffer | string): 'up' | 'down' | null {
  for (const event of parseSgrMouse(data)) {
    if (event.kind === 'wheel') return event.direction;
  }
  return null;
}

/**
 * Remove SGR mouse fragments from an input string. Ink's keypress parser
 * strips the leading ESC and hands the rest (e.g. `[<64;5;5M`) to every
 * active `useInput` listener, which would otherwise type garbage into the
 * prompt when the wheel scrolls or the mouse is clicked.
 */
export function stripSgrMouse(input: string): string {
  return input.replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, '');
}

/**
 * Parse mouse events out of an accumulated input buffer and return the
 * unconsumed tail. Chunks from `stdin.read()` can split an SGR sequence at
 * any byte, so callers keep feeding raw chunks into a buffer and pull events
 * out of it; `rest` contains only a trailing partial sequence (nothing after
 * `\x1b`, `\x1b[`, or `\x1b[<digits;digits`) so keyboard bytes never
 * accumulate.
 */
export function parseMouseBuffer(text: string): { events: SgrMouseEvent[]; rest: string } {
  const events = parseSgrMouse(text);
  const stripped = text.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '');
  const partial = stripped.match(/\x1b(?:\[(?:<(?:\d*(?:;\d*)*)?)?)?$/);
  return { events, rest: partial ? partial[0] : '' };
}

export interface MouseHandlers {
  onWheel?: (direction: 'up' | 'down') => void;
  onClick?: (event: { x: number; y: number }) => void;
}

/**
 * Listen for terminal mouse events (wheel + left clicks). Subscribes to
 * Ink's internal chunk emitter (Ink owns the stdin stream and must stay in
 * `readable` mode), so this never competes with `useInput` for bytes.
 * No-ops when raw mode is unavailable (e.g. CI, ink-testing-library).
 */
export function useMouseEvents(handlers: MouseHandlers) {
  const { internal_eventEmitter, isRawModeSupported } = useStdin();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isRawModeSupported || !internal_eventEmitter) return;
    // ink-testing-library fakes a TTY stdin while the real stdout is a pipe;
    // writing SGR enable/disable there just pollutes test output.
    if (!process.stdout.isTTY) return;

    // Buffer raw chunks so SGR sequences split across reads are reassembled.
    let buffer = '';
    const handleChunk = (data: Buffer | string) => {
      buffer += typeof data === 'string' ? data : data.toString();
      const { events, rest } = parseMouseBuffer(buffer);
      buffer = rest;
      for (const event of events) {
        if (event.kind === 'wheel') {
          handlersRef.current.onWheel?.(event.direction);
        } else if (!event.release && !event.motion && event.button === 0) {
          handlersRef.current.onClick?.({ x: event.x, y: event.y });
        }
      }
    };

    process.stdout.write(ENABLE_MOUSE);
    internal_eventEmitter.on('input', handleChunk);

    return () => {
      internal_eventEmitter.off('input', handleChunk);
      process.stdout.write(DISABLE_MOUSE);
    };
  }, [internal_eventEmitter, isRawModeSupported]);
}
