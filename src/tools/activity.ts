import type { ErrorLabel } from './types.js';

export type ToolActivityStatus =
  | 'awaiting_approval'
  | 'running'
  | 'success'
  | 'failed'
  | 'denied'
  | 'skipped'
  | 'cancelled';

/** Statuses that will not change further. */
export const TERMINAL_STATUSES: readonly ToolActivityStatus[] = [
  'success',
  'failed',
  'denied',
  'skipped',
  'cancelled',
];

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export interface FileDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
  truncated: boolean;
}

export interface ToolActivity {
  id: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolActivityStatus;
  /** Result of the pre-execution format check. */
  formatValid: boolean;
  formatError?: string;
  label?: ErrorLabel;
  error?: string;
  output?: string;
  trimmed?: boolean;
  autoApproved?: boolean;
  startedAt?: number;
  durationMs?: number;
  /** write_file only: current file state probed before approval. */
  fileState?: 'new' | 'existing' | 'too-large' | 'unreadable';
  diff?: FileDiff;
}

export function isTerminal(status: ToolActivityStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function patchActivity(
  activities: ToolActivity[],
  id: string,
  patch: Partial<ToolActivity>,
): ToolActivity[] {
  return activities.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/**
 * Decide whether a tool runs without prompting under the current mode.
 * `readOnly` comes from `ToolDefinition.isReadOnly` so the registry stays the
 * single source of truth about which tools can change data.
 */
export function shouldAutoApprove(
  mode: 'none' | 'read-only' | 'all',
  readOnly: boolean,
): boolean {
  if (mode === 'all') return true;
  if (mode === 'read-only') return readOnly;
  return false;
}

export interface ActivityCounts {
  success: number;
  failed: number;
  denied: number;
  skipped: number;
  cancelled: number;
  pending: number;
}

export function countActivities(activities: ToolActivity[]): ActivityCounts {
  const counts: ActivityCounts = {
    success: 0,
    failed: 0,
    denied: 0,
    skipped: 0,
    cancelled: 0,
    pending: 0,
  };
  for (const a of activities) {
    switch (a.status) {
      case 'success':
        counts.success += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'denied':
        counts.denied += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      default:
        counts.pending += 1;
    }
  }
  return counts;
}

/** Average wall-clock duration over activities that recorded one. */
export function averageToolDuration(activities: ToolActivity[]): number | null {
  const durations = activities
    .map((a) => a.durationMs)
    .filter((d): d is number => typeof d === 'number');
  if (durations.length === 0) return null;
  return durations.reduce((sum, d) => sum + d, 0) / durations.length;
}

/**
 * Activities the compact view collapses into summary lines: everything that has
 * finished. Actionable rows always stay visible so a prompt is never hidden.
 */
export function splitCollapsed(activities: ToolActivity[]): {
  collapsed: ToolActivity[];
  visible: ToolActivity[];
} {
  const collapsed: ToolActivity[] = [];
  const visible: ToolActivity[] = [];
  for (const a of activities) {
    (isTerminal(a.status) ? collapsed : visible).push(a);
  }
  return { collapsed, visible };
}

export interface SummaryLine {
  status: ToolActivityStatus;
  count: number;
}

/**
 * Per-outcome totals for collapsed rows, in a stable render order.
 * Takes the already-filtered collapsed list, so only terminal statuses occur.
 */
export function summarizeCollapsed(collapsed: ToolActivity[]): SummaryLine[] {
  const counts = countActivities(collapsed);
  const order: Array<[ToolActivityStatus, number]> = [
    ['success', counts.success],
    ['failed', counts.failed],
    ['denied', counts.denied],
    ['cancelled', counts.cancelled],
    ['skipped', counts.skipped],
  ];
  return order
    .map(([status, count]) => ({ status, count }))
    .filter((line) => line.count > 0);
}
