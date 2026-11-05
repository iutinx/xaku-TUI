import { Box, Text } from 'ink';
import React from 'react';
import type { ConversationMessage } from '../model/session.js';
import { symbols, theme } from './theme.js';
import { MarkdownText, preprocessStreaming } from './MarkdownText.js';
import { computeMessageWindow, MAX_VISIBLE_MESSAGES } from './useScrollback.js';

export interface ChatPanelProps {
  messages: ConversationMessage[];
  partial: string;
  reasoning: string;
  generating: boolean;
  error: string | null;
  /** Messages scrolled up from the bottom. 0 = pinned to latest. */
  scrollOffset?: number;
}

export function ChatPanel({ messages, partial, reasoning, generating, error, scrollOffset = 0 }: ChatPanelProps) {
  const { start, end } = computeMessageWindow(messages.length, scrollOffset, MAX_VISIBLE_MESSAGES);
  const visible = messages.slice(start, end);
  const belowCount = messages.length - end;
  const isScrolled = scrollOffset > 0;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {isScrolled ? (
        <Text color={theme.primary}>
          ↑ {start} earlier · {belowCount} newer — Esc to return
        </Text>
      ) : start > 0 ? (
        <Text color={theme.muted}>… {start} earlier messages (in session log · ↑ to scroll)</Text>
      ) : null}
      {visible.map((m, i) => (
        <MessageView key={start + i} message={m} />
      ))}
      {generating && !isScrolled && (
        <AssistantBlock>
          {reasoning && (
            <Text color={theme.muted} italic>
              {reasoning}
            </Text>
          )}
          <MarkdownText content={preprocessStreaming(partial) + symbols.cursor} />
        </AssistantBlock>
      )}
      {error && (
        <Box flexDirection="column" marginY={1}>
          <Text color={theme.failure}>{symbols.failure} {error}</Text>
        </Box>
      )}
    </Box>
  );
}

function MessageView({ message }: { message: ConversationMessage }) {
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold color={theme.primary}>
          you
        </Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }
  if (message.role === 'assistant') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold color={theme.text}>
          model
        </Text>
        <MarkdownText content={message.content ?? ''} />
      </Box>
    );
  }
  if (message.role === 'system') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color={theme.muted}>{message.content}</Text>
      </Box>
    );
  }
  // tool
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={theme.muted}>tool result · {message.tool_call_id}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

function AssistantBlock({ children }: { children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={theme.text}>
        model
      </Text>
      {children}
    </Box>
  );
}
