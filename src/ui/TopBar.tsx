import { Box, Text } from 'ink';
import { symbols, theme } from './theme.js';

export interface TopBarProps {
  model: string;
  temperature: number;
  systemPrompt: string | null;
  autoApprove?: string;
}

export function TopBar({ model, temperature, systemPrompt, autoApprove }: TopBarProps) {
  return (
    <Box height={1} flexShrink={0}>
      <Text bold color={theme.primary}>
        xaku
      </Text>
      <Text color={theme.muted}> · </Text>
      <Text>{model}</Text>
      <Text color={theme.muted}> · temp </Text>
      <Text>{temperature.toFixed(1)}</Text>
      {systemPrompt && (
        <>
          <Text color={theme.muted}> · </Text>
          <Text color={theme.success}>{symbols.success} system set</Text>
        </>
      )}
      {autoApprove && autoApprove !== 'none' && (
        <>
          <Text color={theme.muted}> · </Text>
          <Text color={theme.warning}>auto:{autoApprove}</Text>
        </>
      )}
    </Box>
  );
}
