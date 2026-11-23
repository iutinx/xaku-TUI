import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { shortDisplay } from '../../src/ui/ToolPanel.js';

describe('shortDisplay', () => {
  const ws = '/home/dev/project';

  it('renders paths inside the workspace relative to it', () => {
    expect(shortDisplay('/home/dev/project/src/app.tsx', ws)).toBe(
      path.join('src', 'app.tsx'),
    );
  });

  it('renders the workspace root itself without a leading slash artefact', () => {
    expect(shortDisplay(ws, ws)).toBe(ws);
  });

  it('falls back to ~ for the home directory', () => {
    const home = process.env.HOME ?? '/Users/dev';
    expect(shortDisplay(path.join(home, 'Downloads', 'x.txt'), '/other/place')).toBe(
      path.join('~', 'Downloads', 'x.txt'),
    );
  });

  it('keeps absolute paths that escape the workspace so the sandbox break is visible', () => {
    expect(shortDisplay('/etc/passwd', ws)).toBe('/etc/passwd');
  });

  it('does not treat a same-prefix sibling as relative', () => {
    expect(shortDisplay('/home/dev/project-other/a.txt', ws)).not.toBe(
      path.join('-other', 'a.txt'),
    );
  });
});
