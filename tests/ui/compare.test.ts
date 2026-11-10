import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ComparePanel } from '../../src/ui/ComparePanel.js';
import { emptyRatings, emptySide, type CompareSideResult } from '../../src/model/compare.js';

function sideResult(overrides: Partial<CompareSideResult> & { model: string }): CompareSideResult {
  return {
    ...emptySide(overrides.model),
    status: 'ok',
    totalTimeMs: 1500,
    tokensPerSecond: 42.5,
    toolCalls: 1,
    toolSuccess: 1,
    responseLength: 200,
    turns: 1,
    responseText: 'Hello from the model',
    reasoning: '',
    messages: [],
    toolActivities: [],
    ...overrides,
  };
}

describe('ComparePanel', () => {
  const left = sideResult({ model: 'qwen3:4b' });
  const right = sideResult({ model: 'qwen3:8b' });

  it('renders both model names in split view while running', () => {
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: left,
        rightResult: right,
        running: true,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('qwen3:4b');
    expect(out).toContain('qwen3:8b');
  });

  it('shows response text when not running', () => {
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: { ...left, responseText: 'Left response' },
        rightResult: { ...right, responseText: 'Right response' },
        running: false,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Left response');
    expect(out).toContain('Right response');
  });

  it('shows rating hint when complete and no score', () => {
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: left,
        rightResult: right,
        running: false,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[r] to rate');
  });

  it('shows score table when score is provided', () => {
    const score = {
      left: { model: 'qwen3:4b', ratings: { ...emptyRatings(), accuracy: 4, speed: 5 } },
      right: { model: 'qwen3:8b', ratings: { ...emptyRatings(), accuracy: 3, speed: 4 } },
    };
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: left,
        rightResult: right,
        running: false,
        score,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Ratings');
    expect(out).toContain('Accuracy');
    expect(out).toContain('Speed');
  });

  it('shows rating mode with dimension labels', () => {
    const score = {
      left: { model: 'qwen3:4b', ratings: { ...emptyRatings(), accuracy: 4 } },
      right: { model: 'qwen3:8b', ratings: { ...emptyRatings(), accuracy: 3 } },
    };
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: left,
        rightResult: right,
        running: false,
        score,
        ratingMode: true,
        ratingSide: 'left',
        ratingDimension: 'accuracy',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Accuracy');
    expect(out).toContain('Tool use');
    expect(out).toContain('Instructions');
  });

  it('shows partial text during streaming', () => {
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: left,
        rightResult: right,
        running: true,
        leftPartial: 'Streaming left...',
        rightPartial: 'Streaming right...',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Streaming left');
    expect(out).toContain('Streaming right');
  });

  it('shows tool activities when present', () => {
    const leftWithTools = {
      ...left,
      toolActivities: [
        { id: 't1', toolName: 'read_file', args: '{}', status: 'success' as const, durationMs: 100 },
        { id: 't2', toolName: 'list_dir', args: '{}', status: 'running' as const, durationMs: 0 },
      ],
    };
    const { lastFrame } = render(
      React.createElement(ComparePanel, {
        leftModel: 'qwen3:4b',
        rightModel: 'qwen3:8b',
        leftResult: leftWithTools,
        rightResult: right,
        running: false,
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('read_file');
    expect(out).toContain('list_dir');
  });
});
