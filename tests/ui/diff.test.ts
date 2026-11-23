import { describe, expect, it } from 'vitest';
import { computeDiffLines, formatDiffSummary } from '../../src/ui/diff.js';

describe('computeDiffLines', () => {
  it('marks a new file as all additions with exact counts', () => {
    const diff = computeDiffLines('', 'one\ntwo\nthree\n');
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.unchanged).toBe(0);
    expect(diff.lines.every((l) => l.type === 'add')).toBe(true);
    expect(diff.lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
  });

  it('classifies additions, deletions and context on a modify', () => {
    const diff = computeDiffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(diff).toMatchObject({ added: 1, removed: 1, unchanged: 2, truncated: false });
    expect(diff.lines.some((l) => l.type === 'ctx')).toBe(true);
  });

  it('reports no changes for identical text', () => {
    const diff = computeDiffLines('same\n', 'same\n');
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.unchanged).toBe(1);
  });

  it('handles both sides empty', () => {
    const diff = computeDiffLines('', '');
    expect(diff.lines).toHaveLength(0);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it('caps rendered lines while keeping counts exact', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const diff = computeDiffLines('', many, 40);
    expect(diff.lines).toHaveLength(40);
    expect(diff.added).toBe(100);
    expect(diff.truncated).toBe(true);
  });

  it('honours a custom maxLines', () => {
    const diff = computeDiffLines('', 'a\nb\nc\nd\n', 2);
    expect(diff.lines).toHaveLength(2);
    expect(diff.added).toBe(4);
    expect(diff.truncated).toBe(true);
  });

  it('does not emit a phantom trailing line from the newline', () => {
    const diff = computeDiffLines('', 'single\n');
    expect(diff.lines.map((l) => l.text)).toEqual(['single']);
  });

  it('keeps counts exact when only part of a hunk is shown', () => {
    const diff = computeDiffLines('a\n', 'a\n' + Array.from({ length: 50 }, (_, i) => `+${i}`).join('\n') + '\n', 10);
    expect(diff.added).toBe(50);
    expect(diff.unchanged).toBe(1);
    expect(diff.lines.length).toBeLessThanOrEqual(10);
  });
});

describe('formatDiffSummary', () => {
  it('labels a new file', () => {
    const diff = computeDiffLines('', 'a\nb\n');
    expect(formatDiffSummary(diff, 'new')).toBe('new file (+2 lines)');
  });

  it('shows added/removed/unchanged for edits', () => {
    const diff = computeDiffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(formatDiffSummary(diff, 'existing')).toMatch(/^\+\d+ -\d+ ~\d+$/);
  });

  it('says no changes when nothing moved', () => {
    expect(formatDiffSummary(computeDiffLines('a\n', 'a\n'), 'existing')).toBe('no changes');
  });
});
