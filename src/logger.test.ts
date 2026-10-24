import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from './logger.js';

describe('Spec §14 Acceptance: Session Logging', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'xaku-logger-test-'));
    logsDir = path.join(tempDir, 'logs');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('Check 4: Writes session_end event on close()', async () => {
    const config = {
      logsDir,
      dataDir: tempDir,
      casesDir: path.join(tempDir, 'cases'),
      workspace: tempDir,
      baseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
      temperature: 0.2,
      systemPrompt: null,
      maxResultBytes: 100000,
      shellTimeoutMs: 30000,
    };

    const logger = createLogger(config as any, {
      model: 'test-model',
      temperature: 0.2,
      systemPrompt: null,
      workspace: tempDir,
      baseUrl: 'http://localhost:11434/v1',
    });

    // Log some events
    logger.log({ event: 'user_message', content: 'hello' });
    logger.log({ event: 'assistant_message', content: 'hi there' });

    // Close the logger (should write session_end)
    logger.close();

    // Read the log file and verify it contains session_end
    const logContent = await readFile(logger.path, 'utf-8');
    const lines = logContent.trim().split('\n').map(line => JSON.parse(line));

    expect(lines[0].event).toBe('session_start');
    expect(lines[1].event).toBe('user_message');
    expect(lines[2].event).toBe('assistant_message');
    expect(lines[3].event).toBe('session_end');
    expect(lines[3].timestamp).toBeDefined();
  });

  it('Check 4: Crash-safe - log file exists immediately', () => {
    const config = {
      logsDir,
      dataDir: tempDir,
      casesDir: path.join(tempDir, 'cases'),
      workspace: tempDir,
      baseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
      temperature: 0.2,
      systemPrompt: null,
      maxResultBytes: 100000,
      shellTimeoutMs: 30000,
    };

    const logger = createLogger(config as any, {
      model: 'test-model',
      temperature: 0.2,
      systemPrompt: null,
      workspace: tempDir,
      baseUrl: 'http://localhost:11434/v1',
    });

    // Log file should exist immediately after creation
    const content = readFileSync(logger.path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    
    const firstEvent = JSON.parse(lines[0]);
    expect(firstEvent.event).toBe('session_start');
  });
});
