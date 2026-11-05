import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { exportSession, type ExportStats } from '../../src/commands/report.js';

describe('Spec §14 Acceptance: /export Report', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'xaku-export-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('Check 5: Produces Markdown and JSON report files', async () => {
    const config = {
      workspace: tempDir,
    } as any;

    const messages = [
      { role: 'user' as const, content: 'What is 2+2?' },
      { role: 'assistant' as const, content: 'The answer is 4.' },
    ];

    const stats: ExportStats = {
      generatedTokens: 150,
      toolSuccess: 3,
      toolFail: 1,
    };

    const result = await exportSession(
      config,
      messages,
      'qwen3:4b',
      0.2,
      'You are helpful.',
      stats,
    );

    // Verify both files exist
    const mdContent = await readFile(result.mdPath, 'utf-8');
    const jsonContent = await readFile(result.jsonPath, 'utf-8');

    // Verify Markdown structure
    expect(mdContent).toContain('# xaku Session Report');
    expect(mdContent).toContain('**Model:** qwen3:4b');
    expect(mdContent).toContain('**Temperature:** 0.2');
    expect(mdContent).toContain('## Performance Statistics');
    expect(mdContent).toContain('| Generated tokens | 150 |');
    expect(mdContent).toContain('| Tool successes | 3 |');
    expect(mdContent).toContain('| Tool failures | 1 |');
    expect(mdContent).toContain('## Conversation Transcript');
    expect(mdContent).toContain('### You');
    expect(mdContent).toContain('What is 2+2?');
    expect(mdContent).toContain('### Model');
    expect(mdContent).toContain('The answer is 4.');

    // Verify JSON structure
    const parsed = JSON.parse(jsonContent);
    expect(parsed.model).toBe('qwen3:4b');
    expect(parsed.temperature).toBe(0.2);
    expect(parsed.workspace).toBe(tempDir);
    expect(parsed.systemPrompt).toBe('You are helpful.');
    expect(parsed.stats.generatedTokens).toBe(150);
    expect(parsed.stats.toolSuccess).toBe(3);
    expect(parsed.stats.toolFail).toBe(1);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[1].role).toBe('assistant');
  });

  it('Check 5: Report numbers match /stats (consistency)', async () => {
    const config = {
      workspace: tempDir,
    } as any;

    const messages = [
      { role: 'user' as const, content: 'Read file' },
      { role: 'assistant' as const, content: 'I will read the file.' },
      { role: 'tool' as const, tool_call_id: 'call_1', content: 'file content here' },
      { role: 'assistant' as const, content: 'The file contains: file content here' },
    ];

    const stats: ExportStats = {
      generatedTokens: 250,
      toolSuccess: 5,
      toolFail: 0,
    };

    const result = await exportSession(config, messages, 'qwen3:8b', 0.7, null, stats);

    const jsonContent = await readFile(result.jsonPath, 'utf-8');
    const parsed = JSON.parse(jsonContent);

    // Verify stats are exactly as passed in (no transformation)
    expect(parsed.stats).toEqual(stats);
    expect(parsed.stats.generatedTokens).toBe(250);
    expect(parsed.stats.toolSuccess).toBe(5);
    expect(parsed.stats.toolFail).toBe(0);

    // Verify tool messages are included in messages array
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.messages[2].role).toBe('tool');
    expect(parsed.messages[2].tool_call_id).toBe('call_1');
  });

  it('Check 5: Handles empty conversation gracefully', async () => {
    const config = {
      workspace: tempDir,
    } as any;

    const messages: any[] = [];
    const stats: ExportStats = {
      generatedTokens: 0,
      toolSuccess: 0,
      toolFail: 0,
    };

    const result = await exportSession(config, messages, 'qwen3:4b', 0.2, null, stats);

    const mdContent = await readFile(result.mdPath, 'utf-8');
    expect(mdContent).toContain('# xaku Session Report');
    expect(mdContent).toContain('| Generated tokens | 0 |');
  });
});
