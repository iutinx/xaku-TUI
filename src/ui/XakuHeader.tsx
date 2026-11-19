import { Box, Text } from '@claude-code-kit/ink-renderer';
import { colors } from './theme.js';

export interface XakuHeaderProps {
  model: string;
  contextTokens: number;
  maxContextTokens: number;
  toolSuccess: number;
  toolFail: number;
  gitBranch: string | null;
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

export function XakuHeader({
  model,
  contextTokens,
  maxContextTokens,
  toolSuccess,
  toolFail,
  gitBranch,
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
        {gitBranch && <Text color={colors.accentBright}> {gitBranch}</Text>}
      </Box>
    </Box>
  );
}

export { SPINNER_FRAMES };
