import { realpath } from 'node:fs/promises';
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
