import { Box, Text } from '@claude-code-kit/ink-renderer';
import { StatusIcon } from '@claude-code-kit/ui';
import path from 'node:path';
import {
  splitCollapsed,
  summarizeCollapsed,
  type FileDiff,
  type ToolActivity,
  type ToolActivityStatus,
} from '../tools/activity.js';
import { formatDiffSummary } from './diff.js';
import { colors } from './theme.js';

/** Kit StatusIcon values per activity status. */
function statusIconFor(status: ToolActivityStatus): 'success' | 'error' | 'warning' | 'pending' | 'loading' {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'error';
    case 'denied':
    case 'skipped':
    case 'cancelled':
      return 'warning';
    case 'running':
      return 'loading';
    default:
      return 'pending';
  }
}

function statusWord(status: ToolActivityStatus): string {
  switch (status) {
    case 'awaiting_approval':
      return 'awaiting approval';
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'denied':
      return 'denied by user';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled by user';
  }
}

function durationOf(a: ToolActivity): string {
  return a.durationMs === undefined ? '' : `  ${(a.durationMs / 1000).toFixed(1)}s`;
}

/** Compact one-line argument summary shown next to the tool name. */
function argsLabel(a: ToolActivity, workspace: string): string {
  const raw = a.args.path ?? a.args.command;
  if (typeof raw === 'string') {
    const display = raw.startsWith('/') || path.isAbsolute(raw) ? shortDisplay(raw, workspace) : raw;
    return `${a.toolName} ${display}`;
  }
  return a.toolName;
}

/**
 * Shorten a path for display: workspace-relative when possible, then `~` for
 * home, so long absolute paths never dominate the row.
 */
export function shortDisplay(absPath: string, workspace: string): string {
  const rel = path.relative(workspace, absPath);
  if (rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) return rel;
  const home = process.env.HOME;
  if (home && (absPath === home || absPath.startsWith(home + path.sep))) {
    return '~' + absPath.slice(home.length);
  }
  return absPath;
}

function DiffPreview({ diff }: { diff: FileDiff }) {
  return (
    <Box flexDirection="column" marginLeft={4}>
      {diff.lines.map((line, i) => (
        <Text key={i} wrap="truncate">
          <Text color={line.type === 'add' ? colors.success : line.type === 'del' ? colors.error : colors.dimText}>
            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : '|'}
          </Text>
          <Text color={line.type === 'ctx' ? colors.dimText : undefined}> {line.text}</Text>
        </Text>
      ))}
      {diff.truncated && (
        <Text color={colors.dimText}>… and more lines ({formatDiffSummary(diff)})</Text>
      )}
    </Box>
  );
}

function ActivityRow({
  activity,
  workspace,
  expanded,
}: {
  activity: ToolActivity;
  workspace: string;
  expanded: boolean;
}) {
  const showDetail = expanded || activity.status === 'awaiting_approval' || activity.status === 'failed';
  return (
    <Box flexDirection="column">
      <Box>
        <StatusIcon status={statusIconFor(activity.status)} />
        <Text color={activity.autoApproved ? colors.dimText : undefined} wrap="truncate">
          {' '}{argsLabel(activity, workspace)}
          {durationOf(activity)}
        </Text>
      </Box>

      {!activity.formatValid && (
        <Box marginLeft={4}>
          <Text color={colors.error}>
            ├ format check: ✖ {activity.formatError ?? 'invalid'}
          </Text>
        </Box>
      )}
      {activity.formatValid && showDetail && (
        <Box marginLeft={4}>
          <Text color={colors.dimText}>├ format check: ✔ valid</Text>
        </Box>
      )}

      {activity.error && (
        <Box marginLeft={4}>
          <Text color={colors.error} wrap="truncate">
            └ {activity.label ?? 'error'}: {activity.error}
          </Text>
        </Box>
      )}
      {activity.autoApproved && (
        <Box marginLeft={4}>
          <Text color={colors.dimText}>└ auto-approved</Text>
        </Box>
      )}

      {activity.diff && showDetail && <DiffPreview diff={activity.diff} />}
    </Box>
  );
}

export interface ToolPanelProps {
  activities: ToolActivity[];
  workspace: string;
  compact: boolean;
}

/** Glyph for collapsed summary rows, keyed directly by activity status. */
const SUMMARY_GLYPH: Record<ToolActivityStatus, string> = {
  success: '✔',
  failed: '✖',
  denied: '✖',
  cancelled: '↓',
  skipped: '↓',
  awaiting_approval: '⠋',
  running: '⠋',
};

/**
 * listr2-style tool activity list: status icon, tool + args, format check,
 * duration, and diff previews. Completed rows collapse into per-outcome summary
 * lines when `compact` is on; anything actionable always stays visible.
 */
export function ToolPanel({ activities, workspace, compact }: ToolPanelProps) {
  if (activities.length === 0) return null;

  const { collapsed, visible } = splitCollapsed(activities);
  const shown = compact ? visible : activities;
  const summaries = compact ? summarizeCollapsed(collapsed) : [];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={colors.accentDim}>TOOL ACTIVITY</Text>
      {summaries.map((s) => (
        <Text key={s.status} color={colors.dimText}>
          {SUMMARY_GLYPH[s.status]} {s.count} {statusWord(s.status).replace(' by user', '')}
        </Text>
      ))}
      {shown.map((a) => (
        <ActivityRow key={a.id} activity={a} workspace={workspace} expanded={!compact} />
      ))}
      {compact && collapsed.length > 0 && (
        <Text color={colors.dimText}>[c] expand {collapsed.length} collapsed</Text>
      )}
      {!compact && collapsed.length > 0 && (
        <Text color={colors.dimText}>[c] collapse {collapsed.length} completed</Text>
      )}
    </Box>
  );
}

export { statusWord };
