import { describe, expect, it } from 'vitest';
import { clipboardHelpers, osc52Sequence } from '../../src/ui/clipboard.js';

describe('osc52Sequence', () => {
  it('base64-encodes the payload between OSC 52 and BEL', () => {
    const text = '/Users/me/project';
    const seq = osc52Sequence(text);
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    expect(seq).toBe(`\x1b]52;c;${b64}\x07`);
  });

  it('is a single non-visual sequence with no cursor movement', () => {
    const seq = osc52Sequence('hello');
    expect(seq).not.toContain('\n');
    expect(seq.startsWith('\x1b]')).toBe(true);
    expect(seq.endsWith('\x07')).toBe(true);
  });

  it('handles multi-byte characters by encoding UTF-8 bytes', () => {
    const text = 'café/工作';
    expect(osc52Sequence(text)).toContain(Buffer.from(text, 'utf8').toString('base64'));
  });

  it('handles an empty string', () => {
    expect(osc52Sequence('')).toBe('\x1b]52;c;\x07');
  });
});

describe('clipboardHelpers', () => {
  it('uses pbcopy on macOS', () => {
    expect(clipboardHelpers('darwin')).toEqual([['pbcopy', []]]);
  });

  it('uses clip on Windows', () => {
    expect(clipboardHelpers('win32')).toEqual([['clip', []]]);
  });

  it('tries Wayland then X11 helpers on Linux', () => {
    const helpers = clipboardHelpers('linux');
    expect(helpers.map((h) => h[0])).toEqual(['wl-copy', 'xclip', 'xsel']);
  });
});
