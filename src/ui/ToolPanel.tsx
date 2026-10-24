import { Box, Text } from 'ink';
import type { ToolActivity, ToolActivityStatus } from './ToolActivity.js';
import { symbols, theme } from './theme.js';

export interface ToolPanelProps {
  activities: ToolActivity[];
}

export function ToolPanel({ activities }: ToolPanelProps) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderLeft={true} borderColor="gray" paddingLeft={1} flexGrow={1}>
      <Text bold color={theme.primary}>
        Tool Activity
      </Text>
      {activities.map((activity) => (
        <ToolActivityView key={activity.id} activity={activity} />
      ))}
    </Box>
  );
}

function ToolActivityView({ activity }: { activity: ToolActivity }) {
  const icon = getStatusIcon(activity.status);
  const iconColor = getStatusColor(activity.status);
  
  const argsStr = Object.entries(activity.arguments)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  
  const durationStr = activity.duration !== undefined ? ` ${activity.duration.toFixed(1)}s` : '';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={iconColor}>
          {icon} {activity.toolName} {argsStr}
          {durationStr}
        </Text>
      </Box>
      
      {activity.validationError && (
        <Box marginLeft={2}>
          <Text color={theme.muted}>
            {symbols.treeBranch} format check: {symbols.failure} {activity.validationError}
          </Text>
        </Box>
      )}
      
      {activity.status === 'awaiting_approval' && activity.preview && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.muted}>
            {symbols.treeLast} preview:
          </Text>
          <Box marginLeft={2}>
            <Text dimColor>{activity.preview}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.primary}>
              [a] approve  [d] deny  [t] auto-approve
            </Text>
          </Box>
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
