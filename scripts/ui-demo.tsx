import React from 'react';
import { render } from 'ink';
import { ToolPanel } from '../src/ui/ToolPanel.js';
import { computeDiffLines } from '../src/ui/diff.js';
import type { ToolActivity } from '../src/ui/ToolActivity.js';

// Manual visual check for Phase 10 UI polish: write_file diff preview,
// compact/collapsed tool states. Run: npx tsx scripts/ui-demo.tsx
const activities: ToolActivity[] = [
  {
    id: 'activity_1',
    toolCallId: 'call_1',
    toolName: 'read_file',
    arguments: { path: 'src/app.tsx' },
    status: 'success',
    result: 'import { Box, useInput } from ink;…',
    duration: 0.4,
  },
  {
    id: 'activity_2',
    toolCallId: 'call_2',
    toolName: 'list_dir',
    arguments: { path: 'src' },
    status: 'success',
    result: 'app.tsx cli.tsx config.ts logger.ts',
    duration: 0.1,
  },
  {
    id: 'activity_3',
    toolCallId: 'call_3',
    toolName: 'write_file',
    arguments: { path: 'src/config.ts', content: 'export const VERSION = "0.2";\nexport const NAME = "xaku";' },
    status: 'awaiting_approval',
    preview: 'path: src/config.ts\n+1 -1 ~1',
    fileState: 'existing',
    diff: computeDiffLines(
      'export const VERSION = "0.1";\nexport const NAME = "xaku";\nexport const AUTHOR = "me";',
      'export const VERSION = "0.2";\nexport const NAME = "xaku";\nexport const AUTHOR = "me";\nexport const DEBUG = true;',
    ),
  },
];

const app = (
  <ToolPanel activities={activities} compact={process.argv[2] === 'compact'} />
);

const { waitUntilExit } = render(app);
void waitUntilExit;
