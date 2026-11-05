import { describe, expect, it } from 'vitest';
import { computeDiffLines, formatDiffSummary, MAX_DIFF_LINES } from '../../src/ui/diff.js';

describe('computeDiffLines', () => {
  it('returns no lines for identical content', () => {
    const diff = computeDiffLines('one\ntwo\n', 'one\ntwo\n');
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.unchanged).toBe(2);
    expect(diff.lines.every((l) => l.type === 'ctx')).toBe(true);
  });

  it('classifies added lines', () => {
    const diff = computeDiffLines('one\n', 'one\ntwo\n');
    expect(diff.lines).toEqual([
      { type: 'ctx', text: 'one' },
      { type: 'add', text: 'two' },
    ]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it('classifies removed lines', () => {
    const diff = computeDiffLines('one\ntwo\n', 'one\n');
    expect(diff.lines).toEqual([
      { type: 'ctx', text: 'one' },
      { type: 'del', text: 'two' },
    ]);
    expect(diff.removed).toBe(1);
  });

  it('handles modified lines as del + add', () => {
    const diff = computeDiffLines('a\nb\nc\n', 'a\nB\nc\n');
    const types = diff.lines.map((l) => l.type);
    expect(types).toContain('del');
    expect(types).toContain('add');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.unchanged).toBe(2);
  });

  it('treats empty old content as a new file (all adds)', () => {
    const diff = computeDiffLines('', 'x\ny\nz');
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('treats empty new content as full deletion', () => {
    const diff = computeDiffLines('x\ny\n', '');
    expect(diff.removed).toBe(2);
    expect(diff.added).toBe(0);
  });

  it('truncates long diffs and reports the omitted count', () => {
    const oldC = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const newC = oldC + 'appended\nline 100\nline 101\n';
    const diff = computeDiffLines(oldC, newC);
    expect(diff.lines).toHaveLength(MAX_DIFF_LINES);
    expect(diff.truncated).toBeGreaterThan(0);
    expect(diff.truncated).toBe(103 - MAX_DIFF_LINES);
  });

  it('counts every changed line even when truncated', () => {
    const newC = Array.from({ length: 60 }, (_, i) => `n${i}`).join('\n');
    const diff = computeDiffLines('', newC);
    expect(diff.added).toBe(60);
    expect(diff.lines).toHaveLength(MAX_DIFF_LINES);
    expect(diff.truncated).toBe(20);
  });

  it('caps at a custom maxLines', () => {
    const diff = computeDiffLines('', 'a\nb\nc\nd', 2);
    expect(diff.lines).toHaveLength(2);
    expect(diff.truncated).toBe(2);
  });
});

describe('formatDiffSummary', () => {
  const diff = computeDiffLines('a\nb\n', 'a\nc\n');

  it('labels new files', () => {
    expect(formatDiffSummary(computeDiffLines('', 'x\ny'), true)).toBe('new file (+2 lines)');
  });

  it('reports changed counts for edits', () => {
    expect(formatDiffSummary(diff, false)).toBe('+1 -1 ~1');
  });

  it('detects no-ops', () => {
    expect(formatDiffSummary(computeDiffLines('a\n', 'a\n'), false)).toBe('no changes');
  });
});
