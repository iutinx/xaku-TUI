import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

const schema = z.object({
  path: z.string().describe('File path to read (relative to workspace or absolute)'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { path: filePath } = args as { path: string };
  const resolved = path.resolve(ctx.workspace, filePath);
  
  // Workspace boundary check
  if (!resolved.startsWith(ctx.workspace + path.sep) && resolved !== ctx.workspace) {
    return { error: 'Access denied: path outside workspace', label: 'blocked' };
  }

  try {
    const content = await readFile(resolved, 'utf-8');
    let trimmed = false;
    let finalContent = content;
    
    if (content.length > ctx.maxResultBytes) {
      finalContent = content.slice(0, ctx.maxResultBytes) + '\n[...truncated]';
      trimmed = true;
    }
    
    return { output: finalContent, trimmed };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return { error: 'File not found', label: 'execution_error' };
    }
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  }
}

export const read_file = {
  name: 'read_file',
  description: 'Read the contents of a file',
  schema,
  execute,
  isReadOnly: true,
};
