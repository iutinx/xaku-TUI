import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeStats, renderMarkdownReport, exportReport } from '../../src/commands/report.js';
import type { ToolActivity } from '../../src/tools/activity.js';
import type { ConversationMessage } from '../../src/model/session.js';
import type { Config } from '../../src/config.js';

const baseInput = {
  model: 'qwen3:8b',
  temperature: 0.2,
  systemPrompt: 'be concise',
  workspace: '/work/project',
  startedAt: 1_700_000_000_000,
  logPath: '/data/logs/session-x.jsonl',
  promptTokens: 1200,
  completionTokens: 600,
  generationMs: 12_000,
};

const messages: ConversationMessage[] = [
  { role: 'user', content: 'read the readme' },
  {
    role: 'assistant',
    content: 'Here it is.',
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'c1', content: '# Project' },
  { role: 'assistant', content: 'It is about a project.' },
];

const activities: ToolActivity[] = [
  {
    id: 'a1',
    callId: 'c1',
    toolName: 'read_file',
    args: { path: 'README.md' },
    status: 'success',
    formatValid: true,
    startedAt: 0,
    durationMs: 40,
    output: '# Project',
  },
  {
    id: 'a2',
    callId: 'c2',
    toolName: 'read_file',
    args: { path: 'missing.md' },
    status: 'failed',
    formatValid: true,
    label: 'execution_error',
    error: 'ENOENT: no such file',
    durationMs: 10,
  },
];

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'xaku-report-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeConfig(): Config {
  return {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    temperature: 0.2,
    systemPrompt: 'be concise',
    workspace: dir,
    dataDir: dir,
    logsDir: dir,
    casesDir: dir,
    shellTimeoutMs: 30_000,
    maxResultBytes: 100_000,
    autoApprove: 'none',
  } as Config;
}

describe('computeStats', () => {
  it('derives counts from the transcript and activity list', () => {
    const s = computeStats(baseInput, messages, activities);
    expect(s.messages).toBe(4);
    expect(s.userMessages).toBe(1);
    expect(s.assistantMessages).toBe(2);
    expect(s.toolMessages).toBe(1);
    expect(s.toolCalls).toBe(2);
    expect(s.toolSuccess).toBe(1);
    expect(s.toolFailed).toBe(1);
    expect(s.totalTokens).toBe(1800);
  });

  it('computes tokens per second from measured generation time', () => {
    const s = computeStats(baseInput, messages, activities);
    expect(s.tokensPerSecond).toBe(50); // 600 completion tokens over 12s
  });

  it('reports no speed when nothing was generated', () => {
    const s = computeStats({ ...baseInput, generationMs: 0 }, [], []);
    expect(s.tokensPerSecond).toBeNull();
  });

  it('averages tool durations', () => {
    expect(computeStats(baseInput, messages, activities).avgToolMs).toBe(25);
  });

  it('lists failures with their labels', () => {
    const s = computeStats(baseInput, messages, activities);
    expect(s.failures).toEqual([
      { tool: 'read_file', label: 'execution_error', error: 'ENOENT: no such file' },
    ]);
  });
});

describe('renderMarkdownReport', () => {
  const md = () => renderMarkdownReport(computeStats(baseInput, messages, activities), messages, activities);

  it('includes the summary, performance and workspace', () => {
    const out = md();
    expect(out).toContain('# xaku session report');
    expect(out).toContain('| Model | `qwen3:8b` |');
    expect(out).toContain('| Workspace | `/work/project` |');
    expect(out).toContain('50 tok/s');
  });

  it('renders the tool-call table with format and outcome columns', () => {
    const out = md();
    expect(out).toContain('| Tool | Arguments | Format | Approval | Result | Duration |');
    expect(out).toContain('✔ valid');
    expect(out).toContain('**execution_error**');
  });

  it('lists failures', () => {
    expect(md()).toContain('## Failures');
  });

  it('includes the transcript without system lines', () => {
    const out = md();
    expect(out).toContain('### You');
    expect(out).toContain('read the readme');
    expect(out).not.toContain('### system');
  });

  it('escapes pipes inside argument cells so the table stays valid', () => {
    const pipe = computeStats(baseInput, messages, [
      { ...activities[0], args: { path: 'a|b.md' } },
    ]);
    expect(renderMarkdownReport(pipe, messages, [{ ...activities[0], args: { path: 'a|b.md' } }])).toContain(
      'a\\|b.md',
    );
  });
});

/**
 * Spec §14 Check 5: the exported numbers must match what /stats shows.
 * Both read the same computeStats, so assert the report carries identical values.
 */
describe('/export matches /stats', () => {
  it('exports a Markdown + JSON pair with the same figures as the stats view', () => {
    const stats = computeStats(baseInput, messages, activities);
    const files = exportReport(fakeConfig(), stats, messages, activities, dir);

    expect(existsSync(files.markdownPath)).toBe(true);
    expect(existsSync(files.jsonPath)).toBe(true);

    const markdown = readFileSync(files.markdownPath, 'utf-8');
    const json = JSON.parse(readFileSync(files.jsonPath, 'utf-8')) as { stats: typeof stats };

    for (const key of [
      'messages',
      'toolCalls',
      'toolSuccess',
      'toolFailed',
      'promptTokens',
      'completionTokens',
      'totalTokens',
      'tokensPerSecond',
      'avgToolMs',
    ] as const) {
      expect(json.stats[key], `${key} in JSON`).toBe(stats[key]);
      if (stats[key] !== null) {
        expect(markdown, `${key} rendered in Markdown`).toContain(String(stats[key]));
      }
    }
  });

  it('names files by the session start timestamp', () => {
    const files = exportReport(fakeConfig(), computeStats(baseInput, messages, activities), messages, activities, dir);
    expect(path.basename(files.markdownPath)).toMatch(/^xaku-report-\d{4}-\d{2}-\d{2}T.*\.md$/);
    expect(files.jsonPath.endsWith('.json')).toBe(true);
  });
});
