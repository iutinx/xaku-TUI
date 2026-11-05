import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { BenchmarkPanel } from '../../src/ui/BenchmarkPanel.js';
import { SessionPicker } from '../../src/ui/SessionPicker.js';
import type { BenchmarkResult } from '../../src/model/benchmark.js';
import type { SessionSummary } from '../../src/model/replay.js';

function result(overrides: Partial<BenchmarkResult> & { model: string }): BenchmarkResult {
  return {
    status: 'ok',
    totalTimeMs: 1000,
    promptTokens: 10,
    completionTokens: 50,
    tokensPerSecond: 50,
    toolCalls: 2,
    toolSuccess: 2,
    toolFail: 0,
    avgToolDurationMs: 20,
    responseLength: 200,
    turns: 1,
    ...overrides,
  };
}

describe('BenchmarkPanel', () => {
  const results = [
    result({ model: 'qwen3:4b', tokensPerSecond: 42.5, totalTimeMs: 1200 }),
    result({ model: 'qwen3:8b', tokensPerSecond: 21.0, totalTimeMs: 2400 }),
  ];

  it('renders one row per result with header', () => {
    const { lastFrame } = render(
      React.createElement(BenchmarkPanel, {
        testCaseName: 'webtest', models: ['qwen3:4b', 'qwen3:8b'], results, running: false, currentModel: null,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('qwen3:4b');
    expect(out).toContain('42.5');
    expect(out).toContain('21');
    expect(out).toContain('Tok/s');
    expect(out).toContain('Done · 2/2 models');
  });

  it('shows progress while running', () => {
    const { lastFrame } = render(
      React.createElement(BenchmarkPanel, {
        testCaseName: 'webtest', models: ['a', 'b', 'c'], results: [results[0]], running: true, currentModel: 'b',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Running 2/3');
    expect(out).toContain('b');
  });

  it('renders error rows distinctly', () => {
    const failed = { model: 'broken', status: 'error' as const, error: 'model not found', totalTimeMs: 0, promptTokens: 0, completionTokens: 0, tokensPerSecond: 0, toolCalls: 0, toolSuccess: 0, toolFail: 0, avgToolDurationMs: 0, responseLength: 0, turns: 0 };
    const { lastFrame } = render(
      React.createElement(BenchmarkPanel, {
        testCaseName: 't', models: ['broken'], results: [failed], running: false, currentModel: null,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('broken');
    expect(out).toContain('model not found');
  });
});

describe('SessionPicker', () => {
  const sessions: SessionSummary[] = [
    { fileName: 'session-b.jsonl', startedAt: 1730000200000, model: 'qwen3:4b', workspace: '/proj/beta', events: 45 },
    { fileName: 'session-a.jsonl', startedAt: 1730000100000, model: 'llama3:8b', workspace: '/proj/alpha', events: 12 },
  ];

  it('lists sessions numbered with labels', () => {
    const { lastFrame } = render(React.createElement(SessionPicker, { sessions, selectedIndex: 0 }));
    const out = lastFrame() ?? '';
    expect(out).toContain('1.');
    expect(out).toContain('2.');
    expect(out).toContain('qwen3:4b');
    expect(out).toContain('llama3:8b');
    expect(out).toContain('beta');
    expect(out).toContain('45 events');
  });

  it('shows navigation hint', () => {
    const { lastFrame } = render(React.createElement(SessionPicker, { sessions, selectedIndex: 1 }));
    expect(lastFrame() ?? '').toContain('Enter load');
  });
});
