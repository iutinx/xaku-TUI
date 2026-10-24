import { Box, Text } from 'ink';
import React from 'react';
import type { ConversationMessage } from '../model/session.js';
import { symbols, theme } from './theme.js';
import { MarkdownText } from './MarkdownText.js';

export interface ChatPanelProps {
  messages: ConversationMessage[];
  partial: string;
  reasoning: string;
  generating: boolean;
  error: string | null;
}

const MAX_VISIBLE_MESSAGES = 12;

export function ChatPanel({ messages, partial, reasoning, generating, error }: ChatPanelProps) {
  const hiddenCount = Math.max(0, messages.length - MAX_VISIBLE_MESSAGES);
  const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {hiddenCount > 0 && (
        <Text color={theme.muted}>… {hiddenCount} earlier messages (in session log)</Text>
      )}
      {visible.map((m, i) => (
        <MessageView key={hiddenCount + i} message={m} />
      ))}
      {generating && (
        <AssistantBlock>
          {reasoning && (
            <Text color={theme.muted} italic>
              {reasoning}
            </Text>
          )}
          {partial}
          <Text backgroundColor="white" color="black">
            {symbols.cursor}
          </Text>
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
      <Text>{children}</Text>
    </Box>
  );
}
