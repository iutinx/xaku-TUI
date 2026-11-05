import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { probeExistingFile } from '../../src/tools/utils.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('probeExistingFile', () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'xaku-probe-'));
    ctx = { workspace, maxResultBytes: 100_000, shellTimeoutMs: 30_000 };
    await writeFile(path.join(workspace, 'existing.txt'), 'old content\n', 'utf-8');
    await writeFile(path.join(workspace, 'big.txt'), 'x'.repeat(200_001), 'utf-8');
    await mkdir(path.join(workspace, 'adir'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns content for an existing file', async () => {
    const probe = await probeExistingFile('existing.txt', ctx);
    expect(probe.kind).toBe('existing');
    expect(probe.content).toBe('old content\n');
  });

  it('reports new for an absent file', async () => {
    const probe = await probeExistingFile('nope.txt', ctx);
    expect(probe.kind).toBe('new');
    expect(probe.content).toBeUndefined();
  });

  it('reports too-large past the probe size cap', async () => {
    const probe = await probeExistingFile('big.txt', ctx);
    expect(probe.kind).toBe('too-large');
  });

  it('reports unreadable for a directory', async () => {
    const probe = await probeExistingFile('adir', ctx);
    expect(probe.kind).toBe('unreadable');
  });

  it('reports unreadable for paths outside the workspace', async () => {
    const probe = await probeExistingFile('../escape.txt', ctx);
    expect(probe.kind).toBe('unreadable');
  });

  it('handles nested relative paths inside the workspace', async () => {
    await mkdir(path.join(workspace, 'sub'), { recursive: true });
    await writeFile(path.join(workspace, 'sub', 'deep.txt'), 'nested', 'utf-8');
    const probe = await probeExistingFile(path.join('sub', 'deep.txt'), ctx);
    expect(probe.kind).toBe('existing');
    expect(probe.content).toBe('nested');
  });
});
