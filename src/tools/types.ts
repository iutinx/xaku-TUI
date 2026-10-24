export type ErrorLabel =
  | 'unknown_tool'
  | 'malformed_call'
  | 'denied'
  | 'blocked'
  | 'execution_error'
  | 'no_tool_support';

export interface ToolContext {
  workspace: string;
  maxResultBytes: number;
  shellTimeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  output?: string;
  error?: string;
  label?: ErrorLabel;
  trimmed?: boolean;
  cancelled?: boolean;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
