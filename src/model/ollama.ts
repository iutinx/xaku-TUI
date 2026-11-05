import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export interface StreamHandlers {
  onContent: (content: string) => void;
  onReasoning?: (reasoning: string) => void;
  onToolCallDelta?: (toolCall: ToolCallInProgress) => void;
  onUsage?: (usage: UsageInfo) => void;
  onError?: (error: Error) => void;
}

export interface ToolCallInProgress {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InstalledModel {
  name: string;
  size: number;
  modifiedAt: string;
}

export function createClient(baseUrl: string): OpenAI {
  return new OpenAI({ baseURL: baseUrl, apiKey: 'ollama' });
}

export async function checkConnection(client: OpenAI): Promise<boolean> {
  try {
    await client.models.list();
    return true;
  } catch {
    return false;
  }
}

export async function listInstalledModels(baseUrl: string): Promise<InstalledModel[]> {
  try {
    const root = baseUrl.replace(/\/v1$/, '');
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string; size: number; modified_at: string }> };
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
    }));
  } catch {
    return [];
  }
}

export async function checkToolSupport(baseUrl: string, model: string): Promise<boolean> {
  try {
    const root = baseUrl.replace(/\/v1$/, '');
    const res = await fetch(`${root}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as Record<string, unknown>;
    const capabilities = data.capabilities;
    if (Array.isArray(capabilities)) {
      return capabilities.includes('tools') || capabilities.includes('tool_use');
    }
    // Fallback heuristic based on model family/name until a reliable field is confirmed.
    const family = String(data.details && typeof data.details === 'object' ? (data.details as Record<string, unknown>).family ?? '' : '');
    if (/qwen|llama3|mistral|command|gemma/i.test(family)) return true;
    return /qwen|llama3\.?1|mistral|command|gemma/i.test(model);
  } catch {
    return false;
  }
}

export interface CompletionResult {
  content: string | null;
  reasoning: string | null;
  toolCalls: ToolCallInProgress[];
  usage: UsageInfo | null;
}

export async function streamCompletion(
  client: OpenAI,
  options: {
    model: string;
    messages: ChatCompletionMessageParam[];
    temperature: number;
    systemPrompt: string | null;
    tools?: ChatCompletionTool[];
    signal?: AbortSignal;
  },
  handlers: StreamHandlers,
): Promise<CompletionResult> {
  const messages: ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push(...options.messages);

  const stream = await client.chat.completions.create(
    {
      model: options.model,
      messages,
      temperature: options.temperature,
      stream: true,
      stream_options: { include_usage: true },
      tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  let content = '';
  let reasoning = '';
  const toolCalls = new Map<number, ToolCallInProgress>();
  let usage: UsageInfo | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
      handlers.onUsage?.(usage);
    }

    const reasoningDelta = (delta as { reasoning?: string } | undefined)?.reasoning;
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      handlers.onReasoning?.(reasoning);
    }

    if (delta?.content) {
      content += delta.content;
      handlers.onContent(content);
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolCalls.get(tc.index) ?? { index: tc.index };
        if (tc.id) existing.id = tc.id;
        if (tc.type) existing.type = tc.type;
        if (tc.function) {
          existing.function = existing.function ?? {};
          if (tc.function.name) existing.function.name = tc.function.name;
          if (tc.function.arguments) {
            existing.function.arguments = (existing.function.arguments ?? '') + tc.function.arguments;
          }
        }
        toolCalls.set(tc.index, existing);
        handlers.onToolCallDelta?.(existing);
      }
    }
  }

  return {
    content,
    reasoning: reasoning || null,
    toolCalls: Array.from(toolCalls.values()).sort((a, b) => a.index - b.index),
    usage,
  };
}
