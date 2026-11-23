import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import {
  abbreviateHome,
  expandHome,
  relativeToWorkspace,
  resolveWorkspace,
} from '../../src/tools/workspace.js';

let root: string;

beforeAll(async () => {
  const raw = mkdtempSync(path.join(tmpdir(), 'xaku-ws-'));
  // On macOS the temp dir is itself a symlink (/var -> /private/var), and
  // resolveWorkspace realpaths its result, so compare against the real path.
  root = await realpath(raw);
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(path.join(root, 'file.txt'), 'hi');
  symlinkSync(path.join(root, 'src'), path.join(root, 'src-link'));
  symlinkSync(tmpdir(), path.join(root, 'escape-link'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('expandHome', () => {
  it('expands a bare tilde to the home directory', () => {
    expect(expandHome('~')).toBe(homedir());
  });

  it('expands a tilde prefix', () => {
    expect(expandHome('~/projects')).toBe(path.join(homedir(), 'projects'));
  });

  it('leaves other paths alone', () => {
    expect(expandHome('./~x')).toBe('./~x');
    expect(expandHome('/tmp')).toBe('/tmp');
  });
});

describe('abbreviateHome', () => {
  it('shortens the home directory itself to ~', () => {
    expect(abbreviateHome(homedir())).toBe('~');
  });

  it('shortens paths under home', () => {
    expect(abbreviateHome(path.join(homedir(), 'code', 'app'))).toBe(
      '~' + path.sep + path.join('code', 'app'),
    );
  });

  it('leaves unrelated paths untouched', () => {
    expect(abbreviateHome('/etc/passwd')).toBe('/etc/passwd');
  });
});

describe('resolveWorkspace', () => {
  it('accepts an absolute directory', async () => {
    const result = await resolveWorkspace(path.join(root, 'src'), root);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(path.join(root, 'src'));
  });

  it('resolves relative paths against the current workspace', async () => {
    const result = await resolveWorkspace('src/deep', root);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(path.join(root, 'src', 'deep'));
  });

  it('walks up with ..', async () => {
    const result = await resolveWorkspace('src/deep/../..', root);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(root);
  });

  it('accepts the workspace root itself', async () => {
    const result = await resolveWorkspace('.', root);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(root);
  });

  it('rejects a missing directory', async () => {
    const result = await resolveWorkspace('nope', root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Not a directory');
  });

  it('rejects a file', async () => {
    const result = await resolveWorkspace('file.txt', root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Not a directory');
  });

  it('rejects an empty path', async () => {
    expect((await resolveWorkspace('   ', root)).ok).toBe(false);
  });

  it('resolves symlinks to their real directory', async () => {
    const result = await resolveWorkspace('src-link', root);
    expect(result.ok).toBe(true);
    // The real path is reported so the tool sandbox compares like with like.
    if (result.ok) expect(result.path).toBe(path.join(root, 'src'));
  });

  it('accepts a home-escaped path after expansion', async () => {
    const result = await resolveWorkspace('~', root);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(await realpath(homedir()));
  });
});

describe('relativeToWorkspace', () => {
  it('shows paths inside the workspace relative to it', () => {
    expect(relativeToWorkspace(path.join(root, 'src', 'main.ts'), root)).toBe(
      path.join('src', 'main.ts'),
    );
  });

  it('keeps the workspace root as-is', () => {
    expect(relativeToWorkspace(root, root)).toBe(root);
  });

  it('keeps absolute paths that escape the workspace', () => {
    expect(relativeToWorkspace('/etc/passwd', root)).toBe('/etc/passwd');
  });

  it('renders a sibling traversal as absolute rather than ../x', () => {
    const sibling = path.join(root, '..', 'other');
    expect(relativeToWorkspace(sibling, root)).toBe(sibling);
  });
});
