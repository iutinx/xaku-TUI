import { describe, expect, it } from 'vitest';
import { autoSpeedScore, emptyRatings, DIMENSIONS, DIMENSION_LABELS, emptySide, type CompareSideResult } from '../../src/model/compare.js';

describe('emptySide', () => {
  it('creates a zeroed-out side result for a given model', () => {
    const side = emptySide('qwen3:4b');
    expect(side.model).toBe('qwen3:4b');
    expect(side.status).toBe('ok');
    expect(side.totalTimeMs).toBe(0);
    expect(side.tokensPerSecond).toBe(0);
    expect(side.toolCalls).toBe(0);
    expect(side.responseText).toBe('');
    expect(side.messages).toEqual([]);
    expect(side.toolActivities).toEqual([]);
  });
});

describe('emptyRatings', () => {
  it('returns all null ratings for each dimension', () => {
    const ratings = emptyRatings();
    for (const dim of DIMENSIONS) {
      expect(ratings[dim]).toBeNull();
    }
  });
});

describe('autoSpeedScore', () => {
  it('returns 5 for the faster model and lower for the slower', () => {
    const result = autoSpeedScore(100, 50);
    expect(result.left).toBe(5);
    expect(result.right).toBeGreaterThanOrEqual(1);
    expect(result.right).toBeLessThanOrEqual(5);
  });

  it('returns 5 for the faster model on the right side', () => {
    const result = autoSpeedScore(20, 80);
    expect(result.right).toBe(5);
    expect(result.left).toBeGreaterThanOrEqual(1);
    expect(result.left).toBeLessThanOrEqual(5);
  });

  it('returns equal scores when both are the same', () => {
    const result = autoSpeedScore(50, 50);
    expect(result.left).toBe(5);
    expect(result.right).toBe(5);
  });

  it('handles zero tokens per second', () => {
    const result = autoSpeedScore(0, 0);
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
  });

  it('handles one side with zero', () => {
    const result = autoSpeedScore(0, 50);
    expect(result.left).toBe(1);
    expect(result.right).toBe(5);
  });
});

describe('DIMENSIONS', () => {
  it('contains all four scoring dimensions', () => {
    expect(DIMENSIONS).toContain('accuracy');
    expect(DIMENSIONS).toContain('speed');
    expect(DIMENSIONS).toContain('toolCorrectness');
    expect(DIMENSIONS).toContain('instructionFollowing');
    expect(DIMENSIONS.length).toBe(4);
  });
});

describe('DIMENSION_LABELS', () => {
  it('has a label for each dimension', () => {
    for (const dim of DIMENSIONS) {
      expect(DIMENSION_LABELS[dim]).toBeDefined();
      expect(typeof DIMENSION_LABELS[dim]).toBe('string');
    }
  });
});
