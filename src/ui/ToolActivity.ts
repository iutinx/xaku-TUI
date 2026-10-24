export type ToolActivityStatus =
  | 'validating'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'success'
  | 'failed'
  | 'denied'
  | 'skipped'
  | 'cancelled';

export interface ToolActivity {
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: ToolActivityStatus;
  validationError?: string;
  preview?: string;
  result?: string;
  error?: string;
  errorLabel?: string;
  duration?: number;
  trimmed?: boolean;
  startTime?: number;
  autoApproved?: boolean;
}
