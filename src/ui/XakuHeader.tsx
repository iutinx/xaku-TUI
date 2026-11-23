import { useEffect, useState } from 'react';
import { Box, Text } from '@claude-code-kit/ink-renderer';
import { colors } from './theme.js';
import { abbreviateHome } from '../tools/workspace.js';

export interface XakuHeaderProps {
  model: string;
  contextTokens: number;
  maxContextTokens: number;
  toolSuccess: number;
  toolFail: number;
  gitBranch: string | null;
  /** Absolute workspace path, shown abbreviated; click to copy. */
  workspace?: string;
  onCopyWorkspace?: () => void;
  /** Timestamp of the last successful copy; drives the transient "copied" flash. */
  copiedAt?: number;
  isGenerating?: boolean;
  showThinking?: boolean;
  hasThinking?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getContextColor(percent: number): string {
  if (percent >= 80) return colors.highlight;
  if (percent >= 60) return colors.accent;
  return colors.accentBright;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** How long the "copied" confirmation stays on screen. */
const COPIED_FLASH_MS = 1500;

/**
 * Keep at most `max` trailing characters, marking the elision point so a long
 * path still ends recognisably (the leaf directory is the useful part).
 */
export function truncatePath(text: string, max: number): string {
  if (max <= 1) return text.slice(-max);
  if (text.length <= max) return text;
  return '…' + text.slice(-(max - 1));
}

export function XakuHeader({
  model,
  contextTokens,
  maxContextTokens,
  toolSuccess,
  toolFail,
  gitBranch,
  workspace,
  onCopyWorkspace,
  copiedAt = 0,
  isGenerating = false,
  showThinking = false,
  hasThinking = false,
}: XakuHeaderProps) {
  const percent = Math.round((contextTokens / maxContextTokens) * 100);
  const barWidth = 10;
  const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
  const filledBar = '█'.repeat(filled);
  const emptyBar = '░'.repeat(barWidth - filled);
  const contextColor = getContextColor(percent);

  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    if (!copiedAt) return;
    setFlashVisible(true);
    const timer = setTimeout(() => setFlashVisible(false), COPIED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);

  // Budget the workspace label so the header never pushes the model/context
  // segments off screen on narrow terminals.
  const workspaceLabel = workspace ? abbreviateHome(workspace) : '';
  const workspaceShown = flashVisible ? 'copied ✓' : truncatePath(workspaceLabel, 34);

  const workspaceNode = workspace ? (
    <Box
      onClick={
        onCopyWorkspace
          ? (event) => {
              event.stopImmediatePropagation();
              onCopyWorkspace();
            }
          : undefined
      }
    >
      <Text color={flashVisible ? colors.success : colors.accentBright} dimColor={!onCopyWorkspace}>
        ⌂ {workspaceShown}
      </Text>
      {onCopyWorkspace && !flashVisible && (
        <Text color={colors.dimText}> (click)</Text>
      )}
    </Box>
  ) : null;

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box flexDirection="row" gap={2}>
        {isGenerating ? (
          <Text color={colors.accent}>◐</Text>
        ) : (
          <Text color={colors.accent}>◉</Text>
        )}
        <Text color={colors.accent}>{model}</Text>
        <Text>
          ctx [
          <Text color={contextColor}>{filledBar}</Text>
          <Text color={colors.accentDim}>{emptyBar}</Text>
          ] {percent}%
        </Text>
        <Text color={colors.dimText}>{formatTokens(contextTokens)} tokens</Text>
        {(toolSuccess > 0 || toolFail > 0) && (
          <Box flexDirection="row" gap={1}>
            <Text color={colors.success}>✓ {toolSuccess}</Text>
            {toolFail > 0 && <Text color={colors.error}>✖ {toolFail}</Text>}
          </Box>
        )}
      </Box>
      <Box flexDirection="row" gap={2}>
        {hasThinking && (
          <Text dimColor>
            ^T {showThinking ? 'hide' : 'show'} thinking
          </Text>
        )}
        {workspaceNode}
        {gitBranch && <Text color={colors.accentBright}> {gitBranch}</Text>}
      </Box>
    </Box>
  );
}

export { SPINNER_FRAMES };
