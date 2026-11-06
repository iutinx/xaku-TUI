import { Box, Text } from 'ink';
import { symbols, theme } from './theme.js';
import { useSpinnerFrame } from './useSpinner.js';

export interface StatsBarProps {
  connected: boolean;
  checking: boolean;
  generating: boolean;
  tokensPerSecond: number;
  contextTokens: number;
  toolSuccess: number;
  toolFail: number;
}

export function StatsBar({
  connected,
  checking,
  generating,
  tokensPerSecond,
  contextTokens,
  toolSuccess,
  toolFail,
}: StatsBarProps) {
  const frame = useSpinnerFrame(generating || checking);

  const spinner = generating ? symbols.spinner[frame] : symbols.success;

  return (
    <Box height={1} flexShrink={0} paddingX={1}>
      <Text color={generating ? theme.spinner : theme.success}>
        {spinner} {generating ? 'generating' : 'ready'}
      </Text>
      <Text color={theme.muted}> · </Text>
      <Text>{tokensPerSecond.toFixed(1)} tok/s</Text>
      <Text color={theme.muted}> · </Text>
      <Text>context {contextTokens.toLocaleString()}</Text>
      <Text color={theme.muted}> · </Text>
      <Text>
        tools {symbols.success} {toolSuccess}  {symbols.failure} {toolFail}
      </Text>
      <Box flexGrow={1} />
      {checking ? (
        <Text color={theme.warning}>{symbols.spinner[frame]} checking ollama…</Text>
      ) : (
        <Text color={connected ? theme.success : theme.failure}>
          {connected ? `${symbols.success} ollama connected` : `${symbols.failure} ollama disconnected`}
        </Text>
      )}
    </Box>
  );
}
