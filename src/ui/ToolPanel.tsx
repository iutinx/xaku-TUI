import { Box, Text } from 'ink';
import type { ToolActivity, ToolActivityStatus } from './ToolActivity.js';
import { formatDiffSummary, type DiffLineType, type DiffResult } from './diff.js';
import { symbols, theme } from './theme.js';

export interface ToolPanelProps {
  activities: ToolActivity[];
  compact?: boolean;
  /** Activity ids awaiting approval in the current batch (order = 1-9 hotkeys). */
  pendingIds?: string[];
  /** Activity id focused for individual review, if any. */
  focusedId?: string | null;
}

const TERMINAL_STATUSES: ToolActivityStatus[] = ['success', 'denied', 'skipped', 'cancelled'];

const COMPACT_LABELS: Record<string, string> = {
  success: 'succeeded',
  denied: 'denied',
  skipped: 'skipped',
  cancelled: 'cancelled',
};

export function ToolPanel({ activities, compact = false, pendingIds = [], focusedId = null }: ToolPanelProps) {
  if (activities.length === 0) {
    return null;
  }

  const isTerminal = (a: ToolActivity) => TERMINAL_STATUSES.includes(a.status);
  const collapsed = compact ? activities.filter(isTerminal) : [];
  const expanded = compact ? activities.filter((a) => !isTerminal(a)) : activities;

  const groups = new Map<ToolActivityStatus, number>();
  for (const a of collapsed) {
    groups.set(a.status, (groups.get(a.status) ?? 0) + 1);
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderLeft={true} borderColor="gray" paddingLeft={1} flexGrow={1}>
      <Text bold color={theme.primary}>
        Tool Activity
      </Text>
      {expanded.map((activity) => (
        <ToolActivityView
          key={activity.id}
          activity={activity}
          pendingIndex={pendingIds.indexOf(activity.id)}
          focused={activity.id === focusedId}
        />
      ))}
      {collapsed.length > 0 && <CompactSummary groups={groups} />}
      {pendingIds.length > 0 && <BatchHint count={pendingIds.length} focused={focusedId !== null} />}
      {!compact && activities.some(isTerminal) && (
        <Box marginTop={1}>
          <Text color={theme.muted}>[c] collapse {activities.filter(isTerminal).length} completed</Text>
        </Box>
      )}
    </Box>
  );
}

function BatchHint({ count, focused }: { count: number; focused: boolean }) {
  let text: string;
  if (focused) {
    text = '[a] approve  [d] deny  [Esc] back to batch';
  } else if (count === 1) {
    text = '[a] approve  [d] deny  [t] auto-approve';
  } else {
    text = `[a] approve all  [d] deny all  [1-${Math.min(count, 9)}] review  [t] auto-approve`;
  }
  return (
    <Box marginTop={1}>
      <Text color={theme.primary}>{text}</Text>
    </Box>
  );
}

function CompactSummary({ groups }: { groups: Map<ToolActivityStatus, number> }) {
  const total = [...groups.values()].reduce((sum, n) => sum + n, 0);
  return (
    <Box flexDirection="column" marginTop={1}>
      {[...groups.entries()].map(([status, count]) => (
        <Text key={status} color={getStatusColor(status)}>
          {getStatusIcon(status)} {count} {COMPACT_LABELS[status]}
        </Text>
      ))}
      <Text color={theme.muted}>[c] expand {total} collapsed</Text>
    </Box>
  );
}

function ToolActivityView({
  activity,
  pendingIndex = -1,
  focused = false,
}: {
  activity: ToolActivity;
  pendingIndex?: number;
  focused?: boolean;
}) {
  const icon = getStatusIcon(activity.status);
  const iconColor = getStatusColor(activity.status);
  
  const argsStr = Object.entries(activity.arguments)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  
  const durationStr = activity.duration !== undefined ? ` ${activity.duration.toFixed(1)}s` : '';
  const badge = pendingIndex >= 0 ? `[${pendingIndex + 1}] ` : '';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        {focused ? (
          <Text backgroundColor="cyan" color="black" bold>
            {badge}
            {icon} {activity.toolName} {argsStr}
            {durationStr}
          </Text>
        ) : (
          <Text color={iconColor}>
            {badge}
            {icon} {activity.toolName} {argsStr}
            {durationStr}
          </Text>
        )}
      </Box>
      
      {activity.validationError && (
        <Box marginLeft={2}>
          <Text color={theme.muted}>
            {symbols.treeBranch} format check: {symbols.failure} {activity.validationError}
          </Text>
        </Box>
      )}
      
      {activity.status === 'awaiting_approval' && (activity.diff || activity.preview) && (
        <Box flexDirection="column" marginLeft={2}>
          {activity.diff ? (
            <>
              <Text color={theme.muted}>
                {symbols.treeLast}{' '}
                {activity.fileState === 'new' ? '' : 'diff: '}
                {formatDiffSummary(activity.diff, activity.fileState === 'new')}
              </Text>
              <DiffView diff={activity.diff} />
            </>
          ) : (
            <>
              <Text color={theme.muted}>{symbols.treeLast} preview:</Text>
              <Box marginLeft={2}>
                <Text dimColor>
                  {activity.fileState === 'too-large'
                    ? `${activity.preview}\n[existing file too large to diff]`
                    : activity.preview}
                </Text>
              </Box>
            </>
          )}
        </Box>
      )}
      
      {activity.autoApproved && (
        <Box marginLeft={2}>
          <Text color={theme.warning}>
            {symbols.treeLast} auto-approved
          </Text>
        </Box>
      )}

      {activity.status === 'success' && activity.result && (
        <Box marginLeft={2}>
          <Text color={theme.muted}>
            {symbols.treeLast} result: {truncate(activity.result, 200)}
          </Text>
        </Box>
      )}
      
      {activity.status === 'failed' && activity.error && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.failure}>
            {symbols.treeLast} {activity.errorLabel}: {activity.error}
          </Text>
          <Box marginTop={1}>
            <Text color={theme.primary}>
              [f] fix  [s] skip  [r] retry
            </Text>
          </Box>
        </Box>
      )}
      
      {activity.status === 'denied' && (
        <Box marginLeft={2}>
          <Text color={theme.warning}>
            {symbols.treeLast} denied by user
          </Text>
        </Box>
      )}
      
      {activity.status === 'skipped' && (
        <Box marginLeft={2}>
          <Text color={theme.warning}>
            {symbols.treeLast} skipped
          </Text>
        </Box>
      )}

      {activity.status === 'cancelled' && (
        <Box marginLeft={2}>
          <Text color={theme.warning}>
            {symbols.treeLast} cancelled by user
          </Text>
        </Box>
      )}
    </Box>
  );
}

const DIFF_GUTTER: Record<DiffLineType, string> = { add: '+', del: '-', ctx: '|' };
const DIFF_COLOR: Record<DiffLineType, string> = {
  add: theme.success,
  del: theme.failure,
  ctx: theme.muted,
};

function DiffView({ diff }: { diff: DiffResult }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {diff.lines.map((line, i) => (
        <Text key={i} color={DIFF_COLOR[line.type]}>
          {DIFF_GUTTER[line.type]} {line.text}
        </Text>
      ))}
      {diff.truncated > 0 && (
        <Text color={theme.muted}>… and {diff.truncated} more lines</Text>
      )}
    </Box>
  );
}

function getStatusIcon(status: ToolActivityStatus): string {
  switch (status) {
    case 'validating':
    case 'awaiting_approval':
    case 'approved':
    case 'running':
      return symbols.spinner[0];
    case 'success':
      return symbols.success;
    case 'failed':
    case 'denied':
      return symbols.failure;
    case 'skipped':
      return symbols.skipped;
    case 'cancelled':
      return symbols.skipped;
  }
}

function getStatusColor(status: ToolActivityStatus): string {
  switch (status) {
    case 'validating':
    case 'awaiting_approval':
    case 'approved':
    case 'running':
      return theme.spinner;
    case 'success':
      return theme.success;
    case 'failed':
    case 'denied':
      return theme.failure;
    case 'skipped':
      return theme.warning;
    case 'cancelled':
      return theme.warning;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
