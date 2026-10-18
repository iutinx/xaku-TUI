import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolCall, ToolContext, ToolResult, ErrorLabel } from './types.js';
import { tools } from './registry.js';

export function validateToolCall(call: ToolCall): { valid: boolean; error?: string; label?: ErrorLabel } {
  const tool = tools[call.function.name];
  
  if (!tool) {
    return { valid: false, error: `Unknown tool: ${call.function.name}`, label: 'unknown_tool' };
  }

  try {
    const args = JSON.parse(call.function.arguments);
    const parsed = tool.schema.safeParse(args);
    
    if (!parsed.success) {
      return { 
        valid: false, 
        error: `Invalid arguments: ${parsed.error.message}`,
        label: 'malformed_call'
      };
    }
    
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      error: `Failed to parse arguments: ${err instanceof Error ? err.message : String(err)}`,
      label: 'malformed_call'
    };
  }
}

export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools[call.function.name];
  
  if (!tool) {
    return { error: `Unknown tool: ${call.function.name}`, label: 'unknown_tool' };
  }

  try {
    const args = JSON.parse(call.function.arguments);
    return await tool.execute(args, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  }
}

export function getToolDefinitions(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return Object.values(tools).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zToJson(tool.schema),
    },
  }));
}

function zToJson(schema: import('zod').ZodObject<import('zod').ZodRawShape>): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'openApi3' });
}
