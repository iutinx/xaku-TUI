import OpenAI from 'openai';
import { streamCompletion } from './ollama.js';
import { estimateTokens, toOpenAIMessages, type AssistantMessage, type ConversationMessage, type ToolMessage } from './session.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from '../tools/executor.js';
import type { ToolCall, ToolContext, ToolResult } from '../tools/types.js';
import type { TestCase } from '../commands/cases.js';

export type Dimension = 'accuracy' | 'speed' | 'toolCorrectness' | 'instructionFollowing';

export type ModelRatings = Record<Dimension, number | null>;

export interface ComparisonScore {
  left: { model: string; ratings: ModelRatings };
  right: { model: string; ratings: ModelRatings };
  notes?: string;
}

export interface CompareToolActivity {
  id: string;
  toolName: string;
  args: string;
  status: 'running' | 'success' | 'failed';
  durationMs: number;
  error?: string;
}

export interface CompareSideResult {
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
  responseText: string;
  reasoning: string;
  messages: ConversationMessage[];
  toolActivities: CompareToolActivity[];
}

export interface CompareResult {
  left: CompareSideResult;
  right: CompareSideResult;
  testCaseName: string;
  testCase: TestCase;
  score?: ComparisonScore;
}

export interface CompareOptions {
  client: OpenAI;
  testCase: TestCase;
  temperature: number;
  systemPrompt: string | null;
  toolCtx: ToolContext;
  signal?: AbortSignal;
  maxTurns?: number;
  onContent?: (side: 'left' | 'right', text: string) => void;
  onReasoning?: (side: 'left' | 'right', text: string) => void;
  onToolActivity?: (side: 'left' | 'right', activity: CompareToolActivity) => void;
  onTurnEnd?: (side: 'left' | 'right', turn: number) => void;
}

export function emptySide(model: string): CompareSideResult {
  return {
    model,
    status: 'ok',
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
    responseText: '',
    reasoning: '',
    messages: [],
    toolActivities: [],
  };
}

export function errorSide(model: string, error: string): CompareSideResult {
  return { ...emptySide(model), status: 'error', error };
}

export async function runComparison(
  leftModel: string,
  rightModel: string,
  options: CompareOptions,
): Promise<CompareResult> {
  const toolDefs = getToolDefinitions();
  const leftController = new AbortController();
  const rightController = new AbortController();

  const linkedSignal = (outer: AbortSignal | undefined, inner: AbortController) => {
    if (outer) {
      if (outer.aborted) inner.abort();
      outer.addEventListener('abort', () => inner.abort(), { once: true });
    }
  };
  linkedSignal(options.signal, leftController);
  linkedSignal(options.signal, rightController);

  const runSide = async (
    model: string,
    side: 'left' | 'right',
    signal: AbortSignal,
  ): Promise<CompareSideResult> => {
    const messages: ConversationMessage[] = [{ role: 'user', content: options.testCase.prompt }];
    let promptTokens = 0;
    let completionTokens = 0;
    let toolCalls = 0;
    let toolSuccess = 0;
    let toolFail = 0;
    let toolDurationTotalMs = 0;
    let turns = 0;
    let finalContent = '';
    let fullReasoning = '';
    const activities: CompareToolActivity[] = [];
    const maxTurns = options.maxTurns ?? 8;

    const start = Date.now();
    try {
      while (turns < maxTurns) {
        if (signal.aborted) break;
        turns++;
        const result = await streamCompletion(
          options.client,
          {
            model,
            messages: toOpenAIMessages(messages),
            temperature: options.temperature,
            systemPrompt: options.testCase.systemPrompt ?? options.systemPrompt,
            tools: toolDefs,
            signal,
          },
          {
            onContent: (text) => options.onContent?.(side, text),
            onReasoning: (text) => {
              fullReasoning = text;
              options.onReasoning?.(side, text);
            },
          },
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

        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: result.content,
          tool_calls: calls,
          ...(fullReasoning ? { reasoning: fullReasoning } : {}),
        };
        messages.push(assistantMsg);

        const validations = calls.map((call) => ({ call, validation: validateToolCall(call) }));
        const execResults: (ToolResult | null)[] = await Promise.all(
          validations.map(async ({ call, validation }) => {
            toolCalls++;
            const activityId = `${side}_${call.id}`;
            if (!validation.valid) {
              toolFail++;
              const activity: CompareToolActivity = {
                id: activityId,
                toolName: call.function.name,
                args: call.function.arguments,
                status: 'failed',
                durationMs: 0,
                error: validation.error,
              };
              activities.push(activity);
              options.onToolActivity?.(side, activity);
              return { error: validation.error, label: validation.label };
            }
            const t0 = Date.now();
            const activity: CompareToolActivity = {
              id: activityId,
              toolName: call.function.name,
              args: call.function.arguments,
              status: 'running',
              durationMs: 0,
            };
            activities.push(activity);
            options.onToolActivity?.(side, activity);
            const r = await executeToolCall(call, { ...options.toolCtx, abortSignal: signal });
            const dur = Date.now() - t0;
            activity.durationMs = dur;
            activity.status = r.error ? 'failed' : 'success';
            if (r.error) activity.error = r.error;
            toolDurationTotalMs += dur;
            options.onToolActivity?.(side, { ...activity });
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

        options.onTurnEnd?.(side, turns);
      }
    } catch (err) {
      if (signal.aborted) return { ...buildResult() };
      const message = err instanceof Error ? err.message : String(err);
      return { ...errorSide(model, message), messages, toolActivities: activities };
    }

    function buildResult(): CompareSideResult {
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
        responseText: finalContent,
        reasoning: fullReasoning,
        messages: [...messages],
        toolActivities: activities,
      };
    }

    return buildResult();
  };

  const [left, right] = await Promise.all([
    runSide(leftModel, 'left', leftController.signal),
    runSide(rightModel, 'right', rightController.signal),
  ]);

  return {
    left,
    right,
    testCaseName: '',
    testCase: options.testCase,
  };
}

export const DIMENSIONS: Dimension[] = ['accuracy', 'speed', 'toolCorrectness', 'instructionFollowing'];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  accuracy: 'Accuracy',
  speed: 'Speed',
  toolCorrectness: 'Tool use',
  instructionFollowing: 'Instructions',
};

export function emptyRatings(): ModelRatings {
  return { accuracy: null, speed: null, toolCorrectness: null, instructionFollowing: null };
}

export function autoSpeedScore(leftTps: number, rightTps: number): { left: number; right: number } {
  if (leftTps === 0 && rightTps === 0) return { left: 0, right: 0 };
  const max = Math.max(leftTps, rightTps);
  const min = Math.min(leftTps, rightTps);
  if (max === 0) return { left: 0, right: 0 };
  const ratio = min / max;
  const faster = 5;
  const slower = Math.max(1, Math.round(ratio * 5));
  if (leftTps >= rightTps) return { left: faster, right: slower };
  return { left: slower, right: faster };
}
