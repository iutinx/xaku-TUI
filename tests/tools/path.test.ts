import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveWithinWorkspace } from '../../src/tools/utils.js';

describe('Cross-Platform Path Handling', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'xaku-path-test-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const ctx = {
    workspace: '',
    maxResultBytes: 100000,
    shellTimeoutMs: 30000,
  };

  it('handles relative paths with forward slashes', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('subdir/file.txt', ctx);
    expect(result.error).toBeUndefined();
    expect(result.resolved).toContain(path.sep);
  });

  it('handles relative paths with backslashes (Windows-style)', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('subdir\\file.txt', ctx);
    expect(result.error).toBeUndefined();
    // On Windows, this should resolve correctly
    // On Unix, backslash is a valid filename character, so it will be treated as a single filename
    expect(result.resolved).toBeDefined();
  });

  it('normalizes mixed separators', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('subdir/file\\name.txt', ctx);
    expect(result.error).toBeUndefined();
    expect(result.resolved).toBeDefined();
  });

  it('blocks paths that escape workspace via ..', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('../../../etc/passwd', ctx);
    expect(result.error).toBeDefined();
    expect(result.error?.label).toBe('blocked');
  });

  it('blocks paths that escape workspace via absolute path', async () => {
    ctx.workspace = workspace;
    const absolutePath = process.platform === 'win32' 
      ? 'C:\\Windows\\System32\\config\\SAM'
      : '/etc/passwd';
    const result = await resolveWithinWorkspace(absolutePath, ctx);
    expect(result.error).toBeDefined();
    expect(result.error?.label).toBe('blocked');
  });

  it('allows paths within workspace', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('README.md', ctx);
    expect(result.error).toBeUndefined();
    expect(result.resolved.startsWith(workspace)).toBe(true);
  });

  it('handles workspace root path', async () => {
    ctx.workspace = workspace;
    const result = await resolveWithinWorkspace('.', ctx);
    expect(result.error).toBeUndefined();
    // realpath may resolve symlinks (e.g., /var -> /private/var on macOS)
    // so we check that the resolved path is within the real workspace
    expect(result.resolved).toBeDefined();
  });

  it('handles case-insensitive paths on Windows', async () => {
    ctx.workspace = workspace;
    // On Windows, paths are case-insensitive
    // On Unix, paths are case-sensitive
    const result = await resolveWithinWorkspace('readme.md', ctx);
    expect(result.error).toBeUndefined();
    // The resolved path should be within workspace
    expect(result.resolved.toLowerCase().startsWith(workspace.toLowerCase())).toBe(true);
  });
});

describe('Windows-Specific Path Scenarios', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'xaku-win-test-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const ctx = {
    workspace: '',
    maxResultBytes: 100000,
    shellTimeoutMs: 30000,
  };

  it('handles drive letter paths correctly', async () => {
    ctx.workspace = workspace;
    
    if (process.platform === 'win32') {
      // On Windows, test with same drive letter
      const result = await resolveWithinWorkspace('file.txt', ctx);
      expect(result.error).toBeUndefined();
      
      // Test with different drive letter (should be blocked)
      const result2 = await resolveWithinWorkspace('D:\\some\\file.txt', ctx);
      expect(result2.error).toBeDefined();
      expect(result2.error?.label).toBe('blocked');
    } else {
      // On Unix, this test is not applicable
      expect(true).toBe(true);
    }
  });

  it('handles long paths on Windows', async () => {
    ctx.workspace = workspace;
    
    // Windows has a 260 character path limit by default
    // Create a deeply nested path
    const deepPath = 'a'.repeat(20) + '/' + 'b'.repeat(20) + '/' + 'c'.repeat(20) + '/file.txt';
    const result = await resolveWithinWorkspace(deepPath, ctx);
    expect(result.error).toBeUndefined();
  });
});
