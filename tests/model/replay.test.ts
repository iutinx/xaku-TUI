import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { listSessions, loadSession, parseSessionLog, reconstructUpTo } from '../../src/model/replay.js';

const EVENTS = [
  { event: 'session_start', timestamp: 1000, model: 'qwen3:4b', temperature: 0.2, systemPrompt: 'be brief', workspace: '/ws', baseUrl: 'http://x/v1' },
  { event: 'user_message', timestamp: 2000, content: 'read the file' },
  { event: 'assistant_message', timestamp: 3000, content: '', toolCalls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
  { event: 'tool_call', timestamp: 3100, toolCallId: 'call_1', tool: 'read_file', args: { path: 'a.txt' }, valid: true },
  { event: 'tool_success', timestamp: 3200, toolCallId: 'call_1', tool: 'read_file', args: { path: 'a.txt' }, duration: 0.1, output: 'hello' },
  { event: 'assistant_message', timestamp: 4000, content: 'The file says hello.' },
];

function jsonl(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

describe('parseSessionLog', () => {
  it('parses valid lines and skips malformed ones', () => {
    const raw = `{"event":"a","timestamp":1}\nnot json\n{"event":"b","timestamp":2}\n`;
    const events = parseSessionLog(raw);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.event)).toEqual(['a', 'b']);
  });
});

describe('reconstructUpTo', () => {
  it('builds the conversation up to the cursor', () => {
    const snap = reconstructUpTo(EVENTS, 5);
    expect(snap.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(snap.messages[3].content).toBe('The file says hello.');
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]).toMatchObject({ status: 'success', toolName: 'read_file', duration: 0.1 });
  });

  it('shows earlier snapshots at lower cursors', () => {
    const snap = reconstructUpTo(EVENTS, 3);
    expect(snap.activities[0].status).toBe('awaiting_approval');
    expect(snap.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('tracks settings changes', () => {
    const withChanges = [
      ...EVENTS,
      { event: 'set_model', timestamp: 5000, model: 'llama3:8b' },
      { event: 'set_temperature', timestamp: 5100, temperature: 0.9 },
    ];
    const snap = reconstructUpTo(withChanges, 7);
    expect(snap.settings.model).toBe('llama3:8b');
    expect(snap.settings.temperature).toBe(0.9);
    expect(snap.settings.systemPrompt).toBe('be brief');
  });

  it('handles clear events', () => {
    const withClear = [...EVENTS, { event: 'clear', timestamp: 5000 }, { event: 'user_message', timestamp: 5100, content: 'fresh start' }];
    const snap = reconstructUpTo(withClear, 8);
    expect(snap.messages).toHaveLength(1);
    expect(snap.activities).toHaveLength(0);
  });

  it('marks pending calls cancelled on generation_cancelled', () => {
    const cancelled = [
      { event: 'session_start', timestamp: 1000, model: 'm', temperature: 0.2, systemPrompt: null, workspace: '/w' },
      { event: 'user_message', timestamp: 2000, content: 'go' },
      { event: 'assistant_message', timestamp: 2300, content: '', toolCalls: [{ index: 0, id: 'c1', function: { name: 'run_shell', arguments: '{}' } }] },
      { event: 'tool_call', timestamp: 2500, toolCallId: 'c1', tool: 'run_shell', args: {}, valid: true },
      { event: 'generation_cancelled', timestamp: 3000, cancelledTools: 1 },
    ];
    const snap = reconstructUpTo(cancelled, 4);
    expect(snap.activities[0].status).toBe('cancelled');
    // Display-faithful: the assistant's tool_call has no synthetic result message.
    expect(snap.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect((snap.messages[1] as { tool_calls?: unknown[] }).tool_calls).toHaveLength(1);
  });

  it('falls back to name matching for old logs without toolCallId', () => {
    const legacy = [
      { event: 'user_message', timestamp: 1000, content: 'go' },
      { event: 'tool_call', timestamp: 2000, tool: 'list_dir', args: {}, valid: true },
      { event: 'tool_success', timestamp: 2500, tool: 'list_dir', args: {}, duration: 0.2, output: 'files' },
    ];
    const snap = reconstructUpTo(legacy, 2);
    expect(snap.activities[0].status).toBe('success');
  });

  it('keeps pending calls pending in the message view', () => {
    const pending = [
      { event: 'user_message', timestamp: 1000, content: 'go' },
      { event: 'tool_call', timestamp: 2000, toolCallId: 'c9', tool: 'read_file', args: {}, valid: true },
    ];
    const snap = reconstructUpTo(pending, 1);
    expect(snap.messages).toHaveLength(1);
    expect(snap.activities[0].status).toBe('awaiting_approval');
  });
});

describe('listSessions', () => {
  let logsDir: string;

  beforeAll(async () => {
    logsDir = await mkdtemp(path.join(tmpdir(), 'xaku-replay-'));
    await writeFile(
      path.join(logsDir, 'session-2026-10-24a.jsonl'),
      jsonl([{ event: 'session_start', timestamp: 2000, model: 'newer', workspace: '/w2' }, { event: 'user_message', timestamp: 2100, content: 'hi' }]),
    );
    await writeFile(
      path.join(logsDir, 'session-2026-10-23a.jsonl'),
      jsonl([{ event: 'session_start', timestamp: 1000, model: 'older', workspace: '/w1' }]),
    );
    await writeFile(path.join(logsDir, 'notes.txt'), 'ignored');
  });

  afterAll(async () => {
    await rm(logsDir, { recursive: true, force: true });
  });

  it('lists session files newest first, ignoring others', async () => {
    const sessions = await listSessions(logsDir);
    expect(sessions.map((s) => s.model)).toEqual(['newer', 'older']);
    expect(sessions[0].events).toBe(2);
  });

  it('returns empty for a missing directory', async () => {
    expect(await listSessions(path.join(logsDir, 'nope'))).toEqual([]);
  });

  it('loads events for one file', async () => {
    const events = await loadSession(logsDir, 'session-2026-10-23a.jsonl');
    expect(events).toHaveLength(1);
  });
});
