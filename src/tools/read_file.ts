import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { resolveWithinWorkspace, trimOutput } from './utils.js';

const schema = z.object({
  path: z.string().describe('File path to read (relative to workspace or absolute)'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { path: filePath } = args as { path: string };
  const { resolved, error } = await resolveWithinWorkspace(filePath, ctx);
  if (error) return error;

  try {
    const content = await readFile(resolved, 'utf-8');
    return trimOutput(content, ctx.maxResultBytes);
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
