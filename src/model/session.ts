import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export interface SystemMessage {
  role: 'system';
  content: string;
}

export type ConversationMessage = UserMessage | AssistantMessage | ToolMessage | SystemMessage;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export function toOpenAIMessages(messages: ConversationMessage[]): ChatCompletionMessageParam[] {
  return messages as ChatCompletionMessageParam[];
}

/**
 * Append synthetic tool results for any assistant tool_call that never received one
 * (e.g. cancelled mid-approval). OpenAI-compatible APIs reject requests where an
 * assistant message with tool_calls is not followed by a tool result per call,
 * so histories with dangling calls must be repaired before sending a new prompt.
 */
export function fillMissingToolResults(
  messages: ConversationMessage[],
  content = 'Tool call was cancelled before completing.',
): ConversationMessage[] {
  const resolved = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') resolved.add(m.tool_call_id);
  }
  const out: ConversationMessage[] = [];
  let changed = false;
  for (const m of messages) {
    out.push(m);
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (!resolved.has(tc.id)) {
          out.push({ role: 'tool', tool_call_id: tc.id, content });
          resolved.add(tc.id);
          changed = true;
        }
      }
    }
  }
  return changed ? out : messages;
}

export function estimateTokens(text: string): number {
  // Very rough estimate: ~4 characters per token for English/ASCII-heavy text.
  return Math.ceil(text.length / 4);
}

export function estimateContextTokens(
  messages: ConversationMessage[],
  systemPrompt: string | null,
  extraText = '',
): number {
  let chars = 0;
  if (systemPrompt) chars += systemPrompt.length;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    if ('tool_calls' in m && m.tool_calls) {
      for (const tc of m.tool_calls) {
        chars += tc.function.name.length + tc.function.arguments.length + 20;
      }
    }
    if ('tool_call_id' in m) chars += m.tool_call_id.length + 20;
  }
  chars += extraText.length;
  return Math.ceil(chars / 4);
}
