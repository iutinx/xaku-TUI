import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { resolveWithinWorkspace } from './utils.js';

const schema = z.object({
  path: z.string().describe('File path to write (relative to workspace or absolute)'),
  content: z.string().describe('Content to write to the file'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { path: filePath, content } = args as { path: string; content: string };
  const { resolved, error } = await resolveWithinWorkspace(filePath, ctx);
  if (error) return error;

  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    return { output: `File written: ${path.relative(ctx.workspace, resolved)}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  }
}

export const write_file = {
  name: 'write_file',
  description: 'Write content to a file (creates parent directories if needed)',
  schema,
  execute,
  isReadOnly: false,
};
