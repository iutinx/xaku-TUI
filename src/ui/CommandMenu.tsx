import { Box, Text } from 'ink';
import type { CommandDef } from '../commands/index.js';

export interface CommandMenuProps {
  commands: CommandDef[];
  selectedIndex: number;
}

const MAX_VISIBLE = 8;

export function CommandMenu({ commands, selectedIndex }: CommandMenuProps) {
  if (commands.length === 0) return null;

  // Scroll the window so the selected row stays visible.
  const windowStart = Math.max(0, selectedIndex - MAX_VISIBLE + 1);
  const shown = commands.slice(windowStart, windowStart + MAX_VISIBLE);

  const lefts = shown.map((c) => `/${c.name}${c.hint ? ' ' + c.hint : ''}`);
  const leftWidth = Math.max(...lefts.map((l) => l.length)) + 2;
  const lines = shown.map((c, i) => (lefts[i] + ' ').padEnd(leftWidth) + c.description);
  const lineWidth = Math.max(...lines.map((l) => l.length));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginX={1}>
      {lines.map((line, i) => {
        const absoluteIndex = windowStart + i;
        const selected = absoluteIndex === selectedIndex;
        return (
          <Text
            key={shown[i].name}
            color={selected ? 'black' : 'gray'}
            backgroundColor={selected ? 'cyan' : undefined}
          >
            {line.padEnd(lineWidth)}
          </Text>
        );
      })}
      <Text dimColor>↑↓ navigate · Tab complete · Enter run · Esc close</Text>
    </Box>
  );
}
