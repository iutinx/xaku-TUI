import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import type { ConversationMessage } from '../model/session.js';
import type { ToolActivity } from '../tools/activity.js';
import { averageToolDuration, countActivities } from '../tools/activity.js';

export interface SessionStats {
  model: string;
  temperature: number;
  systemPrompt: string | null;
  workspace: string;
  startedAt: number;
  logPath: string;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolMessages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Wall-clock generation time across the session, in ms. */
  generationMs: number;
  tokensPerSecond: number | null;
  toolCalls: number;
  toolSuccess: number;
  toolFailed: number;
  toolDenied: number;
  toolSkipped: number;
  toolCancelled: number;
  avgToolMs: number | null;
  failures: Array<{ tool: string; label?: string; error?: string }>;
}

/**
 * Derive session statistics from the live transcript and activity list. Single
 * source of truth shared by `/stats` and `/export` so the exported numbers can
 * never disagree with what `/stats` printed (spec §11.1).
 */
export function computeStats(
  input: {
    model: string;
    temperature: number;
    systemPrompt: string | null;
    workspace: string;
    startedAt: number;
    logPath: string;
    promptTokens: number;
    completionTokens: number;
    generationMs: number;
  },
  messages: ConversationMessage[],
  activities: ToolActivity[],
): SessionStats {
  const counts = countActivities(activities);
  const completionTokens = input.completionTokens;
  const seconds = input.generationMs / 1000;

  return {
    model: input.model,
    temperature: input.temperature,
    systemPrompt: input.systemPrompt,
    workspace: input.workspace,
    startedAt: input.startedAt,
    logPath: input.logPath,
    messages: messages.length,
    userMessages: messages.filter((m) => m.role === 'user').length,
    assistantMessages: messages.filter((m) => m.role === 'assistant').length,
    toolMessages: messages.filter((m) => m.role === 'tool').length,
    promptTokens: input.promptTokens,
    completionTokens,
    totalTokens: input.promptTokens + completionTokens,
    generationMs: input.generationMs,
    tokensPerSecond:
      seconds > 0 && completionTokens > 0
        ? Math.round((completionTokens / seconds) * 10) / 10
        : null,
    toolCalls: activities.length,
    toolSuccess: counts.success,
    toolFailed: counts.failed,
    toolDenied: counts.denied,
    toolSkipped: counts.skipped,
    toolCancelled: counts.cancelled,
    avgToolMs: averageToolDuration(activities),
    failures: activities
      .filter((a) => a.status === 'failed')
      .map((a) => ({ tool: a.toolName, label: a.label, error: a.error })),
  };
}

export function renderMarkdownReport(
  stats: SessionStats,
  messages: ConversationMessage[],
  activities: ToolActivity[],
): string {
  const out: string[] = [];
  const date = new Date(stats.startedAt);

  out.push('# xaku session report');
  out.push('');
  out.push(`**Generated:** ${date.toISOString()}`);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Model | \`${stats.model || '—'}\` |`);
  out.push(`| Temperature | ${stats.temperature} |`);
  out.push(`| Workspace | \`${stats.workspace}\` |`);
  out.push(`| System prompt | ${stats.systemPrompt ? 'set' : 'not set'} |`);
  out.push(`| Session log | \`${stats.logPath}\` |`);
  out.push('');

  out.push('## Performance');
  out.push('');
  out.push('| Metric | Value |');
  out.push('|---|---|');
  out.push(`| Messages | ${stats.messages} |`);
  out.push(`| Prompt tokens | ${stats.promptTokens} |`);
  out.push(`| Completion tokens | ${stats.completionTokens} |`);
  out.push(`| Total tokens | ${stats.totalTokens} |`);
  out.push(`| Generation time | ${(stats.generationMs / 1000).toFixed(1)} s |`);
  out.push(
    `| Speed | ${stats.tokensPerSecond === null ? '—' : `${stats.tokensPerSecond} tok/s`} |`,
  );
  out.push(`| Tool calls | ${stats.toolCalls} |`);
  out.push(
    `| Tool outcomes | ✔ ${stats.toolSuccess} ✖ ${stats.toolFailed} ↓ ${stats.toolSkipped} (denied ${stats.toolDenied}, cancelled ${stats.toolCancelled}) |`,
  );
  out.push(
    `| Avg tool duration | ${stats.avgToolMs === null ? '—' : `${Math.round(stats.avgToolMs)} ms`} |`,
  );
  out.push('');

  if (activities.length > 0) {
    out.push('## Tool calls');
    out.push('');
    out.push('| Tool | Arguments | Format | Approval | Result | Duration |');
    out.push('|---|---|---|---|---|---|');
    for (const a of activities) {
      out.push(
        `| \`${a.toolName}\` | \`${escapeCell(JSON.stringify(a.args))}\` | ${
          a.formatValid ? '✔ valid' : `✖ ${escapeCell(a.formatError ?? 'invalid')}`
        } | ${approvalOf(a)} | ${resultOf(a)} | ${
          a.durationMs === undefined ? '—' : `${a.durationMs} ms`
        } |`,
      );
    }
    out.push('');
  }

  if (stats.failures.length > 0) {
    out.push('## Failures');
    out.push('');
    for (const f of stats.failures) {
      out.push(`- \`${f.tool}\` — **${f.label ?? 'execution_error'}**${f.error ? `: ${f.error}` : ''}`);
    }
    out.push('');
  }

  out.push('## Transcript');
  out.push('');
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push(`### You`);
      out.push('');
      out.push(m.content ?? '');
      out.push('');
    } else if (m.role === 'assistant') {
      out.push(`### ${stats.model || 'model'}`);
      out.push('');
      if (m.content) out.push(m.content);
      if (m.tool_calls?.length) {
        out.push('');
        for (const tc of m.tool_calls) {
          out.push(`> tool call: \`${tc.function.name}\` ${tc.function.arguments}`);
        }
      }
      out.push('');
    } else if (m.role === 'tool') {
      out.push(`> tool result (${m.tool_call_id}): ${truncate(m.content, 2000)}`);
      out.push('');
    }
  }

  return out.join('\n');
}

function approvalOf(a: ToolActivity): string {
  if (a.autoApproved) return 'auto-approved';
  if (a.status === 'denied') return 'denied';
  if (a.status === 'awaiting_approval') return 'pending';
  return 'approved';
}

function resultOf(a: ToolActivity): string {
  switch (a.status) {
    case 'success':
      return a.trimmed ? 'success (trimmed)' : 'success';
    case 'failed':
      return `**${a.label ?? 'execution_error'}**`;
    case 'denied':
      return 'denied';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export interface ExportResult {
  markdownPath: string;
  jsonPath: string;
}

/** Write the Markdown + JSON report pair into the workspace (spec §11.1). */
export function exportReport(
  config: Config,
  stats: SessionStats,
  messages: ConversationMessage[],
  activities: ToolActivity[],
  dir?: string,
): ExportResult {
  const target = dir ?? config.workspace;
  mkdirSync(target, { recursive: true });
  const stamp = new Date(stats.startedAt).toISOString().replace(/[:.]/g, '-');

  const markdownPath = path.join(target, `xaku-report-${stamp}.md`);
  const jsonPath = path.join(target, `xaku-report-${stamp}.json`);

  writeFileSync(markdownPath, renderMarkdownReport(stats, messages, activities), 'utf-8');
  writeFileSync(
    jsonPath,
    JSON.stringify({ stats, messages, toolActivities: activities }, null, 2),
    'utf-8',
  );

  return { markdownPath, jsonPath };
}
