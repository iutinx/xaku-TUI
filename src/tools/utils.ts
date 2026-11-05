import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ToolContext, ToolResult } from './types.js';

export async function resolveWithinWorkspace(filePath: string, ctx: ToolContext): Promise<{ resolved: string; error?: ToolResult }> {
  const resolved = path.resolve(ctx.workspace, filePath);

  if (!resolved.startsWith(ctx.workspace + path.sep) && resolved !== ctx.workspace) {
    return { resolved, error: { error: 'Access denied: path outside workspace', label: 'blocked' } };
  }

  try {
    const realResolved = await realpath(resolved);
    const realWorkspace = await realpath(ctx.workspace);
    if (!realResolved.startsWith(realWorkspace + path.sep) && realResolved !== realWorkspace) {
      return { resolved, error: { error: 'Access denied: symlink resolves outside workspace', label: 'blocked' } };
    }
    return { resolved: realResolved };
  } catch {
    return { resolved };
  }
}

export function trimOutput(text: string, maxBytes: number): { output: string; trimmed: boolean } {
  if (text.length <= maxBytes) return { output: text, trimmed: false };
  return { output: text.slice(0, maxBytes) + '\n[...truncated]', trimmed: true };
}

export type ExistingFileKind = 'new' | 'existing' | 'too-large' | 'unreadable';

export interface ExistingFileProbe {
  kind: ExistingFileKind;
  content?: string;
}

const MAX_PROBE_BYTES = 200_000;

/**
 * Read a file's current content (workspace-bounded) so the UI can build a
 * write_file diff. Absent files report 'new'; out-of-bounds or unreadable
 * paths report 'unreadable' rather than leaking their true status.
 */
export async function probeExistingFile(filePath: string, ctx: ToolContext): Promise<ExistingFileProbe> {
  const { resolved, error } = await resolveWithinWorkspace(filePath, ctx);
  if (error) return { kind: 'unreadable' };

  try {
    const st = await stat(resolved);
    if (!st.isFile()) return { kind: 'unreadable' };
    if (st.size > MAX_PROBE_BYTES) return { kind: 'too-large' };
    const content = await readFile(resolved, 'utf-8');
    return { kind: 'existing', content };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'new' };
    return { kind: 'unreadable' };
  }
}
