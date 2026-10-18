import { mkdirSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';

export interface SessionMeta {
  model: string | null;
  temperature: number;
  systemPrompt: string | null;
  workspace: string;
  baseUrl: string;
}

export interface Logger {
  log(event: Record<string, unknown>): void;
  close(): void;
  readonly path: string;
}

export function createLogger(config: Config, meta: SessionMeta): Logger {
  mkdirSync(config.logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(config.logsDir, `session-${timestamp}.jsonl`);

  appendFileSync(
    logPath,
    JSON.stringify({
      event: 'session_start',
      timestamp: Date.now(),
      ...meta,
    }) + '\n',
  );

  return {
    get path() {
      return logPath;
    },
    log(event) {
      appendFileSync(
        logPath,
        JSON.stringify({ timestamp: Date.now(), ...event }) + '\n',
      );
    },
    close() {
      appendFileSync(
        logPath,
        JSON.stringify({ event: 'session_end', timestamp: Date.now() }) + '\n',
      );
    },
  };
}
