import { Box, Text } from 'ink';
import { formatSessionLabel, type SessionSummary } from '../model/replay.js';
import { theme } from './theme.js';

export interface SessionPickerProps {
  sessions: SessionSummary[];
  selectedIndex: number;
}

const MAX_VISIBLE = 8;

export function SessionPicker({ sessions, selectedIndex }: SessionPickerProps) {
  if (sessions.length === 0) return null;

  const windowStart = Math.max(0, selectedIndex - MAX_VISIBLE + 1);
  const shown = sessions.slice(windowStart, windowStart + MAX_VISIBLE);
  const lineWidth = Math.max(...shown.map((s) => formatSessionLabel(s).length));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginX={1}>
      <Text bold color={theme.primary}>Replay a session</Text>
      {shown.map((s, i) => {
        const absoluteIndex = windowStart + i;
        const selected = absoluteIndex === selectedIndex;
        return (
          <Text
            key={s.fileName}
            color={selected ? 'black' : 'gray'}
            backgroundColor={selected ? 'cyan' : undefined}
          >
            {(`${absoluteIndex + 1}. ` + formatSessionLabel(s)).padEnd(lineWidth + 4)}
          </Text>
        );
      })}
      <Text dimColor>↑↓ navigate · Enter load · Esc close</Text>
    </Box>
  );
}
