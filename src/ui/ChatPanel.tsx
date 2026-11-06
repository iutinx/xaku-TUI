import { Box, Text, measureElement } from 'ink';
import { useLayoutEffect, useRef, useState } from 'react';
import React from 'react';
import type { ConversationMessage } from '../model/session.js';
import { symbols, theme } from './theme.js';
import { MarkdownText, preprocessStreaming } from './MarkdownText.js';
import { useMouseEvents } from './mouse.js';

export interface ChatPanelProps {
  messages: ConversationMessage[];
  partial: string;
  reasoning: string;
  generating: boolean;
  error: string | null;
  /** Rows scrolled up from the bottom. 0 = pinned to the live tail. */
  scrollLine?: number;
  /** Reports measured heights (rows) so the owner can clamp the scroll range. */
  onMeasured?: (heights: { contentHeight: number; containerHeight: number }) => void;
  /** Trackpad/mouse-wheel notch. Omit to disable wheel handling here. */
  onWheel?: (direction: 'up' | 'down') => void;
  /** Message indices whose reasoning block is expanded. Default: collapsed. */
  expandedReasoning?: Set<number>;
  /** Called when the user clicks a reasoning header button. */
  onToggleReasoning?: (index: number) => void;
  /**
   * Absolute 1-based terminal row of the last row available to the clipped
   * container (bottom of the chat pane). Used to derive the container's top
   * row for click mapping instead of assuming the fixed layout height.
   */
  chatBottomRow?: number;
}

export interface ChatRowItem {
  key: string;
  /** Original index into the messages array, or null for stream/error rows. */
  origIdx: number | null;
  /** True when the message renders a clickable reasoning header. */
  reasoningHeader: boolean;
}

/**
 * Map each visible reasoning header to its absolute terminal row so mouse
 * clicks can be matched to it. Children of the column-reverse stack lay out
 * from the container's bottom edge upward, shifted down by `scrollLine`
 * (negative marginBottom), with 1-row gaps between items.
 *
 * The assistant message box renders row 0 = "model" label, row 1 = reasoning
 * header, so the header sits one row below the item's top edge.
 */
export function computeReasoningHeaderRows(
  items: ChatRowItem[],
  heights: Map<string, number>,
  containerTop: number,
  containerHeight: number,
  scrollLine: number,
): Map<number, number> {
  const containerBottom = containerTop + containerHeight - 1;
  const rows = new Map<number, number>();
  let consumed = 0;
  items.forEach((item, j) => {
    const h = heights.get(item.key) ?? 0;
    const bottom = containerBottom + scrollLine - consumed;
    const top = bottom - h + 1;
    if (item.reasoningHeader && item.origIdx !== null) {
      const headerRow = top + 1;
      if (headerRow >= containerTop && headerRow <= containerBottom) {
        rows.set(item.origIdx, headerRow);
      }
    }
    consumed += h + (j === items.length - 1 ? 0 : 1);
  });
  return rows;
}

export function ChatPanel({
  messages,
  partial,
  reasoning,
  generating,
  error,
  scrollLine = 0,
  onMeasured,
  onWheel,
  expandedReasoning,
  onToggleReasoning,
  chatBottomRow,
}: ChatPanelProps) {
  const containerRef = useRef<any>(null);
  const contentRef = useRef<any>(null);
  const outerRef = useRef<any>(null);
  const [outerRows, setOuterRows] = useState<number | null>(null);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;
  const lastMeasuredRef = useRef({ contentHeight: 0, containerHeight: 0 });

  const itemRefs = useRef(new Map<string, any>());
  const itemRefCallbacks = useRef(new Map<string, (el: any) => void>());
  const itemsRef = useRef<ChatRowItem[]>([]);
  const headerRowsRef = useRef(new Map<number, number>());
  const containerWidthRef = useRef(0);
  const toggleRef = useRef(onToggleReasoning);
  toggleRef.current = onToggleReasoning;
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;

  const collectItemRef = (key: string) => {
    let cb = itemRefCallbacks.current.get(key);
    if (!cb) {
      cb = (el: any) => {
        if (el) itemRefs.current.set(key, el);
        else itemRefs.current.delete(key);
      };
      itemRefCallbacks.current.set(key, cb);
    }
    return cb;
  };

  // Children of the column-reverse stack, in JSX order (bottom of screen
  // first): streaming block, error, then messages newest-first. Keys are the
  // original message indices so appending a message never remounts the old
  // ones. The same list drives the reasoning-header row computation.
  const items: ChatRowItem[] = [];
  const nodes: React.ReactNode[] = [];

  if (generating && scrollLine === 0) {
    items.push({ key: 'stream', origIdx: null, reasoningHeader: false });
    nodes.push(
      <Box key="stream" ref={collectItemRef('stream')} flexDirection="column" flexShrink={0}>
        <AssistantBlock>
          {reasoning && (
            <Text color={theme.muted} italic>
              {reasoning}
            </Text>
          )}
          <MarkdownText content={preprocessStreaming(partial) + symbols.cursor} />
        </AssistantBlock>
      </Box>,
    );
  }
  if (error) {
    items.push({ key: 'error', origIdx: null, reasoningHeader: false });
    nodes.push(
      <Box key="error" ref={collectItemRef('error')} flexDirection="column" flexShrink={0}>
        <Text color={theme.failure}>
          {symbols.failure} {error}
        </Text>
      </Box>,
    );
  }
  const messageNodes = messages.map((message, i) => {
    items.push({
      key: `msg-${i}`,
      origIdx: i,
      reasoningHeader: message.role === 'assistant' && !!message.reasoning,
    });
    return (
      <Box key={`msg-${i}`} ref={collectItemRef(`msg-${i}`)} flexDirection="column" flexShrink={0}>
        <MessageView message={message} collapsed={!(expandedReasoning?.has(i) ?? false)} />
      </Box>
    );
  });
  messageNodes.reverse();
  nodes.push(...messageNodes);
  itemsRef.current = items;

  useMouseEvents({
    onWheel: onWheel ? (direction) => wheelRef.current?.(direction) : undefined,
    onClick: ({ x, y }) => {
      // Only clicks inside the chat column count (ToolPanel may sit beside
      // it, and headers are left-aligned); the measured container width
      // bounds the chat column exactly.
      if (x > containerWidthRef.current) return;
      // Exact row first; ±1 tolerance absorbs wrapped borders or a one-row
      // layout drift between the measured map and the actual screen.
      let best: { idx: number; dist: number } | null = null;
      for (const [idx, row] of headerRowsRef.current) {
        const dist = Math.abs(row - y);
        if (dist <= 1 && (!best || dist < best.dist)) best = { idx, dist };
      }
      if (best) toggleRef.current?.(best.idx);
    },
  });

  // Exact scroll math: measure the full content stack vs the clipped viewport
  // after every layout pass, and report changes once (no measure loops).
  // Also measure each stack item to keep the reasoning-header row map fresh.
  useLayoutEffect(() => {
    if (!outerRef.current || !containerRef.current || !contentRef.current) return;
    const outerHeight = measureElement(outerRef.current).height;
    setOuterRows((prev) => (prev === outerHeight ? prev : outerHeight));
    const contentHeight = measureElement(contentRef.current).height;
    const container = measureElement(containerRef.current);
    const containerHeight = container.height;
    containerWidthRef.current = container.width;

    const heights = new Map<string, number>();
    for (const [key, el] of itemRefs.current) {
      if (el) heights.set(key, measureElement(el).height);
    }
    // Prefer the owner-supplied absolute bottom row; fall back to the known
    // layout (TopBar occupies row 1, the scroll banner one row above the
    // container when shown).
    const containerTop =
      chatBottomRow != null
        ? chatBottomRow - containerHeight + 1
        : 2 + (scrollLine > 0 ? 1 : 0);
    headerRowsRef.current = computeReasoningHeaderRows(
      itemsRef.current,
      heights,
      containerTop,
      containerHeight,
      scrollLine,
    );

    const prev = lastMeasuredRef.current;
    if (contentHeight !== prev.contentHeight || containerHeight !== prev.containerHeight) {
      lastMeasuredRef.current = { contentHeight, containerHeight };
      onMeasuredRef.current?.({ contentHeight, containerHeight });
    }
  });

  // Ink 5.2 mis-measures the overflow clip rect of a `flexGrow` +
  // `justifyContent=flex-end` box (computedTop lands on the row above, letting
  // up-overflow bleed over the banner). An explicit height fixes the clip, so
  // self-measure the outer column once and pin the container to it.
  const bannerRows = scrollLine > 0 ? 1 : 0;
  const containerRows = outerRows === null ? undefined : Math.max(1, outerRows - bannerRows);

  return (
    <Box ref={outerRef} flexDirection="column" flexGrow={1} paddingX={1}>
      {scrollLine > 0 && (
        <Text color={theme.primary}>
          ↑ {scrollLine} row{scrollLine === 1 ? '' : 's'} above — Esc to return
        </Text>
      )}
      {/*
        The container is bottom-anchored (flex-end) and clips overflow, so the
        content stack sits with its tail at the bottom edge. Shifting it DOWN
        (negative bottom margin) by scrollLine rows pushes the newest rows past
        the clip edge and reveals older content above — exact for whatever the
        terminal actually rendered, including wrapped lines and code blocks.
        column-reverse keeps the newest message at the visual bottom while the
        children stay chronological. `gap` gives every message the same one-row
        separation regardless of role or inner markdown structure.
      */}
      <Box
        ref={containerRef}
        flexDirection="column"
        justifyContent="flex-end"
        height={containerRows}
        flexGrow={containerRows === undefined ? 1 : 0}
        overflow="hidden"
      >
        <Box
          ref={contentRef}
          flexDirection="column-reverse"
          flexShrink={0}
          gap={1}
          marginBottom={-scrollLine}
        >
          {nodes}
        </Box>
      </Box>
    </Box>
  );
}

function MessageView({ message, collapsed }: { message: ConversationMessage; collapsed: boolean }) {
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Text bold color={theme.primary}>
          you
        </Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }
  if (message.role === 'assistant') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.text}>
          model
        </Text>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning} collapsed={collapsed} />}
        <MarkdownText content={message.content ?? ''} />
      </Box>
    );
  }
  if (message.role === 'system') {
    return (
      <Box flexDirection="column">
        <Text color={theme.muted}>{message.content}</Text>
      </Box>
    );
  }
  // tool
  return (
    <Box flexDirection="column">
      <Text color={theme.muted}>tool result · {message.tool_call_id}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

function ReasoningBlock({ reasoning, collapsed }: { reasoning: string; collapsed: boolean }) {
  return (
    <Box flexDirection="column">
      <Text color={theme.muted} inverse>
        {` thinking ${collapsed ? '[+]' : '[−]'} `}
      </Text>
      {!collapsed && (
        <Text color={theme.muted} italic>
          {reasoning}
        </Text>
      )}
    </Box>
  );
}

function AssistantBlock({ children }: { children: React.ReactNode }) {
  return (
    <Box flexDirection="column">
      <Text bold color={theme.text}>
        model
      </Text>
      {children}
    </Box>
  );
}
