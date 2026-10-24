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
