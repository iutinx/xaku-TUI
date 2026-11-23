import React from 'react';
import { render, Box, Text } from 'ink';
import { TopBar } from '../src/ui/TopBar.js';
import { StatusLine } from '../src/ui/StatusLine.js';
import { Banner } from '../src/ui/Banner.js';
import { ToolPanel } from '../src/ui/ToolPanel.js';
import { theme } from '../src/ui/theme.js';
import type { ToolActivity } from '../src/ui/ToolActivity.js';

function Demo() {
  const activities: ToolActivity[] = [
    {
      id: '1',
      toolCallId: 'call_1',
      toolName: 'read_file',
      arguments: { path: 'README.md' },
      status: 'running',
      preview: 'Reading file contents...',
    },
    {
      id: '2',
      toolCallId: 'call_2',
      toolName: 'list_dir',
      arguments: { path: '.' },
      status: 'success',
      result: '10 files',
      duration: 0.3,
      preview: 'Listing directory...',
    },
  ];

  return (
    <Box flexDirection="column" height={40}>
      <Banner />
      <Box height={1} />
      <TopBar
        model="qwen3:4b"
        temperature={0.7}
        systemPrompt="You are a helpful assistant."
        contextTokens={58000}
        maxContextTokens={128000}
        generatedTokens={12345}
        toolSuccess={3}
        toolFail={1}
        connected={true}
        gitBranch="main"
        generating={true}
      />
      <Box height={1} />
      <StatusLine
        generating={true}
        hasToolPrompt={true}
        pendingTools={1}
        generatedTokens={12345}
        elapsedMs={5200}
      />
      <Box height={1} />
      <ToolPanel activities={activities} pendingIds={['1']} />
      <Box height={1} />
      <Box flexDirection="column" paddingX={2}>
        <Text color={theme.textDim}>
          This demo shows the new UI rebrand with:
        </Text>
        <Text color={theme.textDim}>
          • Animated gradient banner
        </Text>
        <Text color={theme.textDim}>
          • Powerline-style top bar with context progress
        </Text>
        <Text color={theme.textDim}>
          • Status line with verb cycling
        </Text>
        <Text color={theme.textDim}>
          • Card-based tool panel
        </Text>
        <Text> </Text>
        <Text color={theme.primary}>
          Press Ctrl+C to exit
        </Text>
      </Box>
    </Box>
  );
}

render(<Demo />, { exitOnCtrlC: true });
