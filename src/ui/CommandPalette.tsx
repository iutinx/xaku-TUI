import { Box, Text, useInput } from '@claude-code-kit/ink-renderer';
import type { CommandDef } from '../commands/index.js';
import { colors } from './theme.js';

export interface CommandPaletteProps {
  isOpen: boolean;
  suggestions: CommandDef[];
  selectedIndex: number;
  onMove: (delta: number) => void;
  onSelect: (cmd: CommandDef) => void;
  onDismiss: () => void;
  columns: number;
}

const MAX_VISIBLE = 6;

/**
 * First index of the visible window, chosen so `selectedIndex` stays on screen.
 * Without this the list always rendered suggestions[0..5], so once more than
 * MAX_VISIBLE commands were registered the cursor could move onto rows that were
 * never painted and select a command the user could not see.
 */
export function windowStart(total: number, selectedIndex: number, visible = MAX_VISIBLE): number {
  if (total <= visible) return 0;
  if (selectedIndex < visible - 1) return 0;
  if (selectedIndex >= total - 1) return total - visible;
  return selectedIndex - (visible - 2);
}

export function CommandPalette({
  isOpen,
  suggestions,
  selectedIndex,
  onMove,
  onSelect,
  onDismiss,
  columns,
}: CommandPaletteProps) {
  useInput((_input, key, event) => {
    if (!isOpen || suggestions.length === 0) return;
    if (key.upArrow) {
      event.stopImmediatePropagation();
      onMove(-1);
      return;
    }
    if (key.downArrow) {
      event.stopImmediatePropagation();
      onMove(1);
      return;
    }
    if (key.return || key.tab) {
      event.stopImmediatePropagation();
      onSelect(suggestions[selectedIndex]!);
      return;
    }
    if (key.escape) {
      event.stopImmediatePropagation();
      onDismiss();
      return;
    }
  });

  if (!isOpen || suggestions.length === 0) return null;

  const start = windowStart(suggestions.length, selectedIndex);
  const visible = suggestions.slice(start, start + MAX_VISIBLE);
  const nameColWidth = Math.min(
    Math.max(...visible.map((s) => s.name.length)) + 1,
    18,
  );
  const descStart = 2 + 1 + nameColWidth + 1;
  const descWidth = Math.max(10, columns - descStart - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.accent}
      paddingX={1}
      marginX={1}
    >
      {start > 0 && (
        <Text dimColor> ↑ {start} above</Text>
      )}
      {visible.map((cmd, i) => {
        const absolute = start + i;
        const focused = absolute === selectedIndex;
        const name = `/${cmd.name}`;
        const nameCell = name.padEnd(nameColWidth);
        const hint = cmd.hint ? ` ${cmd.hint}` : '';
        const rawDesc = cmd.description;
        const maxDesc = descWidth - hint.length;
        const desc =
          rawDesc.length > maxDesc
            ? rawDesc.slice(0, Math.max(0, maxDesc - 1)) + '…'
            : rawDesc;
        return (
          <Box key={cmd.name}>
            <Text color={focused ? colors.accent : undefined}>
              {focused ? '❯' : ' '}
            </Text>
            <Text color=" "> </Text>
            <Text
              color={focused ? colors.accent : undefined}
              bold={focused}
            >
              {nameCell}
            </Text>
            <Text dimColor>{` ${desc}`}</Text>
            {hint && <Text color={colors.accent} dimColor>{hint}</Text>}
          </Box>
        );
      })}
      {start + visible.length < suggestions.length && (
        <Text dimColor> ↓ {suggestions.length - start - visible.length} more</Text>
      )}
    </Box>
  );
}
