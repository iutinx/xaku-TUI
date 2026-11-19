import { Box, Text } from '@claude-code-kit/ink-renderer';
import { colors } from './theme.js';

export function XakuLogo() {
  return (
    <Box flexDirection="column">
      <Text color={colors.accent}>██╗  ██╗ █████╗ ██╗  ██╗██╗   ██╗</Text>
      <Text color={colors.accent}>  ╚██╗██╔╝██╔══██╗██║ ██╔╝██║   ██║</Text>
      <Text color={colors.accent}>   ╚███╔╝ ███████║█████╔╝ ██║   ██║</Text>
      <Text color={colors.accent}>   ██╔██╗ ██╔══██║██╔═██╗ ██║   ██║</Text>
      <Text color={colors.accent}>  ██╔╝ ██╗██║  ██║██║  ██╗╚██████╔╝</Text>
      <Text color={colors.accent}>  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝</Text>
    </Box>
  );
}
