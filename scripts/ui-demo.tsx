import React from 'react';
import { render, AlternateScreen } from '@claude-code-kit/ink-renderer';
import { ToolPanel } from '../src/ui/ToolPanel.js';
import { computeDiffLines } from '../src/ui/diff.js';
import type { ToolActivity } from '../src/tools/activity.js';

/**
 * Manual visual check for the tool panel: status icons, format-check lines,
 * durations, the write_file diff preview and compact/collapsed summaries.
 *
 * Run: npx tsx scripts/ui-demo.tsx          (expanded)
 *      npx tsx scripts/ui-demo.tsx compact  (collapsed)
 *      npx tsx scripts/ui-demo.tsx failing  (failure + auto-approved rows)
 */
const mode = process.argv[2] ?? '';

const activities: ToolActivity[] = [
  {
    id: 'a1',
    callId: 'call_1',
    toolName: 'read_file',
    args: { path: 'src/app.tsx' },
    status: 'success',
    formatValid: true,
    startedAt: 0,
    durationMs: 400,
    output: 'import { Box } from …',
  },
  {
    id: 'a2',
    callId: 'call_2',
    toolName: 'list_dir',
    args: { path: 'src' },
    status: 'success',
    formatValid: true,
    startedAt: 0,
    durationMs: 120,
    output: 'app.tsx  cli.tsx  config.ts  logger.ts',
  },
  {
    id: 'a3',
    callId: 'call_3',
    toolName: 'write_file',
    args: {
      path: 'src/config.ts',
      content:
        'export const VERSION = "0.2";\nexport const NAME = "xaku";\nexport const AUTHOR = "me";\nexport const DEBUG = true;',
    },
    status: 'awaiting_approval',
    formatValid: true,
    fileState: 'existing',
    diff: computeDiffLines(
      'export const VERSION = "0.1";\nexport const NAME = "xaku";\nexport const AUTHOR = "me";',
      'export const VERSION = "0.2";\nexport const NAME = "xaku";\nexport const AUTHOR = "me";\nexport const DEBUG = true;',
    ),
  },
];

if (mode === 'failing') {
  activities.push(
    {
      id: 'a4',
      callId: 'call_4',
      toolName: 'read_file',
      args: { path: '/etc/passwd' },
      status: 'failed',
      formatValid: true,
      startedAt: 0,
      durationMs: 30,
      error: 'Access denied: path outside workspace',
      label: 'blocked',
    },
    {
      id: 'a5',
      callId: 'call_5',
      toolName: 'query_db',
      args: { path: 'data.sqlite', query: 'select * from events' },
      status: 'success',
      formatValid: true,
      autoApproved: true,
      startedAt: 0,
      durationMs: 2100,
      trimmed: true,
    },
    {
      id: 'a6',
      callId: 'call_6',
      toolName: 'nonsense_tool',
      args: {},
      status: 'failed',
      formatValid: false,
      formatError: 'Unknown tool: nonsense_tool',
      error: 'Unknown tool: nonsense_tool',
      label: 'unknown_tool',
    },
    {
      id: 'a7',
      callId: 'call_7',
      toolName: 'run_shell',
      args: { command: 'sleep 10' },
      status: 'cancelled',
      formatValid: true,
      startedAt: 0,
      durationMs: 3200,
    },
    {
      id: 'a8',
      callId: 'call_8',
      toolName: 'write_file',
      args: { path: 'notes.md' },
      status: 'denied',
      formatValid: true,
    },
  );
}

function Demo() {
  return (
    <AlternateScreen mouseTracking={false}>
      <ToolPanel
        activities={activities}
        workspace={process.cwd()}
        compact={mode === 'compact'}
      />
    </AlternateScreen>
  );
}

const { waitUntilExit } = render(<Demo />);
void waitUntilExit;
