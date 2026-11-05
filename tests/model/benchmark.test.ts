import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type OpenAI from 'openai';
import { runBenchmark } from '../../src/model/benchmark.js';
import type { ToolContext } from '../../src/tools/types.js';

function makeClient(models: Record<string, () => unknown[]>): OpenAI {
  const mock = {
    chat: {
      completions: {
        create: (params: { model: string }) => {
          const chunks = models[params.model];
          if (!chunks) return Promise.reject(new Error(`model not found: ${params.model}`));
          return Promise.resolve({
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks()) {
                yield chunk;
              }
            },
          });
        },
      },
    },
  };
  return mock as unknown as OpenAI;
}

function contentChunks(text: string, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): unknown[] {
  const out: unknown[] = [{ choices: [{ delta: { content: text } }] }];
  if (usage) out.push({ choices: [], usage });
  return out;
}

function toolCallChunks(name: string, args: string): unknown[] {
  return [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: args } }] } }] },
  ];
}

let toolCtx: ToolContext;
let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'xaku-bench-'));
  toolCtx = { workspace, maxResultBytes: 100_000, shellTimeoutMs: 30_000 };
  await writeFile(path.join(workspace, 'data.txt'), 'payload', 'utf-8');
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('runBenchmark', () => {
  it('captures metrics for a simple prompt across two models', async () => {
    const client = makeClient({
      'model-a': () => contentChunks('answer from a', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
      'model-b': () => contentChunks('longer answer from b', { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }),
    });
    const results = await runBenchmark(['model-a', 'model-b'], {
      client,
      testCase: { prompt: 'question', systemPrompt: null },
      temperature: 0.2,
      systemPrompt: 'sys',
      toolCtx,
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.model)).toEqual(['model-a', 'model-b']);
    for (const r of results) {
      expect(r.status).toBe('ok');
      expect(r.turns).toBe(1);
      expect(r.toolCalls).toBe(0);
      expect(r.totalTimeMs).toBeGreaterThanOrEqual(0);
    }
    expect(results[0].promptTokens).toBe(10);
    expect(results[0].completionTokens).toBe(5);
    expect(results[0].responseLength).toBe('answer from a'.length);
    expect(results[1].completionTokens).toBe(8);
  });

  it('executes tool calls automatically and tracks durations', async () => {
    // Turn 1 streams a tool call, turn 2 streams the final answer.
    let turn = 0;
    const results = await runBenchmark(['tool-model'], {
      client: {
        chat: {
          completions: {
            create: () => {
              const chunks = turn++ === 0
                ? toolCallChunks('read_file', '{"path":"data.txt"}')
                : contentChunks('final answer', { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 });
              return Promise.resolve({
                async *[Symbol.asyncIterator]() {
                  for (const c of chunks) yield c;
                },
              });
            },
          },
        },
      } as unknown as OpenAI,
      testCase: { prompt: 'read data.txt', systemPrompt: null },
      temperature: 0.2,
      systemPrompt: null,
      toolCtx,
    });

    expect(results[0].status).toBe('ok');
    expect(results[0].toolCalls).toBe(1);
    expect(results[0].toolSuccess).toBe(1);
    expect(results[0].toolFail).toBe(0);
    expect(results[0].avgToolDurationMs).toBeGreaterThanOrEqual(0);
    expect(results[0].turns).toBe(2);
    expect(results[0].responseLength).toBe('final answer'.length);
  });

  it('reports an error row when a model fails', async () => {
    const results = await runBenchmark(['missing-model'], {
      client: makeClient({}) as OpenAI,
      testCase: { prompt: 'hi', systemPrompt: null },
      temperature: 0.2,
      systemPrompt: null,
      toolCtx,
    });
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('missing-model');
  });

  it('stops cleanly on abort and records cancelled runs as errors', async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runBenchmark(['model-a', 'model-b'], {
      client: makeClient({ 'model-a': () => contentChunks('a') }) as OpenAI,
      testCase: { prompt: 'hi', systemPrompt: null },
      temperature: 0.2,
      systemPrompt: null,
      toolCtx,
      signal: controller.signal,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'error' && r.error === 'Skipped: benchmark cancelled')).toBe(true);
  });
});
