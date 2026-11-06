import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ToolPanel } from '../../src/ui/ToolPanel.js';
import { computeDiffLines } from '../../src/ui/diff.js';
import { SPINNER_INTERVAL_MS } from '../../src/ui/useSpinner.js';
import { symbols } from '../../src/ui/theme.js';
import type { ToolActivity } from '../../src/ui/ToolActivity.js';

function activity(overrides: Partial<ToolActivity> & { id: string; toolName: string }): ToolActivity {
  return {
    toolCallId: `call_${overrides.id}`,
    arguments: { path: 'f.txt' },
    status: 'success',
    result: 'ok',
    duration: 0.2,
    ...overrides,
  };
}

function frame(activities: ToolActivity[], compact = false, extra: { pendingIds?: string[]; focusedId?: string | null } = {}): string {
  const { lastFrame, unmount } = render(
    React.createElement(ToolPanel, { activities, compact, ...extra }),
  );
  const out = lastFrame() ?? '';
  unmount();
  return out;
}

describe('ToolPanel compact mode', () => {
  const mixed = [
    activity({ id: 'a', toolName: 'read_file' }),
    activity({ id: 'b', toolName: 'list_dir' }),
    activity({ id: 'c', toolName: 'run_shell', status: 'skipped', result: undefined }),
    activity({ id: 'd', toolName: 'write_file', status: 'awaiting_approval', preview: 'path: f.txt\ncontent:\nhello' }),
  ];

  it('collapses terminal activities into per-outcome summary lines', () => {
    const out = frame(mixed, true);
    expect(out).toContain('2 succeeded');
    expect(out).toContain('1 skipped');
    expect(out).not.toContain('read_file');
    expect(out).not.toContain('list_dir');
  });

  it('keeps the pending-approval activity expanded in compact mode', () => {
    const out = frame(mixed, true, { pendingIds: ['d'] });
    expect(out).toContain('write_file');
    expect(out).toContain('[a] approve');
  });

  it('shows an expand hint in compact mode', () => {
    const out = frame(mixed, true);
    expect(out).toContain('[c] expand 3 collapsed');
  });

  it('shows a collapse hint when expanded with completed activities', () => {
    const out = frame(mixed, false);
    expect(out).toContain('[c] collapse 3 completed');
    expect(out).toContain('read_file');
  });

  it('shows no hints when all activities are pending', () => {
    const pending = [activity({ id: 'x', toolName: 'read_file', status: 'awaiting_approval', preview: 'p', result: undefined })];
    const out = frame(pending, false);
    expect(out).not.toContain('[c]');
  });
});

describe('ToolPanel batch approval UI', () => {
  it('renders multi-pending batch hint with range', () => {
    const two = [
      activity({ id: 'p1', toolName: 'read_file', status: 'awaiting_approval', preview: 'a', result: undefined }),
      activity({ id: 'p2', toolName: 'write_file', status: 'awaiting_approval', preview: 'b', result: undefined }),
    ];
    const out = frame(two, false, { pendingIds: ['p1', 'p2'] });
    expect(out).toContain('[a] approve all');
    expect(out).toContain('[1-2] review');
    expect(out).toContain('[1]');
    expect(out).toContain('[2]');
  });

  it('renders focused hint with Esc affordance', () => {
    const two = [
      activity({ id: 'p1', toolName: 'read_file', status: 'awaiting_approval', preview: 'a', result: undefined }),
      activity({ id: 'p2', toolName: 'write_file', status: 'awaiting_approval', preview: 'b', result: undefined }),
    ];
    const out = frame(two, false, { pendingIds: ['p1', 'p2'], focusedId: 'p2' });
    expect(out).toContain('[Esc] back to batch');
    expect(out).not.toContain('approve all');
  });

  it('renders single-pending hint without the "all" wording', () => {
    const one = [activity({ id: 'p1', toolName: 'read_file', status: 'awaiting_approval', preview: 'a', result: undefined })];
    const out = frame(one, false, { pendingIds: ['p1'] });
    expect(out).toContain('[a] approve  [d] deny');
    expect(out).not.toContain('approve all');
  });
});

describe('ToolPanel write_file diff render', () => {
  const diff = computeDiffLines('a\nb\n', 'a\nc\n');

  function diffActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
    return activity({
      id: 'w',
      toolName: 'write_file',
      status: 'awaiting_approval',
      result: undefined,
      arguments: { path: 'f.txt', content: 'a\nc\n' },
      preview: 'path: f.txt\n+1 -1 ~1',
      fileState: 'existing',
      diff,
      ...overrides,
    });
  }

  it('renders the diff header with change counts', () => {
    const out = frame([diffActivity()]);
    expect(out).toContain('diff:');
    expect(out).toContain('+1 -1 ~1');
  });

  it('renders colored diff lines with +, -, | gutters', () => {
    const out = frame([diffActivity()]);
    expect(out).toContain('| a');
    expect(out).toContain('- b');
    expect(out).toContain('+ c');
  });

  it('labels new files distinctly', () => {
    const created = diffActivity({ fileState: 'new', diff: computeDiffLines('', 'a\nb') });
    const out = frame([created]);
    expect(out).toContain('new file (+2 lines)');
    expect(out).not.toContain('diff:');
  });

  it('falls back to plain preview with a note for too-large files', () => {
    const tooBig = diffActivity({ fileState: 'too-large', diff: undefined });
    const out = frame([tooBig]);
    expect(out).toContain('preview:');
    expect(out).toContain('[existing file too large to diff]');
  });

  it('appends a truncation footer when the diff is capped', () => {
    const big = diffActivity({ diff: computeDiffLines('', Array.from({ length: 60 }, (_, i) => `n${i}`).join('\n')) });
    const out = frame([big]);
    expect(out).toContain('and 20 more lines');
  });
});

describe('ToolPanel animated spinner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const runningActivity = () =>
    activity({ id: 'r', toolName: 'run_shell', status: 'running', result: undefined, duration: undefined });

  it('starts non-terminal activities on the first spinner frame', () => {
    const out = frame([runningActivity()]);
    expect(out).toContain(`${symbols.spinner[0]} run_shell`);
  });

  it('cycles through spinner frames while activities are non-terminal', async () => {
    vi.useFakeTimers();
    const { lastFrame, unmount } = render(React.createElement(ToolPanel, { activities: [runningActivity()] }));
    expect(lastFrame() ?? '').toContain(symbols.spinner[0]);
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS);
    expect(lastFrame() ?? '').toContain(symbols.spinner[1]);
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 2);
    expect(lastFrame() ?? '').toContain(symbols.spinner[3]);
    unmount();
  });

  it('wraps around the frame list', async () => {
    vi.useFakeTimers();
    const { lastFrame, unmount } = render(React.createElement(ToolPanel, { activities: [runningActivity()] }));
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * symbols.spinner.length);
    expect(lastFrame() ?? '').toContain(symbols.spinner[0]);
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS);
    expect(lastFrame() ?? '').toContain(symbols.spinner[1]);
    unmount();
  });

  it('does not tick when every activity is terminal', async () => {
    vi.useFakeTimers();
    const { lastFrame, unmount } = render(
      React.createElement(ToolPanel, { activities: [activity({ id: 's', toolName: 'read_file', status: 'success' })] }),
    );
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 5);
    expect(lastFrame() ?? '').toContain(`${symbols.success} read_file`);
    unmount();
  });

  it('keeps terminal rows static while a sibling activity spins', async () => {
    vi.useFakeTimers();
    const mixed = [
      activity({ id: 's', toolName: 'read_file', status: 'success' }),
      runningActivity(),
    ];
    const { lastFrame, unmount } = render(React.createElement(ToolPanel, { activities: mixed }));
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 3);
    const out = lastFrame() ?? '';
    expect(out).toContain(`${symbols.success} read_file`);
    expect(out).toContain(`${symbols.spinner[3]} run_shell`);
    unmount();
  });
});
