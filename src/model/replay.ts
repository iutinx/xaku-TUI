import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationMessage } from './session.js';
import type { ToolActivity, ToolActivityStatus } from '../ui/ToolActivity.js';

export interface LogEvent {
  event: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface ReplaySettings {
  model: string | null;
  temperature: number | null;
  systemPrompt: string | null;
}

export interface ReplaySnapshot {
  messages: ConversationMessage[];
  activities: ToolActivity[];
  settings: ReplaySettings;
}

export interface SessionSummary {
  fileName: string;
  startedAt: number | null;
  model: string | null;
  workspace: string | null;
  events: number;
}

export function parseSessionLog(raw: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LogEvent;
      if (typeof parsed.event === 'string') out.push(parsed);
    } catch {
      // Skip malformed lines rather than abort the whole replay.
    }
  }
  return out;
}

export async function listSessions(logsDir: string): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(logsDir);
  } catch {
    return [];
  }
  const sessions: SessionSummary[] = [];
  for (const fileName of files.filter((f) => f.startsWith('session-') && f.endsWith('.jsonl'))) {
    try {
      const raw = await readFile(path.join(logsDir, fileName), 'utf-8');
      const events = parseSessionLog(raw);
      const start = events.find((e) => e.event === 'session_start');
      sessions.push({
        fileName,
        startedAt: typeof start?.timestamp === 'number' ? start.timestamp : null,
        model: typeof start?.model === 'string' ? start.model : null,
        workspace: typeof start?.workspace === 'string' ? start.workspace : null,
        events: events.length,
      });
    } catch {
      // Unreadable session file: skip it.
    }
  }
  sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return sessions;
}

export async function loadSession(logsDir: string, fileName: string): Promise<LogEvent[]> {
  const raw = await readFile(path.join(logsDir, fileName), 'utf-8');
  return parseSessionLog(raw);
}

const NON_TERMINAL: ToolActivityStatus[] = ['validating', 'awaiting_approval', 'approved', 'running'];

export function reconstructUpTo(events: LogEvent[], index: number): ReplaySnapshot {
  const messages: ConversationMessage[] = [];
  const activities: ToolActivity[] = [];
  const settings: ReplaySettings = { model: null, temperature: null, systemPrompt: null };

  const findActivity = (e: LogEvent): ToolActivity | undefined => {
    if (typeof e.toolCallId === 'string') {
      const direct = activities.find((a) => a.toolCallId === e.toolCallId);
      if (direct) return direct;
    }
    // Fallback for older logs without call ids: most recent non-terminal activity of the same tool.
    for (let i = activities.length - 1; i >= 0; i--) {
      const a = activities[i];
      if (a.toolName === e.tool && NON_TERMINAL.includes(a.status)) return a;
    }
    return undefined;
  };

  const update = (e: LogEvent, patch: Partial<ToolActivity>) => {
    const activity = findActivity(e);
    if (activity) Object.assign(activity, patch);
  };

  const limit = Math.min(index, events.length - 1);
  for (let i = 0; i <= limit; i++) {
    const e = events[i];
    switch (e.event) {
      case 'session_start':
        settings.model = typeof e.model === 'string' ? e.model : null;
        settings.temperature = typeof e.temperature === 'number' ? e.temperature : null;
        settings.systemPrompt = typeof e.systemPrompt === 'string' ? e.systemPrompt : null;
        break;
      case 'set_model':
        if (typeof e.model === 'string') settings.model = e.model;
        break;
      case 'set_temperature':
        if (typeof e.temperature === 'number') settings.temperature = e.temperature;
        break;
      case 'set_system_prompt':
        settings.systemPrompt = typeof e.prompt === 'string' ? e.prompt : null;
        break;
      case 'clear':
        messages.length = 0;
        activities.length = 0;
        break;
      case 'user_message':
      case 'retry':
        messages.push({ role: 'user', content: String(e.content ?? '') });
        break;
      case 'assistant_message': {
        const rawCalls = Array.isArray(e.toolCalls) ? (e.toolCalls as Record<string, unknown>[]) : [];
        const calls = rawCalls
          .filter((t) => typeof t?.id === 'string')
          .map((t) => ({
            id: String(t.id),
            type: 'function' as const,
            function: {
              name: String((t.function as Record<string, unknown> | undefined)?.name ?? ''),
              arguments: String((t.function as Record<string, unknown> | undefined)?.arguments ?? '{}'),
            },
          }));
        messages.push({
          role: 'assistant',
          content: typeof e.content === 'string' ? e.content : null,
          ...(calls.length > 0 ? { tool_calls: calls } : {}),
        });
        break;
      }
      case 'tool_call': {
        const toolCallId = typeof e.toolCallId === 'string' ? e.toolCallId : `replay_${i}`;
        activities.push({
          id: `replay_${toolCallId}`,
          toolCallId,
          toolName: String(e.tool ?? ''),
          arguments: (e.args as Record<string, unknown>) ?? {},
          status: e.valid ? 'awaiting_approval' : 'failed',
          validationError: typeof e.validationError === 'string' ? e.validationError : undefined,
        });
        break;
      }
      case 'tool_auto_approved':
        update(e, { status: 'approved', autoApproved: true });
        break;
      case 'tool_denied':
        update(e, { status: 'denied' });
        if (typeof e.toolCallId === 'string') {
          messages.push({ role: 'tool', tool_call_id: e.toolCallId, content: 'Tool call denied by user' });
        }
        break;
      case 'tool_success': {
        update(e, {
          status: 'success',
          duration: typeof e.duration === 'number' ? e.duration : undefined,
          result: typeof e.output === 'string' ? e.output : undefined,
        });
        if (typeof e.toolCallId === 'string') {
          messages.push({
            role: 'tool',
            tool_call_id: e.toolCallId,
            content: typeof e.output === 'string' ? e.output : '',
          });
        }
        break;
      }
      case 'tool_error':
        update(e, {
          status: 'failed',
          error: typeof e.error === 'string' ? e.error : undefined,
          errorLabel: typeof e.label === 'string' ? e.label : undefined,
          duration: typeof e.duration === 'number' ? e.duration : undefined,
        });
        if (typeof e.toolCallId === 'string') {
          messages.push({
            role: 'tool',
            tool_call_id: e.toolCallId,
            content: `Error: ${typeof e.error === 'string' ? e.error : 'tool failed'}`,
          });
        }
        break;
      case 'tool_cancelled':
        update(e, { status: 'cancelled', duration: typeof e.duration === 'number' ? e.duration : undefined });
        break;
      case 'tool_choice':
        if (e.choice === 'skip') update(e, { status: 'skipped' });
        break;
      case 'generation_cancelled':
        for (const a of activities) {
          if (NON_TERMINAL.includes(a.status)) a.status = 'cancelled';
        }
        break;
      default:
        break;
    }
  }

  // Display reconstruction only: pending calls stay pending (no synthetic results).
  return { messages, activities, settings };
}

export function formatSessionLabel(s: SessionSummary): string {
  const when = s.startedAt ? new Date(s.startedAt).toLocaleString() : 'unknown time';
  const ws = s.workspace ? s.workspace.split(/[\\/]/).pop() : '—';
  return `${when} · ${s.model ?? '—'} · ${ws} · ${s.events} events`;
}
