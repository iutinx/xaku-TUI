import OpenAI from 'openai';
import { streamCompletion } from './ollama.js';
import { estimateTokens, toOpenAIMessages, type AssistantMessage, type ConversationMessage, type ToolMessage } from './session.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from '../tools/executor.js';
import type { ToolCall, ToolContext, ToolResult } from '../tools/types.js';
import type { TestCase } from '../commands/cases.js';

export interface BenchmarkResult {
  model: string;
  status: 'ok' | 'error';
  error?: string;
  totalTimeMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
  toolCalls: number;
  toolSuccess: number;
  toolFail: number;
  avgToolDurationMs: number;
  responseLength: number;
  turns: number;
}

export interface BenchmarkOptions {
  client: OpenAI;
  testCase: TestCase;
  temperature: number;
  systemPrompt: string | null;
  toolCtx: ToolContext;
  signal?: AbortSignal;
  maxTurns?: number;
  onModelStart?: (model: string, index: number, total: number) => void;
  onModelEnd?: (result: BenchmarkResult) => void;
}

export async function runBenchmark(models: string[], options: BenchmarkOptions): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const toolDefs = getToolDefinitions();

  for (let i = 0; i < models.length; i++) {
    if (options.signal?.aborted) {
      results.push(errorResult(models[i], 'Skipped: benchmark cancelled'));
      continue;
    }
    options.onModelStart?.(models[i], i, models.length);
    const result = await runSingleModel(models[i], toolDefs, options);
    results.push(result);
    options.onModelEnd?.(result);
  }
  return results;
}

function errorResult(model: string, error: string): BenchmarkResult {
  return {
    model,
    status: 'error',
    error,
    totalTimeMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokensPerSecond: 0,
    toolCalls: 0,
    toolSuccess: 0,
    toolFail: 0,
    avgToolDurationMs: 0,
    responseLength: 0,
    turns: 0,
  };
}

async function runSingleModel(
  model: string,
  toolDefs: ReturnType<typeof getToolDefinitions>,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const maxTurns = options.maxTurns ?? 8;
  const messages: ConversationMessage[] = [{ role: 'user', content: options.testCase.prompt }];
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = 0;
  let toolSuccess = 0;
  let toolFail = 0;
  let toolDurationTotalMs = 0;
  let turns = 0;
  let finalContent = '';

  const start = Date.now();
  try {
    while (turns < maxTurns) {
      turns++;
      const result = await streamCompletion(
        options.client,
        {
          model,
          messages: toOpenAIMessages(messages),
          temperature: options.temperature,
          systemPrompt: options.testCase.systemPrompt ?? options.systemPrompt,
          tools: toolDefs,
          signal: options.signal,
        },
        { onContent: () => {} },
      );

      if (result.usage) {
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
      }
      finalContent = result.content || finalContent;

      if (result.toolCalls.length === 0) break;

      const calls: ToolCall[] = result.toolCalls.map((tc, i) => ({
        id: tc.id || `call_${Date.now()}_${i}`,
        type: 'function' as const,
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
        },
      }));

      const assistantMsg: AssistantMessage = { role: 'assistant', content: result.content, tool_calls: calls };
      messages.push(assistantMsg);

      // Benchmarks auto-approve everything; validate then execute in parallel.
      const validations = calls.map((call) => ({ call, validation: validateToolCall(call) }));
      const execResults: (ToolResult | null)[] = await Promise.all(
        validations.map(async ({ call, validation }) => {
          toolCalls++;
          if (!validation.valid) {
            toolFail++;
            return { error: validation.error, label: validation.label };
          }
          const t0 = Date.now();
          const r = await executeToolCall(call, { ...options.toolCtx, abortSignal: options.signal });
          toolDurationTotalMs += Date.now() - t0;
          if (r.error) toolFail++;
          else toolSuccess++;
          return r;
        }),
      );

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const r = execResults[i];
        const toolMsg: ToolMessage = {
          role: 'tool',
          tool_call_id: call.id,
          content: r?.error ? `Error: ${r.error}` : r?.output || '',
        };
        messages.push(toolMsg);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(model, message);
  }

  const totalTimeMs = Date.now() - start;
  const counted = completionTokens || estimateTokens(finalContent);
  return {
    model,
    status: 'ok',
    totalTimeMs,
    promptTokens,
    completionTokens,
    tokensPerSecond: totalTimeMs > 0 ? counted / (totalTimeMs / 1000) : 0,
    toolCalls,
    toolSuccess,
    toolFail,
    avgToolDurationMs: toolCalls > 0 ? toolDurationTotalMs / toolCalls : 0,
    responseLength: finalContent.length,
    turns,
  };
}
