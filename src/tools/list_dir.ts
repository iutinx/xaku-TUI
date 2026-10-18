import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

const schema = z.object({
  path: z.string().describe('Directory path to list (relative to workspace or absolute)'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { path: dirPath } = args as { path: string };
  const resolved = path.resolve(ctx.workspace, dirPath);
  
  // Workspace boundary check
  if (!resolved.startsWith(ctx.workspace + path.sep) && resolved !== ctx.workspace) {
    return { error: 'Access denied: path outside workspace', label: 'blocked' };
  }

  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    const lines = entries.map((entry) => {
      const type = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other';
      return `${type}\t${entry.name}`;
    });
    
    let output = lines.join('\n');
    let trimmed = false;
    
    if (output.length > ctx.maxResultBytes) {
      output = output.slice(0, ctx.maxResultBytes) + '\n[...truncated]';
      trimmed = true;
    }
    
    return { output, trimmed };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return { error: 'Directory not found', label: 'execution_error' };
    }
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  }
}

export const list_dir = {
  name: 'list_dir',
  description: 'List files and directories in a folder',
  schema,
  execute,
  isReadOnly: true,
};
