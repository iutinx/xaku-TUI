import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ChatPanel } from '../../src/ui/ChatPanel.js';
import type { ConversationMessage } from '../../src/model/session.js';

function history(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `msg ${String(i + 1).padStart(2, '0')}`,
  }));
}

function frame(props: Partial<React.ComponentProps<typeof ChatPanel>> = {}): string {
  const { lastFrame } = render(
    React.createElement(ChatPanel, {
      messages: [],
      partial: '',
      reasoning: '',
      generating: false,
      error: null,
      ...props,
    }),
  );
  return lastFrame() ?? '';
}

describe('ChatPanel scrollback windowing', () => {
  it('shows the tail with an earlier-messages hint at offset 0', () => {
    const out = frame({ messages: history(20) });
    expect(out).toContain('msg 20');
    expect(out).not.toContain('msg 08');
    expect(out).toContain('8 earlier messages');
    expect(out).toContain('↑ to scroll');
  });

  it('shows all messages when they fit in the window', () => {
    const out = frame({ messages: history(5) });
    expect(out).toContain('msg 01');
    expect(out).toContain('msg 05');
    expect(out).not.toContain('earlier messages');
  });

  it('moves the window toward older messages as offset grows', () => {
    const out = frame({ messages: history(20), scrollOffset: 5 });
    // Window is messages.slice(3, 15) => 'msg 04'..'msg 15'
    expect(out).toContain('msg 04');
    expect(out).toContain('msg 15');
    expect(out).not.toContain('msg 16');
    expect(out).not.toContain('msg 03');
  });

  it('renders the scroll banner with counts above and below', () => {
    const out = frame({ messages: history(20), scrollOffset: 5 });
    expect(out).toContain('↑ 3 earlier · 5 newer — Esc to return');
  });

  it('hides the streaming partial block while scrolled up', () => {
    const out = frame({
      messages: history(20),
      generating: true,
      partial: 'streaming text',
      scrollOffset: 4,
    });
    expect(out).not.toContain('streaming text');
  });

  it('keeps the streaming partial visible at the bottom', () => {
    const out = frame({
      messages: history(20),
      generating: true,
      partial: 'streaming text',
      scrollOffset: 0,
    });
    expect(out).toContain('streaming text');
  });

  it('auto-follows new messages when at the bottom', () => {
    const before = frame({ messages: history(20) });
    const after = frame({ messages: history(21) });
    expect(before).toContain('msg 20');
    expect(after).toContain('msg 21');
    expect(after).not.toContain('msg 09');
  });
});
