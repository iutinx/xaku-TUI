import { describe, expect, it, vi } from 'vitest';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { ChatPanel, computeReasoningHeaderRows, type ChatRowItem } from '../../src/ui/ChatPanel.js';
import type { ConversationMessage } from '../../src/model/session.js';

function history(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `msg ${String(i + 1).padStart(2, '0')}`,
  }));
}

// Each user message block occupies 4 rows (margin, label, content, margin),
// so 20 messages = 80 rows of content inside the fixed-height viewport.
function frame(
  props: Partial<React.ComponentProps<typeof ChatPanel>> = {},
  height = 12,
): { out: string; unmount: () => void } {
  const { lastFrame, unmount } = render(
    React.createElement(
      Box,
      { flexDirection: 'column' as const, height, width: 40 },
      React.createElement(ChatPanel, {
        messages: [],
        partial: '',
        reasoning: '',
        generating: false,
        error: null,
        ...props,
      }),
    ),
  );
  return { out: lastFrame() ?? '', unmount };
}

describe('ChatPanel bottom-anchored scrolling', () => {
  it('shows the newest content at the tail and clips the oldest', () => {
    const { out, unmount } = frame({ messages: history(20) });
    unmount();
    expect(out).toContain('msg 20');
    expect(out).not.toContain('msg 01');
    expect(out).not.toContain('rows above');
  });

  it('reveals older rows as scrollLine grows and hides the tail', () => {
    const { out, unmount } = frame({ messages: history(20), scrollLine: 20 });
    unmount();
    expect(out).not.toContain('msg 20');
    expect(out).toContain('msg 15');
    expect(out).not.toContain('msg 12');
  });

  it('renders the scroll banner with the row count', () => {
    const { out, unmount } = frame({ messages: history(20), scrollLine: 5 });
    unmount();
    expect(out).toContain('↑ 5 rows above');
  });

  it('hides the streaming partial while scrolled up', () => {
    const { out, unmount } = frame({
      messages: history(20),
      generating: true,
      partial: 'streaming text',
      scrollLine: 3,
    });
    unmount();
    expect(out).not.toContain('streaming text');
    expect(out).toContain('rows above');
  });

  it('keeps the streaming partial at the bottom when at the tail', () => {
    const { out, unmount } = frame({
      messages: history(20),
      generating: true,
      partial: 'streaming text',
    });
    unmount();
    expect(out).toContain('streaming text');
  });

  it('renders errors above the tail', () => {
    const { out, unmount } = frame({ messages: history(3), error: 'boom happened' });
    unmount();
    expect(out).toContain('boom happened');
  });

  it('reports measured heights via onMeasured', () => {
    const measured = vi.fn();
    const { unmount } = frame({ messages: history(20), onMeasured: measured });
    unmount();
    expect(measured).toHaveBeenCalled();
    const call = measured.mock.lastCall?.[0];
    expect(call).toBeDefined();
    const { contentHeight, containerHeight } = call;
    expect(containerHeight).toBeGreaterThan(0);
    expect(contentHeight).toBeGreaterThan(containerHeight);
  });

  it('renders completed reasoning collapsed by default', () => {
    const msgs: ConversationMessage[] = [
      { role: 'assistant', content: 'answer text', reasoning: 'pondering the universe' },
    ];
    const { out, unmount } = frame({ messages: msgs });
    unmount();
    expect(out).toContain('thinking');
    expect(out).toContain('[+]');
    expect(out).not.toContain('pondering the universe');
    expect(out).toContain('answer text');
  });

  it('expands the reasoning block when the index is marked expanded', () => {
    const msgs: ConversationMessage[] = [
      { role: 'assistant', content: 'answer text', reasoning: 'pondering the universe' },
    ];
    const { out, unmount } = frame({ messages: msgs, expandedReasoning: new Set([0]) });
    unmount();
    expect(out).toContain('[−]');
    expect(out).toContain('pondering the universe');
    expect(out).toContain('answer text');
  });

  it('renders user messages inside a rounded block', () => {
    const { out, unmount } = frame({ messages: [{ role: 'user', content: 'hi there' }] });
    unmount();
    expect(out).toContain('╭');
    expect(out).toContain('you');
    expect(out).toContain('hi there');
  });
});

describe('computeReasoningHeaderRows', () => {
  // Newest-first JSX order: msg-2 sits at the bottom of the viewport.
  const items: ChatRowItem[] = [
    { key: 'msg-2', origIdx: 2, reasoningHeader: true },
    { key: 'msg-1', origIdx: 1, reasoningHeader: true },
    { key: 'msg-0', origIdx: 0, reasoningHeader: true },
  ];
  const heights = new Map([
    ['msg-2', 6],
    ['msg-1', 4],
    ['msg-0', 2],
  ]);

  it('maps visible reasoning headers to absolute rows (label row + 1)', () => {
    // Container occupies rows 3..12. msg-2: rows 7..12 → header 8.
    // msg-1: rows 2..5 → header 3. msg-0 overflows above → dropped.
    const rows = computeReasoningHeaderRows(items, heights, 3, 10, 0);
    expect(rows.get(2)).toBe(8);
    expect(rows.get(1)).toBe(3);
    expect(rows.has(0)).toBe(false);
  });

  it('shifts rows down with scrollLine and drops headers pushed below the viewport', () => {
    // scrollLine 5 pushes msg-2 fully past the bottom clip (header 13 > 12).
    const rows = computeReasoningHeaderRows(items, heights, 3, 10, 5);
    expect(rows.has(2)).toBe(false);
    expect(rows.get(1)).toBe(8);
  });

  it('accounts for non-reasoning items (stream/error rows) in the offsets', () => {
    const withStream: ChatRowItem[] = [
      { key: 'stream', origIdx: null, reasoningHeader: false },
      ...items,
    ];
    const withHeights = new Map([...heights, ['stream', 3]]);
    // Stream (3 rows) now occupies the bottom; msg-2 header shifts up by 4.
    const rows = computeReasoningHeaderRows(withStream, withHeights, 3, 10, 0);
    expect(rows.get(2)).toBe(4);
  });
});
