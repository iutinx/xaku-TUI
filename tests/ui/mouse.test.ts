import { describe, expect, it } from 'vitest';
import { parseSgrMouse, parseSgrWheel, parseMouseBuffer, stripSgrMouse } from '../../src/ui/mouse.js';

describe('parseSgrMouse', () => {
  it('parses a left click press with coordinates', () => {
    expect(parseSgrMouse('\x1b[<0;12;5M')).toEqual([
      { kind: 'click', button: 0, x: 12, y: 5, release: false, motion: false },
    ]);
  });

  it('parses a click release', () => {
    expect(parseSgrMouse('\x1b[<0;12;5m')).toEqual([
      { kind: 'click', button: 0, x: 12, y: 5, release: true, motion: false },
    ]);
  });

  it('flags drag motion events', () => {
    expect(parseSgrMouse('\x1b[<32;3;4M')).toEqual([
      { kind: 'click', button: 0, x: 3, y: 4, release: false, motion: true },
    ]);
  });

  it('parses wheel events as wheel kind', () => {
    expect(parseSgrMouse('\x1b[<64;1;1M')).toEqual([{ kind: 'wheel', direction: 'up' }]);
    expect(parseSgrMouse('\x1b[<65;2;3M')).toEqual([{ kind: 'wheel', direction: 'down' }]);
  });

  it('returns every event in a burst', () => {
    const events = parseSgrMouse('\x1b[<0;1;2M\x1b[<64;1;2M\x1b[<0;1;2m');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['click', 'wheel', 'click']);
  });

  it('ignores non-mouse input', () => {
    expect(parseSgrMouse('abc\x1b[A')).toEqual([]);
  });
});

describe('parseSgrWheel', () => {
  it('detects wheel up', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<64;12;5M'))).toBe('up');
  });

  it('detects wheel down', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<65;1;1M'))).toBe('down');
  });

  it('detects a wheel event among other bytes', () => {
    expect(parseSgrWheel(Buffer.from('hello\x1b[<65;3;9M\x1b[?6C'))).toBe('down');
  });

  it('returns the first wheel when a burst contains several', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<64;1;1M\x1b[<64;1;1M'))).toBe('up');
  });

  it('ignores left click press', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<0;10;10M'))).toBeNull();
  });

  it('ignores click release', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<0;10;10m'))).toBeNull();
  });

  it('ignores drag motion events', () => {
    expect(parseSgrWheel(Buffer.from('\x1b[<32;10;10M'))).toBeNull();
  });

  it('ignores unrelated input', () => {
    expect(parseSgrWheel(Buffer.from('a'))).toBeNull();
    expect(parseSgrWheel(Buffer.from('\x1b[A'))).toBeNull();
  });
});

describe('stripSgrMouse', () => {
  it('removes a standalone fragment after Ink strips the leading ESC', () => {
    expect(stripSgrMouse('[<64;12;5M')).toBe('');
  });

  it('removes full sequences including ESC', () => {
    expect(stripSgrMouse('\x1b[<65;1;1M')).toBe('');
  });

  it('removes wheel bytes interleaved with typed text', () => {
    expect(stripSgrMouse('a\x1b[<64;2;2Mb')).toBe('ab');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripSgrMouse('hello <b>[x]</b>')).toBe('hello <b>[x]</b>');
  });
});

describe('parseMouseBuffer', () => {
  it('reassembles an SGR sequence split across chunks', () => {
    const first = parseMouseBuffer('\x1b[<0;12');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('\x1b[<0;12');
    const second = parseMouseBuffer(first.rest + ';5M');
    expect(second.events).toEqual([
      { kind: 'click', button: 0, x: 12, y: 5, release: false, motion: false },
    ]);
    expect(second.rest).toBe('');
  });

  it('parses complete sequences without keeping anything', () => {
    const { events, rest } = parseMouseBuffer('\x1b[<64;1;2M');
    expect(events).toEqual([{ kind: 'wheel', direction: 'up' }]);
    expect(rest).toBe('');
  });

  it('does not accumulate keyboard bytes', () => {
    expect(parseMouseBuffer('abc\x1b[A').rest).toBe('');
  });

  it('keeps partial escape prefixes that could start a sequence', () => {
    expect(parseMouseBuffer('\x1b').rest).toBe('\x1b');
    expect(parseMouseBuffer('\x1b[<').rest).toBe('\x1b[<');
    expect(parseMouseBuffer('\x1b[<65;3;').rest).toBe('\x1b[<65;3;');
  });
});
