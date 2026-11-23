import { Box, Text } from '@claude-code-kit/ink-renderer';
import { XakuLogo } from './XakuLogo.js';
import { colors } from './theme.js';

interface XakuWelcomeProps {
  model: string;
  connected: boolean;
  temperature: number;
  /** Abbreviated launch directory. */
  workspace?: string;
}

export function XakuWelcome({ model, connected, temperature, workspace }: XakuWelcomeProps) {
  return (
    <Box flexDirection="column" gap={1} marginTop={1} marginLeft={1}>
      <XakuLogo />
      
      <Box flexDirection="column" gap={0} marginTop={1}>
        <Box>
          <Text color={colors.accentBright} bold>xaku</Text>
          <Text color={colors.dimText}> — terminal workspace for local LLMs</Text>
        </Box>
        
        <Box gap={2} marginTop={1}>
          {connected ? (
            <Text color={colors.success}>● connected</Text>
          ) : (
            <Text color={colors.error}>● disconnected</Text>
          )}
          <Text color={colors.dimText}>model: </Text>
          <Text color={colors.accentBright}>{model || 'auto'}</Text>
          <Text color={colors.dimText}>· temp {temperature.toFixed(1)}</Text>
        </Box>

        {workspace && (
          <Box gap={1}>
            <Text color={colors.dimText}>⌂ workspace:</Text>
            <Text color={colors.accentBright}>{workspace}</Text>
          </Box>
        )}
        
        <Box flexDirection="column" gap={0} marginTop={1}>
          <Text color={colors.dimText}>Quick start:</Text>
          <Text color={colors.dimText}>  /model — switch model</Text>
          <Text color={colors.dimText}>  /temperature — change temperature</Text>
          <Text color={colors.dimText}>  /clear — reset conversation</Text>
          <Text color={colors.dimText}>  /system — set system prompt</Text>
        </Box>
      </Box>
    </Box>
  );
}
