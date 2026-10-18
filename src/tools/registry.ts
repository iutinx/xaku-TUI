import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolContext, ToolResult } from './types.js';
import { list_dir } from './list_dir.js';
import { read_file } from './read_file.js';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
  isReadOnly: boolean;
}

export const tools: Record<string, ToolDefinition> = {
  read_file,
  list_dir,
};

export function createToolSchemaJson(tool: ToolDefinition): Record<string, unknown> {
  return zodToJsonSchema(tool.schema, { target: 'openApi3' });
}
