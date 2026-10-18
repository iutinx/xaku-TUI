import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { getFilteredCommands, type CommandDef } from '../commands.js';
import { CommandMenu } from './CommandMenu.js';
import { symbols } from './theme.js';

export interface InputLineProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputLine({ value, onChange, onSubmit, disabled, placeholder }: InputLineProps) {
  const [cursor, setCursor] = useState(value.length);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Keep cursor in bounds when value changes from props.
  const safeCursor = Math.min(Math.max(0, cursor), value.length);

  // The menu is in "command name" mode: starts with '/', no arguments typed yet.
  const query = value.startsWith('/') && !/\s/.test(value) ? value.slice(1) : null;
  const filtered = query === null ? [] : getFilteredCommands(query);
  const menuVisible =
    query !== null && filtered.length > 0 && !dismissed && !disabled;
  const safeSelected = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (query === null) setDismissed(false);
  }, [query]);

  function acceptCommand(cmd: CommandDef) {
    onChange(`/${cmd.name} `);
    setCursor(cmd.name.length + 2);
  }

  useInput(
    (input, key) => {
      // Command menu navigation takes priority over line editing.
      if (menuVisible) {
        if (key.upArrow) {
          setSelectedIndex(Math.max(0, safeSelected - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedIndex(Math.min(filtered.length - 1, safeSelected + 1));
          return;
        }
        if (key.escape) {
          setDismissed(true);
          return;
        }
        if (key.tab) {
          const cmd = filtered[safeSelected];
          if (cmd) acceptCommand(cmd);
          return;
        }
        if (key.return) {
          const cmd = filtered[safeSelected];
          if (cmd && cmd.name === query) {
            // Exact command typed — run it normally.
            onSubmit(value);
            setCursor(0);
          } else if (cmd) {
            // Partial match — complete the command first.
            acceptCommand(cmd);
          }
          return;
        }
      }

      if (key.return) {
        onSubmit(value);
        setCursor(0);
        return;
      }

      // Standard readline control shortcuts.
      if (key.ctrl) {
        if (input === 'w') {
          // Delete word backward.
          const before = value.slice(0, safeCursor);
          const after = value.slice(safeCursor);
          const trimmed = before.replace(/\S+\s*$/, '');
          onChange(trimmed + after);
          setCursor(trimmed.length);
          return;
        }
        if (input === 'u') {
          // Clear the whole line.
          onChange('');
          setCursor(0);
          return;
        }
        if (input === 'a') {
          setCursor(0);
          return;
        }
        if (input === 'e') {
          setCursor(value.length);
          return;
        }
        return;
      }

      if (key.backspace || key.delete) {
        // macOS terminals send \x7f (DEL) for the backspace key, which Ink
        // surfaces as key.delete — treat plain delete/backspace as
        // backward-delete. Option+backspace (\x1b\x7f) deletes the previous word.
        if (key.delete && key.meta) {
          const before = value.slice(0, safeCursor);
          const after = value.slice(safeCursor);
          const trimmed = before.replace(/\S+\s*$/, '');
          onChange(trimmed + after);
          setCursor(trimmed.length);
        } else if (safeCursor > 0) {
          const next = value.slice(0, safeCursor - 1) + value.slice(safeCursor);
          onChange(next);
          setCursor(safeCursor - 1);
        }
        return;
      }

      if (key.leftArrow) {
        setCursor(Math.max(0, safeCursor - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, safeCursor + 1));
        return;
      }
      // Printable text, single keystroke or coalesced chunk (paste, key repeat).
      // Apply character-by-character so bundled DEL/BS bytes act as backspaces
      // instead of being inserted as literal control characters.
      if (input && !key.meta) {
        let cur = value;
        let pos = safeCursor;
        for (const ch of input) {
          const code = ch.charCodeAt(0);
          if (ch === '\x7f' || ch === '\b') {
            if (pos > 0) {
              cur = cur.slice(0, pos - 1) + cur.slice(pos);
              pos -= 1;
            }
          } else if (code === 13 || code === 10 || code === 27) {
            // Skip newlines and stray escape bytes inside a chunk.
          } else if (code === 9) {
            // Skip tabs.
          } else if (code >= 32) {
            cur = cur.slice(0, pos) + ch + cur.slice(pos);
            pos += 1;
          }
        }
        onChange(cur);
        setCursor(pos);
      }
    },
    { isActive: !disabled },
  );

  const before = value.slice(0, safeCursor);
  const cursorChar = value[safeCursor] ?? ' ';
  const after = value.slice(safeCursor + 1);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {menuVisible && <CommandMenu commands={filtered} selectedIndex={safeSelected} />}
      <Box height={1} flexShrink={0} paddingX={1}>
        <Text bold>{'> '}</Text>
        {value.length === 0 ? (
          <Text color={disabled ? 'yellow' : 'gray'}>{placeholder ?? symbols.cursor}</Text>
        ) : (
          <Text dimColor={disabled}>
            {before}
            <Text backgroundColor="white" color="black">
              {cursorChar}
            </Text>
            {after}
          </Text>
        )}
      </Box>
    </Box>
  );
}
